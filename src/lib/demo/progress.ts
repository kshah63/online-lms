import { DateTime } from "luxon";
import {
  DEMO_IDS,
  buildDemoSessionRequests,
  demoCourses,
  demoInchargeDepartments,
  demoProfiles,
  demoSessionReports,
  type DemoSessionRequest,
} from "@/lib/demo/data";
import { practiceByWeek, type TopicSignals, type TopicStatus } from "@/lib/syllabus/progress";
import type { ChildProgressRpc } from "@/lib/syllabus/from-rpc";
import { firstName, type Course, type Profile } from "@/lib/types";

// ============================================================================
// Demo rows for the syllabus and progress: syllabus_topics per course, the
// teachers' marks, at-home practice, and rpc child_progress as the demo
// answers it — the same jsonb shape, so the one mapper (from-rpc.ts) runs in
// both modes. Signals are anchored to "now" so the recency weighting reads
// the way it would live. Used only when isDemoMode is true.
// ============================================================================

const ID = DEMO_IDS;
const [IGCSE, SAT, PHYS] = demoCourses as [Course, Course, Course];

export interface DemoSyllabusTopic {
  id: string;
  course_id: string;
  label: string;
  sort_order: number;
}

function topic(courseId: string, n: number, label: string): DemoSyllabusTopic {
  const prefix = courseId === IGCSE.id ? "1" : courseId === SAT.id ? "2" : "3";
  return { id: `50000000-0000-0000-0000-0000000${prefix}${String(n).padStart(3, "0")}`, course_id: courseId, label, sort_order: n };
}

/** syllabus_topics: seeded from course_topics and extended by the in-charge. */
export const demoSyllabusTopics: DemoSyllabusTopic[] = [
  topic(IGCSE.id, 1, "Number and indices"),
  topic(IGCSE.id, 2, "Algebraic manipulation"),
  topic(IGCSE.id, 3, "Linear equations"),
  topic(IGCSE.id, 4, "Quadratic equations"),
  topic(IGCSE.id, 5, "Completing the square"),
  topic(IGCSE.id, 6, "Simultaneous equations"),
  topic(IGCSE.id, 7, "Trigonometry — sine rule"),
  topic(IGCSE.id, 8, "Functions and graphs"),
  topic(IGCSE.id, 9, "Sequences"),
  topic(IGCSE.id, 10, "Probability"),
  topic(SAT.id, 1, "Linear equations and inequalities"),
  topic(SAT.id, 2, "Linear systems"),
  topic(SAT.id, 3, "Function transformations"),
  topic(SAT.id, 4, "Quadratic functions"),
  topic(SAT.id, 5, "Exponential growth"),
  topic(SAT.id, 6, "Ratios and percentages"),
  topic(SAT.id, 7, "Data analysis"),
  topic(SAT.id, 8, "Geometry and trigonometry"),
  topic(PHYS.id, 1, "Kinematics"),
  topic(PHYS.id, 2, "Newtonian mechanics — momentum"),
  topic(PHYS.id, 3, "Circular motion"),
  topic(PHYS.id, 4, "Energy and work"),
  topic(PHYS.id, 5, "Waves"),
  topic(PHYS.id, 6, "Electric fields"),
];

export function demoTopicsForCourse(courseId: string): DemoSyllabusTopic[] {
  return demoSyllabusTopics.filter((t) => t.course_id === courseId).sort((a, b) => a.sort_order - b.sort_order);
}

function topicByLabel(courseId: string, label: string): DemoSyllabusTopic {
  const t = demoSyllabusTopics.find((x) => x.course_id === courseId && x.label === label);
  if (!t) throw new Error(`demo syllabus has no topic "${label}" on ${courseId}`);
  return t;
}

/** syllabus_teacher_marks rows. */
export interface DemoTeacherMark {
  student_id: string;
  syllabus_topic_id: string;
  status: TopicStatus;
  note: string | null;
  marked_by: string;
  marked_at: string;
}

const daysAgo = (n: number, nowISO: string) => DateTime.fromISO(nowISO, { zone: "utc" }).minus({ days: n }).toISO()!;

export function demoTeacherMarks(nowISO = new Date().toISOString()): DemoTeacherMark[] {
  return [
    { student_id: ID.aarav, syllabus_topic_id: topicByLabel(IGCSE.id, "Sequences").id, status: "secure", note: "Solid on nth term", marked_by: ID.maya, marked_at: daysAgo(19, nowISO) },
    { student_id: ID.aarav, syllabus_topic_id: topicByLabel(IGCSE.id, "Quadratic equations").id, status: "needs_work", note: "Simplify the surds at the end", marked_by: ID.maya, marked_at: daysAgo(1, nowISO) },
    { student_id: ID.sofia, syllabus_topic_id: topicByLabel(SAT.id, "Linear systems").id, status: "in_progress", note: "Systems with no solution next", marked_by: ID.maya, marked_at: daysAgo(6, nowISO) },
  ];
}

/** practice_assignments with their latest attempt, the way lesson_brief_facts lists open practice. */
export interface DemoPracticeAssignment {
  assignment_id: string;
  student_id: string;
  course_id: string;
  set_title: string;
  kind: "practice" | "quick_check" | "test";
  due_at: string | null;
  created_at: string;
  attempt_status: "in_progress" | "submitted" | "marked" | "void" | null;
  score: number | null;
  out_of: number | null;
}

export function demoPracticeAssignments(nowISO = new Date().toISOString()): DemoPracticeAssignment[] {
  return [
    { assignment_id: "60000000-0000-0000-0000-000000000001", student_id: ID.sofia, course_id: SAT.id, set_title: "Practice set 3 — substitution and elimination", kind: "practice", due_at: daysAgo(-1, nowISO), created_at: daysAgo(6, nowISO), attempt_status: "marked", score: 8, out_of: 10 },
    { assignment_id: "60000000-0000-0000-0000-000000000002", student_id: ID.sofia, course_id: SAT.id, set_title: "Function transformations warm-up", kind: "practice", due_at: daysAgo(-2, nowISO), created_at: daysAgo(2, nowISO), attempt_status: null, score: null, out_of: null },
    { assignment_id: "60000000-0000-0000-0000-000000000003", student_id: ID.aarav, course_id: IGCSE.id, set_title: "Quadratic formula worksheet", kind: "practice", due_at: daysAgo(-3, nowISO), created_at: daysAgo(1, nowISO), attempt_status: "in_progress", score: null, out_of: null },
    { assignment_id: "60000000-0000-0000-0000-000000000004", student_id: ID.aarav, course_id: IGCSE.id, set_title: "Quadratics topic test", kind: "test", due_at: null, created_at: daysAgo(5, nowISO), attempt_status: "marked", score: 11, out_of: 20 },
  ];
}

// --- the signals behind each child's progress ------------------------------

type Signals = Omit<TopicSignals, "topic_id" | "teacher_mark">;

const none: Signals = { sessions: [], practice: [], tests: [] };

function signalsFor(studentId: string, courseId: string, nowISO: string): Record<string, Signals> {
  const d = (n: number) => daysAgo(n, nowISO);
  if (studentId === ID.aarav && courseId === IGCSE.id) {
    return {
      "Number and indices": { sessions: [{ at: d(70), completed: true }], practice: [{ at: d(60), correct: 9, total: 10 }, { at: d(30), correct: 8, total: 8 }], tests: [{ at: d(50), score: 18, out_of: 20 }] },
      "Algebraic manipulation": { sessions: [{ at: d(56), completed: true }], practice: [{ at: d(40), correct: 7, total: 10 }, { at: d(12), correct: 9, total: 10 }], tests: [] },
      "Linear equations": { sessions: [{ at: d(42), completed: true }], practice: [{ at: d(35), correct: 10, total: 12 }], tests: [{ at: d(28), score: 15, out_of: 20 }] },
      "Quadratic equations": { sessions: [{ at: d(21), completed: true }, { at: d(1), completed: true }], practice: [{ at: d(13), correct: 4, total: 10 }, { at: d(6), correct: 5, total: 10 }, { at: d(2), correct: 3, total: 6 }], tests: [{ at: d(5), score: 11, out_of: 20 }] },
      "Completing the square": { sessions: [{ at: d(0), completed: true }], practice: [{ at: d(0), correct: 4, total: 5 }], tests: [] },
      "Simultaneous equations": { sessions: [{ at: d(7), completed: false }], practice: [{ at: d(3), correct: 2, total: 4 }], tests: [] },
      "Sequences": { sessions: [{ at: d(35), completed: true }], practice: [{ at: d(20), correct: 8, total: 10 }], tests: [] },
    };
  }
  if (studentId === ID.sofia && courseId === SAT.id) {
    return {
      "Linear equations and inequalities": { sessions: [{ at: d(21), completed: true }], practice: [{ at: d(18), correct: 9, total: 10 }, { at: d(9), correct: 10, total: 10 }], tests: [] },
      "Linear systems": { sessions: [{ at: d(7), completed: false }], practice: [{ at: d(6), correct: 8, total: 10 }], tests: [] },
      "Function transformations": { sessions: [], practice: [{ at: d(2), correct: 3, total: 6 }], tests: [] },
      "Ratios and percentages": { sessions: [{ at: d(28), completed: true }], practice: [{ at: d(26), correct: 5, total: 10 }, { at: d(15), correct: 6, total: 10 }], tests: [{ at: d(14), score: 12, out_of: 20 }] },
    };
  }
  if (studentId === ID.lena && courseId === PHYS.id) {
    return {
      Kinematics: { sessions: [{ at: d(14), completed: true }], practice: [{ at: d(10), correct: 7, total: 8 }], tests: [] },
    };
  }
  return {};
}

/** Test names for the "Recent tests" list, keyed by course and topic label. */
function testName(courseId: string, label: string): string {
  if (courseId === IGCSE.id && label === "Quadratic equations") return "Quadratics topic test";
  if (courseId === IGCSE.id && label === "Linear equations") return "Linear equations check";
  if (courseId === IGCSE.id && label === "Number and indices") return "Indices quiz (at home)";
  if (courseId === SAT.id && label === "Ratios and percentages") return "Ratios timed test";
  return `${label} test`;
}

/**
 * The online courses a student has sessions on, as the course picker lists
 * them — the session_requests rows the viewer may read (the household's
 * own, an in-charge's room, the assigned teacher's and admin's
 * all), mirroring session_requests_select.
 */
export function demoProgressCourses(viewer: Profile, studentId: string): { id: string; name: string }[] {
  const student = demoProfiles.find((p) => p.id === studentId);
  const rooms = demoInchargeDepartments[viewer.id] ?? [];
  const readable = buildDemoSessionRequests().filter(
    (s) =>
      s.student_id === studentId &&
      ((student?.family_id != null && viewer.family_id === student.family_id) ||
        viewer.role === "admin" ||
        (viewer.role === "staff" && rooms.includes(s.department_id)) ||
        s.assigned_teacher_id === viewer.id),
  );
  const ids = new Set(readable.map((s) => s.course_id));
  return demoCourses.filter((c) => ids.has(c.id)).map((c) => ({ id: c.id, name: c.name }));
}

/**
 * Mirrors child_progress's gate: the student, their household, an in-charge
 * whose room the student's sessions are in, an admin, or a teacher
 * with a session for the student on that course within a fortnight.
 */
export function demoMayReadProgress(viewer: Profile, studentId: string, courseId: string, nowMs = Date.now()): boolean {
  if (viewer.id === studentId) return true;
  const student = demoProfiles.find((p) => p.id === studentId);
  if (!student) return false;
  if (viewer.role === "parent" && viewer.family_id && viewer.family_id === student.family_id) return true;
  // Support has no seat: child_progress reaches a child through room_reaches,
  // which admits in-charges only (the desk reads nothing about a child here).
  if (viewer.role === "admin") return true;
  const sessions = buildDemoSessionRequests().filter((s) => s.student_id === studentId);
  if (viewer.role === "staff") {
    const rooms = demoInchargeDepartments[viewer.id] ?? [];
    return sessions.some((s) => rooms.includes(s.department_id));
  }
  if (viewer.role === "teacher") {
    const fortnight = 14 * 86_400_000;
    return sessions.some((s) => s.course_id === courseId && s.assigned_teacher_id === viewer.id && Math.abs(Date.parse(s.effective_start) - nowMs) <= fortnight);
  }
  return false;
}

/** rpc child_progress(p_student_id, p_course_id), as the demo answers it. */
export function buildDemoChildProgress(studentId: string, courseId: string, nowISO = new Date().toISOString()): ChildProgressRpc {
  const student = demoProfiles.find((p) => p.id === studentId);
  const course = demoCourses.find((c) => c.id === courseId);
  if (!student) throw new Error("no such student");
  if (!course) throw new Error("no such course");

  const signals = signalsFor(studentId, courseId, nowISO);
  const marks = demoTeacherMarks(nowISO).filter((m) => m.student_id === studentId);
  const topics: ChildProgressRpc["topics"] = demoTopicsForCourse(courseId).map((t) => {
    const s = signals[t.label] ?? none;
    const mark = marks.find((m) => m.syllabus_topic_id === t.id) ?? null;
    return {
      id: t.id,
      label: t.label,
      sort_order: t.sort_order,
      sessions: s.sessions,
      practice: s.practice,
      tests: s.tests,
      teacher_mark: mark ? { status: mark.status, at: mark.marked_at, note: mark.note } : null,
    };
  });

  const allPractice = topics.flatMap((t) => t.practice);
  const nowMs = Date.parse(nowISO);
  const inWindow = (at: string, from: number, to: number) => {
    const days = (nowMs - Date.parse(at)) / 86_400_000;
    return days >= from && days < to;
  };
  const sum = (from: number, to: number) => {
    const rows = allPractice.filter((p) => inWindow(p.at, from, to));
    return { correct: rows.reduce((a, p) => a + p.correct, 0), total: rows.reduce((a, p) => a + p.total, 0) };
  };

  const eightWeeks = nowMs - 56 * 86_400_000;
  const booked = buildDemoSessionRequests().filter(
    (s: DemoSessionRequest) =>
      s.student_id === studentId && s.course_id === courseId && (s.status === "confirmed" || s.status === "completed") && Date.parse(s.effective_start) >= eightWeeks && Date.parse(s.effective_start) <= nowMs,
  );

  const tests = topics
    .flatMap((t) => t.tests.map((x, i) => ({ attempt_id: `${t.id}-test-${i}`, name: testName(courseId, t.label), at: x.at, score: x.score, out_of: x.out_of, topic_label: t.label, flagged: t.label === "Number and indices" })))
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 10);

  const reports = demoSessionReports
    .filter((r) => r.student_id === studentId && r.status === "published" && r.course_name === course.name)
    .sort((a, b) => ((a.published_at ?? "") < (b.published_at ?? "") ? 1 : -1))
    .slice(0, 5)
    .map((r) => ({ id: r.id, at: r.published_at ?? r.created_at, topic: r.topic, understanding: r.understanding, homework: r.homework }));

  return {
    student: { id: student.id, first_name: firstName(student) },
    course: { id: course.id, name: course.name },
    generated_at: nowISO,
    topics,
    weekly_practice: practiceByWeek(allPractice, 8, nowISO),
    accuracy: { current: sum(0, 56), previous: sum(56, 112) },
    attendance: { attended: booked.filter((s) => s.arrived_at != null).length, booked: booked.length, weeks: 8 },
    tests,
    reports,
  };
}
