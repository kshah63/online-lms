import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isDemoMode } from "@/lib/env";
import { logAudit } from "@/lib/audit";
import { captureError } from "@/lib/observability";
import { demoRecordingOptOuts } from "@/lib/demo/data";
import type { PencilSpace, PencilUser, Profile } from "@/lib/types";
import {
  createApiUser,
  createSpace,
  findSpaceByExternalId,
  getSpace,
  patchUser,
  PencilError,
  pencilLive,
  updateSpaceSettings,
  updateSpaceUsers,
} from "@/lib/pencil/client";
import { mockPencilUser, mockPencilUserId, mockSpace } from "@/lib/pencil/mock";
import type { PencilApiSpace, PencilUserRole } from "@/lib/pencil/types";

// ============================================================================
// Lazy, idempotent provisioning of Pencil users and Spaces (design decision a),
// host sync (g), recording policy with read-back (d), opt-out lookup.
//
// `admin` is ALWAYS the service-role client (createSupabaseAdminClient()); the
// tables involved are service-only. Every function here assumes the CALLER has
// already run canJoinLesson / canHostSpace / requireRole('admin'). When Pencil
// is mocked (`!pencilLive`: no key, or demo mode) every function returns
// mock.ts data and never touches Pencil; the DB is still read for the opt-out
// flag when Supabase is configured.
// ============================================================================

type Admin = SupabaseClient;
export type AuditActor = Profile | null | undefined;

const now = () => new Date().toISOString();

// ---------------------------------------------------------------------------
// Naming rules
// ---------------------------------------------------------------------------

/** Pencil never gets a minor's full name: students → first token of display_name; staff → display_name. */
export function pencilDisplayName(profile: Pick<Profile, "display_name" | "role">): string {
  const name = profile.display_name.trim();
  if (profile.role === "student") return name.split(/\s+/)[0] || "Student";
  return name || "Teacher";
}

/** Students → 'Student'; teachers AND admins → 'Teacher' (admins host Spaces). */
export function pencilUserRole(profile: Pick<Profile, "role">): PencilUserRole {
  return profile.role === "student" ? "Student" : "Teacher";
}

/** Pencil `externalId` of the Space for a pair — also pencil_spaces.external_id. */
export function spaceExternalId(courseId: string, studentId: string): string {
  return `${courseId}:${studentId}`;
}

/** `'<course name> · <student first name>'`. */
export function spaceTitle(courseName: string, student: Pick<Profile, "display_name" | "role">): string {
  return `${courseName} · ${pencilDisplayName({ display_name: student.display_name, role: "student" })}`;
}

// ---------------------------------------------------------------------------
// DB helpers (service role)
// ---------------------------------------------------------------------------

async function loadProfile(admin: Admin, id: string): Promise<Profile | null> {
  const { data, error } = await admin.from("profiles").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as Profile | null) ?? null;
}

async function loadCourse(admin: Admin, id: string): Promise<{ id: string; name: string } | null> {
  const { data, error } = await admin.from("courses").select("id,name").eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as { id: string; name: string } | null) ?? null;
}

/** profile ids of the Pencil users we know among `pencilUserIds`. */
async function profileIdsForPencilUsers(admin: Admin, pencilUserIds: string[]): Promise<string[]> {
  if (pencilUserIds.length === 0) return [];
  const { data, error } = await admin
    .from("pencil_users")
    .select("profile_id,pencil_user_id")
    .in("pencil_user_id", pencilUserIds);
  if (error) throw error;
  return ((data ?? []) as { profile_id: string }[]).map((r) => r.profile_id);
}

function unique<T>(xs: readonly T[]): T[] {
  return Array.from(new Set(xs));
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

/** Read-only lookup of a profile's Pencil identity (mock id when Pencil is mocked). */
export async function getPencilUser(admin: Admin, profileId: string): Promise<PencilUser | null> {
  if (!pencilLive) {
    return { profile_id: profileId, pencil_user_id: mockPencilUserId(profileId), pencil_email: null, pencil_name: null, created_at: new Date(0).toISOString() };
  }
  const { data, error } = await admin.from("pencil_users").select("*").eq("profile_id", profileId).maybeSingle();
  if (error) throw error;
  return (data as PencilUser | null) ?? null;
}

/**
 * Ensure `profile` has a Pencil API user; create it on first need
 * (`POST /users/createAPIUser {name, userRole, externalId: profile.id}`) and
 * upsert pencil_users. Idempotent: an existing row costs zero Pencil calls
 * (except a lazy `PATCH /users/{id} {name}` when display_name changed, which
 * is best-effort). Parents never get a Pencil user → PencilError
 * 'PARENT_NOT_ALLOWED'. Audits 'pencil.user.create' as `opts.actor`.
 */
export async function ensurePencilUser(
  admin: Admin,
  profile: Profile,
  opts: { actor?: AuditActor } = {},
): Promise<PencilUser> {
  if (profile.role === "parent") {
    throw new PencilError(0, "Parents have no Pencil user (status card only)", "PARENT_NOT_ALLOWED");
  }
  if (!pencilLive) return mockPencilUser(profile);

  const { data: existing, error } = await admin
    .from("pencil_users")
    .select("*")
    .eq("profile_id", profile.id)
    .maybeSingle();
  if (error) throw error;

  const name = pencilDisplayName(profile);
  if (existing) {
    const row = existing as PencilUser;
    if (row.pencil_name !== name) {
      // display_name changed since we provisioned — keep Pencil in sync, never block on it.
      try {
        await patchUser(row.pencil_user_id, { name });
        await admin.from("pencil_users").update({ pencil_name: name }).eq("profile_id", profile.id);
        row.pencil_name = name;
      } catch (err) {
        captureError(err, { where: "ensurePencilUser rename", profile_id: profile.id });
      }
    }
    return row;
  }

  const userRole = pencilUserRole(profile);
  const created = await createApiUser({ name, userRole, externalId: profile.id });

  const { data: saved, error: upsertError } = await admin
    .from("pencil_users")
    .upsert(
      { profile_id: profile.id, pencil_user_id: created.userId, pencil_email: created.email ?? null, pencil_name: name },
      { onConflict: "profile_id" },
    )
    .select("*")
    .single();
  if (upsertError) {
    // Pencil has no externalId lookup for users, so this is the one place a
    // duplicate could arise on retry; surface the id so an admin can repair.
    throw new PencilError(0, `Pencil user ${created.userId} created but pencil_users write failed: ${upsertError.message}`, "DB_WRITE_FAILED");
  }

  await logAudit(opts.actor ?? null, "pencil.user.create", { type: "profile", id: profile.id }, {
    pencil_user_id: created.userId,
    userRole,
  });
  return saved as PencilUser;
}

// ---------------------------------------------------------------------------
// Spaces
// ---------------------------------------------------------------------------

export interface EnsureSpaceInput {
  studentId: string;
  courseId: string;
  /** The session's assigned teacher — becomes a host. Null when unassigned. */
  teacherId?: string | null;
  /** Who is acting (for audit). An ADMIN actor is also added as a host. */
  actor?: AuditActor;
}

/** Read-only: the pencil_spaces row for a pair, or null (mock row when Pencil is mocked). */
export async function getSpaceForPair(admin: Admin, studentId: string, courseId: string): Promise<PencilSpace | null> {
  if (!pencilLive) return mockSpace({ studentId, courseId });
  const { data, error } = await admin
    .from("pencil_spaces")
    .select("*")
    .eq("student_id", studentId)
    .eq("course_id", courseId)
    .maybeSingle();
  if (error) throw error;
  return (data as PencilSpace | null) ?? null;
}

/**
 * Ensure the persistent Space for (student, course) exists and return its row.
 *  - an 'active'/'archived' row with a pencil_space_id → returned as is (0 calls);
 *  - otherwise (no row, or a 'mock' row from seed): provision Pencil users for
 *    the student, the assigned teacher and an admin actor; RECOVER an existing
 *    Space via `GET /spaces?filters{externalId}` before `POST /spaces/create`
 *    (externalId '<course>:<student>', title '<course> · <first name>', private,
 *    notifyInvitees false, hosts = teacher (+ admin actor), participants = student);
 *    upsert pencil_spaces on (student_id, course_id) — a 'mock' row is upgraded
 *    in place, keeping its id; missing hosts on a recovered Space are added via
 *    syncHosts. Audits 'pencil.space.create' {recovered}.
 */
export async function ensureSpace(admin: Admin, input: EnsureSpaceInput): Promise<PencilSpace> {
  const { studentId, courseId, teacherId = null, actor = null } = input;
  if (!pencilLive) return mockSpace({ studentId, courseId, teacherId });

  const { data: existing, error } = await admin
    .from("pencil_spaces")
    .select("*")
    .eq("student_id", studentId)
    .eq("course_id", courseId)
    .maybeSingle();
  if (error) throw error;
  const current = (existing as PencilSpace | null) ?? null;
  if (current && current.pencil_space_id && current.status !== "mock") return current;

  const [student, course] = await Promise.all([loadProfile(admin, studentId), loadCourse(admin, courseId)]);
  if (!student || student.role !== "student") throw new PencilError(0, "Student profile not found", "STUDENT_NOT_FOUND");
  if (!course) throw new PencilError(0, "Course not found", "COURSE_NOT_FOUND");

  const hostProfiles: Profile[] = [];
  if (teacherId) {
    const teacher = await loadProfile(admin, teacherId);
    if (teacher && (teacher.role === "teacher" || teacher.role === "admin")) hostProfiles.push(teacher);
  }
  if (actor && actor.role === "admin" && !hostProfiles.some((h) => h.id === actor.id)) hostProfiles.push(actor);

  // Sequential on purpose: stay well under Pencil's 5 QPS.
  const studentUser = await ensurePencilUser(admin, student, { actor });
  const hostUsers: PencilUser[] = [];
  for (const h of hostProfiles) hostUsers.push(await ensurePencilUser(admin, h, { actor }));

  const externalId = spaceExternalId(courseId, studentId);
  const title = spaceTitle(course.name, student);

  let remote: PencilApiSpace | null = await findSpaceByExternalId(externalId);
  const recovered = remote !== null;
  if (!remote) {
    remote = await createSpace({
      title,
      hosts: hostUsers.map((u) => ({ userId: u.pencil_user_id })),
      participants: [{ userId: studentUser.pencil_user_id }],
      visibility: "private",
      notifyInvitees: false,
      externalId,
    });
  }

  // Which of OUR profiles are hosts on the Pencil side right now.
  const desiredHostIds = hostProfiles.map((h) => h.id);
  const hostProfileIds = remote.hosts
    ? await profileIdsForPencilUsers(admin, remote.hosts.map((h) => h.userId))
    : desiredHostIds;

  const ts = now();
  const { data: saved, error: upsertError } = await admin
    .from("pencil_spaces")
    .upsert(
      {
        student_id: studentId,
        course_id: courseId,
        external_id: externalId,
        pencil_space_id: remote.spaceId,
        link: remote.link,
        title: remote.title ?? title,
        host_profile_ids: unique(hostProfileIds),
        participant_profile_ids: [studentId],
        hosts_synced_at: ts,
        // The create/GET response is a read of the settings, so this is confirmed state.
        recording_disabled: remote.settings?.disableAlwaysOnRecording === true,
        recording_verified_at: remote.settings ? ts : null,
        status: "active",
      },
      { onConflict: "student_id,course_id" },
    )
    .select("*")
    .single();
  if (upsertError) {
    throw new PencilError(0, `Space ${remote.spaceId} exists at Pencil but pencil_spaces write failed: ${upsertError.message}`, "DB_WRITE_FAILED");
  }
  let row = saved as PencilSpace;

  await logAudit(actor ?? null, "pencil.space.create", { type: "pencil_space", id: row.id }, {
    student_id: studentId,
    course_id: courseId,
    pencil_space_id: remote.spaceId,
    recovered,
  });

  const missingHosts = desiredHostIds.filter((id) => !row.host_profile_ids.includes(id));
  if (missingHosts.length > 0) row = await syncHosts(admin, row, missingHosts, { actor });
  return row;
}

/**
 * ADDITIVE host sync: make sure every id in `teacherIds` is a host of `space`
 * (`PATCH /spaces/{id}/updateUsers {addUsers:[{userId, role:'host'}]}`), then
 * update host_profile_ids / hosts_synced_at. Never removes anyone (removal is
 * the reassignment action's job, with its own checks), never adds a student or
 * parent, and tolerates "already a host" 4xx by confirming with a read-back.
 * No-op (0 calls) when all are already hosts. Audits 'pencil.space.hosts_changed'.
 */
export async function syncHosts(
  admin: Admin,
  space: PencilSpace,
  teacherIds: readonly string[],
  opts: { actor?: AuditActor } = {},
): Promise<PencilSpace> {
  const wanted = unique(teacherIds).filter((id) => !space.host_profile_ids.includes(id));
  if (wanted.length === 0) return space;

  if (!pencilLive || space.status === "mock") {
    return { ...space, host_profile_ids: [...space.host_profile_ids, ...wanted], hosts_synced_at: now() };
  }
  if (!space.pencil_space_id) throw new PencilError(0, "Space row has no Pencil id", "SPACE_NOT_PROVISIONED");

  const added: string[] = [];
  for (const id of wanted) {
    const profile = await loadProfile(admin, id);
    if (!profile || (profile.role !== "teacher" && profile.role !== "admin")) continue; // never a student/parent host
    const user = await ensurePencilUser(admin, profile, opts);
    try {
      await updateSpaceUsers(space.pencil_space_id, {
        addUsers: [{ userId: user.pencil_user_id, role: "host" }],
        notifyInvitees: false,
      });
    } catch (err) {
      // e.g. already a host on a recovered Space — accept only if the read-back agrees.
      if (!(err instanceof PencilError) || err.status < 400 || err.status >= 500) throw err;
      const remote = await getSpace(space.pencil_space_id);
      if (!(remote.hosts ?? []).some((h) => h.userId === user.pencil_user_id)) throw err;
    }
    added.push(id);
  }
  if (added.length === 0) return space;

  const { data, error } = await admin
    .from("pencil_spaces")
    .update({ host_profile_ids: unique([...space.host_profile_ids, ...added]), hosts_synced_at: now() })
    .eq("id", space.id)
    .select("*")
    .single();
  if (error) throw error;

  await logAudit(opts.actor ?? null, "pencil.space.hosts_changed", { type: "pencil_space", id: space.id }, {
    added,
    removed: [],
  });
  return data as PencilSpace;
}

// ---------------------------------------------------------------------------
// Recording policy (opt-out) — PATCH then READ BACK
// ---------------------------------------------------------------------------

export interface RecordingPolicyResult {
  /** True when `GET /spaces/{id}` confirmed `settings.disableAlwaysOnRecording === optedOut`. */
  confirmed: boolean;
  /** Updated row when confirmed; the row you passed in otherwise. */
  space: PencilSpace;
}

/**
 * Apply the student's recording policy to the Space: `PATCH /spaces/{id}/settings/
 * {settings:{disableAlwaysOnRecording: optedOut}}`, then `GET /spaces/{id}`.
 * pencil_spaces.recording_disabled / recording_verified_at are written ONLY
 * when the read-back confirms — otherwise `{confirmed:false}` and the caller
 * must refuse to mint a join URL for an opted-out student (hard stop) and
 * raise an admin follow-up. Works in Phase 1 even though institution always-on
 * recording is switched on only in Phase 2. Mock: always confirmed.
 */
export async function applyRecordingPolicy(
  admin: Admin,
  space: PencilSpace,
  optedOut: boolean,
  _opts: { actor?: AuditActor } = {},
): Promise<RecordingPolicyResult> {
  if (!pencilLive || space.status === "mock") {
    return { confirmed: true, space: { ...space, recording_disabled: optedOut, recording_verified_at: now() } };
  }
  if (!space.pencil_space_id) throw new PencilError(0, "Space row has no Pencil id", "SPACE_NOT_PROVISIONED");

  await updateSpaceSettings(space.pencil_space_id, { disableAlwaysOnRecording: optedOut });
  const remote = await getSpace(space.pencil_space_id);
  const confirmed = (remote.settings?.disableAlwaysOnRecording ?? false) === optedOut;
  if (!confirmed) return { confirmed: false, space };

  const { data, error } = await admin
    .from("pencil_spaces")
    .update({ recording_disabled: optedOut, recording_verified_at: now() })
    .eq("id", space.id)
    .select("*")
    .single();
  if (error) throw error;
  return { confirmed: true, space: data as PencilSpace };
}

/**
 * Presence of a recording_opt_outs row = "do not record". Demo mode reads
 * demoRecordingOptOuts; otherwise the DB (not gated on the Pencil key — the
 * flag is ours). Throws on a query error so the caller can show
 * "Classroom unavailable" rather than guess.
 */
export async function isRecordingOptedOut(admin: Admin, studentId: string): Promise<boolean> {
  if (isDemoMode) return demoRecordingOptOuts.some((o) => o.student_id === studentId);
  const { data, error } = await admin
    .from("recording_opt_outs")
    .select("student_id")
    .eq("student_id", studentId)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

/**
 * The join HARD STOP (design decision d): an opted-out student may not enter a
 * Space whose recording_disabled flag has not been confirmed. Check after
 * applyRecordingPolicy; when true show "Recording policy not applied — contact
 * admin", mint nothing, raise an admin follow-up.
 */
export function recordingPolicyBlocksJoin(optedOut: boolean, space: Pick<PencilSpace, "recording_disabled">): boolean {
  return optedOut && !space.recording_disabled;
}
