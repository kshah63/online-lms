import { Badge } from "@/components/ui/badge";
import { practiceState, practiceStateLabel, type PracticeRow } from "@/lib/practice/attempts";

const VARIANT: Record<ReturnType<typeof practiceState>, React.ComponentProps<typeof Badge>["variant"]> = {
  not_started: "outline",
  in_progress: "default",
  submitted: "success",
  flagged: "destructive",
  void: "secondary",
};

/** The state of a my_practice row — not started / in progress / submitted · 7/10 / flagged · 3/6 / voided — as a chip. */
export function PracticeStateChip({ row }: { row: Pick<PracticeRow, "attempt_id" | "attempt_status" | "integrity_flagged" | "score" | "out_of"> }) {
  return <Badge variant={VARIANT[practiceState(row)]}>{practiceStateLabel(row)}</Badge>;
}
