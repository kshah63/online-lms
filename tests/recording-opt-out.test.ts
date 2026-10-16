import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Profile } from "@/lib/types";
import { FakeDb, type Row } from "./helpers/fake-db";

// setRecordingOptOut (plan decision d). Pencil support (2026-10-16): the Space
// setting `disableAlwaysOnRecording` takes effect from the NEXT call and does
// not stop a recording that is already running. So the admin is warned (and a
// follow-up raised) for a lesson whose call may be running now — and no longer
// for one that merely starts later today, which the old "up to 3 h" rule did.
// "May be running" includes an overrunning lesson and one ended moments ago:
// End does not hang up Pencil's call, so a Space tab can still be in it.
// Spaces here are mock rows, so the policy confirms without network.

const state = vi.hoisted(() => ({ db: null as unknown, actor: null as unknown }));

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
vi.mock("@/lib/data/auth", () => ({ requireRole: vi.fn(async () => state.actor) }));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: vi.fn(() => state.db) }));

const ADMIN = "00000000-0000-0000-0000-000000000001";
const STUDENT = "00000000-0000-0000-0000-0000000000b1";
const COURSE = "10000000-0000-0000-0000-000000000001";

const admin: Profile = {
  id: ADMIN, role: "admin", display_name: "Admin Office", email: "admin@lessons.dev", phone: null, avatar_url: null,
  timezone: "Asia/Singapore", whatsapp_opt_in: false, created_at: "2026-01-01T00:00:00.000Z",
};

const minutesFromNow = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

function lesson(id: string, startInMin: number, lengthMin = 60, status = "confirmed", endedMinAgo: number | null = null): Row {
  return {
    id, student_id: STUDENT, course_id: COURSE, status,
    scheduled_start: minutesFromNow(startInMin), scheduled_end: minutesFromNow(startInMin + lengthMin),
    actual_end: endedMinAgo === null ? null : minutesFromNow(-endedMinAgo),
  };
}

function seed(db: FakeDb, sessions: Row[]) {
  db.tables.profiles = [{ id: STUDENT, role: "student", display_name: "Aarav Sharma" }];
  db.tables.recording_opt_outs = [];
  db.tables.pencil_spaces = [{ id: "space-row-1", student_id: STUDENT, course_id: COURSE, status: "mock", recording_disabled: false }];
  db.tables.sessions = sessions;
  db.tables.followups = [];
}

describe("setRecordingOptOut — the setting reaches the next call only", () => {
  let actions: typeof import("@/lib/actions/people");
  let audit: typeof import("@/lib/audit");
  let db: FakeDb;

  beforeAll(async () => {
    vi.resetModules();
    vi.stubEnv("PENCIL_SPACES_API_KEY", "");
    vi.stubEnv("PENCIL_RECORDING_ENABLED", "on");
    actions = await import("@/lib/actions/people");
    audit = await import("@/lib/audit");
  });

  beforeEach(() => {
    db = new FakeDb();
    state.db = db;
    state.actor = admin;
    vi.stubEnv("PENCIL_RECORDING_ENABLED", "on");
    vi.mocked(audit.logAudit).mockClear();
  });

  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it("a lesson on now: warns that its running call keeps recording, raises one follow-up", async () => {
    seed(db, [lesson("s-now", -20)]);
    const res = await actions.setRecordingOptOut(STUDENT, true);
    expect(res.ok).toBe(true);
    expect(res.warnings).toHaveLength(1);
    expect(res.warnings[0]).toMatch(/applies from the next call/);
    expect(db.tables.followups).toHaveLength(1);
    expect(db.tables.followups[0]).toMatchObject({ session_id: "s-now", student_id: STUDENT });
    expect(vi.mocked(audit.logAudit).mock.calls[0]![3]).toMatchObject({ opt_out: true, lessons_in_progress: 1 });
  });

  it("a lesson about to start (teacher may already be in the call) counts as on now", async () => {
    seed(db, [lesson("s-soon", 10)]);
    const res = await actions.setRecordingOptOut(STUDENT, true);
    expect(res.warnings).toHaveLength(1);
    expect(db.tables.followups).toHaveLength(1);
  });

  it("a lesson later today is not warned about: its call will be the next call", async () => {
    seed(db, [lesson("s-later", 120)]);
    const res = await actions.setRecordingOptOut(STUDENT, true);
    expect(res.ok).toBe(true);
    expect(res.warnings).toEqual([]);
    expect(db.tables.followups).toEqual([]);
    expect(vi.mocked(audit.logAudit).mock.calls[0]![3]).toMatchObject({ lessons_in_progress: 0 });
  });

  it("a lesson that ended long ago, or one cancelled, is not warned about", async () => {
    seed(db, [lesson("s-past", -180), lesson("s-cancelled", -10, 60, "cancelled")]);
    const res = await actions.setRecordingOptOut(STUDENT, true);
    expect(res.warnings).toEqual([]);
    expect(db.tables.followups).toEqual([]);
  });

  it("the slot's overrun bound: ended 20 min ago is warned about, 40 min ago is not", async () => {
    seed(db, [lesson("s-overrun", -80)]);
    expect((await actions.setRecordingOptOut(STUDENT, true)).warnings).toHaveLength(1);
    seed(db, [lesson("s-gone", -100)]);
    expect((await actions.setRecordingOptOut(STUDENT, true)).warnings).toEqual([]);
  });

  it("a lesson still in progress long after its slot is warned about", async () => {
    seed(db, [lesson("s-late", -150, 60, "in_progress")]);
    const res = await actions.setRecordingOptOut(STUDENT, true);
    expect(res.warnings).toHaveLength(1);
    expect(db.tables.followups[0]).toMatchObject({ session_id: "s-late" });
  });

  it("a lesson ended 5 min ago is warned about (a Space tab can still be in the call); one ended an hour ago is not", async () => {
    seed(db, [lesson("s-just", -70, 60, "completed", 5)]);
    expect((await actions.setRecordingOptOut(STUDENT, true)).warnings).toHaveLength(1);
    seed(db, [lesson("s-old", -130, 60, "completed", 65)]);
    expect((await actions.setRecordingOptOut(STUDENT, true)).warnings).toEqual([]);
  });

  it("Phase 1 too (recording not switched on): a host may have started a recording by hand, so it still warns", async () => {
    vi.stubEnv("PENCIL_RECORDING_ENABLED", "");
    seed(db, [lesson("s-now", -20)]);
    const res = await actions.setRecordingOptOut(STUDENT, true);
    expect(res.ok).toBe(true);
    expect(res.warnings).toHaveLength(1);
    expect(res.warnings[0]).toMatch(/if that call is being recorded/);
    expect(vi.mocked(audit.logAudit).mock.calls[0]![3]).toMatchObject({ lessons_in_progress: 1 });
  });

  it("resuming recording never warns about a lesson on now", async () => {
    seed(db, [lesson("s-now", -20)]);
    db.tables.recording_opt_outs = [{ student_id: STUDENT, set_by: ADMIN, set_at: minutesFromNow(-600), note: null }];
    const res = await actions.setRecordingOptOut(STUDENT, false);
    expect(res.ok).toBe(true);
    expect(res.warnings).toEqual([]);
    expect(db.tables.recording_opt_outs).toEqual([]);
  });
});
