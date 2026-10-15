"use client";

import { useState, useTransition } from "react";
import { CircleAlert, Loader2, Mic, MicOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { setRecordingOptOut, type RecordingOptOutResult } from "@/lib/actions/people";

/**
 * Admin control for one student's recording policy (opt-out model). Shows the
 * current state as a badge and flips it through `setRecordingOptOut`, which
 * pushes the setting to every Pencil Space of the student with read-back.
 * Warnings (unconfirmed Space, lesson within 3 h) are shown inline — the
 * action also raises an admin follow-up for each.
 */
export function RecordingToggle({
  studentId,
  studentName,
  optedOut: initialOptedOut,
}: {
  studentId: string;
  studentName: string;
  optedOut: boolean;
}) {
  const [optedOut, setOptedOut] = useState(initialOptedOut);
  const [result, setResult] = useState<RecordingOptOutResult | null>(null);
  const [pending, start] = useTransition();
  const firstName = studentName.split(" ")[0] ?? studentName;

  function toggle() {
    const next = !optedOut;
    const confirmed = window.confirm(
      next
        ? `Stop recording ${firstName}'s lessons?\n\nNo transcript, AI summary or coaching will exist for their lessons, and the setting is pushed to every Pencil Space they have.`
        : `Record ${firstName}'s lessons again (audio + board)?\n\nThe family should know before the next lesson.`,
    );
    if (!confirmed) return;
    start(async () => {
      const r = await setRecordingOptOut(studentId, next);
      setResult(r);
      if (r.ok) setOptedOut(r.optedOut);
    });
  }

  return (
    <div className="flex flex-col items-start gap-1.5 sm:items-end">
      <div className="flex flex-wrap items-center gap-2">
        {optedOut ? (
          <Badge variant="warning" className="gap-1">
            <MicOff className="h-3 w-3" /> Recording: opted out
          </Badge>
        ) : (
          <Badge variant="success" className="gap-1">
            <Mic className="h-3 w-3" /> Recording: on
          </Badge>
        )}
        <Button size="sm" variant="outline" disabled={pending} onClick={toggle}>
          {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {optedOut ? "Resume recording" : "Opt out"}
        </Button>
      </div>
      {result && !result.ok && <p className="max-w-md text-xs text-destructive">{result.message}</p>}
      {result?.ok && (
        <div className="max-w-md space-y-1 text-right">
          <p className="text-xs text-muted-foreground">{result.message}</p>
          {result.warnings.map((w, i) => (
            <p key={i} className="flex items-start gap-1 text-xs text-warning-foreground">
              <CircleAlert className="mt-0.5 h-3 w-3 shrink-0" /> <span>{w}</span>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
