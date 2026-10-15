"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ExternalLink,
  Loader2,
  MonitorPlay,
  PenLine,
  Phone,
  RefreshCw,
  ShieldAlert,
  Video,
} from "lucide-react";
import { MockSpacePanel } from "@/components/lesson/video-panel";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { JoinMode, JoinPurpose } from "@/lib/pencil/types";
import type { PencilSpace } from "@/lib/types";
import { cn } from "@/lib/utils";

// ============================================================================
// The classroom itself: embeds the Pencil Space (desktop), or offers the
// Redirect-mode buttons (tablets/phones, second device), the sample room (demo /
// no key), the Zoom fallback, or the recording-policy hard stop.
//
// Join URLs are credentials. They arrive ONLY from POST /api/lesson/[id]/space,
// minted per click, and go straight into iframe.src or window.open — never into
// state that outlives the action, never into the DOM as text, never logged.
// ============================================================================

export type SpaceProvider = "pencil" | "mock" | "fallback";

/** A Pencil embed event (`broadcastEvents=true`), already source- and origin-checked. */
export interface EmbedEvent {
  type: string;
  detail: Record<string, unknown> | null;
}

/** What the route told us about the room, for the header chips / clock gating. */
export interface JoinInfo {
  provider: SpaceProvider;
  studentPencilUserId: string | null;
  recordingOn: boolean | null;
}

/**
 * JSON shapes of POST /api/lesson/[id]/space — the route builds these; keep in
 * sync. Every `configured: false` answer carries a literal `reason`, so the
 * client can switch on it.
 */
export interface SpaceJoinOk {
  configured: true;
  url: string;
  mode: JoinMode;
  purpose: JoinPurpose;
  expiresInSeconds: number;
  spaceId: string | null;
  studentPencilUserId: string | null;
  recordingOn: boolean;
  optedOut: boolean;
  fallbackUrl: string | null;
}
/** Demo / no key: the sample room (mockSpaceJoin + fallbackUrl). */
export interface SpaceJoinMock {
  configured: false;
  mock: true;
  mode: "mock";
  reason: "demo" | "unconfigured";
  space: PencilSpace;
  studentPencilUserId: string;
  teacherPencilUserId: string | null;
  optedOut: boolean;
  /** Recording is switched on (Phase 2+) and this student is not opted out. */
  recordingOn: boolean;
  fallbackJoinUrl: string | null;
  fallbackUrl: string | null;
}
/** Opted-out student whose Space hasn't confirmed recording_disabled: hard stop. */
export interface SpaceJoinBlocked {
  configured: false;
  blocked: "recording_policy";
  reason: "recording_policy";
  fallbackUrl: null;
}
/** Pencil can't be used right now: forced outage mode, misconfiguration, a Pencil error, … */
export interface SpaceJoinUnavailable {
  configured: false;
  reason: "forced" | "service_role_missing" | "pencil_error" | "error" | "rate_limited" | "ended";
  fallback?: boolean;
  transient?: boolean;
  fallbackUrl: string | null;
  error?: string;
}
/** 401 / 403 / 404. */
export interface SpaceJoinDenied {
  configured?: undefined;
  error: string;
}
export type SpaceJoinResponse = SpaceJoinOk | SpaceJoinMock | SpaceJoinBlocked | SpaceJoinUnavailable | SpaceJoinDenied;

/**
 * Origins the embed may speak from. Mirrors PENCIL_ALLOWED_ORIGINS in
 * src/lib/pencil/urls.ts (server-only, so rebuilt here from the public env).
 * NEXT_PUBLIC_* is inlined at build time, which is what we want.
 */
const PENCIL_ALLOWED_ORIGINS: readonly string[] = Array.from(
  new Set(
    ["https://my.pencilapp.com", "https://staging.pencilapp.com", process.env.NEXT_PUBLIC_PENCIL_APP_ORIGIN]
      .map((o) => {
        try {
          const u = new URL((o ?? "").trim());
          return u.protocol === "https:" ? u.origin : null;
        } catch {
          return null;
        }
      })
      .filter((o): o is string => o !== null),
  ),
);

/** Vendor-required permissions for the embedded Space. */
const IFRAME_ALLOW =
  "clipboard-read; clipboard-write; display-capture; fullscreen; autoplay; camera; microphone; picture-in-picture; compute-pressure";

const READY_TIMEOUT_MS = 15_000;

const POPUP_BLOCKED = "Your browser blocked the new tab — allow pop-ups for this site and try again.";

type Phase =
  | { kind: "booting" }
  | { kind: "loading" }
  | { kind: "embedded"; url: string; ready: boolean; stalled: boolean; stalledError: string | null }
  | { kind: "redirect"; opened: JoinPurpose | null; busy: JoinPurpose | null; error: string | null }
  | { kind: "mock"; reason: "demo" | "unconfigured"; studentPencilUserId: string; teacherPencilUserId: string | null; peerJoined: boolean }
  | { kind: "fallback"; url: string | null; message: string; retryable: boolean }
  | { kind: "blocked" }
  | { kind: "error"; message: string; retryable: boolean };

type MintResult =
  | { kind: "url"; url: string; info: JoinInfo }
  | { kind: "phase"; phase: Phase; info?: JoinInfo };

export interface SpaceStageProps {
  sessionId: string;
  /** Teacher or admin (shows "Simulate student joins" in the sample room). */
  hostView: boolean;
  selfName: string;
  peerName: string;
  /** Pencil is mocked (demo / no key): the route answers with the sample room. */
  mock: boolean;
  /** LESSON_FALLBACK_MODE is on: skip Pencil, send everyone to the backup link. */
  fallbackForced: boolean;
  /** Admin override → master Zoom link → null ("No backup link — contact admin"). */
  fallbackUrl: string | null;
  /** Hard stop: opted-out student, Space not yet confirmed as not recording. */
  optOutUnconfirmed: boolean;
  /** The page could not read the room's rows (service role missing / query error). */
  roomUnavailable: boolean;
  onEmbedEvent: (evt: EmbedEvent) => void;
  onJoinInfo: (info: JoinInfo) => void;
}

export function SpaceStage({
  sessionId,
  hostView,
  selfName,
  peerName,
  mock,
  fallbackForced,
  fallbackUrl,
  optOutUnconfirmed,
  roomUnavailable,
  onEmbedEvent,
  onJoinInfo,
}: SpaceStageProps) {
  const [phase, setPhase] = useState<Phase>({ kind: "booting" });
  const [embedCapable, setEmbedCapable] = useState<boolean | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const startedRef = useRef(false);
  const unmountedRef = useRef(false);

  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
    };
  }, []);

  // iframe only on desktop with a fine pointer (plan f); everything else is
  // Redirect mode. Decided once — resizing mid-lesson must not reload the room.
  useEffect(() => {
    const wide = window.matchMedia("(min-width: 1024px)").matches;
    const fine = window.matchMedia("(pointer: fine)").matches;
    setEmbedCapable(wide && fine);
  }, []);

  /** One POST = one minted credential (or a non-credential answer). */
  const mint = useCallback(
    async (purpose: JoinPurpose, mode: JoinMode): Promise<MintResult> => {
      let data: SpaceJoinResponse;
      try {
        const res = await fetch(`/api/lesson/${sessionId}/space`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({ purpose, mode }),
        });
        data = (await res.json()) as SpaceJoinResponse;
      } catch {
        return {
          kind: "phase",
          phase: { kind: "fallback", url: fallbackUrl, message: "We couldn't reach the server.", retryable: true },
          info: fallbackUrl ? { provider: "fallback", studentPencilUserId: null, recordingOn: null } : undefined,
        };
      }

      if (data.configured === undefined) {
        return { kind: "phase", phase: { kind: "error", message: data.error || "You can't join this lesson.", retryable: false } };
      }
      if (data.configured) {
        return {
          kind: "url",
          url: data.url,
          info: { provider: "pencil", studentPencilUserId: data.studentPencilUserId, recordingOn: data.recordingOn },
        };
      }

      const fallbackInfo: JoinInfo = { provider: "fallback", studentPencilUserId: null, recordingOn: null };
      switch (data.reason) {
        case "demo":
        case "unconfigured":
          return {
            kind: "phase",
            phase: {
              kind: "mock",
              reason: data.reason,
              studentPencilUserId: data.studentPencilUserId,
              teacherPencilUserId: data.teacherPencilUserId,
              peerJoined: false,
            },
            info: { provider: "mock", studentPencilUserId: data.studentPencilUserId, recordingOn: data.recordingOn },
          };
        case "recording_policy":
          return { kind: "phase", phase: { kind: "blocked" } };
        case "forced":
          return {
            kind: "phase",
            phase: { kind: "fallback", url: data.fallbackUrl ?? fallbackUrl, message: "Pencil Spaces is switched off for maintenance.", retryable: false },
            info: fallbackInfo,
          };
        case "service_role_missing":
          return {
            kind: "phase",
            phase: { kind: "fallback", url: data.fallbackUrl ?? fallbackUrl, message: "The classroom is not fully configured on the server.", retryable: false },
            info: fallbackInfo,
          };
        case "rate_limited":
          // Same as an outage for the lesson in front of us: offer the backup link, and Retry later.
          return {
            kind: "phase",
            phase: {
              kind: "fallback",
              url: data.fallbackUrl ?? fallbackUrl,
              message: data.error ?? "Too many join attempts — wait a few minutes and try again.",
              retryable: true,
            },
            info: fallbackInfo,
          };
        case "ended":
          return { kind: "phase", phase: { kind: "error", message: data.error ?? "This lesson is over.", retryable: false } };
        default:
          return {
            kind: "phase",
            phase: {
              kind: "fallback",
              url: data.fallbackUrl ?? fallbackUrl,
              message: data.transient === false ? "Pencil Spaces refused the request." : "Pencil Spaces is not responding right now.",
              retryable: data.transient !== false,
            },
            info: fallbackInfo,
          };
      }
    },
    [sessionId, fallbackUrl],
  );

  /**
   * Initial mount (and every Retry): embed on desktop, the sample room when
   * mocked. On a non-embed device nothing is minted here — the Redirect card's
   * buttons mint per tap, so Retry just brings that card back.
   */
  const mountRoom = useCallback(async () => {
    if (!mock && embedCapable === false) {
      setPhase({ kind: "redirect", opened: null, busy: null, error: null });
      return;
    }
    setPhase({ kind: "loading" });
    const result = await mint("lesson", "iframe");
    if (unmountedRef.current) return;
    if (result.kind === "url") {
      onJoinInfo(result.info);
      setPhase({ kind: "embedded", url: result.url, ready: false, stalled: false, stalledError: null });
      return;
    }
    if (result.info) onJoinInfo(result.info);
    setPhase(result.phase);
  }, [mint, onJoinInfo, mock, embedCapable]);

  /**
   * Redirect mode and the "Open in a new tab" rescue: open the tab inside the
   * user gesture (popup blockers), then point it at the freshly minted URL.
   * The new tab gets no `opener` — the Space can never reach back into our page.
   * If the browser blocked the tab, nothing is minted (a credential nobody can
   * use) and the caller keeps its current state instead of claiming success.
   */
  const openInNewTab = useCallback(
    async (purpose: JoinPurpose): Promise<{ ok: true } | { ok: false; message: string }> => {
      const popup = window.open("about:blank", "_blank");
      if (!popup) return { ok: false, message: POPUP_BLOCKED };
      try {
        popup.opener = null;
      } catch {
        /* cross-origin guard; ignore */
      }
      const result = await mint(purpose, "redirect");
      if (result.kind === "url") {
        if (popup.closed) return { ok: false, message: "The new tab was closed before the classroom opened — try again." };
        try {
          popup.location.replace(result.url);
        } catch {
          popup.close();
          return { ok: false, message: POPUP_BLOCKED };
        }
        onJoinInfo(result.info);
        return { ok: true };
      }
      popup.close();
      if (unmountedRef.current) return { ok: false, message: "" };
      if (result.info) onJoinInfo(result.info);
      if (result.phase.kind === "error" && result.phase.retryable) {
        return { ok: false, message: result.phase.message };
      }
      setPhase(result.phase);
      return { ok: false, message: result.phase.kind === "error" ? result.phase.message : "" };
    },
    [mint, onJoinInfo],
  );

  // Decide what to do once we know the device class. Runs once.
  useEffect(() => {
    if (embedCapable === null || startedRef.current) return;
    startedRef.current = true;

    if (roomUnavailable) {
      onJoinInfo({ provider: "fallback", studentPencilUserId: null, recordingOn: null });
      setPhase({ kind: "fallback", url: fallbackUrl, message: "The classroom records could not be read.", retryable: false });
      return;
    }
    if (fallbackForced) {
      onJoinInfo({ provider: "fallback", studentPencilUserId: null, recordingOn: null });
      setPhase({ kind: "fallback", url: fallbackUrl, message: "Pencil Spaces is switched off for maintenance.", retryable: false });
      return;
    }
    if (optOutUnconfirmed) {
      // Nothing is minted automatically; Retry asks the route to re-apply the policy.
      setPhase({ kind: "blocked" });
      return;
    }
    if (mock || embedCapable) {
      void mountRoom();
      return;
    }
    setPhase({ kind: "redirect", opened: null, busy: null, error: null });
  }, [embedCapable, roomUnavailable, fallbackForced, optOutUnconfirmed, mock, fallbackUrl, mountRoom, onJoinInfo]);

  // postMessage from the embed: only our iframe's window, only Pencil origins.
  useEffect(() => {
    if (phase.kind !== "embedded") return;
    const onMessage = (event: MessageEvent) => {
      const frame = iframeRef.current;
      if (!frame || event.source !== frame.contentWindow) return;
      if (!PENCIL_ALLOWED_ORIGINS.includes(event.origin)) return;
      const data = event.data as { type?: unknown; detail?: unknown } | null;
      if (!data || typeof data !== "object" || typeof data.type !== "string") return;
      const detail =
        data.detail && typeof data.detail === "object" ? (data.detail as Record<string, unknown>) : null;
      if (data.type === "ready") {
        setPhase((p) => (p.kind === "embedded" ? { ...p, ready: true, stalled: false, stalledError: null } : p));
      }
      onEmbedEvent({ type: data.type, detail });
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [phase.kind, onEmbedEvent]);

  // 15 s without `ready` → offer the new-tab rescue (Safari ITP, blocked cookies…).
  const waitingForReady = phase.kind === "embedded" && !phase.ready;
  useEffect(() => {
    if (!waitingForReady) return;
    const t = setTimeout(() => {
      setPhase((p) => (p.kind === "embedded" && !p.ready ? { ...p, stalled: true } : p));
    }, READY_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [waitingForReady]);

  // ---------------------------------------------------------------------------

  if (phase.kind === "booting" || phase.kind === "loading") {
    return (
      <Centered>
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          {phase.kind === "loading" ? "Preparing your classroom…" : "Connecting…"}
        </p>
        {phase.kind === "loading" && (
          <p className="text-xs text-muted-foreground/70">The first lesson in a course can take a little longer.</p>
        )}
      </Centered>
    );
  }

  if (phase.kind === "embedded") {
    return (
      <div className="relative h-full w-full bg-slate-950">
        <iframe
          ref={iframeRef}
          src={phase.url}
          title="Pencil Space"
          className="h-full w-full border-0"
          allow={IFRAME_ALLOW}
          referrerPolicy="no-referrer"
        />
        {!phase.ready && !phase.stalled && (
          <div className="pointer-events-none absolute right-3 top-3 flex items-center gap-1.5 rounded-full bg-black/50 px-2.5 py-1 text-[11px] text-white/80">
            <Loader2 className="h-3 w-3 animate-spin" /> Connecting to the Space…
          </div>
        )}
        {phase.stalled && (
          <div className="absolute inset-x-0 bottom-0 flex justify-center p-4">
            <Card className="w-full max-w-md shadow-lg">
              <CardContent className="flex flex-col gap-3 p-4">
                <div className="flex items-start gap-2.5">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning-foreground" />
                  <div className="text-sm">
                    <div className="font-medium">Having trouble loading the classroom?</div>
                    <p className="text-muted-foreground">
                      Some browsers block embedded rooms. Opening it in its own tab usually fixes it.
                    </p>
                    {phase.stalledError && <p className="mt-1 text-destructive">{phase.stalledError}</p>}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    onClick={async () => {
                      const r = await openInNewTab("lesson");
                      if (r.ok) {
                        // The new tab's login signs the iframe out — drop it rather than show a dead frame.
                        setPhase({ kind: "redirect", opened: "lesson", busy: null, error: null });
                      } else if (r.message) {
                        setPhase((p) => (p.kind === "embedded" ? { ...p, stalledError: r.message } : p));
                      }
                    }}
                  >
                    <ExternalLink className="h-4 w-4" /> Open in a new tab
                  </Button>
                  {fallbackUrl && <FallbackLink url={fallbackUrl} size="sm" variant="outline" />}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setPhase((p) => (p.kind === "embedded" ? { ...p, stalled: false } : p))}
                  >
                    Keep waiting
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    );
  }

  if (phase.kind === "mock") {
    const simulatedId = hostView ? phase.studentPencilUserId : phase.teacherPencilUserId ?? "mock-user-teacher";
    return (
      <MockSpacePanel
        selfName={selfName}
        peerName={peerName}
        reason={phase.reason}
        peerJoined={phase.peerJoined}
        onPeerJoin={() => {
          setPhase((p) => (p.kind === "mock" ? { ...p, peerJoined: true } : p));
          // Exactly what the live embed would post for the other participant.
          onEmbedEvent({ type: "participant_join", detail: { id: simulatedId, name: peerName } });
        }}
      />
    );
  }

  if (phase.kind === "redirect") {
    const busy = phase.busy;
    const tap = async (purpose: JoinPurpose) => {
      setPhase((p) => (p.kind === "redirect" ? { ...p, busy: purpose, error: null } : p));
      const r = await openInNewTab(purpose);
      setPhase((p) =>
        p.kind === "redirect"
          ? { ...p, busy: null, opened: r.ok ? purpose : p.opened, error: r.ok ? null : r.message || p.error }
          : p,
      );
    };
    return (
      <Centered>
        <Card className="w-full max-w-md">
          <CardContent className="flex flex-col gap-4 p-6">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <MonitorPlay className="h-5 w-5" />
              </span>
              <div>
                <div className="font-semibold">{phase.opened ? "Lesson open in another tab" : "Join from this device"}</div>
                <p className="text-sm text-muted-foreground">
                  {phase.opened
                    ? "Switch to the Pencil tab to continue. Opening the Space twice on one device breaks the call."
                    : "On tablets and phones the Space opens in its own tab."}
                </p>
              </div>
            </div>

            <div className="grid gap-2">
              <Button size="lg" onClick={() => tap("lesson")} disabled={busy !== null}>
                {busy === "lesson" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Phone className="h-4 w-4" />}
                {phase.opened === "lesson" ? "Open the call again" : "Join the call here"}
              </Button>
              <Button size="lg" variant="outline" onClick={() => tap("board")} disabled={busy !== null}>
                {busy === "board" ? <Loader2 className="h-4 w-4 animate-spin" /> : <PenLine className="h-4 w-4" />}
                {phase.opened === "board" ? "Open the board again" : "Use this device for writing"}
              </Button>
            </div>

            <div className="rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">
              <div className="mb-1 font-medium text-foreground">Using this as a second device for writing?</div>
              <ol className="list-decimal space-y-0.5 pl-4">
                <li>Don&rsquo;t join the call on this device — tap <span className="font-medium">Not Now</span> on the call prompt.</li>
                <li>Keep this device&rsquo;s speaker off, or you&rsquo;ll hear an echo.</li>
                <li>Never open the Space twice on one device.</li>
              </ol>
            </div>

            {phase.error && <p className="text-sm text-destructive">{phase.error}</p>}
            {fallbackUrl && (
              <p className="text-xs text-muted-foreground">
                Pencil not loading? <FallbackLink url={fallbackUrl} variant="link" size="sm" className="h-auto p-0 text-xs" />
              </p>
            )}
          </CardContent>
        </Card>
      </Centered>
    );
  }

  if (phase.kind === "blocked") {
    return (
      <Centered>
        <Card className="w-full max-w-md border-destructive/30">
          <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
              <ShieldAlert className="h-6 w-6" />
            </span>
            <div>
              <div className="font-semibold">Recording policy not applied — contact admin</div>
              <p className="mt-1 text-sm text-muted-foreground">
                This student has opted out of recording, but the Space hasn&rsquo;t confirmed the setting yet.
                Nobody can enter until it does. An admin has been notified.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => void mountRoom()}>
              <RefreshCw className="h-4 w-4" /> Try again
            </Button>
          </CardContent>
        </Card>
      </Centered>
    );
  }

  if (phase.kind === "fallback") {
    return (
      <Centered>
        <Card className="w-full max-w-md">
          <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-warning/15 text-warning-foreground">
              <AlertTriangle className="h-6 w-6" />
            </span>
            <div>
              <div className="font-semibold">
                {phase.url ? "Classroom unavailable — join on Zoom" : "Classroom unavailable"}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{phase.message}</p>
              {!phase.url && (
                <p className="mt-1 text-sm font-medium text-destructive">No backup link — contact admin.</p>
              )}
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              {phase.url && <FallbackLink url={phase.url} />}
              {phase.retryable && (
                <Button variant="outline" onClick={() => void mountRoom()}>
                  <RefreshCw className="h-4 w-4" /> Retry
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">Materials stay available, and the lesson can still be ended from the header.</p>
          </CardContent>
        </Card>
      </Centered>
    );
  }

  // phase.kind === "error"
  return (
    <Centered>
      <Card className="w-full max-w-md">
        <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <AlertTriangle className="h-6 w-6" />
          </span>
          <p className="text-sm">{phase.message}</p>
          {phase.retryable && (
            <Button variant="outline" onClick={() => void mountRoom()}>
              <RefreshCw className="h-4 w-4" /> Retry
            </Button>
          )}
        </CardContent>
      </Card>
    </Centered>
  );
}

// ---------------------------------------------------------------------------

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-4">{children}</div>;
}

/** The Zoom (or admin override) link — a plain https URL, not a credential. */
function FallbackLink({
  url,
  variant = "default",
  size = "default",
  className,
}: {
  url: string;
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
  className?: string;
}) {
  return (
    <Button asChild variant={variant} size={size} className={cn(className)}>
      <a href={url} target="_blank" rel="noopener noreferrer">
        <Video className="h-4 w-4" /> Join on Zoom
      </a>
    </Button>
  );
}
