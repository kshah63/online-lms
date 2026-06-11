import Link from "next/link";
import { CalendarDays, ClipboardCheck, Coins, FileText, Video } from "lucide-react";
import { DateTime } from "luxon";
import { PageHeader, StatCard } from "@/components/page-header";
import { SessionCard } from "@/components/session-card";
import { EmptyState } from "@/components/empty-state";
import { HomeworkList } from "@/components/homework/homework-list";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireRole } from "@/lib/data/auth";
import { getPastForProfile, getUpcomingForProfile } from "@/lib/data/sessions";
import { getBalance, getChildren, getEnrolledCourses, getReportForSession } from "@/lib/data/people";
import { getHomeworkForProfile } from "@/lib/data/homework";
import { BookingDialog } from "@/components/booking-dialog";
import { BookingActions } from "@/components/booking-actions";
import { formatRange, dayLabel } from "@/lib/time";

export default async function HomePage() {
  const profile = await requireRole("student", "parent");
  const tz = profile.timezone;

  const [upcoming, past, children, homework] = await Promise.all([
    getUpcomingForProfile(profile, 6),
    getPastForProfile(profile, 8),
    getChildren(profile),
    // Homework is a secondary card — don't let it take down the dashboard.
    getHomeworkForProfile(profile).catch(() => []),
  ]);
  const openHomework = homework.filter((h) => h.status !== "completed").slice(0, 4);

  const balances = await Promise.all(
    children.map(async (c) => ({ child: c, balance: await getBalance(c.id) })),
  );
  const totalCredits = balances.reduce((sum, b) => sum + b.balance, 0);

  // Bookable combos: each student (self or child) + the courses they're enrolled in.
  const bookOptions = await Promise.all(
    children.map(async (c) => ({
      studentId: c.id,
      studentName: c.display_name,
      courses: (await getEnrolledCourses(c.id)).map((co) => ({ id: co.id, name: co.name })),
    })),
  );

  // Most recent published report among past sessions.
  let latest: { session: (typeof past)[number]; report: NonNullable<Awaited<ReturnType<typeof getReportForSession>>> } | null = null;
  for (const s of past) {
    const r = await getReportForSession(s.id);
    if (r?.published_at) {
      latest = { session: s, report: r };
      break;
    }
  }

  const next = upcoming[0];
  const firstName = profile.display_name.split(" ")[0];

  return (
    <div>
      <PageHeader
        title={`Welcome, ${firstName}`}
        description={
          profile.role === "parent"
            ? "Your children's upcoming lessons and latest reports."
            : "Your upcoming lessons, reports and lesson recordings."
        }
        actions={
          bookOptions.some((o) => o.courses.length > 0) ? (
            <BookingDialog mode="create" options={bookOptions} defaultTz={tz} />
          ) : undefined
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label="Upcoming" value={upcoming.length} icon={<CalendarDays className="h-4 w-4" />} />
        <StatCard
          label="Lesson credits"
          value={totalCredits}
          tone={totalCredits <= 2 ? "warning" : "default"}
          hint={totalCredits <= 2 ? "Running low — top up soon" : undefined}
          icon={<Coins className="h-4 w-4" />}
        />
        <StatCard label="Completed" value={past.filter((s) => s.status === "completed").length} tone="success" />
      </div>

      {/* Next lesson highlight */}
      {next && (
        <Card className="mb-6 overflow-hidden">
          <div className="flex flex-col gap-4 bg-primary/5 p-5 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold uppercase tracking-wide text-primary">
                {dayLabel(next.scheduled_start, tz)} · next lesson
              </div>
              <div className="mt-0.5 text-lg font-semibold">{next.course.name}</div>
              <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                <span>{formatRange(next.scheduled_start, next.scheduled_end, tz)}</span>
                {next.teacher && (
                  <span className="flex items-center gap-1.5">
                    <Avatar name={next.teacher.display_name} size={20} /> {next.teacher.display_name}
                  </span>
                )}
              </div>
            </div>
            {next.status === "in_progress" ? (
              <Button asChild variant="success" size="lg">
                <Link href={`/lesson/${next.id}`}>
                  <Video className="h-4 w-4" /> Join now
                </Link>
              </Button>
            ) : (
              <div className="text-right text-sm text-muted-foreground">
                Starts {DateTime.fromISO(next.scheduled_start, { zone: "utc" }).setZone(tz).toRelative()}
              </div>
            )}
          </div>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Upcoming lessons</h2>
          {upcoming.length === 0 ? (
            <EmptyState icon={<CalendarDays className="h-5 w-5" />} title="No upcoming lessons" description="New lessons will appear here once scheduled." />
          ) : (
            <div className="space-y-3">
              {upcoming.map((s) => {
                const editable = s.status === "scheduled" || s.status === "confirmed";
                return (
                  <SessionCard
                    key={s.id}
                    session={s}
                    viewerTz={tz}
                    perspective={profile.role as "student" | "parent"}
                    showDay
                    action={
                      s.status === "in_progress"
                        ? undefined
                        : editable
                          ? (
                              <BookingActions
                                sessionId={s.id}
                                startISO={s.scheduled_start}
                                endISO={s.scheduled_end}
                                studentName={s.student.display_name}
                                courseName={s.course.name}
                                viewerTz={tz}
                              />
                            )
                          : undefined
                    }
                  />
                );
              })}
            </div>
          )}
        </div>

        <div className="space-y-6">
          {openHomework.length > 0 && (
            <div>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-muted-foreground">Homework</h2>
                <Link href="/home/homework" className="text-xs text-primary hover:underline">
                  View all
                </Link>
              </div>
              <HomeworkList items={openHomework} viewerTz={tz} showStudent={profile.role === "parent"} />
            </div>
          )}

          <div>
          <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Latest report</h2>
          {latest ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{latest.session.course.name}</CardTitle>
                <p className="text-xs text-muted-foreground">
                  {DateTime.fromISO(latest.session.scheduled_start, { zone: "utc" }).setZone(tz).toFormat("d LLL yyyy")}
                </p>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p className="line-clamp-3 text-muted-foreground">{latest.report.how_student_did}</p>
                <Button asChild variant="outline" size="sm" className="w-full">
                  <Link href="/home/reports">
                    <FileText className="h-4 w-4" /> View all reports
                  </Link>
                </Button>
              </CardContent>
            </Card>
          ) : (
            <EmptyState icon={<FileText className="h-5 w-5" />} title="No reports yet" description="Reports appear after lessons are completed." />
          )}
          </div>
        </div>
      </div>
    </div>
  );
}
