import Link from "next/link";
import { AlertTriangle, ArrowUpRight, Loader2, MicOff, Sparkles } from "lucide-react";
import { DateTime } from "luxon";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScoreBars } from "@/components/coaching/score-bars";
import { cn } from "@/lib/utils";
import { requireRole } from "@/lib/data/auth";
import { analysisStatusLabel, avgScore, getAllTeachersLatest, getAnalysisQueue } from "@/lib/data/coaching";

const FLAG_THRESHOLD = 3; // flag teachers whose engagement is below this for review

export default async function AdminCoachingPage() {
  const admin = await requireRole("admin");
  const [latest, queue] = await Promise.all([getAllTeachersLatest(), getAnalysisQueue({ limit: 10 }).catch(() => [])]);

  return (
    <div>
      <PageHeader
        title="Coaching QA"
        description="Every teacher's latest AI coaching — review lessons flagged by low engagement. Evaluation runs for every teacher on every recorded lesson."
      />

      {/* Post-session analysis state across all teachers (sessions.analysis_status) */}
      {queue.length > 0 && (
        <Card className="mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Lessons without coaching yet</CardTitle>
          </CardHeader>
          <CardContent className="divide-y">
            {queue.map((it) => {
              const n = analysisStatusLabel(it.analysis_status);
              return (
                <div key={it.session_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm first:pt-0 last:pb-0">
                  {n.tone === "pending" ? (
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
                  ) : n.tone === "warning" ? (
                    <AlertTriangle className="h-4 w-4 shrink-0 text-warning-foreground" />
                  ) : (
                    <MicOff className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                  <Badge
                    variant={n.tone === "pending" ? "default" : n.tone === "warning" ? "warning" : "secondary"}
                    className={cn(n.tone === "muted" && "text-muted-foreground")}
                  >
                    {n.title}
                  </Badge>
                  <span className="font-medium">{it.teacher_name}</span>
                  <span className="text-muted-foreground">
                    {it.course_name} · {it.student_name} ·{" "}
                    {DateTime.fromISO(it.scheduled_start, { zone: "utc" }).setZone(admin.timezone).toFormat("d LLL, h:mm a")}
                  </span>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {latest.length === 0 ? (
        <EmptyState
          icon={<Sparkles className="h-5 w-5" />}
          title="No coaching data yet"
          description="Coaching lands about 30–60 minutes after a recorded lesson ends."
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {latest.map((f) => {
            const flagged = f.dimension_scores.engagement < FLAG_THRESHOLD;
            return (
              <Card key={f.teacher_id} className={flagged ? "border-warning/40" : undefined}>
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-3">
                    <Avatar name={f.teacher_name} size={38} />
                    <div className="min-w-0 flex-1">
                      <CardTitle className="text-base">{f.teacher_name}</CardTitle>
                      <p className="text-xs text-muted-foreground">
                        {f.course_name} · {DateTime.fromISO(f.created_at, { zone: "utc" }).setZone(admin.timezone).toFormat("d LLL")}
                      </p>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-semibold tabular-nums">{avgScore(f)}</div>
                      <div className="text-[10px] uppercase text-muted-foreground">avg</div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {flagged && (
                    <Badge variant="warning" className="gap-1">
                      <AlertTriangle className="h-3 w-3" /> Low engagement — review
                    </Badge>
                  )}
                  <p className="text-sm text-muted-foreground">{f.summary}</p>
                  <ScoreBars scores={f.dimension_scores} />
                  <Link
                    href={`/coaching/${f.session_id}`}
                    className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                  >
                    Deep dive — key moments &amp; transcript <ArrowUpRight className="h-3.5 w-3.5" />
                  </Link>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
