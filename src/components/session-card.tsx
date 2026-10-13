import Link from "next/link";
import { BookOpen, Eye, UserRound, Video } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { formatRange, tzAbbrev, dayLabel } from "@/lib/time";
import { lessonEndISO, lessonIsLive, roomIsOpen } from "@/lib/lessons/window";
import { cn } from "@/lib/utils";
import type { OnlineLesson } from "@/lib/types";

type Perspective = "office" | "teacher" | "student" | "parent";

/** One online lesson (a my_online_lessons row) as a card, with the room link its seat allows. */
export function LessonCard({
  lesson,
  viewerTz,
  perspective,
  showDay = false,
  action,
  footer,
}: {
  lesson: OnlineLesson;
  viewerTz: string;
  perspective: Perspective;
  showDay?: boolean;
  /** Replaces the room link; null for nothing at all. */
  action?: React.ReactNode;
  /** A row under the body (the teacher's report links). */
  footer?: React.ReactNode;
}) {
  const live = lessonIsLive(lesson);
  const endISO = lessonEndISO(lesson);
  // A parent's "family" seat has no place in a 1-1 lesson; everyone else may
  // enter while room_access would give them a seat.
  const canEnter = lesson.seat !== "family" && roomIsOpen(lesson);
  const observer = lesson.seat === "observer";

  return (
    <div
      className={cn(
        "flex flex-col gap-4 rounded-xl border bg-card p-4 shadow-sm transition-colors sm:flex-row sm:flex-wrap sm:items-center",
        live && "border-success/40 ring-1 ring-success/20",
      )}
    >
      {/* Time gutter */}
      <div className="flex shrink-0 flex-col sm:w-32">
        {showDay && <span className="text-xs font-medium text-muted-foreground">{dayLabel(lesson.effective_start, viewerTz)}</span>}
        <span className="text-sm font-semibold tabular-nums">{formatRange(lesson.effective_start, endISO, viewerTz)}</span>
        <span className="text-xs text-muted-foreground">{tzAbbrev(viewerTz, lesson.effective_start)}</span>
      </div>

      {/* Body */}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{lesson.subject ?? "Online lesson"}</span>
          {live ? (
            <Badge variant="success">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
              </span>
              Live now
            </Badge>
          ) : (
            <StatusBadge status={lesson.status} />
          )}
        </div>
        {lesson.topic && (
          <p className="mt-0.5 line-clamp-1 flex items-center gap-1.5 text-sm text-muted-foreground">
            <BookOpen className="h-3.5 w-3.5 shrink-0" />
            {lesson.topic}
          </p>
        )}

        <div className="mt-2.5 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          {perspective !== "student" && (
            <span className="flex items-center gap-1.5">
              <Avatar name={lesson.student_name} size={22} />
              <span className="text-muted-foreground">{lesson.student_name}</span>
            </span>
          )}
          {perspective !== "teacher" &&
            (lesson.teacher_name ? (
              <span className="flex items-center gap-1.5">
                <Avatar name={lesson.teacher_name} size={22} />
                <span className="text-muted-foreground">{lesson.teacher_name}</span>
              </span>
            ) : (
              // Neutral, never a warning: staffing is decided in the room on the day.
              <Badge variant="secondary" className="gap-1">
                <UserRound className="h-3 w-3" /> No teacher added
              </Badge>
            ))}
        </div>
      </div>

      {/* Action */}
      <div className="flex shrink-0 items-center gap-2 sm:flex-col sm:items-end">
        {action !== undefined
          ? action
          : canEnter ? (
            <Button asChild size="sm" variant={live ? "success" : "default"}>
              <Link href={`/lesson/${lesson.session_id}`}>
                {observer ? <Eye className="h-4 w-4" /> : <Video className="h-4 w-4" />}
                {observer ? "Observe" : live ? "Join now" : "Open room"}
              </Link>
            </Button>
          ) : null}
      </div>
      {footer && <div className="border-t pt-3 sm:basis-full">{footer}</div>}
    </div>
  );
}
