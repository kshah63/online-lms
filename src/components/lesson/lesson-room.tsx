"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  ChevronLeft,
  Clock,
  CircleOff,
  Disc,
  FolderOpen,
  Loader2,
  MonitorPlay,
  RefreshCw,
  SquareCheckBig,
  UserX,
  X,
} from "lucide-react";
import { MaterialsPanel } from "@/components/lesson/materials-panel";
import { SpaceStage, type EmbedEvent, type JoinInfo, type SpaceProvider } from "@/components/lesson/space-stage";
import { ProviderBadge } from "@/components/lesson/video-panel";
import { StatusBadge } from "@/components/status-badge";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { endLesson, startSessionClock, type LessonOutcome } from "@/lib/actions/sessions";
import type { LessonStatusResponse } from "@/app/api/lesson/[sessionId]/status/route";
import { isDemoMode } from "@/lib/env";
import type { SessionStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

/** How often an open room checks whether the lesson was ended from another room. */
const STATUS_POLL_MS = 15_000;

// ============================================================================
// The lesson room: header (Leave · course · status · peer · clock · recording ·
// provider · End), the Pencil Space in the centre, Materials on the right
// (tabs on small screens). Everything that writes to our DB happens through
// server actions; the Space itself is driven by <SpaceStage>.
// ============================================================================

type Tab = "space" | "materials";

export type LessonViewerKind = "teacher" | "admin" | "student";

export interface LessonRoomProps {
  sessionId: string;
  courseName: string;
  materialsCourseId: string | null;
  status: SessionStatus;
  backHref: string;
  viewerKind: LessonViewerKind;
  /** canEndLesson(profile, session): assigned teacher or admin. */
  canEnd: boolean;
  selfName: string;
  peerName: string;
  peerAvatarUrl: string | null;
  /** Pencil id of the student (mock-user-… in demo); gates the lesson clock. */
  studentPencilUserId: string | null;
  /**
   * Lessons are being recorded for this student: institution recording is on
   * (PENCIL_RECORDING_ENABLED, Phase 2) AND the student is not opted out.
   * False all through Phase 1 — the live `recording_status_change` event is
   * then the only thing that can show "Recording on" (a host-started recording).
   */
  recordingOn: boolean;
  /** The family opted out of recording (recording_opt_outs). */
  optedOut: boolean;
  /** Opted out but the Space hasn't confirmed recording_disabled → hard stop. */
  optOutUnconfirmed: boolean;
  /** The page could not read the room rows (service role / query error). */
  roomUnavailable: boolean;
  /** Pencil is mocked (demo or no key). */
  mock: boolean;
  fallbackUrl: string | null;
  fallbackForced: boolean;
  actualStartISO: string | null;
  actualEndISO: string | null;
}

export function LessonRoom({
  sessionId,
  courseName,
  materialsCourseId,
  status,
  backHref,
  viewerKind,
  canEnd,
  selfName,
  peerName,
  peerAvatarUrl,
  studentPencilUserId,
  recordingOn,
  optedOut,
  optOutUnconfirmed,
  roomUnavailable,
  mock,
  fallbackUrl,
  fallbackForced,
  actualStartISO,
  actualEndISO,
}: LessonRoomProps) {
  const hostView = viewerKind !== "student";
  const [tab, setTab] = useState<Tab>("space");

  // Over = ended before we got here, or ended from this header.
  const initialOutcome: EndedOutcome | null =
    status === "completed" || status === "no_show" || status === "cancelled" ? status : null;
  const [endedOutcome, setEndedOutcome] = useState<EndedOutcome | null>(initialOutcome);

  // The lesson clock runs from actual_start (both present), not booking time.
  const [startedAtMs, setStartedAtMs] = useState<number | null>(actualStartISO ? Date.parse(actualStartISO) : null);
  const [endedAtMs, setEndedAtMs] = useState<number | null>(actualEndISO ? Date.parse(actualEndISO) : null);
  const startedRef = useRef<boolean>(Boolean(actualStartISO));

  const [studentPresent, setStudentPresent] = useState(false);
  const [inCall, setInCall] = useState(false);
  const [callEnded, setCallEnded] = useState(false);
  /** Live recording state from `recording_status_change`; null until Pencil tells us. */
  const [recordingLive, setRecordingLive] = useState<boolean | null>(null);
  const [provider, setProvider] = useState<SpaceProvider>(fallbackForced ? "fallback" : mock ? "mock" : "pencil");
  const [usedFallback, setUsedFallback] = useState(fallbackForced);
  const studentIdRef = useRef<string | null>(studentPencilUserId);
  const [secondTab, setSecondTab] = useState(false);

  const markStudentPresent = useCallback(() => {
    setStudentPresent(true);
    if (startedRef.current) return;
    startedRef.current = true;
    if (!hostView) {
      // Students never write the clock; show it locally from the moment both are in.
      setStartedAtMs((v) => v ?? Date.now());
      return;
    }
    startSessionClock(sessionId)
      .then((r) => setStartedAtMs(Date.parse(r.actual_start)))
      .catch(() => setStartedAtMs(Date.now()));
  }, [hostView, sessionId]);

  /**
   * Embed events (already source- and origin-checked by <SpaceStage>). The clock
   * starts on the first event proving the STUDENT is present: `participant_join`
   * with the student's Pencil id, or `participantupdate.count >= 2`. The
   * teacher's own `user_joined_call` only drives the "waiting for student" badge.
   */
  const handleEmbedEvent = useCallback(
    (evt: EmbedEvent) => {
      const detail = evt.detail;
      switch (evt.type) {
        case "participant_join": {
          const id = typeof detail?.id === "string" ? detail.id : null;
          if (hostView) {
            if (id !== null && studentIdRef.current !== null && id === studentIdRef.current) markStudentPresent();
          } else {
            markStudentPresent(); // someone else joined the student's room → both present
          }
          break;
        }
        case "participantupdate": {
          const raw = detail?.count;
          const count = typeof raw === "number" ? raw : Number(raw);
          if (Number.isFinite(count) && count >= 2) markStudentPresent();
          break;
        }
        case "user_started_call":
        case "user_joined_call":
          setInCall(true);
          setCallEnded(false);
          break;
        case "user_left_call":
        case "user_ended_call":
        case "call_ended":
          setInCall(false);
          setCallEnded(true);
          break;
        case "recording_status_change": {
          const on = recordingStatusOn(detail);
          if (on !== null) setRecordingLive(on);
          break;
        }
        default:
          break;
      }
    },
    [hostView, markStudentPresent],
  );

  const handleJoinInfo = useCallback((info: JoinInfo) => {
    if (info.studentPencilUserId) studentIdRef.current = info.studentPencilUserId;
    setProvider(info.provider);
    // "Ran on the backup link" is about where the lesson ended up: a Retry that
    // gets into the Space (after a rate-limit or a Pencil hiccup) clears it, so
    // End still ends the Pencil session and the lesson isn't marked unrecorded.
    if (info.provider === "fallback") setUsedFallback(true);
    else if (info.provider === "pencil") setUsedFallback(false);
  }, []);

  // A second lesson tab in the same browser: an authorize login logs out whoever
  // is in Pencil in that browser (back-to-back lessons, siblings on one device).
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const tabId = Math.random().toString(36).slice(2);
    const channel = new BroadcastChannel("lesson-room");
    const onMessage = (e: MessageEvent) => {
      const m = e.data as { type?: string; tabId?: string } | null;
      if (!m || typeof m !== "object" || m.tabId === tabId) return;
      if (m.type === "hello") {
        channel.postMessage({ type: "present", tabId });
        setSecondTab(true);
      } else if (m.type === "present") {
        setSecondTab(true);
      }
    };
    channel.addEventListener("message", onMessage);
    channel.postMessage({ type: "hello", tabId });
    return () => {
      channel.removeEventListener("message", onMessage);
      channel.close();
    };
  }, []);

  const handleEnded = useCallback((outcome: LessonOutcome, actualEnd: string | null) => {
    setEndedOutcome(outcome);
    setEndedAtMs(actualEnd ? Date.parse(actualEnd) : Date.now());
  }, []);

  const over = endedOutcome !== null;

  // Close this room when the lesson is ended from another one (the teacher's
  // End, an admin's). Pencil keeps the call — and, once always-on recording is
  // on, its recording — running for whoever is still in the Space, and End
  // does not touch Pencil (endOngoingSession ends only the analytics session;
  // Pencil support, 2026-10-16). Unmounting the Space is what makes this
  // viewer leave; Pencil closes the session six minutes after the last one.
  useEffect(() => {
    if (over || isDemoMode) return;
    let inFlight = false;
    const id = window.setInterval(async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const res = await fetch(`/api/lesson/${sessionId}/status`, { cache: "no-store" });
        if (!res.ok) return;
        const s = (await res.json()) as LessonStatusResponse;
        if (s.status === "completed" || s.status === "no_show" || s.status === "cancelled") {
          setEndedOutcome(s.status);
          setEndedAtMs(s.actual_end ? Date.parse(s.actual_end) : Date.now());
        }
      } catch {
        // Offline for a moment — the next tick tries again.
      } finally {
        inFlight = false;
      }
    }, STATUS_POLL_MS);
    return () => window.clearInterval(id);
  }, [over, sessionId]);

  const liveStatus: SessionStatus = endedOutcome ?? (startedAtMs ? "in_progress" : status);
  const recordingShown = recordingLive ?? recordingOn;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      {/* Header */}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-card px-3 md:px-4">
        <Button asChild variant="ghost" size="sm">
          <Link href={backHref}>
            <ChevronLeft className="h-4 w-4" /> Leave
          </Link>
        </Button>
        <div className="hidden h-6 w-px bg-border sm:block" />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold">{courseName}</span>
            <StatusBadge status={liveStatus} />
            {!over && hostView && inCall && !studentPresent && !startedAtMs && (
              <Badge variant="warning" className="hidden text-[10px] md:inline-flex">
                Waiting for student
              </Badge>
            )}
            {!over && callEnded && (
              <Badge variant="secondary" className="hidden text-[10px] md:inline-flex">
                Call ended
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Avatar name={peerName} src={peerAvatarUrl} size={16} />
            <span className="truncate">with {peerName}</span>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <Elapsed startedAtMs={startedAtMs} endedAtMs={endedAtMs} className="hidden sm:inline-flex" />
          <RecordingChip on={recordingShown} expected={recordingOn} optedOut={optedOut} />
          <span className="hidden md:inline-flex">
            <ProviderBadge provider={provider} />
          </span>
          {canEnd && !over && (
            <EndLessonButton
              sessionId={sessionId}
              studentSeen={studentPresent || startedAtMs !== null}
              usedFallback={usedFallback}
              onEnded={handleEnded}
            />
          )}
        </div>
      </header>

      {/* Notices */}
      {!hostView && recordingShown && !over && (
        <div className="flex shrink-0 items-center gap-2 border-b bg-primary/5 px-4 py-1.5 text-xs text-muted-foreground">
          <Disc className="h-3.5 w-3.5 text-destructive" />
          This lesson is recorded (audio + board).
        </div>
      )}
      {hostView && optedOut && recordingLive === true && !over && (
        <div className="flex shrink-0 items-center gap-2 bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Recording is ON but this student is opted out — stop the recording in the Space now.
        </div>
      )}
      {secondTab && (
        <div className="flex shrink-0 items-start gap-2 border-b bg-warning/15 px-4 py-2 text-xs text-warning-foreground">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="flex-1">
            Another lesson tab is open in this browser. Opening a Space in two tabs signs the other one out — close
            the one you&rsquo;re not using before joining.
          </span>
          <button type="button" onClick={() => setSecondTab(false)} aria-label="Dismiss" className="hover:opacity-70">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Small screens: tabs */}
        <div className="flex shrink-0 border-b lg:hidden">
          <TabButton active={tab === "space"} onClick={() => setTab("space")} icon={<MonitorPlay className="h-4 w-4" />} label="Space" />
          <TabButton active={tab === "materials"} onClick={() => setTab("materials")} icon={<FolderOpen className="h-4 w-4" />} label="Materials" />
        </div>

        {/* Centre: the Space (or the ended card) */}
        <main className={cn("relative min-h-0 flex-1 bg-muted/30", tab === "space" ? "flex" : "hidden lg:flex")}>
          <div className="h-full w-full">
            {over ? (
              <LessonEndedCard outcome={endedOutcome} hostView={hostView} backHref={backHref} />
            ) : (
              <SpaceStage
                sessionId={sessionId}
                hostView={hostView}
                selfName={selfName}
                peerName={peerName}
                mock={mock}
                fallbackForced={fallbackForced}
                fallbackUrl={fallbackUrl}
                optOutUnconfirmed={optOutUnconfirmed}
                roomUnavailable={roomUnavailable}
                onEmbedEvent={handleEmbedEvent}
                onJoinInfo={handleJoinInfo}
              />
            )}
          </div>
        </main>

        {/* Right rail: Materials */}
        <aside
          className={cn(
            "min-h-0 flex-col border-t bg-card lg:w-80 lg:flex-none lg:border-l lg:border-t-0 xl:w-96",
            tab === "materials" ? "flex flex-1" : "hidden lg:flex",
          )}
        >
          <MaterialsPanel materialsCourseId={materialsCourseId} />
        </aside>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Parent view — a status card, no Space (parents have no Pencil user).
// ---------------------------------------------------------------------------

export function ParentStatusCard({
  courseName,
  studentName,
  teacherName,
  status,
  actualStartISO,
  actualEndISO,
  recordingOn,
  optedOut,
  backHref,
}: {
  courseName: string;
  studentName: string;
  teacherName: string;
  status: SessionStatus;
  actualStartISO: string | null;
  actualEndISO: string | null;
  /** Institution recording is on and the child is not opted out. */
  recordingOn: boolean;
  optedOut: boolean;
  backHref: string;
}) {
  const router = useRouter();
  const startedAtMs = actualStartISO ? Date.parse(actualStartISO) : null;
  const endedAtMs = actualEndISO ? Date.parse(actualEndISO) : null;

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-card px-3 md:px-4">
        <Button asChild variant="ghost" size="sm">
          <Link href={backHref}>
            <ChevronLeft className="h-4 w-4" /> Leave
          </Link>
        </Button>
        <div className="hidden h-6 w-px bg-border sm:block" />
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-semibold">{courseName}</span>
          <StatusBadge status={status} />
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center p-6">
        <Card className="w-full max-w-md">
          <CardContent className="space-y-5 p-6">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Lesson status</div>
              <h1 className="mt-1 text-lg font-semibold">{courseName}</h1>
              <p className="text-sm text-muted-foreground">
                {studentName} with {teacherName}
              </p>
            </div>

            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-3 text-sm">
              <dt className="text-muted-foreground">Teacher</dt>
              <dd className="flex items-center gap-2">
                <Avatar name={teacherName} size={20} /> {teacherName}
              </dd>
              <dt className="text-muted-foreground">Status</dt>
              <dd>
                <StatusBadge status={status} />
              </dd>
              <dt className="text-muted-foreground">Time in lesson</dt>
              <dd>
                <Elapsed startedAtMs={startedAtMs} endedAtMs={endedAtMs} className="text-foreground" />
              </dd>
              <dt className="text-muted-foreground">Recording</dt>
              <dd>
                <RecordingChip on={recordingOn} expected={recordingOn} optedOut={optedOut} />
              </dd>
            </dl>

            <p className="text-xs text-muted-foreground">
              Parents follow the lesson from here — the classroom itself is for the teacher and the student. The
              report arrives after the lesson.
            </p>

            <Button variant="outline" size="sm" onClick={() => router.refresh()}>
              <RefreshCw className="h-4 w-4" /> Refresh
            </Button>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

type EndedOutcome = LessonOutcome | "cancelled";

/** Live elapsed time since both joined (or final duration once ended). */
export function Elapsed({
  startedAtMs,
  endedAtMs,
  className,
}: {
  startedAtMs: number | null;
  endedAtMs: number | null;
  className?: string;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (endedAtMs || !startedAtMs) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [endedAtMs, startedAtMs]);

  const base = "inline-flex items-center gap-1.5 text-sm text-muted-foreground";
  if (!startedAtMs) {
    return (
      <span className={cn(base, className)}>
        <Clock className="h-4 w-4" /> {endedAtMs ? "—" : "Waiting to start"}
      </span>
    );
  }
  const elapsed = Math.max(0, Math.floor(((endedAtMs ?? now) - startedAtMs) / 1000));
  const h = Math.floor(elapsed / 3600);
  const m = Math.floor((elapsed % 3600) / 60);
  const s = elapsed % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  const label = h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  return (
    <span className={cn(base, className)}>
      <Clock className="h-4 w-4" />
      <span className="tabular-nums">{label}</span>
    </span>
  );
}

/**
 * The header's recording chip. `on` = what is happening (the live
 * `recording_status_change` state when Pencil has reported one, else
 * `expected`); `expected` = recording is switched on for this student;
 * `optedOut` = the family opted out. Recording while opted out reads as a
 * warning; "expected but stopped" as a caution; otherwise "Not recorded".
 */
function RecordingChip({ on, expected, optedOut }: { on: boolean; expected: boolean; optedOut: boolean }) {
  if (on) {
    return (
      <Badge variant={optedOut ? "destructive" : "outline"} className="gap-1.5 text-[10px]">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-destructive" />
        </span>
        <span className="hidden sm:inline">Recording on (audio + board)</span>
        <span className="sm:hidden">REC</span>
      </Badge>
    );
  }
  const label = optedOut ? "Not recorded (opted out)" : expected ? "Recording off" : "Not recorded";
  const short = optedOut || !expected ? "Not rec." : "Off";
  return (
    <Badge variant={expected ? "warning" : "secondary"} className="gap-1 text-[10px]">
      <CircleOff className="h-3 w-3" />
      <span className="hidden sm:inline">{label}</span>
      <span className="sm:hidden">{short}</span>
    </Badge>
  );
}

/** `recording_status_change{status}` — Pencil's exact vocabulary isn't documented; accept the obvious forms. */
function recordingStatusOn(detail: Record<string, unknown> | null): boolean | null {
  const raw = detail?.status ?? detail?.recording ?? detail?.enabled;
  if (typeof raw === "boolean") return raw;
  if (typeof raw !== "string") return null;
  const v = raw.trim().toLowerCase();
  if (["recording", "started", "start", "on", "active", "true", "resumed"].includes(v)) return true;
  if (["stopped", "stop", "off", "inactive", "false", "idle", "paused", "ended"].includes(v)) return false;
  return null;
}

function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-1 items-center justify-center gap-1.5 py-2.5 text-sm font-medium transition-colors",
        active ? "border-b-2 border-primary text-primary" : "text-muted-foreground",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function LessonEndedCard({ outcome, hostView, backHref }: { outcome: EndedOutcome | null; hostView: boolean; backHref: string }) {
  const cancelled = outcome === "cancelled";
  const noShow = outcome === "no_show";
  return (
    <div className="flex h-full w-full items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
          <span
            className={cn(
              "flex h-12 w-12 items-center justify-center rounded-full",
              cancelled ? "bg-destructive/10 text-destructive" : noShow ? "bg-warning/15 text-warning-foreground" : "bg-success/12 text-success",
            )}
          >
            {cancelled ? <Ban className="h-6 w-6" /> : noShow ? <UserX className="h-6 w-6" /> : <CheckCircle2 className="h-6 w-6" />}
          </span>
          <div>
            <h2 className="text-lg font-semibold">
              {cancelled ? "This lesson was cancelled." : noShow ? "Marked as no-show." : "Lesson ended."}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {cancelled
                ? "The classroom is closed for this lesson."
                : noShow
                  ? "The student never joined. The classroom is closed and no lesson was recorded."
                  : hostView
                    ? "The classroom is closed for this lesson. Materials stay available on the side."
                    : "The classroom is closed for this lesson. Your report will arrive once the teacher publishes it."}
            </p>
            {!cancelled && (
              <p className="mt-2 text-xs text-muted-foreground">
                If the Space is still open in another tab, close that tab to leave the call.
              </p>
            )}
          </div>
          <Button asChild variant="outline">
            <Link href={backHref}>
              <ChevronLeft className="h-4 w-4" /> Back to dashboard
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * End lesson → endLesson(id, 'completed' | 'no_show'). "Mark as no-show" leads
 * when the student was never seen; both are always available (the student may
 * have joined from a device we got no embed event for).
 */
function EndLessonButton({
  sessionId,
  studentSeen,
  usedFallback,
  onEnded,
}: {
  sessionId: string;
  studentSeen: boolean;
  usedFallback: boolean;
  onEnded: (outcome: LessonOutcome, actualEnd: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<LessonOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(outcome: LessonOutcome) {
    setPending(outcome);
    setError(null);
    try {
      const res = await endLesson(sessionId, outcome, { usedFallback });
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setOpen(false);
      onEnded(outcome, res.actual_end ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not end the lesson.");
    } finally {
      setPending(null);
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)} size="sm" variant="default">
        <SquareCheckBig className="h-4 w-4" />
        <span className="hidden sm:inline">End lesson</span>
        <span className="sm:hidden">End</span>
      </Button>

      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{studentSeen ? "End this lesson?" : "The student hasn't joined"}</DialogTitle>
            <DialogDescription>
              {studentSeen
                ? "This marks the lesson completed and closes the classroom: for you now, and for the student within a few seconds."
                : "Mark it as a no-show (nothing is counted as taught), or end it normally if the student was present on another device."}
            </DialogDescription>
          </DialogHeader>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant={studentSeen ? "outline" : "default"} onClick={() => run("no_show")} disabled={pending !== null}>
              {pending === "no_show" ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserX className="h-4 w-4" />}
              Mark as no-show
            </Button>
            <Button variant={studentSeen ? "default" : "outline"} onClick={() => run("completed")} disabled={pending !== null}>
              {pending === "completed" ? <Loader2 className="h-4 w-4 animate-spin" /> : <SquareCheckBig className="h-4 w-4" />}
              End lesson
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
