// ============================================================================
// What a lesson room is allowed to capture, from the family's consents.
// Pure, so the policy is testable; daily.ts applies it to the Daily API.
//
//   no recording consent  → transcription only (text), no media stored
//   recording consent     → cloud-audio-only (audio file) + notebook timeline
//   video consent         → full cloud recording (video of the call)
// Transcription needs ai_analysis consent; without it the coach and the
// post-session analysis are off and the room is just a video call.
// ============================================================================

export type RecordingMode = "none" | "audio" | "video";

export interface LessonConsents {
  /** Family agreed to AI analysis of the lesson (transcription + coaching). */
  ai_analysis: boolean;
  /** Family agreed to recording the lesson's audio. */
  recording: boolean;
  /** Family opted in to full video recording (implies recording). */
  video_recording: boolean;
}

export function recordingModeFor(c: LessonConsents): RecordingMode {
  if (c.video_recording && c.recording) return "video";
  if (c.recording) return "audio";
  return "none";
}

export interface DailyRoomProperties {
  privacy: "private";
  properties: {
    enable_transcription: boolean;
    enable_transcription_storage: boolean;
    enable_recording?: "cloud" | "cloud-audio-only";
    enable_prejoin_ui: false;
    enable_screenshare: true;
    exp: number;
    eject_at_room_exp: true;
    recordings_bucket?: { bucket_name: string; bucket_region: string; assume_role_arn: string; allow_api_access: boolean };
  };
}

export interface RoomPolicyInput {
  consents: LessonConsents;
  /** Unix seconds when the room should expire. */
  expiresAt: number;
  bucket?: { bucket_name: string; bucket_region: string; assume_role_arn: string } | null;
}

/** The room body sent to Daily. Nothing is captured that the family did not agree to. */
export function roomPropertiesFor(input: RoomPolicyInput): DailyRoomProperties {
  const mode = recordingModeFor(input.consents);
  const properties: DailyRoomProperties["properties"] = {
    enable_transcription: input.consents.ai_analysis,
    enable_transcription_storage: input.consents.ai_analysis,
    enable_prejoin_ui: false,
    enable_screenshare: true,
    exp: input.expiresAt,
    eject_at_room_exp: true,
  };
  if (mode === "audio") properties.enable_recording = "cloud-audio-only";
  if (mode === "video") properties.enable_recording = "cloud";
  if (mode !== "none" && input.bucket) properties.recordings_bucket = { ...input.bucket, allow_api_access: true };
  return { privacy: "private", properties };
}

/** Retention: recordings are deleted after this many days unless a review hold is placed. */
export const RECORDING_RETENTION_DAYS = 90;

export function retentionDeadline(recordedAtISO: string, days = RECORDING_RETENTION_DAYS): string {
  const d = new Date(recordedAtISO);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

/** Who may open a recording: admin, the room's in-charge, the lesson's teacher, or the family (their own). */
export function mayAccessRecording(viewer: { role: string; id: string; isInChargeOfSession: boolean; familyMatches: boolean }, session: { teacherId: string | null }): boolean {
  if (viewer.role === "admin") return true;
  if (viewer.isInChargeOfSession) return true;
  if (viewer.role === "teacher" && session.teacherId === viewer.id) return true;
  if ((viewer.role === "parent" || viewer.role === "student") && viewer.familyMatches) return true;
  return false;
}
