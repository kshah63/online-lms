"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { AlertCircle, Check, CircleDashed, ListChecks, Loader2, Mic, PenLine, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AttemptRunner } from "@/components/practice/attempt-runner";
import { MathMarkdown } from "@/components/practice/math-markdown";
import { activityContextAction, addOneOffQuestionAction, liveAttemptsAction, loadAttemptAction, recordOralCheckAction, startAttemptAction, type ActivityContext } from "@/lib/actions/attempts";
import type { BankQuestion } from "@/lib/data/attempts";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { ActivityMode, PushedActivity, PushInput, StudentSubmission } from "@/lib/practice/activity-channel";
import { formatMark, type AttemptQuestionRow, type AttemptStatus, type LiveAttempt } from "@/lib/practice/attempts";
import type { McqOption, Question, Response } from "@/lib/practice/model";
import { OTR_BANDS } from "@/lib/reports/mvapp-template";
import { cn } from "@/lib/utils";

// ============================================================================
// The lesson-room side panel. The host composes a quick check from the course's
// approved questions (or a one-off they write here, saved as a draft) and
// sends it; then watches live_attempts for the student's answers. The student
// runs the attempt here, inline, through the same RPCs as at-home practice.
// The oral check stays in the panel and goes to lesson_events as
// quick_check_result {name, score, out_of, otr}.
// ============================================================================

/** Kept for the room's prop: the question source is now the course's bank, read here. */
export interface ActivitySet {
  id: string;
  title: string;
  topic_label?: string | null;
  questions: Question[];
}

export function ActivityPanel({
  isTeacher,
  activity,
  onPush,
  onClose,
  onDismiss,
  peerName,
}: {
  isTeacher: boolean;
  /** Unused: the panel reads the course's questions itself. */
  sets?: ActivitySet[];
  activity: PushedActivity | null;
  /** Unused: marks are read from the database. */
  submission?: StudentSubmission | null;
  released?: { marks: StudentSubmission["marks"]; score: number; max: number } | null;
  onPush: (input: PushInput & { mode: ActivityMode; time_limit_s: number | null }) => void | Promise<unknown>;
  onSubmit?: (responses: Record<string, Response | null>, marks: StudentSubmission["marks"]) => void;
  onRespond?: (questionId: string, response: Response) => void;
  onRelease?: () => void;
  onClose: () => void;
  onDismiss: () => void;
  peerName: string;
}) {
  const params = useParams<{ sessionId?: string }>();
  const sessionId = params?.sessionId ?? "";

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
        {!sessionId ? (
          <p className="text-sm text-destructive">This panel only works inside a lesson room.</p>
        ) : isTeacher ? (
          <div className="space-y-6">
            {activity ? (
              <TeacherLive sessionId={sessionId} activity={activity} peerName={peerName} onClose={onClose} />
            ) : (
              <TeacherCompose sessionId={sessionId} onPush={onPush} />
            )}
            <OralCheck sessionId={sessionId} peerName={peerName} />
          </div>
        ) : activity ? (
          <StudentActivity key={activity.id} activity={activity} />
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

// --- host: compose -------------------------------------------------------------------------

function TeacherCompose({ sessionId, onPush }: { sessionId: string; onPush: (input: PushInput & { mode: ActivityMode; time_limit_s: number | null }) => void | Promise<unknown> }) {
  const [ctx, setCtx] = useState<ActivityContext | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [title, setTitle] = useState("Quick check");
  const [writing, setWriting] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    activityContextAction(sessionId)
      .then((c) => !cancelled && setCtx(c))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "The course's questions could not be loaded."));
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const chosen = useMemo(() => (ctx ? ctx.questions.filter((q) => picked.has(q.id)).map((q) => q.question) : []), [ctx, picked]);

  if (error) {
    return (
      <p className="flex items-start gap-2 text-sm text-destructive" role="alert">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
      </p>
    );
  }
  if (!ctx) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading the course&rsquo;s questions…
      </p>
    );
  }

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function send() {
    setSending(true);
    try {
      await onPush({ title: title.trim() || "Quick check", mode: "practice", questions: chosen, time_limit_s: null });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor="qc-title">
          Quick check for {ctx.studentName}
        </label>
        <Input id="qc-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} />
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between text-xs font-medium text-muted-foreground">
          <span>Questions on this course</span>
          <span>{picked.size} picked</span>
        </div>
        {ctx.questions.length === 0 ? (
          <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">No approved questions on this course yet. Write a one-off below, or add questions in the question bank.</p>
        ) : (
          <ul className="max-h-64 space-y-1 overflow-y-auto">
            {ctx.questions.map((q, i) => {
              const on = picked.has(q.id);
              return (
                <li key={q.id}>
                  <button type="button" onClick={() => toggle(q.id)} className={cn("flex w-full items-start gap-2 rounded-md border px-2 py-1.5 text-left text-sm", on ? "border-primary/50 bg-primary/5" : "hover:bg-secondary")}>
                    <span className={cn("mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border", on && "border-primary bg-primary text-primary-foreground")}>{on && <Check className="h-3 w-3" />}</span>
                    <span className="min-w-0 flex-1">
                      <span className="mr-1 text-xs text-muted-foreground">{i + 1}.</span>
                      <MathMarkdown source={q.question.stem.split("\n")[0] ?? ""} inline />
                    </span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {q.question.type}
                      {q.status === "draft" ? " · draft" : ""}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {writing ? (
        <OneOffForm
          sessionId={sessionId}
          onAdded={(q) => {
            setCtx((c) => (c ? { ...c, questions: [...c.questions, q] } : c));
            setPicked((p) => new Set(p).add(q.id));
            setWriting(false);
          }}
          onCancel={() => setWriting(false)}
        />
      ) : (
        <Button variant="outline" size="sm" className="w-full" onClick={() => setWriting(true)}>
          <PenLine className="h-4 w-4" /> Write a one-off question
        </Button>
      )}

      <p className="text-xs text-muted-foreground">The student checks each answer as they go and sees the solutions when they finish.</p>
      <Button className="w-full" disabled={chosen.length === 0 || sending} onClick={() => void send()}>
        {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send {chosen.length} question{chosen.length === 1 ? "" : "s"}
      </Button>
    </div>
  );
}

const KEYS = ["A", "B", "C", "D"] as const;

/** A one-off mcq or numeric question, saved as a draft on the course through upsert_question. */
function OneOffForm({ sessionId, onAdded, onCancel }: { sessionId: string; onAdded: (q: BankQuestion) => void; onCancel: () => void }) {
  const [type, setType] = useState<"mcq" | "numeric">("mcq");
  const [stem, setStem] = useState("");
  const [options, setOptions] = useState<Record<(typeof KEYS)[number], string>>({ A: "", B: "", C: "", D: "" });
  const [answerKey, setAnswerKey] = useState<(typeof KEYS)[number] | null>(null);
  const [answer, setAnswer] = useState("");
  const [unit, setUnit] = useState("");
  const [marks, setMarks] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const filled: McqOption[] = KEYS.filter((k) => options[k].trim()).map((k) => ({ key: k, text: options[k].trim() }));
  const ready = stem.trim().length > 0 && (type === "mcq" ? filled.length >= 2 && answerKey != null && options[answerKey].trim().length > 0 : answer.trim().length > 0 && Number.isFinite(Number(answer)));

  async function add() {
    setSaving(true);
    setError(null);
    try {
      const q = await addOneOffQuestionAction(sessionId, type === "mcq" ? { type, stem: stem.trim(), options: filled, answer: answerKey!, marks } : { type, stem: stem.trim(), answer: Number(answer), unit: unit.trim() || null, marks });
      onAdded(q);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The question could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="text-xs font-medium text-muted-foreground">One-off question (saved as a draft on the course)</div>
      <ChipRow options={[{ value: "mcq", label: "Multiple choice" }, { value: "numeric", label: "Numeric" }]} value={type} onChange={(v) => setType(v as "mcq" | "numeric")} />
      <Textarea value={stem} onChange={(e) => setStem(e.target.value)} placeholder="The question — Markdown and $LaTeX$ work here" rows={3} />
      {type === "mcq" ? (
        <div className="space-y-1.5">
          {KEYS.map((k) => (
            <div key={k} className="flex items-center gap-2">
              <button type="button" onClick={() => setAnswerKey(k)} title={`${k} is the answer`} className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold", answerKey === k && "border-success bg-success text-success-foreground")}>
                {k}
              </button>
              <Input value={options[k]} onChange={(e) => setOptions((o) => ({ ...o, [k]: e.target.value }))} placeholder={`Option ${k}`} className="h-8" />
            </div>
          ))}
          <p className="text-[11px] text-muted-foreground">Tap the letter of the correct option.</p>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Input inputMode="decimal" value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Answer" className="h-8 w-28" />
          <Input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="Unit (optional)" className="h-8 w-32" />
        </div>
      )}
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Marks</span>
        <ChipRow options={[1, 2, 3].map((n) => ({ value: String(n), label: String(n) }))} value={String(marks)} onChange={(v) => setMarks(Number(v))} />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button size="sm" onClick={() => void add()} disabled={!ready || saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Add to this check
        </Button>
      </div>
    </div>
  );
}

function ChipRow({ options, value, onChange }: { options: { value: string; label: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup">
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)} className={cn("rounded-full border px-2.5 py-1 text-xs", value === o.value ? "border-primary bg-primary/10 text-primary" : "hover:bg-secondary")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

// --- host: live view ---------------------------------------------------------------------------

const LIVE_POLL_MS = 10_000;
const DEMO_POLL_MS = 5_000;

/** live_attempts(p_session_id), refreshed by postgres_changes on practice_attempts for this session; a 5 s poll in demo mode. */
function useLiveAttempts(sessionId: string): { attempts: LiveAttempt[]; error: string | null } {
  const [attempts, setAttempts] = useState<LiveAttempt[]>([]);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(() => {
    liveAttemptsAction(sessionId)
      .then((rows) => {
        setAttempts(rows);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "The live attempts could not be read."));
  }, [sessionId]);

  useEffect(() => {
    refresh();
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      const id = setInterval(refresh, DEMO_POLL_MS);
      return () => clearInterval(id);
    }
    const channel = supabase
      .channel(`live-attempts:${sessionId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "practice_attempts", filter: `session_id=eq.${sessionId}` }, () => refresh())
      .subscribe();
    // Answers land on practice_answers, which the subscription does not carry: a slow poll keeps the count honest.
    const id = setInterval(refresh, LIVE_POLL_MS);
    return () => {
      clearInterval(id);
      void supabase.removeChannel(channel);
    };
  }, [sessionId, refresh]);

  return { attempts, error };
}

function TeacherLive({ sessionId, activity, peerName, onClose }: { sessionId: string; activity: PushedActivity; peerName: string; onClose: () => void }) {
  const { attempts, error } = useLiveAttempts(sessionId);
  const attempt = attempts.find((a) => a.set_id === activity.set_id) ?? null;
  const byQuestion = new Map((attempt?.answers ?? []).map((a) => [a.question_id, a]));
  const done = attempt != null && attempt.status !== "in_progress";

  return (
    <div className="space-y-4">
      <div>
        <div className="text-sm font-semibold">{activity.title}</div>
        <div className="text-xs text-muted-foreground">
          Quick check · {activity.questions.length} question{activity.questions.length === 1 ? "" : "s"} · sent to {peerName}
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {!attempt ? (
        <div className="flex items-center gap-2 rounded-md border border-dashed p-3 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Waiting for {peerName} to open it…
        </div>
      ) : (
        <div className="space-y-2">
          <div className="rounded-md bg-secondary/60 p-3 text-sm">
            {done ? (
              <>
                <span className="font-semibold">
                  {formatMark(attempt.score ?? 0)}/{formatMark(attempt.out_of ?? 0)}
                </span>{" "}
                {attempt.status === "submitted" ? "· a worked answer waits for your mark" : "auto-marked"}
              </>
            ) : (
              <>
                <span className="font-semibold">
                  {attempt.answers.length}/{activity.questions.length}
                </span>{" "}
                answered so far
              </>
            )}
          </div>
          <ul className="space-y-1.5">
            {activity.questions.map((q, i) => {
              const a = byQuestion.get(q.id);
              const tone = !a ? "bg-muted-foreground/40" : a.is_correct === true ? "bg-success" : a.is_correct === false ? ((a.marks_awarded ?? 0) > 0 ? "bg-warning" : "bg-destructive") : "bg-primary/50";
              return (
                <li key={q.id} className="flex items-start gap-2 rounded-md border px-2 py-1.5 text-sm">
                  <span className={cn("mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full", tone)} />
                  <span className="min-w-0 flex-1">
                    <span className="mr-1 text-xs text-muted-foreground">{i + 1}.</span>
                    <MathMarkdown source={q.stem.split("\n")[0] ?? ""} inline />
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">{a ? (a.marks_awarded != null ? `${formatMark(a.marks_awarded)}/${formatMark(q.marks)}` : "to mark") : "—"}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <Button size="sm" variant="outline" onClick={onClose}>
        {done ? "Done" : "Cancel"}
      </Button>
    </div>
  );
}

// --- host: the oral check ----------------------------------------------------------------------

const OUT_OF_OPTIONS = [5, 10, 20];

function OralCheck({ sessionId, peerName }: { sessionId: string; peerName: string }) {
  const [name, setName] = useState("Oral check");
  const [outOf, setOutOf] = useState(10);
  const [score, setScore] = useState<number | null>(null);
  const [otr, setOtr] = useState<number | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  async function record() {
    if (score == null) return;
    setSaving(true);
    const res = await recordOralCheckAction(sessionId, { name: name.trim() || "Oral check", score, out_of: outOf, otr });
    setMessage({ ok: res.ok, text: res.message });
    setSaving(false);
    if (res.ok) setScore(null);
  }

  return (
    <div className="space-y-3 border-t pt-4">
      <div className="flex items-center gap-1.5 text-sm font-semibold">
        <Mic className="h-4 w-4 text-primary" /> Oral check
      </div>
      <p className="text-xs text-muted-foreground">Ask {peerName} out loud and record the result; it goes on the lesson for the report.</p>
      <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} aria-label="Name" className="h-8" />
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Out of</span>
        <ChipRow
          options={OUT_OF_OPTIONS.map((n) => ({ value: String(n), label: String(n) }))}
          value={String(outOf)}
          onChange={(v) => {
            setOutOf(Number(v));
            setScore(null);
          }}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Select value={score == null ? "" : String(score)} onValueChange={(v) => setScore(Number(v))}>
          <SelectTrigger aria-label="Score" className="h-8">
            <SelectValue placeholder="Score" />
          </SelectTrigger>
          <SelectContent>
            {Array.from({ length: outOf + 1 }, (_, i) => outOf - i).map((n) => (
              <SelectItem key={n} value={String(n)}>
                {n} / {outOf}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={otr == null ? "none" : String(otr)} onValueChange={(v) => setOtr(v === "none" ? null : Number(v))}>
          <SelectTrigger aria-label="Oral test band" className="h-8">
            <SelectValue placeholder="OTR band" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No OTR band</SelectItem>
            {OTR_BANDS.map((b) => (
              <SelectItem key={b.lower} value={String(b.lower)}>
                {b.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {message && <p className={cn("text-xs", message.ok ? "text-success" : "text-destructive")}>{message.text}</p>}
      <Button size="sm" variant="outline" className="w-full" disabled={score == null || saving} onClick={() => void record()}>
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Record oral check
      </Button>
    </div>
  );
}

// --- student ------------------------------------------------------------------------------------

function StudentActivity({ activity }: { activity: PushedActivity }) {
  const [loaded, setLoaded] = useState<{ attemptId: string; questions: AttemptQuestionRow[]; imageUrls: Record<string, string>; status: AttemptStatus; title: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      try {
        const { attemptId } = await startAttemptAction(activity.id);
        const data = await loadAttemptAction(attemptId);
        setLoaded({ attemptId, questions: data.questions, imageUrls: data.imageUrls, status: data.row?.attempt_status ?? "in_progress", title: data.row?.set_title ?? activity.title });
      } catch (e) {
        setError(e instanceof Error ? e.message : "The quick check could not be opened.");
      }
    })();
  }, [activity.id, activity.title]);

  if (error) {
    return (
      <p className="flex items-start gap-2 text-sm text-destructive" role="alert">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
      </p>
    );
  }
  if (!loaded) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Opening {activity.title}…
      </p>
    );
  }
  return <AttemptRunner attemptId={loaded.attemptId} kind="quick_check" title={loaded.title} initialQuestions={loaded.questions} imageUrls={loaded.imageUrls} initialStatus={loaded.status} compact />;
}
