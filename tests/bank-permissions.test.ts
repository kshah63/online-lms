import { describe, expect, it } from "vitest";
import { demoManagedCourses, demoManagesCourse, mayManageCourses } from "@/lib/permissions-bank";
import { DEMO_IDS, demoCourses, demoProfiles } from "@/lib/demo/data";
import { demoCourseStudents, demoPracticeSets, demoQuestions } from "@/lib/demo/bank";
import { demoSeedSyllabus, demoSyllabusTopics } from "@/lib/demo/syllabus";
import { QUESTION_STATUSES, QUESTION_TYPES } from "@/lib/bank/types";
import { ROLES } from "@/lib/types";

const by = (id: string) => demoProfiles.find((p) => p.id === id)!;
const [IGCSE, SAT, PHYS] = demoCourses;

describe("manages_course, as the demo mirrors it", () => {
  it("can only ever say yes to admin, staff and support", () => {
    expect(ROLES.filter(mayManageCourses)).toEqual(["staff", "support", "admin"]);
  });

  it("gives the in-charge their own room's courses and nothing in another room", () => {
    const grace = by(DEMO_IDS.grace);
    expect(demoManagesCourse(grace, IGCSE!)).toBe(true);
    expect(demoManagesCourse(grace, SAT!)).toBe(true);
    expect(demoManagesCourse(grace, PHYS!)).toBe(false);
    expect(demoManagedCourses(grace).map((c) => c.name)).toEqual(["IGCSE Mathematics", "SAT Math Prep"]);
  });

  it("gives an admin every course, and support with no in-charge seat none", () => {
    expect(demoManagedCourses(by(DEMO_IDS.admin))).toHaveLength(demoCourses.length);
    expect(demoManagedCourses(by(DEMO_IDS.ravi))).toEqual([]);
  });

  it("never lets a teacher, a student or a parent in — their bank page is a 404", () => {
    for (const id of [DEMO_IDS.maya, DEMO_IDS.daniel, DEMO_IDS.aarav, DEMO_IDS.sofia, DEMO_IDS.priya, DEMO_IDS.marco]) {
      expect(demoManagedCourses(by(id))).toEqual([]);
      expect(demoManagesCourse(by(id), IGCSE!)).toBe(false);
    }
  });
});

describe("demo bank rows — the shapes the live tables hold", () => {
  it("puts every question on a demo course with a known type, status and difficulty", () => {
    const courseIds = new Set(demoCourses.map((c) => c.id));
    for (const q of demoQuestions) {
      expect(courseIds.has(q.course_id)).toBe(true);
      expect(QUESTION_TYPES).toContain(q.type);
      expect(QUESTION_STATUSES).toContain(q.status);
      expect(q.difficulty).toBeGreaterThanOrEqual(1);
      expect(q.difficulty).toBeLessThanOrEqual(5);
      if (q.syllabus_topic_id) expect(demoSyllabusTopics.some((t) => t.id === q.syllabus_topic_id && t.course_id === q.course_id)).toBe(true);
    }
  });

  it("covers the three status chips and the five editors on the in-charge's course", () => {
    const igcse = demoQuestions.filter((q) => q.course_id === IGCSE!.id);
    expect(new Set(igcse.map((q) => q.status))).toEqual(new Set(QUESTION_STATUSES));
    expect(new Set(igcse.map((q) => q.type))).toEqual(new Set(QUESTION_TYPES));
  });

  it("stores answers in the contract's jsonb shape", () => {
    for (const q of demoQuestions) {
      if (q.type === "mcq" && q.answer != null) expect(typeof q.answer).toBe("string");
      if (q.type === "multi_select") expect(Array.isArray(q.answer)).toBe(true);
      if (q.type === "numeric") expect(typeof q.answer).toBe("number");
      if (q.type === "short") expect(typeof q.answer).toBe("string");
      if (q.type === "worked") expect(q.answer).toBeNull();
    }
  });

  it("lists both maths students on each maths course and only Lena on physics", () => {
    expect(demoCourseStudents(IGCSE!.id).map((s) => s.name)).toEqual(["Aarav Sharma", "Sofia Rossi"]);
    expect(demoCourseStudents(SAT!.id)).toHaveLength(2);
    expect(demoCourseStudents(PHYS!.id).map((s) => s.name)).toEqual(["Lena Park"]);
  });

  it("holds a live set to assign, with a question count", () => {
    expect(demoPracticeSets.filter((s) => s.status === "live" && s.course_id === IGCSE!.id).length).toBeGreaterThan(0);
    for (const s of demoPracticeSets) expect(s.question_count).toBeGreaterThan(0);
  });
});

describe("demo syllabus — seeded from course_topics, then edited", () => {
  it("keys the seeded rows to a course topic and leaves the hand-added ones unkeyed", () => {
    const igcse = demoSyllabusTopics.filter((t) => t.course_id === IGCSE!.id);
    expect(igcse.filter((t) => t.course_topic_id).length).toBe(4);
    expect(igcse.filter((t) => !t.course_topic_id).length).toBe(2);
    expect(igcse.filter((t) => !t.is_active).length).toBe(1);
  });

  it("seeds only what is missing: nothing more for IGCSE, both course topics for SAT", () => {
    expect(demoSeedSyllabus(IGCSE!.id, demoSyllabusTopics.filter((t) => t.course_id === IGCSE!.id))).toEqual([]);
    const sat = demoSeedSyllabus(SAT!.id, []);
    expect(sat.map((t) => t.label)).toEqual(["Function transformations", "Linear systems"]);
    expect(sat.every((t) => t.course_topic_id && t.is_active)).toBe(true);
    expect(sat.map((t) => t.sort_order)).toEqual([10, 20]);
  });
});
