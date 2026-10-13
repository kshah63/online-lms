import Link from "next/link";
import { notFound } from "next/navigation";
import { BookMarked, GitBranch } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { BankScreen } from "@/components/bank/bank-screen";
import { requireProfile, viewerTimeZone } from "@/lib/data/auth";
import { listCourseStudents, listManagedCourses, listPracticeSets, listQuestions, signedImageUrl } from "@/lib/data/bank";
import { listTopicOptions } from "@/lib/data/syllabus";
import { canManageCourse } from "@/lib/permissions-bank";
import { isDemoMode } from "@/lib/env";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * The question bank for the courses the viewer manages (rpc manages_course:
 * an admin, or an in-charge of the course's department). Anybody else — a
 * teacher, a family, an in-charge of another room — gets the 404 the lesson
 * page gives a viewer with no seat.
 */
export default async function BankPage({ searchParams }: { searchParams: { course?: string } }) {
  const viewer = await requireProfile();
  const courses = await listManagedCourses(viewer);
  if (courses.length === 0) notFound();

  const course = courses.find((c) => c.id === searchParams.course) ?? courses[0]!;
  if (!(await canManageCourse(viewer, course.id))) notFound();

  const [{ rows, total }, topics, sets, students] = await Promise.all([
    listQuestions(course.id),
    listTopicOptions(course.id),
    listPracticeSets(course.id),
    listCourseStudents(course.id),
  ]);
  const imageUrls: Record<string, string> = {};
  await Promise.all(
    rows
      .filter((q) => q.image_path)
      .slice(0, 50)
      .map(async (q) => {
        const url = await signedImageUrl(q.image_path);
        if (url) imageUrls[q.image_path!] = url;
      }),
  );

  return (
    <div>
      <PageHeader
        title="Question bank"
        description="Questions for practice sets and tests, reviewed by a person before any student sees them."
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href={`/syllabus/${course.id}`}>
              <GitBranch className="h-4 w-4" /> Edit syllabus
            </Link>
          </Button>
        }
      />

      {courses.length > 1 && (
        <nav className="mb-4 flex flex-wrap items-center gap-2" aria-label="Course">
          <BookMarked className="h-4 w-4 text-muted-foreground" />
          {courses.map((c) => (
            <Link
              key={c.id}
              href={`/bank?course=${c.id}`}
              aria-current={c.id === course.id ? "page" : undefined}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                c.id === course.id ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground",
              )}
            >
              {c.name}
            </Link>
          ))}
        </nav>
      )}

      <h2 className="mb-3 text-base font-semibold">
        {course.name}
        {topics.length === 0 && <span className="ml-2 text-sm font-normal text-muted-foreground">· no syllabus topics yet</span>}
      </h2>

      <BankScreen key={course.id} course={course} questions={rows} total={total} topics={topics} sets={sets} students={students} imageUrls={imageUrls} demoMode={isDemoMode} tz={viewerTimeZone(viewer)} />
    </div>
  );
}
