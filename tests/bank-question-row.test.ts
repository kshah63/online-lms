import { describe, expect, it } from "vitest";
import { draftToPayload, draftToRow, editorToPayload, emptyEditor, payloadToRow, questionToDraft, rowToEditor, rowToQuestion, stemSummary } from "@/lib/bank/question-row";
import { demoQuestions } from "@/lib/demo/bank";
import { SAMPLE_QUESTIONS } from "@/lib/practice/samples";
import type { DraftQuestion } from "@/lib/practice/extract-parse";

const byType = (type: string) => demoQuestions.find((q) => q.type === type && q.status === "approved")!;

function draft(overrides: Partial<DraftQuestion> = {}): DraftQuestion {
  return {
    number: "1", type: "numeric", stem: "Solve $x^2 = 9$, $x > 0$.", options: [], answer: "3", answers: [], tolerance: null, unit: null, marks: 1, difficulty: 2,
    topic_label: null, topic_id: null, page: 1, has_diagram: false, diagram_hint: null, worked_solution: null, marking_scheme: null, confidence: 0.9,
    review_notes: [], source: { kind: "pdf", file_id: "f", page: 1 }, ...overrides,
  };
}

describe("rowToQuestion — a practice_questions row as the runner's Question", () => {
  it("reads each type's answer column in its stored shape", () => {
    const mcq = rowToQuestion(byType("mcq"));
    expect(mcq.type === "mcq" && mcq.answer).toBe("A");
    const multi = rowToQuestion(byType("multi_select"));
    expect(multi.type === "multi_select" && multi.answers).toEqual(["A", "C"]);
    const numeric = rowToQuestion(byType("numeric"));
    expect(numeric.type === "numeric" && numeric.answer).toBe(3);
    const short = rowToQuestion(byType("short"));
    expect(short.type === "short" && short.answers).toEqual(["(x-2)(x-3)", "(x-3)(x-2)"]);
    const worked = rowToQuestion(byType("worked"));
    expect(worked.type).toBe("worked");
  });

  it("carries the signed image url and the topic label it is given", () => {
    const q = rowToQuestion(byType("mcq"), "https://x/y.png", "Completing the square");
    expect(q.image_url).toBe("https://x/y.png");
    expect(q.topic_label).toBe("Completing the square");
  });
});

describe("editorToPayload — upsert_question's p_question, or the sentence saying what is missing", () => {
  it("refuses an empty stem, a choice question without a correct option and a numeric answer that is not a number", () => {
    expect(editorToPayload(emptyEditor("mcq"))).toMatchObject({ ok: false, message: expect.stringMatching(/stem/) });
    const mcq = { ...emptyEditor("mcq"), stem: "Pick", options: [{ key: "A", text: "1" }, { key: "B", text: "2" }] };
    expect(editorToPayload(mcq)).toMatchObject({ ok: false, message: expect.stringMatching(/correct/) });
    const numeric = { ...emptyEditor("numeric"), stem: "How many?", answer: "twelve" };
    expect(editorToPayload(numeric)).toMatchObject({ ok: false, message: expect.stringMatching(/number/) });
    const worked = { ...emptyEditor("worked"), stem: "Prove it." };
    expect(editorToPayload(worked)).toMatchObject({ ok: false, message: expect.stringMatching(/worked solution/) });
  });

  it("stores each answer in the contract's jsonb shape and re-letters the options", () => {
    const mcq = editorToPayload({ ...emptyEditor("mcq"), stem: "Pick", options: [{ key: "Z", text: "1" }, { key: "B", text: "2" }], answer: "A" });
    expect(mcq.ok && mcq.payload).toMatchObject({ type: "mcq", answer: "A", options: [{ key: "A", text: "1" }, { key: "B", text: "2" }], id: null });
    const multi = editorToPayload({ ...emptyEditor("multi_select"), stem: "Pick", options: [{ key: "A", text: "1" }, { key: "B", text: "2" }, { key: "C", text: "3" }], answers: ["C", "A"] });
    expect(multi.ok && multi.payload.answer).toEqual(["A", "C"]);
    const numeric = editorToPayload({ ...emptyEditor("numeric"), stem: "n", answer: "1/2", tolerance: "0.01", unit: " cm " });
    expect(numeric.ok && numeric.payload).toMatchObject({ answer: 0.5, tolerance: 0.01, unit: "cm", options: null });
    const short = editorToPayload({ ...emptyEditor("short"), stem: "f", answer: "(x-2)(x-3)", accepted: ["(x-3)(x-2)", "", "(x-2)(x-3)"] });
    expect(short.ok && short.payload).toMatchObject({ answer: "(x-2)(x-3)", accepted: ["(x-3)(x-2)"] });
    const worked = editorToPayload({ ...emptyEditor("worked"), stem: "Show", worked_solution: "M1 A1" });
    expect(worked.ok && worked.payload).toMatchObject({ answer: null, worked_solution: "M1 A1" });
  });

  it("round-trips a stored row through the editor unchanged", () => {
    for (const row of demoQuestions.filter((q) => q.type !== "worked" && q.answer != null)) {
      const built = editorToPayload(rowToEditor(row));
      expect(built.ok, row.id).toBe(true);
      if (!built.ok) continue;
      const back = payloadToRow(built.payload, row, row.course_id, row.id, row.created_by!, row.updated_at);
      expect(back).toMatchObject({ id: row.id, type: row.type, stem: row.stem, answer: row.answer, status: row.status, syllabus_topic_id: row.syllabus_topic_id });
    }
  });
});

describe("draftToPayload / draftToRow — what store_extracted_questions receives", () => {
  it("shapes the answer per type: mcq key, multi_select keys, numeric number, short string with the rest accepted, worked null", () => {
    expect(draftToPayload(draft({ type: "mcq", options: [{ key: "A", text: "1" }, { key: "B", text: "2" }], answer: "B" }))).toMatchObject({ answer: "B", options: [{ key: "A", text: "1" }, { key: "B", text: "2" }] });
    expect(draftToPayload(draft({ type: "multi_select", options: [{ key: "A", text: "1" }, { key: "B", text: "2" }], answer: null, answers: ["A", "B"] }))).toMatchObject({ answer: ["A", "B"], answers: ["A", "B"] });
    expect(draftToPayload(draft({ answer: "12.5", unit: "cm", tolerance: 0.05 }))).toMatchObject({ answer: 12.5, unit: "cm", tolerance: 0.05, options: null });
    expect(draftToPayload(draft({ type: "short", answer: null, answers: ["x=5", "5=x"] }))).toMatchObject({ answer: "x=5", accepted: ["5=x"] });
    expect(draftToPayload(draft({ type: "worked", answer: "7", marking_scheme: "M1 A1", worked_solution: "Expand." }))).toMatchObject({ answer: null, worked_solution: "Expand.\n\n**Marking scheme.** M1 A1" });
  });

  it("keeps the topic and the pdf source", () => {
    const p = draftToPayload(draft({ topic_id: "t1", source: { kind: "pdf", file_id: "ws", page: 3 } }));
    expect(p).toMatchObject({ topic_id: "t1", source: { kind: "pdf", file_id: "ws", page: 3 }, difficulty: 2, marks: 1 });
  });

  it("makes a draft row the bank can list, with the ids and author it is given", () => {
    const row = draftToRow(draft({ type: "short", answer: null, answers: ["x=5"] }), "c1", "id1", "u1", "2026-01-01T00:00:00.000Z");
    expect(row).toMatchObject({ id: "id1", course_id: "c1", status: "draft", created_by: "u1", answer: "x=5", accepted: null, reviewed_at: null });
  });
});

describe("questionToDraft — the sample questions as the demo's extraction result", () => {
  it("converts every sample question and keeps its answer", () => {
    const drafts = SAMPLE_QUESTIONS.map((q, i) => questionToDraft(q, String(i + 1), "file-ws-1"));
    expect(drafts.map((d) => d.type)).toEqual(["mcq", "numeric", "short", "multi_select", "worked"]);
    expect(drafts[0]!.answer).toBe("A");
    expect(drafts[1]!.answer).toBe("3");
    expect(drafts[2]!.answers).toEqual(["(x-2)(x-3)", "(x-3)(x-2)"]);
    expect(drafts[3]!.answers).toEqual(["A", "C"]);
    expect(drafts[4]!.marking_scheme).toMatch(/M1/);
    expect(drafts.every((d) => d.source.file_id === "file-ws-1")).toBe(true);
  });
});

describe("stemSummary", () => {
  it("takes the first non-empty line and shortens it", () => {
    expect(stemSummary("\n\nSolve $x^2 = 4$.\n\n$$x^2 = 4$$")).toBe("Solve $x^2 = 4$.");
    expect(stemSummary("a".repeat(200), 20)).toHaveLength(20);
  });
});
