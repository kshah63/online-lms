// ============================================================================
// The pre-lesson brief — what a teacher reads in the two minutes before a
// lesson. Pure composition from whatever the platform knows; the data layer
// gathers the inputs, an optional AI pass turns the bullets into three
// sentences. Nothing is invented: a section with nothing to say is omitted.
// ============================================================================

export interface BriefReport {
  at: string;
  topic: string | null;
  topic_completed: boolean | null;
  topics_not_done?: string | null;
  understanding: number | null;
  homework: string | null;
  remarks: string | null;
  /** Who wrote it, when the room knows (the brief may show another teacher's report). */
  teacher_name?: string | null;
}

export interface BriefInput {
  student: { first_name: string; grade?: string | null; school?: string | null };
  course: string;
  session: { starts_at: string; topic?: string | null; agenda?: string | null; mode?: "online" | "in_person" };
  last_report?: BriefReport | null;
  /** Older published reports on this student and course, newest first — by any teacher. */
  earlier_reports?: BriefReport[];
  /** The teacher's own coaching moments from the last lesson with this student. */
  coaching_moments?: { kind: "strength" | "improvement"; comment: string }[];
  /** Where a teacher marked the student on the syllabus (syllabus_teacher_marks). */
  teacher_marks?: { label: string; status: string; at: string }[];
  /** Standing / session / reminder notes about the student (staff-written). */
  notes?: { kind: string; body: string; author?: string | null }[];
  homework?: { description: string; status: string; due_at?: string | null; marks?: string | null }[];
  /** Recent per-topic practice, any order. */
  practice?: { topic_label: string; accuracy: number | null; items: number; last_at?: string | null }[];
  followups?: { title: string; kind: string; priority: string; action: string }[];
  syllabus?: { coverage: number; weak_areas: { label: string; status: string; accuracy: number | null }[]; recommended_next: { label: string }[] } | null;
  /** Integrity flags on recent at-home tests. */
  integrity_flags?: number;
  nowISO?: string;
}

export interface BriefSection {
  title: string;
  items: string[];
}

export interface Brief {
  headline: string;
  sections: BriefSection[];
  /** One to three concrete suggestions for the next 60 minutes. */
  suggested_focus: string[];
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

function daysAgo(iso: string, nowISO: string): string {
  const d = Math.round((new Date(nowISO).getTime() - new Date(iso).getTime()) / 86_400_000);
  if (d <= 0) return "today";
  if (d === 1) return "yesterday";
  if (d < 14) return `${d} days ago`;
  const w = Math.round(d / 7);
  return `${w} week${w > 1 ? "s" : ""} ago`;
}

export function composeBrief(input: BriefInput): Brief {
  const now = input.nowISO ?? new Date().toISOString();
  const name = input.student.first_name;
  const sections: BriefSection[] = [];
  const focus: string[] = [];

  // Last time
  if (input.last_report) {
    const r = input.last_report;
    const items: string[] = [];
    const when = daysAgo(r.at, now);
    if (r.topic) items.push(`${when}: ${r.topic}${r.topic_completed === false ? " (not finished" + (r.topics_not_done ? `: ${r.topics_not_done}` : "") + ")" : r.topic_completed ? " (completed)" : ""}.`);
    if (r.understanding != null) items.push(`Understanding was ${r.understanding}/10.`);
    if (r.homework) items.push(`Homework set: ${r.homework}`);
    if (r.remarks) items.push(`Report said: "${r.remarks.length > 180 ? r.remarks.slice(0, 177) + "…" : r.remarks}"`);
    if (r.teacher_name) items.push(`Written by ${r.teacher_name}.`);
    for (const e of input.earlier_reports ?? []) {
      const bits: string[] = [];
      if (e.understanding != null) bits.push(`understanding ${e.understanding}/10`);
      if (e.teacher_name) bits.push(`by ${e.teacher_name}`);
      items.push(`Earlier, ${daysAgo(e.at, now)}: ${e.topic ?? "a lesson"}${e.topic_completed === false ? " (not finished)" : ""}${bits.length ? ` — ${bits.join(", ")}` : ""}.`);
    }
    if (items.length) sections.push({ title: "Last time", items });
    if (r.topic_completed === false && r.topic) focus.push(`Finish ${r.topic}${r.topics_not_done ? ` — ${r.topics_not_done}` : ""}.`);
    if (r.understanding != null && r.understanding <= 5 && r.topic) focus.push(`Re-check ${r.topic}; understanding was only ${r.understanding}/10.`);
  }

  // Homework
  const hw = (input.homework ?? []).filter((h) => h.status !== "verified" && h.status !== "completed");
  const reviewed = (input.homework ?? []).filter((h) => h.status === "verified" || h.status === "completed");
  if (hw.length || reviewed.length) {
    const items: string[] = [];
    for (const h of hw) items.push(`${statusWord(h.status)}: ${h.description}${h.due_at ? ` (due ${daysAgo(h.due_at, now) === "today" ? "today" : new Date(h.due_at) < new Date(now) ? "overdue" : "soon"})` : ""}`);
    for (const h of reviewed.slice(0, 2)) items.push(`Done: ${h.description}${h.marks ? ` — ${h.marks}` : ""}`);
    sections.push({ title: "Homework", items });
    const overdue = hw.filter((h) => h.due_at && new Date(h.due_at) < new Date(now));
    if (overdue.length) focus.push(`Ask about the overdue homework (${overdue[0]!.description}).`);
    else if (hw.some((h) => h.status === "submitted")) focus.push("Go through the submitted homework together.");
  }

  // Practice and weak areas
  const practice = [...(input.practice ?? [])].filter((p) => p.items > 0).sort((a, b) => (a.accuracy ?? 1) - (b.accuracy ?? 1));
  const weak = input.syllabus?.weak_areas ?? [];
  if (practice.length || weak.length) {
    const items: string[] = [];
    for (const w of weak.slice(0, 3)) items.push(`${w.label}: ${w.status.replace("_", " ")}${w.accuracy != null ? ` (${pct(w.accuracy)} in practice)` : ""}`);
    for (const p of practice.slice(0, 3)) {
      if (weak.some((w) => w.label === p.topic_label)) continue;
      items.push(`${p.topic_label}: ${p.accuracy != null ? pct(p.accuracy) : "—"} over ${p.items} items${p.last_at ? `, ${daysAgo(p.last_at, now)}` : ""}`);
    }
    if (input.syllabus) items.push(`Syllabus coverage: ${pct(input.syllabus.coverage)}.`);
    sections.push({ title: "Practice and weak spots", items });
    const first = weak[0] ?? (practice[0] && practice[0].accuracy != null && practice[0].accuracy < 0.6 ? { label: practice[0].topic_label } : null);
    if (first) focus.push(`Spend ten minutes on ${first.label} — it is the weakest area.`);
  }

  // Syllabus marks (a teacher's explicit word on where the student stands)
  const marks = input.teacher_marks ?? [];
  if (marks.length) {
    const items: string[] = [];
    for (const status of ["needs_work", "in_progress", "covered", "secure"]) {
      const labels = marks.filter((m) => m.status === status).map((m) => m.label);
      if (labels.length) items.push(`${capitalise(status.replace("_", " "))}: ${labels.join(", ")}`);
    }
    sections.push({ title: "Syllabus marks", items });
    const needsWork = marks.filter((m) => m.status === "needs_work").sort((a, b) => b.at.localeCompare(a.at))[0];
    if (needsWork && !weak.length) focus.push(`Revisit ${needsWork.label} — marked needs work ${daysAgo(needsWork.at, now)}.`);
  }

  // Coaching
  const improvements = (input.coaching_moments ?? []).filter((m) => m.kind === "improvement").slice(0, 2);
  const strengths = (input.coaching_moments ?? []).filter((m) => m.kind === "strength").slice(0, 1);
  if (improvements.length || strengths.length) {
    sections.push({ title: "For you, from last lesson", items: [...strengths.map((m) => `Keep doing: ${m.comment}`), ...improvements.map((m) => `Try: ${m.comment}`)] });
  }

  // Notes and follow-ups
  const notes = (input.notes ?? []).map((n) => `${n.kind === "standing" ? "Standing note" : n.kind === "reminder" ? "Reminder" : "Note"}: ${n.body}${n.author ? ` (${n.author})` : ""}`);
  const fus = (input.followups ?? []).map((f) => `${f.priority === "high" ? "⚠ " : ""}${f.title}`);
  if (notes.length || fus.length) sections.push({ title: "From the office", items: [...notes, ...fus] });
  if (input.integrity_flags && input.integrity_flags > 0) {
    sections.push({ title: "Heads up", items: [`${input.integrity_flags} recent at-home test${input.integrity_flags > 1 ? "s were" : " was"} flagged for review — compare with how ${name} does in the lesson.`] });
  }

  // Plan
  const plan: string[] = [];
  if (input.session.topic) plan.push(`Booked topic: ${input.session.topic}`);
  if (input.session.agenda) plan.push(`Agenda: ${input.session.agenda}`);
  const next = input.syllabus?.recommended_next?.[0];
  if (next && next.label !== input.session.topic) plan.push(`Syllabus suggests next: ${next.label}`);
  if (plan.length) sections.unshift({ title: "Today", items: plan });
  if (input.session.topic && focus.length === 0) focus.push(`Teach ${input.session.topic}; end with a three-question quick check.`);
  if (focus.length === 0) focus.push("Start with a two-minute recap of last lesson, then a quick check before new material.");

  const headline = input.last_report
    ? `${name}${input.student.grade ? ` (${input.student.grade})` : ""} — last lesson ${daysAgo(input.last_report.at, now)}${input.last_report.topic ? ` on ${input.last_report.topic}` : ""}.`
    : `${name}${input.student.grade ? ` (${input.student.grade})` : ""} — first lesson on the platform.`;

  return { headline, sections, suggested_focus: dedupe(focus).slice(0, 3) };
}

function statusWord(s: string): string {
  return { assigned: "Not yet done", started: "Started, not finished", submitted: "Submitted, to review", incomplete: "Sent back" }[s] ?? s;
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function dedupe(xs: string[]): string[] {
  return xs.filter((x, i) => xs.indexOf(x) === i);
}
