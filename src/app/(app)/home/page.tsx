import Link from "next/link";
import { BarChart3, CalendarDays, FileText, Video } from "lucide-react";
import { DateTime } from "luxon";
import { PageHeader, StatCard } from "@/components/page-header";
import { LessonCard } from "@/components/session-card";
import { EmptyState } from "@/components/empty-state";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { requireRole, viewerTimeZone } from "@/lib/data/auth";
import { listMyOnlineLessons } from "@/lib/data/lessons";
import { getPublishedFamilyReports } from "@/lib/data/reports";
import { lessonEndISO, lessonIsLive, roomIsOpen } from "@/lib/lessons/window";
import { formatRange, dayLabel } from "@/lib/time";
import { firstName } from "@/lib/types";

/**
 * A student's or parent's online lessons (my_online_lessons: learner or family
 * rows). Booking, rescheduling and cancelling live in the MathVision app;
 * this page opens rooms and shows what came out of lessons.
 */
export default async function HomePage() {
  const profile = await requireRole("student", "parent", "ambassador");
  const tz = viewerTimeZone(profile);

  if (profile.role === "ambassador") {
    return (
      <div>
        <PageHeader title={`Welcome, ${firstName(profile)}`} description="The lesson room has nothing for an ambassador account." />
        <EmptyState icon={<CalendarDays className="h-5 w-5" />} title="Nothing to show" description="Everything you use lives in the MathVision app." />
      </div>
    );
  }

  const nowISO = new Date().toISOString();
  const [lessons, reports] = await Promise.all([listMyOnlineLessons(profile, 14), getPublishedFamilyReports(profile, 5)]);
  const upcoming = lessons.filter((l) => lessonEndISO(l) >= nowISO && l.status !== "cancelled" && l.status !== "declined");
  const past = lessons.filter((l) => lessonEndISO(l) < nowISO);

  const next = upcoming[0];
  const nextLive = next ? lessonIsLive(next) : false;
  const nextCanJoin = next ? next.seat !== "family" && roomIsOpen(next) : false;
  const latestReport = reports.rows[0];

  return (
    <div>
      <PageHeader
        title={`Welcome, ${firstName(profile)}`}
        description={profile.role === "parent" ? "Your children's online lessons, reports and progress." : "Your online lessons, reports and progress."}
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label="Upcoming" value={upcoming.length} icon={<CalendarDays className="h-4 w-4" />} />
        <StatCard label="Completed" value={past.filter((l) => l.status === "completed").length} tone="success" hint="last two weeks" />
        <StatCard label="Reports" value={reports.rows.length} hint={latestReport ? `latest ${dayLabel(latestReport.published_at ?? latestReport.created_at, tz)}` : "none yet"} icon={<FileText className="h-4 w-4" />} />
      </div>

      {/* Next lesson highlight */}
      {next && (
        <Card className="mb-6 overflow-hidden">
          <div className="flex flex-col gap-4 bg-primary/5 p-5 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold uppercase tracking-wide text-primary">
                {dayLabel(next.effective_start, tz)} · next lesson
              </div>
              <div className="mt-0.5 text-lg font-semibold">{next.subject ?? "Online lesson"}</div>
              <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                <span>{formatRange(next.effective_start, lessonEndISO(next), tz)}</span>
                {next.teacher_name && (
                  <span className="flex items-center gap-1.5">
                    <Avatar name={next.teacher_name} size={20} /> {next.teacher_name}
                  </span>
                )}
                {profile.role === "parent" && <span>for {next.student_name}</span>}
              </div>
            </div>
            {nextCanJoin ? (
              <Button asChild variant={nextLive ? "success" : "default"} size="lg">
                <Link href={`/lesson/${next.session_id}`}>
                  <Video className="h-4 w-4" /> {nextLive ? "Join now" : "Join early"}
                </Link>
              </Button>
            ) : (
              <div className="text-right text-sm text-muted-foreground">
                Starts {DateTime.fromISO(next.effective_start, { zone: "utc" }).setZone(tz).toRelative()}
              </div>
            )}
          </div>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Upcoming lessons</h2>
          {upcoming.length === 0 ? (
            <EmptyState
              icon={<CalendarDays className="h-5 w-5" />}
              title="No upcoming online lessons"
              description="Lessons booked in the MathVision app appear here; the room opens 15 minutes before the start."
            />
          ) : (
            <div className="space-y-3">
              {upcoming.map((l) => (
                <LessonCard key={l.session_id} lesson={l} viewerTz={tz} perspective={profile.role as "student" | "parent"} showDay />
              ))}
            </div>
          )}
        </div>

        <div className="space-y-6">
          <div>
            <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Reports</h2>
            <Card className="p-4">
              {latestReport ? (
                <>
                  <div className="text-sm font-medium">{latestReport.course_name ?? "Lesson"}{latestReport.topic ? ` · ${latestReport.topic}` : ""}</div>
                  <p className="mt-1 line-clamp-3 text-sm text-muted-foreground">{latestReport.remarks}</p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Published lesson reports arrive in the MathVision app, and are listed here too.</p>
              )}
              <Button asChild variant="outline" size="sm" className="mt-3 w-full">
                <Link href="/home/reports">
                  <FileText className="h-4 w-4" /> View reports
                </Link>
              </Button>
            </Card>
          </div>

          <div>
            <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Progress</h2>
            <Card className="p-4">
              <p className="text-sm text-muted-foreground">Topics covered, practice volume and where help is needed.</p>
              <Button asChild variant="outline" size="sm" className="mt-3 w-full">
                <Link href="/home/progress">
                  <BarChart3 className="h-4 w-4" /> See progress
                </Link>
              </Button>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
