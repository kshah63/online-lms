"use client";

// ============================================================================
// Browser wiring for test mode. Listens for the events the engine scores,
// drives the pause/flag state, and hands every recorded event to `onEvent`
// so the server can persist it and the teacher can see it live.
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createIntegrityState,
  effectiveElapsedMs,
  recordEvent,
  resume,
  summarize,
  type IntegrityAction,
  type IntegrityEvent,
  type IntegrityEventType,
  type IntegritySettings,
  type IntegrityState,
  type IntegritySummary,
} from "./engine";

export interface UseTestIntegrityOptions {
  /** Whether test mode is active. Nothing is listened to when false. */
  active: boolean;
  startedAtMs: number;
  settings?: Partial<IntegritySettings>;
  /** Called for every event the engine KEEPS (after grace and coalescing). */
  onEvent?: (event: IntegrityEvent, actions: IntegrityAction[], summary: IntegritySummary) => void;
  /** Called once when the attempt becomes flagged. */
  onFlag?: (summary: IntegritySummary) => void;
  /** Called when the timer pauses (the student left) and when it resumes (they came back). */
  onPause?: (event: IntegrityEvent) => void;
  onResume?: (pausedMs: number) => void;
  /** The camera stream, when require_camera is on, so track loss is detected. */
  cameraStream?: MediaStream | null;
}

export function useTestIntegrity(opts: UseTestIntegrityOptions) {
  const stateRef = useRef<IntegrityState>(createIntegrityState(opts.startedAtMs, opts.settings));
  const [, force] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const rerender = useCallback(() => force((n) => n + 1), []);

  const record = useCallback(
    (type: IntegrityEventType, detail?: string) => {
      const event: IntegrityEvent = { type, at_ms: Date.now(), detail };
      const before = stateRef.current.events.length;
      const { actions } = recordEvent(stateRef.current, event);
      const kept = stateRef.current.events.length > before;
      const summary = summarize(stateRef.current);
      if (kept) opts.onEvent?.(event, actions, summary);
      if (actions.includes("pause")) opts.onPause?.(event);
      if (actions.includes("flag")) opts.onFlag?.(summary);
      rerender();
    },
    [opts, rerender],
  );

  const back = useCallback(() => {
    const since = stateRef.current.paused_since_ms;
    resume(stateRef.current, Date.now());
    if (since !== null) opts.onResume?.(Date.now() - since);
    rerender();
  }, [opts, rerender]);

  const requestFullscreen = useCallback(async () => {
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen({ navigationUI: "hide" });
    } catch {
      /* the student will be asked again */
    }
  }, []);

  useEffect(() => {
    if (!opts.active) return;
    const settings = stateRef.current.settings;

    const onVisibility = () => {
      if (document.visibilityState === "hidden") record("visibility_hidden");
      else back();
    };
    const onBlur = () => record("window_blur");
    const onFocus = () => back();
    const onFullscreen = () => {
      const fs = Boolean(document.fullscreenElement);
      setIsFullscreen(fs);
      if (!fs && settings.require_fullscreen) record("fullscreen_exit");
      else if (fs) back();
    };
    const onPaste = (e: ClipboardEvent) => {
      e.preventDefault();
      record("paste");
    };
    const onCopy = (e: ClipboardEvent) => {
      e.preventDefault();
      record("copy");
    };
    const onContext = (e: MouseEvent) => {
      e.preventDefault();
      record("context_menu");
    };
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      const meta = e.ctrlKey || e.metaKey;
      const devtools =
        k === "f12" ||
        (meta && e.shiftKey && ["i", "j", "c"].includes(k)) ||
        (meta && e.altKey && ["i", "j", "c"].includes(k)) ||
        (meta && k === "u");
      if (devtools) {
        e.preventDefault();
        record("devtools_shortcut", e.key);
      }
    };
    const onOffline = () => record("offline");
    const onOnline = () => back();

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    document.addEventListener("fullscreenchange", onFullscreen);
    document.addEventListener("paste", onPaste, true);
    document.addEventListener("copy", onCopy, true);
    document.addEventListener("cut", onCopy, true);
    document.addEventListener("contextmenu", onContext, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    setIsFullscreen(Boolean(document.fullscreenElement));

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("fullscreenchange", onFullscreen);
      document.removeEventListener("paste", onPaste, true);
      document.removeEventListener("copy", onCopy, true);
      document.removeEventListener("cut", onCopy, true);
      document.removeEventListener("contextmenu", onContext, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
    };
  }, [opts.active, record, back]);

  // Camera track loss (student turned it off, unplugged it, or revoked permission).
  useEffect(() => {
    if (!opts.active || !opts.cameraStream) return;
    const tracks = opts.cameraStream.getVideoTracks();
    if (tracks.length === 0) {
      record("camera_denied");
      return;
    }
    const onEnded = () => record("camera_off", "track ended");
    const onMute = () => record("camera_off", "track muted");
    const onUnmute = () => back();
    for (const t of tracks) {
      t.addEventListener("ended", onEnded);
      t.addEventListener("mute", onMute);
      t.addEventListener("unmute", onUnmute);
    }
    return () => {
      for (const t of tracks) {
        t.removeEventListener("ended", onEnded);
        t.removeEventListener("mute", onMute);
        t.removeEventListener("unmute", onUnmute);
      }
    };
  }, [opts.active, opts.cameraStream, record, back]);

  const summary = useMemo(() => summarize(stateRef.current), [stateRef.current.events.length, stateRef.current.flagged]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    state: stateRef.current,
    summary,
    paused: stateRef.current.paused_since_ms !== null,
    isFullscreen,
    requestFullscreen,
    /** Working time so far, excluding pauses. */
    elapsedMs: () => effectiveElapsedMs(stateRef.current, Date.now()),
    /** Manual override: the teacher or the student confirms they are back. */
    resume: back,
  };
}
