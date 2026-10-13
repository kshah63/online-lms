// ============================================================================
// Test-mode integrity — the state machine.
//
// A browser cannot lock a device. What it can do is REQUIRE fullscreen and
// camera, DETECT the things a student does to look elsewhere (leaving the tab,
// switching windows, exiting fullscreen, pasting, opening devtools, turning
// the camera off) and make each one cost something: the timer pauses, the
// teacher sees it live, it is logged, and enough of them flag the attempt for
// review. This module is pure so the rules are unit-tested; the browser
// wiring lives in use-test-integrity.ts.
// ============================================================================

export type IntegrityEventType =
  | "visibility_hidden"
  | "window_blur"
  | "fullscreen_exit"
  | "paste"
  | "copy"
  | "context_menu"
  | "devtools_shortcut"
  | "camera_off"
  | "camera_denied"
  | "offline"
  | "resize";

export interface IntegrityEvent {
  type: IntegrityEventType;
  at_ms: number;
  detail?: string;
}

export interface IntegritySettings {
  /** Flag the attempt once the weighted severity reaches this. */
  flag_at_severity: number;
  /** …or once this many events (after coalescing) have been recorded. */
  flag_at_count: number;
  /** Events in the first N ms are ignored: the student is still setting up. */
  grace_ms: number;
  /** Two events of these kinds within this window count once (blur + hidden fire together). */
  coalesce_ms: number;
  /** Which events pause the timer until the student returns. */
  pause_on: IntegrityEventType[];
  require_fullscreen: boolean;
  require_camera: boolean;
}

export const DEFAULT_SETTINGS: IntegritySettings = {
  flag_at_severity: 6,
  flag_at_count: 4,
  grace_ms: 15_000,
  coalesce_ms: 1_500,
  pause_on: ["visibility_hidden", "window_blur", "fullscreen_exit", "camera_off", "offline"],
  require_fullscreen: true,
  require_camera: true,
};

/** How much each kind of event counts toward flagging. */
export const SEVERITY: Record<IntegrityEventType, number> = {
  visibility_hidden: 2,
  window_blur: 1,
  fullscreen_exit: 2,
  paste: 3,
  copy: 1,
  context_menu: 0.5,
  devtools_shortcut: 3,
  camera_off: 2,
  camera_denied: 3,
  offline: 0.5,
  resize: 0.5,
};

export interface IntegrityState {
  settings: IntegritySettings;
  started_at_ms: number;
  events: IntegrityEvent[];
  /** Raw events dropped by grace or coalescing — kept for the audit trail. */
  ignored: IntegrityEvent[];
  paused_since_ms: number | null;
  total_paused_ms: number;
  severity: number;
  flagged: boolean;
  flagged_at_ms: number | null;
}

export type IntegrityAction = "pause" | "flag" | "warn";

export function createIntegrityState(
  started_at_ms: number,
  settings: Partial<IntegritySettings> = {},
): IntegrityState {
  return {
    settings: { ...DEFAULT_SETTINGS, ...settings },
    started_at_ms,
    events: [],
    ignored: [],
    paused_since_ms: null,
    total_paused_ms: 0,
    severity: 0,
    flagged: false,
    flagged_at_ms: null,
  };
}

const COALESCE_GROUPS: IntegrityEventType[][] = [
  ["visibility_hidden", "window_blur", "fullscreen_exit"],
  ["copy", "context_menu"],
];

function sameGroup(a: IntegrityEventType, b: IntegrityEventType): boolean {
  return a === b || COALESCE_GROUPS.some((g) => g.includes(a) && g.includes(b));
}

/** Record an event. Mutates and returns the state plus the actions the UI should take. */
export function recordEvent(
  state: IntegrityState,
  event: IntegrityEvent,
): { state: IntegrityState; actions: IntegrityAction[] } {
  const actions: IntegrityAction[] = [];
  const { settings } = state;

  // Setup grace: the student is still granting camera / entering fullscreen.
  if (event.at_ms - state.started_at_ms < settings.grace_ms) {
    state.ignored.push(event);
    return { state, actions };
  }

  // Coalesce: blur + visibility_hidden + fullscreen_exit arrive together.
  const last = state.events[state.events.length - 1];
  if (last && sameGroup(last.type, event.type) && event.at_ms - last.at_ms <= settings.coalesce_ms) {
    state.ignored.push(event);
    // Still pause if this kind pauses and we are not already paused.
    if (settings.pause_on.includes(event.type) && state.paused_since_ms === null) {
      state.paused_since_ms = event.at_ms;
      actions.push("pause");
    }
    return { state, actions };
  }

  state.events.push(event);
  state.severity += SEVERITY[event.type];
  actions.push("warn");

  if (settings.pause_on.includes(event.type) && state.paused_since_ms === null) {
    state.paused_since_ms = event.at_ms;
    actions.push("pause");
  }

  if (
    !state.flagged &&
    (state.severity >= settings.flag_at_severity || state.events.length >= settings.flag_at_count)
  ) {
    state.flagged = true;
    state.flagged_at_ms = event.at_ms;
    actions.push("flag");
  }

  return { state, actions };
}

/** The student came back (tab visible, fullscreen restored, camera on). */
export function resume(state: IntegrityState, now_ms: number): IntegrityState {
  if (state.paused_since_ms !== null) {
    state.total_paused_ms += Math.max(0, now_ms - state.paused_since_ms);
    state.paused_since_ms = null;
  }
  return state;
}

/** Working time: wall clock minus every pause. */
export function effectiveElapsedMs(state: IntegrityState, now_ms: number): number {
  const paused = state.total_paused_ms + (state.paused_since_ms !== null ? now_ms - state.paused_since_ms : 0);
  return Math.max(0, now_ms - state.started_at_ms - paused);
}

export interface IntegritySummary {
  flagged: boolean;
  severity: number;
  event_count: number;
  counts: Partial<Record<IntegrityEventType, number>>;
  total_paused_ms: number;
  /** One line for the teacher: "3 events: left the tab ×2, pasted ×1". */
  headline: string;
}

const LABEL: Record<IntegrityEventType, string> = {
  visibility_hidden: "left the tab",
  window_blur: "switched window",
  fullscreen_exit: "exited fullscreen",
  paste: "pasted",
  copy: "copied",
  context_menu: "right-clicked",
  devtools_shortcut: "devtools shortcut",
  camera_off: "camera off",
  camera_denied: "camera denied",
  offline: "went offline",
  resize: "resized window",
};

export function summarize(state: IntegrityState): IntegritySummary {
  const counts: Partial<Record<IntegrityEventType, number>> = {};
  for (const e of state.events) counts[e.type] = (counts[e.type] ?? 0) + 1;
  const parts = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([t, n]) => `${LABEL[t as IntegrityEventType]} ×${n}`);
  const n = state.events.length;
  return {
    flagged: state.flagged,
    severity: Math.round(state.severity * 10) / 10,
    event_count: n,
    counts,
    total_paused_ms: state.total_paused_ms,
    headline: n === 0 ? "No integrity events" : `${n} event${n > 1 ? "s" : ""}: ${parts.join(", ")}`,
  };
}
