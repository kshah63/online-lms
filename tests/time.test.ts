import { describe, expect, it } from "vitest";
import { dayWindowUTC, formatInTz, localToUTC } from "@/lib/time";

// §2 timezone rules: store UTC, render in the viewer's zone. Scheduling bugs
// here are the most damaging kind, so pin the conversions down.

describe("dayWindowUTC", () => {
  it("converts a Singapore calendar day to the right UTC window", () => {
    const { startUTC, endUTC } = dayWindowUTC("Asia/Singapore", "2026-06-20");
    // SGT is UTC+8 year-round: local midnight = 16:00 UTC the previous day.
    expect(startUTC).toBe("2026-06-19T16:00:00.000Z");
    expect(endUTC).toBe("2026-06-20T16:00:00.000Z");
  });

  it("spans exactly 24 hours", () => {
    const { startUTC, endUTC } = dayWindowUTC("America/New_York", "2026-06-20");
    expect(new Date(endUTC).getTime() - new Date(startUTC).getTime()).toBe(24 * 3600 * 1000);
  });
});

describe("localToUTC", () => {
  it("books 4:30pm New York as the correct UTC instant (EDT = UTC-4)", () => {
    expect(localToUTC("2026-06-20", "16:30", "America/New_York")).toBe("2026-06-20T20:30:00.000Z");
  });

  it("the same wall-clock time differs across zones", () => {
    const ny = localToUTC("2026-06-20", "16:30", "America/New_York");
    const sg = localToUTC("2026-06-20", "16:30", "Asia/Singapore");
    expect(ny).not.toBe(sg);
  });
});

describe("formatInTz", () => {
  it("renders a UTC instant in the viewer's timezone", () => {
    // 20:30 UTC = 16:30 in New York (EDT)
    const out = formatInTz("2026-06-20T20:30:00.000Z", "America/New_York");
    expect(out).toContain("4:30");
    expect(out).toContain("PM");
  });
});
