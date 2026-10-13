import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/data/auth";
import { getLessonRecording, recordingIsAvailable } from "@/lib/data/recording";
import { isDemoMode } from "@/lib/env";
import { recordingAccessLink } from "@/lib/video/recording-link";

export const dynamic = "force-dynamic";

/**
 * Plays a lesson's recording: selects lesson_recordings under the caller's
 * RLS (so a parent sees it only while the recording consent is in force),
 * asks Daily for a short-lived access link, and redirects to it. No row, no
 * link — the policy's answer is the whole gate. In demo mode there is no
 * recording to play, so this lands on the page that says so.
 */
export async function GET(req: Request, { params }: { params: { sessionId: string } }) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (isDemoMode) return NextResponse.redirect(new URL("/recordings/demo", req.url));

  let recording;
  try {
    recording = await getLessonRecording(profile, params.sessionId);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Recording lookup failed" }, { status: 502 });
  }
  if (!recordingIsAvailable(recording)) {
    return NextResponse.json({ error: "No recording is available for this lesson." }, { status: 404 });
  }

  try {
    const link = await recordingAccessLink(recording.provider_recording_id);
    return NextResponse.redirect(link, { status: 302 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Playback link failed" }, { status: 502 });
  }
}
