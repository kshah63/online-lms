import { cn } from "@/lib/utils";
import type { TeacherFeedback } from "@/lib/coaching/analyze";

const LABELS: { key: keyof TeacherFeedback["dimension_scores"]; label: string }[] = [
  { key: "engagement", label: "Engagement" },
  { key: "questioning", label: "Questioning" },
  { key: "clarity", label: "Clarity" },
  { key: "rapport", label: "Rapport" },
];

export function ScoreBars({ scores }: { scores: TeacherFeedback["dimension_scores"] }) {
  return (
    <div className="space-y-2.5">
      {LABELS.map(({ key, label }) => {
        const value = scores[key] ?? 0;
        return (
          <div key={key} className="flex items-center gap-3">
            <span className="w-24 shrink-0 text-sm text-muted-foreground">{label}</span>
            <div className="flex flex-1 gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <span
                  key={n}
                  className={cn(
                    "h-2 flex-1 rounded-full",
                    n <= value
                      ? value >= 4
                        ? "bg-success"
                        : value >= 3
                          ? "bg-primary"
                          : "bg-warning"
                      : "bg-secondary",
                  )}
                />
              ))}
            </div>
            <span className="w-6 text-right text-sm font-semibold tabular-nums">{value}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Tiny sparkline-style bar series for a 0..1 metric over time (oldest → newest). */
export function TrendBars({
  values,
  format = (v) => `${Math.round(v * 100)}%`,
}: {
  values: number[];
  format?: (v: number) => string;
}) {
  const max = Math.max(...values, 0.0001);
  return (
    <div className="flex items-end gap-1.5">
      {values.map((v, i) => (
        <div key={i} className="flex flex-1 flex-col items-center gap-1">
          <span className="text-[10px] text-muted-foreground">{i === values.length - 1 ? format(v) : ""}</span>
          <div className="flex h-16 w-full items-end rounded bg-secondary/60">
            <div
              className={cn("w-full rounded", i === values.length - 1 ? "bg-primary" : "bg-primary/40")}
              style={{ height: `${Math.max(8, (v / max) * 100)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
