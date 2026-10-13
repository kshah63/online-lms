import Link from "next/link";
import { BookOpenCheck, CalendarClock, ListChecks, Play, ShieldAlert, Timer } from "lucide-react";
import { DateTime } from "luxon";
import { PageHeader, StatCard } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { PracticeStateChip } from "@/components/practice/practice-state-chip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { openAssignmentAction } from "@/lib/actions/attempts";
import { requireRole, viewerTimeZone } from "@/lib/data/auth";
import { listMyPractice } from "@/lib/data/attempts";
import { PRACTICE_KIND_LABEL, canOpen, practiceState, type PracticeRow } from "@/lib/practice/attempts";
import { dayLabel } from "@/lib/time";

/**
 * At-home practice and tests: rpc my_practice(30) — a student's own rows, a
 * parent's children's. The student opens an attempt from here (start_attempt);
 * a test goes to its own full-screen page. A parent sees the state and the
 * mark only: the questions and answers stay with the student.
 */
export default async function PracticePage() {
  const profile = await requireRole("student", "parent");
  const tz = viewerTimeZone(profile);
  const rows = await listMyPractice(profile, 30);
  const isStudent = profile.role === "student";
  const open = rows.filter(canOpen);
  const done = rows.filter((r) => !canOpen(r));
  const flagged = done.filter((r) => practiceState(r) === "flagged").length;

  return (
    <div>
      <PageHeader
        title="Practice"
        description={isStudent ? "Practice sets and tests your teacher has set, and how you did." : "What your child has been set, and the marks — the questions and answers stay with them."}
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label="To do" value={open.length} icon={<ListChecks className="h-4 w-4" />} tone={open.length ? "primary" : "default"} />
        <StatCard label="Done" value={done.length} tone="success" hint="last 30 days" icon={<BookOpenCheck className="h-4 w-4" />} />
        <StatCard label="Under review" value={flagged} tone={flagged ? "warning" : "default"} hint={flagged ? "a test flagged for the teacher" : "nothing flagged"} icon={<ShieldAlert className="h-4 w-4" />} />
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={<ListChecks className="h-5 w-5" />}
          title="Nothing set yet"
          description="When a teacher sets practice or a test, it appears here and the MathVision app lets you know."
        />
      ) : (
        <div className="space-y-6">
          <section>
            <h2 className="mb-3 text-sm font-semibold text-muted-foreground">To do</h2>
            {open.length === 0 ? (
              <p className="rounded-xl border border-dashed bg-card/50 px-4 py-6 text-center text-sm text-muted-foreground">All caught up.</p>
            ) : (
              <div className="space-y-3">
                {open.map((r) => (
                  <PracticeCard key={r.assignment_id} row={r} tz={tz} viewer={profile.role as "student" | "parent"} />
                ))}
              </div>
            )}
          </section>
          <section>
            <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Done</h2>
            {done.length === 0 ? (
              <p className="rounded-xl border border-dashed bg-card/50 px-4 py-6 text-center text-sm text-muted-foreground">Nothing finished yet.</p>
            ) : (
              <div className="space-y-3">
                {done.map((r) => (
                  <PracticeCard key={r.assignment_id} row={r} tz={tz} viewer={profile.role as "student" | "parent"} />
                ))}
              </div>
            )}
          </section>
          {rows.length >= 200 && <p className="text-sm text-muted-foreground">Showing the first 200 of your practice; older rows are in the MathVision app.</p>}
        </div>
      )}
    </div>
  );
}

function PracticeCard({ row, tz, viewer }: { row: PracticeRow; tz: string; viewer: "student" | "parent" }) {
  const state = practiceState(row);
  const due = row.due_at ? DateTime.fromISO(row.due_at, { zone: "utc" }).setZone(tz) : null;
  const overdue = due != null && due < DateTime.now() && state !== "submitted" && state !== "flagged";
  const isTest = row.kind === "test";

  return (
    <div className="flex flex-col gap-4 rounded-xl border bg-card p-4 shadow-sm sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{row.set_title}</span>
          <Badge variant="secondary">
            {isTest && <Timer className="h-3 w-3" />}
            {PRACTICE_KIND_LABEL[row.kind]}
          </Badge>
          {row.mode === "in_session" && <Badge variant="outline">In a lesson</Badge>}
          <PracticeStateChip row={row} />
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {row.course_name} · {row.question_count} question{row.question_count === 1 ? "" : "s"}
          {viewer === "parent" ? ` · ${row.student_name}` : ""}
        </p>
        <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>Set {dayLabel(row.assigned_at, tz)}</span>
          {due && (
            <span className={overdue ? "flex items-center gap-1 text-destructive" : "flex items-center gap-1"}>
              <CalendarClock className="h-3.5 w-3.5" /> {overdue ? "Was due" : "Due"} {dayLabel(row.due_at!, tz)}
            </span>
          )}
          {row.submitted_at && <span>Submitted {dayLabel(row.submitted_at, tz)}</span>}
          {state === "flagged" && <span className="text-destructive">Under review by the teacher</span>}
        </p>
      </div>

      {viewer === "student" && (
        <div className="flex shrink-0 items-center gap-2 sm:flex-col sm:items-end">
          {canOpen(row) ? (
            <form action={openAssignmentAction} className="flex flex-col items-end gap-1">
              <input type="hidden" name="assignment_id" value={row.assignment_id} />
              <input type="hidden" name="kind" value={row.kind} />
              <Button type="submit" size="sm" variant={isTest ? "default" : state === "in_progress" ? "secondary" : "default"}>
                <Play className="h-4 w-4" /> {isTest ? (state === "in_progress" ? "Back to the test" : "Open test") : state === "in_progress" ? "Continue" : "Start"}
              </Button>
              {isTest && <span className="max-w-[14rem] text-right text-[11px] text-muted-foreground">Opens full screen with a timer.</span>}
            </form>
          ) : row.attempt_id && state !== "void" ? (
            <Button asChild size="sm" variant="outline">
              <Link href={`/home/practice/${row.attempt_id}`}>See results</Link>
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}
