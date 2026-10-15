"use client";

import { useState } from "react";
import {
  Check,
  Eraser,
  Mic,
  MicOff,
  MonitorPlay,
  PenLine,
  Shapes,
  Type,
  UserRoundPlus,
  Video as VideoIcon,
  VideoOff,
  Wifi,
} from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ============================================================================
// Sample room shown when Pencil Spaces is mocked (demo mode, or no API key):
// a board, two tiles and a "Simulate <peer> joins" button that fires the SAME
// participant_join handler the live embed would, so the clock / status flow is
// testable offline. Nothing here talks to Pencil.
// ============================================================================

type Tool = "pen" | "eraser" | "text" | "shapes";

export function MockSpacePanel({
  selfName,
  peerName,
  reason,
  peerJoined,
  onPeerJoin,
}: {
  selfName: string;
  peerName: string;
  reason: "demo" | "unconfigured";
  /** The other participant has "joined" (set by the parent after onPeerJoin). */
  peerJoined: boolean;
  /** Fires the participant_join handler for the peer. */
  onPeerJoin: () => void;
}) {
  const [tool, setTool] = useState<Tool>("pen");
  const [mic, setMic] = useState(true);
  const [cam, setCam] = useState(true);
  const peerFirst = peerName.split(/\s+/)[0] || peerName;

  return (
    <div className="flex h-full w-full flex-col bg-slate-950 text-white">
      {/* Top bar */}
      <div className="flex items-center justify-between gap-2 border-b border-white/10 px-3 py-2 text-xs">
        <div className="flex min-w-0 items-center gap-2">
          <MonitorPlay className="h-3.5 w-3.5 shrink-0 text-sky-400" />
          <span className="shrink-0 font-medium">Sample Space</span>
          <span className="truncate rounded-full bg-amber-400/15 px-2 py-0.5 text-[10px] font-medium text-amber-300">
            {reason === "demo" ? "Demo mode — sample room" : "Pencil Spaces not configured — sample room"}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 text-white/60">
          <Wifi className="h-3 w-3 text-emerald-400" /> Stable
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1">
        {/* Board */}
        <div className="relative min-w-0 flex-1 overflow-hidden bg-white text-foreground">
          <div className="bg-dotted absolute inset-0" />
          <svg
            className="absolute inset-0 h-full w-full"
            viewBox="0 0 800 500"
            preserveAspectRatio="xMidYMid meet"
            aria-hidden
          >
            <path d="M120 140 q40 -60 80 0 t80 0" fill="none" stroke="#2563eb" strokeWidth="4" strokeLinecap="round" />
            <path d="M340 120 l60 90 l40 -50" fill="none" stroke="#dc2626" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
            <text x="120" y="240" fontSize="28" fontFamily="ui-sans-serif, system-ui" fill="#0f172a">
              2x + 3 = 11
            </text>
            <text x="120" y="290" fontSize="28" fontFamily="ui-sans-serif, system-ui" fill="#0f172a">
              x = 4
            </text>
            <circle cx="520" cy="300" r="60" fill="none" stroke="#16a34a" strokeWidth="4" strokeDasharray="8 8" />
            <path d="M120 360 h520" stroke="#94a3b8" strokeWidth="2" strokeDasharray="4 6" />
          </svg>

          {/* Toolbar */}
          <div className="absolute left-1/2 top-3 flex -translate-x-1/2 items-center gap-0.5 rounded-full border bg-card p-1 shadow-md">
            <ToolButton active={tool === "pen"} onClick={() => setTool("pen")} label="Pen">
              <PenLine className="h-4 w-4" />
            </ToolButton>
            <ToolButton active={tool === "eraser"} onClick={() => setTool("eraser")} label="Eraser">
              <Eraser className="h-4 w-4" />
            </ToolButton>
            <ToolButton active={tool === "text"} onClick={() => setTool("text")} label="Text">
              <Type className="h-4 w-4" />
            </ToolButton>
            <ToolButton active={tool === "shapes"} onClick={() => setTool("shapes")} label="Shapes">
              <Shapes className="h-4 w-4" />
            </ToolButton>
          </div>

          <div className="absolute bottom-3 left-3 rounded-md bg-black/60 px-2 py-1 text-[11px] text-white/80">
            Board 1 · sample
          </div>
        </div>

        {/* Tiles */}
        <div className="flex w-32 shrink-0 flex-col gap-2 border-l border-white/10 bg-slate-900 p-2 sm:w-40">
          <Tile name={selfName} label="You" micOff={!mic} camOff={!cam} />
          {peerJoined ? (
            <Tile name={peerName} label={peerFirst} />
          ) : (
            <div className="flex h-24 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-white/15 px-2 text-center text-[11px] text-white/50">
              <Avatar name={peerName} size={28} className="opacity-40 ring-0" />
              Waiting for {peerFirst}
            </div>
          )}
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center justify-center gap-2 border-t border-white/10 bg-slate-900 px-3 py-2.5">
        <ControlButton active={mic} onClick={() => setMic((v) => !v)} label="Mic">
          {mic ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
        </ControlButton>
        <ControlButton active={cam} onClick={() => setCam((v) => !v)} label="Camera">
          {cam ? <VideoIcon className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}
        </ControlButton>
        <Button size="sm" variant="secondary" className="ml-2" onClick={onPeerJoin} disabled={peerJoined}>
          {peerJoined ? (
            <>
              <Check className="h-4 w-4" /> {peerFirst} joined
            </>
          ) : (
            <>
              <UserRoundPlus className="h-4 w-4" /> Simulate {peerFirst} joins
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

function Tile({ name, label, micOff, camOff }: { name: string; label: string; micOff?: boolean; camOff?: boolean }) {
  return (
    <div className="relative flex h-24 flex-col items-center justify-center rounded-lg bg-slate-800 ring-1 ring-white/10">
      {camOff ? <VideoOff className="h-5 w-5 text-white/40" /> : <Avatar name={name} size={36} className="ring-0" />}
      <span className="mt-1.5 max-w-full truncate px-2 text-[11px] text-white/70">{label}</span>
      {micOff && (
        <span className="absolute right-1.5 top-1.5 rounded-full bg-red-500/90 p-1">
          <MicOff className="h-3 w-3" />
        </span>
      )}
    </div>
  );
}

function ToolButton({ active, onClick, label, children }: { active: boolean; onClick: () => void; label: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-full transition-colors",
        active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function ControlButton({ active, onClick, label, children }: { active: boolean; onClick: () => void; label: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        "flex h-9 w-9 items-center justify-center rounded-full transition-colors",
        active ? "bg-white/10 text-white hover:bg-white/20" : "bg-red-500/90 text-white hover:bg-red-500",
      )}
    >
      {children}
    </button>
  );
}

/** Header badge naming what backs the room right now. */
export function ProviderBadge({ provider }: { provider: "pencil" | "mock" | "fallback" }) {
  const label = provider === "pencil" ? "Pencil Spaces" : provider === "mock" ? "Mock Space" : "Zoom fallback";
  const Icon = provider === "fallback" ? VideoIcon : MonitorPlay;
  return (
    <Badge variant={provider === "fallback" ? "warning" : "secondary"} className="gap-1 text-[10px]">
      <Icon className="h-3 w-3" /> {label}
    </Badge>
  );
}
