import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ArrowUpRight,
  Lightbulb,
  MessageSquareQuote,
  Radio,
  Sparkles,
} from "lucide-react";
import { DateTime } from "luxon";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScoreBars } from "@/components/coaching/score-bars";
import { cn } from "@/lib/utils";
import { requireRole } from "@/lib/data/auth";
import { getFeedbackDetail } from "@/lib/data/coaching";
import type { TranscriptSegment } from "@/lib/coaching/metrics";

function fmt(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function pct(x: number) {
  return `${Math.round(x * 100)}%`;
}

export default async function CoachingDetailPage({ params }: { params: { sessionId: string } }) {
  const profile = await requireRole("teacher", "admin");
  const detail = await getFeedbackDetail(params.sessionId);
  if (!detail) notFound();
  // Teachers may only open their own lessons (RLS enforces this for the
  // transcript too; this guards the feedback shell).
  if (profile.role === "teacher" && detail.teacher_id !== profile.id) notFound();

  const when = DateTime.fromISO(detail.created_at, { zone: "utc" })
    .setZone(profile.timezone)
    .toFormat("cccc d LLL yyyy, h:mm a");
  const backHref = profile.role === "admin" ? "/admin/coaching" : "/teacher/coaching";
  const m = detail.metrics;

  return (
    <div>
      <PageHeader
        title={`${detail.course_name} — coaching detail`}
        description={`${detail.student_name} · ${when}${profile.role === "admin" ? ` · ${detail.teacher_name}` : ""}`}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href={backHref}>
              <ArrowLeft className="h-4 w-4" /> Back
            </Link>
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* Summary + strengths/suggestions */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Lesson summary</CardTitle>
              <CardDescription>{detail.summary}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5 sm:grid-cols-2">
              <div>
                <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-success">
                  <Lightbulb className="h-4 w-4" /> Strengths
                </div>
                <ul className="space-y-1.5 text-sm">
                  {detail.strengths.map((s, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-success" />
                      {s}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-primary">
                  <Sparkles className="h-4 w-4" /> Things to try
                </div>
                <ul className="space-y-1.5 text-sm">
                  {detail.suggestions.map((s, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                      {s}
                    </li>
                  ))}
                </ul>
              </div>
            </CardContent>
          </Card>

          {/* Key moments — the deep dive */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <MessageSquareQuote className="h-4 w-4" /> Key moments
              </CardTitle>
              <CardDescription>
                Specific situations from the transcript — what worked, and what to do differently next time.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {detail.moments.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No timestamped moments for this lesson — it was analyzed before key moments were added
                  (or without the AI pass). New lessons will include them automatically.
                </p>
              ) : (
                <ol className="relative space-y-5 border-l pl-5">
                  {detail.moments.map((mo, i) => {
                    const strength = mo.kind === "strength";
                    return (
                      <li key={i} className="relative">
                        <span
                          className={cn(
                            "absolute -left-[26px] top-1 h-3 w-3 rounded-full border-2 border-background",
                            strength ? "bg-success" : "bg-warning",
                          )}
                          aria-hidden
                        />
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs text-muted-foreground">{mo.at}</span>
                          <Badge variant={strength ? "success" : "warning"}>
                            {strength ? "strength" : "could improve"}
                          </Badge>
                        </div>
                        <blockquote className="mt-1.5 border-l-2 border-border pl-3 text-sm italic text-muted-foreground">
                          &ldquo;{mo.quote}&rdquo;
                        </blockquote>
                        <p className="mt-1.5 text-sm">{mo.comment}</p>
                      </li>
                    );
                  })}
                </ol>
              )}
            </CardContent>
          </Card>

          {/* Full transcript */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Transcript</CardTitle>
              <CardDescription>
                {detail.segments.length
                  ? `${detail.segments.length} segments — timestamps match the key moments above.`
                  : "No transcript was stored for this lesson."}
              </CardDescription>
            </CardHeader>
            {detail.segments.length > 0 && (
              <CardContent>
                <details>
                  <summary className="cursor-pointer text-sm font-medium text-primary hover:underline">
                    Show full transcript
                  </summary>
                  <div className="mt-3 max-h-96 space-y-1.5 overflow-y-auto rounded-lg bg-secondary/40 p-3 text-sm">
                    {detail.segments.map((seg: TranscriptSegment, i: number) => (
                      <p key={i} className="leading-relaxed">
                        <span className="font-mono text-xs text-muted-foreground">[{fmt(seg.start_ms)}]</span>{" "}
                        <span className={cn("font-semibold", seg.speaker === "teacher" ? "text-indigo-700" : "text-primary")}>
                          {seg.speaker === "teacher" ? "Teacher" : "Student"}:
                        </span>{" "}
                        {seg.text}
                      </p>
                    ))}
                  </div>
                </details>
              </CardContent>
            )}
          </Card>
        </div>

        {/* Right rail: scores, metrics, live nudges */}
        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Dimension scores</CardTitle>
              <CardDescription>1–5 across four coaching dimensions.</CardDescription>
            </CardHeader>
            <CardContent>
              <ScoreBars scores={detail.dimension_scores} />
            </CardContent>
          </Card>

          {m && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Lesson metrics</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="space-y-2 text-sm">
                  <Metric label="Student talk time" value={pct(m.student_talk_pct)} />
                  <Metric label="Teacher talk time" value={pct(m.teacher_talk_pct)} />
                  <Metric label="Questions asked" value={String(m.question_count)} />
                  <Metric label="Open questions" value={pct(m.open_question_pct)} />
                  <Metric label="Avg wait after a question" value={`${(m.avg_wait_ms / 1000).toFixed(1)}s`} />
                  <Metric label="Student turns" value={String(m.student_turns)} />
                  <Metric label="Praise moments" value={String(m.praise_count)} />
                </dl>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Radio className="h-4 w-4" /> Live nudges shown
              </CardTitle>
              <CardDescription>
                {detail.nudges.length
                  ? "What the live coach surfaced during the lesson."
                  : "No live nudges fired during this lesson."}
              </CardDescription>
            </CardHeader>
            {detail.nudges.length > 0 && (
              <CardContent>
                <ul className="space-y-2.5 text-sm">
                  {detail.nudges.map((n, i) => (
                    <li key={i} className="flex gap-2">
                      <ArrowUpRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span>
                        {n.message || n.type.replace(/_/g, " ")}
                        <span className="ml-1 text-xs text-muted-foreground">
                          ({DateTime.fromISO(n.created_at, { zone: "utc" }).setZone(profile.timezone).toFormat("h:mm a")})
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}
