import Link from "next/link";
import { CheckCheck, ListChecks, MessageSquareQuote, X } from "lucide-react";
import { DateTime } from "luxon";
import { PageHeader, StatCard } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { requireRole, viewerTimeZone } from "@/lib/data/auth";
import { listFollowups, type FollowupView } from "@/lib/data/followups";
import { OFFICE_ROLES } from "@/lib/permissions";
import { FOLLOWUP_ACTION_LABEL, FOLLOWUP_KIND_LABEL, type FollowupKind, type FollowupStatus, type Profile } from "@/lib/types";
import { FollowupDecision } from "@/components/followups/followup-decision";

const STATUSES: FollowupStatus[] = ["proposed", "approved", "done", "dismissed"];
const KINDS = Object.keys(FOLLOWUP_KIND_LABEL) as FollowupKind[];

const STATUS_VARIANT: Record<FollowupStatus, "warning" | "default" | "success" | "secondary"> = {
  proposed: "warning",
  approved: "default",
  done: "success",
  dismissed: "secondary",
};

/**
 * What lesson-finalize proposed from each lesson's transcript. An in-charge
 * or admin decides here through the same two doors the app will use
 * (approve_followup, dismiss_followup): the message, task or note is created
 * in the app's own tables, as the approver. Support reads only.
 */
export default async function AdminFollowupsPage({ searchParams }: { searchParams: { status?: string; kind?: string } }) {
  const viewer = await requireRole(...OFFICE_ROLES);
  const tz = viewerTimeZone(viewer);
  const { rows, hitLimit } = await listFollowups(viewer);

  const status = STATUSES.find((s) => s === searchParams.status);
  const kind = KINDS.find((k) => k === searchParams.kind);
  const visible = rows.filter((f) => (!status || f.status === status) && (!kind || f.kind === kind));
  const filtered = Boolean(status || kind);

  const href = (patch: Partial<{ status: string; kind: string }>) => {
    const params = new URLSearchParams();
    const merged = { status, kind, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) params.set(k, v);
    const qs = params.toString();
    return qs ? `/admin/followups?${qs}` : "/admin/followups";
  };
  const toggle = (key: "status" | "kind", value: string, current?: string) => href({ [key]: current === value ? "" : value });
  const countOf = (s: FollowupStatus) => rows.filter((f) => f.status === s).length;

  const chip = (active: boolean) =>
    cn(
      "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
      active ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground",
    );

  return (
    <div>
      <PageHeader
        title="Follow-ups"
        description="What each lesson's transcript suggested the centre should act on. Approving one sends the message, files the task or writes the note in the MathVision app, as you."
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Link href="/admin/followups">
          <StatCard className="h-full transition-colors hover:border-primary/40" label="All" value={rows.length} hint={filtered ? "Show all" : undefined} icon={<ListChecks className="h-4 w-4" />} />
        </Link>
        {(["proposed", "approved", "done"] as const).map((s) => (
          <Link key={s} href={toggle("status", s, status)}>
            <StatCard
              className={cn("h-full transition-colors hover:border-primary/40", status === s && "ring-2 ring-primary border-primary/40")}
              label={s === "proposed" ? "Waiting for a decision" : s === "approved" ? "Approved" : "Done"}
              value={countOf(s)}
              tone={s === "proposed" && countOf(s) ? "warning" : "default"}
            />
          </Link>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {KINDS.map((k) => (
          <Link key={k} href={toggle("kind", k, kind)} className={chip(kind === k)}>
            {FOLLOWUP_KIND_LABEL[k]} ({rows.filter((f) => f.kind === k).length})
          </Link>
        ))}
        <Link href={toggle("status", "dismissed", status)} className={chip(status === "dismissed")}>
          Dismissed ({countOf("dismissed")})
        </Link>
        {filtered && (
          <Button asChild variant="ghost" size="sm" className="h-7 px-2 text-xs">
            <Link href="/admin/followups">
              <X className="h-3 w-3" /> Clear filters
            </Link>
          </Button>
        )}
      </div>

      {hitLimit && <p className="mb-3 text-sm text-muted-foreground">Showing the latest {rows.length} follow-ups.</p>}

      {visible.length === 0 ? (
        <EmptyState
          icon={<CheckCheck className="h-5 w-5" />}
          title={filtered ? "Nothing matches these filters" : "Nothing waiting"}
          description={filtered ? "Clear the filters to see every follow-up." : "Follow-ups are proposed from each lesson's transcript once it ends."}
          action={
            filtered ? (
              <Button asChild variant="outline">
                <Link href="/admin/followups">Show all</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-3">
          {visible.map((f) => (
            <FollowupRow key={f.id} f={f} tz={tz} viewer={viewer} />
          ))}
        </div>
      )}
    </div>
  );
}

function FollowupRow({ f, tz, viewer }: { f: FollowupView; tz: string; viewer: Profile }) {
  const decides = viewer.role === "admin" || viewer.role === "staff";
  const when = f.lesson ? DateTime.fromISO(f.lesson.effective_start, { zone: "utc" }).setZone(tz).toFormat("ccc d LLL") : DateTime.fromISO(f.created_at, { zone: "utc" }).setZone(tz).toFormat("ccc d LLL");
  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Avatar name={f.student_name} size={24} />
        <span className="font-medium">{f.student_name}</span>
        <Badge variant="secondary">{FOLLOWUP_KIND_LABEL[f.kind]}</Badge>
        <Badge variant={STATUS_VARIANT[f.status]}>{f.status}</Badge>
        {f.priority === "high" && <Badge variant="destructive">high priority</Badge>}
        <span className="ml-auto text-xs text-muted-foreground">
          {f.lesson?.subject ? `${f.lesson.subject} · ` : ""}
          {when}
        </span>
      </div>
      <div>
        <div className="text-sm font-medium">{f.title}</div>
        {f.detail && <p className="mt-0.5 text-sm text-muted-foreground">{f.detail}</p>}
        {f.quote && (
          <blockquote className="mt-1.5 flex gap-1.5 border-l-2 border-border pl-3 text-sm italic text-muted-foreground">
            <MessageSquareQuote className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              &ldquo;{f.quote}&rdquo;
              {f.at_ms != null && <span className="ml-1 font-mono text-xs not-italic">{fmt(f.at_ms)}</span>}
            </span>
          </blockquote>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>Suggested action: {FOLLOWUP_ACTION_LABEL[f.action]}</span>
        {f.suggested_parent_message && <span className="truncate" title={f.suggested_parent_message}>Draft to the parent: &ldquo;{f.suggested_parent_message}&rdquo;</span>}
        <span className="ml-auto">{f.status === "proposed" ? (decides ? "" : "Waiting for the room's in-charge") : f.decided_at ? `decided ${DateTime.fromISO(f.decided_at, { zone: "utc" }).toRelative()}` : ""}</span>
      </div>
      {decides && <FollowupDecision id={f.id} action={f.action} status={f.status} suggestedParentMessage={f.suggested_parent_message} />}
    </div>
  );
}

function fmt(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
