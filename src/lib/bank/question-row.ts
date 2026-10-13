import type { DraftQuestion } from "@/lib/practice/extract-parse";
import type { Question } from "@/lib/practice/model";
import { parseNumber } from "@/lib/practice/numbers";
import type { BankQuestion, Difficulty, QuestionDraftInput } from "./types";

// ============================================================================
// Pure mappings between a practice_questions row, the editor's form, the
// extraction's DraftQuestion and the practice model the runner renders. The
// answer column's jsonb shape is the contract's: mcq "A", multi_select
// ["A","C"], numeric a number, short a string, worked null. Unit-tested.
// ============================================================================

export const OPTION_KEYS = ["A", "B", "C", "D", "E", "F", "G", "H"] as const;

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x)) : [];
}

function asOptions(v: unknown): { key: string; text: string }[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((o): o is { key: unknown; text: unknown } => typeof o === "object" && o !== null)
    .map((o) => ({ key: String(o.key ?? "").toUpperCase(), text: String(o.text ?? "") }));
}

/** A row as the runner's Question, for the preview card (image by signed URL, if any). */
export function rowToQuestion(row: BankQuestion, imageUrl: string | null = null, topicLabel: string | null = null): Question {
  const base = {
    id: row.id,
    stem: row.stem,
    image_url: imageUrl,
    topic_id: row.syllabus_topic_id,
    topic_label: topicLabel,
    difficulty: row.difficulty,
    marks: Number(row.marks) || 1,
    worked_solution: row.worked_solution,
    source: { kind: row.source?.kind ?? "manual", file_id: row.source?.file_id, page: row.source?.page, parent_question_id: row.source?.parent_question_id },
  } as const;
  switch (row.type) {
    case "mcq":
      return { ...base, type: "mcq", options: asOptions(row.options), answer: String(row.answer ?? "") };
    case "multi_select":
      return { ...base, type: "multi_select", options: asOptions(row.options), answers: asStringArray(row.answer) };
    case "numeric":
      return { ...base, type: "numeric", answer: Number(row.answer ?? 0), tolerance: row.tolerance, unit: row.unit };
    case "short":
      return { ...base, type: "short", answers: [String(row.answer ?? ""), ...(row.accepted ?? [])].filter(Boolean) };
    case "worked":
      return { ...base, type: "worked", marking_scheme: row.worked_solution ?? "", final_answer: null };
  }
}

/** A row as the editor's form. */
export function rowToEditor(row: BankQuestion): QuestionDraftInput {
  return {
    id: row.id,
    type: row.type,
    stem: row.stem,
    options: asOptions(row.options),
    answer: row.type === "multi_select" || row.type === "worked" || row.answer == null ? "" : String(row.answer),
    answers: row.type === "multi_select" ? asStringArray(row.answer) : [],
    accepted: row.accepted ?? [],
    tolerance: row.tolerance == null ? "" : String(row.tolerance),
    unit: row.unit ?? "",
    difficulty: row.difficulty,
    marks: Number(row.marks) || 1,
    worked_solution: row.worked_solution ?? "",
    image_path: row.image_path,
    syllabus_topic_id: row.syllabus_topic_id,
    source: row.source ?? { kind: "manual" },
  };
}

/** An empty form for a new question of the given type. */
export function emptyEditor(type: QuestionDraftInput["type"] = "mcq"): QuestionDraftInput {
  const choice = type === "mcq" || type === "multi_select";
  return {
    id: null,
    type,
    stem: "",
    options: choice ? [{ key: "A", text: "" }, { key: "B", text: "" }] : [],
    answer: "",
    answers: [],
    accepted: [],
    tolerance: "",
    unit: "",
    difficulty: 3,
    marks: 1,
    worked_solution: "",
    image_path: null,
    syllabus_topic_id: null,
    source: { kind: "manual" },
  };
}

/** The column-shaped p_question for upsert_question, or the sentence saying why the form is not ready. */
export function editorToPayload(form: QuestionDraftInput): { ok: true; payload: Record<string, unknown> } | { ok: false; message: string } {
  const stem = form.stem.trim();
  if (!stem) return { ok: false, message: "The question needs a stem." };
  const options = form.options.map((o, i) => ({ key: OPTION_KEYS[i] ?? o.key, text: o.text.trim() }));
  let answer: unknown = null;
  let accepted: string[] | null = null;
  let tolerance: number | null = null;
  let unit: string | null = null;

  switch (form.type) {
    case "mcq": {
      if (options.length < 2 || options.some((o) => !o.text)) return { ok: false, message: "A multiple-choice question needs at least two options, each with text." };
      if (!options.some((o) => o.key === form.answer)) return { ok: false, message: "Pick which option is correct." };
      answer = form.answer;
      break;
    }
    case "multi_select": {
      if (options.length < 2 || options.some((o) => !o.text)) return { ok: false, message: "A select-all question needs at least two options, each with text." };
      const keys = options.map((o) => o.key).filter((k) => form.answers.includes(k));
      if (keys.length === 0) return { ok: false, message: "Tick at least one correct option." };
      answer = keys;
      break;
    }
    case "numeric": {
      const n = parseNumber(form.answer);
      if (n === null) return { ok: false, message: "The numeric answer must be a number (decimals and fractions are fine)." };
      answer = n;
      if (form.tolerance.trim()) {
        const t = parseNumber(form.tolerance);
        if (t === null || t < 0) return { ok: false, message: "The tolerance must be a number of zero or more." };
        tolerance = t;
      }
      unit = form.unit.trim() || null;
      break;
    }
    case "short": {
      const a = form.answer.trim();
      if (!a) return { ok: false, message: "A short-answer question needs the accepted answer." };
      answer = a;
      const alts = form.accepted.map((x) => x.trim()).filter((x) => x && x !== a);
      accepted = alts.length ? alts : null;
      break;
    }
    case "worked": {
      if (!form.worked_solution.trim()) return { ok: false, message: "A worked question needs a worked solution or marking scheme for whoever marks it." };
      break;
    }
  }

  const marks = Number(form.marks);
  if (!Number.isFinite(marks) || marks <= 0) return { ok: false, message: "Marks must be more than zero." };

  return {
    ok: true,
    payload: {
      id: form.id,
      type: form.type,
      stem,
      options: form.type === "mcq" || form.type === "multi_select" ? options : null,
      answer,
      tolerance,
      unit,
      accepted,
      difficulty: form.difficulty,
      marks,
      worked_solution: form.worked_solution.trim() || null,
      image_path: form.image_path,
      syllabus_topic_id: form.syllabus_topic_id,
      source: form.source ?? { kind: "manual" },
    },
  };
}

/** The stored-shape answer of an extracted draft (contract §B store_extracted_questions). */
export function draftAnswer(d: DraftQuestion): unknown {
  switch (d.type) {
    case "mcq":
      return d.answer ?? null;
    case "multi_select":
      return d.answers;
    case "numeric":
      return d.answer == null ? null : parseNumber(d.answer);
    case "short":
      return d.answers[0] ?? d.answer ?? null;
    case "worked":
      return null;
  }
}

/** The worked solution column holds the solution and, for worked questions, the marking scheme after it. */
export function draftWorkedSolution(d: DraftQuestion): string | null {
  const parts = [d.worked_solution?.trim() || null, d.marking_scheme?.trim() ? `**Marking scheme.** ${d.marking_scheme.trim()}` : null].filter(Boolean);
  return parts.length ? parts.join("\n\n") : null;
}

/** One element of store_extracted_questions' p_questions, shaped like model.ts Question. */
export function draftToPayload(d: DraftQuestion): Record<string, unknown> {
  const choice = d.type === "mcq" || d.type === "multi_select";
  return {
    type: d.type,
    stem: d.stem,
    options: choice ? d.options : null,
    answer: draftAnswer(d),
    answers: d.type === "multi_select" ? d.answers : undefined,
    tolerance: d.type === "numeric" ? d.tolerance : null,
    unit: d.type === "numeric" ? d.unit : null,
    accepted: d.type === "short" && d.answers.length > 1 ? d.answers.slice(1) : null,
    difficulty: d.difficulty,
    marks: d.marks,
    worked_solution: draftWorkedSolution(d),
    topic_id: d.topic_id,
    source: d.source,
  };
}

/** The demo's version of store_extracted_questions: a draft row with a fresh id. */
export function draftToRow(d: DraftQuestion, courseId: string, id: string, createdBy: string, nowISO: string): BankQuestion {
  const choice = d.type === "mcq" || d.type === "multi_select";
  return {
    id,
    course_id: courseId,
    syllabus_topic_id: d.topic_id,
    type: d.type,
    stem: d.stem,
    options: choice ? d.options : null,
    answer: draftAnswer(d),
    tolerance: d.type === "numeric" ? d.tolerance : null,
    unit: d.type === "numeric" ? d.unit : null,
    accepted: d.type === "short" && d.answers.length > 1 ? d.answers.slice(1) : null,
    difficulty: d.difficulty,
    marks: d.marks,
    worked_solution: draftWorkedSolution(d),
    image_path: null,
    source: { ...d.source },
    status: "draft",
    created_by: createdBy,
    reviewed_by: null,
    reviewed_at: null,
    created_at: nowISO,
    updated_at: nowISO,
  };
}

/** The demo's version of upsert_question: the payload applied over an existing row, or a new draft. */
export function payloadToRow(payload: Record<string, unknown>, existing: BankQuestion | null, courseId: string, id: string, createdBy: string, nowISO: string): BankQuestion {
  const base: BankQuestion = existing ?? {
    id,
    course_id: courseId,
    syllabus_topic_id: null,
    type: "mcq",
    stem: "",
    options: null,
    answer: null,
    tolerance: null,
    unit: null,
    accepted: null,
    difficulty: 3,
    marks: 1,
    worked_solution: null,
    image_path: null,
    source: { kind: "manual" },
    status: "draft",
    created_by: createdBy,
    reviewed_by: null,
    reviewed_at: null,
    created_at: nowISO,
    updated_at: nowISO,
  };
  return {
    ...base,
    type: payload.type as BankQuestion["type"],
    stem: String(payload.stem ?? ""),
    options: (payload.options as BankQuestion["options"]) ?? null,
    answer: payload.answer ?? null,
    tolerance: (payload.tolerance as number | null) ?? null,
    unit: (payload.unit as string | null) ?? null,
    accepted: (payload.accepted as string[] | null) ?? null,
    difficulty: (payload.difficulty as Difficulty) ?? 3,
    marks: Number(payload.marks ?? 1),
    worked_solution: (payload.worked_solution as string | null) ?? null,
    image_path: (payload.image_path as string | null) ?? null,
    syllabus_topic_id: (payload.syllabus_topic_id as string | null) ?? null,
    source: (payload.source as BankQuestion["source"]) ?? { kind: "manual" },
    updated_at: nowISO,
  };
}

/** A SAMPLE_QUESTIONS entry as the extraction would have returned it (the demo's "extracted" result). */
export function questionToDraft(q: Question, number: string, fileId: string): DraftQuestion {
  const common = {
    number,
    stem: q.stem,
    tolerance: null,
    unit: null,
    marks: q.marks,
    difficulty: q.difficulty,
    topic_label: q.topic_label ?? null,
    topic_id: q.topic_id ?? null,
    page: 1,
    has_diagram: false,
    diagram_hint: null,
    worked_solution: q.worked_solution ?? null,
    marking_scheme: null,
    confidence: 0.95,
    review_notes: [] as string[],
    source: { kind: "pdf" as const, file_id: fileId, page: 1 },
  };
  switch (q.type) {
    case "mcq":
      return { ...common, type: "mcq", options: q.options, answer: q.answer, answers: [] };
    case "multi_select":
      return { ...common, type: "multi_select", options: q.options, answer: null, answers: q.answers };
    case "numeric":
      return { ...common, type: "numeric", options: [], answer: String(q.answer), answers: [], tolerance: q.tolerance ?? null, unit: q.unit ?? null };
    case "short":
      return { ...common, type: "short", options: [], answer: null, answers: q.answers };
    case "worked":
      return { ...common, type: "worked", options: [], answer: q.final_answer ?? null, answers: [], marking_scheme: q.marking_scheme, review_notes: ["Worked question: marked by a person."] };
  }
}

/** The first line of a stem, for dense rows. */
export function stemSummary(stem: string, max = 140): string {
  const line = stem.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}
