import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { ProgressDashboard } from "@/components/progress/progress-dashboard";
import { requireRole } from "@/lib/data/auth";
import { getChildren } from "@/lib/data/family";
import { getProgressView } from "@/lib/data/progress";
import { BarChart3 } from "lucide-react";

export default async function ProgressPage({ searchParams }: { searchParams: { student?: string } }) {
  const profile = await requireRole("student", "parent");
  const children = await getChildren(profile);
  const student = children.find((c) => c.id === searchParams.student) ?? children[0] ?? null;
  const view = student ? await getProgressView(student.id, null) : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={view ? `${view.student.first_name}'s progress` : "Progress"}
        description={view ? `${view.course.name} · topics covered, practice and where help is needed` : "Topics covered, practice volume and weak areas."}
      />
      {view ? (
        <ProgressDashboard view={view} />
      ) : (
        <EmptyState icon={<BarChart3 className="h-6 w-6" />} title="No progress data yet" description="Once lessons, practice and tests are recorded on the platform, the picture builds up here." />
      )}
    </div>
  );
}
