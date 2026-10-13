import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { SyllabusEditor } from "@/components/syllabus/syllabus-editor";
import { requireProfile } from "@/lib/data/auth";
import { getCourse } from "@/lib/data/bank";
import { countCourseTopics, listSyllabusTopics } from "@/lib/data/syllabus";
import { canManageCourse } from "@/lib/permissions-bank";

export const dynamic = "force-dynamic";

/** The syllabus for one course the viewer manages (rpc manages_course); anybody else gets the 404. */
export default async function SyllabusPage({ params }: { params: { courseId: string } }) {
  const viewer = await requireProfile();
  if (!(await canManageCourse(viewer, params.courseId))) notFound();
  const course = await getCourse(params.courseId);
  if (!course) notFound();

  const [topics, courseTopicCount] = await Promise.all([listSyllabusTopics(course.id), countCourseTopics(course.id)]);

  return (
    <div>
      <Button asChild variant="ghost" size="sm" className="mb-3 -ml-2">
        <Link href={`/bank?course=${course.id}`}>
          <ChevronLeft className="h-4 w-4" /> Question bank
        </Link>
      </Button>
      <PageHeader
        title={`Syllabus — ${course.name}`}
        description="The topics a student's progress is read against: reports, practice and tests all count towards one of these."
      />
      <SyllabusEditor key={course.id} course={course} topics={topics} courseTopicCount={courseTopicCount} />
    </div>
  );
}
