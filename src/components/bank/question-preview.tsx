"use client";

import { Check } from "lucide-react";
import { MathMarkdown } from "@/components/practice/math-markdown";
import type { Question } from "@/lib/practice/model";
import { cn } from "@/lib/utils";

/** The question as a student would read it, with the answer marked for the reviewer. */
export function QuestionPreview({ question, imageUrl }: { question: Question; imageUrl?: string | null }) {
  const stem = question.stem.trim();
  return (
    <div className="space-y-3 rounded-xl border bg-card p-4 text-[15px] leading-relaxed">
      {stem ? <MathMarkdown source={stem} /> : <p className="text-sm text-muted-foreground">The stem renders here as you type — $x^2$ for maths.</p>}
      {imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imageUrl} alt="" className="max-h-64 rounded-md border bg-white object-contain" />
      )}
      {(question.type === "mcq" || question.type === "multi_select") && (
        <ul className="space-y-1.5 text-sm">
          {question.options.map((o) => {
            const right = question.type === "mcq" ? question.answer === o.key : question.answers.includes(o.key);
            return (
              <li key={o.key} className={cn("flex items-center gap-2 rounded-lg border px-3 py-1.5", right && "border-success/60 bg-success/5")}>
                <span className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-xs font-semibold", right && "border-success bg-success text-success-foreground")}>{o.key}</span>
                {o.text.trim() ? <MathMarkdown source={o.text} inline className="min-w-0 flex-1" /> : <span className="text-muted-foreground">…</span>}
                {right && <Check className="h-4 w-4 text-success" />}
              </li>
            );
          })}
        </ul>
      )}
      {question.type === "numeric" && (
        <p className="text-sm">
          <span className="text-muted-foreground">Answer:</span> <span className="font-medium tabular-nums">{question.answer}</span>
          {question.unit && <span className="ml-1 text-muted-foreground">{question.unit}</span>}
          {question.tolerance != null && <span className="ml-2 text-xs text-muted-foreground">± {question.tolerance}</span>}
        </p>
      )}
      {question.type === "short" && (
        <p className="text-sm">
          <span className="text-muted-foreground">Accepted:</span>{" "}
          {question.answers.map((a, i) => (
            <code key={i} className="mr-1.5 rounded bg-secondary px-1.5 py-0.5 text-xs">
              {a}
            </code>
          ))}
        </p>
      )}
      {question.type === "worked" && <p className="text-xs text-muted-foreground">Marked by a person: the student shows working on the notebook or a photo.</p>}
      {question.worked_solution && (
        <div className="rounded-md bg-secondary/60 p-3 text-sm">
          <div className="mb-1 text-xs font-medium text-muted-foreground">Worked solution</div>
          <MathMarkdown source={question.worked_solution} />
        </div>
      )}
    </div>
  );
}
