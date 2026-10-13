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

type Config = { configured: boolean; roomUrl?: string; token?: string; isOwner?: boolean; error?: string };

export function VideoStage({
  sessionId,
  selfName,
  peerName,
  isHost,
  onTranscript,
  onPeerPresent,
  onJoined,
}: {
  sessionId: string;
  selfName: string;
  peerName: string;
  /** The host joins as the Daily owner: record and transcribe rights. */
  isHost: boolean;
  onTranscript?: (seg: TranscriptSegment) => void;
  /** The other party is in the room. */
  onPeerPresent?: () => void;
  /** This viewer's own join succeeded (the learner's attendance write hangs off it). */
  onJoined?: () => void;
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

  // The mock panel can't detect a real peer or a real join — fire both on mount
  // so the flow is testable without a video provider configured.
  const usingMock = Boolean(config && !(config.configured && config.roomUrl && config.token));
  useEffect(() => {
    if (!usingMock) return;
    onJoined?.();
    onPeerPresent?.();
  }, [usingMock, onJoined, onPeerPresent]);

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
        isTeacher={isHost}
        selfName={selfName}
        peerName={peerName}
        onTranscript={onTranscript}
        onPeerPresent={onPeerPresent}
        onJoined={onJoined}
      />
    );
  }

  return <MockVideoPanel selfName={selfName} peerName={peerName} />;
}
