import { beforeEach, describe, expect, it } from "vitest";
import { DEMO_IDS, demoProfiles } from "@/lib/demo/data";
import {
  DEMO_PRACTICE_IDS,
  demoAnswerQuestion,
  demoAssignPractice,
  demoAttempt,
  demoAttemptQuestions,
  demoCreatePracticeSet,
  demoFlaggedAttemptReview,
  demoLiveAttempts,
  demoLogIntegrityEvent,
  demoMyPractice,
  demoStartAttempt,
  demoSubmitAttempt,
  demoUpsertQuestion,
  demoVoidAttempt,
  resetDemoPractice,
} from "@/lib/demo/attempts";
import { practiceState } from "@/lib/practice/attempts";

const by = (id: string) => demoProfiles.find((p) => p.id === id)!;
const sofia = by(DEMO_IDS.sofia);
const aarav = by(DEMO_IDS.aarav);
const marco = by(DEMO_IDS.marco);
const priya = by(DEMO_IDS.priya);
const maya = by(DEMO_IDS.maya);
const daniel = by(DEMO_IDS.daniel);
const grace = by(DEMO_IDS.grace);
const admin = by(DEMO_IDS.admin);
const LIVE = "20000000-0000-0000-0000-000000000002"; // Maya + Sofia, live now

beforeEach(() => resetDemoPractice());

describe("my_practice (demo) — who sees which rows", () => {
  it("gives a student their own rows with the chips the task names", () => {
    const rows = demoMyPractice(sofia);
    expect(rows.every((r) => r.student_id === DEMO_IDS.sofia)).toBe(true);
    expect(rows.map((r) => practiceState(r)).sort()).toEqual(["not_started", "not_started", "submitted"]);
    const aaravRows = demoMyPractice(aarav);
    expect(aaravRows.map((r) => practiceState(r)).sort()).toEqual(["flagged", "in_progress", "submitted"]);
    expect(aaravRows.find((r) => r.kind === "quick_check")?.mode).toBe("in_session");
  });

  it("gives a parent the household's rows and nothing of another family", () => {
    expect(demoMyPractice(marco).every((r) => r.student_id === DEMO_IDS.sofia)).toBe(true);
    expect(demoMyPractice(priya).every((r) => r.student_id === DEMO_IDS.aarav)).toBe(true);
    expect(demoMyPractice(priya).length).toBeGreaterThan(0);
  });

  it("gives a teacher what they assigned, an in-charge their room, an admin everything", () => {
    expect(demoMyPractice(maya).length).toBe(6);
    expect(demoMyPractice(daniel)).toEqual([]);
    expect(demoMyPractice(grace).every((r) => r.course_name !== "A-Level Physics")).toBe(true);
    expect(demoMyPractice(grace).length).toBe(6);
    expect(demoMyPractice(admin).length).toBe(6);
  });
});

describe("an attempt end to end (demo): start → answer → submit → results", () => {
  it("masks the answers while in progress, marks each answer, and reveals the solutions after submitting", () => {
    const attemptId = demoStartAttempt(sofia, DEMO_PRACTICE_IDS.sofiaPracticeAssignment);
    expect(demoStartAttempt(sofia, DEMO_PRACTICE_IDS.sofiaPracticeAssignment)).toBe(attemptId); // idempotent

    const before = demoAttemptQuestions(sofia, attemptId);
    expect(before.length).toBe(5);
    expect(before.every((q) => q.answer === null && q.worked_solution === null)).toBe(true);

    const q1 = before[0]!;
    expect(demoAnswerQuestion(sofia, attemptId, q1.id, { type: "mcq", key: "A" })).toEqual({ is_correct: true, marks_awarded: 1, status: "correct" });
    const q2 = before[1]!;
    expect(demoAnswerQuestion(sofia, attemptId, q2.id, { type: "numeric", text: "1", value: 1 }).status).toBe("incorrect");
    // Changing the answer re-marks it.
    expect(demoAnswerQuestion(sofia, attemptId, q2.id, { type: "numeric", text: "-1", value: -1 }).status).toBe("correct");

    const result = demoSubmitAttempt(sofia, attemptId, null);
    expect(result).toEqual({ score: 2, out_of: 5, status: "marked" });

    const after = demoAttemptQuestions(sofia, attemptId);
    expect(after[0]!.answer).toBe("A");
    expect(after[0]!.worked_solution).toContain("shift");
    expect(after[0]!.is_correct).toBe(true);
    expect(demoMyPractice(sofia).find((r) => r.attempt_id === attemptId)?.score).toBe(2);
    expect(() => demoAnswerQuestion(sofia, attemptId, q1.id, { type: "mcq", key: "B" })).toThrow(/already been submitted/);
  });

  it("keeps a worked question waiting for the teacher", () => {
    const attemptId = demoStartAttempt(sofia, DEMO_PRACTICE_IDS.sofiaTestAssignment);
    const rows = demoAttemptQuestions(sofia, attemptId);
    const worked = rows.find((r) => r.type === "worked")!;
    expect(demoAnswerQuestion(sofia, attemptId, worked.id, { type: "worked", final_answer: "x=4, y=0", evidence: [] }).status).toBe("pending_review");
    demoLogIntegrityEvent(sofia, attemptId, "paste", null, null);
    const result = demoSubmitAttempt(sofia, attemptId, { flagged: true, severity: 3, event_count: 1, headline: "1 event: pasted ×1" });
    expect(result.status).toBe("submitted");
    expect(demoAttempt(attemptId)?.integrity_flagged).toBe(true);
    expect(demoFlaggedAttemptReview(maya, attemptId).events.map((e) => e.kind)).toEqual(["paste"]);
  });
});

describe("the rules the policies apply (demo)", () => {
  it("lets only the assignment's student start it", () => {
    expect(() => demoStartAttempt(aarav, DEMO_PRACTICE_IDS.sofiaPracticeAssignment)).toThrow(/Only the student/);
    expect(() => demoStartAttempt(marco, DEMO_PRACTICE_IDS.sofiaPracticeAssignment)).toThrow(/Only the student/);
    expect(() => demoStartAttempt(maya, DEMO_PRACTICE_IDS.sofiaPracticeAssignment)).toThrow(/Only the student/);
  });

  it("never shows a parent the questions or answers, and never shows a student another student's attempt", () => {
    expect(() => demoAttemptQuestions(marco, DEMO_PRACTICE_IDS.sofiaSubmittedAttempt)).toThrow(/not yours/);
    expect(() => demoAttemptQuestions(aarav, DEMO_PRACTICE_IDS.sofiaSubmittedAttempt)).toThrow(/not yours/);
    expect(() => demoAttemptQuestions(sofia, DEMO_PRACTICE_IDS.aaravFlaggedAttempt)).toThrow(/not yours/);
    expect(() => demoAnswerQuestion(aarav, DEMO_PRACTICE_IDS.sofiaSubmittedAttempt, "x", {})).toThrow(/Only the student/);
  });

  it("opens the review to the assigner, the in-charge of the room and an admin — never a parent, a student or another teacher", () => {
    const id = DEMO_PRACTICE_IDS.aaravFlaggedAttempt;
    expect(demoFlaggedAttemptReview(maya, id).events.length).toBe(12);
    expect(demoFlaggedAttemptReview(grace, id).attempt.integrity_flagged).toBe(true);
    expect(demoFlaggedAttemptReview(admin, id).answers.length).toBe(6);
    expect(() => demoFlaggedAttemptReview(priya, id)).toThrow(/not yours to review/);
    expect(() => demoFlaggedAttemptReview(aarav, id)).toThrow(/not yours to review/);
    expect(() => demoFlaggedAttemptReview(daniel, id)).toThrow(/not yours to review/);
  });

  it("voids only for the same people, and a voided row reads as voided", () => {
    const id = DEMO_PRACTICE_IDS.aaravFlaggedAttempt;
    expect(() => demoVoidAttempt(aarav, id)).toThrow(/may not void/);
    expect(() => demoVoidAttempt(priya, id)).toThrow(/may not void/);
    demoVoidAttempt(maya, id);
    expect(demoMyPractice(aarav).find((r) => r.attempt_id === id)?.attempt_status).toBe("void");
  });

  it("logs integrity events only for the student while in progress", () => {
    expect(() => demoLogIntegrityEvent(sofia, DEMO_PRACTICE_IDS.sofiaSubmittedAttempt, "paste", null, null)).toThrow(/no longer in progress/);
    expect(() => demoLogIntegrityEvent(maya, DEMO_PRACTICE_IDS.aaravInProgressAttempt, "paste", null, null)).toThrow(/Only the student/);
  });

  it("shows live attempts to the host and an observer, not to the student or a parent", () => {
    const session = DEMO_PRACTICE_IDS.quickCheckSession; // this morning's completed lesson: the office still observes it
    expect(demoLiveAttempts(admin, session).length).toBe(1);
    expect(demoLiveAttempts(grace, session)[0]?.score).toBe(4);
    expect(() => demoLiveAttempts(aarav, session)).toThrow(/host or an observer/);
    expect(() => demoLiveAttempts(priya, session)).toThrow(/host or an observer/);
  });
});

describe("the activity panel's writes (demo): a quick check in the live lesson", () => {
  it("lets the host create a quick check set and assign it to the session's student, and nobody else", () => {
    const sat = "10000000-0000-0000-0000-000000000002";
    const draftId = demoUpsertQuestion(maya, sat, { type: "numeric", stem: "What is $2+2$?", answer: 4, marks: 1 });
    const setId = demoCreatePracticeSet(maya, { course_id: sat, kind: "quick_check", title: "Quick check", question_ids: [draftId, "50000000-0000-0000-0000-000000000001"], session_id: LIVE });
    expect(demoAssignPractice(maya, { set_id: setId, student_ids: [DEMO_IDS.sofia], mode: "in_session", session_id: LIVE })).toBe(1);
    expect(demoAssignPractice(maya, { set_id: setId, student_ids: [DEMO_IDS.sofia], mode: "in_session", session_id: LIVE })).toBe(0); // already open
    expect(demoLiveAttempts(maya, LIVE)).toEqual([]);

    const row = demoMyPractice(sofia).find((r) => r.set_id === setId)!;
    expect(row.mode).toBe("in_session");
    const attemptId = demoStartAttempt(sofia, row.assignment_id);
    expect(demoLiveAttempts(maya, LIVE)[0]?.attempt_id).toBe(attemptId);

    // Another teacher is not the host; a student is not a host; the host may not assign to somebody else.
    expect(() => demoCreatePracticeSet(daniel, { course_id: sat, kind: "quick_check", title: "x", question_ids: ["50000000-0000-0000-0000-000000000001"], session_id: LIVE })).toThrow(/may not create/);
    expect(() => demoUpsertQuestion(sofia, sat, { type: "numeric", stem: "?", answer: 1 })).toThrow(/may not add/);
    expect(() => demoAssignPractice(maya, { set_id: setId, student_ids: [DEMO_IDS.aarav], mode: "in_session", session_id: LIVE })).toThrow(/may not assign/);
    expect(() => demoAssignPractice(maya, { set_id: setId, student_ids: [DEMO_IDS.sofia], mode: "at_home" })).toThrow(/may not assign/);
  });

  it("refuses another teacher's draft in a quick check", () => {
    const sat = "10000000-0000-0000-0000-000000000002";
    const draftId = demoUpsertQuestion(admin, sat, { type: "numeric", stem: "?", answer: 1 });
    expect(() => demoCreatePracticeSet(maya, { course_id: sat, kind: "quick_check", title: "x", question_ids: [draftId], session_id: LIVE })).toThrow(/approved questions/);
  });
});
