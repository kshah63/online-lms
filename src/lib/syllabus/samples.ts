import { practiceByWeek, summariseCourse, topicProgress, type TopicSignals } from "./progress";
import type { ProgressView } from "./view";

/** Demo-mode data for the progress dashboard, run through the real model. */
export function sampleProgressView(nowISO = new Date().toISOString()): ProgressView {
  const d = (daysAgo: number) => new Date(new Date(nowISO).getTime() - daysAgo * 86_400_000).toISOString();
  const topics: { id: string; label: string; signals: TopicSignals }[] = [
    { id: "t1", label: "Number and indices", signals: { topic_id: "t1", sessions: [{ at: d(70), completed: true }], practice: [{ at: d(60), correct: 9, total: 10 }, { at: d(30), correct: 8, total: 8 }], tests: [{ at: d(50), score: 18, out_of: 20 }] } },
    { id: "t2", label: "Algebraic manipulation", signals: { topic_id: "t2", sessions: [{ at: d(56), completed: true }], practice: [{ at: d(40), correct: 7, total: 10 }, { at: d(12), correct: 9, total: 10 }], tests: [] } },
    { id: "t3", label: "Linear equations", signals: { topic_id: "t3", sessions: [{ at: d(42), completed: true }], practice: [{ at: d(35), correct: 10, total: 12 }], tests: [{ at: d(28), score: 15, out_of: 20 }] } },
    { id: "t4", label: "Quadratics", signals: { topic_id: "t4", sessions: [{ at: d(21), completed: true }, { at: d(14), completed: true }], practice: [{ at: d(13), correct: 4, total: 10 }, { at: d(6), correct: 5, total: 10 }, { at: d(2), correct: 3, total: 6 }], tests: [{ at: d(5), score: 11, out_of: 20 }] } },
    { id: "t5", label: "Simultaneous equations", signals: { topic_id: "t5", sessions: [{ at: d(7), completed: false }], practice: [{ at: d(3), correct: 2, total: 4 }], tests: [] } },
    { id: "t6", label: "Surds", signals: { topic_id: "t6", sessions: [], practice: [], tests: [], teacher_mark: null } },
    { id: "t7", label: "Coordinate geometry", signals: { topic_id: "t7", sessions: [], practice: [], tests: [] } },
    { id: "t8", label: "Trigonometry", signals: { topic_id: "t8", sessions: [], practice: [], tests: [] } },
    { id: "t9", label: "Sequences", signals: { topic_id: "t9", sessions: [{ at: d(35), completed: true }], practice: [{ at: d(20), correct: 8, total: 10 }], tests: [], teacher_mark: { status: "secure", at: d(19), note: "Solid on nth term" } } },
    { id: "t10", label: "Probability", signals: { topic_id: "t10", sessions: [], practice: [], tests: [] } },
    { id: "t11", label: "Statistics", signals: { topic_id: "t11", sessions: [], practice: [], tests: [] } },
    { id: "t12", label: "Vectors", signals: { topic_id: "t12", sessions: [], practice: [], tests: [] } },
  ];
  const progress = topics.map((t) => ({ id: t.id, label: t.label, progress: topicProgress(t.signals, nowISO) }));
  const allPractice = topics.flatMap((t) => t.signals.practice);
  const inWindow = (p: { at: string }, from: number, to: number) => {
    const days = (new Date(nowISO).getTime() - new Date(p.at).getTime()) / 86_400_000;
    return days >= from && days < to;
  };
  const acc = (from: number, to: number) => {
    const rows = allPractice.filter((p) => inWindow(p, from, to));
    const total = rows.reduce((s, p) => s + p.total, 0);
    return { value: total ? rows.reduce((s, p) => s + p.correct, 0) / total : null, items: total };
  };
  const current = acc(0, 56);
  const previous = acc(56, 112);
  return {
    student: { id: "00000000-0000-0000-0000-0000000000b1", first_name: "Aarav" },
    course: { id: "c-igcse", name: "IGCSE Maths (Extended)" },
    generated_at: nowISO,
    summary: summariseCourse(progress.map((p) => p.progress)),
    topics: progress,
    weekly: practiceByWeek(allPractice, 8, nowISO),
    accuracy: { current: current.value, previous: previous.value, items: current.items },
    attendance: { attended: 7, booked: 8, weeks: 8 },
    tests: [
      { name: "Quadratics topic test", at: d(5), score: 11, out_of: 20, topic_label: "Quadratics", flagged: false },
      { name: "Linear equations check", at: d(28), score: 15, out_of: 20, topic_label: "Linear equations", flagged: false },
      { name: "Indices quiz (at home)", at: d(50), score: 18, out_of: 20, topic_label: "Number and indices", flagged: true },
    ],
  };
}
