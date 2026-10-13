import Link from "next/link";
import { Camera, ChevronLeft, Flag, ShieldAlert, ShieldCheck } from "lucide-react";
import { DateTime } from "luxon";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { AnswerReview } from "@/components/practice/answer-review";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireRole, viewerTimeZone } from "@/lib/data/auth";
import { findMyPracticeRow, getAttemptQuestions, getAttemptReview, signQuestionImages, signSnapshots } from "@/lib/data/attempts";
import { getDisplayNames } from "@/lib/data/family";
import { INTEGRITY_KIND_LABEL, eventSeverity, formatMark, reviewHeadline, timelineSeverity, type AttemptReview, type IntegrityEventKind } from "@/lib/practice/attempts";
import { cn } from "@/lib/utils";
import { VoidAttemptButton } from "./void-button";

export const dynamic = "force-dynamic";

/**
 * A teacher's, in-charge's or admin's review of one attempt: rpc
 * flagged_attempt_review gives the attempt, its integrity timeline and the
 * answers; attempt_questions adds the stems and the answer key; the snapshots
 * are signed from test-snapshots under the reviewer's own session. The RPC
 * decides who may look (the assigner, manages_course, admin) and its refusal
 * is shown as it came.
 */
export default async function TestReviewPage({ params }: { params: { attemptId: string } }) {
  const profile = await requireRole("teacher", "staff", "admin");
  const tz = viewerTimeZone(profile);

  let review: AttemptReview;
  try {
    review = await getAttemptReview(profile, params.attemptId);
  } catch (e) {
    return (
      <div>
        <PageHeader title="Attempt review" />
        <EmptyState icon={<ShieldAlert className="h-5 w-5" />} title="This attempt could not be opened" description={e instanceof Error ? e.message : "The review was refused."} />
      </div>
    );
  }

  const { attempt, events } = review;
  const [questions, names, row] = await Promise.all([getAttemptQuestions(profile, attempt.id), getDisplayNames([attempt.student_id]), findMyPracticeRow(profile, attempt.id)]);
  const imageUrls = Object.fromEntries(await signQuestionImages(questions));
  const snapshotPaths = events.map((e) => e.snapshot_path).filter((p): p is string => Boolean(p));
  const signed = await signSnapshots(snapshotPaths);
  const studentName = names.get(attempt.student_id) ?? row?.student_name ?? "The student";
  const fmt = (iso: string | null) => (iso ? DateTime.fromISO(iso, { zone: "utc" }).setZone(tz).toFormat("ccc d LLL, h:mm:ss a") : "—");
  const scored = events.filter((e) => eventSeverity(e.kind) > 0);
  const answersById = new Map(review.answers.map((a) => [a.question_id, a]));

  return (
    <div>
      <PageHeader
        title={row?.set_title ?? "Attempt review"}
        description={`${studentName}${row ? ` · ${row.course_name}` : ""} · started ${fmt(attempt.started_at)}${attempt.submitted_at ? ` · submitted ${fmt(attempt.submitted_at)}` : " · not submitted"}`}
        actions={
          <>
            <Button asChild variant="ghost" size="sm">
              <Link href="/teacher">
                <ChevronLeft className="h-4 w-4" /> Back
              </Link>
            </Button>
            {attempt.status !== "void" && <VoidAttemptButton attemptId={attempt.id} studentName={studentName} />}
          </>
        }
      />

      <div className="mb-6 flex flex-wrap items-center gap-2">
        {attempt.status === "void" ? (
          <Badge variant="secondary">Voided</Badge>
        ) : attempt.integrity_flagged ? (
          <Badge variant="destructive">
            <Flag className="h-3 w-3" /> Flagged for review
          </Badge>
        ) : (
          <Badge variant="success">
            <ShieldCheck className="h-3 w-3" /> Not flagged
          </Badge>
        )}
        {attempt.score != null && attempt.out_of != null && (
          <Badge variant="outline">
            {formatMark(attempt.score)}/{formatMark(attempt.out_of)}
          </Badge>
        )}
        <Badge variant="outline">{attempt.status.replace("_", " ")}</Badge>
        {attempt.time_limit_minutes != null && <Badge variant="outline">{attempt.time_limit_minutes} min limit</Badge>}
        <span className="text-sm text-muted-foreground">{reviewHeadline(review)} · severity {timelineSeverity(events)}</span>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Integrity timeline</CardTitle>
          </CardHeader>
          <CardContent>
            {events.length === 0 ? (
              <p className="text-sm text-muted-foreground">No events were recorded on this attempt.</p>
            ) : (
              <ol className="space-y-1.5">
                {events.map((e, i) => {
                  const sev = eventSeverity(e.kind);
                  const label = INTEGRITY_KIND_LABEL[e.kind as IntegrityEventKind] ?? e.kind;
                  const url = e.snapshot_path ? signed.get(e.snapshot_path) : undefined;
                  return (
                    <li key={i} className={cn("flex items-start gap-3 rounded-md border px-3 py-2 text-sm", sev >= 2 ? "border-destructive/30 bg-destructive/5" : sev > 0 ? "border-warning/40 bg-warning/5" : "")}>
                      <span className="w-28 shrink-0 text-xs tabular-nums text-muted-foreground">{DateTime.fromISO(e.at, { zone: "utc" }).setZone(tz).toFormat("h:mm:ss a")}</span>
                      <span className="min-w-0 flex-1">
                        <span className="font-medium">{label}</span>
                        {e.detail && <span className="text-muted-foreground"> · {e.detail}</span>}
                        {e.kind === "snapshot" && !url && <span className="text-muted-foreground"> · {e.snapshot_path ? "file not available here" : "frame not uploaded"}</span>}
                      </span>
                      {sev > 0 && <span className={cn("shrink-0 text-xs font-semibold tabular-nums", sev >= 2 ? "text-destructive" : "text-warning-foreground")}>+{sev}</span>}
                      {url && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={url} alt="" className="h-10 w-14 shrink-0 rounded border object-cover" />
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
            {scored.length > 0 && <p className="mt-3 text-xs text-muted-foreground">An attempt flags at severity 6 or four scored events; bookkeeping rows (snapshots, pauses) count nothing.</p>}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Camera className="h-4 w-4" /> Snapshots
            </CardTitle>
          </CardHeader>
          <CardContent>
            {snapshotPaths.length === 0 ? (
              <p className="text-sm text-muted-foreground">No camera snapshots: the family had not turned on camera checks, or the attempt took none.</p>
            ) : signed.size === 0 ? (
              <p className="text-sm text-muted-foreground">
                {snapshotPaths.length} snapshot{snapshotPaths.length === 1 ? "" : "s"} were taken; the files are not available here{process.env.NODE_ENV !== "production" ? " (demo mode holds no files)" : ""}.
              </p>
            ) : (
              <ul className="grid grid-cols-3 gap-2">
                {snapshotPaths.map((p) => {
                  const url = signed.get(p);
                  const ev = events.find((e) => e.snapshot_path === p);
                  return (
                    <li key={p} className="text-center text-[11px] text-muted-foreground">
                      {url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={url} alt="" className="aspect-[4/3] w-full rounded border object-cover" />
                      ) : (
                        <div className="flex aspect-[4/3] items-center justify-center rounded border bg-secondary">unavailable</div>
                      )}
                      {ev && DateTime.fromISO(ev.at, { zone: "utc" }).setZone(tz).toFormat("h:mm a")}
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <h2 className="mb-3 mt-8 text-sm font-semibold text-muted-foreground">Answers</h2>
      <div className="max-w-3xl">
        <AnswerReview rows={questions.map((q) => {
          const a = answersById.get(q.id);
          return { ...q, response: a?.response ?? q.response, is_correct: a?.is_correct ?? q.is_correct, marks_awarded: a?.marks_awarded ?? q.marks_awarded, feedback: a?.feedback ?? q.feedback };
        })} imageUrls={imageUrls} />
      </div>
    </div>
  );
}
