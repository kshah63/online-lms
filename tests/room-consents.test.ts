import { describe, expect, it } from "vitest";
import { consentsToRoomPolicy, roomPropertiesFor } from "@/lib/video/daily-config";

describe("consentsToRoomPolicy — mv-app lesson_consents plus the room flag → what Daily may capture", () => {
  it("transcribes only with the transcript consent", () => {
    expect(consentsToRoomPolicy({ recording: false, transcript: true, ai_analysis: false }, true).ai_analysis).toBe(true);
    expect(consentsToRoomPolicy({ recording: false, transcript: false, ai_analysis: true }, true).ai_analysis).toBe(false);
  });

  it("records audio only when the family consented AND the department turned recording on", () => {
    expect(consentsToRoomPolicy({ recording: true, transcript: true, ai_analysis: true }, true).recording).toBe(true);
    expect(consentsToRoomPolicy({ recording: true, transcript: true, ai_analysis: true }, false).recording).toBe(false);
    expect(consentsToRoomPolicy({ recording: false, transcript: true, ai_analysis: true }, true).recording).toBe(false);
  });

  it("never records video — mv-app has no such consent kind", () => {
    const policy = consentsToRoomPolicy({ recording: true, transcript: true, ai_analysis: true }, true);
    expect(policy.video_recording).toBe(false);
    const body = roomPropertiesFor({ consents: policy, expiresAt: 1 });
    expect(body.properties.enable_recording).toBe("cloud-audio-only");
    expect(body.properties.enable_transcription).toBe(true);
  });

  it("with nothing granted the room is just a video call", () => {
    const body = roomPropertiesFor({ consents: consentsToRoomPolicy({ recording: false, transcript: false, ai_analysis: false }, true), expiresAt: 1 });
    expect(body.properties.enable_recording).toBeUndefined();
    expect(body.properties.enable_transcription).toBe(false);
    expect(body.privacy).toBe("private");
  });
});
