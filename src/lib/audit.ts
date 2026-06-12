import "server-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isDemoMode } from "@/lib/env";
import type { Profile } from "@/lib/types";

/**
 * Append an entry to the audit log (0015). Fire-and-forget: auditing must never
 * fail or slow the action it records, so errors are swallowed after logging.
 * Written via the service role — no signed-in role has insert rights.
 */
export async function logAudit(
  actor: Profile | null,
  action: string,
  entity?: { type: string; id?: string | null },
  details?: Record<string, unknown>,
): Promise<void> {
  if (isDemoMode) return;
  try {
    const admin = createSupabaseAdminClient();
    if (!admin) return;
    await admin.from("audit_log").insert({
      actor_id: actor?.id ?? null,
      actor_role: actor?.role ?? null,
      action,
      entity: entity?.type ?? null,
      entity_id: entity?.id ?? null,
      details: details ?? {},
    });
  } catch (err) {
    console.error("logAudit failed:", err);
  }
}
