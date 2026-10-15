import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

// Force "live" mode so canHostSpace exercises the admin-client query path
// rather than the demo dataset.
vi.mock("@/lib/env", () => ({
  isDemoMode: false,
  isSupabaseConfigured: true,
  isMisconfigured: false,
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_ANON_KEY: "anon",
}));

import { canEndLesson, canEnterSpace, canHostSpace, canJoinLesson } from "@/lib/pencil/authz";

// This is the single gate in front of every Pencil call made with the
// institution key; the matrix must match /lesson/[sessionId]/page.tsx exactly.

const admin = { id: "admin-1", role: "admin" as const };
const teacher = { id: "t1", role: "teacher" as const };
const otherTeacher = { id: "t2", role: "teacher" as const };
const student = { id: "s1", role: "student" as const };
const otherStudent = { id: "s2", role: "student" as const };
const parent = { id: "p1", role: "parent" as const };

const session = { teacher_id: "t1", student_id: "s1" };
const unassigned = { teacher_id: null, student_id: "s1" };

describe("canJoinLesson", () => {
  it("admin always", () => {
    expect(canJoinLesson(admin, session, [])).toBe(true);
    expect(canJoinLesson(admin, unassigned, [])).toBe(true);
  });

  it("teacher only when assigned", () => {
    expect(canJoinLesson(teacher, session, [])).toBe(true);
    expect(canJoinLesson(otherTeacher, session, [])).toBe(false);
    expect(canJoinLesson(teacher, unassigned, [])).toBe(false);
  });

  it("student only for their own session", () => {
    expect(canJoinLesson(student, session, [student.id])).toBe(true);
    expect(canJoinLesson(otherStudent, session, [otherStudent.id])).toBe(false);
    // childIds are irrelevant for a student — the rule is student_id === profile.id
    expect(canJoinLesson(otherStudent, session, ["s1"])).toBe(false);
  });

  it("parent only for a child's session", () => {
    expect(canJoinLesson(parent, session, ["s1"])).toBe(true);
    expect(canJoinLesson(parent, session, ["s9"])).toBe(false);
    expect(canJoinLesson(parent, session, [])).toBe(false);
  });
});

describe("canEnterSpace", () => {
  it("parents can view the page but never get a Pencil seat", () => {
    expect(canEnterSpace(parent, session, ["s1"])).toBe(false);
    expect(canEnterSpace(student, session, ["s1"])).toBe(true);
    expect(canEnterSpace(teacher, session, [])).toBe(true);
    expect(canEnterSpace(otherTeacher, session, [])).toBe(false);
    expect(canEnterSpace(admin, session, [])).toBe(true);
  });
});

describe("canEndLesson", () => {
  it("assigned teacher or admin", () => {
    expect(canEndLesson(teacher, session)).toBe(true);
    expect(canEndLesson(admin, session)).toBe(true);
    expect(canEndLesson(otherTeacher, session)).toBe(false);
    expect(canEndLesson(student, session)).toBe(false);
    expect(canEndLesson(parent, session)).toBe(false);
  });
});

/** Minimal chainable stand-in for the sessions count query canHostSpace runs. */
function fakeAdmin(result: { count: number | null; error: { message: string } | null }, calls: unknown[][] = []) {
  const builder: Record<string, unknown> = {};
  const chain = (name: string) => {
    builder[name] = (...args: unknown[]) => {
      calls.push([name, ...args]);
      return builder;
    };
  };
  for (const m of ["select", "eq", "neq", "in", "is"]) chain(m);
  builder.then = (resolve: (v: unknown) => void) => resolve(result);
  return { from: (table: string) => { calls.push(["from", table]); return builder; } } as unknown as SupabaseClient;
}

describe("canHostSpace", () => {
  it("admin → true without touching the database", async () => {
    expect(await canHostSpace(null, admin, "s1", "c1")).toBe(true);
  });

  it("students and parents → false without touching the database", async () => {
    expect(await canHostSpace(null, student, "s1", "c1")).toBe(false);
    expect(await canHostSpace(null, parent, "s1", "c1")).toBe(false);
  });

  it("teacher → true only with a non-cancelled session for that student AND course", async () => {
    const calls: unknown[][] = [];
    expect(await canHostSpace(fakeAdmin({ count: 2, error: null }, calls), teacher, "s1", "c1")).toBe(true);
    expect(calls).toEqual(
      expect.arrayContaining([
        ["from", "sessions"],
        ["select", "id", { count: "exact", head: true }],
        ["eq", "teacher_id", "t1"],
        ["eq", "student_id", "s1"],
        ["eq", "course_id", "c1"],
        ["neq", "status", "cancelled"],
      ]),
    );
    expect(await canHostSpace(fakeAdmin({ count: 0, error: null }), teacher, "s1", "c1")).toBe(false);
    expect(await canHostSpace(fakeAdmin({ count: null, error: null }), teacher, "s1", "c1")).toBe(false);
  });

  it("fails closed on a missing client or a query error", async () => {
    expect(await canHostSpace(null, teacher, "s1", "c1")).toBe(false);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await canHostSpace(fakeAdmin({ count: 5, error: { message: "boom" } }), teacher, "s1", "c1")).toBe(false);
    errSpy.mockRestore();
  });
});
