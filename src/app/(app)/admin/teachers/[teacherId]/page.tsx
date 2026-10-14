import Link from "next/link";
import { ArrowLeft, ClipboardList } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { ChoiceChips } from "@/components/progress/choice-chips";
import { TeacherScorecardView } from "@/components/scorecard/teacher-scorecard";
import { requireRole, viewerTimeZone } from "@/lib/data/auth";
import { getTeacherScorecard } from "@/lib/data/scorecard";
import { SCORECARD_WINDOWS, scorecardWindow, type TeacherScorecard } from "@/lib/coaching/scorecard";
import { OFFICE_ROLES } from "@/lib/permissions";

/**
 * One teacher's scorecard for the office: rpc teacher_scorecard over the last
 * 30, 90 or 180 days (the window is a chip, never typed). Who may read it is
 * the RPC's decision — the teacher's room head and an admin; support and an
 * in-charge of a room the teacher has not taught in are refused — and a
 * refusal is shown as the sentence it came with.
 */
export default async function TeacherScorecardPage({ params, searchParams }: { params: { teacherId: string }; searchParams: { days?: string } }) {
  const viewer = await requireRole(...OFFICE_ROLES);
  const tz = viewerTimeZone(viewer);
  const days = scorecardWindow(searchParams.days);

  let card: TeacherScorecard | null = null;
  let refusal: string | null = null;
  try {
    card = await getTeacherScorecard(viewer, params.teacherId, days);
  } catch (err) {
    refusal = err instanceof Error ? err.message : "The scorecard could not be read.";
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={card ? `${card.teacher.name} — scorecard` : "Teacher scorecard"}
        description={`How the last ${days} days of lessons have gone: attendance, punctuality, coaching, reports and what families said.`}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/admin/coaching">
              <ArrowLeft className="h-4 w-4" /> Coaching QA
            </Link>
          </Button>
        }
      />

      <ChoiceChips label="Window" items={SCORECARD_WINDOWS.map((d) => ({ href: `/admin/teachers/${params.teacherId}?days=${d}`, label: `${d} days`, active: d === days }))} />

      {refusal ? (
        <EmptyState icon={<ClipboardList className="h-6 w-6" />} title="This scorecard could not be shown" description={refusal} />
      ) : card ? (
        <TeacherScorecardView card={card} tz={tz} />
      ) : null}
    </div>
  );
}
