import Link from "next/link";
import { CalendarDays, CheckCircle2, Radio, Video } from "lucide-react";
import { DateTime } from "luxon";
import { PageHeader, StatCard } from "@/components/page-header";
import { LessonCard } from "@/components/session-card";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireRole, viewerTimeZone } from "@/lib/data/auth";
import { listMyOnlineLessons } from "@/lib/data/lessons";
import { lessonEndISO, lessonIsLive, roomIsOpen } from "@/lib/lessons/window";
import { dayWindowUTC, formatRange } from "@/lib/time";
import { firstName } from "@/lib/types";

/** The teacher's online lessons: my_online_lessons rows where they are the host. */
export default async function TeacherTodayPage() {
  const teacher = await requireRole("teacher");
  const tz = viewerTimeZone(teacher);

  const lessons = (await listMyOnlineLessons(teacher, 14)).filter((l) => l.seat === "host");
  const { startUTC, endUTC } = dayWindowUTC(tz);
  const today = lessons.filter((l) => l.effective_start >= startUTC && l.effective_start < endUTC);
  const nowISO = new Date().toISOString();
  const upcomingLater = lessons.filter((l) => l.effective_start >= endUTC && l.status === "confirmed").slice(0, 8);

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
            <LessonCard key={l.session_id} lesson={l} viewerTz={tz} perspective="teacher" />
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
                <LessonCard key={l.session_id} lesson={l} viewerTz={tz} perspective="teacher" showDay />
              ))}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function greeting(tz: string): string {
  const h = DateTime.now().setZone(tz).hour;
  if (h < 12) return "morning";
  if (h < 18) return "afternoon";
  return "evening";
}
