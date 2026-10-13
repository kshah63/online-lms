import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { captureError } from "@/lib/observability";
import type { SessionMetrics, TranscriptSegment } from "@/lib/coaching/metrics";
import {
  PREV_HW_OPTIONS,
  normaliseGp,
  normaliseOtr,
  normalisePrevHw,
  normaliseUnderstanding,
  normaliseWrittenTests,
  type SessionReportDraft,
  type WrittenTest,
} from "./mvapp-template";

// ============================================================================
// The per-session report, drafted for mv-app's session_reports form.
//
// The teacher's quick notes come first, supported by the transcript, the
// lesson metrics and any practice/test results from the lesson. The output
// is exactly the row submit_report() wants; the teacher edits every field
// before it goes anywhere. Without an API key a notes-first heuristic keeps
// the editor usable.
// ============================================================================

export const reportAiConfigured = Boolean(process.env.ANTHROPIC_API_KEY);

const MODEL = "claude-opus-5-5";
const FALLBACK_MODEL = "claude-opus-4-8";

export interface DraftSessionReportInput {
  notes: string;
  segments: TranscriptSegment[];
  metrics: SessionMetrics | null;
  studentName: string;
  course: string;
  /** Topic options for this course (mv-app course_topics); the topic should be one of these when one fits. */
  topicOptions: string[];
  /** The topic the booking named, if any. */
  bookedTopic?: string | null;
  /** What the previous report set as homework, so prev_hw can be judged. */
  previousHomework?: string | null;
  /** Evidence about the previous homework from the platform (submitted/verified/marks). */
  previousHomeworkStatus?: string | null;
  /** In-lesson practice or test results. */
  testResults?: { name: string; score: number; out_of: number }[];
  /** Whether the author's report publishes directly (then a GP is expected). */
  signs: boolean;
  useAi?: boolean;
}

export interface DraftedSessionReport {
  draft: SessionReportDraft;
  /** Why the AI chose what it chose — shown to the teacher, never to parents. */
  rationale: string;
  source: "ai" | "heuristic";
}

const FORMAT = {
  type: "json_schema" as const,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      topic: { type: "string" },
      topic_completed: { type: "boolean" },
      topics_not_done: { type: ["string", "null"] },
      understanding: { type: "integer" },
      otr: { type: ["integer", "null"] },
      gp: { type: ["number", "null"] },
      prev_hw: { type: ["string", "null"] },
      homework: { type: "string" },
      remarks: { type: "string" },
      written_tests: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: { name: { type: "string" }, score: { type: ["number", "null"] }, out_of: { type: ["number", "null"] } },
          required: ["name", "score", "out_of"],
        },
      },
      has_upcoming_tests: { type: "boolean" },
      rationale: { type: "string" },
    },
    required: ["topic", "topic_completed", "topics_not_done", "understanding", "otr", "gp", "prev_hw", "homework", "remarks", "written_tests", "has_upcoming_tests", "rationale"],
  },
};

const SYSTEM = `You draft the centre's per-session report for a 1-1 maths lesson, which the teacher will edit and the parent will read. Base it on the teacher's notes first, then the transcript, metrics and results. Be honest and specific; never invent detail.

Fields:
- topic: the topic taught. Choose one of the provided topic options when one fits; otherwise a short label. Prefer the booked topic if the lesson matched it.
- topic_completed: true if the planned topic was finished; if false, topics_not_done lists what was left (else null).
- understanding: 1-10 whole number, the student's grasp of today's topic by the end.
- otr: ONLY if an oral quiz/questioning round was clearly scored in the lesson, give the percentage as a multiple of 5 (5-95); otherwise null.
- gp: ${"only when the author signs the report"} — a grade point 1-7 in quarters (7 best) reflecting overall performance; null if told not to.
- prev_hw: one of exactly: ${PREV_HW_OPTIONS.join(" | ")} — or null if nothing can be said.
- homework: concrete, short, what to do before next lesson (exercise numbers, practice set).
- remarks: 3-5 warm, plain sentences to the parent: what was covered, how the student did, one strength, one thing to work on. First name only. No jargon.
- written_tests: any test or practice set done in the lesson, with marks (score, out_of); empty list if none.
- has_upcoming_tests: true if the student or teacher mentioned an upcoming school test or exam.
- rationale: two sentences for the teacher on why you scored it this way.`;

export async function draftSessionReport(input: DraftSessionReportInput): Promise<DraftedSessionReport> {
  if (!reportAiConfigured || input.useAi === false) return { ...heuristicSessionReport(input), source: "heuristic" };

  const client = new Anthropic();
  const transcript = input.segments.map((s) => `${s.speaker === "teacher" ? "Teacher" : "Student"}: ${s.text}`).join("\n");
  const first = input.studentName.split(" ")[0];
  const m = input.metrics;
  const user = `Student: ${input.studentName} (use "${first}"). Course: ${input.course}.
Author signs the report (GP allowed): ${input.signs ? "yes" : "no — set gp to null"}.
Booked topic: ${input.bookedTopic ?? "(none)"}.
Topic options: ${input.topicOptions.length ? input.topicOptions.join(" | ") : "(none)"}.
Previous homework set: ${input.previousHomework ?? "(unknown)"}. Platform evidence: ${input.previousHomeworkStatus ?? "(none)"}.
In-lesson results: ${input.testResults?.length ? input.testResults.map((t) => `${t.name}: ${t.score}/${t.out_of}`).join("; ") : "(none)"}.

Teacher's quick notes:
${input.notes || "(none provided)"}

${m ? `Metrics: student talked ${Math.round(m.student_talk_pct * 100)}%, ${m.question_count} questions asked, ${m.praise_count} praise moments.\n` : ""}${transcript ? `Transcript:\n${transcript}` : "(no transcript available)"}`;

  try {
    const res = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-06-01"],
      fallbacks: [{ model: FALLBACK_MODEL }],
      system: SYSTEM,
      messages: [{ role: "user", content: user }],
      output_config: { format: FORMAT, effort: "high" },
    });
    if (res.stop_reason !== "refusal") {
      const text = res.content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")?.text;
      if (text) {
        const raw = JSON.parse(text) as Record<string, unknown>;
        return { draft: normaliseDraft(raw, input), rationale: String(raw.rationale ?? ""), source: "ai" };
      }
    }
  } catch (err) {
    captureError(err, { where: "draftSessionReport failed, using heuristic" });
  }
  return { ...heuristicSessionReport(input), source: "heuristic" };
}

/** Coerce whatever came back into the template's exact vocabulary. */
export function normaliseDraft(raw: Record<string, unknown>, input: Pick<DraftSessionReportInput, "signs" | "topicOptions" | "bookedTopic" | "testResults">): SessionReportDraft {
  const topicRaw = String(raw.topic ?? "").trim();
  const topic = input.topicOptions.find((t) => t.toLowerCase() === topicRaw.toLowerCase()) ?? topicRaw ?? input.bookedTopic ?? "";
  const topic_completed = Boolean(raw.topic_completed);
  const written = normaliseWrittenTests(
    (Array.isArray(raw.written_tests) ? (raw.written_tests as Partial<WrittenTest>[]) : []).concat(
      (input.testResults ?? []).map((t) => ({ name: t.name, score: t.score, out_of: t.out_of })),
    ),
  );
  // Dedupe tests by name (AI may echo the ones we supplied).
  const seen = new Set<string>();
  const written_tests = written.filter((t) => (seen.has(t.name.toLowerCase()) ? false : (seen.add(t.name.toLowerCase()), true)));
  return {
    topic,
    topic_completed,
    topics_not_done: topic_completed ? null : (typeof raw.topics_not_done === "string" && raw.topics_not_done.trim()) || null,
    understanding: normaliseUnderstanding(raw.understanding as number | string | null) ?? 6,
    otr: normaliseOtr(raw.otr as number | string | null),
    gp: input.signs ? normaliseGp(raw.gp as number | string | null) : null,
    prev_hw: normalisePrevHw(typeof raw.prev_hw === "string" ? raw.prev_hw : null),
    homework: String(raw.homework ?? "").trim(),
    remarks: String(raw.remarks ?? "").trim(),
    written_tests,
    has_upcoming_tests: Boolean(raw.has_upcoming_tests),
  };
}

/** Notes-first fallback so the editor always opens with something usable. */
export function heuristicSessionReport(input: DraftSessionReportInput): { draft: SessionReportDraft; rationale: string } {
  const first = input.studentName.split(" ")[0];
  const n = input.notes.trim();
  const topic = input.bookedTopic?.trim() || input.topicOptions[0] || `Continued work in ${input.course}`;
  const tests = normaliseWrittenTests((input.testResults ?? []).map((t) => ({ name: t.name, score: t.score, out_of: t.out_of })));
  const avg = tests.length ? tests.reduce((s, t) => s + (t.percent ?? 0), 0) / tests.length : null;
  const understanding = avg == null ? 7 : Math.max(1, Math.min(10, Math.round(avg / 10)));
  const prevStatus = (input.previousHomeworkStatus ?? "").toLowerCase();
  const prev_hw = !input.previousHomework ? "No Homework Given" : /verified|complete|done/.test(prevStatus) ? "Yes" : /submitted|partial/.test(prevStatus) ? "Partially Done" : /overdue|missing|not/.test(prevStatus) ? "Not Done" : null;
  return {
    draft: {
      topic,
      topic_completed: true,
      topics_not_done: null,
      understanding,
      otr: null,
      gp: input.signs ? normaliseGp(Math.max(1, Math.min(7, understanding * 0.7))) : null,
      prev_hw,
      homework: "Complete the practice set from today's lesson.",
      remarks: n
        ? `${first} worked on ${topic} today. ${n}`
        : `${first} worked steadily on ${topic} today and attempted the problems with a positive attitude. A little more independent practice would help consolidate the method.`,
      written_tests: tests,
      has_upcoming_tests: false,
    },
    rationale: "Heuristic draft from the teacher's notes and in-lesson results; no AI pass was run.",
  };
}
