import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Profile, SessionView } from "@/lib/types";
import { FakeDb, type Row } from "./helpers/fake-db";
import { json, pencilServer } from "./helpers/pencil-server";

// endLesson (decision b/n) and assignTeacher (decision g) are server actions:
// the outcome write must be single-shot and teacher-scoped and makes no Pencil
// call (endOngoingSession ends only the analytics session — Pencil support,
// 2026-10-16), and a reassignment moves the
// Space's host seats (add the new teacher, remove the previous one only when
// they have nothing left with this pair). Pencil is faked at fetch; both the
// cookie client and the service-role client are the in-memory FakeDb (RLS and
// the 0017 session guard are covered by tests/session-guard.sql).

const state = vi.hoisted(() => ({
  profile: null as Profile | null,
  session: null as SessionView | null,
  db: null as unknown,
}));

vi.mock("@/lib/env", () => ({
  isDemoMode: false,
  isSupabaseConfigured: true,
  isMisconfigured: false,
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_ANON_KEY: "anon",
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(async () => {}) }));
vi.mock("@/lib/observability", () => ({ captureError: vi.fn() }));
vi.mock("@/lib/data/auth", () => ({ getCurrentProfile: vi.fn(async () => state.profile) }));
vi.mock("@/lib/data/sessions", () => ({ getSessionById: vi.fn(async () => state.session) }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn(() => state.db) }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: vi.fn(() => state.db) }));

// --- fixtures ---------------------------------------------------------------

const ADMIN = "00000000-0000-0000-0000-000000000001";
const TEACHER = "00000000-0000-0000-0000-0000000000a1";
const NEW_TEACHER = "00000000-0000-0000-0000-0000000000a2";
const STUDENT = "00000000-0000-0000-0000-0000000000b1";
const COURSE = "10000000-0000-0000-0000-000000000001";
const SESSION = "20000000-0000-0000-0000-000000000099";
const OTHER_SESSION = "20000000-0000-0000-0000-000000000098";
const SPACE_ID = "aaaaaaaaaaaaaaaaaaaaaaaa";

function profile(id: string, role: Profile["role"], display_name: string): Profile {
  return {
    id, role, display_name, email: `${display_name.split(" ")[0]!.toLowerCase()}@lessons.dev`, phone: null, avatar_url: null,
    timezone: "Asia/Singapore", whatsapp_opt_in: true, created_at: "2026-01-01T00:00:00.000Z",
  };
}
const teacherProfile = profile(TEACHER, "teacher", "Maya Chen");
const newTeacherProfile = profile(NEW_TEACHER, "teacher", "Daniel Okafor");
const studentProfile = profile(STUDENT, "student", "Aarav Sharma");
const adminProfile = profile(ADMIN, "admin", "Admin Office");

function sessionView(over: Partial<SessionView> = {}): SessionView {
  return {
    id: SESSION, course_id: COURSE, student_id: STUDENT, teacher_id: TEACHER,
    scheduled_start: "2026-10-15T01:00:00.000Z", scheduled_end: "2026-10-15T02:00:00.000Z",
    actual_start: "2026-10-15T01:02:00.000Z", actual_end: null, status: "in_progress", video_room_id: null, recording_url: null,
    notebook_id: null, series_id: null, agenda: null, cancel_reason: null,
    space_id: "space-row-1", pencil_session_id: null, analysis_status: "none", fallback_join_url: null,
    created_at: "2026-10-01T00:00:00.000Z",
    course: { id: COURSE, name: "IGCSE Mathematics", subject: "Mathematics", materials_course_id: null },
    student: { id: STUDENT, display_name: "Aarav Sharma", timezone: "Asia/Singapore", avatar_url: null },
    teacher: { id: TEACHER, display_name: "Maya Chen", timezone: "Asia/Singapore", avatar_url: null },
    ...over,
  };
}

function sessionRow(over: Row = {}): Row {
  return { id: SESSION, student_id: STUDENT, course_id: COURSE, teacher_id: TEACHER, status: "in_progress", analysis_status: "none", actual_end: null, pencil_session_id: null, ...over };
}

function seed(db: FakeDb, sessionOver: Row = {}) {
  db.tables.profiles = [teacherProfile, newTeacherProfile, studentProfile, adminProfile].map((p) => ({ ...p }));
  db.tables.sessions = [sessionRow(sessionOver)];
  db.tables.homework = [];
  db.tables.pencil_users = [
    { profile_id: TEACHER, pencil_user_id: "u-teacher", pencil_email: null, pencil_name: "Maya Chen", created_at: "2026-10-01T00:00:00.000Z" },
    { profile_id: NEW_TEACHER, pencil_user_id: "u-new", pencil_email: null, pencil_name: "Daniel Okafor", created_at: "2026-10-01T00:00:00.000Z" },
    { profile_id: STUDENT, pencil_user_id: "u-student", pencil_email: null, pencil_name: "Aarav", created_at: "2026-10-01T00:00:00.000Z" },
  ];
  db.tables.pencil_spaces = [{
    id: "space-row-1", student_id: STUDENT, course_id: COURSE, external_id: `${COURSE}:${STUDENT}`,
    pencil_space_id: SPACE_ID, link: `https://my.pencilapp.com/spaces/${SPACE_ID}`, title: "IGCSE Mathematics · Aarav",
    host_profile_ids: [TEACHER], participant_profile_ids: [STUDENT], hosts_synced_at: null,
    recording_disabled: false, recording_verified_at: null, status: "active",
  }];
  db.tables.pencil_sessions = [];
}

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

// ============================================================================

describe("endLesson / assignTeacher — Pencil live", () => {
  let actions: typeof import("@/lib/actions/sessions");
  let audit: typeof import("@/lib/audit");
  let observability: typeof import("@/lib/observability");
  let db: FakeDb;

  beforeAll(async () => {
    vi.resetModules();
    vi.stubEnv("PENCIL_SPACES_API_KEY", "test-key");
    vi.stubEnv("PENCIL_API_BASE_URL", "https://pencil.test/public/api");
    vi.stubEnv("LESSON_FALLBACK_MODE", "");
    actions = await import("@/lib/actions/sessions");
    audit = await import("@/lib/audit");
    observability = await import("@/lib/observability");
  });

  beforeEach(() => {
    db = new FakeDb();
    seed(db);
    state.db = db;
    state.profile = teacherProfile;
    state.session = sessionView();
    vi.mocked(audit.logAudit).mockClear();
    vi.mocked(observability.captureError).mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.stubEnv("LESSON_FALLBACK_MODE", "");
  });

  afterAll(() => {
    vi.unstubAllEnvs();
  });

  const audited = () => vi.mocked(audit.logAudit).mock.calls.map((c) => c[1]);

  // ----- endLesson -----------------------------------------------------------

  it("completed: writes the outcome once and makes no Pencil call", async () => {
    const { calls } = pencilServer({});
    const res = await actions.endLesson(SESSION, "completed");
    expect(res).toMatchObject({ ok: true, outcome: "completed" });
    expect(db.tables.sessions[0]).toMatchObject({ status: "completed", analysis_status: "none", pencil_session_id: null });
    expect(db.tables.sessions[0]!.actual_end).toBe(res.actual_end);

    // Pencil support, 2026-10-16: endOngoingSession ends only the analytics
    // session — not the call, not the recording — and immediately opens a new
    // one for anyone still in the Space. Pencil closes the session itself six
    // minutes after the last participant leaves or becomes inactive, so End leaves Pencil alone and the
    // rooms close themselves (lesson-room polls /api/lesson/[id]/status).
    expect(calls).toHaveLength(0);
    expect(db.tables.pencil_sessions).toHaveLength(0);
    expect(audited()).toEqual(["lesson.end"]);

    // A second End (other tab) changes nothing.
    state.session = sessionView({ status: "completed" });
    const again = await actions.endLesson(SESSION, "completed");
    expect(again).toMatchObject({ ok: false, message: "This lesson was already ended." });
    expect(calls).toHaveLength(0);
    expect(audited()).toEqual(["lesson.end"]);
  });

  it("only live lessons can be ended: a no-show (stale page says in_progress) is never re-ended or flipped to completed", async () => {
    const { calls } = pencilServer({});
    seed(db, { status: "no_show" });
    const res = await actions.endLesson(SESSION, "completed");
    expect(res).toMatchObject({ ok: false, message: "This lesson was already ended." });
    expect(db.tables.sessions[0]!.status).toBe("no_show");
    expect(calls).toHaveLength(0);
    expect(audited()).toEqual([]);
  });

  it("the teacher_id filter re-applies the rule: a stale page can't end a lesson reassigned to someone else", async () => {
    const { calls } = pencilServer({});
    seed(db, { teacher_id: NEW_TEACHER }); // reassigned after the page loaded
    const res = await actions.endLesson(SESSION, "completed");
    expect(res.ok).toBe(false);
    expect(db.tables.sessions[0]!.status).toBe("in_progress");
    expect(calls).toHaveLength(0);
  });

  it("only the assigned teacher or an admin may end it", async () => {
    pencilServer({});
    state.profile = newTeacherProfile;
    expect((await actions.endLesson(SESSION, "completed")).ok).toBe(false);
    state.profile = studentProfile;
    expect((await actions.endLesson(SESSION, "completed")).ok).toBe(false);
    expect(db.tables.sessions[0]!.status).toBe("in_progress");
  });

  it("no_show: the same single write, no Pencil call, nothing sent to Sentry", async () => {
    const { calls } = pencilServer({});
    state.session = sessionView({ status: "confirmed", actual_start: null });
    seed(db, { status: "confirmed" });
    const res = await actions.endLesson(SESSION, "no_show");
    expect(res).toMatchObject({ ok: true, outcome: "no_show" });
    expect(db.tables.sessions[0]!.status).toBe("no_show");
    expect(calls).toHaveLength(0);
    expect(db.tables.pencil_sessions).toHaveLength(0);
    expect(vi.mocked(observability.captureError)).not.toHaveBeenCalled();
    expect(audited()).toEqual(["lesson.no_show"]);
  });

  it("startSessionClock never revives a lesson already ended in another room", async () => {
    pencilServer({});
    for (const status of ["no_show", "completed", "cancelled"]) {
      seed(db, { status, actual_start: null });
      expect(await actions.startSessionClock(SESSION)).toEqual({ actual_start: null });
      expect(db.tables.sessions[0]).toMatchObject({ status, actual_start: null });
    }
    seed(db, { status: "confirmed", actual_start: null });
    const r = await actions.startSessionClock(SESSION);
    expect(db.tables.sessions[0]).toMatchObject({ status: "in_progress", actual_start: r.actual_start });
  });

  it("Zoom fallback: marks analysis_status='no_recording' and skips Pencil entirely", async () => {
    const { calls } = pencilServer({});
    const res = await actions.endLesson(SESSION, "completed", { usedFallback: true });
    expect(res.ok).toBe(true);
    expect(db.tables.sessions[0]).toMatchObject({ status: "completed", analysis_status: "no_recording" });
    expect(calls).toHaveLength(0);
    expect(vi.mocked(audit.logAudit).mock.calls[0]![3]).toMatchObject({ no_recording: true });
  });

  it("LESSON_FALLBACK_MODE=on behaves the same; an analysis_status the pipeline already set is left alone", async () => {
    vi.stubEnv("LESSON_FALLBACK_MODE", "on");
    const { calls } = pencilServer({});
    state.session = sessionView({ analysis_status: "pending" });
    seed(db, { analysis_status: "pending" });
    const res = await actions.endLesson(SESSION, "completed");
    expect(res.ok).toBe(true);
    expect(db.tables.sessions[0]).toMatchObject({ status: "completed", analysis_status: "pending" });
    expect(calls).toHaveLength(0);
  });

  // ----- assignTeacher -------------------------------------------------------

  it("refuses a lesson that has started or is over, and says so", async () => {
    const { calls } = pencilServer({});
    state.profile = adminProfile;
    for (const status of ["in_progress", "completed", "no_show", "cancelled"]) {
      seed(db, { status });
      const res = await actions.assignTeacher(form({ session_id: SESSION, teacher_id: NEW_TEACHER }));
      expect(res.ok).toBe(false);
      expect(res.message).toMatch(status === "in_progress" || status === "completed" ? /cancel and rebook/ : /over/);
      expect(db.tables.sessions[0]!.teacher_id).toBe(TEACHER);
    }
    expect(calls).toHaveLength(0);
  });

  it("only admins may assign", async () => {
    pencilServer({});
    seed(db, { status: "confirmed" });
    state.profile = teacherProfile;
    const res = await actions.assignTeacher(form({ session_id: SESSION, teacher_id: NEW_TEACHER }));
    expect(res.ok).toBe(false);
    expect(db.tables.sessions[0]!.teacher_id).toBe(TEACHER);
  });

  it("reassignment seats the new teacher and removes the previous one when they have nothing left with the pair", async () => {
    seed(db, { status: "confirmed" });
    state.profile = adminProfile;
    const { calls } = pencilServer({
      [`PATCH spaces/${SPACE_ID}/updateUsers`]: () => json({ spaceId: SPACE_ID, link: `https://my.pencilapp.com/spaces/${SPACE_ID}` }),
    });
    const res = await actions.assignTeacher(form({ session_id: SESSION, teacher_id: NEW_TEACHER }));
    expect(res).toMatchObject({ ok: true, message: "Teacher reassigned." });
    expect(res.warning).toBeUndefined();
    expect(db.tables.sessions[0]).toMatchObject({ teacher_id: NEW_TEACHER, status: "confirmed" });

    expect(calls.map((c) => c.body)).toEqual([
      { notifyInvitees: false, addUsers: [{ userId: "u-new", role: "host" }] },
      { notifyInvitees: false, removeUsers: [{ userId: "u-teacher" }] },
    ]);
    expect(db.tables.pencil_spaces[0]!.host_profile_ids).toEqual([NEW_TEACHER]);
    const hostAudits = vi.mocked(audit.logAudit).mock.calls.filter((c) => c[1] === "pencil.space.hosts_changed").map((c) => c[3]);
    expect(hostAudits).toEqual([{ added: [NEW_TEACHER], removed: [] }, { added: [], removed: [TEACHER] }]);
    expect(audited()).toContain("session.assign_teacher");
  });

  it("keeps the previous teacher's seat while they still teach this pair or have open homework from it", async () => {
    state.profile = adminProfile;

    // (a) another non-cancelled lesson with the same student + course
    seed(db, { status: "confirmed" });
    db.tables.sessions.push(sessionRow({ id: OTHER_SESSION, status: "completed" }));
    let server = pencilServer({ [`PATCH spaces/${SPACE_ID}/updateUsers`]: () => json({ spaceId: SPACE_ID, link: "https://my.pencilapp.com/spaces/x" }) });
    await actions.assignTeacher(form({ session_id: SESSION, teacher_id: NEW_TEACHER }));
    expect(server.calls.map((c) => Object.keys(c.body ?? {}))).toEqual([["notifyInvitees", "addUsers"]]);
    expect(db.tables.pencil_spaces[0]!.host_profile_ids).toEqual([TEACHER, NEW_TEACHER]);

    // (b) only a cancelled lesson left, but its homework is still waiting to be graded
    vi.unstubAllGlobals();
    seed(db, { status: "confirmed" });
    db.tables.sessions.push(sessionRow({ id: OTHER_SESSION, status: "cancelled" }));
    db.tables.homework = [{ id: "hw-1", session_id: OTHER_SESSION, student_id: STUDENT, course_id: COURSE, status: "submitted" }];
    server = pencilServer({ [`PATCH spaces/${SPACE_ID}/updateUsers`]: () => json({ spaceId: SPACE_ID, link: "https://my.pencilapp.com/spaces/x" }) });
    await actions.assignTeacher(form({ session_id: SESSION, teacher_id: NEW_TEACHER }));
    expect(server.calls).toHaveLength(1); // add only
    expect(db.tables.pencil_spaces[0]!.host_profile_ids).toEqual([TEACHER, NEW_TEACHER]);
  });

  it("a Pencil failure never fails the assignment — it comes back as a warning", async () => {
    seed(db, { status: "scheduled", teacher_id: null });
    state.profile = adminProfile;
    pencilServer({
      [`PATCH spaces/${SPACE_ID}/updateUsers`]: () => json({ err: "bad key", error_code: "NOT_AUTHORIZED" }, 401),
      // syncHosts' read-back: the new teacher is not a host → the 401 stands.
      [`GET spaces/${SPACE_ID}`]: () => json({ spaceId: SPACE_ID, link: "https://my.pencilapp.com/spaces/x", hosts: [{ userId: "u-teacher" }] }),
    });
    const res = await actions.assignTeacher(form({ session_id: SESSION, teacher_id: NEW_TEACHER }));
    expect(res.ok).toBe(true);
    expect(res.warning).toMatch(/could not be updated in Pencil/);
    expect(db.tables.sessions[0]).toMatchObject({ teacher_id: NEW_TEACHER, status: "confirmed" });
    expect(vi.mocked(observability.captureError)).toHaveBeenCalled();
  });
});
