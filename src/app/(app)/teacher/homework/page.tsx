import Link from "next/link";
import { ClipboardCheck, Eye } from "lucide-react";
import { DateTime } from "luxon";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireRole } from "@/lib/data/auth";
import { getSubmittedForTeacher } from "@/lib/data/homework";

export default async function TeacherHomeworkPage() {
  const teacher = await requireRole("teacher");
  const submitted = await getSubmittedForTeacher(teacher);

  return (
    <div>
      <PageHeader
        title="Homework review"
        description="Students submit their work on the notebook — open it to verify completion."
      />

      {submitted.length === 0 ? (
        <EmptyState
          icon={<ClipboardCheck className="h-5 w-5" />}
          title="Nothing to review"
          description="Submitted homework awaiting your review will appear here."
        />
      ) : (
        <div className="space-y-3">
          {submitted.map((hw) => (
            <div key={hw.id} className="flex items-center gap-3 rounded-xl border bg-card p-4 shadow-sm">
              <Avatar name={hw.student_name} size={36} />
              <div className="min-w-0 flex-1">
                <div className="font-medium">{hw.student_name}</div>
                <div className="text-sm text-muted-foreground">
                  {hw.course_name} · {hw.description}
                </div>
                {hw.submitted_at && (
                  <div className="text-xs text-muted-foreground">
                    submitted {DateTime.fromISO(hw.submitted_at, { zone: "utc" }).setZone(teacher.timezone).toRelative()}
                  </div>
                )}
              </div>
              <Badge variant="default">Submitted</Badge>
              <Button asChild size="sm">
                <Link href={`/hw/${hw.id}`}>
                  <Eye className="h-4 w-4" /> Review work
                </Link>
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
