import Link from "next/link";
import { CalendarClock, History, Timer } from "lucide-react";
import { DateTime } from "luxon";
import { PageHeader } from "@/components/page-header";
import { SessionCard } from "@/components/session-card";
import { EmptyState } from "@/components/empty-state";
import { ScheduleDialog } from "@/components/admin/schedule-dialog";
import { AssignControl } from "@/components/admin/assign-control";
import { BookingActions } from "@/components/booking-actions";
import { SessionFilters } from "@/components/admin/session-filters";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { requireRole } from "@/lib/data/auth";
import { getPastForProfile, getUpcomingForProfile } from "@/lib/data/sessions";
import { listCourses, listStudents, listTeachers } from "@/lib/data/people";
import type { SessionView } from "@/lib/types";

const PAST_STATUSES = [
  { id: "completed", label: "Completed" },
  { id: "no_show", label: "No-show" },
  { id: "cancelled", label: "Cancelled" },
];
const UPCOMING_STATUSES = [
  { id: "scheduled", label: "Scheduled" },
  { id: "confirmed", label: "Confirmed" },
  { id: "in_progress", label: "Live now" },
  { id: "unassigned", label: "Unassigned" },
];

/** "52 min" actual lesson time, when both join times were captured. */
function actualDuration(s: SessionView): string | null {
  if (!s.actual_start || !s.actual_end) return null;
  const mins = Math.max(
    1,
    Math.round(DateTime.fromISO(s.actual_end).diff(DateTime.fromISO(s.actual_start), "minutes").minutes),
  );
  return `${mins} min`;
}

function bookedDuration(s: SessionView): string {
  const mins = Math.round(
    DateTime.fromISO(s.scheduled_end).diff(DateTime.fromISO(s.scheduled_start), "minutes").minutes,
  );
  return `${mins} min`;
}

export default async function AdminSessionsPage({
  searchParams,
}: {
  searchParams: { view?: string; student?: string; course?: string; status?: string; date?: string; focus?: string };
}) {
  const admin = await requireRole("admin");
  const isPast = searchParams.view === "past";

  const [sessions, courses, students, teachers] = await Promise.all([
    isPast ? getPastForProfile(admin, 200) : getUpcomingForProfile(admin, 200),
    listCourses(),
    listStudents(),
    listTeachers(),
  ]);

  // ----- Combinable filters from the URL ------------------------------------
  const visible = sessions.filter((s) => {
    if (searchParams.student && s.student_id !== searchParams.student) return false;
    if (searchParams.course && s.course_id !== searchParams.course) return false;
    if (searchParams.status === "unassigned") {
      if (s.teacher_id) return false;
    } else if (searchParams.status && s.status !== searchParams.status) {
      return false;
    }
    if (searchParams.date) {
      const localDay = DateTime.fromISO(s.scheduled_start, { zone: "utc" })
        .setZone(admin.timezone)
        .toISODate();
      if (localDay !== searchParams.date) return false;
    }
    return true;
  });

  const keepFilters = new URLSearchParams();
  for (const k of ["student", "course", "date"] as const) {
    if (searchParams[k]) keepFilters.set(k, searchParams[k]!);
  }
  // A status from one tab makes no sense on the other — it's dropped on switch.
  const tabHref = (view: "upcoming" | "past") => {
    const params = new URLSearchParams(keepFilters);
    if (view === "past") params.set("view", "past");
    const qs = params.toString();
    return qs ? `/admin/sessions?${qs}` : "/admin/sessions";
  };
  const tab = (active: boolean) =>
    cn(
      "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
      active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground",
    );

  return (
    <div>
      <PageHeader
        title="Sessions"
        description={
          isPast
            ? "Past lessons — completed, no-shows and cancellations, with the time a lesson actually ran."
            : "Schedule one-off or recurring lessons and assign a teacher to each."
        }
        actions={
          <ScheduleDialog courses={courses} students={students} teachers={teachers} defaultTz={admin.timezone} />
        }
      />

      {/* Upcoming / Past toggle */}
      <div className="mb-4 inline-flex items-center gap-1 rounded-xl border bg-card p-1">
        <Link href={tabHref("upcoming")} className={tab(!isPast)}>
          <CalendarClock className="h-4 w-4" /> Upcoming
        </Link>
        <Link href={tabHref("past")} className={tab(isPast)}>
          <History className="h-4 w-4" /> Past
        </Link>
      </div>

      <SessionFilters
        students={students.map((s) => ({ id: s.id, label: s.display_name }))}
        courses={courses.map((c) => ({ id: c.id, label: c.name }))}
        statuses={isPast ? PAST_STATUSES : UPCOMING_STATUSES}
      />

      <p className="mb-3 text-xs text-muted-foreground">
        {visible.length} {visible.length === 1 ? "lesson" : "lessons"}
        {visible.length !== sessions.length && ` (of ${sessions.length})`}
      </p>

      {visible.length === 0 ? (
        <EmptyState
          icon={<CalendarClock className="h-5 w-5" />}
          title={isPast ? "No past lessons match" : "No upcoming sessions match"}
          description="Adjust or clear the filters above, or schedule a new lesson."
        />
      ) : (
        <div className="space-y-3">
          {visible.map((s) => {
            const actual = actualDuration(s);
            return (
              <SessionCard
                key={s.id}
                session={s}
                viewerTz={admin.timezone}
                perspective="admin"
                showDay
                action={
                  isPast ? (
                    <div className="flex flex-col items-end gap-1.5 text-right">
                      <Badge
                        variant={s.status === "completed" ? "success" : s.status === "cancelled" ? "secondary" : "warning"}
                        className="capitalize"
                      >
                        {s.status.replace(/_/g, " ")}
                      </Badge>
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Timer className="h-3.5 w-3.5" />
                        {actual ? (
                          <>
                            ran <span className="font-medium text-foreground">{actual}</span>
                            <span>· booked {bookedDuration(s)}</span>
                          </>
                        ) : (
                          <>booked {bookedDuration(s)} · actual not recorded</>
                        )}
                      </span>
                    </div>
                  ) : (
                    <div className="flex flex-col items-end gap-2">
                      <AssignControl sessionId={s.id} teachers={teachers} currentTeacherId={s.teacher_id} />
                      <BookingActions
                        sessionId={s.id}
                        startISO={s.scheduled_start}
                        endISO={s.scheduled_end}
                        studentName={s.student.display_name}
                        courseName={s.course.name}
                        viewerTz={admin.timezone}
                      />
                    </div>
                  )
                }
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
