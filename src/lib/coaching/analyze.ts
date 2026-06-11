import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { SessionMetrics, TranscriptSegment } from "@/lib/coaching/metrics";

// ============================================================================
// §7.3 Post-session AI feedback — the robust half. Full transcript + final
// metrics → Claude → structured, strengths-first coaching. Falls back to a
// metrics-derived heuristic when ANTHROPIC_API_KEY isn't configured.
// ============================================================================

export interface TeacherFeedback {
  summary: string;
  strengths: string[];
  suggestions: string[];
  dimension_scores: {
    engagement: number;
    questioning: number;
    clarity: number;
    rapport: number;
  };
}

const FeedbackSchema = z.object({
  summary: z.string(),
  strengths: z.array(z.string()),
  suggestions: z.array(z.string()),
  dimension_scores: z.object({
    engagement: z.number(),
    questioning: z.number(),
    clarity: z.number(),
    rapport: z.number(),
  }),
});

// JSON Schema for structured outputs (no min/max — unsupported; enforced in prompt).
const FEEDBACK_FORMAT = {
  type: "json_schema" as const,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      summary: { type: "string" },
      strengths: { type: "array", items: { type: "string" } },
      suggestions: { type: "array", items: { type: "string" } },
      dimension_scores: {
        type: "object",
        additionalProperties: false,
        properties: {
          engagement: { type: "integer" },
          questioning: { type: "integer" },
          clarity: { type: "integer" },
          rapport: { type: "integer" },
        },
        required: ["engagement", "questioning", "clarity", "rapport"],
      },
    },
    required: ["summary", "strengths", "suggestions", "dimension_scores"],
  },
};

const SYSTEM = `You are a supportive tutoring coach reviewing a 1-1 lesson transcript and metrics.
Lead with strengths. Be specific and actionable, grounded in the transcript and the numbers.
Keep each strength and suggestion to one sentence. Score each dimension 1-5 (integers).`;

export const aiConfigured = Boolean(process.env.ANTHROPIC_API_KEY);

export async function analyzeLesson(
  segments: TranscriptSegment[],
  metrics: SessionMetrics,
  ctx: { teacherName: string; studentName: string; course: string },
): Promise<TeacherFeedback> {
  if (!aiConfigured) return heuristicFeedback(metrics);

  const client = new Anthropic();
  const transcript = segments
    .map((s) => `[${fmt(s.start_ms)}] ${s.speaker === "teacher" ? "Teacher" : "Student"}: ${s.text}`)
    .join("\n");

  const user = `Lesson: ${ctx.course}. Teacher: ${ctx.teacherName}. Student: ${ctx.studentName}.

Metrics:
- Teacher talk: ${pct(metrics.teacher_talk_pct)} / Student talk: ${pct(metrics.student_talk_pct)}
- Questions: ${metrics.question_count} (open ${pct(metrics.open_question_pct)})
- Avg wait after a question: ${(metrics.avg_wait_ms / 1000).toFixed(1)}s
- Student turns: ${metrics.student_turns} (avg ${(metrics.avg_student_turn_ms / 1000).toFixed(1)}s)
- Praise moments: ${metrics.praise_count}

Transcript:
${transcript}`;

  try {
    const res = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 4096,
      thinking: { type: "adaptive" },
      system: SYSTEM,
      messages: [{ role: "user", content: user }],
      output_config: { format: FEEDBACK_FORMAT },
    });
    const text = res.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text;
    if (text) {
      const parsed = FeedbackSchema.safeParse(JSON.parse(text));
      if (parsed.success) return parsed.data;
    }
  } catch (err) {
    console.error("analyzeLesson failed, using heuristic:", err);
  }
  return heuristicFeedback(metrics);
}

function fmt(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
function pct(x: number) {
  return `${Math.round(x * 100)}%`;
}

/** Deterministic fallback so the dashboard is meaningful without an API key. */
export function heuristicFeedback(m: SessionMetrics): TeacherFeedback {
  const strengths: string[] = [];
  const suggestions: string[] = [];

  if (m.student_talk_pct >= 0.4)
    strengths.push("Strong student voice — they did a healthy share of the talking and thinking.");
  if (m.open_question_pct >= 0.4)
    strengths.push("Good use of open questions to draw out the student's reasoning.");
  if (m.praise_count >= 3)
    strengths.push("Warm and encouraging — you reinforced the student's effort throughout.");
  if (m.avg_wait_ms >= 2500)
    strengths.push("You gave real wait-time after questions, letting the student think.");
  if (strengths.length === 0)
    strengths.push("You kept the lesson moving and covered the planned ground.");

  if (m.teacher_talk_pct > 0.65)
    suggestions.push("Aim to talk less — try handing the next step to the student to solve aloud.");
  if (m.open_question_pct < 0.4)
    suggestions.push("Mix in more open 'how/why' questions rather than yes/no checks.");
  if (m.avg_wait_ms < 2000)
    suggestions.push("Extend your wait-time after a question to ~3 seconds before stepping in.");
  if (m.praise_count < 2)
    suggestions.push("Name specific things the student did well to build their confidence.");
  if (suggestions.length === 0)
    suggestions.push("Keep doing what you're doing — consider stretching the student with a harder follow-up.");

  const score = (good: boolean, mid: boolean) => (good ? 5 : mid ? 4 : 3);
  return {
    summary: `Student talked ${pct(m.student_talk_pct)} of the lesson across ${m.student_turns} turns, with ${m.question_count} questions asked. ${
      m.teacher_talk_pct > 0.65 ? "There's room to hand more of the work to the student." : "A nicely balanced session."
    }`,
    strengths,
    suggestions,
    dimension_scores: {
      engagement: clamp(score(m.student_talk_pct >= 0.4, m.student_talk_pct >= 0.3)),
      questioning: clamp(score(m.open_question_pct >= 0.4 && m.question_count >= 5, m.question_count >= 3)),
      clarity: clamp(score(m.avg_wait_ms >= 2500, m.avg_wait_ms >= 1500)),
      rapport: clamp(score(m.praise_count >= 3, m.praise_count >= 1)),
    },
  };
}

function clamp(n: number) {
  return Math.max(1, Math.min(5, n));
}
