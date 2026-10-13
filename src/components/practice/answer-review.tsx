"use client";

import { QuestionCard } from "@/components/practice/question-card";
import { toMarkResult, toQuestion, toResponse, type AttemptQuestionRow } from "@/lib/practice/attempts";

/** A reviewer's read-only view of an attempt's answers: each card with the student's response, the mark and the answer key. */
export function AnswerReview({ rows, imageUrls }: { rows: AttemptQuestionRow[]; imageUrls?: Record<string, string> }) {
  return (
    <div className="space-y-3">
      {rows.map((r, i) => (
        <QuestionCard
          key={r.id}
          question={toQuestion(r, r.image_path ? (imageUrls?.[r.image_path] ?? null) : null)}
          index={i}
          response={toResponse(r)}
          onChange={() => undefined}
          result={toMarkResult(r)}
          disabled
          showSolution
        />
      ))}
    </div>
  );
}
