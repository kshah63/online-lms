import Link from "next/link";
import { BarChart3, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { ChoiceChips } from "@/components/progress/choice-chips";
import { ProgressDashboard } from "@/components/progress/progress-dashboard";
import { getProgressCourses, getProgressView } from "@/lib/data/progress";
import { isFamily } from "@/lib/permissions";
import type { ProgressPageData } from "@/lib/syllabus/from-rpc";
import { displayName, type Profile } from "@/lib/types";

/**
 * One student's progress on one course: the course picker when they have
 * more than one, then the dashboard. Shared by /home/progress (the family's
 * own view) and /home/progress/[studentId] (a child by ticket from the app).
 * A refusal from child_progress is shown as the sentence it came with.
 */
export async function ProgressScreen({
  viewer,
  student,
  courseId,
  /** The path the course chips link to; the course goes in `?course=`. */
  basePath,
  query = {},
}: {
  viewer: Profile;
  student: Pick<Profile, "id" | "full_name" | "preferred_name">;
  courseId: string | null;
  basePath: string;
  query?: Record<string, string>;
}) {
  const courses = await getProgressCourses(student.id);
  const course = courses.find((c) => c.id === courseId) ?? courses[0] ?? null;

  let data: ProgressPageData | null = null;
  let refusal: string | null = null;
  if (course) {
    try {
      data = await getProgressView(viewer, student.id, course.id);
    } catch (err) {
      refusal = err instanceof Error ? err.message : "The progress could not be read.";
    }
  }

  // The name the viewer may already see (their child, a student in their room), else what the RPC called them.
  const name = student.full_name || student.preferred_name ? displayName(student) : "";
  const first = name.split(/\s+/)[0] || data?.view.student.first_name || "This student";

  const hrefFor = (id: string) => {
    const params = new URLSearchParams({ ...query, course: id });
    return `${basePath}?${params.toString()}`;
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${first}'s progress`}
        description={course ? `${course.name} · topics covered, practice and where help is needed` : "Topics covered, practice volume and where help is needed."}
        actions={
          isFamily(viewer.role) ? (
            <Button asChild variant="outline" size="sm">
              <Link href="/settings/consents">
                <ShieldCheck className="h-4 w-4" /> Lesson consents
              </Link>
            </Button>
          ) : undefined
        }
      />

      {courses.length > 1 && <ChoiceChips label="Course" items={courses.map((c) => ({ href: hrefFor(c.id), label: c.name, active: c.id === course?.id }))} />}

      {!course ? (
        <EmptyState
          icon={<BarChart3 className="h-6 w-6" />}
          title="No online course yet"
          description={`Once ${first} has an online lesson booked in the MathVision app, the picture builds up here.`}
        />
      ) : refusal ? (
        <EmptyState icon={<BarChart3 className="h-6 w-6" />} title="This progress could not be shown" description={refusal} />
      ) : data ? (
        <ProgressDashboard view={data.view} reports={data.reports} />
      ) : null}
    </div>
  );
}
