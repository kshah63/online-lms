import { describe, expect, it } from "vitest";
import { heuristicSessionReport, normaliseDraft } from "@/lib/reports/draft-session-report";
import { validateReportDraft } from "@/lib/reports/mvapp-template";

const base = { notes: "Good focus. Struggled with negative coefficients.", segments: [], metrics: null, studentName: "Aarav Sharma", course: "IGCSE Maths", topicOptions: ["Quadratics", "Surds"], bookedTopic: "Quadratics", signs: true };

describe("heuristicSessionReport", () => {
  it("produces a valid signed draft from notes and results", () => {
    const { draft } = heuristicSessionReport({ ...base, testResults: [{ name: "Quick check", score: 8, out_of: 10 }], previousHomework: "Ex 4B", previousHomeworkStatus: "verified" });
    expect(validateReportDraft(draft, { signs: true })).toEqual([]);
    expect(draft).toMatchObject({ topic: "Quadratics", understanding: 8, prev_hw: "Yes", written_tests: [{ name: "Quick check", score: 8, out_of: 10, percent: 80 }] });
    expect(draft.remarks).toMatch(/^Aarav/);
    expect(draft.gp).not.toBeNull();
  });
  it("leaves the GP for the in-charge when the author does not sign", () => {
    const { draft } = heuristicSessionReport({ ...base, signs: false });
    expect(draft.gp).toBeNull();
    expect(validateReportDraft(draft, { signs: false })).toEqual([]);
  });
});

describe("normaliseDraft", () => {
  it("coerces model output into the template vocabulary", () => {
    const draft = normaliseDraft(
      { topic: "quadratics", topic_completed: false, topics_not_done: "completing the square", understanding: 7.4, otr: 82, gp: 5.9, prev_hw: "partly", homework: "Ex 5A", remarks: "Well done.", written_tests: [{ name: "Quick check", score: 8, out_of: 10 }], has_upcoming_tests: "yes" },
      { signs: true, topicOptions: ["Quadratics"], bookedTopic: null, testResults: [{ name: "quick check", score: 8, out_of: 10 }] },
    );
    expect(draft).toMatchObject({ topic: "Quadratics", topic_completed: false, topics_not_done: "completing the square", understanding: 7, otr: 80, gp: 6, prev_hw: "Partially Done", has_upcoming_tests: true });
    expect(draft.written_tests).toHaveLength(1);
    expect(validateReportDraft(draft, { signs: true })).toEqual([]);
  });
  it("drops the GP and topics_not_done when they are not allowed", () => {
    const draft = normaliseDraft({ topic: "X", topic_completed: true, topics_not_done: "y", understanding: 5, gp: 6 }, { signs: false, topicOptions: [], bookedTopic: null, testResults: [] });
    expect(draft.gp).toBeNull();
    expect(draft.topics_not_done).toBeNull();
  });
});
