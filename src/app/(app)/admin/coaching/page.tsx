import { AlertTriangle, Sparkles } from "lucide-react";
import { DateTime } from "luxon";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScoreBars } from "@/components/coaching/score-bars";
import { requireRole } from "@/lib/data/auth";
import { avgScore, getAllTeachersLatest } from "@/lib/data/coaching";

const FLAG_THRESHOLD = 3; // flag teachers whose engagement is below this for review

export default async function AdminCoachingPage() {
  const admin = await requireRole("admin");
  const latest = await getAllTeachersLatest();

  return (
    <div>
      <PageHeader
        title="Coaching QA"
        description="Every teacher's latest AI coaching — review lessons flagged by low engagement."
      />

      {latest.length === 0 ? (
        <EmptyState icon={<Sparkles className="h-5 w-5" />} title="No coaching data yet" />
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
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
