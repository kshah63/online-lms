import type { Question } from "./model";

/** Sample questions for the demo-mode preview and UI tests. */
export const SAMPLE_QUESTIONS: Question[] = [
  {
    id: "s1", type: "mcq", difficulty: 1, marks: 1, source: { kind: "manual" }, topic_label: "Quadratics",
    stem: "Which of the following is the **vertex form** of $y = x^2 - 6x + 5$?",
    options: [
      { key: "A", text: "$y = (x-3)^2 - 4$" },
      { key: "B", text: "$y = (x+3)^2 - 4$" },
      { key: "C", text: "$y = (x-3)^2 + 5$" },
      { key: "D", text: "$y = (x-6)^2 - 31$" },
    ],
    answer: "A",
    worked_solution: "Complete the square: $x^2 - 6x + 5 = (x-3)^2 - 9 + 5 = (x-3)^2 - 4$.",
  },
  {
    id: "s2", type: "numeric", difficulty: 2, marks: 1, source: { kind: "manual" }, topic_label: "Quadratics",
    stem: "Find the **positive** root of $x^2 - 5x + 6 = 0$ that is larger than 2.5.",
    answer: 3,
    worked_solution: "$(x-2)(x-3) = 0$, so $x = 2$ or $x = 3$. The root larger than 2.5 is $x = 3$.",
  },
  {
    id: "s3", type: "short", difficulty: 2, marks: 1, source: { kind: "manual" }, topic_label: "Quadratics",
    stem: "Factorise $x^2 - 5x + 6$.",
    answers: ["(x-2)(x-3)", "(x-3)(x-2)"],
    worked_solution: "Two numbers that multiply to 6 and add to $-5$: $-2$ and $-3$.",
  },
  {
    id: "s4", type: "multi_select", difficulty: 3, marks: 2, source: { kind: "manual" }, topic_label: "Number",
    stem: "Which of these are prime?",
    options: [
      { key: "A", text: "2" },
      { key: "B", text: "9" },
      { key: "C", text: "17" },
      { key: "D", text: "21" },
    ],
    answers: ["A", "C"],
  },
  {
    id: "s5", type: "worked", difficulty: 4, marks: 4, source: { kind: "manual" }, topic_label: "Quadratics",
    stem: "Solve $2x^2 + 3x - 2 = 0$ by completing the square. Show your working.\n\n$$2x^2 + 3x - 2 = 0$$",
    marking_scheme: "M1 divide by 2; M1 complete the square $(x + \\tfrac{3}{4})^2 - \\tfrac{25}{16}$; A1 $x = \\tfrac{1}{2}$; A1 $x = -2$.",
    final_answer: "x = 1/2, x = -2",
  },
];
