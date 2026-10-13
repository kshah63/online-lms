import "server-only";
import { isDemoMode } from "@/lib/env";

/**
 * Cap on model spend per person. online-lms counted these in its own
 * rate_limits table through a service-role client; the room holds no
 * service-role key on mv-app's project, and the cap belongs with the usage
 * ledger. TODO(mv-app): count against ai_usage (kind coach_live | analyze |
 * report_draft, per user_id) through an RPC; until then every call is allowed.
 * Returns TRUE when the call may run.
 */
export async function rateLimit(bucket: string, limit: number, windowSeconds: number): Promise<boolean> {
  void bucket;
  void limit;
  void windowSeconds;
  if (isDemoMode) return true;
  return true;
}

/** Common limits in one place so they're easy to see and tune. */
export const LIMITS = {
  // AI — per signed-in user. Caps Anthropic spend if something loops.
  coachLive: { limit: 80, windowSeconds: 3600 }, // ~1 every 45s; interval is 150s
  finalizeLesson: { limit: 30, windowSeconds: 3600 }, // 1 Opus call each
  reportDraft: { limit: 40, windowSeconds: 3600 },
} as const;
