"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { Loader2, NotebookPen, Sparkles, Video, X } from "lucide-react";
import { VideoPanel } from "@/components/lesson/video-panel";
import { MaterialsPanel } from "@/components/lesson/materials-panel";
import { cn } from "@/lib/utils";

// tldraw is browser-only — load without SSR.
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
  notebookId,
  materialsCourseId,
  selfName,
  peerName,
  recordingAllowed,
  isTeacher,
}: {
  notebookId: string;
  materialsCourseId: string | null;
  selfName: string;
  peerName: string;
  recordingAllowed: boolean;
  isTeacher: boolean;
}) {
  const [tab, setTab] = useState<Tab>("notebook");

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      {/* Mobile tab switcher */}
      <div className="flex border-b lg:hidden">
        <TabButton active={tab === "notebook"} onClick={() => setTab("notebook")} icon={<NotebookPen className="h-4 w-4" />} label="Notebook" />
        <TabButton active={tab === "video"} onClick={() => setTab("video")} icon={<Video className="h-4 w-4" />} label="Video" />
        <TabButton active={tab === "materials"} onClick={() => setTab("materials")} icon={<NotebookPen className="h-4 w-4" />} label="Materials" />
      </div>

      {/* Left rail: video + materials (desktop) */}
      <aside className="hidden w-80 shrink-0 flex-col border-r lg:flex xl:w-96">
        <div className="h-[46%] min-h-[240px] border-b">
          <VideoPanel selfName={selfName} peerName={peerName} recordingAllowed={recordingAllowed} isTeacher={isTeacher} />
        </div>
        <div className="min-h-0 flex-1">
          <MaterialsPanel materialsCourseId={materialsCourseId} />
        </div>
      </aside>

      {/* Notebook (centerpiece) */}
      <main className={cn("relative min-h-[60vh] flex-1 bg-muted/30 lg:block", tab === "notebook" ? "block" : "hidden")}>
        <NotebookPanel notebookId={notebookId} />
        {isTeacher && <CoachPreview />}
      </main>

      {/* Mobile panels */}
      <div className={cn("min-h-[60vh] lg:hidden", tab === "video" ? "block" : "hidden")}>
        <VideoPanel selfName={selfName} peerName={peerName} recordingAllowed={recordingAllowed} isTeacher={isTeacher} />
      </div>
      <div className={cn("min-h-[60vh] lg:hidden", tab === "materials" ? "block" : "hidden")}>
        <MaterialsPanel materialsCourseId={materialsCourseId} />
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
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

/**
 * §7.2 Live coaching — teacher-only, private, dismissible nudge chip.
 * Shown here as a design preview; the live transcript→nudge pipeline is the
 * final build step and ships after a pilot.
 */
function CoachPreview() {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return (
    <div className="pointer-events-auto absolute bottom-4 left-4 z-10 max-w-xs animate-fade-in rounded-xl border border-primary/20 bg-card/95 p-3 shadow-lg backdrop-blur">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Sparkles className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-xs font-semibold">
            AI coach
            <span className="rounded bg-secondary px-1 py-0.5 text-[9px] font-medium uppercase text-muted-foreground">
              Preview
            </span>
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">Hand them the pen — let the student try the next step.</p>
        </div>
        <button onClick={() => setDismissed(true)} className="ml-1 shrink-0 text-muted-foreground hover:text-foreground">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
