"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Table2 } from "lucide-react";
import { DateTime } from "luxon";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { onTimeShare, reportsShare, type ScorecardCounted, type ScorecardDimension, type TeacherScorecard } from "@/lib/coaching/scorecard";

// ============================================================================
// The office's teacher scorecard. Built on the same data-viz method as the
// progress dashboard: one hue for magnitude, status colours nowhere (nothing
// here is good or bad by itself), thin marks on a hairline grid, a table twin
// for the chart, tooltips that enhance but never gate, and every figure
// readable without colour.
// ============================================================================

const SCALE_MAX = 5;
const pct = (x: number | null) => (x == null ? "—" : `${Math.round(x * 100)}%`);
const one = (x: number | null) => (x == null ? "—" : x.toFixed(1));

export function TeacherScorecardView({ card, tz }: { card: TeacherScorecard; tz: string }) {
  const onTime = onTimeShare(card);
  const written = reportsShare(card);
  const p = card.punctuality;
  const r = card.reports;

  return (
    <div className="viz-root space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Lessons taught" value={String(card.lessons.taught)} sub={`${card.lessons.online} online · ${card.lessons.in_person} in person · ${card.lessons.no_shows} no-shows`} />
        <StatTile
          label="On time"
          value={pct(onTime)}
          sub={
            p.online_with_host_join === 0
              ? "no online lesson recorded a host join"
              : `of ${p.online_with_host_join} online lessons · median ${one(p.median_minutes_late)} min late · ${p.late_over_5_min} over five minutes`
          }
        >
          {onTime != null && <Meter value={onTime} />}
        </StatTile>
        <StatTile
          label="Reports written"
          value={r.due === 0 ? "—" : `${r.written} of ${r.due}`}
          sub={r.due === 0 ? "no lesson taught, so none due" : `median ${one(r.median_hours_to_write)} h after the lesson · ${r.published} published · ${r.rejected} rejected`}
        >
          {written != null && <Meter value={written} />}
        </StatTile>
        <StatTile label="Average rating" value={card.ratings.average == null ? "—" : `${one(card.ratings.average)} of 5`} sub={`${card.ratings.count} ${card.ratings.count === 1 ? "rating" : "ratings"} from families`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <DimensionsChart dimensions={card.coaching.dimensions} lessons={card.coaching.lessons_with_feedback} />
        <LessonMetrics card={card} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <CountedList title="Strengths" subtitle="What the coaching found most often" items={card.coaching.strengths_top} empty="No coached lessons in this window." />
        <CountedList title="Things to try" subtitle="The suggestions that came up most" items={card.coaching.suggestions_top} empty="No coached lessons in this window." />
      </div>

      <Followups followups={card.followups} />

      <RecentLessons lessons={card.recent_lessons} tz={tz} />
    </div>
  );
}

// --- figures ---------------------------------------------------------------

function StatTile({ label, value, sub, children }: { label: string; value: string; sub?: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-xl border p-4" style={{ background: "var(--viz-surface)", borderColor: "var(--viz-border)" }}>
      <div className="text-xs" style={{ color: "var(--viz-text-2)" }}>
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold" style={{ color: "var(--viz-text)" }}>
        {value}
      </div>
      {sub && (
        <div className="mt-0.5 text-xs" style={{ color: "var(--viz-text-2)" }}>
          {sub}
        </div>
      )}
      {children && <div className="mt-3">{children}</div>}
    </div>
  );
}

/** Same-ramp track: fill in the series hue, track a lighter step of the same ramp. */
function Meter({ value }: { value: number }) {
  const w = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className="h-2 w-full overflow-hidden rounded-full" style={{ background: "var(--viz-series-1-track)" }} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(w)}>
      <div className="h-full rounded-full" style={{ width: `${w}%`, background: "var(--viz-series-1)" }} />
    </div>
  );
}

// --- the chart --------------------------------------------------------------

function ChartCard({ title, subtitle, table, children }: { title: string; subtitle?: string; table: React.ReactNode; children: React.ReactNode }) {
  const [showTable, setShowTable] = useState(false);
  const id = useId();
  return (
    <figure className="rounded-xl border p-4" style={{ background: "var(--viz-surface)", borderColor: "var(--viz-border)" }} aria-labelledby={id}>
      <figcaption className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div id={id} className="text-sm font-semibold" style={{ color: "var(--viz-text)" }}>
            {title}
          </div>
          {subtitle && (
            <div className="text-xs" style={{ color: "var(--viz-text-2)" }}>
              {subtitle}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => setShowTable((v) => !v)}
          className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs"
          style={{ color: "var(--viz-text-2)", borderColor: "var(--viz-border)" }}
          aria-pressed={showTable}
        >
          <Table2 className="h-3.5 w-3.5" /> {showTable ? "Chart" : "Table"}
        </button>
      </figcaption>
      {showTable ? table : children}
    </figure>
  );
}

/** The coaching dimensions' averages, 1–5, one series: a bar per dimension with its value at the data end. */
function DimensionsChart({ dimensions, lessons }: { dimensions: ScorecardDimension[]; lessons: number }) {
  const [hover, setHover] = useState<string | null>(null);
  const rowH = 30;
  const labelW = 120;
  const w = 520;
  const h = Math.max(72, dimensions.length * rowH + 28);
  const plotW = w - labelW - 56;
  const ticks = [0, 1, 2, 3, 4, 5];

  const table = (
    <table className="w-full text-sm" style={{ color: "var(--viz-text)" }}>
      <thead>
        <tr className="text-left text-xs" style={{ color: "var(--viz-text-2)" }}>
          <th className="py-1 font-medium">Dimension</th>
          <th className="py-1 text-right font-medium">Average of 5</th>
        </tr>
      </thead>
      <tbody>
        {dimensions.map((d) => (
          <tr key={d.key} className="border-t" style={{ borderColor: "var(--viz-grid)" }}>
            <td className="py-1">{d.label}</td>
            <td className="py-1 text-right tabular-nums">{d.mean.toFixed(1)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <ChartCard title="Coaching dimensions" subtitle={lessons ? `Average score across ${lessons} coached ${lessons === 1 ? "lesson" : "lessons"}, of 5` : "Average score of 5"} table={table}>
      {dimensions.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--viz-text-2)" }}>
          No coached lessons in this window.
        </p>
      ) : (
        <div className="relative">
          <svg viewBox={`0 0 ${w} ${h}`} className="h-auto w-full" role="img" aria-label="Average coaching score by dimension">
            {ticks.map((t) => {
              const x = labelW + (t / SCALE_MAX) * plotW;
              return (
                <g key={t}>
                  <line x1={x} x2={x} y1={4} y2={h - 20} stroke={t === 0 ? "var(--viz-baseline)" : "var(--viz-grid)"} strokeWidth={1} />
                  <text x={x} y={h - 6} textAnchor="middle" fontSize={11} fill="var(--viz-muted)">
                    {t}
                  </text>
                </g>
              );
            })}
            {dimensions.map((d, i) => {
              const y = 8 + i * rowH;
              const bw = (Math.max(0, Math.min(SCALE_MAX, d.mean)) / SCALE_MAX) * plotW;
              const isHover = hover === d.key;
              return (
                <g key={d.key} onPointerEnter={() => setHover(d.key)} onPointerLeave={() => setHover(null)} tabIndex={0} onFocus={() => setHover(d.key)} onBlur={() => setHover(null)}>
                  <rect x={0} y={y - 4} width={w} height={rowH} fill="transparent" />
                  <text x={labelW - 10} y={y + 13} textAnchor="end" fontSize={12} fill="var(--viz-text)">
                    {d.label}
                  </text>
                  <path d={roundedRight(labelW, y + 2, bw, 14, 4)} fill="var(--viz-series-1)" opacity={isHover ? 0.85 : 1} />
                  <text x={labelW + bw + 6} y={y + 13} fontSize={11} fill="var(--viz-text-2)">
                    {d.mean.toFixed(1)}
                  </text>
                </g>
              );
            })}
          </svg>
          {hover != null && (
            <div className="pointer-events-none absolute right-0 top-0 rounded-md border px-2 py-1 text-xs shadow-sm" style={{ background: "var(--viz-surface)", color: "var(--viz-text)", borderColor: "var(--viz-border)" }}>
              <strong>{dimensions.find((d) => d.key === hover)?.mean.toFixed(1)}</strong>{" "}
              <span style={{ color: "var(--viz-text-2)" }}>
                {dimensions.find((d) => d.key === hover)?.label} · across {lessons} {lessons === 1 ? "lesson" : "lessons"}
              </span>
            </div>
          )}
        </div>
      )}
    </ChartCard>
  );
}

/** Talk ratio and questioning as meters; the counts beside them as figures. */
function LessonMetrics({ card }: { card: TeacherScorecard }) {
  const m = card.metrics;
  const none = m.avg_student_talk_pct == null && m.avg_question_count == null;
  return (
    <div className="rounded-xl border p-4" style={{ background: "var(--viz-surface)", borderColor: "var(--viz-border)" }}>
      <div className="text-sm font-semibold" style={{ color: "var(--viz-text)" }}>
        Lesson metrics
      </div>
      <div className="text-xs" style={{ color: "var(--viz-text-2)" }}>
        Averaged over the lessons with a transcript
      </div>
      {none ? (
        <p className="mt-3 text-sm" style={{ color: "var(--viz-text-2)" }}>
          No lesson metrics in this window.
        </p>
      ) : (
        <dl className="mt-4 space-y-4">
          <MeterRow label="Student talk" value={m.avg_student_talk_pct} note={m.avg_teacher_talk_pct == null ? undefined : `teacher ${pct(m.avg_teacher_talk_pct)}`} />
          <MeterRow label="Open questions" value={m.avg_open_question_pct} note="of the questions asked" />
          <div className="grid grid-cols-3 gap-3 text-sm" style={{ color: "var(--viz-text)" }}>
            <Figure label="Questions a lesson" value={one(m.avg_question_count)} />
            <Figure label="Wait after a question" value={m.avg_wait_ms == null ? "—" : `${(m.avg_wait_ms / 1000).toFixed(1)} s`} />
            <Figure label="Praise a lesson" value={one(m.avg_praise_count)} />
          </div>
        </dl>
      )}
    </div>
  );
}

function MeterRow({ label, value, note }: { label: string; value: number | null; note?: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <dt style={{ color: "var(--viz-text)" }}>{label}</dt>
        <dd className="tabular-nums" style={{ color: "var(--viz-text)" }}>
          {pct(value)}
          {note && (
            <span className="ml-1 text-xs" style={{ color: "var(--viz-text-2)" }}>
              · {note}
            </span>
          )}
        </dd>
      </div>
      <div className="mt-1.5">{value == null ? <div className="h-2 w-full rounded-full" style={{ background: "var(--viz-grid)" }} /> : <Meter value={value} />}</div>
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs" style={{ color: "var(--viz-text-2)" }}>
        {label}
      </dt>
      <dd className="text-lg font-semibold">{value}</dd>
    </div>
  );
}

// --- lists and tables --------------------------------------------------------

function CountedList({ title, subtitle, items, empty }: { title: string; subtitle: string; items: ScorecardCounted[]; empty: string }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{subtitle}</CardDescription>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{empty}</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {items.map((s) => (
              <li key={s.text} className="flex items-start justify-between gap-3">
                <span>{s.text}</span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  ×{s.count}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/** Four counts, zeros visible but muted: on a card the office checks, an all-clear is information. */
function Followups({ followups }: { followups: TeacherScorecard["followups"] }) {
  const items: { label: string; value: number }[] = [
    { label: "Proposed", value: followups.proposed },
    { label: "Approved", value: followups.approved },
    { label: "Done", value: followups.done },
    { label: "Dismissed", value: followups.dismissed },
  ];
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Follow-ups</CardTitle>
        <CardDescription>What the office did with the follow-ups proposed from these lessons</CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {items.map((i) => (
            <div key={i.label} className="rounded-lg bg-secondary/50 p-3">
              <dt className="text-xs text-muted-foreground">{i.label}</dt>
              <dd className={i.value === 0 ? "text-lg font-semibold text-muted-foreground" : "text-lg font-semibold"}>{i.value}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

function RecentLessons({ lessons, tz }: { lessons: TeacherScorecard["recent_lessons"]; tz: string }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Recent lessons</CardTitle>
        <CardDescription>The newest {lessons.length === 10 ? "ten" : lessons.length} in this window; a coached lesson opens its coaching detail</CardDescription>
      </CardHeader>
      <CardContent>
        {lessons.length === 0 ? (
          <p className="text-sm text-muted-foreground">No lessons in this window.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-1.5 pr-3 font-medium">When</th>
                  <th className="py-1.5 pr-3 font-medium">Student</th>
                  <th className="hidden py-1.5 pr-3 font-medium sm:table-cell">Subject</th>
                  <th className="py-1.5 pr-3 font-medium">Mode</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Understanding</th>
                  <th className="py-1.5 font-medium">Coaching</th>
                </tr>
              </thead>
              <tbody>
                {lessons.map((l) => (
                  <tr key={l.session_id} className="border-t">
                    <td className="whitespace-nowrap py-2 pr-3">{DateTime.fromISO(l.at, { zone: "utc" }).setZone(tz).toFormat("d LLL, h:mm a")}</td>
                    <td className="py-2 pr-3">{l.student_name}</td>
                    <td className="hidden py-2 pr-3 sm:table-cell">{l.subject}</td>
                    <td className="py-2 pr-3">
                      <Badge variant="secondary">{l.mode === "online" ? "Online" : "In person"}</Badge>
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{l.understanding == null ? "—" : `${l.understanding}/10`}</td>
                    <td className="py-2">
                      {l.feedback_summary ? (
                        <Link href={`/coaching/${l.session_id}`} title={l.feedback_summary} className="inline-flex items-center gap-1 whitespace-nowrap font-medium text-primary hover:underline">
                          Coaching <ArrowUpRight className="h-3.5 w-3.5" />
                        </Link>
                      ) : (
                        <span className="text-xs text-muted-foreground">Not coached</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** A bar rounded at the data end (right), square at the baseline. */
function roundedRight(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, h / 2, w);
  if (w <= 0) return "";
  return `M${x},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h - rr} Q${x + w},${y + h} ${x + w - rr},${y + h} H${x} Z`;
}
