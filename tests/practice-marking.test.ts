import { describe, expect, it } from "vitest";
import { markQuestion, markSet, normaliseShortText } from "@/lib/practice/marking";
import { defaultTolerance, numbersMatch, parseNumber } from "@/lib/practice/numbers";
import type { Question } from "@/lib/practice/model";

const src = { kind: "manual" as const };

const mcq: Question = {
  id: "q1", type: "mcq", stem: "2+2?", difficulty: 1, marks: 1, source: src,
  options: [{ key: "A", text: "3" }, { key: "B", text: "4" }], answer: "B",
};
const multi: Question = {
  id: "q2", type: "multi_select", stem: "Which are prime?", difficulty: 2, marks: 2, source: src,
  options: [{ key: "A", text: "2" }, { key: "B", text: "4" }, { key: "C", text: "5" }, { key: "D", text: "9" }],
  answers: ["A", "C"],
};
const numeric: Question = { id: "q3", type: "numeric", stem: "3/4 as a decimal", difficulty: 1, marks: 1, source: src, answer: 0.75 };
const numericInt: Question = { id: "q4", type: "numeric", stem: "5²", difficulty: 1, marks: 1, source: src, answer: 25 };
const numericPct: Question = { id: "q5", type: "numeric", stem: "π to 2dp", difficulty: 1, marks: 1, source: src, answer: 3.14159, tolerance_pct: 1 };
const short: Question = { id: "q6", type: "short", stem: "Solve x+2=7", difficulty: 1, marks: 1, source: src, answers: ["x = 5", "5"] };
const worked: Question = {
  id: "q7", type: "worked", stem: "Factorise x²-5x+6", difficulty: 2, marks: 3, source: src,
  marking_scheme: "M1 pairs, A1 each factor", final_answer: "(x-2)(x-3)",
};

describe("parseNumber", () => {
  it("reads decimals, fractions, mixed numbers, unicode minus, units and thousands", () => {
    expect(parseNumber("0.75")).toBe(0.75);
    expect(parseNumber("3/4")).toBe(0.75);
    expect(parseNumber("7 1/2")).toBe(7.5);
    expect(parseNumber("−2.5")).toBe(-2.5);
    expect(parseNumber("12 cm")).toBe(12);
    expect(parseNumber("1,250")).toBe(1250);
    expect(parseNumber("x = 5")).toBe(5);
    expect(parseNumber("3e2")).toBe(300);
    expect(parseNumber("50%")).toBe(50);
  });
  it("rejects non-numbers and division by zero", () => {
    expect(parseNumber("five")).toBeNull();
    expect(parseNumber("1/0")).toBeNull();
    expect(parseNumber("")).toBeNull();
    expect(parseNumber("2x+1")).toBeNull();
  });
});

describe("numbersMatch", () => {
  it("uses half a unit in the last decimal place by default", () => {
    expect(defaultTolerance(2.35)).toBeCloseTo(0.005, 9);
    expect(numbersMatch(2.354, 2.35)).toBe(true);
    expect(numbersMatch(2.36, 2.35)).toBe(false);
  });
  it("is strict for integer answers", () => {
    expect(numbersMatch(25, 25)).toBe(true);
    expect(numbersMatch(25.3, 25)).toBe(false);
  });
  it("honours explicit absolute and percentage tolerances", () => {
    expect(numbersMatch(10.4, 10, { tolerance: 0.5 })).toBe(true);
    expect(numbersMatch(3.1, 3.14159, { tolerance_pct: 1 })).toBe(false);
    expect(numbersMatch(3.12, 3.14159, { tolerance_pct: 1 })).toBe(true);
  });
});

describe("markQuestion", () => {
  it("marks mcq", () => {
    expect(markQuestion(mcq, { type: "mcq", key: "B" }).status).toBe("correct");
    expect(markQuestion(mcq, { type: "mcq", key: "A" }).score).toBe(0);
    expect(markQuestion(mcq, { type: "mcq", key: null }).status).toBe("unanswered");
    expect(markQuestion(mcq, null).status).toBe("unanswered");
  });
  it("gives multi-select partial credit with a penalty for wrong picks", () => {
    expect(markQuestion(multi, { type: "multi_select", keys: ["A", "C"] })).toMatchObject({ status: "correct", score: 2 });
    expect(markQuestion(multi, { type: "multi_select", keys: ["A"] })).toMatchObject({ status: "partial", score: 1 });
    expect(markQuestion(multi, { type: "multi_select", keys: ["A", "B"] })).toMatchObject({ status: "incorrect", score: 0 });
    expect(markQuestion(multi, { type: "multi_select", keys: ["A", "C", "B"] })).toMatchObject({ status: "partial", score: 1 });
  });
  it("marks numeric answers in any readable form", () => {
    expect(markQuestion(numeric, { type: "numeric", text: "3/4" }).status).toBe("correct");
    expect(markQuestion(numeric, { type: "numeric", text: "0.75" }).status).toBe("correct");
    expect(markQuestion(numeric, { type: "numeric", text: "0.7" }).status).toBe("incorrect");
    expect(markQuestion(numericInt, { type: "numeric", text: "25.0" }).status).toBe("correct");
    expect(markQuestion(numericInt, { type: "numeric", text: "twenty five" }).status).toBe("incorrect");
    expect(markQuestion(numericPct, { type: "numeric", text: "3.14" }).status).toBe("correct");
  });
  it("marks short answers with normalisation and numeric equivalence", () => {
    expect(normaliseShortText("X = 5.")).toBe("x=5");
    expect(markQuestion(short, { type: "short", text: "x=5" }).status).toBe("correct");
    expect(markQuestion(short, { type: "short", text: "5.0" }).status).toBe("correct");
    expect(markQuestion(short, { type: "short", text: "x = 4" }).status).toBe("incorrect");
  });
  it("sends worked questions to review and checks the final answer when given", () => {
    const r = markQuestion(worked, { type: "worked", final_answer: "(x−2)(x−3)", evidence: [{ kind: "notebook_page", ref: "p1" }] });
    expect(r.status).toBe("pending_review");
    expect(r.score).toBe(0);
    expect(r.feedback).toMatch(/matches/);
    const wrong = markQuestion(worked, { type: "worked", final_answer: "(x+2)(x+3)", evidence: [] });
    expect(wrong.feedback).toMatch(/does not match/);
    expect(markQuestion(worked, { type: "worked", evidence: [] }).status).toBe("unanswered");
  });
  it("treats a mismatched response type as incorrect, not a crash", () => {
    expect(markQuestion(mcq, { type: "numeric", text: "4" }).status).toBe("incorrect");
  });
});

describe("markSet", () => {
  it("totals auto-marked items and keeps pending ones out of accuracy", () => {
    const set = markSet([
      { question: mcq, response: { type: "mcq", key: "B" } },
      { question: numeric, response: { type: "numeric", text: "0.5" } },
      { question: worked, response: { type: "worked", evidence: [{ kind: "image", ref: "i" }] } },
    ]);
    expect(set.score).toBe(1);
    expect(set.max).toBe(5);
    expect(set.pending).toBe(1);
    expect(set.auto_accuracy).toBe(0.5);
  });
});
