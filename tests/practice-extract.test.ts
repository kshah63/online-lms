import { describe, expect, it } from "vitest";
import { matchTopic, mergeAnswerKey, normaliseQuestionNumber, parseExtraction } from "@/lib/practice/extract-parse";

const topics = [{ id: "t1", label: "Quadratics" }, { id: "t2", label: "Surds and indices" }];

function raw(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    number: "Q3 (a)", type: "numeric", stem: "Solve $x^2=9$, $x>0$.", options: [], answer: "3", answers: [], tolerance: null, unit: null,
    marks: 1, difficulty: 2, topic_label: "quadratics", page: 2, has_diagram: false, diagram_bbox: null, worked_solution: null,
    marking_scheme: null, confidence: 0.95, notes: null, ...overrides,
  };
}

describe("normaliseQuestionNumber / matchTopic", () => {
  it("normalises numbering styles", () => {
    expect(normaliseQuestionNumber("Q3 (a)")).toBe("3a");
    expect(normaliseQuestionNumber("7(ii)")).toBe("7ii");
    expect(normaliseQuestionNumber("12.")).toBe("12");
    expect(normaliseQuestionNumber("Question 4b")).toBe("4b");
  });
  it("matches topics loosely", () => {
    expect(matchTopic("quadratics", topics)?.id).toBe("t1");
    expect(matchTopic("Indices", topics)?.id).toBe("t2");
    expect(matchTopic("Vectors", topics)).toBeNull();
  });
});

describe("parseExtraction", () => {
  it("keeps a clean confident question with no review notes", () => {
    const r = parseExtraction({ worksheet_title: "W", has_answer_key: true, questions: [raw()], answer_key: [] }, { file_id: "f", topics });
    expect(r.errors).toEqual([]);
    expect(r.questions[0]).toMatchObject({ number: "3a", type: "numeric", answer: "3", topic_id: "t1", topic_label: "Quadratics", review_notes: [] });
    expect(r.questions[0]!.source).toEqual({ kind: "pdf", file_id: "f", page: 2 });
  });
  it("flags missing answers, low confidence, unknown topics and diagrams without hints", () => {
    const r = parseExtraction(
      { worksheet_title: "W", has_answer_key: false, questions: [raw({ answer: null, confidence: 0.4, topic_label: "Vectors", has_diagram: true })], answer_key: [] },
      { file_id: "f", topics },
    );
    const notes = r.questions[0]!.review_notes.join(" | ");
    expect(notes).toMatch(/No answer available/);
    expect(notes).toMatch(/Low extraction confidence \(40%\)/);
    expect(notes).toMatch(/not in the syllabus list/);
    expect(notes).toMatch(/no crop hint/);
    expect(r.questions[0]!.topic_id).toBeNull();
    expect(r.questions[0]!.topic_label).toBe("Vectors");
  });
  it("re-types by evidence: options make mcq, non-numeric answers make short", () => {
    const r = parseExtraction(
      {
        worksheet_title: "W", has_answer_key: true,
        questions: [
          raw({ number: "1", type: "short", options: [{ key: "a", text: "2" }, { key: "b", text: "4" }], answer: "(b)" }),
          raw({ number: "2", type: "numeric", answer: "x = 2 or x = 3" }),
          raw({ number: "3", type: "mcq", options: [], answer: "7" }),
        ],
        answer_key: [],
      },
      { file_id: "f", topics },
    );
    expect(r.questions[0]).toMatchObject({ type: "mcq", answer: "B" });
    expect(r.questions[1]).toMatchObject({ type: "short", answers: ["x = 2 or x = 3"], answer: null });
    expect(r.questions[2]).toMatchObject({ type: "numeric", answer: "7" });
  });
  it("fills answers from an inline answer key by question number", () => {
    const r = parseExtraction(
      { worksheet_title: "W", has_answer_key: true, questions: [raw({ number: "5(b)", answer: null })], answer_key: [{ number: "5b", answer: "12", working: "x=12" }] },
      { file_id: "f", topics },
    );
    expect(r.questions[0]).toMatchObject({ answer: "12", worked_solution: "x=12" });
    expect(r.questions[0]!.review_notes).toContain("Answer taken from the answer key.");
  });
  it("reports schema errors instead of throwing", () => {
    const r = parseExtraction({ questions: [{ number: 3 }] }, { file_id: "f", topics });
    expect(r.questions).toEqual([]);
    expect(r.errors.length).toBeGreaterThan(0);
  });
});

describe("mergeAnswerKey", () => {
  it("fills missing answers from a separate key and flags disagreements", () => {
    const base = parseExtraction(
      { worksheet_title: "W", has_answer_key: false, questions: [raw({ number: "1", answer: null }), raw({ number: "2", answer: "4" }), raw({ number: "3", type: "mcq", options: [{ key: "A", text: "1" }, { key: "B", text: "2" }], answer: null })], answer_key: [] },
      { file_id: "f", topics },
    ).questions;
    const merged = mergeAnswerKey(base, [{ number: "Q1", answer: "9" }, { number: "2", answer: "5" }, { number: "3", answer: "(b)" }]);
    expect(merged[0]).toMatchObject({ answer: "9" });
    expect(merged[0]!.review_notes.some((n) => n.startsWith("No answer available"))).toBe(false);
    expect(merged[1]!.review_notes.join(" ")).toMatch(/Answer key says "5"/);
    expect(merged[2]).toMatchObject({ answer: "B" });
  });
});
