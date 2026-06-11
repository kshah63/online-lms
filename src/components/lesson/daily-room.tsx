"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Daily from "@daily-co/daily-js";
import {
  DailyAudio,
  DailyProvider,
  DailyVideo,
  useDaily,
  useDailyEvent,
  useLocalSessionId,
  useParticipantIds,
} from "@daily-co/daily-react";
import { Circle, FileText, Mic, MicOff, ShieldAlert, Video as VideoIcon, VideoOff, Wifi } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import type { TranscriptSegment } from "@/lib/coaching/metrics";

interface RoomProps {
  roomUrl: string;
  token: string;
  isOwner: boolean;
  recordingAllowed: boolean;
  isTeacher: boolean;
  selfName: string;
  peerName: string;
  onTranscript?: (seg: TranscriptSegment) => void;
  onPeerPresent?: () => void;
}

export function DailyRoom(props: RoomProps) {
  // Daily allows only ONE call object per page — reuse an existing instance
  // if something already created one (a duplicate would throw and crash the
  // whole lesson room).
  const [call] = useState(() => Daily.getCallInstance() ?? Daily.createCallObject());

  useEffect(() => {
    call.join({ url: props.roomUrl, token: props.token }).catch((e) => console.error("join failed", e));
    return () => {
      void call.leave().catch(() => {});
      try {
        call.destroy();
      } catch {
        /* already destroyed */
      }
    };
  }, [call, props.roomUrl, props.token]);

  return (
    <DailyProvider callObject={call}>
      <RoomInner {...props} />
      <DailyAudio />
    </DailyProvider>
  );
}

function RoomInner({ isOwner, recordingAllowed, isTeacher, selfName, peerName, onTranscript, onPeerPresent }: RoomProps) {
  const daily = useDaily();
  const localId = useLocalSessionId();
  const remoteIds = useParticipantIds({ filter: "remote" });
  const peerId = remoteIds[0];

  const [mic, setMic] = useState(true);
  const [cam, setCam] = useState(true);
  const [recording, setRecording] = useState(false);
  const [transcription, setTranscription] = useState<"idle" | "on" | "error">("idle");
  const [transcriptionError, setTranscriptionError] = useState<string | null>(null);

  // Both participants are in the room — start the real session clock (once).
  const announcedRef = useRef(false);
  useEffect(() => {
    if (peerId && !announcedRef.current) {
      announcedRef.current = true;
      onPeerPresent?.();
    }
  }, [peerId, onPeerPresent]);

  // Owner starts transcription so §7's coaching pipeline has a feed — but only
  // AFTER joining (Daily rejects startTranscription() before the join completes).
  const startTx = useCallback(() => {
    if (!daily || !isOwner) return;
    try {
      daily.startTranscription();
    } catch (e) {
      console.error("Daily startTranscription threw:", e);
      setTranscriptionError(e instanceof Error ? e.message : String(e));
      setTranscription("error");
    }
  }, [daily, isOwner]);

  useDailyEvent("joined-meeting", startTx);

  // If we mounted after the join already happened, start now.
  useEffect(() => {
    if (daily?.meetingState?.() === "joined-meeting") startTx();
  }, [daily, startTx]);

  // Surface whether transcription actually started (the real signal — it
  // arrives as an event, not a throw, when the plan/room doesn't allow it).
  useDailyEvent("transcription-started", () => setTranscription("on"));
  useDailyEvent("transcription-stopped", () => setTranscription("idle"));
  useDailyEvent(
    "transcription-error",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (ev: any) => {
      const msg = ev?.errorMsg ?? ev?.error ?? "Transcription isn't enabled on this Daily account/plan.";
      console.error("Daily transcription-error:", msg);
      setTranscriptionError(typeof msg === "string" ? msg : JSON.stringify(msg));
      setTranscription("error");
    },
  );

  // Map transcription messages to teacher/student segments.
  useDailyEvent(
    "transcription-message",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (ev: any) => {
      if (!onTranscript || !ev?.text) return;
      const fromLocal = ev.participantId === localId;
      const speaker: "teacher" | "student" = fromLocal
        ? isTeacher
          ? "teacher"
          : "student"
        : isTeacher
          ? "student"
          : "teacher";
      const end = Date.now();
      onTranscript({ speaker, text: ev.text, start_ms: end - 4000, end_ms: end });
    },
  );

  function toggleMic() {
    const next = !mic;
    setMic(next);
    daily?.setLocalAudio(next);
  }
  function toggleCam() {
    const next = !cam;
    setCam(next);
    daily?.setLocalVideo(next);
  }
  function toggleRecording() {
    if (!recordingAllowed || !isOwner) return;
    if (recording) daily?.stopRecording();
    else daily?.startRecording();
    setRecording((v) => !v);
  }

  return (
    <div className="flex h-full flex-col bg-slate-950 text-white">
      <div className="relative flex-1">
        {peerId ? (
          <DailyVideo sessionId={peerId} type="video" automirror className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center">
            <div className="flex flex-col items-center gap-2">
              <Avatar name={peerName} size={64} className="ring-4 ring-white/10" />
              <span className="text-sm text-white/60">Waiting for {peerName} to join…</span>
            </div>
          </div>
        )}

        {recording && (
          <div className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-black/50 px-2.5 py-1 text-xs font-medium">
            <Circle className="h-2.5 w-2.5 animate-pulse fill-red-500 text-red-500" /> REC
          </div>
        )}
        <div className="absolute right-3 top-3 flex flex-col items-end gap-1.5">
          <div className="flex items-center gap-1.5 rounded-full bg-black/40 px-2 py-1 text-[11px] text-white/70">
            <Wifi className="h-3 w-3 text-emerald-400" /> Live
          </div>
          {/* Transcription status — visible to the owner (teacher) so you can
              tell at a glance whether the AI-coaching feed is running. */}
          {isOwner && transcription !== "idle" && (
            <div
              className="flex items-center gap-1.5 rounded-full bg-black/40 px-2 py-1 text-[11px]"
              title={transcription === "error" ? transcriptionError ?? "Transcription unavailable" : "Live transcription is running"}
            >
              <FileText className={cn("h-3 w-3", transcription === "on" ? "text-emerald-400" : "text-amber-400")} />
              <span className="text-white/70">
                {transcription === "on" ? "Transcribing" : "Transcription off"}
              </span>
            </div>
          )}
        </div>

        {/* self thumbnail */}
        <div className="absolute bottom-3 right-3 h-20 w-28 overflow-hidden rounded-lg bg-slate-800 ring-1 ring-white/10">
          {localId && cam ? (
            <DailyVideo sessionId={localId} type="video" automirror mirror className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full flex-col items-center justify-center">
              <Avatar name={selfName} size={28} />
              <span className="mt-1 text-[10px] text-white/60">You</span>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center justify-center gap-2 border-t border-white/10 bg-slate-900 px-3 py-2.5">
        <button onClick={toggleMic} className={ctrl(mic)} aria-label="Mic">
          {mic ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
        </button>
        <button onClick={toggleCam} className={ctrl(cam)} aria-label="Camera">
          {cam ? <VideoIcon className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}
        </button>
        {isOwner && (
          <button
            onClick={toggleRecording}
            disabled={!recordingAllowed}
            title={recordingAllowed ? "Toggle recording" : "Consent required before recording"}
            className={cn(
              "ml-1 flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-medium transition-colors",
              !recordingAllowed && "cursor-not-allowed bg-white/5 text-white/40",
              recordingAllowed && recording && "bg-red-500/90 text-white hover:bg-red-500",
              recordingAllowed && !recording && "bg-white/10 text-white hover:bg-white/20",
            )}
          >
            {recordingAllowed ? <Circle className={cn("h-3 w-3", recording && "fill-current")} /> : <ShieldAlert className="h-3.5 w-3.5" />}
            {recording ? "Stop" : "Record"}
          </button>
        )}
      </div>

      {isOwner && transcription === "error" && (
        <div className="border-t border-white/10 bg-amber-500/15 px-3 py-1.5 text-[11px] leading-snug text-amber-200">
          AI transcription isn&rsquo;t running{transcriptionError ? `: ${transcriptionError}` : "."} Recording &amp; feedback still
          work; coaching uses metrics until transcription is enabled in Daily.
        </div>
      )}
    </div>
  );
}

function ctrl(active: boolean) {
  return cn(
    "flex h-9 w-9 items-center justify-center rounded-full transition-colors",
    active ? "bg-white/10 text-white hover:bg-white/20" : "bg-red-500/90 text-white hover:bg-red-500",
  );
}
