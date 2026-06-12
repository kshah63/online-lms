import Link from "next/link";
import { AlarmClockOff, CheckCheck, ListChecks, RefreshCw, X } from "lucide-react";
import { DateTime } from "luxon";
import { PageHeader, StatCard } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MessageParentDialog } from "@/components/admin/message-parent-dialog";
import { cn } from "@/lib/utils";
import { requireRole } from "@/lib/data/auth";
import { getOpenFollowups } from "@/lib/data/followups";
import { generateFollowups, resolveFollowup, snoozeFollowup } from "@/lib/actions/followups";
import { FOLLOWUP_LABEL, type FollowupView } from "@/lib/types";

const PRIORITY_DOT = { high: "bg-destructive", normal: "bg-primary", low: "bg-muted-foreground/40" };

const PRIORITIES = ["high", "normal", "low"] as const;
const TYPES = Object.keys(FOLLOWUP_LABEL) as (keyof typeof FOLLOWUP_LABEL)[];

export default async function AdminFollowupsPage({
  searchParams,
}: {
  searchParams: { priority?: string; type?: string; view?: string };
}) {
  const admin = await requireRole("admin");
  const items = await getOpenFollowups(); // open + snoozed

  // ----- Filters (combinable: ?priority=high&type=no_show&view=snoozed) -----
  const priority = PRIORITIES.find((p) => p === searchParams.priority);
  const type = TYPES.find((t) => t === searchParams.type);
  const view = searchParams.view === "snoozed" ? "snoozed" : undefined;

  const visible = items.filter(
    (f) =>
      (!priority || f.priority === priority) &&
      (!type || f.type === type) &&
      (!view || f.status === "snoozed"),
  );
  const filtered = Boolean(priority || type || view);

  // Build a query string toggling one filter while keeping the others.
  const href = (patch: Partial<{ priority: string; type: string; view: string }>) => {
    const params = new URLSearchParams();
    const merged = { priority, type, view, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) params.set(k, v);
    const qs = params.toString();
    return qs ? `/admin/followups?${qs}` : "/admin/followups";
  };
  const toggle = (key: "priority" | "type" | "view", value: string, current?: string) =>
    href({ [key]: current === value ? "" : value });

  const high = items.filter((f) => f.priority === "high").length;
  const snoozed = items.filter((f) => f.status === "snoozed").length;
  const countOf = (t: string) => items.filter((f) => f.type === t).length;

  const chip = (active: boolean) =>
    cn(
      "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
      active
        ? "border-primary bg-primary/10 text-primary"
        : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground",
    );

  return (
    <div>
      <PageHeader
        title="Follow-ups"
        description="Action items needing outreach — attendance gaps, no-shows, overdue homework, and flagged reports."
        actions={
          <form action={generateFollowups}>
            <Button type="submit" variant="outline" size="sm">
              <RefreshCw className="h-4 w-4" /> Scan now
            </Button>
          </form>
        }
      />

      {/* Clickable stat cards — click again to clear. */}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Link href="/admin/followups">
          <StatCard
            className="h-full transition-colors hover:border-primary/40"
            label="Open items"
            value={items.length}
            hint={filtered ? "Show all" : undefined}
            icon={<ListChecks className="h-4 w-4" />}
          />
        </Link>
        <Link href={toggle("priority", "high", priority)}>
          <StatCard
            className={cn("h-full transition-colors hover:border-primary/40", priority === "high" && "ring-2 ring-primary border-primary/40")}
            label="High priority"
            value={high}
            tone={high ? "warning" : "default"}
          />
        </Link>
        <Link href={toggle("type", "no_show", type)}>
          <StatCard
            className={cn("h-full transition-colors hover:border-primary/40", type === "no_show" && "ring-2 ring-primary border-primary/40")}
            label="No-shows"
            value={countOf("no_show")}
            tone={countOf("no_show") ? "warning" : "default"}
          />
        </Link>
        <Link href={toggle("view", "snoozed", view)}>
          <StatCard
            className={cn("h-full transition-colors hover:border-primary/40", view === "snoozed" && "ring-2 ring-primary border-primary/40")}
            label="Snoozed"
            value={snoozed}
          />
        </Link>
      </div>

      {/* Type chips — combinable with the cards above. */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {TYPES.map((t) => (
          <Link key={t} href={toggle("type", t, type)} className={chip(type === t)}>
            {FOLLOWUP_LABEL[t]} ({countOf(t)})
          </Link>
        ))}
        {PRIORITIES.map((p) => (
          <Link key={p} href={toggle("priority", p, priority)} className={chip(priority === p)}>
            {p} priority
          </Link>
        ))}
        {filtered && (
          <Button asChild variant="ghost" size="sm" className="h-7 px-2 text-xs">
            <Link href="/admin/followups">
              <X className="h-3 w-3" /> Clear filters
            </Link>
          </Button>
        )}
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={<CheckCheck className="h-5 w-5" />}
          title={filtered ? "Nothing matches these filters" : "All clear"}
          description={
            filtered
              ? "Clear the filters to see every open item."
              : "No open follow-ups. Run a scan to refresh attendance gaps and overdue homework."
          }
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
            <FollowupRow key={f.id} f={f} adminTz={admin.timezone} />
          ))}
        </div>
      )}
    </div>
  );
}

function FollowupRow({ f, adminTz }: { f: FollowupView; adminTz: string }) {
  const age = DateTime.fromISO(f.created_at, { zone: "utc" }).toRelative();

  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-sm sm:flex-row sm:items-center">
      <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${PRIORITY_DOT[f.priority]} sm:mt-0`} />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Avatar name={f.student.display_name} src={f.student.avatar_url} size={24} />
          <span className="font-medium">{f.student.display_name}</span>
          <Badge variant="secondary">{FOLLOWUP_LABEL[f.type]}</Badge>
          {f.snoozed_until && <Badge variant="outline">snoozed</Badge>}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{f.reason}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {age}
          {f.parent ? ` · parent: ${f.parent.display_name}${f.parent.phone ? "" : " (no phone)"}` : " · no parent linked"}
        </p>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {f.parent && (
          <MessageParentDialog
            studentId={f.student_id}
            followupId={f.id}
            parentName={f.parent.display_name}
            hasPhone={Boolean(f.parent.phone)}
            defaultBody={defaultBody(f)}
          />
        )}
        <form action={snoozeFollowup}>
          <input type="hidden" name="id" value={f.id} />
          <input type="hidden" name="days" value="7" />
          <Button type="submit" size="sm" variant="ghost" title="Snooze a week">
            <AlarmClockOff className="h-4 w-4" />
          </Button>
        </form>
        <form action={resolveFollowup}>
          <input type="hidden" name="id" value={f.id} />
          <Button type="submit" size="sm" variant="success">
            <CheckCheck className="h-4 w-4" /> Done
          </Button>
        </form>
      </div>
    </div>
  );
}

function defaultBody(f: FollowupView): string {
  const first = f.student.display_name.split(" ")[0];
  const parent = f.parent?.display_name?.split(" ")[0] ?? "there";
  switch (f.type) {
    case "no_show":
      return `Hi ${parent}, ${first} missed their recent lesson. Would you like us to reschedule? Happy to find a time that works.`;
    case "attendance_gap":
      return `Hi ${parent}, we noticed ${first} hasn't had a lesson in a little while. Shall we book the next one to keep momentum going?`;
    case "homework_overdue":
      return `Hi ${parent}, a gentle reminder that ${first} has some homework due. Could you help them set aside time to finish it? Thank you!`;
    default:
      return `Hi ${parent}, we'd love a quick chat about ${first}'s progress. Is there a good time to call this week?`;
  }
}
