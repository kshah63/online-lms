import { ScrollText } from "lucide-react";
import { requireRole } from "@/lib/data/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDemoMode } from "@/lib/env";
import { formatInTz } from "@/lib/time";
import { Badge } from "@/components/ui/badge";

interface AuditRow {
  id: string;
  action: string;
  actor_role: string | null;
  entity: string | null;
  entity_id: string | null;
  details: Record<string, unknown>;
  created_at: string;
  actor: { display_name: string } | null;
}

async function getAuditLog(): Promise<AuditRow[]> {
  if (isDemoMode) return [];
  const supabase = createSupabaseServerClient()!;
  const { data, error } = await supabase
    .from("audit_log")
    .select("id, action, actor_role, entity, entity_id, details, created_at, actor:profiles!audit_log_actor_id_fkey(display_name)")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) {
    console.error("audit_log query failed:", error.message);
    return [];
  }
  return (data ?? []) as unknown as AuditRow[];
}

const ACTION_TONE: Record<string, "default" | "secondary" | "success" | "warning" | "destructive"> = {
  "booking.create": "success",
  "booking.reschedule": "warning",
  "booking.cancel": "destructive",
  "report.publish": "success",
  "homework.grade": "secondary",
  "account.create": "success",
  "account.approve": "success",
  "account.reject": "destructive",
  "enrollment.approved": "success",
  "enrollment.denied": "destructive",
};

/** Compact human summary of the details payload. */
function summarize(details: Record<string, unknown>): string {
  return Object.entries(details)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => `${k.replace(/_/g, " ")}: ${String(v)}`)
    .join(" · ");
}

export default async function AuditPage() {
  const profile = await requireRole("admin");
  const rows = await getAuditLog();

  return (
    <div>
      <h1 className="text-xl font-semibold">Audit log</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        Significant actions across the platform — bookings, accounts, reports, grading, enrollment.
        Append-only; written server-side so entries can&rsquo;t be forged.
      </p>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border bg-card py-16 text-center">
          <ScrollText className="h-8 w-8 text-muted-foreground" />
          <div>
            <div className="font-medium">No entries yet</div>
            <p className="text-sm text-muted-foreground">
              {isDemoMode
                ? "Demo mode — the audit log records real actions only."
                : "Actions will appear here as people use the platform (run migration 0015 if this stays empty)."}
            </p>
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3">When</th>
                <th className="px-4 py-3">Who</th>
                <th className="px-4 py-3">Action</th>
                <th className="px-4 py-3">Details</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b last:border-0">
                  <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                    {formatInTz(r.created_at, profile.timezone)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <span className="font-medium">{r.actor?.display_name ?? "—"}</span>
                    {r.actor_role && (
                      <span className="ml-1.5 text-xs capitalize text-muted-foreground">({r.actor_role})</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <Badge variant={ACTION_TONE[r.action] ?? "secondary"}>{r.action}</Badge>
                  </td>
                  <td className="max-w-md truncate px-4 py-3 text-muted-foreground" title={summarize(r.details)}>
                    {summarize(r.details) || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
