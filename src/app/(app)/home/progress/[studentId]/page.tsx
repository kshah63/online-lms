import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { ProgressScreen } from "@/components/progress/progress-screen";
import { Button } from "@/components/ui/button";
import { requireRole } from "@/lib/data/auth";
import { getDisplayNames } from "@/lib/data/family";
import { isFamily } from "@/lib/permissions";

/**
 * One child's progress by id — the door the MathVision app opens by ticket
 * from the child screen (parent) or the roster (in-charge, admin). Who may
 * read it is child_progress's decision; a refusal is shown as its sentence.
 */
export default async function StudentProgressPage({ params, searchParams }: { params: { studentId: string }; searchParams: { course?: string } }) {
  const profile = await requireRole("student", "parent", "staff", "support", "admin");
  const names = await getDisplayNames([params.studentId]);
  const student = { id: params.studentId, full_name: names.get(params.studentId) ?? "", preferred_name: null };

  return (
    <div>
      {!isFamily(profile.role) && (
        <Button asChild variant="ghost" size="sm" className="mb-3 -ml-2">
          <Link href="/home/progress">
            <ChevronLeft className="h-4 w-4" /> Students
          </Link>
        </Button>
      )}
      <ProgressScreen viewer={profile} student={student} courseId={searchParams.course ?? null} basePath={`/home/progress/${params.studentId}`} />
    </div>
  );
}
