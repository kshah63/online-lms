import Link from "next/link";
import { notFound } from "next/navigation";
import { BookOpenCheck, ChevronLeft, Target, Video } from "lucide-react";
import { DateTime } from "luxon";
import { PageHeader } from "@/components/page-header";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireRole, viewerTimeZone } from "@/lib/data/auth";
import { getTeacherBrief } from "@/lib/data/brief";
import { lessonEndISO, roomIsOpen } from "@/lib/lessons/window";
import { formatRange } from "@/lib/time";

/** What a teacher reads in the two minutes before one of their lessons. Read-only. */
export default async function TeacherBriefPage({ params }: { params: { sessionId: string } }) {
  const teacher = await requireRole("teacher");
  const tz = viewerTimeZone(teacher);
  const result = await getTeacherBrief(teacher, params.sessionId);
  if (!result) notFound();
  const { lesson, brief } = result;
  const start = DateTime.fromISO(lesson.effective_start, { zone: "utc" }).setZone(tz);

  return (
    <div>
      <Button asChild variant="ghost" size="sm" className="mb-3 -ml-2">
        <Link href="/teacher">
          <ChevronLeft className="h-4 w-4" /> Today
        </Link>
      </Button>

      <PageHeader
        title={`Brief — ${lesson.subject ?? "Lesson"}`}
        description={`${start.toFormat("cccc, d LLLL")} · ${formatRange(lesson.effective_start, lessonEndISO(lesson), tz)}`}
        actions={
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
              <Avatar name={lesson.student_name} size={28} />
              {lesson.student_name}
            </span>
            {roomIsOpen(lesson) && (
              <Button asChild size="sm" variant="success">
                <Link href={`/lesson/${lesson.session_id}`}>
                  <Video className="h-4 w-4" /> Join
                </Link>
              </Button>
            )}
          </div>
        }
      />

      <Card className="mb-6">
        <CardContent className="flex items-start gap-3 p-5">
          <BookOpenCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <p className="text-base font-medium">{brief.headline}</p>
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
