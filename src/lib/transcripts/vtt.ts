// ============================================================================
// WebVTT → transcript segments. Daily stores real-time transcripts as WebVTT
// when transcription storage is on; cues may carry a voice tag like
// `<v Maya Chen>` naming the speaker. We map names to roles with a lookup the
// caller supplies (teacher name / student name), defaulting unknown voices to
// the student so a teacher-only transcript is never produced by accident.
// ============================================================================

import type { TranscriptSegment } from "@/lib/coaching/metrics";

export interface VttCue {
  start_ms: number;
  end_ms: number;
  speaker: string | null;
  text: string;
}

const TIME = /(?:(\d{1,2}):)?(\d{2}):(\d{2})[.,](\d{3})/;

export function parseVttTimestamp(s: string): number | null {
  const m = s.trim().match(TIME);
  if (!m) return null;
  const h = m[1] ? Number(m[1]) : 0;
  return ((h * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000 + Number(m[4]);
}

export function parseVtt(text: string): VttCue[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const cues: VttCue[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!.trim();
    if (!line || line === "WEBVTT" || line.startsWith("NOTE") || line.startsWith("STYLE") || line.startsWith("REGION")) {
      i++;
      continue;
    }
    // Optional cue identifier line precedes the timing line.
    let timing = line;
    if (!timing.includes("-->")) {
      i++;
      timing = (lines[i] ?? "").trim();
    }
    if (!timing.includes("-->")) {
      i++;
      continue;
    }
    const [a, b] = timing.split("-->");
    const start = parseVttTimestamp(a ?? "");
    const end = parseVttTimestamp((b ?? "").split(/\s+/)[1] ?? b ?? "");
    i++;
    const body: string[] = [];
    while (i < lines.length && lines[i]!.trim() !== "") {
      body.push(lines[i]!);
      i++;
    }
    if (start === null || end === null) continue;
    let speaker: string | null = null;
    let joined = body.join(" ").trim();
    const voice = joined.match(/^<v(?:\.[^\s>]+)?\s+([^>]+)>/);
    if (voice) {
      speaker = voice[1]!.trim();
      joined = joined.replace(/^<v[^>]*>/, "").replace(/<\/v>/g, "").trim();
    } else {
      const colon = joined.match(/^([A-Za-z][\w .'-]{0,40}):\s+(.+)$/);
      if (colon) {
        speaker = colon[1]!.trim();
        joined = colon[2]!.trim();
      }
    }
    joined = joined.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (joined) cues.push({ start_ms: start, end_ms: Math.max(end, start), speaker, text: joined });
  }
  return cues;
}

/** Decide teacher vs student for a cue's speaker label. */
export function speakerRole(label: string | null, names: { teacher: string; student: string }): "teacher" | "student" {
  if (!label) return "student";
  const l = label.toLowerCase();
  const t = names.teacher.toLowerCase();
  const s = names.student.toLowerCase();
  if (l === t || l.includes(t) || t.includes(l)) return "teacher";
  if (l === s || l.includes(s) || s.includes(l)) return "student";
  if (/teacher|tutor/.test(l)) return "teacher";
  const tFirst = t.split(" ")[0] ?? t;
  if (tFirst && l.split(" ")[0] === tFirst) return "teacher";
  return "student";
}

export function vttToSegments(text: string, names: { teacher: string; student: string }): TranscriptSegment[] {
  return parseVtt(text).map((c) => ({ speaker: speakerRole(c.speaker, names), text: c.text, start_ms: c.start_ms, end_ms: c.end_ms }));
}
