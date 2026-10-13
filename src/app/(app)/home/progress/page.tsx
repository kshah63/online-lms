import Link from "next/link";
import { BarChart3, Users } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";
import { ChoiceChips } from "@/components/progress/choice-chips";
import { ProgressScreen } from "@/components/progress/progress-screen";
import { requireRole } from "@/lib/data/auth";
import { getChildren } from "@/lib/data/family";
import { getStudentsInMyRooms } from "@/lib/data/progress";
import { isFamily } from "@/lib/permissions";
import { displayName } from "@/lib/types";

/**
 * The family's progress page: a student sees their own, a parent each child
 * (chosen by chip, never typed). The office lands here only by the sidebar:
 * it lists the students whose online lessons they observe this fortnight,
 * each a door to /home/progress/<studentId>, which the app also opens by
 * ticket.
 */
export default async function ProgressPage({ searchParams }: { searchParams: { student?: string; course?: string } }) {
  const profile = await requireRole("student", "parent", "staff", "support", "admin");

  if (!isFamily(profile.role)) {
    const students = await getStudentsInMyRooms(profile);
    return (
      <div className="space-y-6">
        <PageHeader title="Progress" description="A child's progress opens from the MathVision app, or from the students in your rooms this fortnight." />
        {students.length === 0 ? (
          <EmptyState icon={<Users className="h-6 w-6" />} title="No students in your rooms this fortnight" description="Open a child's screen in the MathVision app and choose Progress & practice." />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {students.map((s) => (
              <Link key={s.id} href={`/home/progress/${s.id}`} className="block">
                <Card className="transition-colors hover:bg-secondary/60">
                  <CardContent className="flex items-center gap-3 p-4">
                    <Avatar name={s.name} size={32} />
                    <div className="min-w-0">
                      <div className="font-medium">{s.name}</div>
                      <div className="truncate text-xs text-muted-foreground">{s.subjects.join(" · ") || "Online lessons"}</div>
                    </div>
                    <BarChart3 className="ml-auto h-4 w-4 text-muted-foreground" />
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    );
  }

  const children = await getChildren(profile);
  const student = children.find((c) => c.id === searchParams.student) ?? children[0] ?? null;
  if (!student) {
    return (
      <div className="space-y-6">
        <PageHeader title="Progress" description="Topics covered, practice volume and where help is needed." />
        <EmptyState icon={<BarChart3 className="h-6 w-6" />} title="No child on this account yet" description="Children are added to a family in the MathVision app." />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {children.length > 1 && (
        <ChoiceChips label="Child" items={children.map((c) => ({ href: `/home/progress?student=${c.id}`, label: displayName(c), active: c.id === student.id }))} />
      )}
      <ProgressScreen viewer={profile} student={student} courseId={searchParams.course ?? null} basePath="/home/progress" query={{ student: student.id }} />
    </div>
  );
}
