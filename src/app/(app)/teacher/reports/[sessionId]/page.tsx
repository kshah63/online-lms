import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { DateTime } from "luxon";
import { PageHeader } from "@/components/page-header";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ReportEditor } from "@/components/teacher/report-editor";
import { requireRole, viewerTimeZone } from "@/lib/data/auth";
import { getMyOnlineLesson } from "@/lib/data/lessons";
import { getReport } from "@/lib/data/reports";

/** TODO(next stage): prefill from lesson_report_drafts and submit through rpc submit_report. */
export default async function ReportEditorPage({ params }: { params: { sessionId: string } }) {
  const teacher = await requireRole("teacher");
  const tz = viewerTimeZone(teacher);
  const lesson = await getMyOnlineLesson(teacher, params.sessionId);
  if (!lesson || lesson.seat !== "host") notFound();

  const report = await getReport(lesson.session_id);

  return (
    <div>
      <Button asChild variant="ghost" size="sm" className="mb-3 -ml-2">
        <Link href="/teacher/reports">
          <ChevronLeft className="h-4 w-4" /> All reports
        </Link>
      </Button>

      <PageHeader
        title={`Report — ${lesson.subject ?? "Lesson"}`}
        description={DateTime.fromISO(lesson.effective_start, { zone: "utc" }).setZone(tz).toFormat("cccc, d LLLL yyyy")}
        actions={
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Avatar name={lesson.student_name} size={28} />
            {lesson.student_name}
          </div>
        }
      />

      <ReportEditor sessionId={lesson.session_id} studentName={lesson.student_name} course={lesson.subject ?? "Lesson"} initial={report} />
    </div>
  );
}
