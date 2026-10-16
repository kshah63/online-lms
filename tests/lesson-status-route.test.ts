import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeDb } from "./helpers/fake-db";

// GET /api/lesson/[id]/status is what every open lesson room polls so that a
// teacher's End closes the student's room too (End no longer calls Pencil's
// endOngoingSession, which never ended the call). It reads with the viewer's
// cookie client only — RLS is the access rule — and returns two fields.

const state = vi.hoisted(() => ({ db: null as unknown }));

vi.mock("@/lib/env", () => ({
  isDemoMode: false,
  isSupabaseConfigured: true,
  isMisconfigured: false,
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_ANON_KEY: "anon",
}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn(() => state.db) }));

const SESSION = "20000000-0000-0000-0000-000000000099";

async function get(route: typeof import("@/app/api/lesson/[sessionId]/status/route"), id = SESSION) {
  const res = await route.GET(new Request(`https://app.test/api/lesson/${id}/status`), { params: { sessionId: id } });
  return { status: res.status, body: (await res.json()) as Record<string, unknown>, cache: res.headers.get("cache-control") };
}

describe("GET /api/lesson/[id]/status", () => {
  let route: typeof import("@/app/api/lesson/[sessionId]/status/route");
  let db: FakeDb;

  beforeAll(async () => {
    route = await import("@/app/api/lesson/[sessionId]/status/route");
  });

  beforeEach(() => {
    db = new FakeDb();
    state.db = db;
  });

  it("returns only status and actual_end, uncached", async () => {
    db.tables.sessions = [{ id: SESSION, status: "completed", actual_end: "2026-10-16T02:00:00.000Z", teacher_id: "t", student_id: "s", agenda: "private" }];
    const res = await get(route);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "completed", actual_end: "2026-10-16T02:00:00.000Z" });
    expect(res.cache).toBe("no-store");
  });

  it("a live lesson reads as live with no end time", async () => {
    db.tables.sessions = [{ id: SESSION, status: "in_progress", actual_end: null }];
    expect((await get(route)).body).toEqual({ status: "in_progress", actual_end: null });
  });

  it("a row RLS hides (or that does not exist) is a 404, not an empty 200", async () => {
    db.tables.sessions = [];
    const res = await get(route);
    expect(res.status).toBe(404);
    expect(res.body).not.toHaveProperty("status");
  });
});
