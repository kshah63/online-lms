import { describe, expect, it } from "vitest";
import { createIntegrityState, effectiveElapsedMs, recordEvent, resume, summarize } from "@/lib/integrity/engine";

const T0 = 1_000_000;
const afterGrace = T0 + 20_000;

describe("integrity engine", () => {
  it("ignores events during the setup grace period", () => {
    const s = createIntegrityState(T0);
    const { actions } = recordEvent(s, { type: "fullscreen_exit", at_ms: T0 + 2_000 });
    expect(actions).toEqual([]);
    expect(s.events).toHaveLength(0);
    expect(s.ignored).toHaveLength(1);
  });

  it("coalesces blur + hidden + fullscreen_exit that fire together", () => {
    const s = createIntegrityState(T0);
    recordEvent(s, { type: "window_blur", at_ms: afterGrace });
    recordEvent(s, { type: "visibility_hidden", at_ms: afterGrace + 50 });
    recordEvent(s, { type: "fullscreen_exit", at_ms: afterGrace + 400 });
    expect(s.events).toHaveLength(1);
    expect(s.ignored).toHaveLength(2);
    expect(s.paused_since_ms).toBe(afterGrace);
  });

  it("pauses the timer on leaving and resumes on return", () => {
    const s = createIntegrityState(T0);
    const { actions } = recordEvent(s, { type: "visibility_hidden", at_ms: afterGrace });
    expect(actions).toContain("pause");
    resume(s, afterGrace + 30_000);
    expect(s.total_paused_ms).toBe(30_000);
    expect(effectiveElapsedMs(s, afterGrace + 40_000)).toBe(afterGrace + 40_000 - T0 - 30_000);
  });

  it("does not pause for paste but still warns and scores it", () => {
    const s = createIntegrityState(T0);
    const { actions } = recordEvent(s, { type: "paste", at_ms: afterGrace });
    expect(actions).toEqual(["warn"]);
    expect(s.severity).toBe(3);
  });

  it("flags once severity reaches the threshold, exactly once", () => {
    const s = createIntegrityState(T0);
    recordEvent(s, { type: "paste", at_ms: afterGrace }); // 3
    const second = recordEvent(s, { type: "devtools_shortcut", at_ms: afterGrace + 5_000 }); // 6
    expect(second.actions).toContain("flag");
    expect(s.flagged).toBe(true);
    const third = recordEvent(s, { type: "paste", at_ms: afterGrace + 10_000 });
    expect(third.actions).not.toContain("flag");
  });

  it("flags on count even when each event is minor", () => {
    const s = createIntegrityState(T0, { flag_at_count: 3 });
    recordEvent(s, { type: "context_menu", at_ms: afterGrace });
    recordEvent(s, { type: "context_menu", at_ms: afterGrace + 5_000 });
    const r = recordEvent(s, { type: "context_menu", at_ms: afterGrace + 10_000 });
    expect(r.actions).toContain("flag");
  });

  it("summarises for the teacher", () => {
    const s = createIntegrityState(T0);
    recordEvent(s, { type: "visibility_hidden", at_ms: afterGrace });
    recordEvent(s, { type: "visibility_hidden", at_ms: afterGrace + 60_000 });
    recordEvent(s, { type: "paste", at_ms: afterGrace + 70_000 });
    const sum = summarize(s);
    expect(sum.event_count).toBe(3);
    expect(sum.counts.visibility_hidden).toBe(2);
    expect(sum.headline).toBe("3 events: left the tab ×2, pasted ×1");
    expect(summarize(createIntegrityState(T0)).headline).toBe("No integrity events");
  });
});
