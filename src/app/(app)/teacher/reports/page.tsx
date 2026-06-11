import Link from "next/link";
import { ClipboardList, FileEdit, PenLine } from "lucide-react";
import { DateTime } from "luxon";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireRole } from "@/lib/data/auth";
import { getTeacherReportQueue } from "@/lib/data/reports";

export default async function TeacherReportsPage() {
  const teacher = await requireRole("teacher");
  const queue = await getTeacherReportQueue(teacher);

  const pending = queue.filter((q) => !q.report?.published_at);
  const done = queue.filter((q) => q.report?.published_at);

  return (
    <div>
      <PageHeader title="Reports" description="Write AI-drafted reports for completed lessons, then publish to parents." />

      {queue.length === 0 ? (
        <EmptyState icon={<ClipboardList className="h-5 w-5" />} title="No completed lessons yet" description="Reports become available once a lesson is completed." />
      ) : (
        <div className="space-y-6">
          {pending.length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Awaiting a report ({pending.length})</h2>
              <div className="space-y-3">
                {pending.map(({ session, report }) => (
                  <Row
                    key={session.id}
                    sessionId={session.id}
                    studentName={session.student.display_name}
                    avatarSrc={session.student.avatar_url}
                    course={session.course.name}
                    when={DateTime.fromISO(session.scheduled_start, { zone: "utc" }).setZone(teacher.timezone).toFormat("ccc d LLL")}
                    state={report ? "draft" : "none"}
                  />
                ))}
              </div>
            </section>
          )}

          {done.length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Published ({done.length})</h2>
              <div className="space-y-3">
                {done.map(({ session }) => (
                  <Row
                    key={session.id}
                    sessionId={session.id}
                    studentName={session.student.display_name}
                    avatarSrc={session.student.avatar_url}
                    course={session.course.name}
                    when={DateTime.fromISO(session.scheduled_start, { zone: "utc" }).setZone(teacher.timezone).toFormat("ccc d LLL")}
                    state="published"
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function Row({
  sessionId,
  studentName,
  avatarSrc,
  course,
  when,
  state,
}: {
  sessionId: string;
  studentName: string;
  avatarSrc: string | null;
  course: string;
  when: string;
  state: "none" | "draft" | "published";
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-card p-4 shadow-sm">
      <Avatar name={studentName} src={avatarSrc} size={36} />
      <div className="min-w-0 flex-1">
        <div className="font-medium">{studentName}</div>
        <div className="text-sm text-muted-foreground">
          {course} · {when}
        </div>
      </div>
      {state === "none" && <Badge variant="warning">No report</Badge>}
      {state === "draft" && <Badge variant="secondary">Draft</Badge>}
      {state === "published" && <Badge variant="success">Published</Badge>}
      <Button asChild size="sm" variant={state === "published" ? "outline" : "default"}>
        <Link href={`/teacher/reports/${sessionId}`}>
          {state === "published" ? <FileEdit className="h-4 w-4" /> : <PenLine className="h-4 w-4" />}
          {state === "none" ? "Write" : state === "draft" ? "Continue" : "Edit"}
        </Link>
      </Button>
    </div>
  );
}
