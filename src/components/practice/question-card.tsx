"use client";

import { useId } from "react";
import { Camera, Check, Loader2, NotebookPen, X } from "lucide-react";
import { MathMarkdown } from "@/components/practice/math-markdown";
import type { MarkResult, Question, Response } from "@/lib/practice/model";
import { cn } from "@/lib/utils";

/** The student-facing (and teacher-preview) rendering of one question with its answer control. */
export function QuestionCard({
  question,
  index,
  response,
  onChange,
  result,
  disabled,
  showSolution,
  onAttachNotebook,
  onAttachPhoto,
  attaching,
}: {
  question: Question;
  index?: number;
  response: Response | null;
  onChange: (r: Response) => void;
  result?: MarkResult | null;
  disabled?: boolean;
  /** After marking: reveal the worked solution (never before). */
  showSolution?: boolean;
  onAttachNotebook?: () => void;
  onAttachPhoto?: () => void;
  attaching?: boolean;
}) {
  const id = useId();
  const status = result?.status;
  const tone =
    status === "correct" ? "border-success/50 bg-success/5" : status === "incorrect" ? "border-destructive/40 bg-destructive/5" : status === "partial" ? "border-warning/50 bg-warning/5" : "border-border";

  return (
    <section className={cn("rounded-xl border bg-card p-4 shadow-sm transition-colors", tone)} aria-labelledby={`${id}-stem`}>
      <header className="mb-3 flex items-start gap-3">
        {index != null && (
          <span className="mt-0.5 flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full bg-secondary px-1.5 text-xs font-semibold text-muted-foreground">
            {index + 1}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div id={`${id}-stem`} className="text-[15px] leading-relaxed">
            <MathMarkdown source={question.stem} />
          </div>
          {question.image_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={question.image_url} alt="" className="mt-3 max-h-72 rounded-md border bg-white object-contain" />
          )}
        </div>
        <span className="shrink-0 text-xs text-muted-foreground">
          {question.marks} mark{question.marks === 1 ? "" : "s"}
        </span>
      </header>

      <div className="space-y-2">
        {question.type === "mcq" && (
          <ul className="space-y-1.5" role="radiogroup">
            {question.options.map((o) => {
              const chosen = response?.type === "mcq" && response.key === o.key;
              const isAnswer = showSolution && o.key === question.answer;
              return (
                <li key={o.key}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={chosen}
                    disabled={disabled}
                    onClick={() => onChange({ type: "mcq", key: o.key })}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                      chosen ? "border-primary bg-primary/10" : "hover:bg-secondary",
                      isAnswer && "ring-2 ring-success/60",
                      disabled && "cursor-default",
                    )}
                  >
                    <span className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold", chosen && "border-primary bg-primary text-primary-foreground")}>{o.key}</span>
                    <MathMarkdown source={o.text} inline className="min-w-0 flex-1" />
                    {isAnswer && <Check className="h-4 w-4 text-success" />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {question.type === "multi_select" && (
          <ul className="space-y-1.5">
            {question.options.map((o) => {
              const keys = response?.type === "multi_select" ? response.keys : [];
              const chosen = keys.includes(o.key);
              const isAnswer = showSolution && question.answers.includes(o.key);
              return (
                <li key={o.key}>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={chosen}
                    disabled={disabled}
                    onClick={() => onChange({ type: "multi_select", keys: chosen ? keys.filter((k) => k !== o.key) : [...keys, o.key] })}
                    className={cn("flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm transition-colors", chosen ? "border-primary bg-primary/10" : "hover:bg-secondary", isAnswer && "ring-2 ring-success/60")}
                  >
                    <span className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded border", chosen && "border-primary bg-primary text-primary-foreground")}>{chosen && <Check className="h-3.5 w-3.5" />}</span>
                    <MathMarkdown source={o.text} inline className="min-w-0 flex-1" />
                  </button>
                </li>
              );
            })}
            <li className="px-1 text-xs text-muted-foreground">Select all that apply.</li>
          </ul>
        )}

        {question.type === "numeric" && (
          <label className="flex items-center gap-2 text-sm">
            <span className="sr-only">Your answer</span>
            <input
              inputMode="decimal"
              disabled={disabled}
              value={response?.type === "numeric" ? response.text : ""}
              onChange={(e) => onChange({ type: "numeric", text: e.target.value })}
              placeholder="Your answer"
              className="w-40 rounded-md border bg-background px-3 py-2 tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-70"
            />
            {question.unit && <span className="text-muted-foreground">{question.unit}</span>}
          </label>
        )}

        {question.type === "short" && (
          <input
            disabled={disabled}
            value={response?.type === "short" ? response.text : ""}
            onChange={(e) => onChange({ type: "short", text: e.target.value })}
            placeholder="Your answer (e.g. x = 5)"
            className="w-full max-w-md rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-70"
          />
        )}

        {question.type === "worked" && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">{onAttachNotebook || onAttachPhoto ? "Show your working on the notebook or attach a photo, then give your final answer." : "Work it out on paper and give your final answer; your teacher marks the working."}</p>
            <div className="flex flex-wrap items-center gap-2">
              {onAttachNotebook && (
                <button
                  type="button"
                  disabled={disabled || attaching}
                  onClick={onAttachNotebook}
                  className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-secondary disabled:opacity-60"
                >
                  {attaching ? <Loader2 className="h-4 w-4 animate-spin" /> : <NotebookPen className="h-4 w-4" />} Work on notebook
                </button>
              )}
              {onAttachPhoto && (
                <button
                  type="button"
                  disabled={disabled || attaching}
                  onClick={onAttachPhoto}
                  className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-secondary disabled:opacity-60"
                >
                  <Camera className="h-4 w-4" /> Attach photo
                </button>
              )}
              {response?.type === "worked" && response.evidence.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  {response.evidence.length} attachment{response.evidence.length > 1 ? "s" : ""}
                </span>
              )}
            </div>
            <input
              disabled={disabled}
              value={response?.type === "worked" ? (response.final_answer ?? "") : ""}
              onChange={(e) => onChange({ type: "worked", final_answer: e.target.value, evidence: response?.type === "worked" ? response.evidence : [] })}
              placeholder="Final answer"
              className="w-full max-w-md rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-70"
            />
          </div>
        )}
      </div>

      {result && result.status !== "unanswered" && (
        <footer className="mt-3 flex items-start gap-2 text-sm">
          {result.status === "correct" ? (
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" />
          ) : result.status === "pending_review" ? (
            <Loader2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <X className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          )}
          <div className="min-w-0">
            <p className={cn(result.status === "correct" ? "text-success" : result.status === "incorrect" ? "text-destructive" : "text-muted-foreground")}>
              {result.feedback}
              {result.status !== "pending_review" && (
                <span className="ml-2 text-xs text-muted-foreground">
                  {result.score}/{result.max}
                </span>
              )}
            </p>
            {showSolution && question.type === "numeric" && Number.isFinite(question.answer) && (
              <p className="mt-1 text-xs text-muted-foreground">
                Answer: <span className="font-medium text-foreground">{question.answer}{question.unit ? ` ${question.unit}` : ""}</span>
              </p>
            )}
            {showSolution && question.type === "short" && question.answers[0] && (
              <p className="mt-1 text-xs text-muted-foreground">
                Answer: <span className="font-medium text-foreground">{question.answers[0]}</span>
              </p>
            )}
            {showSolution && question.worked_solution && (
              <details className="mt-1.5 rounded-md bg-secondary/60 p-2 text-sm">
                <summary className="cursor-pointer text-xs font-medium text-muted-foreground">Worked solution</summary>
                <div className="mt-1">
                  <MathMarkdown source={question.worked_solution} />
                </div>
              </details>
            )}
          </div>
        </footer>
      )}
    </section>
  );
}
