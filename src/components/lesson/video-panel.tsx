"use client";

import { useState } from "react";
import {
  Circle,
  Mic,
  MicOff,
  ShieldAlert,
  Video as VideoIcon,
  VideoOff,
  Wifi,
} from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function VideoPanel({
  selfName,
  peerName,
  recordingAllowed,
  isTeacher,
}: {
  selfName: string;
  peerName: string;
  recordingAllowed: boolean;
  isTeacher: boolean;
}) {
  const [mic, setMic] = useState(true);
  const [cam, setCam] = useState(true);
  const [recording, setRecording] = useState(false);

  return (
    <div className="flex h-full flex-col bg-slate-950 text-white">
      {/* Peer (main) tile */}
      <div className="relative flex-1">
        <div className="bg-dotted absolute inset-0 opacity-10" />
        <div className="flex h-full items-center justify-center">
          <div className="flex flex-col items-center gap-2">
            <Avatar name={peerName} size={72} className="ring-4 ring-white/10" />
            <span className="text-sm font-medium">{peerName}</span>
            <span className="text-xs text-white/50">Camera preview</span>
          </div>
        </div>

        {recording && (
          <div className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-black/50 px-2.5 py-1 text-xs font-medium">
            <Circle className="h-2.5 w-2.5 animate-pulse fill-red-500 text-red-500" />
            REC
          </div>
        )}

        <div className="absolute right-3 top-3 flex items-center gap-1.5 rounded-full bg-black/40 px-2 py-1 text-[11px] text-white/70">
          <Wifi className="h-3 w-3 text-emerald-400" /> Stable
        </div>

        {/* Self thumbnail */}
        <div className="absolute bottom-3 right-3 flex h-20 w-28 flex-col items-center justify-center rounded-lg bg-slate-800 ring-1 ring-white/10">
          {cam ? (
            <Avatar name={selfName} size={32} />
          ) : (
            <VideoOff className="h-5 w-5 text-white/40" />
          )}
          <span className="mt-1 text-[10px] text-white/60">You</span>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-center gap-2 border-t border-white/10 bg-slate-900 px-3 py-2.5">
        <ControlButton active={mic} onClick={() => setMic((v) => !v)} label="Mic">
          {mic ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
        </ControlButton>
        <ControlButton active={cam} onClick={() => setCam((v) => !v)} label="Camera">
          {cam ? <VideoIcon className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}
        </ControlButton>

        {isTeacher && (
          <button
            onClick={() => recordingAllowed && setRecording((v) => !v)}
            disabled={!recordingAllowed}
            title={recordingAllowed ? "Toggle recording" : "Consent required before recording"}
            className={cn(
              "ml-1 flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-medium transition-colors",
              !recordingAllowed && "cursor-not-allowed bg-white/5 text-white/40",
              recordingAllowed && recording && "bg-red-500/90 text-white hover:bg-red-500",
              recordingAllowed && !recording && "bg-white/10 text-white hover:bg-white/20",
            )}
          >
            {recordingAllowed ? (
              <Circle className={cn("h-3 w-3", recording && "fill-current")} />
            ) : (
              <ShieldAlert className="h-3.5 w-3.5" />
            )}
            {recording ? "Stop" : "Record"}
          </button>
        )}
      </div>

      {isTeacher && !recordingAllowed && (
        <div className="flex items-center gap-1.5 bg-amber-500/15 px-3 py-1.5 text-[11px] text-amber-200">
          <ShieldAlert className="h-3 w-3 shrink-0" />
          Recording disabled — student consent not on file (§9).
        </div>
      )}
    </div>
  );
}

function ControlButton({
  active,
  onClick,
  label,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
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

/** Badge shown in the lesson header noting which SDK would back the room. */
export function ProviderBadge() {
  return (
    <Badge variant="secondary" className="gap-1 text-[10px]">
      <VideoIcon className="h-3 w-3" /> Video SDK
    </Badge>
  );
}
