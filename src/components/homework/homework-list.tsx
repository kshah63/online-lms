import Link from "next/link";
import { Clock, PenLine } from "lucide-react";
import { DateTime } from "luxon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { HomeworkMarks } from "@/components/homework/homework-marks";
import { cn } from "@/lib/utils";
import type { HomeworkStatus } from "@/lib/types";

export interface HomeworkItem {
  id: string;
  description: string;
  course_name: string;
  due_at: string | null;
  status: HomeworkStatus;
  student_name?: string;
  mark_correct?: number | null;
  mark_incorrect?: number | null;
  mark_not_done?: number | null;
  feedback?: string | null;
}

const STATUS: Record<HomeworkStatus, { label: string; variant: React.ComponentProps<typeof Badge>["variant"] }> = {
  assigned: { label: "To do", variant: "secondary" },
  submitted: { label: "Submitted", variant: "default" },
  completed: { label: "Verified", variant: "success" },
  incomplete: { label: "Redo", variant: "warning" },
};

export function HomeworkList({
  items,
  viewerTz,
  canOpen = true,
  showStudent = false,
}: {
  items: HomeworkItem[];
  viewerTz: string;
  canOpen?: boolean;
  showStudent?: boolean;
}) {
  return (
    <div className="space-y-2.5">
      {items.map((hw) => {
        const done = hw.status === "completed";
        const submitted = hw.status === "submitted";
        const overdue =
          !done && !submitted && hw.due_at != null && hw.due_at < new Date().toISOString();
        const badge = overdue ? { label: "Overdue", variant: "warning" as const } : STATUS[hw.status];

        return (
          <div
            key={hw.id}
            className={cn("flex items-start gap-3 rounded-xl border bg-card p-3 shadow-sm", done && "opacity-70")}
          >
            <div className="min-w-0 flex-1">
              <div className={cn("text-sm font-medium", done && "line-through")}>{hw.description}</div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span>{hw.course_name}</span>
                {showStudent && hw.student_name && <span>· {hw.student_name}</span>}
                {hw.due_at && (
                  <span className={cn("flex items-center gap-1", overdue && "font-medium text-warning-foreground")}>
                    <Clock className="h-3 w-3" />
                    due {DateTime.fromISO(hw.due_at, { zone: "utc" }).setZone(viewerTz).toFormat("d LLL")}
                  </span>
                )}
              </div>
              {(done || hw.status === "incomplete") &&
                (hw.mark_correct != null || hw.mark_incorrect != null || hw.mark_not_done != null) && (
                  <div className="mt-1.5">
                    <HomeworkMarks
                      correct={hw.mark_correct ?? null}
                      incorrect={hw.mark_incorrect ?? null}
                      notDone={hw.mark_not_done ?? null}
                    />
                  </div>
                )}
              {hw.feedback && (done || hw.status === "incomplete") && (
                <p className="mt-1 text-xs text-muted-foreground">“{hw.feedback}”</p>
              )}
            </div>
            <Badge variant={badge.variant}>{badge.label}</Badge>
            {canOpen && (
              <Button asChild size="sm" variant={done || submitted ? "outline" : "default"}>
                <Link href={`/hw/${hw.id}`}>
                  <PenLine className="h-4 w-4" />
                  {done || submitted ? "View" : "Open"}
                </Link>
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}
