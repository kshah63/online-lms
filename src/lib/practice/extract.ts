import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { captureError } from "@/lib/observability";
import { EXTRACTION_FORMAT, parseExtraction, mergeAnswerKey, type DraftQuestion } from "./extract-parse";

// ============================================================================
// PDF → draft questions, via Claude. The worksheet (and optionally a separate
// answer-key PDF) go in as document blocks; a structured JSON extraction comes
// back and is normalised by extract-parse.ts. Everything lands in the review
// queue — nothing reaches a student without a human approving it.
// ============================================================================

export const extractionConfigured = Boolean(process.env.ANTHROPIC_API_KEY);

const MODEL = "claude-opus-5-5";
const FALLBACK_MODEL = "claude-opus-4-8";

export interface ExtractPdfInput {
  worksheet: { base64: string; name: string; file_id: string };
  answerKey?: { base64: string; name: string; file_id: string } | null;
  course: string;
  /** Syllabus topics to tag against. */
  topics: { id: string; label: string }[];
  /** Free text the in-charge adds: level, chapter, what to skip. */
  hints?: string | null;
}

export interface ExtractPdfResult {
  title: string;
  has_answer_key: boolean;
  questions: DraftQuestion[];
  errors: string[];
  usage: { input_tokens: number; output_tokens: number } | null;
}

const SYSTEM = `You convert maths worksheets (PDF) into a question bank for 1-1 tutoring. Work carefully and completely.

Rules:
- Split the worksheet into INDIVIDUAL questions. Sub-parts (a), (b), (ii) become separate questions numbered like "3a", "3b", "7ii", each with enough of the parent stem copied in to stand alone.
- Transcribe stems EXACTLY. Use Markdown with LaTeX ($x^2$, $\\frac{a}{b}$, $\\sqrt{2}$). Keep units.
- Type: "mcq" when lettered options exist and one is right; "multi_select" when more than one is right; "numeric" when the answer is a single number (give unit separately, never in the answer); "short" when the answer is a short expression, word or set ("x = 5", "(x-2)(x-3)", "prime"); "worked" when the question needs several steps and is marked by method (give a marking_scheme with method and accuracy marks when the paper shows marks).
- Answers: copy ONLY from an answer key or worked solutions present in the documents. If no key covers a question, set answer null and say so in notes. Never solve the question yourself to invent an answer. For mcq give the option KEY ("B"). For numeric give the number as text with no unit ("12.5"). Put a numeric tolerance only when the paper says "to 2 d.p." or similar (half a unit of that precision).
- marks: from the paper when printed, else 1 for mcq/numeric/short and 2-4 for worked by length. difficulty 1 (routine recall) to 5 (stretch/problem-solving).
- topic_label: pick the closest label from the syllabus list provided; if none fits, propose a short new label.
- Diagrams: has_diagram true and diagram_bbox as [x0, y0, x1, y1] percentages of the page (0-100, origin top-left) around the figure the question needs.
- answer_key: if the documents include an answer section, list every entry (number, answer, working if shown) there as well.
- confidence 0-1 per question: how sure you are the stem AND answer are transcribed correctly. notes: anything a reviewer should check.
Return only the JSON.`;

export async function extractQuestionsFromPdf(input: ExtractPdfInput): Promise<ExtractPdfResult> {
  if (!extractionConfigured) {
    return { title: "", has_answer_key: false, questions: [], errors: ["ANTHROPIC_API_KEY is not configured."], usage: null };
  }
  const client = new Anthropic();

  const topicList = input.topics.length ? input.topics.map((t) => `- ${t.label}`).join("\n") : "(no syllabus list supplied — propose labels)";
  const content: Anthropic.Beta.BetaContentBlockParam[] = [
    {
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: input.worksheet.base64 },
      title: input.worksheet.name,
    },
  ];
  if (input.answerKey) {
    content.push({
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: input.answerKey.base64 },
      title: `ANSWER KEY — ${input.answerKey.name}`,
    });
  }
  content.push({
    type: "text",
    text: `Course: ${input.course}.
Syllabus topics:
${topicList}
${input.hints ? `\nNotes from the in-charge: ${input.hints}` : ""}
${input.answerKey ? "\nThe second document is the answer key for the first." : ""}
Extract every question.`,
  });

  try {
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: 64000,
      betas: ["server-side-fallback-2026-06-01"],
      fallbacks: [{ model: FALLBACK_MODEL }],
      system: SYSTEM,
      messages: [{ role: "user", content }],
      output_config: { format: EXTRACTION_FORMAT, effort: "high" },
    });
    const message = await stream.finalMessage();
    if (message.stop_reason === "refusal") {
      return { title: "", has_answer_key: false, questions: [], errors: ["The model declined to process this document."], usage: null };
    }
    if (message.stop_reason === "max_tokens") {
      return { title: "", has_answer_key: false, questions: [], errors: ["The worksheet is too long for one pass; split the PDF and try again."], usage: null };
    }
    const text = message.content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")?.text ?? "";
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return { title: "", has_answer_key: false, questions: [], errors: ["The extraction was not valid JSON."], usage: null };
    }
    const parsed = parseExtraction(json, { file_id: input.worksheet.file_id, topics: input.topics });
    const questions = input.answerKey ? mergeAnswerKey(parsed.questions, (json as { answer_key?: { number: string; answer: string; working?: string | null }[] }).answer_key ?? []) : parsed.questions;
    return {
      ...parsed,
      questions,
      usage: { input_tokens: message.usage.input_tokens, output_tokens: message.usage.output_tokens },
    };
  } catch (err) {
    captureError(err, { where: "extractQuestionsFromPdf" });
    const msg = err instanceof Anthropic.APIError ? `Claude API error ${err.status}: ${err.message}` : "Extraction failed.";
    return { title: "", has_answer_key: false, questions: [], errors: [msg], usage: null };
  }
}
