import { BookOpen, FileText, GraduationCap, Lightbulb, Star, Target } from "lucide-react";
import { DateTime } from "luxon";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Avatar } from "@/components/ui/avatar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { requireRole, viewerTimeZone } from "@/lib/data/auth";
import { listMyOnlineLessons } from "@/lib/data/lessons";
import { getReport } from "@/lib/data/reports";

/**
 * Published lesson reports. TODO(next stage): read mv-app's session_reports
 * (my_online_lessons.report_id, status published) instead of the legacy shape.
 */
export default async function ReportsPage() {
  const profile = await requireRole("student", "parent");
  const tz = viewerTimeZone(profile);
  // Parents don't see the individual teacher's name on reports.
  const showTeacher = profile.role !== "parent";

  const nowISO = new Date().toISOString();
  const past = (await listMyOnlineLessons(profile, 30)).filter((l) => l.effective_start < nowISO).reverse();
  const withReports = (
    await Promise.all(past.map(async (lesson) => ({ lesson, report: await getReport(lesson.session_id) })))
  ).filter((x) => x.report?.published_at);

  return (
    <div>
      <PageHeader title="Reports" description="Published lesson reports from your teachers." />

      {withReports.length === 0 ? (
        <EmptyState
          icon={<FileText className="h-5 w-5" />}
          title="No published reports yet"
          description="After each lesson, your teacher's report is approved by the centre and appears here and in the MathVision app."
        />
      ) : (
        <div className="space-y-4">
          {withReports.map(({ lesson, report }) => (
            <Card key={lesson.session_id}>
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-base">{lesson.subject ?? "Lesson"}</CardTitle>
                    <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span>{DateTime.fromISO(lesson.effective_start, { zone: "utc" }).setZone(tz).toFormat("cccc, d LLL yyyy")}</span>
                      {profile.role === "parent" && <span>{lesson.student_name}</span>}
                      {showTeacher && lesson.teacher_name && (
                        <span className="flex items-center gap-1.5">
                          <Avatar name={lesson.teacher_name} size={18} /> {lesson.teacher_name}
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
        <Star key={i} className={i < rating ? "h-4 w-4 fill-warning text-warning" : "h-4 w-4 text-muted-foreground/30"} />
      ))}
    </div>
  );
}
