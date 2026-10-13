// ============================================================================
// PDF → questions: the PURE half. Validates and normalises what the model
// returns, merges a separate answer key, and decides what needs human review.
// Nothing here touches the network, so it is unit-tested; extract.ts is the
// thin server wrapper that calls Claude and hands the JSON in.
// ============================================================================

import { z } from "zod";
import type { McqOption, QuestionSource, QuestionType } from "./model";
import { parseNumber } from "./numbers";

/** One extracted question, before it has an id or a place in the bank. */
export interface DraftQuestion {
  number: string; // "3a", "12", "7(ii)" normalised to "7ii"
  type: QuestionType;
  stem: string;
  options: McqOption[];
  /** mcq key, numeric value as string, short text, or worked final answer. */
  answer: string | null;
  /** multi_select keys / short accepted alternatives. */
  answers: string[];
  tolerance: number | null;
  unit: string | null;
  marks: number;
  difficulty: 1 | 2 | 3 | 4 | 5;
  topic_label: string | null;
  topic_id: string | null;
  page: number | null;
  has_diagram: boolean;
  /** Where on the page the diagram sits, as percentages, for a later crop. */
  diagram_hint: { page: number; bbox: [number, number, number, number] } | null;
  worked_solution: string | null;
  marking_scheme: string | null;
  confidence: number; // 0..1
  review_notes: string[];
  source: QuestionSource;
}

/** The JSON schema Claude is asked to fill (no min/max: structured outputs forbid them). */
export const EXTRACTION_FORMAT = {
  type: "json_schema" as const,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      worksheet_title: { type: "string" },
      has_answer_key: { type: "boolean" },
      questions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            number: { type: "string" },
            type: { type: "string", enum: ["mcq", "multi_select", "numeric", "short", "worked"] },
            stem: { type: "string" },
            options: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: { key: { type: "string" }, text: { type: "string" } },
                required: ["key", "text"],
              },
            },
            answer: { type: ["string", "null"] },
            answers: { type: "array", items: { type: "string" } },
            tolerance: { type: ["number", "null"] },
            unit: { type: ["string", "null"] },
            marks: { type: "integer" },
            difficulty: { type: "integer" },
            topic_label: { type: ["string", "null"] },
            page: { type: ["integer", "null"] },
            has_diagram: { type: "boolean" },
            diagram_bbox: {
              type: ["array", "null"],
              items: { type: "number" },
            },
            worked_solution: { type: ["string", "null"] },
            marking_scheme: { type: ["string", "null"] },
            confidence: { type: "number" },
            notes: { type: ["string", "null"] },
          },
          required: [
            "number", "type", "stem", "options", "answer", "answers", "tolerance", "unit", "marks",
            "difficulty", "topic_label", "page", "has_diagram", "diagram_bbox", "worked_solution",
            "marking_scheme", "confidence", "notes",
          ],
        },
      },
      answer_key: {
        type: "array",
        description: "Only when an answer key section or document was provided: one entry per question number.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            number: { type: "string" },
            answer: { type: "string" },
            working: { type: ["string", "null"] },
          },
          required: ["number", "answer", "working"],
        },
      },
    },
    required: ["worksheet_title", "has_answer_key", "questions", "answer_key"],
  },
};

const RawQuestion = z.object({
  number: z.string(),
  type: z.enum(["mcq", "multi_select", "numeric", "short", "worked"]),
  stem: z.string(),
  options: z.array(z.object({ key: z.string(), text: z.string() })).default([]),
  answer: z.string().nullable().default(null),
  answers: z.array(z.string()).default([]),
  tolerance: z.number().nullable().default(null),
  unit: z.string().nullable().default(null),
  marks: z.number().default(1),
  difficulty: z.number().default(2),
  topic_label: z.string().nullable().default(null),
  page: z.number().nullable().default(null),
  has_diagram: z.boolean().default(false),
  diagram_bbox: z.array(z.number()).nullable().default(null),
  worked_solution: z.string().nullable().default(null),
  marking_scheme: z.string().nullable().default(null),
  confidence: z.number().default(0.5),
  notes: z.string().nullable().default(null),
});

export const RawExtraction = z.object({
  worksheet_title: z.string().default(""),
  has_answer_key: z.boolean().default(false),
  questions: z.array(RawQuestion),
  answer_key: z
    .array(z.object({ number: z.string(), answer: z.string(), working: z.string().nullable().default(null) }))
    .default([]),
});
export type RawExtraction = z.infer<typeof RawExtraction>;

/** "Q3 (a)" → "3a", "7(ii)" → "7ii", "12." → "12". */
export function normaliseQuestionNumber(n: string): string {
  return n
    .toLowerCase()
    .replace(/^(question|qn|q)\s*/i, "")
    .replace(/[\s().:\-_]/g, "")
    .trim();
}

function clampDifficulty(n: number): 1 | 2 | 3 | 4 | 5 {
  const d = Math.round(n);
  return (d < 1 ? 1 : d > 5 ? 5 : d) as 1 | 2 | 3 | 4 | 5;
}

/** Topic match: exact label, else case-insensitive containment either way. */
export function matchTopic(label: string | null, topics: { id: string; label: string }[]): { id: string; label: string } | null {
  if (!label) return null;
  const l = label.trim().toLowerCase();
  if (!l) return null;
  const exact = topics.find((t) => t.label.toLowerCase() === l);
  if (exact) return exact;
  const loose = topics.find((t) => t.label.toLowerCase().includes(l) || l.includes(t.label.toLowerCase()));
  return loose ?? null;
}

const REVIEW_CONFIDENCE = 0.7;

/**
 * Validate the model's JSON and turn it into draft questions. Every question
 * gets review_notes explaining why a human should look (the queue sorts on
 * them); a clean, confident question with an answer gets none.
 */
export function parseExtraction(
  raw: unknown,
  ctx: { file_id: string; topics: { id: string; label: string }[] },
): { title: string; has_answer_key: boolean; questions: DraftQuestion[]; errors: string[] } {
  const parsed = RawExtraction.safeParse(raw);
  if (!parsed.success) {
    return { title: "", has_answer_key: false, questions: [], errors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
  }
  const data = parsed.data;
  const keyByNumber = new Map(data.answer_key.map((k) => [normaliseQuestionNumber(k.number), k]));

  const questions: DraftQuestion[] = data.questions.map((q) => {
    const notes: string[] = [];
    const number = normaliseQuestionNumber(q.number) || q.number;
    let type = q.type;
    let answer = q.answer?.trim() || null;
    let answers = q.answers.map((a) => a.trim()).filter(Boolean);
    const options = q.options.map((o) => ({ key: o.key.trim().toUpperCase(), text: o.text.trim() }));

    // Type sanity: options imply a choice question; a choice question needs options.
    if (options.length >= 2 && type !== "mcq" && type !== "multi_select") {
      type = answers.length > 1 ? "multi_select" : "mcq";
      notes.push("Re-typed as a choice question because options were present.");
    }
    if ((type === "mcq" || type === "multi_select") && options.length < 2) {
      type = answer && parseNumber(answer) !== null ? "numeric" : "short";
      notes.push("Choice question had fewer than two options; re-typed.");
    }

    // Fill from the answer key when the question itself carries no answer.
    const key = keyByNumber.get(number);
    if (!answer && answers.length === 0 && key) {
      answer = key.answer.trim();
      notes.push("Answer taken from the answer key.");
    }
    let worked_solution = q.worked_solution?.trim() || null;
    if (!worked_solution && key?.working) worked_solution = key.working.trim();

    // Per-type normalisation.
    if (type === "mcq") {
      if (answer) {
        const k = answer.trim().toUpperCase().replace(/[().]/g, "");
        const match = options.find((o) => o.key === k) ?? options.find((o) => o.text.toLowerCase() === answer!.toLowerCase());
        if (match) answer = match.key;
        else notes.push(`MCQ answer "${answer}" does not match an option key.`);
      }
    } else if (type === "multi_select") {
      if (answers.length === 0 && answer) answers = answer.split(/[,\s/&]+/).filter(Boolean);
      answers = answers.map((a) => a.toUpperCase().replace(/[().]/g, ""));
      const unknown = answers.filter((a) => !options.some((o) => o.key === a));
      if (unknown.length) notes.push(`Multi-select answers not in options: ${unknown.join(", ")}.`);
      answer = null;
    } else if (type === "numeric") {
      if (answer && parseNumber(answer) === null) {
        notes.push(`Numeric answer "${answer}" is not a number; re-typed as short answer.`);
        type = "short";
        answers = [answer];
        answer = null;
      }
    } else if (type === "short") {
      if (answer && answers.length === 0) {
        answers = [answer];
        answer = null;
      }
    }

    if (type !== "worked" && !answer && answers.length === 0) notes.push("No answer available; needs one before it can go live.");
    if (type === "worked" && !q.marking_scheme && !worked_solution) notes.push("Worked question has no marking scheme or solution.");
    if (q.confidence < REVIEW_CONFIDENCE) notes.push(`Low extraction confidence (${Math.round(q.confidence * 100)}%).`);
    if (q.has_diagram && (!q.diagram_bbox || q.diagram_bbox.length !== 4)) notes.push("Has a diagram but no crop hint; attach the image by hand.");
    if (q.notes?.trim()) notes.push(q.notes.trim());
    if (!q.stem.trim()) notes.push("Empty stem.");

    const topic = matchTopic(q.topic_label, ctx.topics);
    if (q.topic_label && !topic) notes.push(`Proposed topic "${q.topic_label}" is not in the syllabus list.`);

    const bbox = q.has_diagram && q.diagram_bbox && q.diagram_bbox.length === 4 ? (q.diagram_bbox as [number, number, number, number]) : null;

    return {
      number,
      type,
      stem: q.stem.trim(),
      options,
      answer,
      answers,
      tolerance: q.tolerance,
      unit: q.unit?.trim() || null,
      marks: Math.max(1, Math.round(q.marks || 1)),
      difficulty: clampDifficulty(q.difficulty),
      topic_label: topic?.label ?? q.topic_label?.trim() ?? null,
      topic_id: topic?.id ?? null,
      page: q.page,
      has_diagram: q.has_diagram,
      diagram_hint: bbox && q.page ? { page: q.page, bbox } : null,
      worked_solution,
      marking_scheme: q.marking_scheme?.trim() || null,
      confidence: Math.max(0, Math.min(1, q.confidence)),
      review_notes: notes,
      source: { kind: "pdf", file_id: ctx.file_id, page: q.page ?? undefined },
    };
  });

  return { title: data.worksheet_title, has_answer_key: data.has_answer_key || data.answer_key.length > 0, questions, errors: [] };
}

/** Merge a separately extracted answer key (second PDF) into questions that still lack answers. */
export function mergeAnswerKey(
  questions: DraftQuestion[],
  key: { number: string; answer: string; working?: string | null }[],
): DraftQuestion[] {
  const byNumber = new Map(key.map((k) => [normaliseQuestionNumber(k.number), k]));
  return questions.map((q) => {
    const k = byNumber.get(normaliseQuestionNumber(q.number));
    if (!k) return q;
    const next = { ...q, review_notes: [...q.review_notes] };
    const has = next.answer || next.answers.length > 0;
    if (!has) {
      if (next.type === "mcq") next.answer = k.answer.trim().toUpperCase().replace(/[().]/g, "");
      else if (next.type === "multi_select") next.answers = k.answer.split(/[,\s/&]+/).filter(Boolean).map((a) => a.toUpperCase());
      else if (next.type === "numeric") {
        if (parseNumber(k.answer) !== null) next.answer = k.answer.trim();
        else {
          next.type = "short";
          next.answers = [k.answer.trim()];
        }
      } else if (next.type === "short") next.answers = [k.answer.trim()];
      else next.answer = k.answer.trim();
      next.review_notes = next.review_notes.filter((n) => !n.startsWith("No answer available"));
      next.review_notes.push("Answer taken from the separate answer key.");
    } else {
      // Both present: flag disagreement for review rather than silently prefer one.
      const current = next.answer ?? next.answers.join(", ");
      if (current.trim().toLowerCase() !== k.answer.trim().toLowerCase()) {
        const a = parseNumber(current);
        const b = parseNumber(k.answer);
        if (a === null || b === null || Math.abs(a - b) > 1e-9) next.review_notes.push(`Answer key says "${k.answer}" but the extraction has "${current}".`);
      }
    }
    if (!next.worked_solution && k.working) next.worked_solution = k.working.trim();
    return next;
  });
}

/** Questions that can go live without a human looking (none: policy is review-everything). */
export function needsReview(q: DraftQuestion): boolean {
  return q.review_notes.length > 0 || q.confidence < 1;
}
