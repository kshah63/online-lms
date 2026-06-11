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
import { getPendingEnrollmentRequests, listCourses, listEnrollments, listStudents } from "@/lib/data/people";
import { unenrollStudent } from "@/lib/actions/courses";
import { decideEnrollment } from "@/lib/actions/enrollment";
import { Check } from "lucide-react";

export default async function AdminCoursesPage() {
  await requireRole("admin");
  const [courses, students, enrollments, requests] = await Promise.all([
    listCourses(),
    listStudents(),
    listEnrollments(),
    getPendingEnrollmentRequests(),
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

      {requests.length > 0 && (
        <Card className="mb-6 border-primary/30 bg-accent/30">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <GraduationCap className="h-4 w-4 text-primary" /> Enrollment requests ({requests.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="divide-y">
            {requests.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <Avatar name={r.student.display_name} size={28} />
                <span className="text-sm font-medium">{r.student.display_name}</span>
                <span className="text-sm text-muted-foreground">wants</span>
                <Badge variant="secondary">{r.course.name}</Badge>
                <div className="ml-auto flex items-center gap-2">
                  <form action={decideEnrollment}>
                    <input type="hidden" name="id" value={r.id} />
                    <input type="hidden" name="decision" value="approved" />
                    <Button type="submit" size="sm" variant="success">
                      <Check className="h-4 w-4" /> Approve
                    </Button>
                  </form>
                  <form action={decideEnrollment}>
                    <input type="hidden" name="id" value={r.id} />
                    <input type="hidden" name="decision" value="denied" />
                    <Button type="submit" size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive">
                      <X className="h-4 w-4" /> Deny
                    </Button>
                  </form>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

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
