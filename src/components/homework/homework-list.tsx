"use client";

import { useTransition } from "react";
import { CheckCircle2, Circle, Clock } from "lucide-react";
import { DateTime } from "luxon";
import { Badge } from "@/components/ui/badge";
import { setHomeworkStatus } from "@/lib/actions/homework";
import { cn } from "@/lib/utils";
import type { HomeworkStatus } from "@/lib/types";

export interface HomeworkItem {
  id: string;
  description: string;
  course_name: string;
  due_at: string | null;
  status: HomeworkStatus;
  student_name?: string;
}

export function HomeworkList({
  items,
  viewerTz,
  canMark,
  showStudent = false,
}: {
  items: HomeworkItem[];
  viewerTz: string;
  canMark: boolean;
  showStudent?: boolean;
}) {
  return (
    <div className="space-y-2.5">
      {items.map((hw) => (
        <HomeworkRow key={hw.id} hw={hw} viewerTz={viewerTz} canMark={canMark} showStudent={showStudent} />
      ))}
    </div>
  );
}

function HomeworkRow({
  hw,
  viewerTz,
  canMark,
  showStudent,
}: {
  hw: HomeworkItem;
  viewerTz: string;
  canMark: boolean;
  showStudent: boolean;
}) {
  const [pending, start] = useTransition();
  const done = hw.status === "completed";
  const overdue = !done && hw.due_at != null && hw.due_at < new Date().toISOString();

  function toggle() {
    if (!canMark) return;
    start(() => setHomeworkStatus(hw.id, done ? "assigned" : "completed"));
  }

  return (
    <div className={cn("flex items-start gap-3 rounded-xl border bg-card p-3 shadow-sm", done && "opacity-70")}>
      <button
        onClick={toggle}
        disabled={!canMark || pending}
        className={cn("mt-0.5 shrink-0", canMark ? "cursor-pointer" : "cursor-default")}
        aria-label={done ? "Mark not done" : "Mark done"}
      >
        {done ? (
          <CheckCircle2 className="h-5 w-5 text-success" />
        ) : (
          <Circle className={cn("h-5 w-5", overdue ? "text-warning-foreground" : "text-muted-foreground")} />
        )}
      </button>
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
      </div>
      {done ? (
        <Badge variant="success">Done</Badge>
      ) : overdue ? (
        <Badge variant="warning">Overdue</Badge>
      ) : (
        <Badge variant="secondary">To do</Badge>
      )}
    </div>
  );
}
