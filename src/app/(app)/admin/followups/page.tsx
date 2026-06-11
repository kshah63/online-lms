import { AlarmClockOff, CheckCheck, ListChecks, Phone, RefreshCw } from "lucide-react";
import { DateTime } from "luxon";
import { PageHeader, StatCard } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MessageParentDialog } from "@/components/admin/message-parent-dialog";
import { requireRole } from "@/lib/data/auth";
import { getOpenFollowups } from "@/lib/data/followups";
import { generateFollowups, resolveFollowup, snoozeFollowup } from "@/lib/actions/followups";
import { FOLLOWUP_LABEL, type FollowupView } from "@/lib/types";

const PRIORITY_DOT = { high: "bg-destructive", normal: "bg-primary", low: "bg-muted-foreground/40" };

export default async function AdminFollowupsPage() {
  const admin = await requireRole("admin");
  const items = await getOpenFollowups();

  const high = items.filter((f) => f.priority === "high").length;
  const noShows = items.filter((f) => f.type === "no_show").length;
  const gaps = items.filter((f) => f.type === "attendance_gap").length;

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

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Open items" value={items.length} icon={<ListChecks className="h-4 w-4" />} />
        <StatCard label="High priority" value={high} tone={high ? "warning" : "default"} />
        <StatCard label="No-shows" value={noShows} tone={noShows ? "warning" : "default"} />
        <StatCard label="Attendance gaps" value={gaps} />
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={<CheckCheck className="h-5 w-5" />}
          title="All clear"
          description="No open follow-ups. Run a scan to refresh attendance gaps and overdue homework."
        />
      ) : (
        <div className="space-y-3">
          {items.map((f) => (
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
