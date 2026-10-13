"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  BellOff,
  ChevronLeft,
  Eye,
  ListChecks,
  Clock,
  Loader2,
  NotebookPen,
  Sparkles,
  SquareCheckBig,
  Video,
  X,
} from "lucide-react";
import { VideoStage } from "@/components/lesson/video-stage";
import { ActivityPanel, type ActivitySet } from "@/components/lesson/activity-panel";
import { useLessonActivity } from "@/lib/practice/activity-channel";
import { MaterialsPanel } from "@/components/lesson/materials-panel";
import { ProviderBadge } from "@/components/lesson/video-panel";
import { StatusBadge } from "@/components/status-badge";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScoreBars } from "@/components/coaching/score-bars";
import { useLiveCoach } from "@/lib/coaching/use-live-coach";
import { DEMO_LESSON_TRANSCRIPT } from "@/lib/coaching/demo-transcript";
import { finalizeLesson } from "@/lib/actions/coaching";
import { endLesson, hostArrived, joinLesson } from "@/lib/actions/lesson";
import type { TeacherFeedback } from "@/lib/coaching/analyze";
import type { RoomConsents, Seat, SessionStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

// tldraw is browser-only.
const NotebookPanel = dynamic(
  () => import("@/components/lesson/notebook-panel").then((m) => m.NotebookPanel),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading notebook…
      </div>
    ),
  },
);

type Tab = "notebook" | "video" | "materials" | "activity";

export interface LessonRoomProps {
  sessionId: string;
  /** The viewer's seat, as rpc lesson_room_state decided it. */
  seat: Seat;
  /** The realtime channel key for the notebook (the lesson_notebooks id, or a session key). */
  notebookId: string;
  /** The lesson_notebooks row to persist to; null when the lesson has none yet. */
  saveId: string | null;
  courseName: string;
  topic: string | null;
  status: SessionStatus;
  backHref: string;
  selfId: string;
  selfName: string;
  studentName: string;
  teacherName: string | null;
  /** The booked slot, UTC ISO. */
  startISO: string;
  endISO: string;
  /** session_requests.arrived_at — set by rpc lesson_join when the learner first joined. */
  arrivedAtISO: string | null;
  /** session_requests.departed_at / lesson_rooms.closed_at — set by rpc lesson_end. */
  endedAtISO: string | null;
  consents: RoomConsents;
  initialSnapshot: unknown | null;
  demoCoaching: boolean;
  /** Practice sets the host can push into the room. */
  activitySets: ActivitySet[];
}

export function LessonRoom({
  sessionId,
  seat,
  notebookId,
  saveId,
  courseName,
  topic,
  status,
  backHref,
  selfId,
  selfName,
  studentName,
  teacherName,
  arrivedAtISO,
  endedAtISO,
  consents,
  initialSnapshot,
  demoCoaching,
  activitySets,
}: LessonRoomProps) {
  const isHost = seat === "host";
  const isLearner = seat === "learner";
  const isObserver = seat === "observer";

  // Who the viewer is in the room with.
  const peerName = isHost
    ? studentName
    : isLearner
      ? (teacherName ?? "Teacher (not yet added)")
      : `${teacherName ?? "Teacher"} and ${studentName}`;

  const [tab, setTab] = useState<Tab>("notebook");

  // The live coach is the host's, and only with the family's consent to AI
  // analysis. Observers never see it.
  const coachOn = isHost && consents.ai_analysis;
  const coach = useLiveCoach(sessionId, coachOn);

  // In-lesson activities: the host pushes a quick check; the learner answers
  // in the side panel, which opens itself when something arrives.
  const [activityOpen, setActivityOpen] = useState(false);
  const handleActivityArrived = useCallback(() => {
    setActivityOpen(true);
    setTab("activity");
  }, []);
  const activity = useLessonActivity({
    sessionId,
    selfId,
    role: isHost ? "teacher" : "student",
    onActivity: handleActivityArrived,
  });
  const activityPanel = (
    <ActivityPanel
      isTeacher={isHost}
      sets={activitySets}
      activity={activity.activity}
      submission={activity.submission}
      released={activity.released}
      onPush={activity.push}
      onSubmit={activity.submit}
      onRespond={activity.respond}
      onRelease={activity.release}
      onClose={activity.close}
      onDismiss={() => {
        setActivityOpen(false);
        if (tab === "activity") setTab("notebook");
      }}
      peerName={peerName}
    />
  );

  // The lesson clock runs from the learner's arrival (arrived_at), not booking time.
  const [startedAtMs, setStartedAtMs] = useState<number | null>(arrivedAtISO ? Date.parse(arrivedAtISO) : null);
  const [endedAtMs, setEndedAtMs] = useState<number | null>(endedAtISO ? Date.parse(endedAtISO) : null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const joinedRef = useRef<boolean>(Boolean(arrivedAtISO));

  // The learner's first successful join is the attendance write: rpc lesson_join
  // sets arrived_at on the booking (the one place the room decides attendance).
  // The host's first join is its own fact (rpc lesson_host_join), so a student
  // waiting alone can be told apart from a lesson under way.
  const handleJoined = useCallback(() => {
    if (joinedRef.current) return;
    if (isLearner) {
      joinedRef.current = true;
      joinLesson(sessionId)
        .then((r) => setStartedAtMs(Date.parse(r.arrived_at)))
        .catch((e) => {
          joinedRef.current = false;
          setJoinError(e instanceof Error ? e.message : "Your arrival could not be recorded.");
        });
      return;
    }
    if (isHost) {
      joinedRef.current = true;
      hostArrived(sessionId).catch((e) => {
        joinedRef.current = false;
        setJoinError(e instanceof Error ? e.message : "Your arrival could not be recorded.");
      });
    }
  }, [isLearner, isHost, sessionId]);

  // The host (and an observer) see the clock start when the learner is in the room.
  const handlePeerPresent = useCallback(() => {
    if (isLearner) return;
    setStartedAtMs((cur) => cur ?? Date.now());
  }, [isLearner]);

  // Periodic AI live-coaching pass: every ~2.5 min, send the recent
  // transcript to Claude for a subtler nudge than the threshold rules.
  useEffect(() => {
    if (!coachOn) return;
    const id = setInterval(async () => {
      const segs = coach.getSegments();
      if (segs.length < 4) return;
      try {
        const res = await fetch("/api/coach/live", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ segments: segs.slice(-24) }),
        });
        const data = await res.json();
        if (data?.nudge) coach.pushExternalNudge(data.nudge);
      } catch {
        /* ignore — rule-based nudges still run */
      }
    }, 150_000);
    return () => clearInterval(id);
  }, [coachOn, coach]);

  // Time-based cues (silence, praise drought) need a tick, not just segments.
  // Real-time only — demo uses the scripted transcript on its own clock.
  useEffect(() => {
    if (!coachOn || demoCoaching) return;
    const id = setInterval(() => coach.tick(), 15_000);
    return () => clearInterval(id);
  }, [coachOn, demoCoaching, coach]);

  // Demo: drive the live coach from a scripted transcript (no live audio).
  useEffect(() => {
    if (!demoCoaching || !coachOn) return;
    let i = 0;
    const id = setInterval(() => {
      if (i >= DEMO_LESSON_TRANSCRIPT.length) {
        clearInterval(id);
        return;
      }
      coach.ingest(DEMO_LESSON_TRANSCRIPT[i]);
      i++;
    }, 3_500);
    return () => clearInterval(id);
  }, [demoCoaching, coachOn, coach]);

  // The video stage must mount EXACTLY ONCE — the Daily SDK allows a single
  // call object per page, so rendering it in both the desktop rail and the
  // (CSS-hidden) mobile panel crashes the room. Pick the slot via media query.
  const isDesktop = useIsDesktop();

  const videoStage = (
    <VideoStage
      sessionId={sessionId}
      selfName={selfName}
      peerName={peerName}
      isHost={isHost}
      onTranscript={coachOn ? coach.ingest : undefined}
      onPeerPresent={handlePeerPresent}
      onJoined={handleJoined}
    />
  );

  const ended = Boolean(endedAtMs);
  const live = Boolean(startedAtMs) && !ended;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      {/* Header — Leave, lesson info, live clock, and (host) End button. */}
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
            {live ? <LiveBadge /> : ended ? <Badge variant="secondary">Ended</Badge> : <StatusBadge status={status} />}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {isObserver ? <Eye className="h-3.5 w-3.5" /> : <Avatar name={peerName} size={16} />}
            <span className="truncate">
              {isObserver ? `Observing ${peerName}` : `with ${peerName}`}
              {topic ? ` · ${topic}` : ""}
            </span>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          {!isObserver && (
            <Button
              variant={activityOpen ? "secondary" : "ghost"}
              size="sm"
              onClick={() => {
                const next = !activityOpen;
                setActivityOpen(next);
                setTab(next ? "activity" : "notebook");
              }}
              title="Activity: send a quick check or mini test"
            >
              <ListChecks className="h-4 w-4" />
              <span className="hidden sm:inline">Activity</span>
              {activity.activity && !activityOpen && <span className="h-2 w-2 rounded-full bg-primary" />}
            </Button>
          )}
          <Elapsed startedAtMs={startedAtMs} endedAtMs={endedAtMs} />
          <ProviderBadge />
          {isHost && (
            <EndLessonButton
              sessionId={sessionId}
              courseName={courseName}
              selfName={selfName}
              peerName={peerName}
              getSegments={coach.getSegments}
              ended={ended}
              onEnded={() => setEndedAtMs(Date.now())}
            />
          )}
        </div>
      </header>

      {joinError && (
        <div className="border-b bg-destructive/10 px-4 py-1.5 text-center text-xs text-destructive">{joinError}</div>
      )}

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Mobile tab switcher */}
        <div className="flex border-b lg:hidden">
          <TabButton active={tab === "notebook"} onClick={() => setTab("notebook")} icon={<NotebookPen className="h-4 w-4" />} label="Notebook" />
          <TabButton active={tab === "video"} onClick={() => setTab("video")} icon={<Video className="h-4 w-4" />} label="Video" />
          <TabButton active={tab === "materials"} onClick={() => setTab("materials")} icon={<NotebookPen className="h-4 w-4" />} label="Materials" />
          {!isObserver && (
            <TabButton active={tab === "activity"} onClick={() => { setTab("activity"); setActivityOpen(true); }} icon={<ListChecks className="h-4 w-4" />} label="Activity" />
          )}
        </div>

        {/* Left rail: video + materials (desktop only — conditionally MOUNTED) */}
        {isDesktop === true && (
          <aside className="flex w-80 shrink-0 flex-col border-r xl:w-96">
            <div className="h-[46%] min-h-[240px] border-b">{videoStage}</div>
            <div className="min-h-0 flex-1">
              <MaterialsPanel sessionId={sessionId} />
            </div>
          </aside>
        )}

        {/* Notebook (centerpiece) */}
        <main className={cn("relative min-h-[60vh] flex-1 bg-muted/30 lg:block", tab === "notebook" ? "block" : "hidden")}>
          <NotebookPanel notebookId={notebookId} saveId={saveId} userId={selfId} userName={selfName} initialSnapshot={initialSnapshot} />
          {coachOn && <CoachChip coach={coach} />}
        </main>

        {/* Activity panel (desktop): a right-hand rail beside the notebook */}
        {isDesktop === true && activityOpen && !isObserver && (
          <aside className="flex w-[400px] shrink-0 flex-col border-l bg-card">{activityPanel}</aside>
        )}

        {/* Mobile panels — video stays mounted across tab switches, just hidden */}
        {isDesktop === false && (
          <>
            <div className={cn("min-h-[60vh]", tab === "video" ? "block" : "hidden")}>{videoStage}</div>
            <div className={cn("min-h-[60vh]", tab === "materials" ? "block" : "hidden")}>
              <MaterialsPanel sessionId={sessionId} />
            </div>
            {!isObserver && <div className={cn("min-h-[60vh]", tab === "activity" ? "block" : "hidden")}>{activityPanel}</div>}
          </>
        )}
      </div>
    </div>
  );
}

function LiveBadge() {
  return (
    <Badge variant="success">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
      </span>
      Live now
    </Badge>
  );
}

/** Live elapsed time since the learner arrived (or final duration once ended). */
function Elapsed({ startedAtMs, endedAtMs }: { startedAtMs: number | null; endedAtMs: number | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (endedAtMs) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [endedAtMs]);

  if (!startedAtMs) {
    return (
      <span className="hidden items-center gap-1.5 text-sm text-muted-foreground sm:flex">
        <Clock className="h-4 w-4" /> Waiting to start
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
    <span className="hidden items-center gap-1.5 text-sm text-muted-foreground sm:flex">
      <Clock className="h-4 w-4" />
      <span className="tabular-nums">{label}</span>
    </span>
  );
}

function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
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

/** Tracks the lg (1024px) breakpoint; null until first client measurement. */
function useIsDesktop(): boolean | null {
  const [isDesktop, setIsDesktop] = useState<boolean | null>(null);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return isDesktop;
}

/** The live coach nudge — host-only, glanceable, mutable, dismissible. */
function CoachChip({ coach }: { coach: ReturnType<typeof useLiveCoach> }) {
  if (coach.muted) {
    return (
      <button
        onClick={() => coach.setMuted(false)}
        className="absolute bottom-4 left-4 z-10 flex items-center gap-1.5 rounded-full border bg-card/90 px-3 py-1.5 text-xs text-muted-foreground shadow backdrop-blur hover:text-foreground"
      >
        <BellOff className="h-3.5 w-3.5" /> Coach muted
      </button>
    );
  }
  if (!coach.nudge) return null;
  return (
    <div className="pointer-events-auto absolute bottom-4 left-4 z-10 max-w-xs animate-fade-in rounded-xl border border-primary/20 bg-card/95 p-3 shadow-lg backdrop-blur">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Sparkles className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <div className="text-xs font-semibold">AI coach</div>
          <p className="mt-0.5 text-sm text-muted-foreground">{coach.nudge.message}</p>
        </div>
        <div className="ml-1 flex shrink-0 flex-col gap-1">
          <button onClick={coach.dismiss} className="text-muted-foreground hover:text-foreground" title="Dismiss">
            <X className="h-3.5 w-3.5" />
          </button>
          <button onClick={() => coach.setMuted(true)} className="text-muted-foreground hover:text-foreground" title="Mute coach">
            <BellOff className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Ends the lesson: rpc lesson_end writes departed_at, stores the transcript and
 * starts the server-side analysis; the local analysis still runs for now so the
 * feedback shows immediately.
 */
function EndLessonButton({
  sessionId,
  courseName,
  selfName,
  peerName,
  getSegments,
  ended,
  onEnded,
}: {
  sessionId: string;
  courseName: string;
  selfName: string;
  peerName: string;
  getSegments: () => { speaker: "teacher" | "student"; text: string; start_ms: number; end_ms: number }[];
  ended: boolean;
  onEnded: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<TeacherFeedback | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function end() {
    setLoading(true);
    setError(null);
    try {
      const segments = getSegments();
      if (!ended) await endLesson(sessionId, segments);
      onEnded();
      const fb = await finalizeLesson(sessionId, segments, {
        teacherName: selfName,
        studentName: peerName,
        course: courseName,
      });
      setFeedback(fb);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The lesson could not be ended.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button onClick={end} disabled={loading} size="sm" variant={ended ? "outline" : "default"} title={error ?? undefined}>
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <SquareCheckBig className="h-4 w-4" />}
        <span className="hidden sm:inline">{ended ? "View feedback" : "End & get feedback"}</span>
        <span className="sm:hidden">{ended ? "Feedback" : "End"}</span>
      </Button>
      {error && <span className="hidden max-w-[16rem] truncate text-xs text-destructive md:inline">{error}</span>}

      <Dialog open={!!feedback} onOpenChange={(o) => !o && setFeedback(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" /> Lesson feedback
            </DialogTitle>
            <DialogDescription>{feedback?.summary}</DialogDescription>
          </DialogHeader>
          {feedback && (
            <div className="space-y-5">
              <div className="grid gap-5 sm:grid-cols-2">
                <div>
                  <div className="mb-2 text-sm font-semibold text-success">Strengths</div>
                  <ul className="space-y-1.5 text-sm">
                    {feedback.strengths.map((s, i) => (
                      <li key={i} className="flex gap-2">
                        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-success" />
                        {s}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <div className="mb-2 text-sm font-semibold text-primary">Things to try</div>
                  <ul className="space-y-1.5 text-sm">
                    {feedback.suggestions.map((s, i) => (
                      <li key={i} className="flex gap-2">
                        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                        {s}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
              <ScoreBars scores={feedback.dimension_scores} />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
