import "server-only";
import { headers } from "next/headers";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { isDemoMode } from "@/lib/env";

/**
 * Fixed-window rate limit backed by Postgres (see 0011_rate_limits.sql), so the
 * count is shared across all serverless instances. Returns TRUE when the call
 * is allowed, FALSE when it should be rejected.
 *
 * Fails OPEN: if the limiter itself errors (e.g. the migration isn't applied
 * yet) we let the call through rather than break a legitimate user. The goal is
 * to cap runaway cost/abuse, not to be a security boundary on top of RLS.
 *
 * Service role ONLY: `rl_check` takes the bucket and the limits from its
 * caller, so 0017 revokes it from anon/authenticated (otherwise anyone with
 * the public anon key could exhaust `pencil:join:<someone>` and lock them out
 * of their lessons). Without SUPABASE_SERVICE_ROLE_KEY nothing is limited.
 */
export async function rateLimit(
  bucket: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  if (isDemoMode) return true; // no backend to count against

  const client = createSupabaseAdminClient();
  if (!client) {
    warnNoServiceRoleOnce();
    return true;
  }

  const { data, error } = await client.rpc("rl_check", {
    p_bucket: bucket,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  });

  if (error) {
    console.error("rateLimit rl_check failed:", error.message);
    return true; // fail open
  }
  return data !== false;
}

let warnedNoServiceRole = false;
function warnNoServiceRoleOnce() {
  if (warnedNoServiceRole) return;
  warnedNoServiceRole = true;
  console.warn("rateLimit: SUPABASE_SERVICE_ROLE_KEY is not set — rate limits are not enforced.");
}

/** Best-effort client IP for throttling unauthenticated endpoints. */
export function getClientIp(): string {
  const h = headers();
  const fwd = h.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return h.get("x-real-ip")?.trim() || "unknown";
}

/** Common limits in one place so they're easy to see and tune. */
export const LIMITS = {
  // AI — per signed-in user. Caps Anthropic spend if something loops.
  reportDraft: { limit: 40, windowSeconds: 3600 },
  // Pencil Spaces — per signed-in profile, bucket `pencil:join:<profile id>`.
  // Every minted authorize URL (lesson, second-device board, homework, mobile)
  // counts; a looping client can't hammer Pencil's <5 QPS budget.
  pencilJoin: { limit: 30, windowSeconds: 3600 },
  // Public, unauthenticated — per IP.
  accountRequest: { limit: 5, windowSeconds: 3600 },
  passwordReset: { limit: 5, windowSeconds: 3600 },
} as const;
