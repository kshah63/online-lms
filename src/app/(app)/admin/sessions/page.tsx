import { CalendarClock } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { SessionCard } from "@/components/session-card";
import { EmptyState } from "@/components/empty-state";
import { ScheduleDialog } from "@/components/admin/schedule-dialog";
import { AssignControl } from "@/components/admin/assign-control";
import { BookingActions } from "@/components/booking-actions";
import { requireRole } from "@/lib/data/auth";
import { getUpcomingForProfile } from "@/lib/data/sessions";
import { listCourses, listStudents, listTeachers } from "@/lib/data/people";

export default async function AdminSessionsPage() {
  const admin = await requireRole("admin");

  const [sessions, courses, students, teachers] = await Promise.all([
    getUpcomingForProfile(admin, 50),
    listCourses(),
    listStudents(),
    listTeachers(),
  ]);

  return (
    <div>
      <PageHeader
        title="Sessions"
        description="Schedule one-off or recurring lessons and assign a teacher to each."
        actions={
          <ScheduleDialog courses={courses} students={students} teachers={teachers} defaultTz={admin.timezone} />
        }
      />

      {sessions.length === 0 ? (
        <EmptyState
          icon={<CalendarClock className="h-5 w-5" />}
          title="No upcoming sessions"
          description="Schedule the first lesson to get started."
        />
      ) : (
        <div className="space-y-3">
          {sessions.map((s) => (
            <SessionCard
              key={s.id}
              session={s}
              viewerTz={admin.timezone}
              perspective="admin"
              showDay
              action={
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
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
