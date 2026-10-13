// ============================================================================
// The per-session report template — mv-app's `session_reports` vocabulary.
//
// mv-app (the centre's app, which mirrors the cPanel portal) stores a session
// report with these exact fields and rules, and parents read it there. The
// AI draft and the teacher's edits in the lessons platform must produce a row
// that `submit_report(...)` accepts, so the rules live here, once, with tests.
// Mirrors mv-app/src/lib/reportFields.ts; keep the two in step.
// ============================================================================

/** Previous homework — the portal's nine answers, in the portal's order. */
export const PREV_HW_OPTIONS = [
  "Yes",
  "Most of it Done",
  "Partially Done",
  "Little Done",
  "Not Done",
  "No Homework Given",
  "Did Not Bring / Did Not Send Through Email/Whatsapp",
  "Did Not Bring Exercise Book",
  "Done And Sent Through Email/Skype/Whatsapp",
] as const;
export type PrevHw = (typeof PREV_HW_OPTIONS)[number];

/** GP: 7.0 down to 1.0 in quarters, best first. */
export const GP_OPTIONS: number[] = Array.from({ length: (7 - 1) * 4 + 1 }, (_, i) => 7 - i * 0.25);

/** Understanding: 10 down to 1. */
export const UNDERSTANDING_OPTIONS: number[] = Array.from({ length: 10 }, (_, i) => 10 - i);

/** Oral test result: a band, stored as its lower bound (95 … 5). */
export const OTR_BANDS: { lower: number; label: string }[] = Array.from({ length: 19 }, (_, i) => {
  const val = 19 - i;
  return { lower: val * 5, label: `${val * 5}% to ${(val + 1) * 5}%` };
});

export interface WrittenTest {
  name: string;
  score: number | null;
  out_of: number | null;
  percent: number | null;
}

/** The report as the lessons platform drafts and edits it, before submit_report. */
export interface SessionReportDraft {
  topic: string;
  topic_completed: boolean;
  topics_not_done: string | null;
  understanding: number; // 1..10
  otr: number | null; // band lower bound or null = no oral test
  gp: number | null; // 1..7 in quarters; only when the author signs the report
  prev_hw: PrevHw | null;
  homework: string;
  remarks: string;
  written_tests: WrittenTest[];
  has_upcoming_tests: boolean;
}

// --- normalisers for values that come from a model or free typing ----------

/** Snap to the nearest quarter within 1..7, or null when absent. */
export function normaliseGp(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(n)) return null;
  const snapped = Math.round(n * 4) / 4;
  return Math.min(7, Math.max(1, snapped));
}

/** Snap to the nearest band lower bound (5..95), or null for no oral test. */
export function normaliseOtr(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  const lower = Math.round(n / 5) * 5;
  return Math.min(95, Math.max(5, lower));
}

export function normaliseUnderstanding(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(n)) return null;
  return Math.min(10, Math.max(1, Math.round(n)));
}

/** Map a loose phrase ("partly", "yes", "none set") onto one of the nine options. */
export function normalisePrevHw(value: string | null | undefined): PrevHw | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  if (!v) return null;
  const exact = PREV_HW_OPTIONS.find((o) => o.toLowerCase() === v);
  if (exact) return exact;
  if (/(no|none|wasn't|was not|not).*(given|set|assigned)/.test(v) || /^n\/?a$/.test(v)) return "No Homework Given";
  if (/sent|email|whatsapp|skype|online|uploaded/.test(v) && /done|complete|sent/.test(v)) return "Done And Sent Through Email/Skype/Whatsapp";
  if (/didn'?t bring|did not bring|forgot|left (it )?at home/.test(v)) {
    return /book/.test(v) ? "Did Not Bring Exercise Book" : "Did Not Bring / Did Not Send Through Email/Whatsapp";
  }
  if (/^(yes|done|complete(d)?|all done|fully)/.test(v)) return "Yes";
  if (/most|mostly|nearly|almost/.test(v)) return "Most of it Done";
  if (/partial|partly|half|some/.test(v)) return "Partially Done";
  if (/little|few|barely|hardly|attempted/.test(v)) return "Little Done";
  if (/^(no|not done|none|nothing|incomplete|didn'?t do|did not do)/.test(v)) return "Not Done";
  return null;
}

/** The percentage the portal would compute, or null when the marks cannot produce one. */
export function testPercent(score: number | null | undefined, outOf: number | null | undefined): number | null {
  if (score == null || outOf == null) return null;
  if (!Number.isFinite(score) || !Number.isFinite(outOf)) return null;
  if (outOf <= 0 || score < 0 || score > outOf) return null;
  return Math.round((score / outOf) * 1000) / 10;
}

export function normaliseWrittenTests(tests: Partial<WrittenTest>[] | null | undefined): WrittenTest[] {
  return (tests ?? [])
    .filter((t) => t && typeof t.name === "string" && t.name.trim())
    .map((t) => {
      const score = t.score ?? null;
      const out_of = t.out_of ?? null;
      return { name: t.name!.trim(), score, out_of, percent: testPercent(score, out_of) };
    });
}

/**
 * What submit_report refuses, checked here first so the teacher sees it in the
 * editor rather than as a database error. `signs` = the author's report
 * publishes directly (staff, or a teacher with report_auto_approve), in which
 * case a GP is required; otherwise the GP is the in-charge's to set and must be
 * left null.
 */
export function validateReportDraft(d: SessionReportDraft, opts: { signs: boolean }): string[] {
  const errors: string[] = [];
  if (!d.topic || !d.topic.trim()) errors.push("A report needs the topic that was taught.");
  if (!Number.isInteger(d.understanding) || d.understanding < 1 || d.understanding > 10)
    errors.push("Understanding must be a whole number from 1 to 10.");
  if (d.otr != null && !OTR_BANDS.some((b) => b.lower === d.otr)) errors.push("The oral test result must be one of the bands.");
  if (opts.signs) {
    if (d.gp == null) errors.push("A report needs a GP before it goes to the family.");
    else if (!GP_OPTIONS.includes(d.gp)) errors.push("GP must be between 1 and 7 in quarters.");
  } else if (d.gp != null) {
    errors.push("The GP is set by the in-charge for this report.");
  }
  if (d.prev_hw != null && !PREV_HW_OPTIONS.includes(d.prev_hw)) errors.push("Previous homework must be one of the listed answers.");
  if (d.topic_completed && d.topics_not_done && d.topics_not_done.trim())
    errors.push("A completed topic cannot also list topics not done.");
  for (const t of d.written_tests) {
    if (t.score != null && t.out_of != null && testPercent(t.score, t.out_of) == null)
      errors.push(`Written test "${t.name}": marks must be 0 to ${t.out_of ?? "the total"}.`);
  }
  return errors;
}
