"use client";

import { useId, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Circle, CircleDashed, CircleDot, Table2 } from "lucide-react";
import { DateTime } from "luxon";
import type { ProgressReport } from "@/lib/syllabus/from-rpc";
import { label as statusLabel, type TopicStatus } from "@/lib/syllabus/progress";
import type { ProgressView } from "@/lib/syllabus/view";
import { cn } from "@/lib/utils";

// ============================================================================
// The parent's (and student's) progress view. Built on the reference data-viz
// method: one hue for magnitude, status colors only where color means
// good/bad (always with an icon and a label), thin marks, hairline grid, a
// table twin for every chart, tooltips that enhance but never gate.
// ============================================================================

const pct = (x: number | null) => (x == null ? "—" : `${Math.round(x * 100)}%`);

export function ProgressDashboard({ view, reports = [] }: { view: ProgressView; reports?: ProgressReport[] }) {
  const s = view.summary;
  const coveredOrBetter = s.counts.covered + s.counts.secure + s.counts.needs_work;
  const itemsThisWindow = view.weekly.reduce((a, w) => a + w.items, 0);
  const delta = view.accuracy.current != null && view.accuracy.previous != null ? view.accuracy.current - view.accuracy.previous : null;

  return (
    <div className="viz-root space-y-6">
      {/* KPI row */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Topics covered" value={`${coveredOrBetter} of ${s.total}`} sub={`${s.counts.secure} secure · ${s.counts.needs_work} need work`}>
          <Meter value={s.total ? coveredOrBetter / s.total : 0} />
        </StatTile>
        <StatTile label="Practice, last 8 weeks" value={String(itemsThisWindow)} sub="questions attempted">
          <Sparkline points={view.weekly.map((w) => w.items)} />
        </StatTile>
        <StatTile
          label="Accuracy, last 8 weeks"
          value={pct(view.accuracy.current)}
          sub={delta == null ? `${view.accuracy.items} auto-marked answers` : `${delta >= 0 ? "+" : ""}${Math.round(delta * 100)} pts vs the 8 weeks before`}
          deltaGood={delta == null ? null : delta >= 0}
        />
        <StatTile label="Lessons attended" value={`${view.attendance.attended} of ${view.attendance.booked}`} sub={`last ${view.attendance.weeks} weeks`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <WeeklyPracticeChart weekly={view.weekly} />
        <AccuracyByTopicChart topics={view.topics} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <SyllabusTable topics={view.topics} />
        </div>
        <div className="space-y-4">
          <NextSteps view={view} />
          <RecentTests tests={view.tests} />
          <RecentReports reports={reports} />
        </div>
      </div>
    </div>
  );
}

// --- figures ---------------------------------------------------------------

function StatTile({ label, value, sub, deltaGood, children }: { label: string; value: string; sub?: string; deltaGood?: boolean | null; children?: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-card p-4" style={{ background: "var(--viz-surface)", borderColor: "var(--viz-border)" }}>
      <div className="text-xs" style={{ color: "var(--viz-text-2)" }}>
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold" style={{ color: "var(--viz-text)" }}>
        {value}
      </div>
      {sub && (
        <div className="mt-0.5 text-xs" style={{ color: deltaGood == null ? "var(--viz-text-2)" : deltaGood ? "var(--viz-good-text)" : "var(--viz-critical)" }}>
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

/** Past periods in the de-emphasis gray, the current period in the accent. */
function Sparkline({ points }: { points: number[] }) {
  const w = 120;
  const h = 28;
  const max = Math.max(1, ...points);
  const n = points.length;
  const bw = n ? Math.max(2, Math.floor((w - (n - 1) * 2) / n)) : 0;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      {points.map((p, i) => {
        const bh = Math.max(1, Math.round((p / max) * (h - 2)));
        return <rect key={i} x={i * (bw + 2)} y={h - bh} width={bw} height={bh} rx={1.5} fill={i === n - 1 ? "var(--viz-series-1)" : "var(--viz-deemph)"} />;
      })}
    </svg>
  );
}

// --- charts ----------------------------------------------------------------

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

function WeeklyPracticeChart({ weekly }: { weekly: ProgressView["weekly"] }) {
  const [hover, setHover] = useState<number | null>(null);
  const w = 520;
  const h = 200;
  const padL = 32;
  const padB = 28;
  const padT = 18;
  const plotW = w - padL - 8;
  const plotH = h - padT - padB;
  const max = Math.max(1, ...weekly.map((x) => x.items));
  const nice = niceMax(max);
  const n = weekly.length;
  const band = plotW / Math.max(1, n);
  const bw = Math.min(24, band * 0.6);
  const ticks = [0, nice / 2, nice];
  const peak = weekly.reduce((bi, x, i) => (x.items > (weekly[bi]?.items ?? -1) ? i : bi), 0);
  const fmtWeek = (iso: string) => DateTime.fromISO(iso).toFormat("d LLL");

  const table = (
    <table className="w-full text-sm" style={{ color: "var(--viz-text)" }}>
      <thead>
        <tr className="text-left text-xs" style={{ color: "var(--viz-text-2)" }}>
          <th className="py-1 font-medium">Week starting</th>
          <th className="py-1 text-right font-medium">Questions</th>
        </tr>
      </thead>
      <tbody>
        {weekly.map((x) => (
          <tr key={x.week_start} className="border-t" style={{ borderColor: "var(--viz-grid)" }}>
            <td className="py-1">{fmtWeek(x.week_start)}</td>
            <td className="py-1 text-right tabular-nums">{x.items}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <ChartCard title="Practice each week" subtitle="Questions attempted, last 8 weeks" table={table}>
      <div className="relative">
        <svg viewBox={`0 0 ${w} ${h}`} className="h-auto w-full" role="img" aria-label="Questions attempted per week">
          {ticks.map((t) => {
            const y = padT + plotH - (t / nice) * plotH;
            return (
              <g key={t}>
                <line x1={padL} x2={w - 8} y1={y} y2={y} stroke={t === 0 ? "var(--viz-baseline)" : "var(--viz-grid)"} strokeWidth={1} />
                <text x={padL - 6} y={y + 4} textAnchor="end" fontSize={11} fill="var(--viz-muted)">
                  {t}
                </text>
              </g>
            );
          })}
          {weekly.map((x, i) => {
            const bh = (x.items / nice) * plotH;
            const cx = padL + i * band + band / 2;
            const y = padT + plotH - bh;
            const isHover = hover === i;
            return (
              <g key={x.week_start} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)} tabIndex={0} onFocus={() => setHover(i)} onBlur={() => setHover(null)}>
                <rect x={padL + i * band} y={padT} width={band} height={plotH + padB} fill="transparent" />
                {x.items > 0 && <path d={roundedTop(cx - bw / 2, y, bw, bh, 4)} fill="var(--viz-series-1)" opacity={isHover ? 0.85 : 1} />}
                {(i === peak || i === n - 1) && x.items > 0 && (
                  <text x={cx} y={y - 5} textAnchor="middle" fontSize={11} fill="var(--viz-text-2)">
                    {x.items}
                  </text>
                )}
                <text x={cx} y={h - 8} textAnchor="middle" fontSize={11} fill="var(--viz-muted)">
                  {fmtWeek(x.week_start)}
                </text>
              </g>
            );
          })}
        </svg>
        {hover != null && weekly[hover] && (
          <div className="pointer-events-none absolute rounded-md border px-2 py-1 text-xs shadow-sm" style={{ left: `${((padL + hover * band + band / 2) / w) * 100}%`, top: 0, transform: "translateX(-50%)", background: "var(--viz-surface)", color: "var(--viz-text)", borderColor: "var(--viz-border)" }}>
            <strong>{weekly[hover]!.items}</strong> <span style={{ color: "var(--viz-text-2)" }}>week of {fmtWeek(weekly[hover]!.week_start)}</span>
          </div>
        )}
      </div>
    </ChartCard>
  );
}

function AccuracyByTopicChart({ topics }: { topics: ProgressView["topics"] }) {
  const rows = useMemo(() => topics.filter((t) => t.progress.accuracy != null && t.progress.practice_items > 0).sort((a, b) => (a.progress.accuracy ?? 0) - (b.progress.accuracy ?? 0)), [topics]);
  const [hover, setHover] = useState<string | null>(null);
  const rowH = 26;
  const labelW = 170;
  const w = 520;
  const h = Math.max(60, rows.length * rowH + 16);
  const plotW = w - labelW - 48;

  const table = (
    <table className="w-full text-sm" style={{ color: "var(--viz-text)" }}>
      <thead>
        <tr className="text-left text-xs" style={{ color: "var(--viz-text-2)" }}>
          <th className="py-1 font-medium">Topic</th>
          <th className="py-1 text-right font-medium">Accuracy</th>
          <th className="py-1 text-right font-medium">Questions</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((t) => (
          <tr key={t.id} className="border-t" style={{ borderColor: "var(--viz-grid)" }}>
            <td className="py-1">{t.label}</td>
            <td className="py-1 text-right tabular-nums">{pct(t.progress.accuracy)}</td>
            <td className="py-1 text-right tabular-nums">{t.progress.practice_items}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <ChartCard title="Accuracy by topic" subtitle="Practice questions right, weakest first" table={table}>
      {rows.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--viz-text-2)" }}>
          No practice yet.
        </p>
      ) : (
        <svg viewBox={`0 0 ${w} ${h}`} className="h-auto w-full" role="img" aria-label="Practice accuracy by topic">
          {[0, 0.5, 1].map((t) => (
            <line key={t} x1={labelW + t * plotW} x2={labelW + t * plotW} y1={4} y2={h - 8} stroke={t === 0 ? "var(--viz-baseline)" : "var(--viz-grid)"} strokeWidth={1} />
          ))}
          {rows.map((t, i) => {
            const y = 8 + i * rowH;
            const bw = (t.progress.accuracy ?? 0) * plotW;
            const weak = t.progress.status === "needs_work";
            const isHover = hover === t.id;
            return (
              <g key={t.id} onPointerEnter={() => setHover(t.id)} onPointerLeave={() => setHover(null)} tabIndex={0}>
                <rect x={0} y={y - 4} width={w} height={rowH} fill="transparent" />
                <text x={labelW - 10} y={y + 13} textAnchor="end" fontSize={12} fill="var(--viz-text)">
                  {truncate(t.label, 24)}
                </text>
                <path d={roundedRight(labelW, y + 2, bw, 14, 4)} fill="var(--viz-series-1)" opacity={isHover ? 0.85 : 1} />
                <text x={labelW + bw + 6} y={y + 13} fontSize={11} fill="var(--viz-text-2)">
                  {pct(t.progress.accuracy)}
                  {isHover ? ` · ${t.progress.practice_items} questions` : ""}
                </text>
                {weak && (
                  <g transform={`translate(${w - 40}, ${y + 2})`} aria-label="needs work">
                    <title>Needs work</title>
                    <path d="M7 1.5 L13 12.5 H1 Z" fill="none" stroke="var(--viz-serious)" strokeWidth={1.5} strokeLinejoin="round" />
                    <line x1={7} y1={5.5} x2={7} y2={8.5} stroke="var(--viz-serious)" strokeWidth={1.5} />
                    <circle cx={7} cy={10.5} r={0.8} fill="var(--viz-serious)" />
                  </g>
                )}
              </g>
            );
          })}
        </svg>
      )}
    </ChartCard>
  );
}

// --- tables and lists ------------------------------------------------------

const STATUS_META: Record<TopicStatus, { icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>; color: string }> = {
  not_started: { icon: Circle, color: "var(--viz-muted)" },
  in_progress: { icon: CircleDashed, color: "var(--viz-text-2)" },
  covered: { icon: CircleDot, color: "var(--viz-series-1)" },
  secure: { icon: CheckCircle2, color: "var(--viz-good)" },
  needs_work: { icon: AlertTriangle, color: "var(--viz-serious)" },
};

function StatusChip({ status }: { status: TopicStatus }) {
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs" style={{ color: "var(--viz-text)" }}>
      <Icon className="h-3.5 w-3.5" style={{ color: meta.color }} />
      {statusLabel(status)}
    </span>
  );
}

function SyllabusTable({ topics }: { topics: ProgressView["topics"] }) {
  return (
    <div className="rounded-xl border p-4" style={{ background: "var(--viz-surface)", borderColor: "var(--viz-border)" }}>
      <div className="mb-3 text-sm font-semibold" style={{ color: "var(--viz-text)" }}>
        Syllabus
      </div>
      <table className="w-full text-sm" style={{ color: "var(--viz-text)" }}>
        <thead>
          <tr className="text-left text-xs" style={{ color: "var(--viz-text-2)" }}>
            <th className="py-1.5 font-medium">Topic</th>
            <th className="py-1.5 font-medium">Status</th>
            <th className="py-1.5 text-right font-medium">Accuracy</th>
            <th className="py-1.5 text-right font-medium">Practised</th>
            <th className="hidden py-1.5 text-right font-medium sm:table-cell">Last activity</th>
          </tr>
        </thead>
        <tbody>
          {topics.map((t) => (
            <tr key={t.id} className="border-t" style={{ borderColor: "var(--viz-grid)" }} title={t.progress.reasons.join(" ")}>
              <td className="py-1.5 pr-2">{t.label}</td>
              <td className="py-1.5">
                <StatusChip status={t.progress.status} />
              </td>
              <td className="py-1.5 text-right tabular-nums">{pct(t.progress.accuracy)}</td>
              <td className="py-1.5 text-right tabular-nums">{t.progress.practice_items || "—"}</td>
              <td className="hidden py-1.5 text-right sm:table-cell" style={{ color: "var(--viz-text-2)" }}>
                {t.progress.last_activity ? DateTime.fromISO(t.progress.last_activity).toRelative({ unit: ["days", "weeks"] }) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function NextSteps({ view }: { view: ProgressView }) {
  const s = view.summary;
  const byId = new Map(view.topics.map((t) => [t.id, t.label]));
  return (
    <div className="rounded-xl border p-4" style={{ background: "var(--viz-surface)", borderColor: "var(--viz-border)" }}>
      <div className="mb-2 text-sm font-semibold" style={{ color: "var(--viz-text)" }}>
        Where {view.student.first_name} needs help
      </div>
      {s.weak_areas.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--viz-text-2)" }}>
          Nothing stands out right now.
        </p>
      ) : (
        <ul className="space-y-1.5 text-sm" style={{ color: "var(--viz-text)" }}>
          {s.weak_areas.map((t) => (
            <li key={t.topic_id} className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: "var(--viz-serious)" }} />
              <span>
                <span className="font-medium">{byId.get(t.topic_id)}</span>
                <span style={{ color: "var(--viz-text-2)" }}> — {t.reasons[0]}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {s.recommended_next.length > 0 && (
        <p className="mt-3 text-xs" style={{ color: "var(--viz-text-2)" }}>
          Practise next: {s.recommended_next.map((t) => byId.get(t.topic_id)).filter(Boolean).join(", ")}.
        </p>
      )}
    </div>
  );
}

function RecentTests({ tests }: { tests: ProgressView["tests"] }) {
  return (
    <div className="rounded-xl border p-4" style={{ background: "var(--viz-surface)", borderColor: "var(--viz-border)" }}>
      <div className="mb-2 text-sm font-semibold" style={{ color: "var(--viz-text)" }}>
        Recent tests
      </div>
      {tests.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--viz-text-2)" }}>
          No tests yet.
        </p>
      ) : (
        <ul className="space-y-1.5 text-sm" style={{ color: "var(--viz-text)" }}>
          {tests.map((t) => (
            <li key={`${t.name}-${t.at}`} className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate">
                {t.name}
                <span className="ml-1 text-xs" style={{ color: "var(--viz-text-2)" }}>
                  {DateTime.fromISO(t.at).toFormat("d LLL")}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-1.5 tabular-nums">
                {t.flagged && (
                  <span className="inline-flex items-center gap-1 text-xs" style={{ color: "var(--viz-serious)" }} title="Flagged for review during an at-home test">
                    <AlertTriangle className="h-3.5 w-3.5" /> review
                  </span>
                )}
                {t.score}/{t.out_of}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The last published reports on this course: what the teacher wrote, as the family already reads it in the app. */
function RecentReports({ reports }: { reports: ProgressReport[] }) {
  return (
    <div className="rounded-xl border p-4" style={{ background: "var(--viz-surface)", borderColor: "var(--viz-border)" }}>
      <div className="mb-2 text-sm font-semibold" style={{ color: "var(--viz-text)" }}>
        Recent reports
      </div>
      {reports.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--viz-text-2)" }}>
          No published reports on this course yet.
        </p>
      ) : (
        <ul className="space-y-2 text-sm" style={{ color: "var(--viz-text)" }}>
          {reports.map((r) => (
            <li key={r.id}>
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate">
                  {r.topic ?? "Lesson"}
                  <span className="ml-1 text-xs" style={{ color: "var(--viz-text-2)" }}>
                    {DateTime.fromISO(r.at).toFormat("d LLL")}
                  </span>
                </span>
                {r.understanding != null && (
                  <span className="shrink-0 text-xs tabular-nums" style={{ color: "var(--viz-text-2)" }}>
                    understanding {r.understanding}/10
                  </span>
                )}
              </div>
              {r.homework && (
                <div className="line-clamp-1 text-xs" style={{ color: "var(--viz-text-2)" }}>
                  Homework: {r.homework}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// --- helpers ---------------------------------------------------------------

function niceMax(n: number): number {
  if (n <= 10) return 10;
  const p = Math.pow(10, Math.floor(Math.log10(n)));
  const m = n / p;
  const step = m <= 2 ? 2 : m <= 5 ? 5 : 10;
  return step * p;
}

/** A column rounded at the data end (top), square at the baseline. */
function roundedTop(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`;
}

/** A bar rounded at the data end (right), square at the baseline. */
function roundedRight(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, h / 2, w);
  if (w <= 0) return "";
  return `M${x},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h - rr} Q${x + w},${y + h} ${x + w - rr},${y + h} H${x} Z`;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

export function statusTone(status: TopicStatus): string {
  return cn(status);
}
