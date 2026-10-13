import { BookOpen, CalendarCheck, FileText, GraduationCap, ListChecks } from "lucide-react";
import { DateTime } from "luxon";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { requireRole, viewerTimeZone } from "@/lib/data/auth";
import { getChildren } from "@/lib/data/family";
import { getPublishedFamilyReports } from "@/lib/data/reports";
import { displayName } from "@/lib/types";

/** Published session_reports for the family (RLS: status published, family_id = my_family_id()). */
export default async function ReportsPage() {
  const profile = await requireRole("student", "parent");
  const tz = viewerTimeZone(profile);
  const [{ rows, hitLimit }, children] = await Promise.all([getPublishedFamilyReports(profile, 50), getChildren(profile)]);
  const childName = new Map(children.map((c) => [c.id, displayName(c)]));

  return (
    <div>
      <PageHeader title="Reports" description="Each lesson's report, once the centre has published it." />

      {rows.length === 0 ? (
        <EmptyState
          icon={<FileText className="h-5 w-5" />}
          title="No published reports yet"
          description="After each lesson, your teacher's report is approved by the centre and appears here and in the MathVision app."
        />
      ) : (
        <div className="space-y-4">
          {hitLimit && <p className="text-sm text-muted-foreground">Showing the latest {rows.length} reports.</p>}
          {rows.map((r) => (
            <Card key={r.id}>
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-base">
                      {r.course_name ?? "Lesson"}
                      {r.topic ? ` · ${r.topic}` : ""}
                    </CardTitle>
                    <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span>{DateTime.fromISO(r.published_at ?? r.created_at, { zone: "utc" }).setZone(tz).toFormat("cccc, d LLL yyyy")}</span>
                      {profile.role === "parent" && r.student_id && childName.has(r.student_id) && <span>{childName.get(r.student_id)}</span>}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {r.understanding != null && <Badge variant="secondary">Understanding {r.understanding}/10</Badge>}
                    {r.gp != null && <Badge variant="default">GP {r.gp.toFixed(2)}</Badge>}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <Field icon={<BookOpen className="h-4 w-4" />} label="Topic" value={r.topic ? `${r.topic}${r.topic_completed === false ? ` — not finished${r.topics_not_done ? `: ${r.topics_not_done}` : ""}` : ""}` : null} />
                <Field icon={<GraduationCap className="h-4 w-4" />} label="Remarks" value={r.remarks} />
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field icon={<CalendarCheck className="h-4 w-4" />} label="Previous homework" value={r.prev_hw} />
                  {r.otr != null && <Field icon={<ListChecks className="h-4 w-4" />} label="Oral test" value={`${r.otr}% to ${r.otr + 5}%`} />}
                </div>
                {r.written_tests.length > 0 && (
                  <div>
                    <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Written tests</div>
                    <ul className="text-sm">
                      {r.written_tests.map((t, i) => (
                        <li key={i}>
                          {t.name}
                          {t.score != null && t.out_of != null ? `: ${t.score}/${t.out_of}${t.percent != null ? ` (${t.percent}%)` : ""}` : ""}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {r.homework && (
                  <>
                    <Separator />
                    <div className="rounded-lg bg-accent/40 p-3">
                      <div className="text-xs font-semibold uppercase tracking-wide text-accent-foreground">Homework</div>
                      <p className="mt-1 text-sm">{r.homework}</p>
                    </div>
                  </>
                )}
                {r.has_upcoming_tests && <p className="text-xs text-muted-foreground">A school test or exam is coming up.</p>}
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
