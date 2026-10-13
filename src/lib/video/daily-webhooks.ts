// ============================================================================
// Daily webhooks — verification and event typing. Pure (node:crypto only).
//
// Daily signs every delivery: X-Webhook-Timestamp and X-Webhook-Signature,
// where the signature is base64(HMAC-SHA256(base64decode(secret),
// `${timestamp}.${body}`)). We verify over the RAW request body and reject
// deliveries older than a few minutes so a captured request cannot be
// replayed. Return 200 fast; do the work after.
// ============================================================================

import { createHmac, timingSafeEqual } from "node:crypto";

export const DAILY_EVENT_TYPES = [
  "meeting.started",
  "meeting.ended",
  "participant.joined",
  "participant.left",
  "recording.started",
  "recording.ready-to-download",
  "recording.error",
  "transcript.started",
  "transcript.ready-to-download",
  "transcript.error",
] as const;
export type DailyEventType = (typeof DAILY_EVENT_TYPES)[number];

export interface DailyWebhookEvent {
  version?: string;
  type: DailyEventType | string;
  id?: string;
  event_ts?: number;
  payload: Record<string, unknown>;
}

export interface VerifyInput {
  rawBody: string;
  timestamp: string | null;
  signature: string | null;
  /** The webhook's hmac secret as Daily gave it (base64). */
  secretBase64: string;
  nowMs?: number;
  /** Reject deliveries whose timestamp is further than this from now. */
  toleranceSeconds?: number;
}

export type VerifyResult = { ok: true } | { ok: false; reason: "missing_headers" | "bad_secret" | "stale" | "mismatch" };

export function verifyDailySignature(input: VerifyInput): VerifyResult {
  const { rawBody, timestamp, signature, secretBase64 } = input;
  if (!timestamp || !signature) return { ok: false, reason: "missing_headers" };
  let key: Buffer;
  try {
    key = Buffer.from(secretBase64, "base64");
    if (key.length === 0) return { ok: false, reason: "bad_secret" };
  } catch {
    return { ok: false, reason: "bad_secret" };
  }
  const tolerance = input.toleranceSeconds ?? 300;
  const ts = Number(timestamp);
  const now = (input.nowMs ?? Date.now()) / 1000;
  // Daily sends seconds; be lenient if a millisecond value ever arrives.
  const tsSeconds = ts > 1e12 ? ts / 1000 : ts;
  if (!Number.isFinite(tsSeconds) || Math.abs(now - tsSeconds) > tolerance) return { ok: false, reason: "stale" };

  const expected = createHmac("sha256", key).update(`${timestamp}.${rawBody}`).digest();
  let given: Buffer;
  try {
    given = Buffer.from(signature, "base64");
  } catch {
    return { ok: false, reason: "mismatch" };
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: "mismatch" };
  return { ok: true };
}

/** Compute a signature the way Daily does — for tests and local tooling. */
export function signDailyPayload(rawBody: string, timestamp: string, secretBase64: string): string {
  return createHmac("sha256", Buffer.from(secretBase64, "base64")).update(`${timestamp}.${rawBody}`).digest("base64");
}

/** Pull the fields we use out of a payload, tolerating both naming styles Daily has used. */
export function readPayload(event: DailyWebhookEvent) {
  const p = event.payload ?? {};
  const str = (...keys: string[]) => {
    for (const k of keys) {
      const v = p[k];
      if (typeof v === "string" && v) return v;
    }
    return null;
  };
  const num = (...keys: string[]) => {
    for (const k of keys) {
      const v = p[k];
      if (typeof v === "number") return v;
    }
    return null;
  };
  return {
    roomName: str("room_name", "roomName", "room"),
    meetingSessionId: str("meeting_id", "meetingId", "mtgSessionId", "meeting_session_id"),
    recordingId: str("recording_id", "recordingId", "id"),
    transcriptId: str("transcript_id", "transcriptId"),
    participantId: str("participant_id", "participantId", "session_id", "user_id"),
    userName: str("user_name", "userName"),
    duration: num("duration"),
    startTs: num("start_ts", "startTs"),
    endTs: num("end_ts", "endTs"),
    error: str("error", "message"),
  };
}

/** Daily room names are `lesson-<sessionId>` (see daily.ts). */
export function sessionIdFromRoomName(roomName: string | null): string | null {
  if (!roomName) return null;
  const m = roomName.match(/^lesson-([0-9a-f-]{36})$/i);
  return m ? m[1]! : null;
}
