import { DateTime } from "luxon";
import { DEMO_IDS, demoCourses, demoProfiles } from "@/lib/demo/data";
import { demoSyllabusTopics } from "@/lib/demo/syllabus";
import { displayName } from "@/lib/types";
import type { BankQuestion, CourseStudent, PracticeSetRow, QuestionStatus } from "@/lib/bank/types";
import type { QuestionType } from "@/lib/practice/model";

// ============================================================================
// practice_questions, practice_sets and student_courses as the demo holds
// them. The in-charge (…d1) manages Online Mathematics, so IGCSE Mathematics
// and SAT Math Prep carry questions; the bank for Physics is nobody's in the
// demo. Statuses cover the three chips; types cover the five editors.
// ============================================================================

const [IGCSE, SAT] = demoCourses;
const T = Object.fromEntries(demoSyllabusTopics.map((t) => [t.label, t.id]));
const now = DateTime.utc();

export const demoQuestions: BankQuestion[] = [
  q("70000000-0000-0000-0000-000000000001", IGCSE.id, "mcq", "approved", T["Completing the square"]!, 1, 1, {
    stem: "Which of the following is the **vertex form** of $y = x^2 - 6x + 5$?",
    options: [
      { key: "A", text: "$y = (x-3)^2 - 4$" },
      { key: "B", text: "$y = (x+3)^2 - 4$" },
      { key: "C", text: "$y = (x-3)^2 + 5$" },
      { key: "D", text: "$y = (x-6)^2 - 31$" },
    ],
    answer: "A",
    worked_solution: "Complete the square: $x^2 - 6x + 5 = (x-3)^2 - 9 + 5 = (x-3)^2 - 4$.",
    source: { kind: "pdf", file_id: "file-ws-2", page: 1 },
  }, 9),
  q("70000000-0000-0000-0000-000000000002", IGCSE.id, "numeric", "approved", T["Quadratic equations"]!, 2, 1, {
    stem: "Find the root of $x^2 - 5x + 6 = 0$ that is larger than $2.5$.",
    answer: 3,
    worked_solution: "$(x-2)(x-3) = 0$, so $x = 2$ or $x = 3$. The root larger than $2.5$ is $x = 3$.",
    source: { kind: "pdf", file_id: "file-ws-1", page: 1 },
  }, 9),
  q("70000000-0000-0000-0000-000000000003", IGCSE.id, "short", "approved", T["Quadratic equations"]!, 2, 1, {
    stem: "Factorise $x^2 - 5x + 6$.",
    answer: "(x-2)(x-3)",
    accepted: ["(x-3)(x-2)"],
    worked_solution: "Two numbers that multiply to $6$ and add to $-5$: $-2$ and $-3$.",
    source: { kind: "pdf", file_id: "file-ws-1", page: 1 },
  }, 9),
  q("70000000-0000-0000-0000-000000000004", IGCSE.id, "multi_select", "approved", T["Number — primes and factors"]!, 3, 2, {
    stem: "Which of these are prime?",
    options: [
      { key: "A", text: "2" },
      { key: "B", text: "9" },
      { key: "C", text: "17" },
      { key: "D", text: "21" },
    ],
    answer: ["A", "C"],
    source: { kind: "manual" },
  }, 6),
  q("70000000-0000-0000-0000-000000000005", IGCSE.id, "worked", "approved", T["Completing the square"]!, 4, 4, {
    stem: "Solve $2x^2 + 3x - 2 = 0$ by completing the square. Show your working.",
    worked_solution:
      "Divide by $2$: $x^2 + \\tfrac{3}{2}x - 1 = 0$. Then $(x + \\tfrac{3}{4})^2 - \\tfrac{25}{16} = 0$, so $x = \\tfrac{1}{2}$ or $x = -2$.\n\n**Marking scheme.** M1 divide by 2; M1 complete the square; A1 $x = \\tfrac{1}{2}$; A1 $x = -2$.",
    source: { kind: "pdf", file_id: "file-ws-2", page: 2 },
  }, 6),
  q("70000000-0000-0000-0000-000000000006", IGCSE.id, "numeric", "draft", T["Trigonometry — sine rule"]!, 3, 2, {
    stem: "In triangle $ABC$, $AB = 8$ cm, angle $A = 40^\\circ$ and angle $C = 65^\\circ$. Find $BC$ to 1 decimal place.",
    answer: 5.7,
    tolerance: 0.05,
    unit: "cm",
    worked_solution: "$\\dfrac{BC}{\\sin 40^\\circ} = \\dfrac{8}{\\sin 65^\\circ}$, so $BC = \\dfrac{8 \\sin 40^\\circ}{\\sin 65^\\circ} \\approx 5.7$ cm.",
    source: { kind: "pdf", file_id: "file-ws-1", page: 2 },
  }, 1),
  q("70000000-0000-0000-0000-000000000007", IGCSE.id, "mcq", "draft", null, 2, 1, {
    stem: "The graph of $y = f(x) + 3$ is the graph of $y = f(x)$ translated…",
    options: [
      { key: "A", text: "3 units up" },
      { key: "B", text: "3 units down" },
      { key: "C", text: "3 units left" },
      { key: "D", text: "3 units right" },
    ],
    answer: null,
    source: { kind: "pdf", file_id: "file-ws-1", page: 3 },
  }, 1),
  q("70000000-0000-0000-0000-000000000008", IGCSE.id, "short", "retired", T["Quadratic equations"]!, 1, 1, {
    stem: "Write down the discriminant of $ax^2 + bx + c = 0$.",
    answer: "b^2-4ac",
    accepted: ["b²-4ac", "b^2 - 4ac"],
    source: { kind: "manual" },
  }, 30),
  q("70000000-0000-0000-0000-000000000009", SAT.id, "mcq", "approved", null, 2, 1, {
    stem: "If $f(x) = x^2$, which equation describes the graph of $f$ shifted $2$ units to the right?",
    options: [
      { key: "A", text: "$y = (x+2)^2$" },
      { key: "B", text: "$y = (x-2)^2$" },
      { key: "C", text: "$y = x^2 + 2$" },
      { key: "D", text: "$y = x^2 - 2$" },
    ],
    answer: "B",
    worked_solution: "A shift right by $2$ replaces $x$ with $x - 2$.",
    source: { kind: "manual" },
  }, 4),
  q("70000000-0000-0000-0000-000000000010", SAT.id, "numeric", "draft", null, 3, 1, {
    stem: "Solve the system $2x + y = 7$ and $x - y = 2$. Give $x$.",
    answer: 3,
    source: { kind: "manual" },
  }, 0),
];

/** practice_sets with their item counts; one live set the Assign dialog can pick. */
export const demoPracticeSets: PracticeSetRow[] = [
  {
    id: "80000000-0000-0000-0000-000000000001",
    course_id: IGCSE.id,
    kind: "practice",
    title: "Quadratics — practice set",
    syllabus_topic_id: T["Quadratic equations"]!,
    time_limit_minutes: null,
    integrity_settings: {},
    status: "live",
    created_at: now.minus({ days: 5 }).toISO()!,
    question_count: 3,
  },
  {
    id: "80000000-0000-0000-0000-000000000002",
    course_id: IGCSE.id,
    kind: "test",
    title: "Completing the square — topic test",
    syllabus_topic_id: T["Completing the square"]!,
    time_limit_minutes: 20,
    integrity_settings: { camera_required: true, hide_solutions: true },
    status: "live",
    created_at: now.minus({ days: 2 }).toISO()!,
    question_count: 2,
  },
];

/** student_courses: both maths students are on both maths courses; Lena is on Physics. */
export const demoStudentCourses: { student_id: string; course_id: string }[] = [
  { student_id: DEMO_IDS.aarav, course_id: IGCSE.id },
  { student_id: DEMO_IDS.aarav, course_id: SAT.id },
  { student_id: DEMO_IDS.sofia, course_id: IGCSE.id },
  { student_id: DEMO_IDS.sofia, course_id: SAT.id },
  { student_id: DEMO_IDS.lena, course_id: demoCourses[2]!.id },
];

export function demoCourseStudents(courseId: string): CourseStudent[] {
  return demoStudentCourses
    .filter((sc) => sc.course_id === courseId)
    .map((sc) => demoProfiles.find((p) => p.id === sc.student_id))
    .filter((p): p is NonNullable<typeof p> => Boolean(p))
    .map((p) => ({ id: p.id, name: displayName(p), grade_level: p.grade_level }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function q(
  id: string,
  courseId: string,
  type: QuestionType,
  status: QuestionStatus,
  topicId: string | null,
  difficulty: BankQuestion["difficulty"],
  marks: number,
  body: Partial<Pick<BankQuestion, "stem" | "options" | "answer" | "tolerance" | "unit" | "accepted" | "worked_solution" | "source">>,
  ageDays: number,
): BankQuestion {
  const created = now.minus({ days: ageDays, hours: 3 }).toISO()!;
  const reviewed = status === "draft" ? null : now.minus({ days: ageDays, hours: 1 }).toISO()!;
  return {
    id,
    course_id: courseId,
    syllabus_topic_id: topicId,
    type,
    stem: body.stem ?? "",
    options: body.options ?? null,
    answer: body.answer ?? null,
    tolerance: body.tolerance ?? null,
    unit: body.unit ?? null,
    accepted: body.accepted ?? null,
    difficulty,
    marks,
    worked_solution: body.worked_solution ?? null,
    image_path: null,
    source: body.source ?? { kind: "manual" },
    status,
    created_by: DEMO_IDS.grace,
    reviewed_by: reviewed ? DEMO_IDS.grace : null,
    reviewed_at: reviewed,
    created_at: created,
    updated_at: reviewed ?? created,
  };
}
