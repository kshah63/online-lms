import { describe, expect, it } from "vitest";
import { embedEventShowsStudent, isEndedStatus } from "@/components/lesson/room-logic";

// The lesson room's pure rules. Ended statuses decide when the status poll
// unmounts the Space (End no longer hangs up Pencil's call, so unmounting is
// what makes a viewer leave). Presence decides when the lesson clock starts —
// on the student, never on the teacher alone (plan decision e).

const STUDENT = "u-student";
const host = { hostView: true, studentPencilUserId: STUDENT };
const hostNoId = { hostView: true, studentPencilUserId: null };
const student = { hostView: false, studentPencilUserId: STUDENT };

describe("isEndedStatus", () => {
  it("completed, no_show and cancelled end the room; nothing else does", () => {
    for (const s of ["completed", "no_show", "cancelled"]) expect(isEndedStatus(s)).toBe(true);
    for (const s of ["scheduled", "confirmed", "in_progress", "", null, undefined, "COMPLETED"]) expect(isEndedStatus(s)).toBe(false);
  });
});

describe("embedEventShowsStudent", () => {
  it("host: participant_join counts only with the student's Pencil id", () => {
    expect(embedEventShowsStudent({ type: "participant_join", detail: { id: STUDENT } }, host)).toBe(true);
    expect(embedEventShowsStudent({ type: "participant_join", detail: { id: "u-teacher-ipad" } }, host)).toBe(false);
    expect(embedEventShowsStudent({ type: "participant_join", detail: {} }, host)).toBe(false);
    expect(embedEventShowsStudent({ type: "participant_join", detail: { id: STUDENT } }, hostNoId)).toBe(false);
  });

  it("host: a count of two still counts even when the student's id is known (a student who arrived first may never send a join)", () => {
    expect(embedEventShowsStudent({ type: "participantupdate", detail: { count: 2 } }, host)).toBe(true);
    expect(embedEventShowsStudent({ type: "participantupdate", detail: { count: "3" } }, hostNoId)).toBe(true);
    expect(embedEventShowsStudent({ type: "participantupdate", detail: { count: 1 } }, host)).toBe(false);
    expect(embedEventShowsStudent({ type: "participantupdate", detail: { count: "x" } }, host)).toBe(false);
    expect(embedEventShowsStudent({ type: "participantupdate", detail: null }, host)).toBe(false);
  });

  it("student: someone else's join counts; the student's own writing iPad does not", () => {
    expect(embedEventShowsStudent({ type: "participant_join", detail: { id: "u-teacher" } }, student)).toBe(true);
    expect(embedEventShowsStudent({ type: "participant_join", detail: { id: STUDENT } }, student)).toBe(false);
    expect(embedEventShowsStudent({ type: "participant_join", detail: null }, student)).toBe(true);
  });

  it("other events never start the clock", () => {
    for (const type of ["user_joined_call", "user_started_call", "ready", "recording_status_change", "participant_leave"]) {
      expect(embedEventShowsStudent({ type, detail: { id: STUDENT, count: 5 } }, host)).toBe(false);
      expect(embedEventShowsStudent({ type, detail: { id: "u-teacher", count: 5 } }, student)).toBe(false);
    }
  });
});
