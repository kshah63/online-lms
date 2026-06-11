import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { DateTime } from "luxon";
import { PageHeader } from "@/components/page-header";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ReportEditor } from "@/components/teacher/report-editor";
import { requireRole } from "@/lib/data/auth";
import { getSessionById } from "@/lib/data/sessions";
import { getReport } from "@/lib/data/reports";

export default async function ReportEditorPage({ params }: { params: { sessionId: string } }) {
  const teacher = await requireRole("teacher");
  const session = await getSessionById(params.sessionId);
  if (!session || session.teacher_id !== teacher.id) notFound();

  const report = await getReport(session.id);

  return (
    <div>
      <Button asChild variant="ghost" size="sm" className="mb-3 -ml-2">
        <Link href="/teacher/reports">
          <ChevronLeft className="h-4 w-4" /> All reports
        </Link>
      </Button>

      <PageHeader
        title={`Report — ${session.course.name}`}
        description={DateTime.fromISO(session.scheduled_start, { zone: "utc" }).setZone(teacher.timezone).toFormat("cccc, d LLLL yyyy")}
        actions={
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Avatar name={session.student.display_name} src={session.student.avatar_url} size={28} />
            {session.student.display_name}
          </div>
        }
      />

      <ReportEditor
        sessionId={session.id}
        studentName={session.student.display_name}
        course={session.course.name}
        initial={report}
      />
    </div>
  );
}
