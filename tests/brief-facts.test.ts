import { describe, expect, it } from "vitest";
import { composeBrief } from "@/lib/brief/compose";
import { normaliseBriefFacts, type LessonBriefFacts } from "@/lib/brief/facts";
import { briefInputFrom } from "@/lib/brief/input";
import { buildDemoLessonBriefFacts, demoReadsLesson } from "@/lib/demo/brief";
import { DEMO_IDS, buildDemoLessonRoomState, buildDemoOnlineLessons, demoProfiles } from "@/lib/demo/data";

const NOW = "2026-10-13T09:00:00.000Z";
const d = (daysAgo: number) => new Date(new Date(NOW).getTime() - daysAgo * 86_400_000).toISOString();

const maya = demoProfiles.find((p) => p.id === DEMO_IDS.maya)!;
const daniel = demoProfiles.find((p) => p.id === DEMO_IDS.daniel)!;
const grace = demoProfiles.find((p) => p.id === DEMO_IDS.grace)!;
const ravi = demoProfiles.find((p) => p.id === DEMO_IDS.ravi)!;
const LIVE = "20000000-0000-0000-0000-000000000002"; // Maya + Sofia, live now
const TRIG = "20000000-0000-0000-0000-000000000005"; // Daniel + Aarav, IGCSE, earlier today

/** lesson_brief_facts as the contract spells it, numbers and all. */
const rpc: Record<string, unknown> = {
  last_reports: [
    { id: "r2", at: d(7), topic: "Linear systems", topic_completed: false, topics_not_done: "systems with no solution", understanding: 6, homework: "Practice set 3", remarks: "Good pace.", prev_hw: "Yes", teacher_name: "Maya Chen" },
    { id: "r1", at: d(21), topic: "Linear equations and inequalities", topic_completed: true, topics_not_done: null, understanding: 8, homework: null, remarks: null, prev_hw: "Yes", teacher_name: "Daniel Okafor" },
  ],
  last_draft: { session_id: "s0", created_at: d(1), draft: { topic: "Ratios", understanding: 7 } },
  moments: [{ kind: "improvement", comment: "Wait longer." }, { kind: "praise", comment: "not a kind" }],
  open_practice: [
    { assignment_id: "a1", set_title: "Practice set 3", kind: "practice", due_at: d(-1), attempt_status: "marked", score: "8", out_of: 10 },
    { assignment_id: "a2", set_title: "Warm-up", kind: "practice", due_at: d(1), attempt_status: null, score: null, out_of: null },
    { assignment_id: "a3", set_title: "Voided", kind: "test", due_at: null, attempt_status: "void", score: null, out_of: null },
  ],
  teacher_marks: [
    { topic_id: "t1", label: "Linear systems", status: "in_progress", at: d(6) },
    { topic_id: "t2", label: "Ratios and percentages", status: "needs_work", at: d(14) },
    { topic_id: "t3", label: "Nope", status: "mastered", at: d(1) },
  ],
  homework_last: "Practice set 3",
};

describe("normaliseBriefFacts — the RPC's jsonb, every list present and typed", () => {
  it("keeps what is well-formed and drops what is not", () => {
    const f = normaliseBriefFacts(rpc);
    expect(f.last_reports.map((r) => r.teacher_name)).toEqual(["Maya Chen", "Daniel Okafor"]);
    expect(f.last_draft?.session_id).toBe("s0");
    expect(f.moments).toEqual([{ kind: "improvement", comment: "Wait longer." }]);
    expect(f.open_practice.map((p) => p.score)).toEqual([8, null, null]);
    expect(f.teacher_marks.map((m) => m.label)).toEqual(["Linear systems", "Ratios and percentages"]);
    expect(f.homework_last).toBe("Practice set 3");
  });

  it("answers nothing with empty lists, never a crash", () => {
    const f = normaliseBriefFacts(null);
    expect(f).toEqual({ last_reports: [], last_draft: null, moments: [], open_practice: [], teacher_marks: [], homework_last: null });
  });
});

describe("briefInputFrom with the facts — the published report wins over the draft; practice and marks reach the composer", () => {
  const lesson = buildDemoOnlineLessons(maya).find((l) => l.session_id === LIVE)!;
  const state = buildDemoLessonRoomState(LIVE, maya);

  it("takes the newest published report, by whoever wrote it, and lists the earlier ones", () => {
    const input = briefInputFrom({ lesson, state, facts: normaliseBriefFacts(rpc), nowISO: NOW });
    expect(input.last_report?.topic).toBe("Linear systems");
    expect(input.last_report?.teacher_name).toBe("Maya Chen");
    expect(input.earlier_reports?.map((r) => r.teacher_name)).toEqual(["Daniel Okafor"]);
    expect(input.coaching_moments).toEqual([{ kind: "improvement", comment: "Wait longer." }]);
    expect(input.homework).toEqual([
      { description: "Practice set 3", status: "completed", due_at: d(-1), marks: "8/10" },
      { description: "Warm-up", status: "assigned", due_at: d(1), marks: null },
    ]);
    expect(input.teacher_marks?.map((m) => m.status)).toEqual(["in_progress", "needs_work"]);

    const brief = composeBrief(input);
    expect(brief.sections.map((s) => s.title)).toEqual(["Today", "Last time", "Homework", "Syllabus marks", "For you, from last lesson"]);
    const lastTime = brief.sections.find((s) => s.title === "Last time")!.items;
    expect(lastTime).toContain("Written by Maya Chen.");
    expect(lastTime.at(-1)).toBe("Earlier, 3 weeks ago: Linear equations and inequalities — understanding 8/10, by Daniel Okafor.");
    expect(brief.sections.find((s) => s.title === "Syllabus marks")!.items).toEqual(["Needs work: Ratios and percentages", "In progress: Linear systems"]);
    expect(brief.suggested_focus[0]).toBe("Finish Linear systems — systems with no solution.");
  });

  it("falls back to the caller's own draft only when no report is published, and says so", () => {
    const facts: LessonBriefFacts = { ...normaliseBriefFacts(rpc), last_reports: [] };
    const input = briefInputFrom({ lesson, state: null, facts, nowISO: NOW });
    expect(input.last_report?.topic).toBe("Ratios");
    expect(input.last_report?.understanding).toBe(7);
    expect(input.last_report?.teacher_name).toBeUndefined();
    expect(input.earlier_reports).toEqual([]);
  });

  it("marks that need work steer the focus when nothing weaker is known", () => {
    const facts: LessonBriefFacts = { ...normaliseBriefFacts(rpc), last_reports: [], last_draft: null, open_practice: [] };
    const brief = composeBrief(briefInputFrom({ lesson, state: null, facts, nowISO: NOW }));
    expect(brief.suggested_focus[0]).toBe("Revisit Ratios and percentages — marked needs work 2 weeks ago.");
  });
});

describe("the demo answers lesson_brief_facts with its gate and its widening", () => {
  it("shows a teacher another teacher's published report on the same student and course", () => {
    const { facts, previousSessionId } = buildDemoLessonBriefFacts(daniel, TRIG, NOW);
    expect(facts.last_reports.map((r) => r.teacher_name)).toEqual(["Maya Chen"]);
    expect(facts.last_reports[0]?.topic).toBe("Completing the square");
    expect(previousSessionId).toBeNull();
    expect(facts.teacher_marks.map((m) => m.label)).toEqual(["Sequences", "Quadratic equations"]);
    expect(facts.open_practice.map((p) => p.set_title)).toEqual(["Quadratic formula worksheet", "Quadratics topic test"]);
  });

  it("hands the host their own previous lesson for the moments and the draft", () => {
    const { facts, previousSessionId } = buildDemoLessonBriefFacts(maya, LIVE, NOW);
    expect(previousSessionId).toBe("20000000-0000-0000-0000-000000000007");
    expect(facts.last_draft).toBeNull(); // that lesson is reported
    expect(facts.last_reports[0]?.topic).toBe("Linear systems");
  });

  it("mirrors reads_lesson: the in-charge of the room and an admin read, support does not", () => {
    expect(demoReadsLesson(grace, LIVE)).toBe(true);
    expect(demoReadsLesson(ravi, LIVE)).toBe(false);
    expect(demoReadsLesson(daniel, LIVE)).toBe(false);
    expect(() => buildDemoLessonBriefFacts(ravi, LIVE, NOW)).toThrow(/in-charge or an admin/);
  });
});
