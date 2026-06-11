import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/data/auth";
import { rateLimit, LIMITS } from "@/lib/rate-limit";
import { liveCoachCue } from "@/lib/coaching/live-llm";
import type { TranscriptSegment } from "@/lib/coaching/metrics";

/** §7.2 periodic LLM live-coaching pass — teacher-only, called on an interval. */
export async function POST(req: Request) {
  const profile = await getCurrentProfile();
  if (!profile || (profile.role !== "teacher" && profile.role !== "admin")) {
    return NextResponse.json({ nudge: null });
  }

  // Per-teacher cap on the live Haiku calls — if a client loops, stop spending.
  const allowed = await rateLimit(
    `ai:coach_live:${profile.id}`,
    LIMITS.coachLive.limit,
    LIMITS.coachLive.windowSeconds,
  );
  if (!allowed) return NextResponse.json({ nudge: null });

  const { segments } = (await req.json()) as { segments?: TranscriptSegment[] };
  const recent = Array.isArray(segments) ? segments.slice(-24) : [];
  const nudge = await liveCoachCue(recent);
  return NextResponse.json({ nudge });
}
