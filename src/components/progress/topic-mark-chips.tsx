"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, CheckCircle2, Circle, CircleDashed, CircleDot, Loader2 } from "lucide-react";
import { DateTime } from "luxon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { markTopicStatus } from "@/lib/actions/brief";
import { label as statusLabel, type TopicStatus } from "@/lib/syllabus/progress";
import { cn } from "@/lib/utils";

// ============================================================================
// "Mark a topic": the host's explicit word on where the student stands on
// the syllabus, through set_topic_status. Both choices are chips — the topic
// (every one of the course's visible) and the status (all five visible) —
// so nothing is typed but the optional note.
// ============================================================================

export interface MarkableTopic {
  id: string;
  label: string;
  status: TopicStatus | null;
  at: string | null;
}

const STATUSES: TopicStatus[] = ["not_started", "in_progress", "covered", "secure", "needs_work"];

const ICON: Record<TopicStatus, { icon: React.ComponentType<{ className?: string }>; className: string }> = {
  not_started: { icon: Circle, className: "text-muted-foreground" },
  in_progress: { icon: CircleDashed, className: "text-muted-foreground" },
  covered: { icon: CircleDot, className: "text-primary" },
  secure: { icon: CheckCircle2, className: "text-success" },
  needs_work: { icon: AlertTriangle, className: "text-warning-foreground" },
};

export function TopicMarkChips({ sessionId, studentId, topics }: { sessionId: string; studentId: string; topics: MarkableTopic[] }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [status, setStatus] = useState<TopicStatus | null>(null);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const topic = topics.find((t) => t.id === selected) ?? null;

  function pick(t: MarkableTopic) {
    setSelected(t.id === selected ? null : t.id);
    setStatus(t.status);
    setNote("");
    setMessage(null);
  }

  function submit() {
    if (!topic || !status) return;
    startTransition(async () => {
      const result = await markTopicStatus({ sessionId, studentId, topicId: topic.id, status, note });
      setMessage({ ok: result.ok, text: result.message });
    });
  }

  if (topics.length === 0) {
    return <p className="text-sm text-muted-foreground">This course has no syllabus yet. The in-charge seeds one from the course topics.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2" role="listbox" aria-label="Topic">
        {topics.map((t) => {
          const meta = t.status ? ICON[t.status] : null;
          const Icon = meta?.icon;
          const active = t.id === selected;
          return (
            <button
              key={t.id}
              type="button"
              role="option"
              aria-selected={active}
              onClick={() => pick(t)}
              title={t.status ? `${statusLabel(t.status)}${t.at ? `, ${DateTime.fromISO(t.at).toRelative()}` : ""}` : "Not marked yet"}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors",
                active ? "border-primary bg-primary/10 font-medium text-primary" : "border-input bg-card hover:bg-secondary",
              )}
            >
              {Icon && meta && <Icon className={cn("h-3.5 w-3.5", meta.className)} />}
              {t.label}
            </button>
          );
        })}
      </div>

      {topic && (
        <div className="space-y-3 rounded-lg border bg-secondary/40 p-3">
          <div className="text-sm">
            <span className="font-medium">{topic.label}</span>
            <span className="text-muted-foreground">{topic.status ? ` — currently ${statusLabel(topic.status)}` : " — not marked yet"}</span>
          </div>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Status">
            {STATUSES.map((s) => {
              const meta = ICON[s];
              const Icon = meta.icon;
              const active = s === status;
              return (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setStatus(s)}
                  className={cn(
                    "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm capitalize transition-colors",
                    active ? "border-primary bg-primary/10 font-medium text-primary" : "border-input bg-card hover:bg-secondary",
                  )}
                >
                  <Icon className={cn("h-3.5 w-3.5", meta.className)} />
                  {statusLabel(s)}
                </button>
              );
            })}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="A note for the next teacher (optional)" maxLength={200} className="sm:flex-1" />
            <Button type="button" size="sm" onClick={submit} disabled={!status || pending} className="h-9">
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Mark {statusLabel(status ?? topic.status ?? "covered")}
            </Button>
          </div>
          {message && (
            <p className={cn("text-sm", message.ok ? "text-success" : "text-destructive")} role="status">
              {message.text}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
