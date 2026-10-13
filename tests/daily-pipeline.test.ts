import { describe, expect, it } from "vitest";
import { readPayload, sessionIdFromRoomName, signDailyPayload, verifyDailySignature } from "@/lib/video/daily-webhooks";
import { mayAccessRecording, recordingModeFor, retentionDeadline, roomPropertiesFor } from "@/lib/video/daily-config";
import { parseVtt, speakerRole, vttToSegments } from "@/lib/transcripts/vtt";
import { dedupeSegments, mergeTranscripts, segmentKey, transcriptSpanSeconds } from "@/lib/transcripts/merge";

const SECRET = Buffer.from("a-very-secret-key-of-reasonable-length").toString("base64");

describe("Daily webhook verification", () => {
  const body = JSON.stringify({ type: "meeting.ended", payload: { room_name: "lesson-11111111-2222-3333-4444-555555555555" } });
  const ts = String(Math.floor(Date.now() / 1000));
  it("accepts a correctly signed, fresh delivery", () => {
    const sig = signDailyPayload(body, ts, SECRET);
    expect(verifyDailySignature({ rawBody: body, timestamp: ts, signature: sig, secretBase64: SECRET })).toEqual({ ok: true });
  });
  it("rejects a tampered body, a wrong secret, a stale timestamp and missing headers", () => {
    const sig = signDailyPayload(body, ts, SECRET);
    expect(verifyDailySignature({ rawBody: body + " ", timestamp: ts, signature: sig, secretBase64: SECRET })).toMatchObject({ ok: false, reason: "mismatch" });
    expect(verifyDailySignature({ rawBody: body, timestamp: ts, signature: sig, secretBase64: Buffer.from("other").toString("base64") })).toMatchObject({ ok: false, reason: "mismatch" });
    const old = String(Math.floor(Date.now() / 1000) - 3600);
    expect(verifyDailySignature({ rawBody: body, timestamp: old, signature: signDailyPayload(body, old, SECRET), secretBase64: SECRET })).toMatchObject({ ok: false, reason: "stale" });
    expect(verifyDailySignature({ rawBody: body, timestamp: null, signature: sig, secretBase64: SECRET })).toMatchObject({ ok: false, reason: "missing_headers" });
  });
  it("reads payload fields in either naming style and maps room names to sessions", () => {
    expect(readPayload({ type: "transcript.ready-to-download", payload: { transcriptId: "t1", room_name: "lesson-x" } }).transcriptId).toBe("t1");
    expect(readPayload({ type: "recording.ready-to-download", payload: { recording_id: "r1", duration: 120 } })).toMatchObject({ recordingId: "r1", duration: 120 });
    expect(sessionIdFromRoomName("lesson-11111111-2222-3333-4444-555555555555")).toBe("11111111-2222-3333-4444-555555555555");
    expect(sessionIdFromRoomName("other-room")).toBeNull();
  });
});

describe("room policy from consents", () => {
  it("captures nothing the family did not agree to", () => {
    expect(recordingModeFor({ ai_analysis: true, recording: false, video_recording: false })).toBe("none");
    expect(recordingModeFor({ ai_analysis: true, recording: true, video_recording: false })).toBe("audio");
    expect(recordingModeFor({ ai_analysis: true, recording: true, video_recording: true })).toBe("video");
    expect(recordingModeFor({ ai_analysis: true, recording: false, video_recording: true })).toBe("none");
    const none = roomPropertiesFor({ consents: { ai_analysis: false, recording: false, video_recording: false }, expiresAt: 1 });
    expect(none.properties.enable_transcription).toBe(false);
    expect(none.properties.enable_recording).toBeUndefined();
    const audio = roomPropertiesFor({ consents: { ai_analysis: true, recording: true, video_recording: false }, expiresAt: 1, bucket: { bucket_name: "b", bucket_region: "ap-southeast-1", assume_role_arn: "arn" } });
    expect(audio.properties.enable_recording).toBe("cloud-audio-only");
    expect(audio.properties.recordings_bucket?.allow_api_access).toBe(true);
    expect(audio.properties.enable_transcription_storage).toBe(true);
  });
  it("sets a 90-day retention deadline and limits access", () => {
    expect(retentionDeadline("2026-01-01T00:00:00.000Z")).toBe("2026-04-01T00:00:00.000Z");
    const session = { teacherId: "t" };
    expect(mayAccessRecording({ role: "admin", id: "a", isInChargeOfSession: false, familyMatches: false }, session)).toBe(true);
    expect(mayAccessRecording({ role: "teacher", id: "t", isInChargeOfSession: false, familyMatches: false }, session)).toBe(true);
    expect(mayAccessRecording({ role: "teacher", id: "other", isInChargeOfSession: false, familyMatches: false }, session)).toBe(false);
    expect(mayAccessRecording({ role: "parent", id: "p", isInChargeOfSession: false, familyMatches: true }, session)).toBe(true);
    expect(mayAccessRecording({ role: "support", id: "s", isInChargeOfSession: false, familyMatches: false }, session)).toBe(false);
  });
});

describe("WebVTT parsing", () => {
  const vtt = `WEBVTT

1
00:00:01.000 --> 00:00:04.500
<v Maya Chen>Let's start with the first question.

00:00:05.000 --> 00:00:07.000
<v Aarav Sharma>Okay, I think we expand first?

NOTE a comment

00:01:02.250 --> 00:01:03.000
Teacher: Good thinking.
`;
  it("reads cues, voice tags and colon labels", () => {
    const cues = parseVtt(vtt);
    expect(cues).toHaveLength(3);
    expect(cues[0]).toEqual({ start_ms: 1000, end_ms: 4500, speaker: "Maya Chen", text: "Let's start with the first question." });
    expect(cues[1]!.speaker).toBe("Aarav Sharma");
    expect(cues[2]).toMatchObject({ start_ms: 62250, speaker: "Teacher", text: "Good thinking." });
  });
  it("maps speakers to roles, defaulting unknown voices to the student", () => {
    const names = { teacher: "Maya Chen", student: "Aarav Sharma" };
    expect(speakerRole("Maya Chen", names)).toBe("teacher");
    expect(speakerRole("Maya", names)).toBe("teacher");
    expect(speakerRole("Teacher", names)).toBe("teacher");
    expect(speakerRole("Aarav", names)).toBe("student");
    expect(speakerRole(null, names)).toBe("student");
    const segs = vttToSegments(vtt, names);
    expect(segs.map((s) => s.speaker)).toEqual(["teacher", "student", "teacher"]);
  });
});

describe("transcript merging", () => {
  const seg = (speaker: "teacher" | "student", text: string, s: number, e: number) => ({ speaker, text, start_ms: s, end_ms: e });
  it("dedupes the same utterance seen from two browsers", () => {
    const a = seg("teacher", "Let's start with the first question.", 1000, 4500);
    const b = seg("teacher", "Lets start with the first question", 1200, 4400);
    expect(segmentKey(a)).toBe(segmentKey(b));
    expect(dedupeSegments([a, b])).toHaveLength(1);
  });
  it("keeps different utterances close in time", () => {
    const d = dedupeSegments([seg("teacher", "Yes.", 1000, 1500), seg("student", "Yes.", 1200, 1600), seg("teacher", "And the next one?", 1800, 3000)]);
    expect(d).toHaveLength(3);
  });
  it("merges a stored transcript with the live stream, filling gaps either way", () => {
    const live = [seg("teacher", "Hello there", 0, 1000), seg("student", "Hi", 1200, 1500), seg("teacher", "Tail after a drop", 90_000, 92_000)];
    const stored = [seg("student", "Hi", 1250, 1500), seg("teacher", "Middle part only in storage", 30_000, 33_000)];
    const merged = mergeTranscripts(live, stored);
    expect(merged.map((s) => s.text)).toEqual(["Hello there", "Hi", "Middle part only in storage", "Tail after a drop"]);
    expect(transcriptSpanSeconds(merged)).toBe(92);
  });
});
