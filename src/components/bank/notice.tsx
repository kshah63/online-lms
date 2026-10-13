"use client";

import { AlertCircle, CheckCircle2, X } from "lucide-react";
import { cn } from "@/lib/utils";

/** The outcome of an action, as a sentence: never swallowed, dismissible when it is good news. */
export function Notice({ ok, message, onDismiss, className }: { ok: boolean; message: string; onDismiss?: () => void; className?: string }) {
  if (!message) return null;
  return (
    <div
      role={ok ? "status" : "alert"}
      className={cn("flex items-start gap-2 rounded-lg border px-3 py-2 text-sm", ok ? "border-success/40 bg-success/5 text-foreground" : "border-destructive/40 bg-destructive/5 text-destructive", className)}
    >
      {ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />}
      <span className="min-w-0 flex-1">{message}</span>
      {onDismiss && (
        <button type="button" onClick={onDismiss} className="rounded p-0.5 text-muted-foreground hover:text-foreground" aria-label="Dismiss">
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
