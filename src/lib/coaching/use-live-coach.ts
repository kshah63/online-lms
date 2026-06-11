"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createCoachState, evaluateTick, ingestSegment, type Nudge } from "@/lib/coaching/coach";
import type { TranscriptSegment } from "@/lib/coaching/metrics";
import { logLiveEvent } from "@/lib/actions/coaching";

/**
 * §7.2 Live coach controller. Feeds transcript segments through the rolling
 * coach state and surfaces the latest nudge (teacher-only, mutable, auto-
 * dismissed). Keeps the running segment list for the post-session analysis.
 */
export function useLiveCoach(sessionId: string, active: boolean) {
  const stateRef = useRef(createCoachState(0));
  const segmentsRef = useRef<TranscriptSegment[]>([]);
  const mutedRef = useRef(false);

  const [nudge, setNudge] = useState<Nudge | null>(null);
  const [muted, setMuted] = useState(false);
  const [count, setCount] = useState(0);

  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  const ingest = useCallback(
    (seg: TranscriptSegment) => {
      segmentsRef.current.push(seg);
      const nudges = ingestSegment(stateRef.current, seg);
      if (nudges.length && active && !mutedRef.current) {
        const latest = nudges[nudges.length - 1];
        setNudge(latest);
        setCount((c) => c + 1);
        void logLiveEvent(sessionId, latest.type, { message: latest.message }).catch(() => {});
      }
    },
    [active, sessionId],
  );

  /** Periodic time-based evaluation (silence, praise drought) using real time. */
  const tick = useCallback(() => {
    const nudges = evaluateTick(stateRef.current, Date.now());
    if (nudges.length && active && !mutedRef.current) {
      const latest = nudges[nudges.length - 1];
      setNudge(latest);
      setCount((c) => c + 1);
      void logLiveEvent(sessionId, latest.type, { message: latest.message }).catch(() => {});
    }
  }, [active, sessionId]);

  /** Surface a nudge from an external source (the periodic LLM pass). */
  const pushExternalNudge = useCallback(
    (message: string) => {
      if (!message || !active || mutedRef.current) return;
      const n = { type: "ai" as const, message, at_ms: Date.now() };
      setNudge(n);
      setCount((c) => c + 1);
      void logLiveEvent(sessionId, "ai", { message }).catch(() => {});
    },
    [active, sessionId],
  );

  const dismiss = useCallback(() => setNudge(null), []);

  useEffect(() => {
    if (!nudge) return;
    const t = setTimeout(() => setNudge(null), 8_000);
    return () => clearTimeout(t);
  }, [nudge]);

  const getSegments = useCallback(() => segmentsRef.current, []);

  return { ingest, tick, pushExternalNudge, nudge, dismiss, muted, setMuted, count, getSegments };
}
