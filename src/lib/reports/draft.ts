import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { captureError } from "@/lib/observability";
import type { SessionMetrics, TranscriptSegment } from "@/lib/coaching/metrics";

// ============================================================================
// §8 Report drafting — a mix of AI + teacher input. The teacher's quick notes
// plus the lesson transcript and metrics go to Claude, which drafts a parent-
// facing report the teacher then edits and publishes. Falls back to a notes +
// metrics heuristic when ANTHROPIC_API_KEY isn't configured.
// ============================================================================

export interface ReportDraft {
  topics_covered: string;
  how_student_did: string;
  strengths: string;
  areas_to_work: string;
  homework: string;
  rating: number;
  needs_followup: boolean;
  followup_reason: string;
}

const DraftSchema = z.object({
  topics_covered: z.string(),
  how_student_did: z.string(),
  strengths: z.string(),
  areas_to_work: z.string(),
  homework: z.string(),
  rating: z.number(),
  needs_followup: z.boolean(),
  followup_reason: z.string(),
});

const FORMAT = {
  type: "json_schema" as const,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      topics_covered: { type: "string" },
      how_student_did: { type: "string" },
      strengths: { type: "string" },
      areas_to_work: { type: "string" },
      homework: { type: "string" },
      rating: { type: "integer" },
      needs_followup: { type: "boolean" },
      followup_reason: { type: "string" },
    },
    required: [
      "topics_covered",
      "how_student_did",
      "strengths",
      "areas_to_work",
      "homework",
      "rating",
      "needs_followup",
      "followup_reason",
    ],
  },
};

const SYSTEM = `You draft warm, concise parent-facing reports for a 1-1 tutoring lesson.
Write in plain language a parent will understand; be specific and encouraging but honest.
Base the report on the teacher's notes first, supported by the transcript and metrics.
Set needs_followup=true only if the lesson surfaced something a parent should be contacted about
(e.g. a persistent struggle, a wellbeing concern, or repeated missed homework); give a one-line reason.
rating is the teacher's overall sense of the lesson, 1-5 (integer). If a field has nothing to say,
return a short honest sentence rather than inventing detail.`;

export const aiConfigured = Boolean(process.env.ANTHROPIC_API_KEY);

export async function draftReport(input: {
  notes: string;
  segments: TranscriptSegment[];
  metrics: SessionMetrics | null;
  ctx: { studentName: string; course: string };
  useAi?: boolean;
}): Promise<ReportDraft> {
  const { notes, segments, metrics, ctx } = input;
  // No key, or the caller is over their AI rate limit → notes-first heuristic.
  if (!aiConfigured || input.useAi === false) return heuristicDraft(notes, ctx);

  const client = new Anthropic();
  const transcript = segments
    .map((s) => `${s.speaker === "teacher" ? "Teacher" : "Student"}: ${s.text}`)
    .join("\n");

  const user = `Student: ${ctx.studentName}. Lesson: ${ctx.course}.

Teacher's quick notes:
${notes || "(none provided)"}

${metrics ? `Metrics: student talked ${pct(metrics.student_talk_pct)}, ${metrics.question_count} questions, ${metrics.praise_count} praise moments.\n` : ""}${
    transcript ? `Transcript:\n${transcript}` : "(no transcript available)"
  }`;

  try {
    const res = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 2048,
      thinking: { type: "adaptive" },
      system: SYSTEM,
      messages: [{ role: "user", content: user }],
      output_config: { format: FORMAT },
    });
    const text = res.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text;
    if (text) {
      const parsed = DraftSchema.safeParse(JSON.parse(text));
      if (parsed.success) return parsed.data;
    }
  } catch (err) {
    captureError(err, { where: "draftReport failed, using heuristic" });
  }
  return heuristicDraft(notes, ctx);
}

function pct(x: number) {
  return `${Math.round(x * 100)}%`;
}

/** Notes-first fallback so the teacher always gets a usable starting point. */
function heuristicDraft(notes: string, ctx: { studentName: string; course: string }): ReportDraft {
  const first = ctx.studentName.split(" ")[0];
  const n = notes.trim();
  return {
    topics_covered: n ? n : `Continued work in ${ctx.course}.`,
    how_student_did: n
      ? `${first} engaged well with today's material. ${n}`
      : `${first} worked steadily through the lesson.`,
    strengths: `${first} stayed focused and was willing to attempt the problems.`,
    areas_to_work: "A little more independent practice would help consolidate today's topic.",
    homework: "Complete the practice set from today's lesson.",
    rating: 4,
    needs_followup: false,
    followup_reason: "",
  };
}
