import { describe, expect, it } from "vitest";
import { lessonEndISO, lessonIsLive, roomIsOpen, type LessonWindow } from "@/lib/lessons/window";

const T0 = Date.parse("2026-10-13T10:00:00Z");
const min = (n: number) => n * 60_000;

function lesson(over: Partial<LessonWindow> = {}): LessonWindow {
  return {
    status: "confirmed",
    mode: "online",
    effective_start: new Date(T0).toISOString(),
    ends_at: new Date(T0 + min(60)).toISOString(),
    duration_minutes: 60,
    ...over,
  };
}

describe("roomIsOpen — mirrors room_access's window", () => {
  it("opens 15 minutes before the start and closes 30 minutes after the end", () => {
    const l = lesson();
    expect(roomIsOpen(l, T0 - min(16))).toBe(false);
    expect(roomIsOpen(l, T0 - min(15))).toBe(true);
    expect(roomIsOpen(l, T0 + min(30))).toBe(true);
    expect(roomIsOpen(l, T0 + min(90))).toBe(true);
    expect(roomIsOpen(l, T0 + min(91))).toBe(false);
  });

  it("falls back to effective_start + duration_minutes when ends_at is null", () => {
    const l = lesson({ ends_at: null, duration_minutes: 45 });
    expect(lessonEndISO(l)).toBe(new Date(T0 + min(45)).toISOString());
    expect(roomIsOpen(l, T0 + min(75))).toBe(true);
    expect(roomIsOpen(l, T0 + min(76))).toBe(false);
  });

  it("assumes an hour when neither ends_at nor a duration is known", () => {
    expect(lessonEndISO(lesson({ ends_at: null, duration_minutes: null }))).toBe(new Date(T0 + min(60)).toISOString());
  });

  it("is only open for confirmed or completed online sessions", () => {
    expect(roomIsOpen(lesson({ status: "completed" }), T0 + min(10))).toBe(true);
    expect(roomIsOpen(lesson({ status: "pending" }), T0 + min(10))).toBe(false);
    expect(roomIsOpen(lesson({ status: "cancelled" }), T0 + min(10))).toBe(false);
    expect(roomIsOpen(lesson({ status: "declined" }), T0 + min(10))).toBe(false);
    expect(roomIsOpen(lesson({ mode: "in_person" }), T0 + min(10))).toBe(false);
  });
});

describe("lessonIsLive", () => {
  it("is true inside the booked slot only", () => {
    const l = lesson();
    expect(lessonIsLive(l, T0 - min(1))).toBe(false);
    expect(lessonIsLive(l, T0)).toBe(true);
    expect(lessonIsLive(l, T0 + min(60))).toBe(true);
    expect(lessonIsLive(l, T0 + min(61))).toBe(false);
    expect(lessonIsLive(lesson({ status: "cancelled" }), T0 + min(10))).toBe(false);
  });
});
