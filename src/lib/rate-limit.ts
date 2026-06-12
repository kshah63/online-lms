import "server-only";
import { headers } from "next/headers";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isDemoMode } from "@/lib/env";

/**
 * Fixed-window rate limit backed by Postgres (see 0011_rate_limits.sql), so the
 * count is shared across all serverless instances. Returns TRUE when the call
 * is allowed, FALSE when it should be rejected.
 *
 * Fails OPEN: if the limiter itself errors (e.g. the migration isn't applied
 * yet) we let the call through rather than break a legitimate user. The goal is
 * to cap runaway cost/abuse, not to be a security boundary on top of RLS.
 */
export async function rateLimit(
  bucket: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  if (isDemoMode) return true; // no backend to count against

  // Prefer the service-role client (bypasses RLS cleanly); fall back to the
  // request-scoped client calling the SECURITY DEFINER function.
  const client = createSupabaseAdminClient() ?? createSupabaseServerClient();
  if (!client) return true;

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
  coachLive: { limit: 80, windowSeconds: 3600 }, // ~1 every 45s; interval is 150s
  finalizeLesson: { limit: 30, windowSeconds: 3600 }, // 1 Opus call each
  reportDraft: { limit: 40, windowSeconds: 3600 },
  // Public, unauthenticated — per IP.
  accountRequest: { limit: 5, windowSeconds: 3600 },
  passwordReset: { limit: 5, windowSeconds: 3600 },
} as const;
