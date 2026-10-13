import Link from "next/link";
import { BookOpenCheck, CalendarDays, CheckCircle2, Radio, Video } from "lucide-react";
import { DateTime } from "luxon";
import { PageHeader, StatCard } from "@/components/page-header";
import { LessonCard } from "@/components/session-card";
import { EmptyState } from "@/components/empty-state";
import { ReportStateBadge, WriteReportLinks, canWriteReport } from "@/components/report-state-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireRole, viewerTimeZone } from "@/lib/data/auth";
import { listMyOnlineLessons } from "@/lib/data/lessons";
import { lessonEndISO, lessonIsLive, roomIsOpen } from "@/lib/lessons/window";
import { dayWindowUTC, formatRange } from "@/lib/time";
import { firstName, type OnlineLesson } from "@/lib/types";

/** The teacher's online lessons: my_online_lessons(14) rows where they are the host. */
export default async function TeacherTodayPage() {
  const teacher = await requireRole("teacher");
  const tz = viewerTimeZone(teacher);

  const lessons = (await listMyOnlineLessons(teacher, 14)).filter((l) => l.seat === "host");
  const { startUTC, endUTC } = dayWindowUTC(tz);
  const nowISO = new Date().toISOString();
  const today = lessons.filter((l) => l.effective_start >= startUTC && l.effective_start < endUTC);
  const upcomingLater = lessons.filter((l) => l.effective_start >= endUTC && l.status === "confirmed").slice(0, 8);
  const recent = lessons
    .filter((l) => l.effective_start < startUTC && lessonEndISO(l) < nowISO && l.status !== "cancelled" && l.status !== "declined")
    .sort((a, b) => (a.effective_start < b.effective_start ? 1 : -1))
    .slice(0, 5);

  const live = today.find((l) => lessonIsLive(l) && roomIsOpen(l));
  const completed = today.filter((l) => l.status === "completed" || lessonEndISO(l) < nowISO).length;
  const remaining = today.filter((l) => l.status === "confirmed" && lessonEndISO(l) >= nowISO).length;

  return (
    <div>
      <PageHeader
        title={`Good ${greeting(tz)}, ${firstName(teacher)}`}
        description={DateTime.now().setZone(tz).toFormat("cccc, d LLLL")}
      />

      {live && (
        <Card className="mb-6 border-success/40 bg-success/5">
          <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-success/15 text-success">
              <Radio className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold uppercase tracking-wide text-success">Live now</div>
              <div className="font-medium">
                {live.subject} · {live.student_name}
              </div>
              <div className="text-sm text-muted-foreground">{formatRange(live.effective_start, lessonEndISO(live), tz)}</div>
            </div>
            <Button asChild variant="outline" size="lg">
              <Link href={`/teacher/brief/${live.session_id}`}>
                <BookOpenCheck className="h-4 w-4" /> Brief
              </Link>
            </Button>
            <Button asChild variant="success" size="lg">
              <Link href={`/lesson/${live.session_id}`}>
                <Video className="h-4 w-4" /> Join lesson
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="mb-6 grid grid-cols-3 gap-3">
        <StatCard label="Today" value={today.length} icon={<CalendarDays className="h-4 w-4" />} />
        <StatCard label="Remaining" value={remaining} tone="primary" />
        <StatCard label="Done" value={completed} tone="success" icon={<CheckCircle2 className="h-4 w-4" />} />
      </div>

      <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Today&rsquo;s online lessons</h2>
      {today.length === 0 ? (
        <EmptyState
          icon={<CalendarDays className="h-5 w-5" />}
          title="No online lessons today"
          description="Lessons booked in the MathVision app with mode online appear here, with the room link from 15 minutes before the start."
        />
      ) : (
        <div className="space-y-3">
          {today.map((l) => (
            <TeacherLessonCard key={l.session_id} lesson={l} tz={tz} nowISO={nowISO} />
          ))}
        </div>
      )}

      {upcomingLater.length > 0 && (
        <>
          <h2 className="mb-3 mt-8 text-sm font-semibold text-muted-foreground">Coming up</h2>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Next {upcomingLater.length} lessons</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {upcomingLater.map((l) => (
                <TeacherLessonCard key={l.session_id} lesson={l} tz={tz} nowISO={nowISO} showDay />
              ))}
            </CardContent>
          </Card>
        </>
      )}

      {recent.length > 0 && (
        <>
          <h2 className="mb-3 mt-8 text-sm font-semibold text-muted-foreground">Recent lessons</h2>
          <div className="space-y-3">
            {recent.map((l) => (
              <TeacherLessonCard key={l.session_id} lesson={l} tz={tz} nowISO={nowISO} showDay />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * One lesson from the teacher's point of view. Ahead of the lesson: the brief
 * and, inside the window, Join. After it: what the app says about its report
 * and the two doors to writing one.
 */
function TeacherLessonCard({ lesson, tz, nowISO, showDay }: { lesson: OnlineLesson; tz: string; nowISO: string; showDay?: boolean }) {
  const over = lessonEndISO(lesson) < nowISO && !roomIsOpen(lesson);
  const live = lessonIsLive(lesson);
  const cancelled = lesson.status === "cancelled" || lesson.status === "declined";
  const action = over ? (
    <ReportStateBadge lesson={lesson} />
  ) : cancelled ? null : (
    <div className="flex items-center gap-2">
      <Button asChild size="sm" variant="outline">
        <Link href={`/teacher/brief/${lesson.session_id}`}>
          <BookOpenCheck className="h-4 w-4" /> Brief
        </Link>
      </Button>
      {roomIsOpen(lesson) && (
        <Button asChild size="sm" variant={live ? "success" : "default"}>
          <Link href={`/lesson/${lesson.session_id}`}>
            <Video className="h-4 w-4" /> {live ? "Join now" : "Open room"}
          </Link>
        </Button>
      )}
    </div>
  );
  return (
    <LessonCard
      lesson={lesson}
      viewerTz={tz}
      perspective="teacher"
      showDay={showDay}
      action={action}
      footer={over && !cancelled && canWriteReport(lesson) ? <WriteReportLinks lesson={lesson} /> : undefined}
    />
  );
}

function greeting(tz: string): string {
  const h = DateTime.now().setZone(tz).hour;
  if (h < 12) return "morning";
  if (h < 18) return "afternoon";
  return "evening";
}
