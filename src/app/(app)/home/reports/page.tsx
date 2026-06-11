import Link from "next/link";
import { BookOpen, FileText, GraduationCap, Lightbulb, PlayCircle, Star, Target } from "lucide-react";
import { DateTime } from "luxon";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { requireRole } from "@/lib/data/auth";
import { getPastForProfile } from "@/lib/data/sessions";
import { getReportForSession } from "@/lib/data/people";

export default async function ReportsPage() {
  const profile = await requireRole("student", "parent");
  const tz = profile.timezone;
  // Parents don't see the individual teacher's name on reports.
  const showTeacher = profile.role !== "parent";

  const past = await getPastForProfile(profile, 30);
  const withReports = (
    await Promise.all(
      past.map(async (s) => ({ session: s, report: await getReportForSession(s.id) })),
    )
  ).filter((x) => x.report?.published_at);

  return (
    <div>
      <PageHeader title="Reports" description="Published lesson reports from your teachers." />

      {withReports.length === 0 ? (
        <EmptyState
          icon={<FileText className="h-5 w-5" />}
          title="No published reports yet"
          description="After each lesson, your teacher publishes a report here."
        />
      ) : (
        <div className="space-y-4">
          {withReports.map(({ session, report }) => (
            <Card key={session.id}>
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-base">{session.course.name}</CardTitle>
                    <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span>
                        {DateTime.fromISO(session.scheduled_start, { zone: "utc" }).setZone(tz).toFormat("cccc, d LLL yyyy")}
                      </span>
                      {showTeacher && session.teacher && (
                        <span className="flex items-center gap-1.5">
                          <Avatar name={session.teacher.display_name} size={18} /> {session.teacher.display_name}
                        </span>
                      )}
                    </p>
                  </div>
                  {report!.rating != null && <Stars rating={report!.rating} />}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <Field icon={<BookOpen className="h-4 w-4" />} label="Topics covered" value={report!.topics_covered} />
                <Field icon={<GraduationCap className="h-4 w-4" />} label="How they did" value={report!.how_student_did} />
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field icon={<Lightbulb className="h-4 w-4 text-success" />} label="Strengths" value={report!.strengths} />
                  <Field icon={<Target className="h-4 w-4 text-warning-foreground" />} label="Areas to work on" value={report!.areas_to_work} />
                </div>
                {report!.homework && (
                  <>
                    <Separator />
                    <div className="rounded-lg bg-accent/40 p-3">
                      <div className="text-xs font-semibold uppercase tracking-wide text-accent-foreground">Homework</div>
                      <p className="mt-1 text-sm">{report!.homework}</p>
                    </div>
                  </>
                )}
                {session.recording_url && (
                  <Button asChild variant="outline" size="sm">
                    <Link href={session.recording_url}>
                      <PlayCircle className="h-4 w-4" /> Rewatch recording
                    </Link>
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function Field({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {icon} {label}
      </div>
      <p className="text-sm leading-relaxed">{value}</p>
    </div>
  );
}

function Stars({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          className={i < rating ? "h-4 w-4 fill-warning text-warning" : "h-4 w-4 text-muted-foreground/30"}
        />
      ))}
    </div>
  );
}
