import { describe, expect, it } from "vitest";
import {
  rangesOverlap,
  isOverlapViolation,
  ACTIVE_STATUSES,
} from "@/lib/booking/conflicts";

// The double-booking guard (0014 + server actions). The interval logic must be
// half-open: back-to-back lessons are legal, any true overlap is not.

const T = (h: number, m = 0) =>
  `2026-06-20T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00.000Z`;

describe("rangesOverlap", () => {
  it("detects a plain overlap", () => {
    expect(rangesOverlap(T(10), T(11), T(10, 30), T(11, 30))).toBe(true);
  });

  it("detects containment (one lesson inside another)", () => {
    expect(rangesOverlap(T(10), T(12), T(10, 30), T(11))).toBe(true);
    expect(rangesOverlap(T(10, 30), T(11), T(10), T(12))).toBe(true);
  });

  it("detects identical slots", () => {
    expect(rangesOverlap(T(10), T(11), T(10), T(11))).toBe(true);
  });

  it("allows back-to-back lessons (end == next start)", () => {
    expect(rangesOverlap(T(10), T(11), T(11), T(12))).toBe(false);
    expect(rangesOverlap(T(11), T(12), T(10), T(11))).toBe(false);
  });

  it("allows fully separate slots", () => {
    expect(rangesOverlap(T(9), T(10), T(14), T(15))).toBe(false);
  });

  it("overlaps by a single minute", () => {
    expect(rangesOverlap(T(10), T(11, 1), T(11), T(12))).toBe(true);
  });
});

describe("isOverlapViolation", () => {
  it("matches the Postgres exclusion violation code", () => {
    expect(isOverlapViolation({ code: "23P01", message: "conflicting key value" })).toBe(true);
  });

  it("matches by constraint name when the code is missing", () => {
    expect(
      isOverlapViolation({ message: 'violates exclusion constraint "sessions_no_student_overlap"' }),
    ).toBe(true);
  });

  it("ignores unrelated errors and null", () => {
    expect(isOverlapViolation({ code: "23505", message: "duplicate key" })).toBe(false);
    expect(isOverlapViolation(null)).toBe(false);
  });
});

describe("ACTIVE_STATUSES", () => {
  it("blocks on live statuses only — cancelled/completed lessons free the slot", () => {
    expect([...ACTIVE_STATUSES]).toEqual(["scheduled", "confirmed", "in_progress"]);
    expect(ACTIVE_STATUSES).not.toContain("cancelled");
    expect(ACTIVE_STATUSES).not.toContain("completed");
  });
});
