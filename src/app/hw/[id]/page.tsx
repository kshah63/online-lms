import { notFound } from "next/navigation";
import { HomeworkCanvasLoader } from "@/components/homework/homework-canvas-loader";
import { requireProfile, homePathForRole } from "@/lib/data/auth";
import { getChildren } from "@/lib/data/people";
import { getHomework } from "@/lib/data/homework";
import { loadNotebookSnapshot } from "@/lib/actions/notebook";
import { isDemoMode } from "@/lib/env";
import { demoTeacherCourse } from "@/lib/demo/data";

/** Full-screen homework canvas — one route, mode adapts to the viewer's role. */
export default async function HomeworkCanvasPage({ params }: { params: { id: string } }) {
  const profile = await requireProfile();
  const hw = await getHomework(params.id);
  if (!hw) notFound();

  let allowed = false;
  let mode: "student" | "review" | "view" = "view";
  let backHref = homePathForRole(profile.role);

  if (profile.role === "admin") {
    allowed = true;
  } else if (profile.role === "student") {
    allowed = hw.student_id === profile.id;
    mode = "student";
    backHref = "/home/homework";
  } else if (profile.role === "parent") {
    const kids = await getChildren(profile);
    allowed = kids.some((k) => k.id === hw.student_id);
    backHref = "/home/homework";
  } else if (profile.role === "teacher") {
    mode = "review";
    backHref = "/teacher/homework";
    // Real mode: RLS already scoped getHomework to the teacher's students.
    allowed = isDemoMode ? (demoTeacherCourse[profile.id] ?? []).includes(hw.course_id ?? "") : true;
  }
  if (!allowed) notFound();

  const notebookId = hw.notebook_id ?? hw.id;
  const initialSnapshot = await loadNotebookSnapshot(notebookId);

  return (
    <HomeworkCanvasLoader
      homeworkId={hw.id}
      description={hw.description}
      courseName={hw.course_name}
      studentName={hw.student_name}
      status={hw.status}
      reviewNote={hw.review_note}
      notebookId={notebookId}
      pageId={hw.notebook_page_id}
      userId={profile.id}
      userName={profile.display_name}
      initialSnapshot={initialSnapshot}
      mode={mode}
      backHref={backHref}
    />
  );
}
