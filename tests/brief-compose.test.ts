import { describe, expect, it } from "vitest";
import { composeBrief } from "@/lib/brief/compose";
import { parsePremark } from "@/lib/practice/premark-parse";

const NOW = "2026-10-13T08:00:00.000Z";

describe("composeBrief", () => {
  it("builds a brief from a full picture and suggests a focus", () => {
    const b = composeBrief({
      nowISO: NOW,
      student: { first_name: "Aarav", grade: "Year 10" },
      course: "IGCSE Maths",
      session: { starts_at: NOW, topic: "Completing the square" },
      last_report: { at: "2026-10-06T08:00:00.000Z", topic: "Quadratics", topic_completed: false, topics_not_done: "vertex form", understanding: 5, homework: "Ex 4B 1-8", remarks: "Good effort." },
      coaching_moments: [{ kind: "improvement", comment: "give three seconds after a question" }, { kind: "strength", comment: "warm praise" }],
      notes: [{ kind: "standing", body: "Prefers to be called Aarav, not Aaravind", author: "Priya" }],
      homework: [{ description: "Ex 4B 1-8", status: "assigned", due_at: "2026-10-10T00:00:00.000Z" }],
      practice: [{ topic_label: "Quadratics", accuracy: 0.4, items: 10, last_at: "2026-10-11T00:00:00.000Z" }],
      followups: [{ title: "Exam next Friday", kind: "exam_upcoming", priority: "high", action: "staff_task" }],
      syllabus: { coverage: 0.3, weak_areas: [{ label: "Quadratics", status: "needs_work", accuracy: 0.4 }], recommended_next: [{ label: "Surds" }] },
      integrity_flags: 1,
    });
    expect(b.headline).toBe("Aarav (Year 10) — last lesson 7 days ago on Quadratics.");
    expect(b.sections.map((s) => s.title)).toEqual(["Today", "Last time", "Homework", "Practice and weak spots", "For you, from last lesson", "From the office", "Heads up"]);
    expect(b.sections[0]!.items).toEqual(["Booked topic: Completing the square", "Syllabus suggests next: Surds"]);
    expect(b.sections[1]!.items[0]).toBe("7 days ago: Quadratics (not finished: vertex form).");
    expect(b.sections[2]!.items[0]).toMatch(/Not yet done: Ex 4B 1-8 \(due overdue\)/);
    expect(b.sections[5]!.items).toEqual(["Standing note: Prefers to be called Aarav, not Aaravind (Priya)", "⚠ Exam next Friday"]);
    expect(b.suggested_focus).toEqual(["Finish Quadratics — vertex form.", "Re-check Quadratics; understanding was only 5/10.", "Ask about the overdue homework (Ex 4B 1-8)."]);
  });
  it("omits empty sections and still gives a focus for a first lesson", () => {
    const b = composeBrief({ nowISO: NOW, student: { first_name: "Sofia" }, course: "SAT", session: { starts_at: NOW } });
    expect(b.headline).toBe("Sofia — first lesson on the platform.");
    expect(b.sections).toEqual([]);
    expect(b.suggested_focus).toHaveLength(1);
  });
});

describe("parsePremark", () => {
  it("clamps the score to the marks available and to the awarded steps", () => {
    const r = parsePremark(
      { steps: [{ description: "M1", awarded: true, evidence: "divided by 2" }, { description: "A1", awarded: false, evidence: "wrong root" }], score: 4, final_answer_seen: "x=1/2", final_answer_correct: false, confidence: 0.8, feedback_for_student: "ok", note_for_teacher: "" },
      2,
    );
    expect(r.errors).toEqual([]);
    expect(r.result).toMatchObject({ score: 1, max: 2, confidence: 0.8, final_answer_seen: "x=1/2" });
  });
  it("reports schema errors", () => {
    expect(parsePremark({ steps: "no" }, 3).errors.length).toBeGreaterThan(0);
  });
});
