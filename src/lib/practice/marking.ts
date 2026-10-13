// ============================================================================
// Auto-marking. Pure functions: a question + a response → a mark.
//
// Worked questions are never auto-marked here; they go to the AI pre-marker
// and then the teacher (the homework verification flow). Everything else is
// deterministic so a student gets instant, consistent feedback.
// ============================================================================

import type { MarkResult, Question, Response } from "./model";
import { numbersMatch, parseNumber } from "./numbers";

function unanswered(q: Question): MarkResult {
  return { status: "unanswered", score: 0, max: q.marks, feedback: "No answer given." };
}

/** Normalise free text for comparison: case, whitespace, unicode minus, trailing punctuation. */
export function normaliseShortText(text: string, caseInsensitive = true): string {
  let t = text
    .replace(/[−–—]/g, "-")
    .replace(/[   ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.;:!]+$/g, "")
    .trim();
  // Spaces around operators and equals are not meaning: "x = 5" ≡ "x=5".
  t = t.replace(/\s*([=+\-*/^(),])\s*/g, "$1");
  return caseInsensitive ? t.toLowerCase() : t;
}

export function markQuestion(q: Question, r: Response | null | undefined): MarkResult {
  if (!r) return unanswered(q);
  if (r.type !== q.type) {
    return { status: "incorrect", score: 0, max: q.marks, feedback: "Answer did not match the question type." };
  }

  switch (q.type) {
    case "mcq": {
      const key = r.type === "mcq" ? r.key : null;
      if (!key) return unanswered(q);
      const ok = key === q.answer;
      return {
        status: ok ? "correct" : "incorrect",
        score: ok ? q.marks : 0,
        max: q.marks,
        feedback: ok ? "Correct." : "Not quite — have another look at the options.",
      };
    }

    case "multi_select": {
      const keys = r.type === "multi_select" ? [...new Set(r.keys)] : [];
      if (keys.length === 0) return unanswered(q);
      const want = new Set(q.answers);
      const right = keys.filter((k) => want.has(k)).length;
      const wrong = keys.length - right;
      // Proportional credit with a penalty for wrong picks, floored at zero.
      const fraction = Math.max(0, (right - wrong) / Math.max(1, want.size));
      const score = round2(fraction * q.marks);
      const status = fraction >= 1 ? "correct" : score > 0 ? "partial" : "incorrect";
      return {
        status,
        score,
        max: q.marks,
        feedback:
          status === "correct"
            ? "Correct."
            : status === "partial"
              ? `${right} of ${want.size} right${wrong ? `, ${wrong} wrong pick${wrong > 1 ? "s" : ""}` : ""}.`
              : "Not quite — check which options actually hold.",
      };
    }

    case "numeric": {
      const text = r.type === "numeric" ? r.text : "";
      if (!text.trim()) return unanswered(q);
      const given = parseNumber(text);
      if (given === null) {
        return { status: "incorrect", score: 0, max: q.marks, feedback: "That is not a number we could read — try a decimal or a fraction." };
      }
      const ok = numbersMatch(given, q.answer, { tolerance: q.tolerance, tolerance_pct: q.tolerance_pct });
      return {
        status: ok ? "correct" : "incorrect",
        score: ok ? q.marks : 0,
        max: q.marks,
        feedback: ok ? "Correct." : "Not quite — check your working and the units.",
      };
    }

    case "short": {
      const text = r.type === "short" ? r.text : "";
      if (!text.trim()) return unanswered(q);
      const ci = q.case_insensitive ?? true;
      const given = normaliseShortText(text, ci);
      let ok = q.answers.some((a) => normaliseShortText(a, ci) === given);
      // Numeric equivalence: "0.5" ≡ "1/2" when both sides parse.
      if (!ok) {
        const g = parseNumber(text);
        if (g !== null) {
          ok = q.answers.some((a) => {
            const n = parseNumber(a);
            return n !== null && numbersMatch(g, n);
          });
        }
      }
      return {
        status: ok ? "correct" : "incorrect",
        score: ok ? q.marks : 0,
        max: q.marks,
        feedback: ok ? "Correct." : "Not quite — check the form of your answer.",
      };
    }

    case "worked": {
      const resp = r.type === "worked" ? r : null;
      const hasEvidence = Boolean(resp && resp.evidence.length > 0);
      const hasFinal = Boolean(resp?.final_answer?.trim());
      if (!hasEvidence && !hasFinal) return unanswered(q);
      // A quick final-answer check gives instant signal; marks wait for review.
      let feedback = "Submitted — your working will be marked.";
      if (hasFinal && q.final_answer) {
        const g = parseNumber(resp!.final_answer!);
        const a = parseNumber(q.final_answer);
        const match =
          g !== null && a !== null
            ? numbersMatch(g, a)
            : normaliseShortText(resp!.final_answer!) === normaliseShortText(q.final_answer);
        feedback = match
          ? "Final answer matches — your working will be marked."
          : "Final answer does not match — your working will be marked and may still earn method marks.";
      }
      return { status: "pending_review", score: 0, max: q.marks, feedback };
    }
  }
}

/** Total for a set: pending items count toward max but not score. */
export function markSet(items: { question: Question; response: Response | null }[]) {
  const results = items.map(({ question, response }) => markQuestion(question, response));
  const score = results.reduce((s, r) => s + r.score, 0);
  const max = results.reduce((s, r) => s + r.max, 0);
  const pending = results.filter((r) => r.status === "pending_review").length;
  const autoMax = results.filter((r) => r.status !== "pending_review").reduce((s, r) => s + r.max, 0);
  return {
    results,
    score: round2(score),
    max,
    pending,
    /** Accuracy over auto-marked items only, 0..1, or null when nothing was auto-marked. */
    auto_accuracy: autoMax > 0 ? round2(score / autoMax) : null,
  };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
