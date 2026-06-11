import { Check, Minus, X } from "lucide-react";

/** Compact, quantifiable homework result for students/parents. */
export function HomeworkMarks({
  correct,
  incorrect,
  notDone,
}: {
  correct: number | null;
  incorrect: number | null;
  notDone: number | null;
}) {
  if (correct == null && incorrect == null && notDone == null) return null;
  return (
    <span className="flex flex-wrap items-center gap-2.5 text-xs font-medium">
      <span className="flex items-center gap-1 text-success">
        <Check className="h-3.5 w-3.5" />
        {correct ?? 0} correct
      </span>
      <span className="flex items-center gap-1 text-destructive">
        <X className="h-3.5 w-3.5" />
        {incorrect ?? 0} incorrect
      </span>
      <span className="flex items-center gap-1 text-warning-foreground">
        <Minus className="h-3.5 w-3.5" />
        {notDone ?? 0} not done
      </span>
    </span>
  );
}
