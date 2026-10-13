"use client";

import { useCallback, useMemo, useState } from "react";
import { CheckCircle2, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { QuestionCard } from "@/components/practice/question-card";
import { markSet } from "@/lib/practice/marking";
import type { MarkResult, Question, Response } from "@/lib/practice/model";
import { cn } from "@/lib/utils";

export type PracticeMode = "practice" | "test";

/**
 * Runs a set of questions. In PRACTICE mode each question is marked as the
 * student checks it, with the solution revealed afterwards. In TEST mode
 * nothing is marked until the whole set is submitted and no solution is shown
 * (the teacher releases results). Persistence is the caller's: `onSubmit`
 * receives every response plus the client-side marks; worked questions stay
 * pending until a human marks them.
 */
export function PracticeRunner({
  questions,
  mode,
  initialResponses,
  onSubmit,
  onAttachNotebook,
  onAttachPhoto,
  submitting,
  submitted,
  title,
  footerSlot,
}: {
  questions: Question[];
  mode: PracticeMode;
  initialResponses?: Record<string, Response>;
  onSubmit: (payload: { responses: Record<string, Response | null>; marks: Record<string, MarkResult> }) => void | Promise<void>;
  onAttachNotebook?: (questionId: string) => void;
  onAttachPhoto?: (questionId: string) => void;
  submitting?: boolean;
  submitted?: boolean;
  title?: string;
  footerSlot?: React.ReactNode;
}) {
  const [responses, setResponses] = useState<Record<string, Response | null>>(() => ({ ...(initialResponses ?? {}) }));
  const [checked, setChecked] = useState<Record<string, MarkResult>>({});
  const [cursor, setCursor] = useState(0);
  const onePerPage = mode === "test";

  const setResponse = useCallback((id: string, r: Response) => {
    setResponses((prev) => ({ ...prev, [id]: r }));
    if (mode === "practice") setChecked((prev) => (prev[id] ? omit(prev, id) : prev));
  }, [mode]);

  const check = useCallback(
    (q: Question) => {
      const { results } = markSet([{ question: q, response: responses[q.id] ?? null }]);
      setChecked((prev) => ({ ...prev, [q.id]: results[0]! }));
    },
    [responses],
  );

  const answered = useMemo(() => questions.filter((q) => isAnswered(responses[q.id] ?? null)).length, [questions, responses]);

  async function submitAll() {
    const set = markSet(questions.map((q) => ({ question: q, response: responses[q.id] ?? null })));
    const marks: Record<string, MarkResult> = {};
    questions.forEach((q, i) => (marks[q.id] = set.results[i]!));
    if (mode === "practice") setChecked(marks);
    await onSubmit({ responses, marks });
  }

  const visible = onePerPage ? [questions[cursor]!].filter(Boolean) : questions;

  return (
    <div className="space-y-4">
      {(title || onePerPage) && (
        <div className="flex items-center justify-between gap-3">
          {title && <h2 className="text-base font-semibold">{title}</h2>}
          <span className="text-xs text-muted-foreground">
            {answered}/{questions.length} answered
          </span>
        </div>
      )}

      {onePerPage && (
        <ol className="flex flex-wrap gap-1" aria-label="Questions">
          {questions.map((q, i) => (
            <li key={q.id}>
              <button
                type="button"
                onClick={() => setCursor(i)}
                className={cn(
                  "h-7 min-w-7 rounded-md border px-1.5 text-xs tabular-nums",
                  i === cursor ? "border-primary bg-primary text-primary-foreground" : isAnswered(responses[q.id] ?? null) ? "bg-secondary" : "",
                )}
                aria-current={i === cursor ? "step" : undefined}
              >
                {i + 1}
              </button>
            </li>
          ))}
        </ol>
      )}

      {visible.map((q) => {
        const index = questions.indexOf(q);
        const result = checked[q.id] ?? null;
        return (
          <div key={q.id} className="space-y-2">
            <QuestionCard
              question={q}
              index={index}
              response={responses[q.id] ?? null}
              onChange={(r) => setResponse(q.id, r)}
              result={mode === "practice" ? result : null}
              disabled={submitted || submitting || (mode === "practice" && Boolean(result) && result!.status !== "pending_review" && result!.status !== "unanswered")}
              showSolution={mode === "practice" && Boolean(result) && result!.status !== "unanswered"}
              onAttachNotebook={onAttachNotebook ? () => onAttachNotebook(q.id) : undefined}
              onAttachPhoto={onAttachPhoto ? () => onAttachPhoto(q.id) : undefined}
            />
            {mode === "practice" && !submitted && (!result || result.status === "unanswered") && (
              <div className="flex justify-end">
                <Button size="sm" variant="outline" onClick={() => check(q)} disabled={!isAnswered(responses[q.id] ?? null)}>
                  Check answer
                </Button>
              </div>
            )}
          </div>
        );
      })}

      <div className="flex items-center justify-between gap-3 border-t pt-3">
        {onePerPage ? (
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setCursor((c) => Math.max(0, c - 1))} disabled={cursor === 0}>
              <ChevronLeft className="h-4 w-4" /> Previous
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setCursor((c) => Math.min(questions.length - 1, c + 1))} disabled={cursor >= questions.length - 1}>
              Next <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-3">
          {footerSlot}
          {submitted ? (
            <span className="inline-flex items-center gap-1.5 text-sm text-success">
              <CheckCircle2 className="h-4 w-4" /> Submitted
            </span>
          ) : (
            <Button onClick={submitAll} disabled={submitting || answered === 0}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {mode === "test" ? "Submit test" : "Finish practice"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function isAnswered(r: Response | null): boolean {
  if (!r) return false;
  switch (r.type) {
    case "mcq":
      return Boolean(r.key);
    case "multi_select":
      return r.keys.length > 0;
    case "numeric":
    case "short":
      return r.text.trim().length > 0;
    case "worked":
      return r.evidence.length > 0 || Boolean(r.final_answer?.trim());
  }
}

function omit<T extends Record<string, unknown>>(obj: T, key: string): T {
  const next = { ...obj };
  delete next[key];
  return next;
}
