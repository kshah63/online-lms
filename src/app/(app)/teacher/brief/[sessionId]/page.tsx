import Link from "next/link";
import { notFound } from "next/navigation";
import { BookOpenCheck, ChevronLeft, ExternalLink, ListChecks, Target, Video } from "lucide-react";
import { DateTime } from "luxon";
import { PageHeader } from "@/components/page-header";
import { RecordingLink } from "@/components/lesson/recording-link";
import { TopicMarkChips } from "@/components/progress/topic-mark-chips";
import { appSessionUrl } from "@/components/report-state-badge";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireRole, viewerTimeZone } from "@/lib/data/auth";
import { getTeacherBrief } from "@/lib/data/brief";
import { lessonEndISO, roomIsOpen } from "@/lib/lessons/window";
import { isOffice } from "@/lib/permissions";
import { formatRange } from "@/lib/time";

/**
 * What a teacher reads in the two minutes before one of their lessons:
 * lesson_brief_facts merged with the lesson row and the room state. The host
 * may mark where the student stands on the syllabus; an in-charge or admin
 * reads the same brief for a lesson in their room. The report itself is
 * written in the app (or the editor here), never from this page.
 */
export default async function TeacherBriefPage({ params }: { params: { sessionId: string } }) {
  const viewer = await requireRole("teacher", "staff", "admin");
  const tz = viewerTimeZone(viewer);
  const result = await getTeacherBrief(viewer, params.sessionId);
  if (!result) notFound();
  const { lesson, brief, topics, canMark } = result;
  const start = DateTime.fromISO(lesson.effective_start, { zone: "utc" }).setZone(tz);
  const over = lessonEndISO(lesson) < new Date().toISOString();

  return (
    <div>
      <Button asChild variant="ghost" size="sm" className="mb-3 -ml-2">
        <Link href={isOffice(viewer.role) ? "/admin" : "/teacher"}>
          <ChevronLeft className="h-4 w-4" /> {isOffice(viewer.role) ? "Board" : "Today"}
        </Link>
      </Button>

      <PageHeader
        title={`Brief — ${lesson.subject ?? "Lesson"}`}
        description={`${start.toFormat("cccc, d LLLL")} · ${formatRange(lesson.effective_start, lessonEndISO(lesson), tz)}${lesson.seat === "observer" && lesson.teacher_name ? ` · ${lesson.teacher_name}` : ""}`}
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
              <Avatar name={lesson.student_name} size={28} />
              {lesson.student_name}
            </span>
            {lesson.seat === "host" && roomIsOpen(lesson) && (
              <Button asChild size="sm" variant="success">
                <Link href={`/lesson/${lesson.session_id}`}>
                  <Video className="h-4 w-4" /> Join
                </Link>
              </Button>
            )}
            {lesson.seat === "host" && over && (
              <Button asChild size="sm" variant="outline">
                <a href={appSessionUrl(lesson.session_id)} target="_blank" rel="noreferrer">
                  <ExternalLink className="h-4 w-4" /> Write the report in the app
                </a>
              </Button>
            )}
          </div>
        }
      />

      <Card className="mb-6">
        <CardContent className="flex flex-col gap-2 p-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <BookOpenCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <p className="text-base font-medium">{brief.headline}</p>
          </div>
          <RecordingLink viewer={viewer} sessionId={lesson.session_id} tz={tz} className="inline-flex shrink-0 items-center gap-1.5 text-sm text-primary hover:underline" />
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {brief.sections.map((section) => (
            <Card key={section.title}>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{section.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1.5 text-sm">
                  {section.items.map((item, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                      {item}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}

          {canMark && lesson.student_id && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <ListChecks className="h-4 w-4 text-primary" /> Mark a topic
                </CardTitle>
                <p className="text-sm text-muted-foreground">Where {lesson.student_name.split(/\s+/)[0]} stands on the syllabus, in your words. It shows on the family&rsquo;s progress page and in the next teacher&rsquo;s brief.</p>
              </CardHeader>
              <CardContent>
                <TopicMarkChips sessionId={lesson.session_id} studentId={lesson.student_id} topics={topics} />
              </CardContent>
            </Card>
          )}
        </div>

        <Card className="h-fit border-primary/30">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Target className="h-4 w-4 text-primary" /> Suggested focus
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="list-decimal space-y-2 pl-5 text-sm">
              {brief.suggested_focus.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ol>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
