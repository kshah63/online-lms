// ============================================================================
// AI pre-marking of WORKED answers — the pure half. The model looks at the
// student's working (a notebook page export or a photo) against the marking
// scheme and proposes marks step by step; the teacher confirms or changes
// them. Nothing here is final until a human says so.
// ============================================================================

import { z } from "zod";

export interface PremarkStep {
  description: string; // what the scheme awards ("M1 divide through by 2")
  awarded: boolean;
  evidence: string; // what in the working earned or lost it
}

export interface PremarkResult {
  score: number;
  max: number;
  steps: PremarkStep[];
  final_answer_seen: string | null;
  final_answer_correct: boolean | null;
  /** 0..1 — how legible/complete the working was; low values mean "look yourself". */
  confidence: number;
  feedback_for_student: string;
  note_for_teacher: string;
}

export const PREMARK_FORMAT = {
  type: "json_schema" as const,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      steps: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: { description: { type: "string" }, awarded: { type: "boolean" }, evidence: { type: "string" } },
          required: ["description", "awarded", "evidence"],
        },
      },
      score: { type: "number" },
      final_answer_seen: { type: ["string", "null"] },
      final_answer_correct: { type: ["boolean", "null"] },
      confidence: { type: "number" },
      feedback_for_student: { type: "string" },
      note_for_teacher: { type: "string" },
    },
    required: ["steps", "score", "final_answer_seen", "final_answer_correct", "confidence", "feedback_for_student", "note_for_teacher"],
  },
};

const Raw = z.object({
  steps: z.array(z.object({ description: z.string(), awarded: z.boolean(), evidence: z.string() })),
  score: z.number(),
  final_answer_seen: z.string().nullable(),
  final_answer_correct: z.boolean().nullable(),
  confidence: z.number(),
  feedback_for_student: z.string(),
  note_for_teacher: z.string(),
});

/** Validate and clamp. The score can never exceed the marks available or the awarded steps. */
export function parsePremark(raw: unknown, max: number): { result: PremarkResult | null; errors: string[] } {
  const p = Raw.safeParse(raw);
  if (!p.success) return { result: null, errors: p.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
  const d = p.data;
  const awarded = d.steps.filter((s) => s.awarded).length;
  let score = Math.max(0, Math.min(max, Math.round(d.score * 2) / 2));
  // When the scheme is one mark per step, the awarded count is the ceiling.
  if (d.steps.length > 0 && d.steps.length <= max) score = Math.min(score, awarded);
  return {
    result: {
      score,
      max,
      steps: d.steps.map((s) => ({ description: s.description.trim(), awarded: s.awarded, evidence: s.evidence.trim() })),
      final_answer_seen: d.final_answer_seen?.trim() || null,
      final_answer_correct: d.final_answer_correct,
      confidence: Math.max(0, Math.min(1, d.confidence)),
      feedback_for_student: d.feedback_for_student.trim(),
      note_for_teacher: d.note_for_teacher.trim(),
    },
    errors: [],
  };
}

/** Below this the teacher is asked to mark from scratch rather than confirm. */
export const PREMARK_REVIEW_THRESHOLD = 0.6;
