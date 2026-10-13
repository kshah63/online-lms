// ============================================================================
// Syllabus progress — the model behind the tracker and the parent dashboard.
//
// A course has an ordered list of topics (seeded from mv-app's course_topics
// and extended by the in-charge). For each student and topic we combine the
// signals the platform actually has into one status and a confidence:
//   - session reports: the topic was taught; topic_completed
//   - practice attempts: accuracy and volume per topic, recency-weighted
//   - tests: score per topic
//   - the teacher's explicit mark (overrides everything)
// Pure functions; the data layer feeds them rows and stores the result.
// ============================================================================

export type TopicStatus = "not_started" | "in_progress" | "covered" | "secure" | "needs_work";

export interface TopicSignals {
  topic_id: string;
  /** Lessons where this topic was taught, newest first. */
  sessions: { at: string; completed: boolean }[];
  /** Auto-marked practice items on this topic. */
  practice: { at: string; correct: number; total: number }[];
  /** Tests (or test sections) on this topic. */
  tests: { at: string; score: number; out_of: number }[];
  /** A teacher's explicit decision, if any. */
  teacher_mark?: { status: TopicStatus; at: string; note?: string | null } | null;
}

export interface TopicProgress {
  topic_id: string;
  status: TopicStatus;
  /** 0..1 — how much evidence sits behind the status. */
  confidence: number;
  /** Recency-weighted practice accuracy 0..1, or null without practice. */
  accuracy: number | null;
  practice_items: number;
  last_activity: string | null;
  /** Latest test percentage on this topic, or null. */
  last_test_pct: number | null;
  reasons: string[];
}

/** Half-life for recency weighting of practice evidence, in days. */
const HALF_LIFE_DAYS = 21;
const SECURE_ACCURACY = 0.8;
const WEAK_ACCURACY = 0.6;
const MIN_ITEMS_FOR_JUDGEMENT = 5;

function daysBetween(aISO: string, bISO: string): number {
  return Math.abs(new Date(bISO).getTime() - new Date(aISO).getTime()) / 86_400_000;
}

export function weightedAccuracy(practice: TopicSignals["practice"], nowISO: string): { accuracy: number | null; items: number } {
  let num = 0;
  let den = 0;
  let items = 0;
  for (const p of practice) {
    if (p.total <= 0) continue;
    const w = Math.pow(0.5, daysBetween(p.at, nowISO) / HALF_LIFE_DAYS);
    num += w * p.correct;
    den += w * p.total;
    items += p.total;
  }
  return { accuracy: den > 0 ? num / den : null, items };
}

export function topicProgress(signals: TopicSignals, nowISO: string): TopicProgress {
  const reasons: string[] = [];
  const { accuracy, items } = weightedAccuracy(signals.practice, nowISO);
  const latestTest = [...signals.tests].sort((a, b) => b.at.localeCompare(a.at))[0];
  const last_test_pct = latestTest && latestTest.out_of > 0 ? Math.round((latestTest.score / latestTest.out_of) * 1000) / 10 : null;
  const taught = signals.sessions.length > 0;
  const completed = signals.sessions.some((s) => s.completed);
  const dates = [
    ...signals.sessions.map((s) => s.at),
    ...signals.practice.map((p) => p.at),
    ...signals.tests.map((t) => t.at),
    ...(signals.teacher_mark ? [signals.teacher_mark.at] : []),
  ].sort();
  const last_activity = dates[dates.length - 1] ?? null;

  // The teacher's word is final until newer evidence contradicts it strongly.
  if (signals.teacher_mark) {
    const mark = signals.teacher_mark;
    const newerEvidence = signals.practice.filter((p) => p.at > mark.at);
    const { accuracy: newerAcc, items: newerItems } = weightedAccuracy(newerEvidence, nowISO);
    const contradicts =
      newerItems >= MIN_ITEMS_FOR_JUDGEMENT &&
      ((mark.status === "secure" && newerAcc !== null && newerAcc < WEAK_ACCURACY) ||
        (mark.status === "needs_work" && newerAcc !== null && newerAcc >= SECURE_ACCURACY));
    if (!contradicts) {
      reasons.push(`Teacher marked it ${label(mark.status)}${mark.note ? `: ${mark.note}` : ""}.`);
      return { topic_id: signals.topic_id, status: mark.status, confidence: 0.9, accuracy, practice_items: items, last_activity, last_test_pct, reasons };
    }
    reasons.push(`Teacher marked it ${label(mark.status)}, but ${newerItems} newer practice items say otherwise.`);
  }

  let status: TopicStatus;
  let confidence: number;
  const evidence = Math.min(1, items / 20);

  if (!taught && items === 0 && !latestTest) {
    status = "not_started";
    confidence = 1;
    reasons.push("Not taught or practised yet.");
  } else if (accuracy !== null && items >= MIN_ITEMS_FOR_JUDGEMENT && accuracy < WEAK_ACCURACY) {
    status = "needs_work";
    confidence = 0.5 + 0.5 * evidence;
    reasons.push(`Practice accuracy ${pct(accuracy)} over ${items} items.`);
  } else if (last_test_pct !== null && last_test_pct < WEAK_ACCURACY * 100) {
    status = "needs_work";
    confidence = 0.7;
    reasons.push(`Latest test ${last_test_pct}%.`);
  } else if (accuracy !== null && items >= MIN_ITEMS_FOR_JUDGEMENT && accuracy >= SECURE_ACCURACY && (completed || last_test_pct !== null)) {
    status = "secure";
    confidence = 0.6 + 0.4 * evidence;
    reasons.push(`Practice accuracy ${pct(accuracy)} over ${items} items${completed ? " and the topic was completed in a lesson" : ""}.`);
  } else if (completed) {
    status = "covered";
    confidence = items > 0 ? 0.6 : 0.5;
    reasons.push(items > 0 ? `Completed in a lesson; ${items} practice items so far.` : "Completed in a lesson; no practice yet.");
  } else {
    status = "in_progress";
    confidence = 0.5;
    reasons.push(taught ? "Taught but not yet completed." : `Practised (${items} items) but not taught yet.`);
  }

  return { topic_id: signals.topic_id, status, confidence, accuracy, practice_items: items, last_activity, last_test_pct, reasons };
}

function pct(x: number) {
  return `${Math.round(x * 100)}%`;
}

export function label(s: TopicStatus): string {
  return { not_started: "not started", in_progress: "in progress", covered: "covered", secure: "secure", needs_work: "needs work" }[s];
}

export interface CourseProgressSummary {
  total: number;
  counts: Record<TopicStatus, number>;
  /** Topics covered or better, as a fraction of the syllabus. */
  coverage: number;
  /** Weakest first: needs_work, then covered-but-low-accuracy, by accuracy ascending. */
  weak_areas: TopicProgress[];
  /** What to practise next: needs_work first, then covered topics with little practice. */
  recommended_next: TopicProgress[];
  practice_items_total: number;
}

export function summariseCourse(topics: TopicProgress[], limit = 3): CourseProgressSummary {
  const counts: Record<TopicStatus, number> = { not_started: 0, in_progress: 0, covered: 0, secure: 0, needs_work: 0 };
  for (const t of topics) counts[t.status]++;
  const coveredOrBetter = counts.covered + counts.secure + counts.needs_work;
  // Weak = flagged needs-work, or still-forming topics (covered / in progress)
  // with low practice accuracy. A topic the evidence or the teacher calls
  // secure is never listed as weak, whatever its rounded accuracy.
  const weak = topics
    .filter((t) => t.status === "needs_work" || ((t.status === "covered" || t.status === "in_progress") && t.accuracy !== null && t.accuracy < SECURE_ACCURACY))
    .sort((a, b) => (a.status === "needs_work" ? 0 : 1) - (b.status === "needs_work" ? 0 : 1) || (a.accuracy ?? 1) - (b.accuracy ?? 1));
  const next = [
    ...topics.filter((t) => t.status === "needs_work"),
    ...topics.filter((t) => t.status === "covered").sort((a, b) => a.practice_items - b.practice_items),
    ...topics.filter((t) => t.status === "in_progress"),
  ];
  return {
    total: topics.length,
    counts,
    coverage: topics.length ? coveredOrBetter / topics.length : 0,
    weak_areas: weak.slice(0, limit),
    recommended_next: dedupe(next).slice(0, limit),
    practice_items_total: topics.reduce((s, t) => s + t.practice_items, 0),
  };
}

function dedupe(list: TopicProgress[]): TopicProgress[] {
  const seen = new Set<string>();
  return list.filter((t) => (seen.has(t.topic_id) ? false : (seen.add(t.topic_id), true)));
}

/** Weekly practice volume for a chart: items attempted per ISO week, oldest first. */
export function practiceByWeek(practice: { at: string; total: number }[], weeks = 8, nowISO: string): { week_start: string; items: number }[] {
  const now = new Date(nowISO);
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  const buckets: { week_start: string; items: number }[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const d = new Date(monday);
    d.setUTCDate(d.getUTCDate() - i * 7);
    buckets.push({ week_start: d.toISOString().slice(0, 10), items: 0 });
  }
  for (const p of practice) {
    const t = new Date(p.at).getTime();
    for (let i = buckets.length - 1; i >= 0; i--) {
      const start = new Date(buckets[i]!.week_start + "T00:00:00.000Z").getTime();
      if (t >= start) {
        if (t < start + 7 * 86_400_000) buckets[i]!.items += p.total;
        break;
      }
    }
  }
  return buckets;
}
