import { NextResponse } from "next/server";
import { isDemoMode } from "@/lib/env";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { SessionStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

/** What an open lesson room polls for. */
export interface LessonStatusResponse {
  status: SessionStatus;
  actual_end: string | null;
}

/**
 * GET /api/lesson/[sessionId]/status — the lesson's status and actual_end, read
 * with the viewer's own cookie client, so RLS decides who may see the row
 * exactly as it does for the lesson page (no service role, no Pencil call).
 *
 * Every open lesson room polls this so that when the teacher (or an admin)
 * ends the lesson, every other room unmounts its Space as well. Pencil keeps
 * the call, and once always-on recording is on the recording, running for
 * whoever is still in the Space: End does not touch Pencil, because
 * endOngoingSession ends only the analytics session (Pencil support,
 * 2026-10-16). Leaving the Space is what ends the call.
 *
 * Demo mode persists nothing, so there is nothing to poll: 404.
 */
export async function GET(_req: Request, { params }: { params: { sessionId: string } }) {
  if (isDemoMode) return json({ error: "Not found" }, 404);
  const supabase = createSupabaseServerClient();
  if (!supabase) return json({ error: "Not configured" }, 503);

  const { data, error } = await supabase
    .from("sessions")
    .select("status, actual_end")
    .eq("id", params.sessionId)
    .maybeSingle();
  if (error) return json({ error: "Unavailable" }, 503);
  if (!data) return json({ error: "Not found" }, 404);

  const body: LessonStatusResponse = {
    status: data.status as SessionStatus,
    actual_end: (data.actual_end as string | null) ?? null,
  };
  return json(body, 200);
}

function json(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
