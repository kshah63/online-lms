"use client";

import { useMemo, useState } from "react";
import { Check, CircleDashed, ListChecks, Loader2, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PracticeRunner } from "@/components/practice/practice-runner";
import { MathMarkdown } from "@/components/practice/math-markdown";
import type { ActivityMode, PushedActivity, StudentSubmission } from "@/lib/practice/activity-channel";
import type { Question } from "@/lib/practice/model";
import { cn } from "@/lib/utils";

export interface ActivitySet {
  id: string;
  title: string;
  topic_label?: string | null;
  questions: Question[];
}

/** The lesson-room side panel: the teacher composes and watches; the student answers. */
export function ActivityPanel({
  isTeacher,
  sets,
  activity,
  submission,
  released,
  onPush,
  onSubmit,
  onRespond,
  onRelease,
  onClose,
  onDismiss,
  peerName,
}: {
  isTeacher: boolean;
  sets: ActivitySet[];
  activity: PushedActivity | null;
  submission: StudentSubmission | null;
  released: { marks: StudentSubmission["marks"]; score: number; max: number } | null;
  onPush: (input: { title: string; mode: ActivityMode; questions: Question[]; time_limit_s: number | null }) => void;
  onSubmit: (responses: Record<string, import("@/lib/practice/model").Response | null>, marks: StudentSubmission["marks"]) => void;
  onRespond: (questionId: string, response: import("@/lib/practice/model").Response) => void;
  onRelease: () => void;
  onClose: () => void;
  onDismiss: () => void;
  peerName: string;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="flex items-center gap-1.5 text-sm font-semibold">
          <ListChecks className="h-4 w-4 text-primary" /> Activity
        </span>
        <button onClick={onDismiss} className="rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground" title="Hide panel">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {isTeacher ? (
          activity ? (
            <TeacherLive activity={activity} submission={submission} peerName={peerName} onRelease={onRelease} onClose={onClose} />
          ) : (
            <TeacherCompose sets={sets} onPush={onPush} />
          )
        ) : activity ? (
          <StudentActivity activity={activity} submission={submission} released={released} onSubmit={onSubmit} onRespond={onRespond} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
            <CircleDashed className="h-6 w-6" />
            Waiting for your teacher to send a question.
          </div>
        )}
      </div>
    </div>
  );
}

function TeacherCompose({ sets, onPush }: { sets: ActivitySet[]; onPush: ActivityPanelProps["onPush"] }) {
  const [setId, setSetId] = useState(sets[0]?.id ?? "");
  const [mode, setMode] = useState<ActivityMode>("practice");
  const [picked, setPicked] = useState<Set<string>>(() => new Set(sets[0]?.questions.map((q) => q.id) ?? []));
  const set = sets.find((s) => s.id === setId) ?? null;
  const chosen = useMemo(() => (set ? set.questions.filter((q) => picked.has(q.id)) : []), [set, picked]);

  if (sets.length === 0) {
    return <p className="p-2 text-sm text-muted-foreground">No practice sets for this course yet. Add questions in the question bank first.</p>;
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground">Set</label>
        <select
          value={setId}
          onChange={(e) => {
            setSetId(e.target.value);
            const s = sets.find((x) => x.id === e.target.value);
            setPicked(new Set(s?.questions.map((q) => q.id) ?? []));
          }}
          className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
        >
          {sets.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title} ({s.questions.length})
            </option>
          ))}
        </select>
      </div>

      <div>
        <div className="mb-1 text-xs font-medium text-muted-foreground">Questions</div>
        <ul className="max-h-64 space-y-1 overflow-y-auto">
          {set?.questions.map((q, i) => {
            const on = picked.has(q.id);
            return (
              <li key={q.id}>
                <button
                  type="button"
                  onClick={() =>
                    setPicked((prev) => {
                      const next = new Set(prev);
                      if (on) next.delete(q.id);
                      else next.add(q.id);
                      return next;
                    })
                  }
                  className={cn("flex w-full items-start gap-2 rounded-md border px-2 py-1.5 text-left text-sm", on ? "border-primary/50 bg-primary/5" : "hover:bg-secondary")}
                >
                  <span className={cn("mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border", on && "border-primary bg-primary text-primary-foreground")}>{on && <Check className="h-3 w-3" />}</span>
                  <span className="min-w-0 flex-1">
                    <span className="mr-1 text-xs text-muted-foreground">{i + 1}.</span>
                    <MathMarkdown source={q.stem.split("\n")[0] ?? ""} inline />
                  </span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{q.type}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="flex gap-2">
        {(["practice", "test"] as ActivityMode[]).map((m) => (
          <button key={m} type="button" onClick={() => setMode(m)} className={cn("flex-1 rounded-md border px-2 py-1.5 text-sm", mode === m ? "border-primary bg-primary/10 text-primary" : "hover:bg-secondary")}>
            {m === "practice" ? "Quick check" : "Mini test"}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {mode === "practice" ? "The student sees the answer after each question." : "Nothing is marked until they submit; you release the results."}
      </p>

      <Button className="w-full" disabled={chosen.length === 0} onClick={() => set && onPush({ title: set.title, mode, questions: chosen, time_limit_s: null })}>
        <Send className="h-4 w-4" /> Send {chosen.length} question{chosen.length === 1 ? "" : "s"}
      </Button>
    </div>
  );
}

type ActivityPanelProps = Parameters<typeof ActivityPanel>[0];

function TeacherLive({ activity, submission, peerName, onRelease, onClose }: { activity: PushedActivity; submission: StudentSubmission | null; peerName: string; onRelease: () => void; onClose: () => void }) {
  return (
    <div className="space-y-4">
      <div>
        <div className="text-sm font-semibold">{activity.title}</div>
        <div className="text-xs text-muted-foreground">
          {activity.mode === "practice" ? "Quick check" : "Mini test"} · {activity.questions.length} question{activity.questions.length === 1 ? "" : "s"} · sent to {peerName}
        </div>
      </div>

      {!submission ? (
        <div className="flex items-center gap-2 rounded-md border border-dashed p-3 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Waiting for {peerName} to submit…
        </div>
      ) : (
        <div className="space-y-2">
          <div className="rounded-md bg-secondary/60 p-3 text-sm">
            <span className="font-semibold">
              {submission.score}/{submission.max}
            </span>{" "}
            auto-marked{submission.pending ? ` · ${submission.pending} to mark by hand` : ""}
          </div>
          <ul className="space-y-1.5">
            {activity.questions.map((q, i) => {
              const m = submission.marks[q.id];
              return (
                <li key={q.id} className="flex items-start gap-2 rounded-md border px-2 py-1.5 text-sm">
                  <span className={cn("mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full", m?.status === "correct" ? "bg-success" : m?.status === "incorrect" ? "bg-destructive" : m?.status === "partial" ? "bg-warning" : "bg-muted-foreground/40")} />
                  <span className="min-w-0 flex-1">
                    <span className="mr-1 text-xs text-muted-foreground">{i + 1}.</span>
                    <MathMarkdown source={q.stem.split("\n")[0] ?? ""} inline />
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {m ? `${m.score}/${m.max}` : "—"}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="flex gap-2">
        {activity.mode === "test" && submission && (
          <Button size="sm" onClick={onRelease}>
            Release results
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={onClose}>
          {submission ? "Done" : "Cancel"}
        </Button>
      </div>
    </div>
  );
}

function StudentActivity({ activity, submission, released, onSubmit, onRespond }: { activity: PushedActivity; submission: StudentSubmission | null; released: ActivityPanelProps["released"]; onSubmit: ActivityPanelProps["onSubmit"]; onRespond: ActivityPanelProps["onRespond"] }) {
  if (submission && activity.mode === "test") {
    return (
      <div className="space-y-3">
        <div className="rounded-md border p-3 text-sm">
          {released ? (
            <>
              <div className="font-semibold">
                {released.score}/{released.max}
              </div>
              <div className="text-muted-foreground">Your teacher has released the results.</div>
            </>
          ) : (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Check className="h-4 w-4 text-success" /> Submitted. Your teacher will go through it with you.
            </div>
          )}
        </div>
        {released && (
          <ul className="space-y-1">
            {activity.questions.map((q, i) => {
              const m = released.marks[q.id];
              return (
                <li key={q.id} className="flex items-center gap-2 text-sm">
                  <span className={cn("h-2.5 w-2.5 rounded-full", m?.status === "correct" ? "bg-success" : m?.status === "incorrect" ? "bg-destructive" : "bg-muted-foreground/40")} />
                  Question {i + 1}: {m ? `${m.score}/${m.max}` : "—"}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    );
  }
  return (
    <PracticeRunner
      key={activity.id}
      questions={activity.questions}
      mode={activity.mode}
      title={activity.title}
      submitted={Boolean(submission)}
      onSubmit={({ responses, marks }) => onSubmit(responses, marks)}
      onAttachNotebook={(qid) => onRespond(qid, { type: "worked", evidence: [{ kind: "notebook_page", ref: `activity:${activity.id}:${qid}` }], final_answer: null })}
    />
  );
}
