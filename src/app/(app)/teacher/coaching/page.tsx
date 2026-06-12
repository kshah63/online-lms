import Link from "next/link";
import { ArrowUpRight, Lightbulb, MessageCircleQuestion, Sparkles, TrendingUp, Users } from "lucide-react";
import { DateTime } from "luxon";
import { PageHeader, StatCard } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScoreBars, TrendBars } from "@/components/coaching/score-bars";
import { requireRole } from "@/lib/data/auth";
import { avgScore, getFeedbackHistory } from "@/lib/data/coaching";

export default async function TeacherCoachingPage() {
  const teacher = await requireRole("teacher");
  const history = await getFeedbackHistory(teacher.id);
  const latest = history[0];

  if (!latest) {
    return (
      <div>
        <PageHeader title="Coaching" description="Your AI coaching from recent lessons." />
        <EmptyState
          icon={<Sparkles className="h-5 w-5" />}
          title="No coaching yet"
          description="After your recorded lessons are analyzed, strengths-first coaching appears here."
        />
      </div>
    );
  }

  // Oldest → newest for trend bars.
  const chrono = [...history].reverse();
  const talkTrend = chrono.map((f) => f.metrics?.student_talk_pct ?? 0);
  const questionTrend = chrono.map((f) => f.metrics?.question_count ?? 0);
  const latestTalk = latest.metrics?.student_talk_pct ?? 0;

  return (
    <div>
      <PageHeader
        title="Coaching"
        description="Strengths first — what you're doing well, then a few things to try."
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Lessons coached" value={history.length} icon={<Sparkles className="h-4 w-4" />} />
        <StatCard label="Student talk" value={`${Math.round(latestTalk * 100)}%`} tone="primary" hint="last lesson" icon={<Users className="h-4 w-4" />} />
        <StatCard label="Questions" value={latest.metrics?.question_count ?? 0} hint="last lesson" icon={<MessageCircleQuestion className="h-4 w-4" />} />
        <StatCard label="Praise moments" value={latest.metrics?.praise_count ?? 0} tone="success" />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* Latest feedback */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Latest lesson</CardTitle>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  {latest.course_name} · {DateTime.fromISO(latest.created_at, { zone: "utc" }).setZone(teacher.timezone).toFormat("d LLL")}
                  <Link
                    href={`/coaching/${latest.session_id}`}
                    className="flex items-center gap-0.5 font-medium text-primary hover:underline"
                  >
                    Deep dive <ArrowUpRight className="h-3 w-3" />
                  </Link>
                </span>
              </div>
              <CardDescription>{latest.summary}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5 sm:grid-cols-2">
              <div>
                <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-success">
                  <Lightbulb className="h-4 w-4" /> Strengths
                </div>
                <ul className="space-y-1.5 text-sm">
                  {latest.strengths.map((s, i) => (
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
                  {latest.suggestions.map((s, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                      {s}
                    </li>
                  ))}
                </ul>
              </div>
            </CardContent>
          </Card>

          {/* Trends */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <TrendingUp className="h-4 w-4" /> Trends over time
              </CardTitle>
              <CardDescription>Across your last {chrono.length} coached lessons.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-6 sm:grid-cols-2">
              <div>
                <div className="mb-2 text-sm font-medium">Student talk-time</div>
                <TrendBars values={talkTrend} />
              </div>
              <div>
                <div className="mb-2 text-sm font-medium">Questions asked</div>
                <TrendBars values={questionTrend} format={(v) => `${Math.round(v)}`} />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Dimension scores + per-lesson history */}
        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">This lesson&rsquo;s scores</CardTitle>
              <CardDescription>1–5 across four coaching dimensions.</CardDescription>
            </CardHeader>
            <CardContent>
              <ScoreBars scores={latest.dimension_scores} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">All coached lessons</CardTitle>
              <CardDescription>Open any lesson for its full deep dive.</CardDescription>
            </CardHeader>
            <CardContent className="divide-y">
              {history.slice(0, 10).map((f) => (
                <Link
                  key={f.session_id}
                  href={`/coaching/${f.session_id}`}
                  className="group flex items-center gap-3 py-2.5 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium group-hover:text-primary">
                      {f.course_name} · {f.student_name}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {DateTime.fromISO(f.created_at, { zone: "utc" }).setZone(teacher.timezone).toFormat("d LLL, h:mm a")}
                    </div>
                  </div>
                  <span className="text-sm font-semibold tabular-nums">{avgScore(f)}</span>
                  <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary" />
                </Link>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
