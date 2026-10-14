import { describe, expect, it } from "vitest";
import { DEMO_IDS, demoProfiles } from "@/lib/demo/data";
import { buildDemoTeacherScorecard, demoMayReadScorecard } from "@/lib/demo/scorecard";
import { onTimeShare, reportsShare, scorecardFromRpc, scorecardWindow, type TeacherScorecardRpc } from "@/lib/coaching/scorecard";

/** A teacher_scorecard jsonb exactly as the contract spells it. */
const fixture: TeacherScorecardRpc = {
  teacher: { id: "00000000-0000-0000-0000-0000000000a1", name: "Maya Chen" },
  window_days: 90,
  lessons: { taught: 24, online: 20, in_person: 4, no_shows: 1 },
  punctuality: { online_with_host_join: 20, median_minutes_late: 0.5, late_over_5_min: 2 },
  coaching: {
    lessons_with_feedback: 6,
    dimension_averages: { rapport: 4.5, engagement: 3.83, clarity: 4.17, questioning: 3.5, pacing: 4 },
    strengths_top: [
      { text: "Specific, earned praise", count: 5 },
      { text: "Open hand-offs", count: 3 },
    ],
    suggestions_top: [{ text: "Wait longer after a question", count: 4 }],
  },
  metrics: { avg_teacher_talk_pct: 0.62, avg_student_talk_pct: 0.38, avg_question_count: 5.83, avg_open_question_pct: 0.47, avg_wait_ms: 2250, avg_praise_count: 2.5 },
  reports: { due: 24, written: 22, median_hours_to_write: 2.5, published: 20, rejected: 1 },
  followups: { proposed: 2, approved: 1, done: 3, dismissed: 1 },
  ratings: { count: 9, average: 4.56 },
  recent_lessons: [
    { session_id: "s1", at: "2026-10-13T01:00:00+00:00", student_name: "Aarav Sharma", subject: "IGCSE Mathematics", mode: "online", understanding: 8, feedback_summary: "Strong lesson." },
    { session_id: "s2", at: "2026-10-12T01:00:00+00:00", student_name: "Sofia Rossi", subject: null, mode: "in_person", understanding: null, feedback_summary: null },
  ],
};

describe("scorecardFromRpc — teacher_scorecard's jsonb becomes the office's card", () => {
  it("copies the counts and orders the dimensions as the coaching pages draw them, unknown ones after", () => {
    const card = scorecardFromRpc(fixture);
    expect(card.teacher).toEqual({ id: "00000000-0000-0000-0000-0000000000a1", name: "Maya Chen" });
    expect(card.window_days).toBe(90);
    expect(card.lessons).toEqual({ taught: 24, online: 20, in_person: 4, no_shows: 1 });
    expect(card.coaching.lessons_with_feedback).toBe(6);
    expect(card.coaching.dimensions.map((d) => d.key)).toEqual(["engagement", "questioning", "clarity", "rapport", "pacing"]);
    expect(card.coaching.dimensions.map((d) => d.label)).toEqual(["Engagement", "Questioning", "Clarity", "Rapport", "Pacing"]);
    expect(card.coaching.strengths_top[0]).toEqual({ text: "Specific, earned praise", count: 5 });
    expect(card.followups).toEqual({ proposed: 2, approved: 1, done: 3, dismissed: 1 });
    expect(card.ratings).toEqual({ count: 9, average: 4.56 });
  });

  it("maps the recent lessons, naming a subjectless lesson and keeping an uncoached one without a summary", () => {
    const { recent_lessons } = scorecardFromRpc(fixture);
    expect(recent_lessons).toHaveLength(2);
    expect(recent_lessons[0]).toMatchObject({ session_id: "s1", mode: "online", understanding: 8, feedback_summary: "Strong lesson." });
    expect(recent_lessons[1]).toMatchObject({ session_id: "s2", subject: "Lesson", mode: "in_person", understanding: null, feedback_summary: null });
  });

  it("derives the on-time and reports shares, and has no share when nothing was measured", () => {
    const card = scorecardFromRpc(fixture);
    expect(onTimeShare(card)).toBeCloseTo(0.9);
    expect(reportsShare(card)).toBeCloseTo(22 / 24);
    expect(onTimeShare({ punctuality: { online_with_host_join: 0, median_minutes_late: null, late_over_5_min: 0 } })).toBeNull();
    expect(reportsShare({ reports: { due: 0, written: 0, median_hours_to_write: null, published: 0, rejected: 0 } })).toBeNull();
    // written never exceeds due (session_reports is unique per session), but a share is capped all the same.
    expect(reportsShare({ reports: { due: 2, written: 3, median_hours_to_write: 1, published: 3, rejected: 0 } })).toBe(1);
  });

  it("reads an average the database left null as null, numerics that arrive as strings, and a missing list as empty", () => {
    const loose = JSON.parse(JSON.stringify(fixture)) as Record<string, unknown>;
    (loose.metrics as Record<string, unknown>).avg_wait_ms = null;
    (loose.punctuality as Record<string, unknown>).median_minutes_late = "1.5";
    (loose.ratings as Record<string, unknown>).average = null;
    delete loose.recent_lessons;
    (loose.coaching as Record<string, unknown>).dimension_averages = { engagement: "4.2", clarity: null };
    const card = scorecardFromRpc(loose);
    expect(card.metrics.avg_wait_ms).toBeNull();
    expect(card.punctuality.median_minutes_late).toBe(1.5);
    expect(card.ratings.average).toBeNull();
    expect(card.recent_lessons).toEqual([]);
    expect(card.coaching.dimensions).toEqual([{ key: "engagement", label: "Engagement", mean: 4.2 }]);
  });

  it("gives an empty card for nothing at all, never a crash", () => {
    const card = scorecardFromRpc(null);
    expect(card.lessons.taught).toBe(0);
    expect(card.coaching.dimensions).toEqual([]);
    expect(card.recent_lessons).toEqual([]);
    expect(onTimeShare(card)).toBeNull();
  });

  it("takes the window from the query string only when it is one of the chips", () => {
    expect(scorecardWindow("30")).toBe(30);
    expect(scorecardWindow("180")).toBe(180);
    expect(scorecardWindow(undefined)).toBe(90);
    expect(scorecardWindow("45")).toBe(90);
    expect(scorecardWindow(["30", "180"])).toBe(30);
  });
});

describe("the demo answers teacher_scorecard in the contract's shape, under the RPC's gate", () => {
  const by = (id: string) => demoProfiles.find((p) => p.id === id)!;
  const grace = by(DEMO_IDS.grace);
  const ravi = by(DEMO_IDS.ravi);
  const admin = by(DEMO_IDS.admin);
  const maya = by(DEMO_IDS.maya);
  const daniel = by(DEMO_IDS.daniel);

  it("lets the room head, an admin and the teacher themself read it, and refuses support and a colleague", () => {
    expect(demoMayReadScorecard(grace, DEMO_IDS.maya, 90)).toBe(true);
    expect(demoMayReadScorecard(admin, DEMO_IDS.maya, 90)).toBe(true);
    expect(demoMayReadScorecard(maya, DEMO_IDS.maya, 90)).toBe(true);
    expect(demoMayReadScorecard(ravi, DEMO_IDS.maya, 90)).toBe(false);
    expect(demoMayReadScorecard(daniel, DEMO_IDS.maya, 90)).toBe(false);
    expect(() => buildDemoTeacherScorecard(ravi, DEMO_IDS.maya, 90)).toThrow("this teacher's scorecard is not yours to read");
  });

  it("refuses in the database's order: the window first, the gate before the teacher is looked up", () => {
    expect(() => buildDemoTeacherScorecard(admin, DEMO_IDS.maya, 0)).toThrow("a scorecard's window is at least a day");
    expect(() => buildDemoTeacherScorecard(ravi, "00000000-0000-0000-0000-0000000000ff", 90)).toThrow("not yours to read");
    expect(() => buildDemoTeacherScorecard(admin, "00000000-0000-0000-0000-0000000000ff", 90)).toThrow("no such teacher");
  });

  it("runs through the same mapper as the live path, and every block comes from the one window", () => {
    const card = scorecardFromRpc(buildDemoTeacherScorecard(grace, DEMO_IDS.maya, 90));
    expect(card.teacher.name).toBe("Maya Chen");
    expect(card.lessons.taught).toBeGreaterThan(20);
    expect(card.lessons.taught).toBe(card.lessons.online + card.lessons.in_person);
    expect(card.reports.due).toBe(card.lessons.taught);
    expect(card.reports.written).toBeLessThanOrEqual(card.reports.due);
    expect(card.coaching.lessons_with_feedback).toBeGreaterThanOrEqual(4);
    expect(card.coaching.dimensions.map((d) => d.key)).toEqual(["engagement", "questioning", "clarity", "rapport"]);
    expect(card.recent_lessons).toHaveLength(10);
    expect(card.recent_lessons.every((l) => l.student_name !== "Student")).toBe(true);
    // The newest lessons are the real demo bookings, so a coached one links to a coaching detail that exists.
    expect(card.recent_lessons.some((l) => l.feedback_summary)).toBe(true);
    expect(onTimeShare(card)).not.toBeNull();
  });

  it("moves every figure with the window: a longer window never has fewer lessons", () => {
    const [m30, m90, m180] = [30, 90, 180].map((d) => scorecardFromRpc(buildDemoTeacherScorecard(admin, DEMO_IDS.maya, d)));
    expect(m30!.lessons.taught).toBeLessThan(m90!.lessons.taught);
    expect(m90!.lessons.taught).toBeLessThan(m180!.lessons.taught);
    expect(m30!.window_days).toBe(30);
    expect(m180!.ratings.count).toBeGreaterThan(m30!.ratings.count);
  });

  it("gives Daniel his own term, which his room head reads only because he taught in her room this window", () => {
    const card = scorecardFromRpc(buildDemoTeacherScorecard(grace, DEMO_IDS.daniel, 90));
    expect(card.teacher.name).toBe("Daniel Okafor");
    expect(card.lessons.taught).toBeGreaterThan(8);
    expect(card.coaching.lessons_with_feedback).toBe(3);
  });
});
