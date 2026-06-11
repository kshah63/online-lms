import type { TranscriptSegment } from "@/lib/coaching/metrics";

// A scripted, teacher-heavy lesson used in demo mode to drive the live coach
// (no live audio available). Virtual timestamps advance quickly so the
// thresholds in coach.ts trip within seconds of real time.
export const DEMO_LESSON_TRANSCRIPT: TranscriptSegment[] = [
  { speaker: "teacher", start_ms: 0, end_ms: 96_000,
    text: "Alright, today we're completing the square. The idea is to rewrite a quadratic so the x-terms become a perfect square, which makes it easy to find the vertex. Let me walk you through the whole method first." },
  { speaker: "student", start_ms: 96_000, end_ms: 101_000, text: "Okay." },
  { speaker: "teacher", start_ms: 101_000, end_ms: 214_000,
    text: "So with x squared plus six x, you take half of six, which is three, then square it to get nine. You add and subtract that nine so you don't change the value, and now you can factor the first three terms as x plus three all squared." },
  { speaker: "student", start_ms: 214_000, end_ms: 218_000, text: "Got it." },
  { speaker: "teacher", start_ms: 218_000, end_ms: 372_000,
    text: "Then the minus nine stays outside. So the whole thing becomes x plus three squared minus nine, and that tells us the vertex is at minus three, minus nine. Let me also show you what happens when the coefficient in front isn't one." },
  { speaker: "student", start_ms: 372_000, end_ms: 375_000, text: "Mhm." },
  { speaker: "teacher", start_ms: 375_000, end_ms: 520_000,
    text: "When there's a two in front, you factor it out of the first two terms first, then complete the square inside the bracket, and remember to multiply back through at the end. It's a common place to drop a sign, so go slowly there." },
  { speaker: "student", start_ms: 520_000, end_ms: 523_000, text: "Right." },
  { speaker: "teacher", start_ms: 523_000, end_ms: 690_000,
    text: "Let me do one more example before you try. Take x squared minus ten x plus eight. Half of ten is five, squared is twenty-five, so we get x minus five squared minus twenty-five plus eight, which simplifies to x minus five squared minus seventeen." },
];
