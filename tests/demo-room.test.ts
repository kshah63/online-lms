import { describe, expect, it } from "vitest";
import {
  DEMO_IDS,
  buildDemoLessonRoomState,
  buildDemoOnlineLessons,
  buildDemoSessionRequests,
  demoProfiles,
  demoRoomAccess,
} from "@/lib/demo/data";

const by = (id: string) => demoProfiles.find((p) => p.id === id)!;
const LIVE = "20000000-0000-0000-0000-000000000002"; // Maya + Sofia, started 10 minutes ago

describe("demo dataset — mv-app shapes with stable ids", () => {
  it("keeps the ids existing scripts rely on, and adds staff and support", () => {
    expect(by(DEMO_IDS.maya).role).toBe("teacher");
    expect(by(DEMO_IDS.sofia).role).toBe("student");
    expect(by(DEMO_IDS.aarav).role).toBe("student");
    expect(by(DEMO_IDS.priya).role).toBe("parent");
    expect(by(DEMO_IDS.admin).role).toBe("admin");
    expect(by(DEMO_IDS.grace).role).toBe("staff");
    expect(by(DEMO_IDS.ravi).role).toBe("support");
  });

  it("puts a parent and their child in the same family", () => {
    expect(by(DEMO_IDS.priya).family_id).toBe(by(DEMO_IDS.aarav).family_id);
    expect(by(DEMO_IDS.priya).family_id).not.toBe(by(DEMO_IDS.sofia).family_id);
  });

  it("books only online sessions, each with a student id and a department", () => {
    for (const s of buildDemoSessionRequests()) {
      expect(s.mode).toBe("online");
      expect(s.student_id).toMatch(/^0000/);
      expect(s.department_id).toMatch(/^d000/);
    }
  });
});

describe("demoRoomAccess / lesson_room_state — seats as room_access would decide them", () => {
  const live = buildDemoSessionRequests().find((s) => s.id === LIVE)!;

  it("gives the assigned teacher the host seat and the student the learner seat while the room is open", () => {
    expect(demoRoomAccess(by(DEMO_IDS.maya), live)).toBe("host");
    expect(demoRoomAccess(by(DEMO_IDS.sofia), live)).toBe("learner");
  });

  it("gives the office the observer seat and a parent none", () => {
    expect(demoRoomAccess(by(DEMO_IDS.admin), live)).toBe("observer");
    expect(demoRoomAccess(by(DEMO_IDS.grace), live)).toBe("observer"); // in charge of Online Mathematics
    expect(demoRoomAccess(by(DEMO_IDS.ravi), live)).toBe("observer");
    expect(demoRoomAccess(by(DEMO_IDS.marco), live)).toBeNull(); // Sofia's parent: no seat in a 1-1 lesson
    expect(demoRoomAccess(by(DEMO_IDS.daniel), live)).toBeNull(); // another teacher
    expect(demoRoomAccess(by(DEMO_IDS.aarav), live)).toBeNull(); // another student
  });

  it("closes the room for the teacher and student outside the window, but not for the office", () => {
    const later = Date.parse(live.ends_at) + 31 * 60_000;
    expect(demoRoomAccess(by(DEMO_IDS.maya), live, later)).toBeNull();
    expect(demoRoomAccess(by(DEMO_IDS.sofia), live, later)).toBeNull();
    expect(demoRoomAccess(by(DEMO_IDS.admin), live, later)).toBe("observer");
  });

  it("builds a full state row for a seated viewer and none for anybody else", () => {
    const state = buildDemoLessonRoomState(LIVE, by(DEMO_IDS.sofia))!;
    expect(state.seat).toBe("learner");
    expect(state.course_name).toBe("SAT Math Prep");
    expect(state.teacher_name).toBe("Maya Chen");
    expect(state.student_name).toBe("Sofia Rossi");
    expect(state.materials_course_id).toMatch(/^aaaa/);
    expect(state.notebook_id).toContain("sofia");
    expect(state.consents).toEqual({ recording: true, transcript: true, ai_analysis: true, integrity_camera: true });
    expect(buildDemoLessonRoomState(LIVE, by(DEMO_IDS.marco))).toBeNull();
    expect(buildDemoLessonRoomState("not-a-session", by(DEMO_IDS.admin))).toBeNull();
  });
});

describe("my_online_lessons (demo) — each viewer's rows and seats", () => {
  it("lists a teacher's lessons as host, sorted by start", () => {
    const rows = buildDemoOnlineLessons(by(DEMO_IDS.maya));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.seat === "host" && r.teacher_id === DEMO_IDS.maya)).toBe(true);
    const starts = rows.map((r) => r.effective_start);
    expect([...starts].sort()).toEqual(starts);
  });

  it("lists a student's lessons as learner and the parent's as family", () => {
    expect(buildDemoOnlineLessons(by(DEMO_IDS.aarav)).every((r) => r.seat === "learner")).toBe(true);
    const priya = buildDemoOnlineLessons(by(DEMO_IDS.priya));
    expect(priya.length).toBeGreaterThan(0);
    expect(priya.every((r) => r.seat === "family" && r.student_id === DEMO_IDS.aarav)).toBe(true);
  });

  it("lists the in-charge's own room only, and everything for an admin", () => {
    const grace = buildDemoOnlineLessons(by(DEMO_IDS.grace));
    expect(grace.every((r) => r.seat === "observer" && r.subject !== "A-Level Physics")).toBe(true);
    expect(buildDemoOnlineLessons(by(DEMO_IDS.admin)).length).toBe(buildDemoSessionRequests().length);
  });

  it("marks a completed lesson without a report as draft-ready", () => {
    const rows = buildDemoOnlineLessons(by(DEMO_IDS.maya), 30);
    const reported = rows.find((r) => r.session_id === "20000000-0000-0000-0000-000000000001")!;
    const unreported = rows.find((r) => r.session_id === "20000000-0000-0000-0000-000000000006")!;
    expect(reported.report_status).toBe("published");
    expect(reported.draft_ready).toBe(false);
    expect(unreported.report_id).toBeNull();
    expect(unreported.draft_ready).toBe(true);
  });
});
