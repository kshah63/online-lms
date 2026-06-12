import { describe, expect, it } from "vitest";
import { heuristicFeedback } from "@/lib/coaching/analyze";
import type { SessionMetrics } from "@/lib/coaching/metrics";

// The no-AI fallback (also used when a teacher is over the AI rate limit) must
// always produce a complete, bounded report.

function metrics(overrides: Partial<SessionMetrics> = {}): SessionMetrics {
  return {
    teacher_talk_pct: 0.5,
    student_talk_pct: 0.5,
    question_count: 6,
    open_question_pct: 0.5,
    avg_wait_ms: 3000,
    student_turns: 12,
    avg_student_turn_ms: 6000,
    praise_count: 4,
    ...overrides,
  };
}

describe("heuristicFeedback", () => {
  it("always returns at least one strength and one suggestion", () => {
    for (const m of [metrics(), metrics({ student_talk_pct: 0, praise_count: 0, avg_wait_ms: 0 })]) {
      const f = heuristicFeedback(m);
      expect(f.strengths.length).toBeGreaterThan(0);
      expect(f.suggestions.length).toBeGreaterThan(0);
      expect(f.summary.length).toBeGreaterThan(0);
    }
  });

  it("keeps all dimension scores within 1–5", () => {
    const extremes = [
      metrics({ student_talk_pct: 0, question_count: 0, avg_wait_ms: 0, praise_count: 0 }),
      metrics({ student_talk_pct: 1, question_count: 50, avg_wait_ms: 10_000, praise_count: 20 }),
    ];
    for (const m of extremes) {
      const f = heuristicFeedback(m);
      for (const score of Object.values(f.dimension_scores)) {
        expect(score).toBeGreaterThanOrEqual(1);
        expect(score).toBeLessThanOrEqual(5);
      }
    }
  });

  it("suggests talking less when the teacher dominates", () => {
    const f = heuristicFeedback(metrics({ teacher_talk_pct: 0.9, student_talk_pct: 0.1 }));
    expect(f.suggestions.join(" ").toLowerCase()).toContain("talk less");
  });
});
