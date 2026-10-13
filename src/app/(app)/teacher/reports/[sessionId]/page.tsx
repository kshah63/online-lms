import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, ExternalLink } from "lucide-react";
import { DateTime } from "luxon";
import { PageHeader } from "@/components/page-header";
import { ReportStateBadge, appSessionUrl } from "@/components/report-state-badge";
import { RecordingLink } from "@/components/lesson/recording-link";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { requireRole, viewerTimeZone } from "@/lib/data/auth";
import { getMyOnlineLesson } from "@/lib/data/lessons";
import { getReportDraft, getSessionCourseId, getTopicOptions, reportState } from "@/lib/data/reports";
import { signsReport } from "@/lib/reports/signs";
import { normaliseDraft } from "@/lib/reports/draft-session-report";
import { ReportEditorClient } from "./editor";

/**
 * The centre-format editor for one of the teacher's lessons, prefilled from
 * lesson_report_drafts when lesson-finalize left a draft. Submit goes through
 * rpc submit_report; a report that has already gone to the family is shown,
 * not edited.
 */
export default async function ReportEditorPage({ params }: { params: { sessionId: string } }) {
  const teacher = await requireRole("teacher");
  const tz = viewerTimeZone(teacher);
  const lesson = await getMyOnlineLesson(teacher, params.sessionId);
  if (!lesson || lesson.seat !== "host") notFound();

  const state = reportState(lesson);
  const signs = signsReport(teacher);
  const [draftRow, courseId] = await Promise.all([getReportDraft(lesson.session_id), getSessionCourseId(teacher, lesson.session_id)]);
  const topicOptions = await getTopicOptions(courseId);
  const initial = draftRow ? normaliseDraft(draftRow.draft, { signs, topicOptions, bookedTopic: lesson.topic }) : null;

  return (
    <div>
      <Button asChild variant="ghost" size="sm" className="mb-3 -ml-2">
        <Link href="/teacher/reports">
          <ChevronLeft className="h-4 w-4" /> All reports
        </Link>
      </Button>

      <PageHeader
        title={`Report — ${lesson.subject ?? "Lesson"}`}
        description={DateTime.fromISO(lesson.effective_start, { zone: "utc" }).setZone(tz).toFormat("cccc, d LLLL yyyy · h:mm a")}
        actions={
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <ReportStateBadge lesson={lesson} />
            <RecordingLink viewer={teacher} sessionId={lesson.session_id} tz={tz} />
            <span className="flex items-center gap-2">
              <Avatar name={lesson.student_name} size={28} />
              {lesson.student_name}
            </span>
          </div>
        }
      />

      {state === "published" || state === "pending" ? (
        <Card>
          <CardContent className="space-y-3 p-5 text-sm">
            <p>
              {state === "published"
                ? "This lesson's report has already gone to the family."
                : "This lesson's report is with your in-charge for approval."}{" "}
              Changes are made in the MathVision app.
            </p>
            <Button asChild variant="outline" size="sm">
              <a href={appSessionUrl(lesson.session_id)} target="_blank" rel="noreferrer">
                <ExternalLink className="h-4 w-4" /> Open the session in the app
              </a>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <ReportEditorClient
          sessionId={lesson.session_id}
          studentName={lesson.student_name}
          course={lesson.subject ?? "Lesson"}
          topicOptions={topicOptions}
          bookedTopic={lesson.topic}
          signs={signs}
          initial={initial}
          rationale={draftRow?.rationale ?? null}
          source={draftRow?.source ?? null}
        />
      )}
    </div>
  );
}
