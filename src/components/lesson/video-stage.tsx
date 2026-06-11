"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";
import { MockVideoPanel } from "@/components/lesson/video-panel";
import type { TranscriptSegment } from "@/lib/coaching/metrics";

// Daily SDK is browser-only.
const DailyRoom = dynamic(() => import("@/components/lesson/daily-room").then((m) => m.DailyRoom), {
  ssr: false,
});

type Config = { configured: boolean; roomUrl?: string; token?: string; isOwner?: boolean };

export function VideoStage({
  sessionId,
  selfName,
  peerName,
  recordingAllowed,
  isTeacher,
  onTranscript,
}: {
  sessionId: string;
  selfName: string;
  peerName: string;
  recordingAllowed: boolean;
  isTeacher: boolean;
  onTranscript?: (seg: TranscriptSegment) => void;
}) {
  const [config, setConfig] = useState<Config | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/lesson/${sessionId}/video`, { method: "POST" })
      .then((r) => r.json())
      .then((c) => !cancelled && setConfig(c))
      .catch(() => !cancelled && setConfig({ configured: false }));
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  if (!config) {
    return (
      <div className="flex h-full items-center justify-center bg-slate-950 text-sm text-white/60">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Connecting…
      </div>
    );
  }

  if (config.configured && config.roomUrl && config.token) {
    return (
      <DailyRoom
        roomUrl={config.roomUrl}
        token={config.token}
        isOwner={Boolean(config.isOwner)}
        recordingAllowed={recordingAllowed}
        isTeacher={isTeacher}
        selfName={selfName}
        peerName={peerName}
        onTranscript={onTranscript}
      />
    );
  }

  return (
    <MockVideoPanel
      selfName={selfName}
      peerName={peerName}
      recordingAllowed={recordingAllowed}
      isTeacher={isTeacher}
    />
  );
}
