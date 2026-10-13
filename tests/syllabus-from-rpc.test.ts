import { describe, expect, it } from "vitest";
import { DEMO_IDS, demoCourses, demoProfiles } from "@/lib/demo/data";
import { buildDemoChildProgress, demoMayReadProgress, demoProgressCourses } from "@/lib/demo/progress";
import { progressFromRpc, type ChildProgressRpc } from "@/lib/syllabus/from-rpc";

const NOW = "2026-10-13T00:00:00.000Z";
const d = (daysAgo: number) => new Date(new Date(NOW).getTime() - daysAgo * 86_400_000).toISOString();

/** A child_progress jsonb exactly as CONTRACTS-stage4 §A spells it. */
const fixture: ChildProgressRpc = {
  student: { id: "00000000-0000-0000-0000-0000000000b1", first_name: "Aarav" },
  course: { id: "10000000-0000-0000-0000-000000000001", name: "IGCSE Mathematics" },
  generated_at: NOW,
  topics: [
    {
      id: "t-seq",
      label: "Sequences",
      sort_order: 3,
      sessions: [{ at: d(35), completed: true }],
      practice: [{ at: d(20), correct: 8, total: 10 }],
      tests: [],
      teacher_mark: { status: "secure", at: d(19), note: "Solid on nth term" },
    },
    {
      id: "t-quad",
      label: "Quadratics",
      sort_order: 1,
      sessions: [{ at: d(21), completed: true }],
      practice: [
        { at: d(13), correct: 4, total: 10 },
        { at: d(2), correct: 3, total: 6 },
      ],
      tests: [{ at: d(5), score: 11, out_of: 20 }],
      teacher_mark: null,
    },
    { id: "t-vec", label: "Vectors", sort_order: 2, sessions: [], practice: [], tests: [], teacher_mark: null },
  ],
  weekly_practice: [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({ week_start: `2026-08-${String(24 + i).padStart(2, "0")}`, items: i * 2 })),
  accuracy: { current: { correct: 30, total: 40 }, previous: { correct: 20, total: 40 } },
  attendance: { attended: 7, booked: 8, weeks: 8 },
  tests: [{ attempt_id: "a1", name: "Quadratics topic test", at: d(5), score: 11, out_of: 20, topic_label: "Quadratics", flagged: false }],
  reports: [{ id: "r1", at: d(1), topic: "Completing the square", understanding: 8, homework: "Exercise 4B" }],
};

describe("progressFromRpc — child_progress's signals become the dashboard's view", () => {
  it("derives each topic's status with the shared model and orders topics by sort_order", () => {
    const { view } = progressFromRpc(fixture);
    expect(view.topics.map((t) => t.label)).toEqual(["Quadratics", "Vectors", "Sequences"]);
    const byLabel = Object.fromEntries(view.topics.map((t) => [t.label, t.progress]));
    expect(byLabel.Quadratics!.status).toBe("needs_work");
    expect(byLabel.Sequences!.status).toBe("secure");
    expect(byLabel.Sequences!.reasons[0]).toContain("Solid on nth term");
    expect(byLabel.Vectors!.status).toBe("not_started");
    expect(view.summary.total).toBe(3);
    expect(view.summary.counts.needs_work).toBe(1);
    expect(view.summary.weak_areas.map((t) => t.topic_id)).toEqual(["t-quad"]);
  });

  it("keeps the database's weekly buckets, turns accuracy counts into fractions and copies attendance", () => {
    const { view } = progressFromRpc(fixture);
    expect(view.weekly).toHaveLength(8);
    expect(view.weekly[7]).toEqual({ week_start: "2026-08-31", items: 14 });
    expect(view.accuracy).toEqual({ current: 0.75, previous: 0.5, items: 40 });
    expect(view.attendance).toEqual({ attended: 7, booked: 8, weeks: 8 });
    expect(view.generated_at).toBe(NOW);
  });

  it("maps recent tests and reports, dropping what the dashboard does not show", () => {
    const { view, reports } = progressFromRpc(fixture);
    expect(view.tests).toEqual([{ name: "Quadratics topic test", at: d(5), score: 11, out_of: 20, topic_label: "Quadratics", flagged: false }]);
    expect(reports).toEqual([{ id: "r1", at: d(1), topic: "Completing the square", understanding: 8, homework: "Exercise 4B" }]);
  });

  it("reads numerics that arrive as strings and treats a missing list as empty", () => {
    const loose = JSON.parse(JSON.stringify(fixture)) as Record<string, unknown>;
    (loose.tests as Record<string, unknown>[])[0]!.score = "11.5";
    delete loose.weekly_practice;
    (loose.topics as Record<string, unknown>[])[0]!.teacher_mark = { status: "mastered", at: d(1), note: null };
    const { view } = progressFromRpc(loose);
    expect(view.tests[0]!.score).toBe(11.5);
    expect(view.weekly).toHaveLength(8);
    expect(view.weekly.reduce((a, w) => a + w.items, 0)).toBe(26);
    // An unknown mark status is not a mark: the evidence decides instead.
    const seq = view.topics.find((t) => t.id === "t-seq")!.progress;
    expect(seq.status).toBe("covered");
    expect(seq.reasons[0]).not.toMatch(/Teacher marked/);
  });

  it("gives an empty view for nothing at all, never a crash", () => {
    const { view, reports } = progressFromRpc(null);
    expect(view.topics).toEqual([]);
    expect(view.summary.total).toBe(0);
    expect(view.accuracy.current).toBeNull();
    expect(reports).toEqual([]);
  });
});

describe("the demo answers child_progress in the contract's shape", () => {
  const [IGCSE, , PHYS] = demoCourses;
  const aarav = demoProfiles.find((p) => p.id === DEMO_IDS.aarav)!;
  const priya = demoProfiles.find((p) => p.id === DEMO_IDS.priya)!;
  const marco = demoProfiles.find((p) => p.id === DEMO_IDS.marco)!;
  const grace = demoProfiles.find((p) => p.id === DEMO_IDS.grace)!;
  const maya = demoProfiles.find((p) => p.id === DEMO_IDS.maya)!;
  const daniel = demoProfiles.find((p) => p.id === DEMO_IDS.daniel)!;

  it("runs through the same mapper as the live path", () => {
    const { view, reports } = progressFromRpc(buildDemoChildProgress(DEMO_IDS.aarav, IGCSE!.id, NOW));
    expect(view.student.first_name).toBe("Aarav");
    expect(view.course.name).toBe("IGCSE Mathematics");
    expect(view.topics).toHaveLength(10);
    expect(view.topics.find((t) => t.label === "Sequences")!.progress.status).toBe("secure");
    expect(view.weekly).toHaveLength(8);
    expect(reports.map((r) => r.topic)).toEqual(["Completing the square"]);
  });

  it("lists a course per online booking, so a student on two courses gets a picker", () => {
    expect(demoProgressCourses(DEMO_IDS.aarav).map((c) => c.name)).toEqual(["IGCSE Mathematics", "A-Level Physics"]);
    expect(demoProgressCourses(DEMO_IDS.sofia).map((c) => c.name)).toEqual(["SAT Math Prep"]);
  });

  it("mirrors child_progress's gate", () => {
    expect(demoMayReadProgress(aarav, DEMO_IDS.aarav, IGCSE!.id)).toBe(true);
    expect(demoMayReadProgress(priya, DEMO_IDS.aarav, IGCSE!.id)).toBe(true);
    expect(demoMayReadProgress(marco, DEMO_IDS.aarav, IGCSE!.id)).toBe(false);
    expect(demoMayReadProgress(grace, DEMO_IDS.aarav, IGCSE!.id)).toBe(true);
    expect(demoMayReadProgress(grace, DEMO_IDS.lena, PHYS!.id)).toBe(false);
    expect(demoMayReadProgress(daniel, DEMO_IDS.lena, PHYS!.id)).toBe(true);
    expect(demoMayReadProgress(maya, DEMO_IDS.lena, PHYS!.id)).toBe(false);
  });
});
