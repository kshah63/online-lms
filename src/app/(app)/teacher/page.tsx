import Link from "next/link";
import { CalendarDays, CheckCircle2, Radio, Video } from "lucide-react";
import { DateTime } from "luxon";
import { PageHeader, StatCard } from "@/components/page-header";
import { SessionCard } from "@/components/session-card";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireRole } from "@/lib/data/auth";
import { getTeacherToday, getUpcomingForProfile } from "@/lib/data/sessions";
import { formatRange } from "@/lib/time";

export default async function TeacherTodayPage() {
  const teacher = await requireRole("teacher");
  const tz = teacher.timezone;

  const [today, upcoming] = await Promise.all([
    getTeacherToday(teacher),
    getUpcomingForProfile(teacher, 8),
  ]);

  const live = today.find((s) => s.status === "in_progress");
  const completed = today.filter((s) => s.status === "completed").length;
  const remaining = today.filter((s) => ["scheduled", "confirmed", "in_progress"].includes(s.status)).length;
  const upcomingLater = upcoming.filter((s) => !today.some((t) => t.id === s.id));

  const firstName = teacher.display_name.split(" ")[0];

  return (
    <div>
      <PageHeader
        title={`Good ${greeting(tz)}, ${firstName}`}
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
                {live.course.name} · {live.student.display_name}
              </div>
              <div className="text-sm text-muted-foreground">
                {formatRange(live.scheduled_start, live.scheduled_end, tz)}
              </div>
            </div>
            <Button asChild variant="success" size="lg">
              <Link href={`/lesson/${live.id}`}>
                <Video className="h-4 w-4" /> Join lesson
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="mb-6 grid grid-cols-3 gap-3">
        <StatCard label="Today" value={today.length} icon={<CalendarDays className="h-4 w-4" />} />
        <StatCard label="Remaining" value={remaining} tone="primary" />
        <StatCard label="Completed" value={completed} tone="success" icon={<CheckCircle2 className="h-4 w-4" />} />
      </div>

      <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Today&rsquo;s lessons</h2>
      {today.length === 0 ? (
        <EmptyState
          icon={<CalendarDays className="h-5 w-5" />}
          title="No lessons today"
          description="Enjoy the breather — your next sessions are below."
        />
      ) : (
        <div className="space-y-3">
          {today.map((s) => (
            <SessionCard key={s.id} session={s} viewerTz={tz} perspective="teacher" />
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
              {upcomingLater.map((s) => (
                <SessionCard key={s.id} session={s} viewerTz={tz} perspective="teacher" showDay />
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
