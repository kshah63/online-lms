import { ClipboardList } from "lucide-react";
import { DateTime } from "luxon";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { ReportStateBadge, WriteReportLinks } from "@/components/report-state-badge";
import { Avatar } from "@/components/ui/avatar";
import { requireRole, viewerTimeZone } from "@/lib/data/auth";
import { getTeacherReportQueue } from "@/lib/data/reports";
import type { OnlineLesson } from "@/lib/types";

/** The teacher's past online lessons and what the app says about each one's report. */
export default async function TeacherReportsPage() {
  const teacher = await requireRole("teacher");
  const tz = viewerTimeZone(teacher);
  const { pending, done } = await getTeacherReportQueue(teacher);

  return (
    <div>
      <PageHeader
        title="Reports"
        description="Each lesson's report goes to the family through the centre app. Write it from the AI draft here, or in the app — the same form, the same rules."
      />

      {pending.length === 0 && done.length === 0 ? (
        <EmptyState icon={<ClipboardList className="h-5 w-5" />} title="No lessons to report on yet" description="Lessons you have taught in the last two weeks appear here once they are over." />
      ) : (
        <div className="space-y-6">
          {pending.length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Awaiting a report ({pending.length})</h2>
              <div className="space-y-3">
                {pending.map((l) => (
                  <Row key={l.session_id} lesson={l} tz={tz} />
                ))}
              </div>
            </section>
          )}

          {done.length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Reported ({done.length})</h2>
              <div className="space-y-3">
                {done.map((l) => (
                  <Row key={l.session_id} lesson={l} tz={tz} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ lesson, tz }: { lesson: OnlineLesson; tz: string }) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-sm sm:flex-row sm:items-center">
      <Avatar name={lesson.student_name} size={36} />
      <div className="min-w-0 flex-1">
        <div className="font-medium">{lesson.student_name}</div>
        <div className="text-sm text-muted-foreground">
          {lesson.subject ?? "Lesson"} · {DateTime.fromISO(lesson.effective_start, { zone: "utc" }).setZone(tz).toFormat("ccc d LLL, h:mm a")}
          {lesson.topic ? ` · ${lesson.topic}` : ""}
        </div>
      </div>
      <ReportStateBadge lesson={lesson} />
      <WriteReportLinks lesson={lesson} />
    </div>
  );
}
