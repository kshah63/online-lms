import { DateTime } from "luxon";
import { DEMO_IDS, buildDemoSessionRequests, demoConsents, demoCourses, demoInchargeDepartments, demoProfiles, demoRoomAccess } from "@/lib/demo/data";
import { markQuestion } from "@/lib/practice/marking";
import type { McqOption, Question, QuestionType, Response } from "@/lib/practice/model";
import { toResponse, type AnswerVerdict, type AssignmentMode, type AttemptQuestionRow, type AttemptRecord, type AttemptReview, type AttemptStatus, type IntegrityEventRow, type LiveAttempt, type PracticeKind, type PracticeRow, type SubmitResult } from "@/lib/practice/attempts";
import { displayName, type Profile } from "@/lib/types";

// ============================================================================
// The practice tables and RPCs, as the demo answers them. State lives in memory
// for the server process (on globalThis, so a dev-server recompile keeps it):
// an attempt can be started, answered, submitted and reviewed end to end, and
// the permission rules mirror the policies so a wrong persona is refused the
// same way the database would refuse it. Used only when isDemoMode is true.
// ============================================================================

const [IGCSE, SAT, PHYS] = demoCourses;

export interface DemoQuestion {
  id: string;
  course_id: string;
  syllabus_topic_id: string | null;
  topic_label: string | null;
  type: QuestionType;
  stem: string;
  options: McqOption[] | null;
  answer: unknown;
  tolerance: number | null;
  unit: string | null;
  accepted: string[] | null;
  difficulty: number;
  marks: number;
  worked_solution: string | null;
  image_path: string | null;
  status: "draft" | "approved" | "retired";
  created_by: string;
}

export interface DemoSet {
  id: string;
  course_id: string;
  kind: PracticeKind;
  title: string;
  syllabus_topic_id: string | null;
  time_limit_minutes: number | null;
  integrity_settings: Record<string, unknown>;
  status: "draft" | "live" | "retired";
  created_by: string;
  question_ids: string[];
  created_at: string;
}

export interface DemoAssignment {
  id: string;
  set_id: string;
  student_id: string;
  session_id: string | null;
  assigned_by: string;
  due_at: string | null;
  mode: AssignmentMode;
  created_at: string;
}

export interface DemoAnswer {
  question_id: string;
  response: Record<string, unknown>;
  is_correct: boolean | null;
  marks_awarded: number | null;
  marked_by: string | null;
  feedback: string | null;
  answered_at: string;
}

export interface DemoAttempt extends AttemptRecord {
  answers: Map<string, DemoAnswer>;
  events: IntegrityEventRow[];
}

export interface DemoLessonEvent {
  session_id: string;
  at: string;
  kind: string;
  payload: Record<string, unknown>;
  actor_id: string;
}

interface Store {
  questions: DemoQuestion[];
  sets: DemoSet[];
  assignments: DemoAssignment[];
  attempts: Map<string, DemoAttempt>;
  lessonEvents: DemoLessonEvent[];
  seq: number;
}

const g = globalThis as unknown as { __mvDemoPractice?: Store };

function store(): Store {
  if (!g.__mvDemoPractice) g.__mvDemoPractice = seed();
  return g.__mvDemoPractice;
}

/** Tests start from the seed again. */
export function resetDemoPractice(): void {
  g.__mvDemoPractice = seed();
}

// --- the seed ------------------------------------------------------------------

const Q = (n: number) => `50000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const S = (n: number) => `51000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const A = (n: number) => `52000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const T = (n: number) => `53000000-0000-0000-0000-${String(n).padStart(12, "0")}`;

/** Stable ids for scripts: the seeded assignments and attempts. */
export const DEMO_PRACTICE_IDS = {
  sofiaPracticeAssignment: A(1),
  sofiaTestAssignment: A(2),
  sofiaSubmittedAttempt: T(3),
  aaravInProgressAttempt: T(4),
  aaravFlaggedAttempt: T(5),
  aaravQuickCheckAttempt: T(6),
  quickCheckSession: "20000000-0000-0000-0000-000000000001",
} as const;

function mcq(id: string, course: string, topic: string, stem: string, options: [string, string, string, string], answer: string, solution: string, by = DEMO_IDS.grace): DemoQuestion {
  return { id, course_id: course, syllabus_topic_id: null, topic_label: topic, type: "mcq", stem, options: options.map((text, i) => ({ key: "ABCD"[i]!, text })), answer, tolerance: null, unit: null, accepted: null, difficulty: 2, marks: 1, worked_solution: solution, image_path: null, status: "approved", created_by: by };
}
function numeric(id: string, course: string, topic: string, stem: string, answer: number, solution: string, unit: string | null = null, marks = 1): DemoQuestion {
  return { id, course_id: course, syllabus_topic_id: null, topic_label: topic, type: "numeric", stem, options: null, answer, tolerance: null, unit, accepted: null, difficulty: 2, marks, worked_solution: solution, image_path: null, status: "approved", created_by: DEMO_IDS.grace };
}
function short(id: string, course: string, topic: string, stem: string, answer: string, accepted: string[], solution: string): DemoQuestion {
  return { id, course_id: course, syllabus_topic_id: null, topic_label: topic, type: "short", stem, options: null, answer, tolerance: null, unit: null, accepted, difficulty: 2, marks: 1, worked_solution: solution, image_path: null, status: "approved", created_by: DEMO_IDS.grace };
}
function multi(id: string, course: string, topic: string, stem: string, options: [string, string, string, string], answers: string[], solution: string): DemoQuestion {
  return { id, course_id: course, syllabus_topic_id: null, topic_label: topic, type: "multi_select", stem, options: options.map((text, i) => ({ key: "ABCD"[i]!, text })), answer: answers, tolerance: null, unit: null, accepted: null, difficulty: 3, marks: 2, worked_solution: solution, image_path: null, status: "approved", created_by: DEMO_IDS.grace };
}
function worked(id: string, course: string, topic: string, stem: string, marks: number, solution: string): DemoQuestion {
  return { id, course_id: course, syllabus_topic_id: null, topic_label: topic, type: "worked", stem, options: null, answer: null, tolerance: null, unit: null, accepted: null, difficulty: 4, marks, worked_solution: solution, image_path: null, status: "approved", created_by: DEMO_IDS.grace };
}

function seedQuestions(): DemoQuestion[] {
  return [
    // SAT Math Prep
    mcq(Q(1), SAT.id, "Function transformations", "If $f(x) = x^2$, which equation is the graph of $f$ shifted **3 units right** and **2 units up**?", ["$y = (x-3)^2 + 2$", "$y = (x+3)^2 + 2$", "$y = (x-3)^2 - 2$", "$y = (x+2)^2 + 3$"], "A", "A shift right by $h$ replaces $x$ with $x - h$; a shift up adds. So $y = (x-3)^2 + 2$."),
    numeric(Q(2), SAT.id, "Function transformations", "The line $y = 2x + 1$ is reflected in the $x$-axis. What is the $y$-intercept of the image?", -1, "Reflecting in the $x$-axis negates $y$: $y = -2x - 1$, whose intercept is $-1$."),
    short(Q(3), SAT.id, "Linear systems", "Solve the system $x + y = 7$, $x - y = 1$. Write the solution as an ordered pair $(x, y)$.", "(4,3)", ["(4, 3)", "x=4,y=3", "x=4, y=3"], "Adding the equations gives $2x = 8$, so $x = 4$ and $y = 3$."),
    multi(Q(4), SAT.id, "Linear systems", "Which of these systems have **no solution**?", ["$y = 2x + 1$ and $y = 2x - 3$", "$y = x + 1$ and $y = -x + 1$", "$2y = 4x + 2$ and $y = 2x + 1$", "$y = 3x$ and $y = 3x + 5$"], ["A", "D"], "Parallel lines with different intercepts never meet: A and D. C is the same line twice; B crosses once."),
    worked(Q(5), SAT.id, "Linear systems", "Solve by elimination, showing your working:\n\n$$3x + 2y = 12 \\qquad x - 2y = 4$$", 3, "Add the equations: $4x = 16$, so $x = 4$. Then $4 - 2y = 4$ gives $y = 0$."),
    numeric(Q(6), SAT.id, "Function transformations", "What is the $x$-coordinate of the vertex of $y = (x-5)^2 + 1$?", 5, "Vertex form $y = (x-h)^2 + k$ has its vertex at $(h, k)$, so $x = 5$."),
    mcq(Q(7), SAT.id, "Function transformations", "Which transformation maps $y = |x|$ onto $y = -|x| + 4$?", ["Reflect in the $x$-axis, then shift up 4", "Shift up 4, then reflect in the $y$-axis", "Reflect in the $y$-axis, then shift down 4", "Stretch by 4, then reflect in the $x$-axis"], "A", "The minus sign flips the graph over the $x$-axis; the $+4$ lifts it."),
    numeric(Q(8), SAT.id, "Function transformations", "If $g(x) = f(x - 2)$ and $f(1) = 7$, what is $g(3)$?", 7, "$g(3) = f(3 - 2) = f(1) = 7$."),
    // IGCSE Mathematics
    mcq(Q(11), IGCSE.id, "Completing the square", "Which of the following is the **vertex form** of $y = x^2 - 6x + 5$?", ["$y = (x-3)^2 - 4$", "$y = (x+3)^2 - 4$", "$y = (x-3)^2 + 5$", "$y = (x-6)^2 - 31$"], "A", "Complete the square: $x^2 - 6x + 5 = (x-3)^2 - 9 + 5 = (x-3)^2 - 4$."),
    numeric(Q(12), IGCSE.id, "Quadratic equations", "Find the root of $x^2 - 5x + 6 = 0$ that is larger than $2.5$.", 3, "$(x-2)(x-3) = 0$, so $x = 2$ or $x = 3$. The root larger than $2.5$ is $x = 3$."),
    short(Q(13), IGCSE.id, "Quadratic equations", "Factorise $x^2 - 5x + 6$.", "(x-2)(x-3)", ["(x-3)(x-2)"], "Two numbers that multiply to $6$ and add to $-5$: $-2$ and $-3$."),
    multi(Q(14), IGCSE.id, "Number", "Which of these are prime?", ["2", "9", "17", "21"], ["A", "C"], "$9 = 3 \\times 3$ and $21 = 3 \\times 7$; $2$ and $17$ have no other factors."),
    worked(Q(15), IGCSE.id, "Completing the square", "Solve $2x^2 + 3x - 2 = 0$ by completing the square. Show your working.", 4, "Divide by 2: $x^2 + \\tfrac{3}{2}x - 1 = 0$. Then $(x + \\tfrac{3}{4})^2 = \\tfrac{25}{16}$, so $x = \\tfrac{1}{2}$ or $x = -2$."),
    numeric(Q(16), IGCSE.id, "Quadratic equations", "Solve $x^2 - 4x + 4 = 0$.", 2, "$(x-2)^2 = 0$, so $x = 2$ (a repeated root)."),
    mcq(Q(17), IGCSE.id, "Quadratic equations", "The discriminant of $2x^2 + 3x - 5 = 0$ is", ["49", "$-31$", "9", "31"], "A", "$b^2 - 4ac = 9 - 4(2)(-5) = 9 + 40 = 49$."),
    // A-Level Physics
    numeric(Q(21), PHYS.id, "Newtonian mechanics — momentum", "A $2\\,\\text{kg}$ mass moves at $3\\,\\text{m/s}$. What is its momentum?", 6, "$p = mv = 2 \\times 3 = 6\\,\\text{kg m/s}$.", "kg m/s"),
    mcq(Q(22), PHYS.id, "Newtonian mechanics — momentum", "Momentum is conserved in a collision when", ["no external force acts on the system", "the collision is elastic", "kinetic energy is conserved", "both bodies stop"], "A", "Conservation of momentum needs no net external force; elasticity is about kinetic energy."),
  ];
}

function seed(): Store {
  const now = DateTime.utc();
  const iso = (d: DateTime) => d.toISO()!;
  const questions = seedQuestions();
  const sets: DemoSet[] = [
    { id: S(1), course_id: SAT.id, kind: "practice", title: "Function transformations — practice", syllabus_topic_id: null, time_limit_minutes: null, integrity_settings: {}, status: "live", created_by: DEMO_IDS.maya, question_ids: [Q(1), Q(2), Q(6), Q(7), Q(8)], created_at: iso(now.minus({ days: 1, hours: 2 })) },
    { id: S(2), course_id: SAT.id, kind: "test", title: "Linear systems — timed test", syllabus_topic_id: null, time_limit_minutes: 20, integrity_settings: {}, status: "live", created_by: DEMO_IDS.maya, question_ids: [Q(3), Q(4), Q(5), Q(2), Q(8), Q(1)], created_at: iso(now.minus({ hours: 3 })) },
    { id: S(3), course_id: SAT.id, kind: "practice", title: "Linear systems — practice", syllabus_topic_id: null, time_limit_minutes: null, integrity_settings: {}, status: "live", created_by: DEMO_IDS.maya, question_ids: [Q(3), Q(4), Q(5), Q(2), Q(6), Q(8), Q(1)], created_at: iso(now.minus({ days: 6, hours: 1 })) },
    { id: S(4), course_id: IGCSE.id, kind: "practice", title: "Quadratics — practice", syllabus_topic_id: null, time_limit_minutes: null, integrity_settings: {}, status: "live", created_by: DEMO_IDS.maya, question_ids: [Q(11), Q(12), Q(13), Q(14), Q(15)], created_at: iso(now.minus({ days: 1 })) },
    { id: S(5), course_id: IGCSE.id, kind: "test", title: "Completing the square — test", syllabus_topic_id: null, time_limit_minutes: 15, integrity_settings: {}, status: "live", created_by: DEMO_IDS.maya, question_ids: [Q(11), Q(12), Q(13), Q(16), Q(17), Q(14)], created_at: iso(now.minus({ days: 2, hours: 3 })) },
    { id: S(6), course_id: IGCSE.id, kind: "quick_check", title: "Quick check — completing the square", syllabus_topic_id: null, time_limit_minutes: null, integrity_settings: {}, status: "live", created_by: DEMO_IDS.maya, question_ids: [Q(11), Q(12), Q(13), Q(16), Q(17)], created_at: iso(now.startOf("day").plus({ hours: 1, minutes: 20 })) },
  ];
  const assignments: DemoAssignment[] = [
    { id: A(1), set_id: S(1), student_id: DEMO_IDS.sofia, session_id: null, assigned_by: DEMO_IDS.maya, due_at: iso(now.plus({ days: 3 })), mode: "at_home", created_at: iso(now.minus({ days: 1, hours: 2 })) },
    { id: A(2), set_id: S(2), student_id: DEMO_IDS.sofia, session_id: null, assigned_by: DEMO_IDS.maya, due_at: iso(now.plus({ days: 5 })), mode: "at_home", created_at: iso(now.minus({ hours: 3 })) },
    { id: A(3), set_id: S(3), student_id: DEMO_IDS.sofia, session_id: null, assigned_by: DEMO_IDS.maya, due_at: iso(now.minus({ days: 2 })), mode: "at_home", created_at: iso(now.minus({ days: 6, hours: 1 })) },
    { id: A(4), set_id: S(4), student_id: DEMO_IDS.aarav, session_id: null, assigned_by: DEMO_IDS.maya, due_at: iso(now.plus({ days: 2 })), mode: "at_home", created_at: iso(now.minus({ days: 1 })) },
    { id: A(5), set_id: S(5), student_id: DEMO_IDS.aarav, session_id: null, assigned_by: DEMO_IDS.maya, due_at: iso(now.minus({ hours: 20 })), mode: "at_home", created_at: iso(now.minus({ days: 2, hours: 3 })) },
    { id: A(6), set_id: S(6), student_id: DEMO_IDS.aarav, session_id: DEMO_PRACTICE_IDS.quickCheckSession, assigned_by: DEMO_IDS.maya, due_at: null, mode: "in_session", created_at: iso(now.startOf("day").plus({ hours: 1, minutes: 20 })) },
  ];

  const s: Store = { questions, sets, assignments, attempts: new Map(), lessonEvents: [], seq: 100 };

  // Sofia finished the linear systems practice a week ago; Maya marked the worked question.
  const t3 = newAttempt(s, T(3), A(3), now.minus({ days: 5, hours: 20 }));
  answerSeed(s, t3, Q(3), { type: "short", text: "(4, 3)" });
  answerSeed(s, t3, Q(4), { type: "multi_select", keys: ["A", "D"] });
  answerSeed(s, t3, Q(5), { type: "worked", final_answer: "x = 4, y = 0", evidence: [{ kind: "notebook_page", ref: "nb-sofia-1" }] });
  answerSeed(s, t3, Q(2), { type: "numeric", text: "1" });
  answerSeed(s, t3, Q(6), { type: "numeric", text: "5" });
  answerSeed(s, t3, Q(8), { type: "numeric", text: "7" });
  answerSeed(s, t3, Q(1), { type: "mcq", key: "B" });
  finishSeed(s, t3, now.minus({ days: 5, hours: 19, minutes: 40 }));
  const w = t3.answers.get(Q(5))!;
  w.marks_awarded = 2;
  w.is_correct = false;
  w.marked_by = DEMO_IDS.maya;
  w.feedback = "Right answer; show the substitution step for the last mark.";
  t3.score = 7;
  t3.status = "marked";

  // Aarav is part-way through the quadratics practice.
  const t4 = newAttempt(s, T(4), A(4), now.minus({ hours: 5 }));
  answerSeed(s, t4, Q(11), { type: "mcq", key: "A" });
  answerSeed(s, t4, Q(12), { type: "numeric", text: "3" });

  // Aarav's timed test two days ago was flagged: he left the tab twice and pasted.
  const t5start = now.minus({ days: 2, hours: 2 });
  const t5 = newAttempt(s, T(5), A(5), t5start);
  answerSeed(s, t5, Q(11), { type: "mcq", key: "A" });
  answerSeed(s, t5, Q(12), { type: "numeric", text: "2" });
  answerSeed(s, t5, Q(13), { type: "short", text: "(x-2)(x-3)" });
  answerSeed(s, t5, Q(16), { type: "numeric", text: "2" });
  answerSeed(s, t5, Q(17), { type: "mcq", key: "D" });
  answerSeed(s, t5, Q(14), { type: "multi_select", keys: ["A"] });
  const at = (m: number, sec = 0) => iso(t5start.plus({ minutes: m, seconds: sec }));
  t5.events = [
    { at: at(1), kind: "snapshot", detail: null, snapshot_path: `${DEMO_IDS.aarav}/${T(5)}/${t5start.plus({ minutes: 1 }).toMillis()}.jpg` },
    { at: at(2), kind: "snapshot", detail: null, snapshot_path: `${DEMO_IDS.aarav}/${T(5)}/${t5start.plus({ minutes: 2 }).toMillis()}.jpg` },
    { at: at(3, 10), kind: "visibility_hidden", detail: null, snapshot_path: null },
    { at: at(3, 10), kind: "paused", detail: null, snapshot_path: null },
    { at: at(3, 52), kind: "resume", detail: null, snapshot_path: null },
    { at: at(4), kind: "snapshot", detail: null, snapshot_path: `${DEMO_IDS.aarav}/${T(5)}/${t5start.plus({ minutes: 4 }).toMillis()}.jpg` },
    { at: at(6, 30), kind: "paste", detail: null, snapshot_path: null },
    { at: at(8, 5), kind: "visibility_hidden", detail: null, snapshot_path: null },
    { at: at(8, 5), kind: "paused", detail: null, snapshot_path: null },
    { at: at(8, 41), kind: "resume", detail: null, snapshot_path: null },
    { at: at(9, 2), kind: "fullscreen_exit", detail: null, snapshot_path: null },
    { at: at(9, 2), kind: "warned", detail: "4 events: left the tab ×2, pasted ×1, exited fullscreen ×1", snapshot_path: null },
  ];
  finishSeed(s, t5, t5start.plus({ minutes: 12 }), { flagged: true, severity: 9, event_count: 4, counts: { visibility_hidden: 2, paste: 1, fullscreen_exit: 1 }, total_paused_ms: 78_000, headline: "4 events: left the tab ×2, pasted ×1, exited fullscreen ×1" });

  // The quick check in this morning's lesson, 4/5.
  const t6 = newAttempt(s, T(6), A(6), now.startOf("day").plus({ hours: 1, minutes: 22 }));
  t6.session_id = DEMO_PRACTICE_IDS.quickCheckSession;
  answerSeed(s, t6, Q(11), { type: "mcq", key: "A" });
  answerSeed(s, t6, Q(12), { type: "numeric", text: "3" });
  answerSeed(s, t6, Q(13), { type: "short", text: "(x-3)(x-2)" });
  answerSeed(s, t6, Q(16), { type: "numeric", text: "4" });
  answerSeed(s, t6, Q(17), { type: "mcq", key: "A" });
  finishSeed(s, t6, now.startOf("day").plus({ hours: 1, minutes: 31 }));

  return s;
}

function newAttempt(s: Store, id: string, assignmentId: string, startedAt: DateTime): DemoAttempt {
  const a = s.assignments.find((x) => x.id === assignmentId)!;
  const set = s.sets.find((x) => x.id === a.set_id)!;
  const t: DemoAttempt = {
    id,
    assignment_id: a.id,
    set_id: set.id,
    student_id: a.student_id,
    session_id: a.session_id,
    started_at: startedAt.toISO()!,
    submitted_at: null,
    time_limit_minutes: set.time_limit_minutes,
    score: null,
    out_of: null,
    integrity_flagged: false,
    integrity_summary: null,
    status: "in_progress",
    answers: new Map(),
    events: [],
  };
  s.attempts.set(id, t);
  return t;
}

function answerSeed(s: Store, t: DemoAttempt, questionId: string, response: Response): void {
  const q = s.questions.find((x) => x.id === questionId)!;
  const mark = markQuestion(modelOf(q), response);
  t.answers.set(questionId, {
    question_id: questionId,
    response: { ...response },
    is_correct: mark.status === "pending_review" ? null : mark.status === "correct",
    marks_awarded: mark.status === "pending_review" ? null : mark.score,
    marked_by: null,
    feedback: null,
    answered_at: t.started_at,
  });
}

function finishSeed(s: Store, t: DemoAttempt, at: DateTime, summary: Record<string, unknown> | null = null): void {
  const set = s.sets.find((x) => x.id === t.set_id)!;
  const result = totals(s, set, t);
  t.score = result.score;
  t.out_of = result.out_of;
  t.status = result.status;
  t.submitted_at = at.toISO()!;
  t.integrity_summary = summary;
  t.integrity_flagged = Boolean(summary?.flagged);
}

// --- rules the policies share ---------------------------------------------------------

/** rpc manages_course: admin, or an in-charge of the course's department. */
export function demoManagesCourse(viewer: Profile, courseId: string): boolean {
  if (viewer.role === "admin") return true;
  const course = demoCourses.find((c) => c.id === courseId);
  if (!course?.department_id) return false;
  return viewer.role === "staff" && (demoInchargeDepartments[viewer.id] ?? []).includes(course.department_id);
}

function sameFamily(viewer: Profile, studentId: string): boolean {
  const student = demoProfiles.find((p) => p.id === studentId);
  return Boolean(viewer.family_id && student?.family_id === viewer.family_id);
}

function refuse(message: string): never {
  throw new Error(message);
}

function attemptOf(s: Store, id: string): DemoAttempt {
  return s.attempts.get(id) ?? refuse("There is no attempt with that id, or it is not yours to see.");
}

function isAssigner(s: Store, t: DemoAttempt, viewer: Profile): boolean {
  const a = s.assignments.find((x) => x.id === t.assignment_id);
  return a?.assigned_by === viewer.id;
}

function mayReviewAttempt(s: Store, t: DemoAttempt, viewer: Profile): boolean {
  const set = s.sets.find((x) => x.id === t.set_id)!;
  return isAssigner(s, t, viewer) || demoManagesCourse(viewer, set.course_id);
}

/** The full question, answers included, for marking and for a viewer who may see them. */
export function modelOf(q: DemoQuestion): Question {
  const base = {
    id: q.id,
    stem: q.stem,
    image_url: null,
    topic_id: q.syllabus_topic_id,
    topic_label: q.topic_label,
    difficulty: (q.difficulty as 1 | 2 | 3 | 4 | 5) ?? 3,
    marks: q.marks,
    worked_solution: q.worked_solution,
    source: { kind: "manual" as const },
  };
  switch (q.type) {
    case "mcq":
      return { ...base, type: "mcq", options: q.options ?? [], answer: String(q.answer ?? "") };
    case "multi_select":
      return { ...base, type: "multi_select", options: q.options ?? [], answers: Array.isArray(q.answer) ? q.answer.map(String) : [] };
    case "numeric":
      return { ...base, type: "numeric", answer: Number(q.answer), tolerance: q.tolerance, unit: q.unit };
    case "short":
      return { ...base, type: "short", answers: [String(q.answer ?? ""), ...(q.accepted ?? [])] };
    case "worked":
      return { ...base, type: "worked", marking_scheme: "", final_answer: null };
  }
}

function totals(s: Store, set: DemoSet, t: DemoAttempt): SubmitResult {
  const qs = set.question_ids.map((id) => s.questions.find((q) => q.id === id)!);
  const out_of = qs.reduce((sum, q) => sum + q.marks, 0);
  let score = 0;
  let unmarked = false;
  for (const q of qs) {
    const a = t.answers.get(q.id);
    if (a?.marks_awarded != null) score += a.marks_awarded;
    if (q.type === "worked" && (!a || a.marks_awarded == null)) unmarked = true;
  }
  return { score: Math.round(score * 100) / 100, out_of, status: unmarked ? "submitted" : "marked" };
}

// --- the RPCs ---------------------------------------------------------------------------

/** rpc my_practice(p_days): the rows the viewer may read, newest first. */
export function demoMyPractice(viewer: Profile, days = 30): PracticeRow[] {
  const s = store();
  const since = Date.now() - days * 86_400_000;
  const rows: PracticeRow[] = [];
  for (const a of s.assignments) {
    if (Date.parse(a.created_at) < since) continue;
    const set = s.sets.find((x) => x.id === a.set_id)!;
    const course = demoCourses.find((c) => c.id === set.course_id)!;
    const mine =
      viewer.role === "admin" ||
      (viewer.role === "student" && a.student_id === viewer.id) ||
      (viewer.role === "parent" && sameFamily(viewer, a.student_id)) ||
      (viewer.role === "teacher" && a.assigned_by === viewer.id) ||
      (viewer.role === "staff" && demoManagesCourse(viewer, set.course_id));
    if (!mine) continue;
    const attempt = [...s.attempts.values()].find((t) => t.assignment_id === a.id) ?? null;
    const student = demoProfiles.find((p) => p.id === a.student_id)!;
    rows.push({
      assignment_id: a.id,
      set_id: set.id,
      set_title: set.title,
      kind: set.kind,
      course_id: course.id,
      course_name: course.name,
      student_id: student.id,
      student_name: displayName(student),
      mode: a.mode,
      due_at: a.due_at,
      assigned_at: a.created_at,
      attempt_id: attempt?.id ?? null,
      attempt_status: attempt?.status ?? null,
      score: attempt?.score ?? null,
      out_of: attempt?.out_of ?? null,
      integrity_flagged: attempt?.integrity_flagged ?? false,
      submitted_at: attempt?.submitted_at ?? null,
      question_count: set.question_ids.length,
    });
  }
  return rows.sort((a, b) => (a.assigned_at < b.assigned_at ? 1 : -1)).slice(0, 200);
}

/** rpc start_attempt(p_assignment_id): the assignment's student only; the open attempt or a new one. */
export function demoStartAttempt(viewer: Profile, assignmentId: string): string {
  const s = store();
  const a = s.assignments.find((x) => x.id === assignmentId) ?? refuse("There is no assignment with that id, or it is not yours.");
  if (a.student_id !== viewer.id) refuse("Only the student this practice was set for can start it.");
  const open = [...s.attempts.values()].find((t) => t.assignment_id === a.id && t.status === "in_progress");
  if (open) return open.id;
  const done = [...s.attempts.values()].find((t) => t.assignment_id === a.id);
  if (done) return done.id;
  const id = T(++s.seq);
  newAttempt(s, id, a.id, DateTime.utc());
  return id;
}

/** rpc attempt_questions(p_attempt_id): masked for the student while in progress (and after, when the set hides solutions). */
export function demoAttemptQuestions(viewer: Profile, attemptId: string): AttemptQuestionRow[] {
  const s = store();
  const t = attemptOf(s, attemptId);
  const isStudent = t.student_id === viewer.id;
  if (!isStudent && !mayReviewAttempt(s, t, viewer)) refuse("This attempt is not yours to see.");
  const set = s.sets.find((x) => x.id === t.set_id)!;
  const hide = isStudent && (t.status === "in_progress" || set.integrity_settings.hide_solutions === true || set.integrity_settings.hide_solutions === "true");
  return set.question_ids.map((qid, i) => {
    const q = s.questions.find((x) => x.id === qid)!;
    const a = t.answers.get(qid) ?? null;
    return {
      id: q.id,
      type: q.type,
      stem: q.stem,
      image_path: q.image_path,
      options: q.options,
      difficulty: q.difficulty,
      marks: q.marks,
      topic_id: q.syllabus_topic_id,
      topic_label: q.topic_label,
      sort_order: i,
      response: a?.response ?? null,
      is_correct: a?.is_correct ?? null,
      marks_awarded: a?.marks_awarded ?? null,
      feedback: a?.feedback ?? null,
      answer: hide ? null : q.answer,
      worked_solution: hide ? null : q.worked_solution,
      unit: q.unit,
    };
  });
}

/** rpc answer_question: the student, in progress, inside the time limit; auto-marks and returns the verdict only. */
export function demoAnswerQuestion(viewer: Profile, attemptId: string, questionId: string, response: Record<string, unknown>): AnswerVerdict {
  const s = store();
  const t = attemptOf(s, attemptId);
  if (t.student_id !== viewer.id) refuse("Only the student can answer their own attempt.");
  if (t.status !== "in_progress") refuse("This attempt has already been submitted.");
  const set = s.sets.find((x) => x.id === t.set_id)!;
  if (!set.question_ids.includes(questionId)) refuse("That question is not part of this set.");
  if (t.time_limit_minutes != null) {
    const paused = Number(t.integrity_summary?.total_paused_ms ?? 0);
    const deadline = Date.parse(t.started_at) + (t.time_limit_minutes + 2) * 60_000 + paused;
    if (Date.now() > deadline) refuse("Time is up for this test; it can only be submitted now.");
  }
  const q = s.questions.find((x) => x.id === questionId)!;
  const r = toResponse({ type: q.type, response });
  const mark = markQuestion(modelOf(q), r);
  const pending = mark.status === "pending_review";
  const unanswered = mark.status === "unanswered";
  const is_correct = pending ? null : mark.status === "correct";
  const marks_awarded = pending ? null : unanswered ? 0 : mark.score;
  t.answers.set(questionId, { question_id: questionId, response, is_correct, marks_awarded, marked_by: null, feedback: null, answered_at: new Date().toISOString() });
  return { is_correct, marks_awarded, status: pending ? "pending_review" : is_correct ? "correct" : "incorrect" };
}

/** rpc submit_attempt: the student, in progress; totals and the integrity summary. */
export function demoSubmitAttempt(viewer: Profile, attemptId: string, summary: Record<string, unknown> | null): SubmitResult {
  const s = store();
  const t = attemptOf(s, attemptId);
  if (t.student_id !== viewer.id) refuse("Only the student can submit their own attempt.");
  if (t.status !== "in_progress") refuse("This attempt has already been submitted.");
  const set = s.sets.find((x) => x.id === t.set_id)!;
  finishSeed(s, t, DateTime.utc(), summary);
  void set;
  return { score: t.score!, out_of: t.out_of!, status: t.status };
}

/** rpc log_integrity_event: the student, in progress; append only. */
export function demoLogIntegrityEvent(viewer: Profile, attemptId: string, kind: string, detail: string | null, snapshotPath: string | null): void {
  const s = store();
  const t = attemptOf(s, attemptId);
  if (t.student_id !== viewer.id) refuse("Only the student can log events on their own attempt.");
  if (t.status !== "in_progress") refuse("This attempt is no longer in progress.");
  t.events.push({ at: new Date().toISOString(), kind, detail, snapshot_path: snapshotPath });
}

/** rpc void_attempt: the assigner, manages_course or admin. */
export function demoVoidAttempt(viewer: Profile, attemptId: string): void {
  const s = store();
  const t = attemptOf(s, attemptId);
  if (!mayReviewAttempt(s, t, viewer)) refuse("You may not void this attempt.");
  t.status = "void";
}

/** rpc live_attempts(p_session_id): the host's or an observer's view of the attempts in a lesson. */
export function demoLiveAttempts(viewer: Profile, sessionId: string): LiveAttempt[] {
  const s = store();
  const session = buildDemoSessionRequests().find((x) => x.id === sessionId) ?? refuse("There is no session with that id.");
  const seat = demoRoomAccess(viewer, session);
  if (seat !== "host" && seat !== "observer") refuse("Only the host or an observer may watch a lesson's attempts.");
  return [...s.attempts.values()]
    .filter((t) => t.session_id === sessionId)
    .sort((a, b) => (a.started_at < b.started_at ? 1 : -1))
    .map((t) => {
      const set = s.sets.find((x) => x.id === t.set_id)!;
      return {
        attempt_id: t.id,
        student_id: t.student_id,
        set_id: set.id,
        set_title: set.title,
        kind: set.kind,
        status: t.status,
        score: t.score,
        out_of: t.out_of,
        started_at: t.started_at,
        submitted_at: t.submitted_at,
        integrity_flagged: t.integrity_flagged,
        answers: [...t.answers.values()].map((a) => ({ question_id: a.question_id, is_correct: a.is_correct, marks_awarded: a.marks_awarded, answered_at: a.answered_at })),
      };
    });
}

/** rpc flagged_attempt_review(p_attempt_id): the assigner, manages_course or admin. */
export function demoFlaggedAttemptReview(viewer: Profile, attemptId: string): AttemptReview {
  const s = store();
  const t = attemptOf(s, attemptId);
  if (!mayReviewAttempt(s, t, viewer)) refuse("This attempt is not yours to review.");
  const { answers, events, ...attempt } = t;
  return {
    attempt: { ...attempt },
    events: [...events].sort((a, b) => a.at.localeCompare(b.at)),
    answers: [...answers.values()].map((a) => ({ question_id: a.question_id, response: a.response, is_correct: a.is_correct, marks_awarded: a.marks_awarded, feedback: a.feedback, answered_at: a.answered_at })),
  };
}

/** The questions a host may put in a quick check: approved on the course, plus the drafts they wrote themselves. */
export function demoCourseQuestions(viewer: Profile, courseId: string): DemoQuestion[] {
  return store().questions.filter((q) => q.course_id === courseId && (q.status === "approved" || (q.status === "draft" && q.created_by === viewer.id)));
}

/** rpc upsert_question (insert as draft). The host of a session on the course may write a one-off question. */
export function demoUpsertQuestion(viewer: Profile, courseId: string, q: Partial<DemoQuestion> & { type: QuestionType; stem: string }): string {
  const s = store();
  const hosting = buildDemoSessionRequests().some((x) => x.course_id === courseId && demoRoomAccess(viewer, x) === "host");
  if (!demoManagesCourse(viewer, courseId) && !hosting) refuse("You may not add questions to this course.");
  const id = Q(++s.seq);
  s.questions.push({
    id,
    course_id: courseId,
    syllabus_topic_id: null,
    topic_label: q.topic_label ?? null,
    type: q.type,
    stem: q.stem,
    options: q.options ?? null,
    answer: q.answer ?? null,
    tolerance: q.tolerance ?? null,
    unit: q.unit ?? null,
    accepted: q.accepted ?? null,
    difficulty: q.difficulty ?? 3,
    marks: q.marks ?? 1,
    worked_solution: q.worked_solution ?? null,
    image_path: null,
    status: "draft",
    created_by: viewer.id,
  });
  return id;
}

/** rpc create_practice_set: manages_course, admin, or the host for a quick check in their session. */
export function demoCreatePracticeSet(viewer: Profile, input: { course_id: string; kind: PracticeKind; title: string; question_ids: string[]; session_id?: string | null; time_limit_minutes?: number | null; integrity_settings?: Record<string, unknown> }): string {
  const s = store();
  const session = input.session_id ? buildDemoSessionRequests().find((x) => x.id === input.session_id) : undefined;
  const hosting = Boolean(session && input.kind === "quick_check" && demoRoomAccess(viewer, session) === "host");
  if (!demoManagesCourse(viewer, input.course_id) && !hosting) refuse("You may not create a set on this course.");
  if (input.question_ids.length === 0) refuse("Pick at least one question.");
  for (const qid of input.question_ids) {
    const q = s.questions.find((x) => x.id === qid) ?? refuse("One of the questions does not exist.");
    if (q.course_id !== input.course_id) refuse("Every question must be on the same course as the set.");
    const ok = q.status === "approved" || (input.kind === "quick_check" && q.status === "draft" && q.created_by === viewer.id);
    if (!ok) refuse("Only approved questions (or your own drafts, in a quick check) can go in a set.");
  }
  const id = S(++s.seq);
  s.sets.push({ id, course_id: input.course_id, kind: input.kind, title: input.title, syllabus_topic_id: null, time_limit_minutes: input.time_limit_minutes ?? null, integrity_settings: input.integrity_settings ?? {}, status: "live", created_by: viewer.id, question_ids: [...input.question_ids], created_at: new Date().toISOString() });
  return id;
}

/** rpc assign_practice: one assignment per student; in_session only by the host, for the session's student. */
export function demoAssignPractice(viewer: Profile, input: { set_id: string; student_ids: string[]; mode: AssignmentMode; session_id?: string | null; due_at?: string | null }): number {
  const s = store();
  const set = s.sets.find((x) => x.id === input.set_id) ?? refuse("There is no set with that id.");
  if (set.status !== "live") refuse("This set is not live.");
  const session = input.session_id ? buildDemoSessionRequests().find((x) => x.id === input.session_id) : undefined;
  const hosting = Boolean(session && input.mode === "in_session" && demoRoomAccess(viewer, session) === "host" && input.student_ids.length === 1 && input.student_ids[0] === session!.student_id);
  if (!demoManagesCourse(viewer, set.course_id) && !hosting) refuse("You may not assign this set.");
  let n = 0;
  for (const studentId of input.student_ids) {
    const open = s.assignments.some((a) => a.set_id === set.id && a.student_id === studentId && a.session_id === (input.session_id ?? null) && ![...s.attempts.values()].some((t) => t.assignment_id === a.id && t.status !== "in_progress"));
    if (open) continue;
    s.assignments.push({ id: A(++s.seq), set_id: set.id, student_id: studentId, session_id: input.session_id ?? null, assigned_by: viewer.id, due_at: input.due_at ?? null, mode: input.mode, created_at: new Date().toISOString() });
    n++;
  }
  return n;
}

/** practice_assignments for a session, as the student reads their own rows. */
export function demoStudentSessionAssignments(viewer: Profile, sessionId: string): DemoAssignment[] {
  return store()
    .assignments.filter((a) => a.session_id === sessionId && a.student_id === viewer.id)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

/** lesson_consents.integrity_camera for a student: the family's own row, or a staff read. */
export function demoIntegrityCameraConsent(viewer: Profile, studentId: string): boolean {
  const allowed = viewer.id === studentId || sameFamily(viewer, studentId) || viewer.role !== "student";
  return allowed && Boolean(demoConsents[studentId]?.integrity_camera);
}

/** rpc log_lesson_event, kept for the oral check so the demo lesson shows what was recorded. */
export function demoLogLessonEvent(viewer: Profile, sessionId: string, kind: string, payload: Record<string, unknown>): void {
  store().lessonEvents.push({ session_id: sessionId, at: new Date().toISOString(), kind, payload, actor_id: viewer.id });
}

export function demoLessonEvents(sessionId: string, kind?: string): DemoLessonEvent[] {
  return store().lessonEvents.filter((e) => e.session_id === sessionId && (!kind || e.kind === kind));
}

/** practice_attempts, as the student reads their own row (or a reviewer theirs). */
export function demoMyAttemptRecord(viewer: Profile, attemptId: string): AttemptRecord | null {
  const s = store();
  const t = s.attempts.get(attemptId);
  if (!t) return null;
  if (t.student_id !== viewer.id && !sameFamily(viewer, t.student_id) && !mayReviewAttempt(s, t, viewer)) return null;
  const { answers, events, ...record } = t;
  void answers;
  void events;
  return { ...record };
}

/** The seeded attempt rows, for tests. */
export function demoAttempt(id: string): DemoAttempt | null {
  return store().attempts.get(id) ?? null;
}
