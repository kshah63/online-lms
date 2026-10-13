import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { captureError } from "@/lib/observability";
import type { WorkedQuestion } from "./model";
import { PREMARK_FORMAT, parsePremark, type PremarkResult } from "./premark-parse";

// ============================================================================
// Pre-mark a worked answer from images of the student's working. The result
// is a PROPOSAL the teacher confirms in the review queue.
// ============================================================================

export const premarkConfigured = Boolean(process.env.ANTHROPIC_API_KEY);

const MODEL = "claude-opus-5-5";
const FALLBACK_MODEL = "claude-opus-4-8";

export type ImageMedia = "image/png" | "image/jpeg" | "image/webp" | "image/gif";

const SYSTEM = `You are marking a school maths student's WORKED answer against a marking scheme, from an image of their handwriting or notebook page. Be fair and consistent, the way an experienced examiner is.

Rules:
- Award each step of the scheme only if it is visibly earned in the working. Method marks can be earned with a wrong final answer; accuracy marks cannot be earned without the correct value.
- Read carefully; students write small, cross things out, and work in any order. Crossed-out work is not marked.
- final_answer_seen: the final answer as written (null if none). final_answer_correct: compared with the expected answer when given; null if unknown.
- score: total marks for the steps awarded (half marks only if the scheme allows).
- confidence: 0-1 — how sure you are of this marking given legibility and completeness. If the image is unreadable or not the right question, set confidence below 0.3 and say so in note_for_teacher.
- feedback_for_student: two warm, specific sentences: what was right, the one thing to fix. Do not reveal a full solution.
- note_for_teacher: anything to double-check.`;

export async function premarkWorkedAnswer(input: {
  question: WorkedQuestion;
  images: { base64: string; media_type: ImageMedia }[];
  typedFinalAnswer?: string | null;
}): Promise<{ result: PremarkResult | null; errors: string[] }> {
  if (!premarkConfigured) return { result: null, errors: ["ANTHROPIC_API_KEY is not configured."] };
  if (input.images.length === 0) return { result: null, errors: ["No image of the working was supplied."] };

  const client = new Anthropic();
  const content: Anthropic.Beta.BetaContentBlockParam[] = input.images.slice(0, 6).map((img) => ({
    type: "image",
    source: { type: "base64", media_type: img.media_type, data: img.base64 },
  }));
  content.push({
    type: "text",
    text: `Question (${input.question.marks} marks):
${input.question.stem}

Marking scheme:
${input.question.marking_scheme}
${input.question.final_answer ? `\nExpected final answer: ${input.question.final_answer}` : ""}${input.question.worked_solution ? `\nModel solution (for reference):\n${input.question.worked_solution}` : ""}${input.typedFinalAnswer ? `\nThe student also typed this final answer: ${input.typedFinalAnswer}` : ""}

Mark the working shown in the image(s).`,
  });

  try {
    const res = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 8000,
      betas: ["server-side-fallback-2026-06-01"],
      fallbacks: [{ model: FALLBACK_MODEL }],
      system: SYSTEM,
      messages: [{ role: "user", content }],
      output_config: { format: PREMARK_FORMAT, effort: "high" },
    });
    if (res.stop_reason === "refusal") return { result: null, errors: ["The model declined to mark this image."] };
    const text = res.content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")?.text;
    if (!text) return { result: null, errors: ["Empty response."] };
    return parsePremark(JSON.parse(text), input.question.marks);
  } catch (err) {
    captureError(err, { where: "premarkWorkedAnswer" });
    return { result: null, errors: [err instanceof Anthropic.APIError ? `Claude API error ${err.status}: ${err.message}` : "Pre-marking failed."] };
  }
}
