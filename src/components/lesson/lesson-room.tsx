"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  BellOff,
  ChevronLeft,
  Clock,
  Loader2,
  NotebookPen,
  Sparkles,
  SquareCheckBig,
  Video,
  X,
} from "lucide-react";
import { VideoStage } from "@/components/lesson/video-stage";
import { MaterialsPanel } from "@/components/lesson/materials-panel";
import { ProviderBadge } from "@/components/lesson/video-panel";
import { StatusBadge } from "@/components/status-badge";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScoreBars } from "@/components/coaching/score-bars";
import { useLiveCoach } from "@/lib/coaching/use-live-coach";
import { DEMO_LESSON_TRANSCRIPT } from "@/lib/coaching/demo-transcript";
import { finalizeLesson } from "@/lib/actions/coaching";
import { startSessionClock } from "@/lib/actions/sessions";
import type { TeacherFeedback } from "@/lib/coaching/analyze";
import type { SessionStatus } from "@/lib/types";
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

type Tab = "notebook" | "video" | "materials";

export function LessonRoom({
  sessionId,
  notebookId,
  materialsCourseId,
  courseName,
  status,
  backHref,
  selfId,
  selfName,
  peerName,
  isTeacher,
  initialSnapshot,
  actualStartISO,
  demoCoaching,
}: {
  sessionId: string;
  notebookId: string;
  materialsCourseId: string | null;
  courseName: string;
  status: SessionStatus;
  backHref: string;
  selfId: string;
  selfName: string;
  peerName: string;
  isTeacher: boolean;
  initialSnapshot: unknown | null;
  actualStartISO: string | null;
  demoCoaching: boolean;
}) {
  const [tab, setTab] = useState<Tab>("notebook");
  const coach = useLiveCoach(sessionId, isTeacher);

  // The lesson clock runs from when BOTH join (actual_start), not booking time.
  const [startedAtMs, setStartedAtMs] = useState<number | null>(
    actualStartISO ? Date.parse(actualStartISO) : null,
  );
  const [endedAtMs, setEndedAtMs] = useState<number | null>(null);
  const startedRef = useRef<boolean>(Boolean(actualStartISO));

  const handlePeerPresent = useCallback(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    startSessionClock(sessionId)
      .then((r) => setStartedAtMs(Date.parse(r.actual_start)))
      .catch(() => setStartedAtMs(Date.now()));
  }, [sessionId]);

  // §7.2 periodic AI live-coaching pass: every ~2.5 min, send the recent
  // transcript to Claude for a subtler nudge than the threshold rules.
  useEffect(() => {
    if (!isTeacher) return;
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
  }, [isTeacher, coach]);

  // Time-based cues (silence, praise drought) need a tick, not just segments.
  // Real-time only — demo uses the scripted transcript on its own clock.
  useEffect(() => {
    if (!isTeacher || demoCoaching) return;
    const id = setInterval(() => coach.tick(), 15_000);
    return () => clearInterval(id);
  }, [isTeacher, demoCoaching, coach]);

  // Demo: drive the live coach from a scripted transcript (no live audio).
  useEffect(() => {
    if (!demoCoaching || !isTeacher) return;
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
  }, [demoCoaching, isTeacher, coach]);

  // The video stage must mount EXACTLY ONCE — the Daily SDK allows a single
  // call object per page, so rendering it in both the desktop rail and the
  // (CSS-hidden) mobile panel crashes the room. Pick the slot via media query.
  const isDesktop = useIsDesktop();

  const videoStage = (
    <VideoStage
      sessionId={sessionId}
      selfName={selfName}
      peerName={peerName}
      isTeacher={isTeacher}
      onTranscript={coach.ingest}
      onPeerPresent={handlePeerPresent}
    />
  );

  const liveStatus: SessionStatus = endedAtMs ? "completed" : startedAtMs ? "in_progress" : status;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      {/* Header — Leave, lesson info, live clock, and (teacher) End button. */}
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
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Avatar name={peerName} size={16} />
            <span className="truncate">with {peerName}</span>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <Elapsed startedAtMs={startedAtMs} endedAtMs={endedAtMs} />
          <ProviderBadge />
          {isTeacher && (
            <EndLessonButton
              sessionId={sessionId}
              courseName={courseName}
              selfName={selfName}
              peerName={peerName}
              getSegments={coach.getSegments}
              ended={Boolean(endedAtMs)}
              onEnded={() => setEndedAtMs(Date.now())}
            />
          )}
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* Mobile tab switcher */}
        <div className="flex border-b lg:hidden">
          <TabButton active={tab === "notebook"} onClick={() => setTab("notebook")} icon={<NotebookPen className="h-4 w-4" />} label="Notebook" />
          <TabButton active={tab === "video"} onClick={() => setTab("video")} icon={<Video className="h-4 w-4" />} label="Video" />
          <TabButton active={tab === "materials"} onClick={() => setTab("materials")} icon={<NotebookPen className="h-4 w-4" />} label="Materials" />
        </div>

        {/* Left rail: video + materials (desktop only — conditionally MOUNTED) */}
        {isDesktop === true && (
          <aside className="flex w-80 shrink-0 flex-col border-r xl:w-96">
            <div className="h-[46%] min-h-[240px] border-b">{videoStage}</div>
            <div className="min-h-0 flex-1">
              <MaterialsPanel materialsCourseId={materialsCourseId} />
            </div>
          </aside>
        )}

        {/* Notebook (centerpiece) */}
        <main className={cn("relative min-h-[60vh] flex-1 bg-muted/30 lg:block", tab === "notebook" ? "block" : "hidden")}>
          <NotebookPanel notebookId={notebookId} userId={selfId} userName={selfName} initialSnapshot={initialSnapshot} />
          {isTeacher && <CoachChip coach={coach} />}
        </main>

        {/* Mobile panels — video stays mounted across tab switches, just hidden */}
        {isDesktop === false && (
          <>
            <div className={cn("min-h-[60vh]", tab === "video" ? "block" : "hidden")}>{videoStage}</div>
            <div className={cn("min-h-[60vh]", tab === "materials" ? "block" : "hidden")}>
              <MaterialsPanel materialsCourseId={materialsCourseId} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** Live elapsed time since both joined (or final duration once ended). */
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

/** §7.2 The live coach nudge — teacher-only, glanceable, mutable, dismissible. */
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

/** Ends the lesson: runs the §7.3 post-session analysis and shows the feedback. */
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

  async function end() {
    setLoading(true);
    try {
      const fb = await finalizeLesson(sessionId, getSegments(), {
        teacherName: selfName,
        studentName: peerName,
        course: courseName,
      });
      onEnded();
      setFeedback(fb);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button onClick={end} disabled={loading} size="sm" variant={ended ? "outline" : "default"}>
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <SquareCheckBig className="h-4 w-4" />}
        <span className="hidden sm:inline">{ended ? "View feedback" : "End & get feedback"}</span>
        <span className="sm:hidden">{ended ? "Feedback" : "End"}</span>
      </Button>

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
