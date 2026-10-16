import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildSpaceUrl,
  isZoomUrl,
  JOIN_PARAMS,
  lessonFallbackForced,
  masterFallbackUrl,
  mintJoinUrl,
  PENCIL_ALLOWED_ORIGINS,
  recordingActive,
  resolveFallbackUrl,
  spaceUrlFor,
} from "@/lib/pencil/urls";
import type { PencilSpace } from "@/lib/types";

// Space URL params decide what the room does when the token URL lands (call
// auto-start, embed events, standalone chrome), and the fallback resolution
// order is the outage runbook — both must be exact.

const LINK = "https://my.pencilapp.com/spaces/507f1f77bcf86cd799439011";

function space(over: Partial<PencilSpace> = {}): PencilSpace {
  return {
    id: "space-1",
    student_id: "s1",
    course_id: "c1",
    external_id: "c1:s1",
    pencil_space_id: "507f1f77bcf86cd799439011",
    link: LINK,
    title: "IGCSE Mathematics · Aarav",
    host_profile_ids: [],
    participant_profile_ids: ["s1"],
    hosts_synced_at: null,
    recording_disabled: false,
    recording_verified_at: null,
    status: "active",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("buildSpaceUrl", () => {
  it("appends params, encodes values and renders true as 'true'", () => {
    const url = new URL(buildSpaceUrl(LINK, { startCall: true, language: "en GB", n: 2 }));
    expect(url.origin + url.pathname).toBe(LINK);
    expect(url.searchParams.get("startCall")).toBe("true");
    expect(url.searchParams.get("language")).toBe("en GB");
    expect(url.search).toContain("language=en+GB");
    expect(url.searchParams.get("n")).toBe("2");
  });

  it("omits false / null / undefined and keeps existing query params", () => {
    const url = new URL(buildSpaceUrl(`${LINK}?foo=bar`, { startCall: false, gv: undefined, x: null, standalone: true }));
    expect(url.searchParams.get("foo")).toBe("bar");
    expect(url.searchParams.has("startCall")).toBe(false);
    expect(url.searchParams.has("gv")).toBe(false);
    expect(url.searchParams.has("x")).toBe(false);
    expect(url.searchParams.get("standalone")).toBe("true");
  });
});

describe("spaceUrlFor / JOIN_PARAMS", () => {
  it("lesson links start the call with the host and carry embed events", () => {
    const url = new URL(spaceUrlFor(space(), "lesson"));
    for (const key of ["startCall", "standalone", "broadcastEvents", "gv"]) {
      expect(url.searchParams.get(key)).toBe("true");
    }
    // Pencil support, 2026-10-16: startCall + skipCallHostCheck lets a PARTICIPANT
    // start a call alone, and always-on recording records and bills that call. A
    // student who arrives first waits on the board for the teacher's call instead.
    expect(url.searchParams.has("skipCallHostCheck")).toBe(false);
    // The child confirms mic/camera: never skip device setup.
    expect(url.searchParams.has("skipDeviceSetup")).toBe(false);
  });

  it("board (second device) and homework links are whiteboard-only — no call controls, no join prompt", () => {
    for (const purpose of ["board", "homework"] as const) {
      const url = new URL(spaceUrlFor(space(), purpose));
      expect(url.searchParams.get("standalone")).toBe("true");
      expect(url.searchParams.get("mode")).toBe("whiteboardonly");
      expect(url.searchParams.has("startCall")).toBe(false);
      expect(url.searchParams.has("skipCallHostCheck")).toBe(false);
      expect(Array.from(url.searchParams.keys()).sort()).toEqual(["mode", "standalone"]);
    }
    expect(Object.keys(JOIN_PARAMS).sort()).toEqual(["board", "homework", "lesson"]);
  });

  it("a mock Space gets a link on the reserved .invalid host", () => {
    const url = new URL(spaceUrlFor(space({ status: "mock", link: null, pencil_space_id: null }), "lesson"));
    expect(url.hostname.endsWith(".invalid")).toBe(true);
    expect(url.pathname).toBe("/spaces/space-1");
  });
});

describe("mintJoinUrl (Pencil mocked — no key in the test env)", () => {
  it("returns a mock URL and never calls fetch", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const minted = await mintJoinUrl("mock-user-t1", space(), "lesson");
    expect(minted.mock).toBe(true);
    expect(minted.purpose).toBe("lesson");
    expect(minted.url).toContain("startCall=true");
    expect(new URL(minted.url).hostname.endsWith(".invalid")).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("origins", () => {
  it("always allows both Pencil origins", () => {
    expect(PENCIL_ALLOWED_ORIGINS).toContain("https://my.pencilapp.com");
    expect(PENCIL_ALLOWED_ORIGINS).toContain("https://staging.pencilapp.com");
  });
});

describe("isZoomUrl", () => {
  it("accepts https zoom.us and subdomains only", () => {
    expect(isZoomUrl("https://zoom.us/j/5550001111")).toBe(true);
    expect(isZoomUrl("https://us02web.zoom.us/j/5550001111?pwd=abc")).toBe(true);
    expect(isZoomUrl("https://ZOOM.US/j/1")).toBe(true);
    expect(isZoomUrl("http://zoom.us/j/1")).toBe(false);
    expect(isZoomUrl("https://zoom.us.evil.example/j/1")).toBe(false);
    expect(isZoomUrl("https://notzoom.us/j/1")).toBe(false);
    expect(isZoomUrl("https://meet.google.com/abc")).toBe(false);
    expect(isZoomUrl("")).toBe(false);
    expect(isZoomUrl(null)).toBe(false);
    expect(isZoomUrl("not a url")).toBe(false);
  });
});

describe("resolveFallbackUrl (session override → master Zoom link → null)", () => {
  const MASTER = "https://us02web.zoom.us/j/5550001111?pwd=school";

  it("the admin's per-lesson override wins over the master link", () => {
    vi.stubEnv("LESSON_FALLBACK_URL", MASTER);
    expect(resolveFallbackUrl({ fallback_join_url: "https://meet.example.com/x" })).toBe("https://meet.example.com/x");
  });

  it("falls back to LESSON_FALLBACK_URL, then null", () => {
    vi.stubEnv("LESSON_FALLBACK_URL", MASTER);
    expect(resolveFallbackUrl({ fallback_join_url: null })).toBe(MASTER);
    expect(resolveFallbackUrl(null)).toBe(MASTER);
    expect(masterFallbackUrl()).toBe(MASTER);
    vi.stubEnv("LESSON_FALLBACK_URL", "");
    expect(resolveFallbackUrl({ fallback_join_url: null })).toBeNull();
    expect(resolveFallbackUrl(null)).toBeNull();
    expect(masterFallbackUrl()).toBeNull();
  });

  it("ignores invalid links (non-https override, non-zoom or http master link)", () => {
    vi.stubEnv("LESSON_FALLBACK_URL", MASTER);
    expect(resolveFallbackUrl({ fallback_join_url: "http://insecure.example/x" })).toBe(MASTER);
    expect(resolveFallbackUrl({ fallback_join_url: "javascript:alert(1)" })).toBe(MASTER);
    vi.stubEnv("LESSON_FALLBACK_URL", "https://teams.example/x");
    expect(resolveFallbackUrl({ fallback_join_url: null })).toBeNull();
    vi.stubEnv("LESSON_FALLBACK_URL", "http://zoom.us/j/1");
    expect(resolveFallbackUrl(null)).toBeNull();
    vi.stubEnv("LESSON_FALLBACK_URL", "https://zoom.us.evil.example/j/1");
    expect(resolveFallbackUrl(null)).toBeNull();
  });
});

describe("lessonFallbackForced", () => {
  it("is off by default and on for on/1/true (case-insensitive)", () => {
    vi.stubEnv("LESSON_FALLBACK_MODE", "");
    expect(lessonFallbackForced()).toBe(false);
    vi.stubEnv("LESSON_FALLBACK_MODE", "off");
    expect(lessonFallbackForced()).toBe(false);
    vi.stubEnv("LESSON_FALLBACK_MODE", "on");
    expect(lessonFallbackForced()).toBe(true);
    vi.stubEnv("LESSON_FALLBACK_MODE", "ON ");
    expect(lessonFallbackForced()).toBe(true);
    vi.stubEnv("LESSON_FALLBACK_MODE", "1");
    expect(lessonFallbackForced()).toBe(true);
    vi.stubEnv("LESSON_FALLBACK_MODE", "true");
    expect(lessonFallbackForced()).toBe(true);
  });
});

describe("recordingActive (PENCIL_RECORDING_ENABLED)", () => {
  it("demo mode (this suite) shows the full product unless switched off explicitly", () => {
    vi.stubEnv("PENCIL_RECORDING_ENABLED", "");
    expect(recordingActive()).toBe(true);
    vi.stubEnv("PENCIL_RECORDING_ENABLED", "off");
    expect(recordingActive()).toBe(false);
    vi.stubEnv("PENCIL_RECORDING_ENABLED", "on");
    expect(recordingActive()).toBe(true);
    vi.stubEnv("PENCIL_RECORDING_ENABLED", "TRUE");
    expect(recordingActive()).toBe(true);
  });
});
