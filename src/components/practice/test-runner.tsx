"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Camera, CameraOff, ChevronLeft, Clock, Flag, Loader2, Maximize2, Minimize2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AttemptRunner, type AttemptRunnerHandle } from "@/components/practice/attempt-runner";
import { logIntegrityEventAction } from "@/lib/actions/attempts";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useTestIntegrity } from "@/lib/integrity/use-test-integrity";
import { summarize, type IntegritySettings } from "@/lib/integrity/engine";
import { INTEGRITY_EVENT_KIND, formatClock, remainingMs, snapshotPath, type AttemptQuestionRow, type AttemptStatus, type SubmitResult } from "@/lib/practice/attempts";
import { cn } from "@/lib/utils";

// ============================================================================
// A timed test with integrity. The browser cannot lock a device, so the page
// REQUIRES full screen (and the camera, when the family consented), DETECTS
// leaving — tab, window, full screen, paste, devtools, camera — through the
// engine, and makes each one cost something: the timer pauses, it is logged
// with log_integrity_event, and enough of them flag the attempt for review.
// Snapshots go to test-snapshots/<uid>/<attempt>/<ts>.jpg every 60 s under the
// student's own session, each followed by a 'snapshot' event carrying the path.
// ============================================================================

const SNAPSHOT_EVERY_MS = 60_000;
const SNAPSHOT_MAX_BYTES = 60 * 1024;

export interface TestRunnerProps {
  attemptId: string;
  selfId: string;
  title: string;
  courseName: string;
  questions: AttemptQuestionRow[];
  imageUrls: Record<string, string>;
  startedAtISO: string;
  timeLimitMinutes: number | null;
  status: AttemptStatus;
  /** lesson_consents.integrity_camera for this student: the camera is required only when granted. */
  cameraConsented: boolean;
  integrityFlagged: boolean;
  backHref: string;
}

type Phase = "gate" | "running" | "submitted";

export function TestRunner(props: TestRunnerProps) {
  const alreadyDone = props.status !== "in_progress";
  const [phase, setPhase] = useState<Phase>(alreadyDone ? "submitted" : "gate");
  const [gateError, setGateError] = useState<string | null>(null);
  const [entering, setEntering] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [engineStart, setEngineStart] = useState<number>(() => Date.now());
  const [flagged, setFlagged] = useState(props.integrityFlagged);
  const [lastWarning, setLastWarning] = useState<string | null>(null);
  const [logError, setLogError] = useState<string | null>(null);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const runnerRef = useRef<AttemptRunnerHandle>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const autoSubmitted = useRef(false);

  const settings = useMemo<Partial<IntegritySettings>>(() => ({ require_fullscreen: true, require_camera: props.cameraConsented }), [props.cameraConsented]);

  const log = useCallback(
    (kind: string, detail: string | null = null, path: string | null = null) => {
      logIntegrityEventAction(props.attemptId, kind, detail, path).catch((e) => setLogError(e instanceof Error ? e.message : "An integrity event could not be logged."));
    },
    [props.attemptId],
  );

  const integrity = useTestIntegrity({
    active: phase === "running",
    startedAtMs: engineStart,
    settings,
    cameraStream: props.cameraConsented ? stream : null,
    onEvent: (event) => {
      log(INTEGRITY_EVENT_KIND[event.type], event.detail ?? null);
      setLastWarning(warningFor(event.type));
    },
    onPause: () => log("paused"),
    onResume: (pausedMs) => log("resume", `${Math.round(pausedMs / 1000)} s away`),
    onFlag: (summary) => {
      setFlagged(true);
      log("warned", summary.headline);
    },
  });

  // The gate: one click enters full screen and, when consented, turns the camera on.
  const begin = useCallback(async () => {
    setEntering(true);
    setGateError(null);
    try {
      if (props.cameraConsented && !stream) {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser cannot open the camera. Use a current Chrome, Edge, Firefox or Safari.");
        const s = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240 }, audio: false }).catch(() => null);
        if (!s) throw new Error("The camera was refused. Allow camera access for this site and try again — the test needs it on.");
        setStream(s);
      }
      await integrity.requestFullscreen();
      if (!document.fullscreenElement) throw new Error("Full screen could not be entered. Allow it when the browser asks, or use a browser that supports full screen.");
      setEngineStart(Date.now());
      setPhase("running");
    } catch (e) {
      setGateError(e instanceof Error ? e.message : "The test could not start.");
    } finally {
      setEntering(false);
    }
  }, [integrity, props.cameraConsented, stream]);

  // Show the camera preview.
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(() => undefined);
    }
  }, [stream, phase]);

  // Snapshots every 60 s while running with a camera.
  useEffect(() => {
    if (phase !== "running" || !stream) return;
    const id = setInterval(() => {
      void captureAndUpload(videoRef.current, props.selfId, props.attemptId, log, setLogError);
    }, SNAPSHOT_EVERY_MS);
    return () => clearInterval(id);
  }, [phase, stream, props.selfId, props.attemptId, log]);

  // The clock: the limit counts from the row's started_at; every pause is given back.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (phase !== "running") return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [phase]);
  const pausedMs = integrity.state.total_paused_ms + (integrity.state.paused_since_ms !== null ? now - integrity.state.paused_since_ms : 0);
  const remaining = remainingMs({ startedAtISO: props.startedAtISO, timeLimitMinutes: props.timeLimitMinutes, pausedMs, nowMs: now });

  useEffect(() => {
    if (phase !== "running" || remaining == null || remaining > 0 || autoSubmitted.current) return;
    autoSubmitted.current = true;
    void runnerRef.current?.submitNow();
  }, [phase, remaining]);

  const stopCamera = useCallback(() => {
    stream?.getTracks().forEach((t) => t.stop());
    setStream(null);
  }, [stream]);

  const onSubmitted = useCallback(
    (res: SubmitResult) => {
      setResult(res);
      setPhase("submitted");
      stopCamera();
      if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
    },
    [stopCamera],
  );

  const integritySummary = useCallback(() => ({ ...summarize(integrity.state), total_paused_ms: integrity.state.total_paused_ms }), [integrity.state]);

  // --- the gate ---------------------------------------------------------------------------
  if (phase === "gate") {
    return (
      <Shell title={props.title} courseName={props.courseName} backHref={props.backHref}>
        <div className="mx-auto max-w-2xl space-y-5 py-6">
          <div className="rounded-xl border bg-card p-5 shadow-sm">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <ShieldCheck className="h-5 w-5" />
              </span>
              <div>
                <h2 className="text-base font-semibold">Before you begin</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Tests open in the browser so the timer and full-screen rules can be enforced. Here is what this test enforces:
                </p>
              </div>
            </div>
            <ul className="mt-4 space-y-2 text-sm">
              <Rule>
                <strong>Full screen is required.</strong> Leaving it pauses the timer and is recorded.
              </Rule>
              <Rule>
                <strong>Stay on this tab.</strong> Switching tab or window pauses the timer and is recorded.
              </Rule>
              <Rule>
                <strong>No pasting, copying or developer tools.</strong> Each is blocked and recorded.
              </Rule>
              {props.cameraConsented ? (
                <Rule>
                  <strong>Camera on.</strong> Your family agreed to camera checks: a small photo is taken every minute and kept with the attempt for your teacher.
                </Rule>
              ) : (
                <Rule muted>No camera: your family has not turned on camera checks, so none are taken.</Rule>
              )}
              <Rule>
                <strong>{props.timeLimitMinutes != null ? `${props.timeLimitMinutes} minutes.` : "No time limit."}</strong>{" "}
                {props.timeLimitMinutes != null ? "The clock started when the attempt was opened; it stops while you are away." : "Take the time you need."}
              </Rule>
              <Rule>Too many events flag the attempt, and your teacher reviews it before the mark counts.</Rule>
            </ul>
          </div>
          {gateError && (
            <p className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {gateError}
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button asChild variant="ghost">
              <Link href={props.backHref}>
                <ChevronLeft className="h-4 w-4" /> Not now
              </Link>
            </Button>
            <Button size="lg" onClick={() => void begin()} disabled={entering}>
              {entering ? <Loader2 className="h-4 w-4 animate-spin" /> : <Maximize2 className="h-4 w-4" />}
              {props.cameraConsented ? "Turn on the camera, go full screen and begin" : "Go full screen and begin"}
            </Button>
          </div>
        </div>
      </Shell>
    );
  }

  // --- running / submitted -------------------------------------------------------------------
  const paused = phase === "running" && integrity.paused;

  return (
    <Shell
      title={props.title}
      courseName={props.courseName}
      backHref={props.backHref}
      right={
        phase === "running" ? (
          <div className="flex items-center gap-2 sm:gap-3">
            {flagged && (
              <Badge variant="destructive">
                <Flag className="h-3 w-3" /> Flagged for review
              </Badge>
            )}
            <Badge variant={integrity.isFullscreen ? "success" : "warning"}>
              {integrity.isFullscreen ? <Maximize2 className="h-3 w-3" /> : <Minimize2 className="h-3 w-3" />}
              {integrity.isFullscreen ? "Full screen" : "Not full screen"}
            </Badge>
            {props.cameraConsented && (
              <Badge variant={stream ? "success" : "destructive"}>
                {stream ? <Camera className="h-3 w-3" /> : <CameraOff className="h-3 w-3" />}
                {stream ? "Camera on" : "Camera off"}
              </Badge>
            )}
            <span className="hidden text-xs text-muted-foreground sm:inline">{integrity.summary.event_count} event{integrity.summary.event_count === 1 ? "" : "s"}</span>
            {remaining != null && (
              <span className={cn("inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-sm font-semibold tabular-nums", remaining < 2 * 60_000 ? "border-destructive/40 text-destructive" : "")} aria-live="polite" title="Time left">
                <Clock className="h-4 w-4" /> {formatClock(remaining)}
              </span>
            )}
          </div>
        ) : phase === "submitted" ? (
          <Badge variant="secondary">Submitted</Badge>
        ) : null
      }
    >
      <div className="relative mx-auto max-w-3xl py-6">
        {lastWarning && phase === "running" && (
          <div className="mb-4 flex items-start gap-2 rounded-md border border-warning/50 bg-warning/10 px-3 py-2 text-sm text-warning-foreground" role="status">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="flex-1">{lastWarning} This was recorded on your attempt.</span>
            <button type="button" onClick={() => setLastWarning(null)} className="text-xs underline">
              Dismiss
            </button>
          </div>
        )}
        {logError && (
          <p className="mb-4 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
            {logError}
          </p>
        )}
        {phase === "submitted" && result && (
          <div className="mb-4 rounded-md border bg-secondary/50 px-3 py-2 text-sm">
            {flagged ? "This attempt was flagged for review; your teacher will look at it before the mark counts." : "Your teacher can see the result now."}{" "}
            <Link href={props.backHref} className="font-medium text-primary underline-offset-4 hover:underline">
              Back to your practice
            </Link>
          </div>
        )}

        <AttemptRunner
          ref={runnerRef}
          attemptId={props.attemptId}
          kind="test"
          initialQuestions={props.questions}
          imageUrls={props.imageUrls}
          initialStatus={props.status}
          integritySummary={integritySummary}
          locked={paused}
          onSubmitted={onSubmitted}
        />

        {props.cameraConsented && stream && phase === "running" && (
          <video ref={videoRef} muted playsInline className="fixed bottom-4 right-4 h-24 w-32 rounded-md border bg-black object-cover shadow" aria-label="Your camera" />
        )}

        {paused && (
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-background/90 backdrop-blur-sm">
            <div className="mx-4 max-w-md rounded-xl border bg-card p-6 text-center shadow-lg">
              <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-warning/15 text-warning-foreground">
                <AlertTriangle className="h-6 w-6" />
              </span>
              <h2 className="mt-3 text-lg font-semibold">The timer is paused</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                You left the test. Come back to full screen to carry on; the time away does not count against you, but it is recorded.
              </p>
              <Button
                className="mt-4"
                onClick={async () => {
                  await integrity.requestFullscreen();
                  integrity.resume();
                }}
              >
                <Maximize2 className="h-4 w-4" /> Back to the test
              </Button>
            </div>
          </div>
        )}
      </div>
    </Shell>
  );
}

function Shell({ title, courseName, backHref, right, children }: { title: string; courseName: string; backHref: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-card px-3 md:px-4">
        <Button asChild variant="ghost" size="sm">
          <Link href={backHref}>
            <ChevronLeft className="h-4 w-4" /> Leave
          </Link>
        </Button>
        <div className="hidden h-6 w-px bg-border sm:block" />
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{title}</div>
          <div className="truncate text-xs text-muted-foreground">{courseName} · timed test</div>
        </div>
        <div className="ml-auto">{right}</div>
      </header>
      <main className="flex-1 px-4 md:px-6">{children}</main>
    </div>
  );
}

function Rule({ children, muted }: { children: React.ReactNode; muted?: boolean }) {
  return (
    <li className={cn("flex items-start gap-2", muted && "text-muted-foreground")}>
      <span className={cn("mt-2 h-1.5 w-1.5 shrink-0 rounded-full", muted ? "bg-muted-foreground/40" : "bg-primary")} />
      <span>{children}</span>
    </li>
  );
}

function warningFor(type: keyof typeof INTEGRITY_EVENT_KIND): string {
  switch (type) {
    case "visibility_hidden":
      return "You left the test tab.";
    case "window_blur":
      return "You switched to another window.";
    case "fullscreen_exit":
      return "You left full screen.";
    case "paste":
      return "Pasting is not allowed in a test.";
    case "copy":
      return "Copying is not allowed in a test.";
    case "context_menu":
      return "The right-click menu is off during a test.";
    case "devtools_shortcut":
      return "Developer tools are not allowed in a test.";
    case "camera_off":
      return "The camera went off.";
    case "camera_denied":
      return "The camera is not available.";
    case "offline":
      return "The connection dropped.";
    case "resize":
      return "The window was resized.";
  }
}

/** A JPEG of the camera frame at most 60 KB, uploaded under the student's session, then logged. */
async function captureAndUpload(video: HTMLVideoElement | null, uid: string, attemptId: string, log: (kind: string, detail: string | null, path: string | null) => void, onError: (m: string) => void): Promise<void> {
  if (!video || video.readyState < 2) return;
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 240;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  let blob: Blob | null = null;
  for (const quality of [0.7, 0.55, 0.4, 0.3, 0.2]) {
    blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (blob && blob.size <= SNAPSHOT_MAX_BYTES) break;
  }
  if (!blob) return;
  const supabase = createSupabaseBrowserClient();
  if (!supabase) {
    log("snapshot", "demo mode: the frame was not uploaded", null);
    return;
  }
  const path = snapshotPath(uid, attemptId, Date.now());
  const { error } = await supabase.storage.from("test-snapshots").upload(path, blob, { contentType: "image/jpeg", upsert: false });
  if (error) {
    onError(`A camera snapshot could not be uploaded: ${error.message}`);
    return;
  }
  log("snapshot", null, path);
}
