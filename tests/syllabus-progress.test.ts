import { describe, expect, it } from "vitest";
import { practiceByWeek, summariseCourse, topicProgress, weightedAccuracy } from "@/lib/syllabus/progress";

const NOW = "2026-10-13T00:00:00.000Z";
const d = (daysAgo: number) => new Date(new Date(NOW).getTime() - daysAgo * 86_400_000).toISOString();

describe("topicProgress", () => {
  it("is not started with no evidence", () => {
    const p = topicProgress({ topic_id: "t", sessions: [], practice: [], tests: [] }, NOW);
    expect(p).toMatchObject({ status: "not_started", confidence: 1, accuracy: null });
  });
  it("is in progress when taught but not completed, covered when completed", () => {
    expect(topicProgress({ topic_id: "t", sessions: [{ at: d(2), completed: false }], practice: [], tests: [] }, NOW).status).toBe("in_progress");
    expect(topicProgress({ topic_id: "t", sessions: [{ at: d(2), completed: true }], practice: [], tests: [] }, NOW).status).toBe("covered");
  });
  it("needs work on low accuracy with enough items, secure on high accuracy after completion", () => {
    const low = topicProgress({ topic_id: "t", sessions: [{ at: d(5), completed: true }], practice: [{ at: d(1), correct: 2, total: 6 }], tests: [] }, NOW);
    expect(low.status).toBe("needs_work");
    expect(low.reasons[0]).toMatch(/33%/);
    const high = topicProgress({ topic_id: "t", sessions: [{ at: d(5), completed: true }], practice: [{ at: d(1), correct: 9, total: 10 }], tests: [] }, NOW);
    expect(high.status).toBe("secure");
    // High accuracy but the topic was never completed and no test: stays covered? No — not taught-complete → in_progress is wrong; it is practised only.
    const practisedOnly = topicProgress({ topic_id: "t", sessions: [], practice: [{ at: d(1), correct: 9, total: 10 }], tests: [] }, NOW);
    expect(practisedOnly.status).toBe("in_progress");
  });
  it("does not judge on too few items", () => {
    const p = topicProgress({ topic_id: "t", sessions: [{ at: d(5), completed: true }], practice: [{ at: d(1), correct: 0, total: 3 }], tests: [] }, NOW);
    expect(p.status).toBe("covered");
  });
  it("weights recent practice more than old practice", () => {
    const { accuracy } = weightedAccuracy([{ at: d(60), correct: 0, total: 10 }, { at: d(1), correct: 10, total: 10 }], NOW);
    expect(accuracy!).toBeGreaterThan(0.75);
  });
  it("uses a low test score as needs-work evidence", () => {
    const p = topicProgress({ topic_id: "t", sessions: [{ at: d(5), completed: true }], practice: [], tests: [{ at: d(1), score: 4, out_of: 10 }] }, NOW);
    expect(p).toMatchObject({ status: "needs_work", last_test_pct: 40 });
  });
  it("lets the teacher's mark stand unless newer evidence contradicts it", () => {
    const stands = topicProgress({ topic_id: "t", sessions: [], practice: [{ at: d(10), correct: 1, total: 6 }], tests: [], teacher_mark: { status: "secure", at: d(5), note: "Nailed it in class" } }, NOW);
    expect(stands).toMatchObject({ status: "secure", confidence: 0.9 });
    expect(stands.reasons[0]).toMatch(/Nailed it/);
    const overturned = topicProgress({ topic_id: "t", sessions: [], practice: [{ at: d(1), correct: 1, total: 8 }], tests: [], teacher_mark: { status: "secure", at: d(5) } }, NOW);
    expect(overturned.status).toBe("needs_work");
    expect(overturned.reasons[0]).toMatch(/newer practice items say otherwise/);
  });
});

describe("summariseCourse / practiceByWeek", () => {
  it("summarises coverage, weak areas and what to do next", () => {
    const topics = [
      topicProgress({ topic_id: "a", sessions: [{ at: d(20), completed: true }], practice: [{ at: d(2), correct: 9, total: 10 }], tests: [] }, NOW),
      topicProgress({ topic_id: "b", sessions: [{ at: d(10), completed: true }], practice: [{ at: d(2), correct: 3, total: 10 }], tests: [] }, NOW),
      topicProgress({ topic_id: "c", sessions: [{ at: d(3), completed: true }], practice: [], tests: [] }, NOW),
      topicProgress({ topic_id: "d", sessions: [], practice: [], tests: [] }, NOW),
    ];
    const s = summariseCourse(topics);
    expect(s.total).toBe(4);
    expect(s.counts).toEqual({ not_started: 1, in_progress: 0, covered: 1, secure: 1, needs_work: 1 });
    expect(s.coverage).toBe(0.75);
    expect(s.weak_areas.map((t) => t.topic_id)).toEqual(["b"]);
    expect(s.recommended_next.map((t) => t.topic_id)).toEqual(["b", "c"]);
    expect(s.practice_items_total).toBe(20);
  });
  it("buckets practice into the last N weeks", () => {
    const weeks = practiceByWeek([{ at: d(1), total: 5 }, { at: d(8), total: 3 }, { at: d(100), total: 99 }], 4, NOW);
    expect(weeks).toHaveLength(4);
    expect(weeks[3]!.items).toBe(5);
    expect(weeks[2]!.items).toBe(3);
    expect(weeks.reduce((s, w) => s + w.items, 0)).toBe(8);
  });
});
