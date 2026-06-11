import { BookOpen, GraduationCap, X } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AddCourseDialog } from "@/components/admin/add-course-dialog";
import { EnrollControl } from "@/components/admin/enroll-control";
import { requireRole } from "@/lib/data/auth";
import { listCourses, listEnrollments, listStudents } from "@/lib/data/people";
import { unenrollStudent } from "@/lib/actions/courses";

export default async function AdminCoursesPage() {
  await requireRole("admin");
  const [courses, students, enrollments] = await Promise.all([
    listCourses(),
    listStudents(),
    listEnrollments(),
  ]);

  // Group enrolled students by course.
  const byCourse = new Map<string, { id: string; display_name: string }[]>();
  for (const e of enrollments) {
    const list = byCourse.get(e.course_id) ?? [];
    list.push(e.student);
    byCourse.set(e.course_id, list);
  }

  return (
    <div>
      <PageHeader
        title="Courses"
        description="Create courses and manage who's enrolled. Students can only book lessons for courses they're enrolled in."
        actions={<AddCourseDialog />}
      />

      {courses.length === 0 ? (
        <EmptyState
          icon={<BookOpen className="h-5 w-5" />}
          title="No courses yet"
          description="Add your first course to start enrolling students."
          action={<AddCourseDialog />}
        />
      ) : (
        <div className="space-y-4">
          {courses.map((course) => {
            const enrolled = byCourse.get(course.id) ?? [];
            const enrolledIds = new Set(enrolled.map((s) => s.id));
            const available = students
              .filter((s) => !enrolledIds.has(s.id))
              .map((s) => ({ id: s.id, display_name: s.display_name }));

            return (
              <Card key={course.id}>
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <BookOpen className="h-4 w-4 text-primary" />
                      {course.name}
                      {course.subject && <Badge variant="secondary">{course.subject}</Badge>}
                    </CardTitle>
                    <span className="text-xs text-muted-foreground">
                      {enrolled.length} {enrolled.length === 1 ? "student" : "students"}
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {enrolled.length === 0 ? (
                    <p className="flex items-center gap-2 text-sm text-muted-foreground">
                      <GraduationCap className="h-4 w-4" /> No students enrolled yet.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {enrolled.map((s) => (
                        <span
                          key={s.id}
                          className="flex items-center gap-1.5 rounded-full border bg-secondary/50 py-1 pl-1 pr-1.5 text-sm"
                        >
                          <Avatar name={s.display_name} size={20} />
                          {s.display_name}
                          <form action={unenrollStudent}>
                            <input type="hidden" name="course_id" value={course.id} />
                            <input type="hidden" name="student_id" value={s.id} />
                            <Button
                              type="submit"
                              variant="ghost"
                              size="icon"
                              className="h-5 w-5 text-muted-foreground hover:text-destructive"
                              title="Remove from course"
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          </form>
                        </span>
                      ))}
                    </div>
                  )}
                  <EnrollControl courseId={course.id} available={available} />
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
