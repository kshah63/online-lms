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
  JOIN_FETCH,
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
  return readPencilUser(admin, profileId);
}

/**
 * Ensure `profile` has a Pencil API user; create it on first need
 * (`POST /users/createAPIUser {name, userRole, externalId: profile.id}`) and
 * store it in pencil_users. Idempotent: an existing row costs zero Pencil calls
 * on the join path (a changed display_name is pushed with a fire-and-forget
 * `PATCH /users/{id} {name}` that never delays the join). Parents never get a
 * Pencil user → PencilError 'PARENT_NOT_ALLOWED'. Audits 'pencil.user.create'
 * as `opts.actor`.
 *
 * CONVERGES under concurrency: two cold requests for the same person (teacher
 * and student opening the first lesson together, two tabs) may both create a
 * Pencil user, but only the FIRST insert is kept (`on conflict do nothing`)
 * and both callers return the stored row, so every Space is built from the
 * same id. The loser's Pencil user is orphaned and reported (users cannot be
 * looked up by externalId, so it is left for manual cleanup).
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

  const existing = await readPencilUser(admin, profile.id);
  const name = pencilDisplayName(profile);
  if (existing) {
    if (existing.pencil_name !== name) renameInBackground(admin, existing, name);
    return existing;
  }

  const userRole = pencilUserRole(profile);
  const created = await createApiUser({ name, userRole, externalId: profile.id });

  const { error: insertError } = await admin
    .from("pencil_users")
    .upsert(
      { profile_id: profile.id, pencil_user_id: created.userId, pencil_email: created.email ?? null, pencil_name: name },
      { onConflict: "profile_id", ignoreDuplicates: true },
    );
  let stored: PencilUser | null = null;
  if (!insertError) {
    try {
      stored = await readPencilUser(admin, profile.id);
    } catch {
      stored = null;
    }
  }
  if (!stored) {
    // Pencil has no externalId lookup for users: surface the id so an admin can repair.
    const why = insertError?.message ?? "row missing after insert";
    throw new PencilError(0, `Pencil user ${created.userId} created but pencil_users write failed: ${why}`, "DB_WRITE_FAILED");
  }

  if (stored.pencil_user_id !== created.userId) {
    // Lost the race: another request stored this profile's Pencil user first.
    captureError(new Error("Orphaned Pencil user after a concurrent provisioning race"), {
      where: "ensurePencilUser",
      profile_id: profile.id,
      orphaned_pencil_user_id: created.userId,
      kept_pencil_user_id: stored.pencil_user_id,
    });
    return stored;
  }

  await logAudit(opts.actor ?? null, "pencil.user.create", { type: "profile", id: profile.id }, {
    pencil_user_id: created.userId,
    userRole,
  });
  return stored;
}

async function readPencilUser(admin: Admin, profileId: string): Promise<PencilUser | null> {
  const { data, error } = await admin.from("pencil_users").select("*").eq("profile_id", profileId).maybeSingle();
  if (error) throw error;
  return (data as PencilUser | null) ?? null;
}

/**
 * display_name changed since we provisioned: tell Pencil, best effort and off
 * the join path (5 s, no retry). pencil_name is updated only on success, so a
 * failed rename is simply retried on the next join.
 */
function renameInBackground(admin: Admin, row: PencilUser, name: string): void {
  void patchUser(row.pencil_user_id, { name }, JOIN_FETCH)
    .then(async () => {
      const { error } = await admin.from("pencil_users").update({ pencil_name: name }).eq("profile_id", row.profile_id);
      if (error) throw error;
    })
    .catch((err: unknown) => captureError(err, { where: "ensurePencilUser rename", profile_id: row.profile_id }));
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
  /** How long a request that lost the provisioning race waits for the winner (default 20 s). */
  waitMs?: number;
  /** Poll interval while waiting (default 750 ms). */
  pollMs?: number;
}

/** A crashed provisioner's claim expires after this; findSpaceByExternalId makes the retry safe. */
const PROVISION_LEASE_MS = 90_000;
const PROVISION_WAIT_MS = 20_000;
const PROVISION_POLL_MS = 750;

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/** Read-only: the pencil_spaces row for a pair, or null (mock row when Pencil is mocked). */
export async function getSpaceForPair(admin: Admin, studentId: string, courseId: string): Promise<PencilSpace | null> {
  if (!pencilLive) return mockSpace({ studentId, courseId });
  return readSpaceRow(admin, studentId, courseId);
}

async function readSpaceRow(admin: Admin, studentId: string, courseId: string): Promise<PencilSpace | null> {
  const { data, error } = await admin
    .from("pencil_spaces")
    .select("*")
    .eq("student_id", studentId)
    .eq("course_id", courseId)
    .maybeSingle();
  if (error) throw error;
  return (data as PencilSpace | null) ?? null;
}

function isProvisioned(row: PencilSpace): boolean {
  return Boolean(row.pencil_space_id) && row.status !== "mock";
}

/**
 * Ensure the persistent Space for (student, course) exists and return its row.
 *  - an 'active'/'archived' row with a pencil_space_id → returned as is (0 calls);
 *  - otherwise (no row, or a 'mock' row from seed) this request first CLAIMS the
 *    pair (a placeholder 'mock' row inserted with `on conflict do nothing`, or a
 *    compare-and-swap on `provision_lock_until`), so concurrent first joins
 *    never create duplicate users or Spaces; a request that loses the claim
 *    polls for the winner's row and gives up with a transient
 *    'PROVISIONING_IN_PROGRESS' after `waitMs`;
 *  - the claim holder provisions Pencil users for the student, the assigned
 *    teacher and an admin actor; RECOVERS an existing Space via
 *    `GET /spaces?filters{externalId}` before `POST /spaces/create`
 *    (externalId '<course>:<student>', title '<course> · <first name>', private,
 *    notifyInvitees false, hosts = teacher (+ admin actor), participants =
 *    student) — and again if create reports the externalId is taken; makes sure
 *    the student's CURRENT Pencil user is a participant of a recovered Space;
 *    upgrades the row in place (same id) and releases the claim; missing hosts
 *    are added via syncHosts. Audits 'pencil.space.create' {recovered}.
 */
export async function ensureSpace(admin: Admin, input: EnsureSpaceInput): Promise<PencilSpace> {
  const { studentId, courseId, teacherId = null, actor = null } = input;
  if (!pencilLive) return mockSpace({ studentId, courseId, teacherId });

  const externalId = spaceExternalId(courseId, studentId);
  const pollMs = input.pollMs ?? PROVISION_POLL_MS;
  const deadline = Date.now() + (input.waitMs ?? PROVISION_WAIT_MS);
  for (;;) {
    const current = await readSpaceRow(admin, studentId, courseId);
    if (current && isProvisioned(current)) return current;

    const claimed = await claimProvisioning(admin, current, { studentId, courseId, externalId });
    if (claimed) {
      try {
        return await provisionClaimedSpace(admin, claimed, { studentId, courseId, teacherId, actor, externalId });
      } catch (err) {
        await releaseProvisioning(admin, claimed);
        throw err;
      }
    }

    const left = deadline - Date.now();
    if (left <= 0) {
      throw new PencilError(0, "Another request is still preparing this classroom", "PROVISIONING_IN_PROGRESS");
    }
    await sleep(Math.min(pollMs, left));
  }
}

/**
 * Take the per-pair provisioning lease. Returns the claimed row, or null when
 * another request holds a live lease (or won the race to insert/claim).
 */
async function claimProvisioning(
  admin: Admin,
  current: PencilSpace | null,
  pair: { studentId: string; courseId: string; externalId: string },
): Promise<PencilSpace | null> {
  const leaseUntil = new Date(Date.now() + PROVISION_LEASE_MS).toISOString();

  if (!current) {
    // Placeholder row = "not provisioned yet" (same meaning as a seeded mock row).
    const { data, error } = await admin
      .from("pencil_spaces")
      .upsert(
        {
          student_id: pair.studentId,
          course_id: pair.courseId,
          external_id: pair.externalId,
          status: "mock",
          provision_lock_until: leaseUntil,
        },
        { onConflict: "student_id,course_id", ignoreDuplicates: true },
      )
      .select("*");
    if (error) throw error;
    return ((data ?? []) as PencilSpace[])[0] ?? null; // empty → someone else inserted first
  }

  const lock = current.provision_lock_until ?? null;
  if (lock && Date.parse(lock) > Date.now()) return null; // live lease held elsewhere

  let claim = admin
    .from("pencil_spaces")
    .update({ provision_lock_until: leaseUntil })
    .eq("id", current.id)
    .is("pencil_space_id", null); // a winner's finished row never matches
  claim = lock ? claim.eq("provision_lock_until", lock) : claim.is("provision_lock_until", null);
  const { data, error } = await claim.select("*");
  if (error) throw error;
  return ((data ?? []) as PencilSpace[])[0] ?? null;
}

/** Best effort: let the next request retry at once instead of waiting out the lease. */
async function releaseProvisioning(admin: Admin, claimed: PencilSpace): Promise<void> {
  try {
    const { error } = await admin
      .from("pencil_spaces")
      .update({ provision_lock_until: null })
      .eq("id", claimed.id)
      .is("pencil_space_id", null);
    if (error) throw error;
  } catch (err) {
    captureError(err, { where: "ensureSpace release lease", space_id: claimed.id });
  }
}

async function provisionClaimedSpace(
  admin: Admin,
  claimed: PencilSpace,
  input: { studentId: string; courseId: string; teacherId: string | null; actor: AuditActor; externalId: string },
): Promise<PencilSpace> {
  const { studentId, courseId, teacherId, actor, externalId } = input;

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

  const title = spaceTitle(course.name, student);

  let remote: PencilApiSpace | null = await findSpaceByExternalId(externalId);
  let recovered = remote !== null;
  if (!remote) {
    try {
      remote = await createSpace({
        title,
        hosts: hostUsers.map((u) => ({ userId: u.pencil_user_id })),
        participants: [{ userId: studentUser.pencil_user_id }],
        visibility: "private",
        notifyInvitees: false,
        externalId,
      });
    } catch (err) {
      // "externalId must be unique": created meanwhile (or a create whose
      // response we never saw). Look it up once more instead of failing.
      if (!(err instanceof PencilError) || err.status < 400 || err.status >= 500) throw err;
      remote = await findSpaceByExternalId(externalId);
      if (!remote) throw err;
      recovered = true;
    }
  }

  if (recovered) {
    // A list item may omit members/settings — read the Space itself before trusting them.
    if (!remote.hosts || !remote.participants) remote = await getSpace(remote.spaceId);
    // A failed DB write or a lost race can leave a Space whose participant is an
    // orphaned Pencil user: make the student's CURRENT user a participant.
    const members = [...(remote.participants ?? []), ...(remote.hosts ?? [])].map((u) => u.userId);
    if (remote.participants && !members.includes(studentUser.pencil_user_id)) {
      await updateSpaceUsers(remote.spaceId, {
        addUsers: [{ userId: studentUser.pencil_user_id, role: "participant" }],
        notifyInvitees: false,
      });
    }
  }

  // Which of OUR profiles are hosts on the Pencil side right now.
  const desiredHostIds = hostProfiles.map((h) => h.id);
  const hostProfileIds = remote.hosts
    ? await profileIdsForPencilUsers(admin, remote.hosts.map((h) => h.userId))
    : desiredHostIds;

  const ts = now();
  const { data: saved, error: saveError } = await admin
    .from("pencil_spaces")
    .update({
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
      provision_lock_until: null,
    })
    .eq("id", claimed.id)
    .select("*")
    .single();
  if (saveError) {
    throw new PencilError(0, `Space ${remote.spaceId} exists at Pencil but pencil_spaces write failed: ${saveError.message}`, "DB_WRITE_FAILED");
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
 * removeHosts(), called by the reassignment action after its own checks), never
 * adds a student or parent, and tolerates "already a host" 4xx by confirming
 * with a read-back.
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

/**
 * Take `profileIds` out of the Space (`PATCH /spaces/{id}/updateUsers
 * {removeUsers:[{userId}]}`) and out of host_profile_ids (decision g). The
 * CALLER decides who may lose their seat — assignTeacher removes the previous
 * teacher only when they have no remaining non-cancelled session and no open
 * homework for the pair. Ids that are not cached hosts are ignored; a profile
 * with no Pencil user is just dropped from the cache. A 4xx is tolerated iff a
 * read-back shows the user is no longer in the Space. Audits
 * 'pencil.space.hosts_changed' {added: [], removed}.
 */
export async function removeHosts(
  admin: Admin,
  space: PencilSpace,
  profileIds: readonly string[],
  opts: { actor?: AuditActor } = {},
): Promise<PencilSpace> {
  const doomed = unique(profileIds).filter((id) => space.host_profile_ids.includes(id));
  if (doomed.length === 0) return space;

  if (!pencilLive || space.status === "mock") {
    return { ...space, host_profile_ids: space.host_profile_ids.filter((id) => !doomed.includes(id)), hosts_synced_at: now() };
  }
  if (!space.pencil_space_id) throw new PencilError(0, "Space row has no Pencil id", "SPACE_NOT_PROVISIONED");

  for (const id of doomed) {
    const user = await readPencilUser(admin, id);
    if (!user) continue; // never entered Pencil: nothing to revoke there
    try {
      await updateSpaceUsers(space.pencil_space_id, { removeUsers: [{ userId: user.pencil_user_id }], notifyInvitees: false });
    } catch (err) {
      if (!(err instanceof PencilError) || err.status < 400 || err.status >= 500) throw err;
      const remote = await getSpace(space.pencil_space_id);
      const stillIn = [...(remote.hosts ?? []), ...(remote.participants ?? [])].some((u) => u.userId === user.pencil_user_id);
      if (stillIn) throw err;
    }
  }

  const { data, error } = await admin
    .from("pencil_spaces")
    .update({ host_profile_ids: space.host_profile_ids.filter((id) => !doomed.includes(id)), hosts_synced_at: now() })
    .eq("id", space.id)
    .select("*")
    .single();
  if (error) throw error;

  await logAudit(opts.actor ?? null, "pencil.space.hosts_changed", { type: "pencil_space", id: space.id }, {
    added: [],
    removed: doomed,
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
 * Before minting a join URL: make the Space's recording setting match the
 * student's policy (decisions a + d).
 *  - The cached flag disagrees with the policy (either direction) →
 *    applyRecordingPolicy (PATCH + read-back). Re-enabling recording is best
 *    effort: a Pencil error there is reported, never a reason to refuse a join.
 *  - Opted out and cached as disabled → ONE `GET /spaces/{id}` (5 s, no retry)
 *    to catch drift at Pencil (the setting flipped in Pencil's own UI). On
 *    drift the row is corrected from that read FIRST, then the policy is
 *    re-applied, so an unconfirmed re-apply leaves the hard stop on.
 *  - Not opted out and cached as enabled → nothing (a warm join stays one call).
 * The caller still runs recordingPolicyBlocksJoin() on the returned row.
 */
export async function ensureRecordingPolicy(
  admin: Admin,
  space: PencilSpace,
  optedOut: boolean,
  opts: { actor?: AuditActor } = {},
): Promise<RecordingPolicyResult> {
  if (space.recording_disabled !== optedOut) {
    if (optedOut) return applyRecordingPolicy(admin, space, true, opts);
    try {
      return await applyRecordingPolicy(admin, space, false, opts);
    } catch (err) {
      captureError(err, { where: "ensureRecordingPolicy re-enable", space_id: space.id });
      return { confirmed: false, space };
    }
  }
  if (!optedOut || !pencilLive || space.status === "mock") return { confirmed: true, space };
  if (!space.pencil_space_id) throw new PencilError(0, "Space row has no Pencil id", "SPACE_NOT_PROVISIONED");

  const remote = await getSpace(space.pencil_space_id, JOIN_FETCH);
  if (remote.settings?.disableAlwaysOnRecording === true) return { confirmed: true, space };

  captureError(new Error("Recording opt-out drifted at Pencil (disableAlwaysOnRecording is off)"), {
    where: "ensureRecordingPolicy",
    space_id: space.id,
  });
  const { data, error } = await admin
    .from("pencil_spaces")
    .update({ recording_disabled: false, recording_verified_at: now() })
    .eq("id", space.id)
    .select("*")
    .single();
  if (error) throw error;
  return applyRecordingPolicy(admin, data as PencilSpace, true, opts);
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
