import { describe, expect, it } from "vitest";
import { lessonFitsScreen, ROOM_MIN_WIDTH, ROOM_MIN_WIDTH_TOUCH } from "@/lib/lessons/device";

describe("lessonFitsScreen — a lesson opens on a laptop or tablet, never a phone", () => {
  it("refuses a phone in either orientation", () => {
    expect(lessonFitsScreen(390, true)).toBe(false);
    expect(lessonFitsScreen(844, true)).toBe(false);
    expect(lessonFitsScreen(932, true)).toBe(false); // a large phone held sideways: touch and under 1024
  });

  it("admits a tablet in landscape and any laptop", () => {
    expect(lessonFitsScreen(1024, true)).toBe(true);
    expect(lessonFitsScreen(1180, true)).toBe(true);
    expect(lessonFitsScreen(900, false)).toBe(true);
    expect(lessonFitsScreen(1440, false)).toBe(true);
  });

  it("refuses a desktop window narrower than the room is laid out for, whatever the pointer", () => {
    expect(lessonFitsScreen(899, false)).toBe(false);
    expect(lessonFitsScreen(ROOM_MIN_WIDTH - 1, false)).toBe(false);
    expect(lessonFitsScreen(ROOM_MIN_WIDTH, false)).toBe(true);
    expect(lessonFitsScreen(ROOM_MIN_WIDTH_TOUCH - 1, true)).toBe(false);
  });

  it("treats a width it cannot measure as too small", () => {
    expect(lessonFitsScreen(Number.NaN, false)).toBe(false);
  });
});
