import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Profile } from "@/lib/types";

// Provisioning must be idempotent (a Space/user is created at most once per
// pair/profile) and recover from a Pencil-side success whose DB write failed.
// Pencil is mocked at the fetch boundary; the service-role client is an
// in-memory stand-in supporting exactly the query shapes provision.ts uses.

vi.mock("@/lib/env", () => ({
  isDemoMode: false,
  isSupabaseConfigured: true,
  isMisconfigured: false,
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_ANON_KEY: "anon",
}));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(async () => {}) }));
vi.mock("@/lib/observability", () => ({ captureError: vi.fn() }));

import { FakeDb, type Row } from "./helpers/fake-db";
import { json, pencilServer, type Call } from "./helpers/pencil-server";

// --- fixtures ---------------------------------------------------------------

const ADMIN = "00000000-0000-0000-0000-000000000001";
const TEACHER = "00000000-0000-0000-0000-0000000000a1";
const STUDENT = "00000000-0000-0000-0000-0000000000b1";
const COURSE = "10000000-0000-0000-0000-000000000001";
const SPACE_LINK = "https://my.pencilapp.com/spaces/aaaaaaaaaaaaaaaaaaaaaaaa";

function profile(id: string, role: Profile["role"], display_name: string): Profile {
  return {
    id, role, display_name, email: `${display_name.split(" ")[0]!.toLowerCase()}@lessons.dev`, phone: null, avatar_url: null,
    timezone: "Asia/Singapore", whatsapp_opt_in: true, created_at: "2026-01-01T00:00:00.000Z",
  };
}
const teacherProfile = profile(TEACHER, "teacher", "Maya Chen");
const studentProfile = profile(STUDENT, "student", "Aarav Sharma");
const adminProfile = profile(ADMIN, "admin", "Admin Office");
const parentProfile = profile("00000000-0000-0000-0000-0000000000c1", "parent", "Priya Sharma");

const pencilUser = (userId: string, name: string, externalId: string) => ({ userId, email: `${userId}@api.pencil`, name, isApiManaged: true, userRole: "Student", externalId });
const pencilSpace = (over: Row = {}) => ({
  spaceId: "aaaaaaaaaaaaaaaaaaaaaaaa", link: SPACE_LINK, title: "IGCSE Mathematics · Aarav", visibility: "private",
  hosts: [{ userId: "u-teacher", email: "t@api" }], participants: [{ userId: "u-student", email: "s@api" }],
  archived: false, externalId: `${COURSE}:${STUDENT}`, settings: { disableAlwaysOnRecording: false, enableWaitingRoom: false },
  ...over,
});

/** Default happy-path Pencil: users created per externalId, no pre-existing Space. */
function happyPencil(extra: Record<string, (call: Call, n: number) => Response> = {}) {
  return pencilServer({
    "POST users/createAPIUser": (c) => {
      const ext = String(c.body?.externalId);
      const id = ext === STUDENT ? "u-student" : ext === TEACHER ? "u-teacher" : ext === ADMIN ? "u-admin" : `u-${ext.slice(-4)}`;
      return json(pencilUser(id, String(c.body?.name), ext));
    },
    "GET spaces?": () => json({ results: [], pageNumber: 1, pageSize: 10, totalPages: 0, totalRecords: 0 }),
    "POST spaces/create": (c) => json(pencilSpace({ hosts: (c.body?.hosts as Row[]).map((h) => ({ userId: h.userId })), title: c.body?.title })),
    ...extra,
  });
}

let db: FakeDb;
let admin: SupabaseClient;
let provision: typeof import("@/lib/pencil/provision");
let client: typeof import("@/lib/pencil/client");
let urls: typeof import("@/lib/pencil/urls");
let audit: typeof import("@/lib/audit");

beforeAll(async () => {
  vi.resetModules();
  vi.stubEnv("PENCIL_SPACES_API_KEY", "test-key");
  vi.stubEnv("PENCIL_API_BASE_URL", "https://pencil.test/public/api");
  client = await import("@/lib/pencil/client");
  provision = await import("@/lib/pencil/provision");
  urls = await import("@/lib/pencil/urls");
  audit = await import("@/lib/audit");
});

beforeEach(() => {
  db = new FakeDb();
  db.tables.profiles = [teacherProfile, studentProfile, adminProfile, parentProfile].map((p) => ({ ...p }));
  db.tables.courses = [{ id: COURSE, name: "IGCSE Mathematics" }];
  db.tables.pencil_users = [];
  db.tables.pencil_spaces = [];
  db.tables.recording_opt_outs = [];
  admin = db as unknown as SupabaseClient;
  vi.mocked(audit.logAudit).mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("client", () => {
  it("is live with a key and normalises the base URL to a trailing slash", () => {
    expect(client.pencilConfigured).toBe(true);
    expect(client.pencilLive).toBe(true);
    expect(client.PENCIL_API_BASE_URL).toBe("https://pencil.test/public/api/");
  });

  it("sends the bearer key, retries 429/5xx with back-off and parses the body", async () => {
    const { calls, fetchMock } = pencilServer({
      "POST users/createAPIUser": (_c, n) => (n === 1 ? json({ err: "slow down", error_code: "RATE_LIMITED" }, 429, { "retry-after": "0" }) : n === 2 ? json({}, 503) : json(pencilUser("u-x", "X", "x"))),
    });
    const user = await client.createApiUser({ name: "X", userRole: "Student", externalId: "x" }, { retries: 2, backoffBaseMs: 1 });
    expect(user.userId).toBe("u-x");
    expect(calls).toHaveLength(3);
    const headers = fetchMock.mock.calls[0]![1]!.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer test-key");
  });

  it("throws a PencilError carrying status + error_code, with no retry when retries=0", async () => {
    const { calls } = pencilServer({ "GET spaces/": () => json({ err: "nope", error_code: "NOT_AUTHORIZED" }, 401) });
    await expect(client.getSpace("abc", { retries: 0 })).rejects.toMatchObject({ name: "PencilError", status: 401, error_code: "NOT_AUTHORIZED", err: "nope" });
    expect(calls).toHaveLength(1);
  });

  it("rejects an unexpected response shape instead of returning garbage — as a TRANSIENT error (Retry + fallback)", async () => {
    pencilServer({ "GET spaces/": () => json({ hello: "world" }) });
    await expect(client.getSpace("abc", { retries: 0 })).rejects.toMatchObject({ error_code: "INVALID_RESPONSE", transient: true });

    vi.unstubAllGlobals();
    pencilServer({ "GET spaces/": () => new Response("<html>gateway hiccup</html>", { status: 200 }) });
    await expect(client.getSpace("abc", { retries: 0 })).rejects.toMatchObject({ error_code: "INVALID_RESPONSE", transient: true });
  });

  it("keeps a scrubbed hint of a non-JSON error body instead of dropping Pencil's text", async () => {
    pencilServer({ "GET spaces/": () => new Response("<h1>Bad gateway</h1> upstream ?token=abc reset", { status: 400, statusText: "Bad Request" }) });
    const err = await client.getSpace("abc", { retries: 0 }).catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 400, transient: false });
    expect(String((err as Error).message)).toContain("Bad gateway upstream");
    expect(String((err as Error).message)).not.toContain("token=abc");
  });

  it("findSpaceByExternalId sends base64 JSON filters and matches exactly", async () => {
    const { calls } = pencilServer({
      "GET spaces?": () => json({ results: [pencilSpace({ externalId: "c:s-other" }), pencilSpace({ spaceId: "bbbbbbbbbbbbbbbbbbbbbbbb", externalId: "c:s" })] }),
    });
    const found = await client.findSpaceByExternalId("c:s");
    expect(found?.spaceId).toBe("bbbbbbbbbbbbbbbbbbbbbbbb");
    const q = new URL(`https://x/${calls[0]!.path}`).searchParams;
    expect(JSON.parse(Buffer.from(q.get("filters")!, "base64").toString("utf8"))).toEqual({ externalId: "c:s", archiveStatus: "ALL" });
  });
});

describe("ensurePencilUser", () => {
  it("creates a Student with FIRST NAME only and externalId = profile id, then is idempotent", async () => {
    const { calls } = happyPencil();
    const first = await provision.ensurePencilUser(admin, studentProfile, { actor: teacherProfile });
    expect(first.pencil_user_id).toBe("u-student");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: "POST", path: "users/createAPIUser", body: { name: "Aarav", userRole: "Student", externalId: STUDENT } });
    expect(db.tables.pencil_users).toHaveLength(1);
    expect(db.tables.pencil_users[0]).toMatchObject({ profile_id: STUDENT, pencil_user_id: "u-student", pencil_name: "Aarav" });
    expect(audit.logAudit).toHaveBeenCalledWith(teacherProfile, "pencil.user.create", { type: "profile", id: STUDENT }, expect.objectContaining({ pencil_user_id: "u-student", userRole: "Student" }));

    const second = await provision.ensurePencilUser(admin, studentProfile);
    expect(second.pencil_user_id).toBe("u-student");
    expect(calls).toHaveLength(1); // no second Pencil call
    expect(db.tables.pencil_users).toHaveLength(1);
  });

  it("staff keep their full display_name and are Pencil 'Teacher' (admins included)", async () => {
    const { calls } = happyPencil();
    await provision.ensurePencilUser(admin, teacherProfile);
    await provision.ensurePencilUser(admin, adminProfile);
    expect(calls[0]!.body).toMatchObject({ name: "Maya Chen", userRole: "Teacher", externalId: TEACHER });
    expect(calls[1]!.body).toMatchObject({ name: "Admin Office", userRole: "Teacher", externalId: ADMIN });
  });

  it("never provisions a parent", async () => {
    const { calls } = happyPencil();
    await expect(provision.ensurePencilUser(admin, parentProfile)).rejects.toMatchObject({ error_code: "PARENT_NOT_ALLOWED" });
    expect(calls).toHaveLength(0);
  });

  it("renames lazily when display_name changed — off the join path, best effort", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { calls } = happyPencil({
      // A slow Pencil must not delay the join: the PATCH is still in flight when ensurePencilUser returns.
      "PATCH users/": ((c: Call) => gate.then(() => json(pencilUser("u-student", String(c.body?.name), STUDENT)))) as unknown as (c: Call) => Response,
    });
    await provision.ensurePencilUser(admin, studentProfile);
    const row = await provision.ensurePencilUser(admin, { ...studentProfile, display_name: "Ari Sharma" });
    expect(row.pencil_user_id).toBe("u-student");
    expect(calls[1]).toMatchObject({ method: "PATCH", path: "users/u-student", body: { name: "Ari" } });
    expect(db.tables.pencil_users[0]!.pencil_name).toBe("Aarav"); // not yet confirmed

    release();
    await vi.waitFor(() => expect(db.tables.pencil_users[0]!.pencil_name).toBe("Ari"));
  });

  it("converges when two cold requests create the same person concurrently (first insert wins)", async () => {
    const observability = await import("@/lib/observability");
    vi.mocked(observability.captureError).mockClear();
    const { calls } = happyPencil({
      "POST users/createAPIUser": (c, n) => json(pencilUser(`u-student-${n}`, String(c.body?.name), STUDENT)),
    });
    const [a, b] = await Promise.all([
      provision.ensurePencilUser(admin, studentProfile),
      provision.ensurePencilUser(admin, studentProfile),
    ]);
    expect(calls.filter((c) => c.path === "users/createAPIUser")).toHaveLength(2);
    expect(db.tables.pencil_users).toHaveLength(1);
    expect(a.pencil_user_id).toBe(db.tables.pencil_users[0]!.pencil_user_id);
    expect(b.pencil_user_id).toBe(a.pencil_user_id);
    // One audit for the kept user; the orphan is reported, not silently dropped.
    expect(vi.mocked(audit.logAudit).mock.calls.filter((c) => c[1] === "pencil.user.create")).toHaveLength(1);
    expect(vi.mocked(observability.captureError)).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ orphaned_pencil_user_id: expect.stringMatching(/^u-student-/), kept_pencil_user_id: a.pencil_user_id }),
    );
  });
});

describe("ensureSpace", () => {
  it("creates the Space once with the right body, saves the row, and is idempotent", async () => {
    const { calls } = happyPencil();
    const space = await provision.ensureSpace(admin, { studentId: STUDENT, courseId: COURSE, teacherId: TEACHER, actor: teacherProfile });

    const create = calls.find((c) => c.path === "spaces/create")!;
    expect(create.method).toBe("POST");
    expect(create.body).toEqual({
      title: "IGCSE Mathematics · Aarav",
      hosts: [{ userId: "u-teacher" }],
      participants: [{ userId: "u-student" }],
      visibility: "private",
      notifyInvitees: false,
      externalId: `${COURSE}:${STUDENT}`,
    });
    // recovery lookup runs BEFORE create
    expect(calls.findIndex((c) => c.path.startsWith("spaces?"))).toBeLessThan(calls.indexOf(create));
    expect(calls.filter((c) => c.path === "spaces/create")).toHaveLength(1);
    expect(calls.some((c) => c.path.endsWith("/updateUsers"))).toBe(false); // teacher already a host

    expect(space).toMatchObject({
      student_id: STUDENT, course_id: COURSE, external_id: `${COURSE}:${STUDENT}`, pencil_space_id: "aaaaaaaaaaaaaaaaaaaaaaaa",
      link: SPACE_LINK, status: "active", host_profile_ids: [TEACHER], participant_profile_ids: [STUDENT], recording_disabled: false,
    });
    expect(db.tables.pencil_spaces).toHaveLength(1);
    expect(audit.logAudit).toHaveBeenCalledWith(teacherProfile, "pencil.space.create", { type: "pencil_space", id: space.id }, expect.objectContaining({ recovered: false, pencil_space_id: "aaaaaaaaaaaaaaaaaaaaaaaa" }));

    const before = calls.length;
    const again = await provision.ensureSpace(admin, { studentId: STUDENT, courseId: COURSE, teacherId: TEACHER });
    expect(again.id).toBe(space.id);
    expect(calls.length).toBe(before); // zero Pencil calls on a warm row
  });

  it("recovers a Space by externalId instead of creating a duplicate, and adds the missing host", async () => {
    const { calls } = happyPencil({
      // Pencil already has the Space (our earlier DB insert failed) — the teacher isn't a host yet.
      "GET spaces?": () => json({ results: [pencilSpace({ spaceId: "cccccccccccccccccccccccc", hosts: [{ userId: "u-apikey" }] })] }),
      "PATCH spaces/cccccccccccccccccccccccc/updateUsers": (c) => json(pencilSpace({ spaceId: "cccccccccccccccccccccccc", hosts: [{ userId: "u-apikey" }, ...(c.body?.addUsers as Row[]).map((u) => ({ userId: u.userId }))] })),
    });
    const space = await provision.ensureSpace(admin, { studentId: STUDENT, courseId: COURSE, teacherId: TEACHER, actor: adminProfile });
    expect(calls.some((c) => c.path === "spaces/create")).toBe(false);
    expect(space.pencil_space_id).toBe("cccccccccccccccccccccccc");
    const patch = calls.find((c) => c.path.endsWith("/updateUsers"))!;
    expect(patch.body).toMatchObject({ notifyInvitees: false });
    expect((patch.body!.addUsers as Row[]).map((u) => u.role)).toEqual(["host"]);
    // admin actor is a host too (ensurePencilUser ran for admin → u-admin)
    expect(new Set((calls.filter((c) => c.path.endsWith("/updateUsers")).flatMap((c) => (c.body!.addUsers as Row[]).map((u) => u.userId))))).toEqual(new Set(["u-teacher", "u-admin"]));
    expect(space.host_profile_ids).toEqual(expect.arrayContaining([TEACHER, ADMIN]));
    expect(audit.logAudit).toHaveBeenCalledWith(adminProfile, "pencil.space.create", expect.anything(), expect.objectContaining({ recovered: true }));
    expect(audit.logAudit).toHaveBeenCalledWith(adminProfile, "pencil.space.hosts_changed", expect.anything(), expect.objectContaining({ removed: [] }));
  });

  it("upgrades a seeded 'mock' row in place (same id) when a key is configured", async () => {
    happyPencil();
    db.tables.pencil_spaces.push({
      id: "50000000-0000-0000-0000-000000000001", student_id: STUDENT, course_id: COURSE, external_id: `${COURSE}:${STUDENT}`,
      pencil_space_id: null, link: null, title: "IGCSE Mathematics · Aarav", host_profile_ids: [TEACHER], participant_profile_ids: [STUDENT],
      hosts_synced_at: null, recording_disabled: false, recording_verified_at: null, status: "mock",
    });
    const space = await provision.ensureSpace(admin, { studentId: STUDENT, courseId: COURSE, teacherId: TEACHER });
    expect(space.id).toBe("50000000-0000-0000-0000-000000000001");
    expect(space.status).toBe("active");
    expect(space.pencil_space_id).toBe("aaaaaaaaaaaaaaaaaaaaaaaa");
    expect(db.tables.pencil_spaces).toHaveLength(1);
  });

  it("works with no teacher assigned yet (hosts = [] besides the API-key user)", async () => {
    const { calls } = happyPencil({ "POST spaces/create": (c) => json(pencilSpace({ hosts: [{ userId: "u-apikey" }], title: c.body?.title })) });
    const space = await provision.ensureSpace(admin, { studentId: STUDENT, courseId: COURSE, teacherId: null });
    expect(calls.find((c) => c.path === "spaces/create")!.body!.hosts).toEqual([]);
    expect(space.host_profile_ids).toEqual([]);
  });
});

describe("ensureSpace — concurrency and recovery", () => {
  it("two simultaneous first joins create ONE Space and both get the same row", async () => {
    const { calls } = happyPencil();
    const [a, b] = await Promise.all([
      provision.ensureSpace(admin, { studentId: STUDENT, courseId: COURSE, teacherId: TEACHER, actor: teacherProfile, pollMs: 5 }),
      provision.ensureSpace(admin, { studentId: STUDENT, courseId: COURSE, teacherId: TEACHER, actor: studentProfile, pollMs: 5 }),
    ]);
    expect(calls.filter((c) => c.path === "spaces/create")).toHaveLength(1);
    expect(calls.filter((c) => c.path === "users/createAPIUser")).toHaveLength(2); // student + teacher, once each
    expect(a.id).toBe(b.id);
    expect(a.pencil_space_id).toBe("aaaaaaaaaaaaaaaaaaaaaaaa");
    expect(b.status).toBe("active");
    expect(db.tables.pencil_spaces).toHaveLength(1);
    expect(db.tables.pencil_spaces[0]!.provision_lock_until).toBeNull(); // lease released
  });

  it("a live lease held by another request → waits, then a transient PROVISIONING_IN_PROGRESS; an expired lease is taken over", async () => {
    const { calls } = happyPencil();
    db.tables.pencil_spaces.push({
      id: "held", student_id: STUDENT, course_id: COURSE, external_id: `${COURSE}:${STUDENT}`, pencil_space_id: null, link: null,
      host_profile_ids: [], participant_profile_ids: [], recording_disabled: false, status: "mock",
      provision_lock_until: new Date(Date.now() + 60_000).toISOString(),
    });
    await expect(
      provision.ensureSpace(admin, { studentId: STUDENT, courseId: COURSE, teacherId: TEACHER, waitMs: 30, pollMs: 5 }),
    ).rejects.toMatchObject({ error_code: "PROVISIONING_IN_PROGRESS", transient: true });
    expect(calls).toHaveLength(0); // never raced the holder at Pencil

    db.tables.pencil_spaces[0]!.provision_lock_until = new Date(Date.now() - 1_000).toISOString(); // holder crashed
    const space = await provision.ensureSpace(admin, { studentId: STUDENT, courseId: COURSE, teacherId: TEACHER });
    expect(space.id).toBe("held");
    expect(space.status).toBe("active");
    expect(calls.filter((c) => c.path === "spaces/create")).toHaveLength(1);
  });

  it("releases the lease when provisioning fails, so the next join retries immediately", async () => {
    happyPencil({ "POST spaces/create": () => json({ err: "bad key", error_code: "NOT_AUTHORIZED" }, 401) });
    await expect(provision.ensureSpace(admin, { studentId: STUDENT, courseId: COURSE, teacherId: TEACHER })).rejects.toMatchObject({ status: 401 });
    expect(db.tables.pencil_spaces[0]).toMatchObject({ status: "mock", provision_lock_until: null });
  });

  it("treats a duplicate-externalId 4xx from create as 'look it up again' (recovered)", async () => {
    const { calls } = happyPencil({
      "GET spaces?": (_c, n) => json({ results: n === 1 ? [] : [pencilSpace({ spaceId: "dddddddddddddddddddddddd" })] }),
      "POST spaces/create": () => json({ err: "externalId must be unique", error_code: "INVALID_REQUEST_BODY" }, 400),
    });
    const space = await provision.ensureSpace(admin, { studentId: STUDENT, courseId: COURSE, teacherId: TEACHER, actor: teacherProfile });
    expect(space.pencil_space_id).toBe("dddddddddddddddddddddddd");
    expect(calls.filter((c) => c.path.startsWith("spaces?"))).toHaveLength(2);
    expect(audit.logAudit).toHaveBeenCalledWith(teacherProfile, "pencil.space.create", expect.anything(), expect.objectContaining({ recovered: true }));
  });

  it("a recovered Space whose participant is an orphaned user gets the student's CURRENT user added", async () => {
    const { calls } = happyPencil({
      "GET spaces?": () => json({ results: [pencilSpace({ participants: [{ userId: "u-orphan" }] })] }),
      "PATCH spaces/aaaaaaaaaaaaaaaaaaaaaaaa/updateUsers": () => json(pencilSpace()),
    });
    await provision.ensureSpace(admin, { studentId: STUDENT, courseId: COURSE, teacherId: TEACHER });
    const patch = calls.find((c) => c.path.endsWith("/updateUsers"))!;
    expect(patch.body).toEqual({ notifyInvitees: false, addUsers: [{ userId: "u-student", role: "participant" }] });
  });

  it("reads the Space itself when the list item omits members", async () => {
    const { calls } = happyPencil({
      "GET spaces?": () => json({ results: [{ spaceId: "aaaaaaaaaaaaaaaaaaaaaaaa", link: SPACE_LINK, externalId: `${COURSE}:${STUDENT}` }] }),
      "GET spaces/aaaaaaaaaaaaaaaaaaaaaaaa": () => json(pencilSpace()),
    });
    const space = await provision.ensureSpace(admin, { studentId: STUDENT, courseId: COURSE, teacherId: TEACHER });
    expect(calls.map((c) => `${c.method} ${c.path.split("?")[0]}`)).toContain("GET spaces/aaaaaaaaaaaaaaaaaaaaaaaa");
    expect(calls.some((c) => c.path.endsWith("/updateUsers"))).toBe(false); // teacher host + student participant already
    expect(space.host_profile_ids).toEqual([TEACHER]);
  });
});

describe("removeHosts", () => {
  it("removes the user from the Space and the cache, tolerating a 4xx only when the read-back agrees", async () => {
    const { calls } = happyPencil({
      "PATCH spaces/aaaaaaaaaaaaaaaaaaaaaaaa/updateUsers": () => json(pencilSpace()),
    });
    let space = await provision.ensureSpace(admin, { studentId: STUDENT, courseId: COURSE, teacherId: TEACHER, actor: adminProfile });
    expect(space.host_profile_ids).toEqual(expect.arrayContaining([TEACHER, ADMIN]));

    space = await provision.removeHosts(admin, space, [TEACHER, STUDENT], { actor: adminProfile });
    expect(space.host_profile_ids).toEqual([ADMIN]);
    const removal = calls.filter((c) => c.path.endsWith("/updateUsers")).at(-1)!;
    expect(removal.body).toEqual({ notifyInvitees: false, removeUsers: [{ userId: "u-teacher" }] });
    expect(audit.logAudit).toHaveBeenCalledWith(adminProfile, "pencil.space.hosts_changed", { type: "pencil_space", id: space.id }, { added: [], removed: [TEACHER] });

    // No-op for someone who isn't a cached host: zero calls.
    const before = calls.length;
    await provision.removeHosts(admin, space, [TEACHER]);
    expect(calls.length).toBe(before);
  });

  it("refuses to drop the cache entry when Pencil says the user is still in the Space", async () => {
    happyPencil();
    const space = await provision.ensureSpace(admin, { studentId: STUDENT, courseId: COURSE, teacherId: TEACHER });
    vi.unstubAllGlobals();
    pencilServer({
      "PATCH spaces/aaaaaaaaaaaaaaaaaaaaaaaa/updateUsers": () => json({ err: "cannot remove", error_code: "INVALID_REQUEST_BODY" }, 400),
      "GET spaces/aaaaaaaaaaaaaaaaaaaaaaaa": () => json(pencilSpace()), // u-teacher still a host
    });
    await expect(provision.removeHosts(admin, space, [TEACHER])).rejects.toMatchObject({ status: 400 });
    expect(db.tables.pencil_spaces[0]!.host_profile_ids).toEqual([TEACHER]);
  });
});

describe("syncHosts", () => {
  it("is additive, skips hosts already present, and never adds a student", async () => {
    const { calls } = happyPencil({
      "PATCH spaces/aaaaaaaaaaaaaaaaaaaaaaaa/updateUsers": () => json(pencilSpace()),
    });
    const space = await provision.ensureSpace(admin, { studentId: STUDENT, courseId: COURSE, teacherId: TEACHER });
    const before = calls.length;
    const unchanged = await provision.syncHosts(admin, space, [TEACHER]);
    expect(unchanged.host_profile_ids).toEqual([TEACHER]);
    expect(calls.length).toBe(before); // no-op

    const synced = await provision.syncHosts(admin, space, [ADMIN, STUDENT], { actor: adminProfile });
    expect(synced.host_profile_ids).toEqual([TEACHER, ADMIN]); // student ignored
    const patches = calls.filter((c) => c.path.endsWith("/updateUsers"));
    expect(patches).toHaveLength(1);
    expect(patches[0]!.body).toEqual({ notifyInvitees: false, addUsers: [{ userId: "u-admin", role: "host" }] });
    expect(audit.logAudit).toHaveBeenCalledWith(adminProfile, "pencil.space.hosts_changed", { type: "pencil_space", id: space.id }, { added: [ADMIN], removed: [] });
  });
});

describe("applyRecordingPolicy", () => {
  async function provisioned() {
    happyPencil();
    const space = await provision.ensureSpace(admin, { studentId: STUDENT, courseId: COURSE, teacherId: TEACHER });
    vi.unstubAllGlobals();
    return space;
  }

  it("PATCHes, reads back, and writes the flag only when confirmed", async () => {
    const space = await provisioned();
    const { calls } = pencilServer({
      "PATCH spaces/aaaaaaaaaaaaaaaaaaaaaaaa/settings/": () => json({}),
      "GET spaces/aaaaaaaaaaaaaaaaaaaaaaaa": () => json(pencilSpace({ settings: { disableAlwaysOnRecording: true } })),
    });
    const result = await provision.applyRecordingPolicy(admin, space, true);
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "PATCH spaces/aaaaaaaaaaaaaaaaaaaaaaaa/settings/",
      "GET spaces/aaaaaaaaaaaaaaaaaaaaaaaa",
    ]);
    expect(calls[0]!.body).toEqual({ settings: { disableAlwaysOnRecording: true } });
    expect(result.confirmed).toBe(true);
    expect(result.space.recording_disabled).toBe(true);
    expect(result.space.recording_verified_at).toBeTruthy();
    expect(db.tables.pencil_spaces[0]!.recording_disabled).toBe(true);
  });

  it("leaves the row untouched when the read-back does not confirm (hard stop stays on)", async () => {
    const space = await provisioned();
    const before = { ...db.tables.pencil_spaces[0]! };
    pencilServer({
      "PATCH spaces/aaaaaaaaaaaaaaaaaaaaaaaa/settings/": () => json({}),
      "GET spaces/aaaaaaaaaaaaaaaaaaaaaaaa": () => json(pencilSpace({ settings: { disableAlwaysOnRecording: false } })),
    });
    const result = await provision.applyRecordingPolicy(admin, space, true);
    expect(result.confirmed).toBe(false);
    expect(result.space.recording_disabled).toBe(false);
    expect(db.tables.pencil_spaces[0]).toEqual(before); // nothing written
    expect(provision.recordingPolicyBlocksJoin(true, result.space)).toBe(true);
    expect(provision.recordingPolicyBlocksJoin(false, result.space)).toBe(false);
  });
});

describe("ensureRecordingPolicy (join path)", () => {
  async function provisioned(over: Row = {}) {
    happyPencil();
    await provision.ensureSpace(admin, { studentId: STUDENT, courseId: COURSE, teacherId: TEACHER });
    vi.unstubAllGlobals();
    Object.assign(db.tables.pencil_spaces[0]!, over);
    return { ...db.tables.pencil_spaces[0]! } as unknown as import("@/lib/types").PencilSpace;
  }

  it("not opted out and cached as recording → zero calls", async () => {
    const space = await provisioned();
    const { calls } = pencilServer({});
    const res = await provision.ensureRecordingPolicy(admin, space, false);
    expect(res).toEqual({ confirmed: true, space });
    expect(calls).toHaveLength(0);
  });

  it("opted out and cached as disabled → one read-back GET; confirmed → no write", async () => {
    const space = await provisioned({ recording_disabled: true });
    const { calls } = pencilServer({ "GET spaces/aaaaaaaaaaaaaaaaaaaaaaaa": () => json(pencilSpace({ settings: { disableAlwaysOnRecording: true } })) });
    const res = await provision.ensureRecordingPolicy(admin, space, true);
    expect(res.confirmed).toBe(true);
    expect(calls.map((c) => c.method)).toEqual(["GET"]);
  });

  it("drift at Pencil: the row is corrected first, then re-applied; an unconfirmed re-apply leaves the hard stop on", async () => {
    const space = await provisioned({ recording_disabled: true });
    const { calls } = pencilServer({
      "GET spaces/aaaaaaaaaaaaaaaaaaaaaaaa": () => json(pencilSpace({ settings: { disableAlwaysOnRecording: false } })),
      "PATCH spaces/aaaaaaaaaaaaaaaaaaaaaaaa/settings/": () => json({}),
    });
    const res = await provision.ensureRecordingPolicy(admin, space, true);
    expect(calls.map((c) => c.method)).toEqual(["GET", "PATCH", "GET"]);
    expect(res.confirmed).toBe(false);
    expect(db.tables.pencil_spaces[0]!.recording_disabled).toBe(false);
    expect(provision.recordingPolicyBlocksJoin(true, res.space)).toBe(true);
  });

  it("re-enables recording when the opt-out was lifted but the Space still has it disabled — best effort", async () => {
    const space = await provisioned({ recording_disabled: true });
    pencilServer({
      "PATCH spaces/aaaaaaaaaaaaaaaaaaaaaaaa/settings/": () => json({ err: "nope", error_code: "NOT_AUTHORIZED" }, 401),
    });
    const res = await provision.ensureRecordingPolicy(admin, space, false);
    expect(res.confirmed).toBe(false); // reported, not thrown
    expect(provision.recordingPolicyBlocksJoin(false, res.space)).toBe(false);

    vi.unstubAllGlobals();
    const { calls } = pencilServer({
      "PATCH spaces/aaaaaaaaaaaaaaaaaaaaaaaa/settings/": (c) => {
        expect(c.body).toEqual({ settings: { disableAlwaysOnRecording: false } });
        return json({});
      },
      "GET spaces/aaaaaaaaaaaaaaaaaaaaaaaa": () => json(pencilSpace({ settings: { disableAlwaysOnRecording: false } })),
    });
    const ok = await provision.ensureRecordingPolicy(admin, space, false);
    expect(ok.confirmed).toBe(true);
    expect(calls.map((c) => c.method)).toEqual(["PATCH", "GET"]);
    expect(db.tables.pencil_spaces[0]!.recording_disabled).toBe(false);
  });
});

describe("isRecordingOptedOut", () => {
  it("reads the opt-out table", async () => {
    expect(await provision.isRecordingOptedOut(admin, STUDENT)).toBe(false);
    db.tables.recording_opt_outs.push({ student_id: STUDENT, set_by: ADMIN, note: null });
    expect(await provision.isRecordingOptedOut(admin, STUDENT)).toBe(true);
  });
});

describe("mintJoinUrl (live)", () => {
  it("calls authorize once with the FULL Space URL (params on the redirect, not the token URL)", async () => {
    happyPencil();
    const space = await provision.ensureSpace(admin, { studentId: STUDENT, courseId: COURSE, teacherId: TEACHER });
    vi.unstubAllGlobals();
    const { calls } = pencilServer({
      "GET users/": () => json({ url: "https://my.pencilapp.com/token-login?loginType=api&token=SECRET&continueUrl=x" }),
    });
    const minted = await urls.mintJoinUrl("u-teacher", space, "lesson");
    expect(minted.mock).toBe(false);
    expect(minted.url).toContain("token=SECRET");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.path.startsWith("users/u-teacher/authorize?redirectUrl=")).toBe(true);
    const redirect = new URL(`https://x/${calls[0]!.path}`).searchParams.get("redirectUrl")!;
    const r = new URL(redirect);
    expect(r.origin + r.pathname).toBe(SPACE_LINK);
    expect(r.searchParams.get("startCall")).toBe("true");
    expect(r.searchParams.get("broadcastEvents")).toBe("true");

    const board = await urls.mintJoinUrl("u-student", space, "board");
    const r2 = new URL(new URL(`https://x/${calls[1]!.path}`).searchParams.get("redirectUrl")!);
    expect(Array.from(r2.searchParams.keys())).toEqual(["standalone"]);
    expect(board.purpose).toBe("board");
  });

  it("does not retry authorize and surfaces a PencilError for the fallback path", async () => {
    happyPencil();
    const space = await provision.ensureSpace(admin, { studentId: STUDENT, courseId: COURSE, teacherId: TEACHER });
    vi.unstubAllGlobals();
    const { calls } = pencilServer({ "GET users/u-teacher/authorize": () => json({ err: "down" }, 503) });
    await expect(urls.mintJoinUrl("u-teacher", space, "lesson")).rejects.toMatchObject({ name: "PencilError", status: 503, transient: true });
    expect(calls).toHaveLength(1);
  });
});
