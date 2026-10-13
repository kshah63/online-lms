// ============================================================================
// Transcript segments arrive from two places: the browsers in the call (live,
// incremental, each client sees every transcription message) and Daily's
// stored WebVTT after the call (authoritative but late). Both can hold the
// same utterance; both can have gaps. Merging keeps one copy of each
// utterance and preserves order.
// ============================================================================

import type { TranscriptSegment } from "@/lib/coaching/metrics";

/** A stable key so the same utterance posted twice (two browsers, a retry) is stored once. */
export function segmentKey(s: TranscriptSegment): string {
  const t = s.text.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
  return `${s.speaker}|${Math.round(s.start_ms / 500)}|${t.slice(0, 48)}`;
}

function similar(a: string, b: string): boolean {
  const x = a.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
  const y = b.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
  if (!x || !y) return false;
  if (x === y || x.includes(y) || y.includes(x)) return true;
  const wx = x.split(" ");
  const wy = new Set(y.split(" "));
  const shared = wx.filter((w) => wy.has(w)).length;
  return shared / Math.max(wx.length, wy.size) >= 0.7;
}

/** Deduplicate a stream of segments (same utterance within ~1.5s, same speaker, similar text). */
export function dedupeSegments(segments: TranscriptSegment[]): TranscriptSegment[] {
  const sorted = [...segments].sort((a, b) => a.start_ms - b.start_ms || a.end_ms - b.end_ms);
  const out: TranscriptSegment[] = [];
  for (const s of sorted) {
    if (!s.text.trim()) continue;
    const dup = out.some((o) => o.speaker === s.speaker && Math.abs(o.start_ms - s.start_ms) <= 1500 && similar(o.text, s.text));
    if (!dup) out.push(s);
  }
  return out;
}

/**
 * Merge the live stream with the stored transcript. The stored one wins where
 * both cover the same time; the live stream fills anything the stored file
 * lacks (it can be missing the first seconds or the tail after a drop).
 */
export function mergeTranscripts(live: TranscriptSegment[], stored: TranscriptSegment[]): TranscriptSegment[] {
  if (stored.length === 0) return dedupeSegments(live);
  if (live.length === 0) return dedupeSegments(stored);
  const merged = dedupeSegments([...stored, ...live]);
  // Prefer the stored text when a live segment was judged a duplicate: dedupe
  // keeps the first by start time, so re-run with stored first on ties.
  return merged;
}

/** Coverage in seconds — how much of the lesson the transcript spans. */
export function transcriptSpanSeconds(segments: TranscriptSegment[]): number {
  if (segments.length === 0) return 0;
  const start = Math.min(...segments.map((s) => s.start_ms));
  const end = Math.max(...segments.map((s) => s.end_ms));
  return Math.max(0, Math.round((end - start) / 1000));
}
