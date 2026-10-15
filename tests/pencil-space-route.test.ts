import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Profile, SessionView } from "@/lib/types";
import { FakeDb, type Row } from "./helpers/fake-db";
import { json, pencilServer, type Call } from "./helpers/pencil-server";

// POST /api/lesson/[id]/space is the ONLY place a join URL is minted for the
// web lesson room, so the access rule, the parent exclusion, the ended/forced/
// rate-limited answers, the recording-policy hard stop, the fallback link and
// "the url never lands in audit or Sentry" are all asserted here. Pencil is
// faked at the fetch boundary; the service-role client is the in-memory FakeDb.

const state = vi.hoisted(() => ({
  profile: null as Profile | null,
  session: null as SessionView | null,
  children: [] as Profile[],
  admin: null as unknown,
  rateLimitAllowed: true,
}));

vi.mock("@/lib/env", () => ({
  isDemoMode: false,
  isSupabaseConfigured: true,
  isMisconfigured: false,
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_ANON_KEY: "anon",
}));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(async () => {}) }));
vi.mock("@/lib/observability", () => ({ captureError: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({
  LIMITS: { pencilJoin: { limit: 30, windowSeconds: 3600 } },
  rateLimit: vi.fn(async () => state.rateLimitAllowed),
}));
vi.mock("@/lib/data/auth", () => ({ getCurrentProfile: vi.fn(async () => state.profile) }));
vi.mock("@/lib/data/sessions", () => ({ getSessionById: vi.fn(async () => state.session) }));
vi.mock("@/lib/data/people", () => ({
  getChildren: vi.fn(async (p: Profile) => (p.role === "student" ? [p] : p.role === "parent" ? state.children : [])),
}));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: vi.fn(() => state.admin) }));

// --- fixtures ---------------------------------------------------------------

const ADMIN = "00000000-0000-0000-0000-000000000001";
const TEACHER = "00000000-0000-0000-0000-0000000000a1";
const OTHER_TEACHER = "00000000-0000-0000-0000-0000000000a2";
const STUDENT = "00000000-0000-0000-0000-0000000000b1";
const OTHER_STUDENT = "00000000-0000-0000-0000-0000000000b2";
const PARENT = "00000000-0000-0000-0000-0000000000c1";
const COURSE = "10000000-0000-0000-0000-000000000001";
const SESSION = "20000000-0000-0000-0000-000000000099";
const SPACE_ID = "aaaaaaaaaaaaaaaaaaaaaaaa";
const SPACE_LINK = `https://my.pencilapp.com/spaces/${SPACE_ID}`;
const MASTER_ZOOM = "https://us02web.zoom.us/j/5550001111?pwd=school";
const TOKEN = "SUPER-SECRET-TOKEN";
const TOKEN_URL = `https://my.pencilapp.com/spaces/${SPACE_ID}?loginMethod=token&loginType=api&token=${TOKEN}`;

function profile(id: string, role: Profile["role"], display_name: string): Profile {
  return {
    id, role, display_name, email: `${display_name.split(" ")[0]!.toLowerCase()}@lessons.dev`, phone: null, avatar_url: null,
    timezone: "Asia/Singapore", whatsapp_opt_in: true, created_at: "2026-01-01T00:00:00.000Z",
  };
}
const teacherProfile = profile(TEACHER, "teacher", "Maya Chen");
const otherTeacherProfile = profile(OTHER_TEACHER, "teacher", "Daniel Okafor");
const studentProfile = profile(STUDENT, "student", "Aarav Sharma");
const otherStudentProfile = profile(OTHER_STUDENT, "student", "Sofia Rossi");
const adminProfile = profile(ADMIN, "admin", "Admin Office");
const parentProfile = profile(PARENT, "parent", "Priya Sharma");

function sessionView(over: Partial<SessionView> = {}): SessionView {
  return {
    id: SESSION, course_id: COURSE, student_id: STUDENT, teacher_id: TEACHER,
    scheduled_start: "2026-10-15T01:00:00.000Z", scheduled_end: "2026-10-15T02:00:00.000Z",
    actual_start: null, actual_end: null, status: "confirmed", video_room_id: null, recording_url: null,
    notebook_id: null, series_id: null, agenda: null, cancel_reason: null,
    space_id: null, pencil_session_id: null, analysis_status: "none", fallback_join_url: null,
    created_at: "2026-10-01T00:00:00.000Z",
    course: { id: COURSE, name: "IGCSE Mathematics", subject: "Mathematics", materials_course_id: null },
    student: { id: STUDENT, display_name: "Aarav Sharma", timezone: "Asia/Singapore", avatar_url: null },
    teacher: { id: TEACHER, display_name: "Maya Chen", timezone: "Asia/Singapore", avatar_url: null },
    ...over,
  };
}

/** A provisioned ('active') pencil_spaces row — the warm-join case. */
function activeSpaceRow(over: Row = {}): Row {
  return {
    id: "space-row-1", student_id: STUDENT, course_id: COURSE, external_id: `${COURSE}:${STUDENT}`,
    pencil_space_id: SPACE_ID, link: SPACE_LINK, title: "IGCSE Mathematics · Aarav",
    host_profile_ids: [TEACHER], participant_profile_ids: [STUDENT], hosts_synced_at: "2026-10-01T00:00:00.000Z",
    recording_disabled: false, recording_verified_at: null, status: "active",
    created_at: "2026-10-01T00:00:00.000Z", updated_at: "2026-10-01T00:00:00.000Z",
    ...over,
  };
}

const pencilSpace = (over: Row = {}) => ({
  spaceId: SPACE_ID, link: SPACE_LINK, title: "IGCSE Mathematics · Aarav", visibility: "private",
  hosts: [{ userId: "u-teacher" }], participants: [{ userId: "u-student" }], archived: false,
  externalId: `${COURSE}:${STUDENT}`, settings: { disableAlwaysOnRecording: false, enableWaitingRoom: false },
  ...over,
});

type RouteModule = typeof import("@/app/api/lesson/[sessionId]/space/route");

async function post(route: RouteModule, body: Row = { purpose: "lesson", mode: "iframe" }) {
  const req = new Request(`https://app.test/api/lesson/${SESSION}/space`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const res = await route.POST(req, { params: { sessionId: SESSION } });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

function seedDb(db: FakeDb) {
  db.tables.profiles = [teacherProfile, otherTeacherProfile, studentProfile, otherStudentProfile, adminProfile, parentProfile].map((p) => ({ ...p }));
  db.tables.courses = [{ id: COURSE, name: "IGCSE Mathematics" }];
  db.tables.pencil_users = [];
  db.tables.pencil_spaces = [];
  db.tables.recording_opt_outs = [];
  db.tables.followups = [];
  db.tables.sessions = [{ id: SESSION, student_id: STUDENT, course_id: COURSE, teacher_id: TEACHER, space_id: null }];
}

function seedWarmPair(db: FakeDb) {
  db.tables.pencil_users = [
    { profile_id: TEACHER, pencil_user_id: "u-teacher", pencil_email: null, pencil_name: "Maya Chen", created_at: "2026-10-01T00:00:00.000Z" },
    { profile_id: STUDENT, pencil_user_id: "u-student", pencil_email: null, pencil_name: "Aarav", created_at: "2026-10-01T00:00:00.000Z" },
  ];
  db.tables.pencil_spaces = [activeSpaceRow()];
}

/** Every string that left the route towards audit/Sentry. */
function recorded(audit: typeof import("@/lib/audit"), observability: typeof import("@/lib/observability")): string {
  return JSON.stringify([vi.mocked(audit.logAudit).mock.calls, vi.mocked(observability.captureError).mock.calls]);
}

function authorizeOk(calls: Call[]) {
  return calls.filter((c) => c.method === "GET" && /^users\/[^/]+\/authorize\?/.test(c.path));
}

// ============================================================================

describe("POST /api/lesson/[id]/space — Pencil live", () => {
  let route: RouteModule;
  let audit: typeof import("@/lib/audit");
  let observability: typeof import("@/lib/observability");
  let db: FakeDb;

  beforeAll(async () => {
    vi.resetModules();
    vi.stubEnv("PENCIL_SPACES_API_KEY", "test-key");
    vi.stubEnv("PENCIL_API_BASE_URL", "https://pencil.test/public/api");
    vi.stubEnv("LESSON_FALLBACK_URL", MASTER_ZOOM);
    vi.stubEnv("LESSON_FALLBACK_MODE", "");
    route = await import("@/app/api/lesson/[sessionId]/space/route");
    audit = await import("@/lib/audit");
    observability = await import("@/lib/observability");
  });

  beforeEach(() => {
    db = new FakeDb();
    seedDb(db);
    state.admin = db;
    state.profile = teacherProfile;
    state.session = sessionView();
    state.children = [];
    state.rateLimitAllowed = true;
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

  it("re-applies the lesson access rule: unassigned teacher, other student, nobody → 401/403, no Pencil call", async () => {
    const { calls } = pencilServer({});

    state.profile = null;
    expect((await post(route)).status).toBe(401);

    state.profile = otherTeacherProfile;
    expect((await post(route)).status).toBe(403);

    state.profile = otherStudentProfile;
    expect((await post(route)).status).toBe(403);

    state.session = null;
    state.profile = teacherProfile;
    expect((await post(route)).status).toBe(404);

    expect(calls).toHaveLength(0);
    expect(vi.mocked(audit.logAudit)).not.toHaveBeenCalled();
  });

  it("parents pass the page rule but never get a Pencil user or a join URL (status card only)", async () => {
    const { calls } = pencilServer({});
    state.profile = parentProfile;
    state.children = [studentProfile];
    const res = await post(route);
    expect(res.status).toBe(403);
    expect(String(res.body.error)).toMatch(/status card/i);
    expect(res.body.url).toBeUndefined();
    expect(calls).toHaveLength(0);
    expect(db.tables.pencil_users).toHaveLength(0);
  });

  it("refuses an over lesson with 409 'ended' and still names the fallback link", async () => {
    const { calls } = pencilServer({});
    for (const status of ["completed", "cancelled", "no_show"] as const) {
      state.session = sessionView({ status });
      const res = await post(route);
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ configured: false, reason: "ended", fallbackUrl: MASTER_ZOOM });
    }
    expect(calls).toHaveLength(0);
  });

  it("LESSON_FALLBACK_MODE=on skips Pencil entirely and sends everyone to the master Zoom link", async () => {
    vi.stubEnv("LESSON_FALLBACK_MODE", "on");
    const { calls } = pencilServer({});
    const res = await post(route);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ configured: false, reason: "forced", fallback: true, fallbackUrl: MASTER_ZOOM });
    expect(calls).toHaveLength(0);
  });

  it("prefers the admin's per-lesson override over the master link", async () => {
    vi.stubEnv("LESSON_FALLBACK_MODE", "on");
    pencilServer({});
    state.session = sessionView({ fallback_join_url: "https://meet.example.com/override" });
    const res = await post(route);
    expect(res.body.fallbackUrl).toBe("https://meet.example.com/override");
  });

  it("answers 503 'service_role_missing' without SUPABASE_SERVICE_ROLE_KEY and 429 when rate-limited", async () => {
    const { calls } = pencilServer({});
    state.admin = null;
    let res = await post(route);
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ configured: false, reason: "service_role_missing", fallbackUrl: MASTER_ZOOM });

    state.admin = db;
    state.rateLimitAllowed = false;
    res = await post(route);
    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ configured: false, reason: "rate_limited" });
    expect(calls).toHaveLength(0);
  });

  it("warm join = exactly one Pencil call (authorize); the url is returned as JSON and never audited", async () => {
    seedWarmPair(db);
    const { calls } = pencilServer({
      "GET users/u-teacher/authorize": () => json({ url: TOKEN_URL }),
    });

    const res = await post(route);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      configured: true,
      url: TOKEN_URL,
      mode: "iframe",
      purpose: "lesson",
      expiresInSeconds: 3600,
      spaceId: SPACE_ID,
      studentPencilUserId: "u-student",
      recordingOn: true,
      optedOut: false,
      fallbackUrl: MASTER_ZOOM,
    });

    // One call, and the redirectUrl carries the lesson params on the SPACE url.
    expect(calls).toHaveLength(1);
    const redirect = new URL(new URL(`https://pencil.test/public/api/${calls[0]!.path}`).searchParams.get("redirectUrl")!);
    expect(redirect.origin + redirect.pathname).toBe(SPACE_LINK);
    for (const key of ["startCall", "skipCallHostCheck", "standalone", "broadcastEvents", "gv"]) {
      expect(redirect.searchParams.get(key)).toBe("true");
    }

    // The Space actually used is bound to the lesson.
    expect(db.tables.sessions[0]!.space_id).toBe("space-row-1");

    // Audit carries {spaceId, purpose, mode} — never the credential.
    expect(vi.mocked(audit.logAudit)).toHaveBeenCalledTimes(1);
    const [, action, target, details] = vi.mocked(audit.logAudit).mock.calls[0]!;
    expect(action).toBe("pencil.join");
    expect(target).toEqual({ type: "session", id: SESSION });
    expect(details).toEqual({ spaceId: SPACE_ID, purpose: "lesson", mode: "iframe" });
    expect(recorded(audit, observability)).not.toContain(TOKEN);
  });

  it("students mint their own url; 'board' (second device) is standalone-only and audited as such", async () => {
    seedWarmPair(db);
    const { calls } = pencilServer({
      "GET users/u-student/authorize": () => json({ url: TOKEN_URL }),
    });
    state.profile = studentProfile;

    const res = await post(route, { purpose: "board", mode: "redirect" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ configured: true, purpose: "board", mode: "redirect" });

    expect(authorizeOk(calls)).toHaveLength(1);
    const redirect = new URL(new URL(`https://pencil.test/public/api/${calls[0]!.path}`).searchParams.get("redirectUrl")!);
    expect(Array.from(redirect.searchParams.keys())).toEqual(["standalone"]);

    const details = vi.mocked(audit.logAudit).mock.calls[0]![3];
    expect(details).toEqual({ spaceId: SPACE_ID, purpose: "board", mode: "redirect" });
    expect(recorded(audit, observability)).not.toContain(TOKEN);
  });

  it("cold pair: provisions users + Space (recovery lookup first), then mints — all behind the access rule", async () => {
    const { calls } = pencilServer({
      "POST users/createAPIUser": (c) => {
        const ext = String(c.body?.externalId);
        const id = ext === STUDENT ? "u-student" : ext === TEACHER ? "u-teacher" : `u-${ext.slice(-4)}`;
        return json({ userId: id, email: `${id}@api.pencil`, name: String(c.body?.name), isApiManaged: true, userRole: c.body?.userRole, externalId: ext });
      },
      "GET spaces?": () => json({ results: [], pageNumber: 1, pageSize: 10, totalPages: 0, totalRecords: 0 }),
      "POST spaces/create": (c) => json(pencilSpace({ hosts: (c.body?.hosts as Row[]).map((h) => ({ userId: h.userId })), title: c.body?.title })),
      "GET users/u-teacher/authorize": () => json({ url: TOKEN_URL }),
    });

    const res = await post(route);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ configured: true, url: TOKEN_URL, studentPencilUserId: "u-student", spaceId: SPACE_ID });

    expect(calls.map((c) => `${c.method} ${c.path.split("?")[0]}`)).toEqual([
      "POST users/createAPIUser",
      "POST users/createAPIUser",
      "GET spaces",
      "POST spaces/create",
      "GET users/u-teacher/authorize",
    ]);
    // Pencil never gets the minor's full name.
    expect(calls[0]!.body).toMatchObject({ name: "Aarav", userRole: "Student", externalId: STUDENT });
    expect(calls[1]!.body).toMatchObject({ name: "Maya Chen", userRole: "Teacher", externalId: TEACHER });
    expect(calls[3]!.body).toMatchObject({ visibility: "private", notifyInvitees: false, externalId: `${COURSE}:${STUDENT}` });

    const row = db.tables.pencil_spaces[0]!;
    expect(row).toMatchObject({ status: "active", pencil_space_id: SPACE_ID, link: SPACE_LINK, host_profile_ids: [TEACHER], participant_profile_ids: [STUDENT] });
    expect(db.tables.sessions[0]!.space_id).toBe(row.id);

    const actions = vi.mocked(audit.logAudit).mock.calls.map((c) => c[1]);
    expect(actions).toEqual(["pencil.user.create", "pencil.user.create", "pencil.space.create", "pencil.join"]);
    expect(recorded(audit, observability)).not.toContain(TOKEN);
  });

  it("hard stop: opted-out student whose Space did not confirm recording_disabled → 409, nothing minted, one admin follow-up", async () => {
    seedWarmPair(db);
    db.tables.recording_opt_outs = [{ student_id: STUDENT, set_by: ADMIN, set_at: "2026-10-01T00:00:00.000Z", note: null }];
    const { calls } = pencilServer({
      [`PATCH spaces/${SPACE_ID}/settings/`]: () => json({}),
      [`GET spaces/${SPACE_ID}`]: () => json(pencilSpace({ settings: { disableAlwaysOnRecording: false } })),
      "GET users/u-teacher/authorize": () => json({ url: TOKEN_URL }),
    });

    let res = await post(route);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ configured: false, blocked: "recording_policy", reason: "recording_policy", fallbackUrl: null });
    expect(authorizeOk(calls)).toHaveLength(0);
    expect(calls.map((c) => c.method)).toEqual(["PATCH", "GET"]);
    expect(db.tables.pencil_spaces[0]!.recording_disabled).toBe(false);

    expect(db.tables.followups).toHaveLength(1);
    expect(db.tables.followups[0]).toMatchObject({ student_id: STUDENT, session_id: SESSION, type: "report_flag", priority: "high" });
    expect(String(db.tables.followups[0]!.reason)).toMatch(/^\[Recording policy\]/);
    expect(vi.mocked(audit.logAudit).mock.calls.map((c) => c[1])).toEqual(["pencil.join.blocked"]);

    // A second attempt re-applies the policy but does not duplicate the follow-up.
    res = await post(route);
    expect(res.status).toBe(409);
    expect(db.tables.followups).toHaveLength(1);
    expect(recorded(audit, observability)).not.toContain(TOKEN);
  });

  it("opted-out student whose Space confirms recording_disabled joins with recordingOn:false", async () => {
    seedWarmPair(db);
    db.tables.recording_opt_outs = [{ student_id: STUDENT, set_by: ADMIN, set_at: "2026-10-01T00:00:00.000Z", note: null }];
    const { calls } = pencilServer({
      [`PATCH spaces/${SPACE_ID}/settings/`]: (c) => {
        expect(c.body).toEqual({ settings: { disableAlwaysOnRecording: true } });
        return json({});
      },
      [`GET spaces/${SPACE_ID}`]: () => json(pencilSpace({ settings: { disableAlwaysOnRecording: true } })),
      "GET users/u-teacher/authorize": () => json({ url: TOKEN_URL }),
    });

    const res = await post(route);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ configured: true, recordingOn: false, optedOut: true });
    expect(calls.map((c) => c.method)).toEqual(["PATCH", "GET", "GET"]);
    expect(db.tables.pencil_spaces[0]!).toMatchObject({ recording_disabled: true });
    expect(db.tables.pencil_spaces[0]!.recording_verified_at).toBeTruthy();
    expect(db.tables.followups).toHaveLength(0);
  });

  it("a stale host list is synced additively before minting (session teacher ∉ host_profile_ids)", async () => {
    seedWarmPair(db);
    db.tables.pencil_spaces = [activeSpaceRow({ host_profile_ids: [] })];
    const { calls } = pencilServer({
      [`PATCH spaces/${SPACE_ID}/updateUsers`]: (c) => {
        expect(c.body).toEqual({ addUsers: [{ userId: "u-teacher", role: "host" }], notifyInvitees: false });
        return json(pencilSpace());
      },
      "GET users/u-teacher/authorize": () => json({ url: TOKEN_URL }),
    });
    const res = await post(route);
    expect(res.status).toBe(200);
    expect(calls.map((c) => c.method)).toEqual(["PATCH", "GET"]);
    expect(db.tables.pencil_spaces[0]!.host_profile_ids).toEqual([TEACHER]);
    expect(vi.mocked(audit.logAudit).mock.calls.map((c) => c[1])).toEqual(["pencil.space.hosts_changed", "pencil.join"]);
  });

  it("a Pencil failure answers 502 with the fallback link, transient for 5xx/timeout and not for 4xx", async () => {
    seedWarmPair(db);
    pencilServer({ "GET users/u-teacher/authorize": () => json({ err: "upstream", error_code: "UNAVAILABLE" }, 503) });
    let res = await post(route);
    expect(res.status).toBe(502);
    expect(res.body).toEqual({ configured: false, reason: "pencil_error", transient: true, fallbackUrl: MASTER_ZOOM });
    expect(vi.mocked(audit.logAudit)).not.toHaveBeenCalled();
    expect(vi.mocked(observability.captureError)).toHaveBeenCalledTimes(1);

    vi.unstubAllGlobals();
    pencilServer({ "GET users/u-teacher/authorize": () => json({ err: "bad key", error_code: "NOT_AUTHORIZED" }, 401) });
    res = await post(route);
    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ reason: "pencil_error", transient: false, fallbackUrl: MASTER_ZOOM });
    expect(recorded(audit, observability)).not.toContain(TOKEN);
  });
});

describe("POST /api/lesson/[id]/space — no Pencil key (mocked)", () => {
  let route: RouteModule;
  let db: FakeDb;

  beforeAll(async () => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubEnv("PENCIL_SPACES_API_KEY", "");
    vi.stubEnv("LESSON_FALLBACK_URL", MASTER_ZOOM);
    route = await import("@/app/api/lesson/[sessionId]/space/route");
  });

  beforeEach(() => {
    db = new FakeDb();
    seedDb(db);
    state.admin = db;
    state.profile = teacherProfile;
    state.session = sessionView();
    state.children = [];
    state.rateLimitAllowed = true;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it("answers the sample room: configured:false, mock ids, the real opt-out flag, no network", async () => {
    const { calls } = pencilServer({});
    let res = await post(route);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      configured: false,
      mock: true,
      mode: "mock",
      reason: "unconfigured",
      studentPencilUserId: `mock-user-${STUDENT}`,
      teacherPencilUserId: `mock-user-${TEACHER}`,
      optedOut: false,
      fallbackUrl: MASTER_ZOOM,
    });
    expect((res.body.space as Row).status).toBe("mock");
    expect(res.body.url).toBeUndefined();

    // Supabase on, Pencil off: the opt-out flag is still ours to show.
    db.tables.recording_opt_outs = [{ student_id: STUDENT, set_by: ADMIN, set_at: "2026-10-01T00:00:00.000Z", note: null }];
    res = await post(route);
    expect(res.body).toMatchObject({ configured: false, optedOut: true });
    expect((res.body.space as Row).recording_disabled).toBe(true);

    expect(calls).toHaveLength(0);
    expect(db.tables.pencil_users).toHaveLength(0);
    expect(db.tables.pencil_spaces).toHaveLength(0);
  });

  it("still refuses parents and strangers", async () => {
    state.profile = parentProfile;
    state.children = [studentProfile];
    expect((await post(route)).status).toBe(403);
    state.profile = otherTeacherProfile;
    expect((await post(route)).status).toBe(403);
  });
});
