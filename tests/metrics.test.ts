import { describe, expect, it } from "vitest";
import { computeMetrics, type TranscriptSegment } from "@/lib/coaching/metrics";

// §7.1 transcript → metrics. These numbers drive both the live coach and the
// post-session report, so the basics must hold exactly.

function seg(
  speaker: "teacher" | "student",
  text: string,
  startS: number,
  endS: number,
): TranscriptSegment {
  return { speaker, text, start_ms: startS * 1000, end_ms: endS * 1000 };
}

describe("computeMetrics", () => {
  it("returns all-zero metrics for an empty transcript", () => {
    const m = computeMetrics([]);
    expect(m.teacher_talk_pct).toBe(0);
    expect(m.student_talk_pct).toBe(0);
    expect(m.question_count).toBe(0);
    expect(m.student_turns).toBe(0);
  });

  it("splits talk time between teacher and student", () => {
    const m = computeMetrics([
      seg("teacher", "Today we factor quadratics.", 0, 30),
      seg("student", "Okay, I remember some of this.", 31, 41),
    ]);
    // 30s teacher vs 10s student of 40s total speech
    expect(m.teacher_talk_pct).toBeCloseTo(0.75, 5);
    expect(m.student_talk_pct).toBeCloseTo(0.25, 5);
    expect(m.teacher_talk_pct + m.student_talk_pct).toBeCloseTo(1, 5);
  });

  it("counts teacher questions and classifies open ones", () => {
    const m = computeMetrics([
      seg("teacher", "How would you start this problem?", 0, 4), // open
      seg("student", "Maybe expand the bracket first.", 5, 9),
      seg("teacher", "Is that a quadratic?", 10, 12), // closed
      seg("student", "Yes.", 13, 14),
    ]);
    expect(m.question_count).toBe(2);
    expect(m.open_question_pct).toBeCloseTo(0.5, 5);
  });

  it("counts praise moments", () => {
    const m = computeMetrics([
      seg("teacher", "Well done, that's exactly the idea.", 0, 3),
      seg("student", "Thanks!", 4, 5),
      seg("teacher", "Now try the next one.", 6, 8),
    ]);
    expect(m.praise_count).toBeGreaterThanOrEqual(1);
  });

  it("counts student turns", () => {
    const m = computeMetrics([
      seg("teacher", "What is x?", 0, 2),
      seg("student", "Two?", 3, 4),
      seg("teacher", "Why two?", 5, 6),
      seg("student", "Because both factors are x minus two.", 7, 11),
    ]);
    expect(m.student_turns).toBe(2);
    expect(m.avg_student_turn_ms).toBeGreaterThan(0);
  });
});
