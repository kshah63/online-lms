import { PlayCircle } from "lucide-react";
import { DateTime } from "luxon";
import { isDemoMode } from "@/lib/env";
import { getLessonRecording, recordingIsAvailable } from "@/lib/data/recording";
import type { Profile } from "@/lib/types";

/**
 * "Recording available until <date>" on a lesson's report or brief row, or
 * nothing at all. Whether the viewer may see the row is lesson_recordings'
 * policy (teacher, in-charge, admin; the household with the recording
 * consent); the link itself asks Daily for a fresh playback link on click.
 * In demo mode there is no recording to play, and the link says so.
 */
export async function RecordingLink({ viewer, sessionId, tz, className }: { viewer: Profile; sessionId: string; tz: string; className?: string }) {
  let recording;
  try {
    recording = await getLessonRecording(viewer, sessionId);
  } catch (err) {
    return <span className={className ?? "text-xs text-destructive"}>Recording could not be checked: {err instanceof Error ? err.message : String(err)}</span>;
  }
  if (!recordingIsAvailable(recording)) return null;

  const until = recording.expires_at ? DateTime.fromISO(recording.expires_at, { zone: "utc" }).setZone(tz).toFormat("d LLL yyyy") : null;
  const href = isDemoMode ? "/recordings/demo" : `/api/lesson/${sessionId}/recording`;
  return (
    <a href={href} target="_blank" rel="noreferrer" className={className ?? "inline-flex items-center gap-1.5 text-sm text-primary hover:underline"}>
      <PlayCircle className="h-4 w-4" />
      {until ? `Recording available until ${until}` : "Recording available"}
    </a>
  );
}
