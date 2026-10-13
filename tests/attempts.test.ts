import { describe, expect, it } from "vitest";
import {
  INTEGRITY_EVENT_KIND,
  attemptPath,
  canOpen,
  eventSeverity,
  formatClock,
  practiceState,
  practiceStateLabel,
  remainingMs,
  responsePayload,
  reviewHeadline,
  snapshotPath,
  timelineSeverity,
  toMarkResult,
  toQuestion,
  toResponse,
  verdictToMark,
  type AttemptQuestionRow,
  type PracticeRow,
} from "@/lib/practice/attempts";
import { SEVERITY, type IntegrityEventType } from "@/lib/integrity/engine";

const base: PracticeRow = {
  assignment_id: "a",
  set_id: "s",
  set_title: "Set",
  kind: "practice",
  course_id: "c",
  course_name: "Course",
  student_id: "st",
  student_name: "Student",
  mode: "at_home",
  due_at: null,
  assigned_at: "2026-10-01T00:00:00Z",
  attempt_id: null,
  attempt_status: null,
  score: null,
  out_of: null,
  integrity_flagged: false,
  submitted_at: null,
  question_count: 5,
};

describe("practiceState — the chip a my_practice row gets", () => {
  it("reads not started / in progress / submitted with the mark / flagged / voided", () => {
    expect(practiceStateLabel(base)).toBe("Not started");
    expect(practiceStateLabel({ ...base, attempt_id: "t", attempt_status: "in_progress" })).toBe("In progress");
    expect(practiceStateLabel({ ...base, attempt_id: "t", attempt_status: "marked", score: 7, out_of: 10 })).toBe("Submitted · 7/10");
    expect(practiceStateLabel({ ...base, attempt_id: "t", attempt_status: "submitted", score: 2.5, out_of: 6 })).toBe("Submitted · 2.5/6");
    expect(practiceStateLabel({ ...base, attempt_id: "t", attempt_status: "marked", score: 3, out_of: 6, integrity_flagged: true })).toBe("Flagged · 3/6");
    expect(practiceStateLabel({ ...base, attempt_id: "t", attempt_status: "void", score: 3, out_of: 6 })).toBe("Voided");
  });

  it("lets a student open only what is not finished, and sends a test to its own page", () => {
    expect(canOpen(base)).toBe(true);
    expect(canOpen({ ...base, attempt_id: "t", attempt_status: "in_progress" })).toBe(true);
    expect(canOpen({ ...base, attempt_id: "t", attempt_status: "marked" })).toBe(false);
    expect(canOpen({ ...base, attempt_id: "t", attempt_status: "void" })).toBe(false);
    expect(practiceState({ ...base, attempt_id: "t", attempt_status: "in_progress", integrity_flagged: true })).toBe("in_progress");
    expect(attemptPath("test", "t1")).toBe("/test/t1");
    expect(attemptPath("quick_check", "t1")).toBe("/home/practice/t1");
  });
});

const row = (over: Partial<AttemptQuestionRow>): AttemptQuestionRow => ({
  id: "q",
  type: "mcq",
  stem: "Pick",
  image_path: null,
  options: [
    { key: "A", text: "a" },
    { key: "B", text: "b" },
  ],
  difficulty: 2,
  marks: 1,
  topic_id: null,
  topic_label: null,
  sort_order: 0,
  response: null,
  is_correct: null,
  marks_awarded: null,
  feedback: null,
  answer: null,
  worked_solution: null,
  unit: null,
  ...over,
});

describe("toQuestion / toResponse / toMarkResult — attempt_questions rows into the cards' model", () => {
  it("builds each type, with the masked answer left empty while in progress", () => {
    const mcq = toQuestion(row({}));
    expect(mcq.type === "mcq" && mcq.answer).toBe("");
    const num = toQuestion(row({ type: "numeric", answer: 3, unit: "cm" }));
    expect(num.type === "numeric" && num.answer).toBe(3);
    expect(num.type === "numeric" && num.unit).toBe("cm");
    const short = toQuestion(row({ type: "short", answer: "(x-2)(x-3)" }));
    expect(short.type === "short" && short.answers).toEqual(["(x-2)(x-3)"]);
    const multi = toQuestion(row({ type: "multi_select", answer: ["A", "C"] }));
    expect(multi.type === "multi_select" && multi.answers).toEqual(["A", "C"]);
    expect(toQuestion(row({ difficulty: 9 })).difficulty).toBe(5);
    expect(toQuestion(row({ image_path: "c/x.png" }), "https://signed").image_url).toBe("https://signed");
  });

  it("reads the saved response back for every type", () => {
    expect(toResponse(row({ response: { type: "mcq", key: "B" } }))).toEqual({ type: "mcq", key: "B" });
    expect(toResponse(row({ type: "numeric", response: { type: "numeric", value: 2.5 } }))).toEqual({ type: "numeric", text: "2.5" });
    expect(toResponse(row({ type: "multi_select", response: { keys: ["A"] } }))).toEqual({ type: "multi_select", keys: ["A"] });
    expect(toResponse(row({ type: "worked", response: { final_answer: "x=1", evidence: [] } }))).toEqual({ type: "worked", final_answer: "x=1", evidence: [] });
    expect(toResponse(row({ response: null }))).toBeNull();
  });

  it("marks correct, incorrect, partial and pending review, and nothing when unanswered", () => {
    expect(toMarkResult(row({ response: { key: "A" }, is_correct: true, marks_awarded: 1 }))?.status).toBe("correct");
    expect(toMarkResult(row({ response: { key: "B" }, is_correct: false, marks_awarded: 0 }))?.status).toBe("incorrect");
    expect(toMarkResult(row({ type: "multi_select", marks: 2, response: { keys: ["A"] }, is_correct: false, marks_awarded: 1 }))?.status).toBe("partial");
    expect(toMarkResult(row({ type: "worked", marks: 4, response: { final_answer: "2" } }))?.status).toBe("pending_review");
    expect(toMarkResult(row({ response: { key: "A" } }))).toBeNull();
    expect(toMarkResult(row({}))).toBeNull();
  });

  it("turns answer_question's verdict into a mark without ever needing the answer", () => {
    expect(verdictToMark({ is_correct: true, marks_awarded: 2, status: "correct" }, 2)).toMatchObject({ status: "correct", score: 2, max: 2 });
    expect(verdictToMark({ is_correct: false, marks_awarded: 0, status: "incorrect" }, 2)).toMatchObject({ status: "incorrect", score: 0 });
    expect(verdictToMark({ is_correct: false, marks_awarded: 1, status: "incorrect" }, 2)).toMatchObject({ status: "partial", score: 1 });
    expect(verdictToMark({ is_correct: null, marks_awarded: null, status: "pending_review" }, 4)).toMatchObject({ status: "pending_review", score: 0, max: 4 });
  });

  it("sends a numeric answer with its parsed value beside the text", () => {
    expect(responsePayload({ type: "numeric", text: "3/4" })).toEqual({ type: "numeric", text: "3/4", value: 0.75 });
    expect(responsePayload({ type: "numeric", text: "abc" })).toEqual({ type: "numeric", text: "abc", value: null });
    expect(responsePayload({ type: "mcq", key: "A" })).toEqual({ type: "mcq", key: "A" });
  });
});

describe("integrity: engine events as log_integrity_event spells them", () => {
  it("maps every engine type onto a kind the RPC accepts", () => {
    const accepted = ["fullscreen_exit", "visibility_hidden", "window_blur", "resize", "paste", "copy", "context_menu", "devtools", "offline", "camera_off", "snapshot", "resume", "warned", "paused"];
    for (const t of Object.keys(SEVERITY) as IntegrityEventType[]) expect(accepted).toContain(INTEGRITY_EVENT_KIND[t]);
    expect(INTEGRITY_EVENT_KIND.devtools_shortcut).toBe("devtools");
    expect(INTEGRITY_EVENT_KIND.camera_denied).toBe("camera_off");
  });

  it("weights a logged kind like the engine does and counts bookkeeping rows as nothing", () => {
    expect(eventSeverity("paste")).toBe(3);
    expect(eventSeverity("devtools")).toBe(3);
    expect(eventSeverity("snapshot")).toBe(0);
    expect(eventSeverity("paused")).toBe(0);
    expect(eventSeverity("resume")).toBe(0);
    expect(timelineSeverity([{ kind: "visibility_hidden" }, { kind: "visibility_hidden" }, { kind: "paste" }, { kind: "snapshot" }])).toBe(7);
  });

  it("headlines the review from the stored summary, else from the scored events", () => {
    const attempt = { id: "t", assignment_id: null, set_id: "s", student_id: "st", session_id: null, started_at: "2026-10-01T00:00:00Z", submitted_at: null, time_limit_minutes: null, score: null, out_of: null, integrity_flagged: true, integrity_summary: { headline: "stored" }, status: "marked" as const };
    expect(reviewHeadline({ attempt, events: [] })).toBe("stored");
    const events = [
      { at: "", kind: "paste", detail: null, snapshot_path: null },
      { at: "", kind: "visibility_hidden", detail: null, snapshot_path: null },
      { at: "", kind: "visibility_hidden", detail: null, snapshot_path: null },
      { at: "", kind: "snapshot", detail: null, snapshot_path: "p" },
    ];
    expect(reviewHeadline({ attempt: { ...attempt, integrity_summary: null }, events })).toBe("3 events: left the tab ×2, pasted ×1");
    expect(reviewHeadline({ attempt: { ...attempt, integrity_summary: null }, events: [] })).toBe("No integrity events");
  });

  it("counts the limit from started_at and gives every pause back", () => {
    const started = "2026-10-01T10:00:00Z";
    const now = Date.parse("2026-10-01T10:05:00Z");
    expect(remainingMs({ startedAtISO: started, timeLimitMinutes: 20, pausedMs: 0, nowMs: now })).toBe(15 * 60_000);
    expect(remainingMs({ startedAtISO: started, timeLimitMinutes: 20, pausedMs: 60_000, nowMs: now })).toBe(16 * 60_000);
    expect(remainingMs({ startedAtISO: started, timeLimitMinutes: 2, pausedMs: 0, nowMs: now })).toBe(0);
    expect(remainingMs({ startedAtISO: started, timeLimitMinutes: null, pausedMs: 0, nowMs: now })).toBeNull();
    expect(formatClock(15 * 60_000 + 7_000)).toBe("15:07");
    expect(snapshotPath("u", "t", 1700000000000)).toBe("u/t/1700000000000.jpg");
  });
});
