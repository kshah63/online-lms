import { describe, expect, it } from "vitest";
import { createCoachState, ingestSegment, evaluateTick } from "@/lib/coaching/coach";
import type { TranscriptSegment } from "@/lib/coaching/metrics";

// §7.2 live coach rules. These nudges surface to teachers mid-lesson, so the
// triggers and (especially) the rate-limiting must behave deterministically.

function seg(
  speaker: "teacher" | "student",
  text: string,
  startS: number,
  endS: number,
): TranscriptSegment {
  return { speaker, text, start_ms: startS * 1000, end_ms: endS * 1000 };
}

describe("teacher monologue", () => {
  it("fires after >90s of continuous teacher talk", () => {
    const state = createCoachState();
    const nudges = ingestSegment(state, seg("teacher", "Let me explain the whole chapter.", 0, 95));
    expect(nudges.some((n) => n.type === "teacher_monologue")).toBe(true);
  });

  it("resets when the student speaks", () => {
    const state = createCoachState();
    ingestSegment(state, seg("teacher", "First, the formula.", 0, 60));
    ingestSegment(state, seg("student", "Got it.", 61, 62));
    const nudges = ingestSegment(state, seg("teacher", "Then we substitute.", 63, 123));
    // 60s after the reset — under the 90s threshold.
    expect(nudges.some((n) => n.type === "teacher_monologue")).toBe(false);
  });
});

describe("wait time", () => {
  it("nudges when the teacher answers their own question too quickly", () => {
    const state = createCoachState();
    ingestSegment(state, seg("teacher", "What do you think x is?", 0, 2));
    const nudges = ingestSegment(state, seg("teacher", "It's two, see?", 3, 5)); // 1s gap < 3s
    expect(nudges.some((n) => n.type === "wait_time")).toBe(true);
  });

  it("stays silent when the student gets to answer", () => {
    const state = createCoachState();
    ingestSegment(state, seg("teacher", "What do you think x is?", 0, 2));
    const nudges = ingestSegment(state, seg("student", "Two?", 6, 7));
    expect(nudges.some((n) => n.type === "wait_time")).toBe(false);
  });
});

describe("closed-question streak", () => {
  it("fires after three closed questions in a row", () => {
    const state = createCoachState();
    // Spread out so the same-type cooldown isn't what we're measuring.
    ingestSegment(state, seg("teacher", "Is it positive?", 0, 2));
    ingestSegment(state, seg("teacher", "Did you expand it?", 70, 72));
    const nudges = ingestSegment(state, seg("teacher", "Is that the answer?", 140, 142));
    expect(nudges.some((n) => n.type === "closed_questions")).toBe(true);
  });

  it("an open question resets the streak", () => {
    const state = createCoachState();
    ingestSegment(state, seg("teacher", "Is it positive?", 0, 2));
    ingestSegment(state, seg("teacher", "Did you expand it?", 70, 72));
    ingestSegment(state, seg("teacher", "How did you get there?", 140, 142)); // open
    const nudges = ingestSegment(state, seg("teacher", "Is that the answer?", 210, 212));
    expect(nudges.some((n) => n.type === "closed_questions")).toBe(false);
  });
});

describe("silence ticks", () => {
  // NB: segments must start at a nonzero time — startedAtMs === 0 means
  // "not anchored yet" (in production these are epoch timestamps).
  it("flags a quiet student after 2 minutes", () => {
    const state = createCoachState();
    ingestSegment(state, seg("teacher", "Let's begin.", 1, 6));
    const nudges = evaluateTick(state, 130_000);
    expect(nudges.some((n) => n.type === "student_quiet")).toBe(true);
  });

  it("flags total silence after ~35s once the lesson is underway", () => {
    const state = createCoachState();
    ingestSegment(state, seg("teacher", "Try this one yourself.", 1, 71));
    const nudges = evaluateTick(state, 111_000);
    expect(nudges.some((n) => n.type === "both_quiet")).toBe(true);
  });
});

describe("rate limiting", () => {
  it("the same nudge type doesn't repeat inside the 60s cooldown", () => {
    const state = createCoachState();
    const first = ingestSegment(state, seg("teacher", "Long monologue…", 0, 95));
    expect(first.some((n) => n.type === "teacher_monologue")).toBe(true);
    const again = ingestSegment(state, seg("teacher", "…still going.", 96, 126));
    expect(again.some((n) => n.type === "teacher_monologue")).toBe(false);
  });

  it("caps at 3 nudges per 5-minute window", () => {
    const state = createCoachState();
    // Fill the window with 3 admitted nudges of different types.
    ingestSegment(state, seg("teacher", "What do you think?", 0, 2));
    ingestSegment(state, seg("teacher", "Answer is two.", 3, 5)); // wait_time (1)
    ingestSegment(state, seg("teacher", "Monologue continues for ages now.", 6, 100)); // monologue (2)
    const s3 = evaluateTick(state, 230_000); // student_quiet (3)
    expect(s3.length).toBeGreaterThan(0);
    // A 4th distinct nudge inside the same window is suppressed.
    const s4 = evaluateTick(state, 240_000);
    expect(s4.length).toBe(0);
  });
});
