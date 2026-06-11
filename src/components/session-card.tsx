import Link from "next/link";
import { BookOpen, UserRound, Video } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { formatRange, tzAbbrev, dayLabel } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { SessionView } from "@/lib/types";

type Perspective = "admin" | "teacher" | "student" | "parent";

export function SessionCard({
  session,
  viewerTz,
  perspective,
  showDay = false,
  action,
}: {
  session: SessionView;
  viewerTz: string;
  perspective: Perspective;
  showDay?: boolean;
  action?: React.ReactNode;
}) {
  const unassigned = !session.teacher;
  const live = session.status === "in_progress";
  const joinable = live || session.status === "confirmed" || session.status === "scheduled";

  return (
    <div
      className={cn(
        "flex flex-col gap-4 rounded-xl border bg-card p-4 shadow-sm transition-colors sm:flex-row sm:items-center",
        live && "border-success/40 ring-1 ring-success/20",
      )}
    >
      {/* Time gutter */}
      <div className="flex shrink-0 flex-col sm:w-32">
        {showDay && (
          <span className="text-xs font-medium text-muted-foreground">{dayLabel(session.scheduled_start, viewerTz)}</span>
        )}
        <span className="text-sm font-semibold tabular-nums">
          {formatRange(session.scheduled_start, session.scheduled_end, viewerTz)}
        </span>
        <span className="text-xs text-muted-foreground">{tzAbbrev(viewerTz, session.scheduled_start)}</span>
      </div>

      {/* Body */}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{session.course.name}</span>
          <StatusBadge status={session.status} />
        </div>
        {session.agenda && (
          <p className="mt-0.5 line-clamp-1 flex items-center gap-1.5 text-sm text-muted-foreground">
            <BookOpen className="h-3.5 w-3.5 shrink-0" />
            {session.agenda}
          </p>
        )}

        <div className="mt-2.5 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          {perspective !== "student" && (
            <span className="flex items-center gap-1.5">
              <Avatar name={session.student.display_name} src={session.student.avatar_url} size={22} />
              <span className="text-muted-foreground">{session.student.display_name}</span>
            </span>
          )}
          {perspective !== "teacher" &&
            (unassigned ? (
              <Badge variant="warning" className="gap-1">
                <UserRound className="h-3 w-3" /> Unassigned
              </Badge>
            ) : (
              <span className="flex items-center gap-1.5">
                <Avatar name={session.teacher!.display_name} src={session.teacher!.avatar_url} size={22} />
                <span className="text-muted-foreground">{session.teacher!.display_name}</span>
              </span>
            ))}
        </div>
      </div>

      {/* Action */}
      <div className="flex shrink-0 items-center gap-2 sm:flex-col sm:items-end">
        {action ??
          (perspective === "teacher" && joinable ? (
            <Button asChild size="sm" variant={live ? "success" : "default"}>
              <Link href={`/lesson/${session.id}`}>
                <Video className="h-4 w-4" />
                {live ? "Join now" : "Open room"}
              </Link>
            </Button>
          ) : live && (perspective === "student" || perspective === "parent") ? (
            <Button asChild size="sm" variant="success">
              <Link href={`/lesson/${session.id}`}>
                <Video className="h-4 w-4" /> Join
              </Link>
            </Button>
          ) : null)}
      </div>
    </div>
  );
}
