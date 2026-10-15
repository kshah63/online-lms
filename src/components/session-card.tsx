import Link from "next/link";
import { BookOpen, Disc3, MicOff, Radio, UserRound, Video } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { formatRange, tzAbbrev, dayLabel, withinJoinWindow } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { SessionView } from "@/lib/types";

type Perspective = "admin" | "teacher" | "student" | "parent";

/**
 * Recording indicator for the lesson's student: "on" = recorded (audio +
 * board) — callers pass it only once institution recording is actually on
 * (recordingActive(), Phase 2); "off" = the family opted out. Omit when unknown
 * or when nothing is being recorded yet, and no indicator is shown.
 */
export type RecordingIndicator = "on" | "off";

export function SessionCard({
  session,
  viewerTz,
  perspective,
  showDay = false,
  action,
  recording,
}: {
  session: SessionView;
  viewerTz: string;
  perspective: Perspective;
  showDay?: boolean;
  action?: React.ReactNode;
  recording?: RecordingIndicator;
}) {
  const unassigned = !session.teacher;
  const live = session.status === "in_progress";
  const joinable = live || session.status === "confirmed" || session.status === "scheduled";
  // Students can enter from ~10 min before start (waiting room) so they don't
  // depend on the teacher having flipped the lesson "live".
  const studentCanJoin =
    live ||
    ((session.status === "scheduled" || session.status === "confirmed") &&
      withinJoinWindow(session.scheduled_start, session.scheduled_end));
  const showRecording =
    recording !== undefined && session.status !== "cancelled" && session.status !== "no_show";

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
          {showRecording && <RecordingChip recording={recording!} completed={session.status === "completed"} />}
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
                {live ? "Join now" : "Open classroom"}
              </Link>
            </Button>
          ) : perspective === "student" && studentCanJoin ? (
            <Button asChild size="sm" variant={live ? "success" : "default"}>
              <Link href={`/lesson/${session.id}`}>
                <Video className="h-4 w-4" /> {live ? "Join" : "Join early"}
              </Link>
            </Button>
          ) : perspective === "parent" ? (
            <ParentStatus session={session} canJoin={studentCanJoin} />
          ) : null)}
      </div>
    </div>
  );
}

/**
 * Parents have no Pencil user and no seat in the room (owner decision 3): they
 * get lesson STATUS, never a Join button. A live lesson links to the status
 * card on /lesson/[id] (teacher, elapsed time, recording status).
 */
export function ParentStatus({ session, canJoin }: { session: SessionView; canJoin: boolean }) {
  if (session.status === "in_progress") {
    return (
      <Button asChild size="sm" variant="outline">
        <Link href={`/lesson/${session.id}`}>
          <Radio className="h-4 w-4 text-success" /> Lesson in progress
        </Link>
      </Button>
    );
  }
  if (canJoin) {
    return <span className="text-xs text-muted-foreground">Starting soon</span>;
  }
  return null;
}

/** Small "Recorded (audio + board)" / "Not recorded" indicator (plan decision d). */
export function RecordingChip({ recording, completed }: { recording: RecordingIndicator; completed: boolean }) {
  if (recording === "off") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" title="The family opted out of recording">
        <MicOff className="h-3 w-3" /> Not recorded
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 text-xs text-muted-foreground"
      title="Lessons are recorded (audio + whiteboard) for the teacher's coaching and the lesson report"
    >
      <Disc3 className="h-3 w-3" /> {completed ? "Recorded" : "Recorded (audio + board)"}
    </span>
  );
}
