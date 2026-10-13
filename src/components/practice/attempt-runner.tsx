"use client";

import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, ChevronLeft, ChevronRight, Clock, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { QuestionCard } from "@/components/practice/question-card";
import { answerQuestionAction, loadAttemptAction, submitAttemptAction } from "@/lib/actions/attempts";
import { formatMark, toMarkResult, toQuestion, toResponse, verdictToMark, type AttemptQuestionRow, type AttemptStatus, type PracticeKind, type SubmitResult } from "@/lib/practice/attempts";
import type { MarkResult, Question, Response } from "@/lib/practice/model";
import { cn } from "@/lib/utils";

// ============================================================================
// Runs one practice_attempts row through mv-app's RPCs. Every answer is saved
// with answer_question, which marks it and says correct / incorrect / pending
// review — and never what the answer was. A practice or quick check keeps the
// old runner's rhythm (a list, "Check answer" per question); a test shows one
// question at a time and keeps every verdict until the end. Submitting asks
// first, then submit_attempt totals the attempt and attempt_questions is read
// again, this time with the answers and worked solutions the set allows.
// ============================================================================

export interface AttemptRunnerHandle {
  /** Submit without asking (the test timer ran out). */
  submitNow: () => Promise<void>;
  /** How many of the questions have an answer. */
  answeredCount: () => number;
}

export interface AttemptRunnerProps {
  attemptId: string;
  kind: PracticeKind;
  title?: string;
  initialQuestions: AttemptQuestionRow[];
  imageUrls?: Record<string, string>;
  initialStatus: AttemptStatus;
  /** The test runner's integrity summary, sent with submit_attempt. */
  integritySummary?: () => Record<string, unknown> | null;
  /** Nothing can be changed while true (the test is paused). */
  locked?: boolean;
  onSubmitted?: (result: SubmitResult) => void;
  /** Worked questions: the lesson notebook holds the working. */
  onAttachNotebook?: (questionId: string) => void;
  /** Tighter spacing for a side panel. */
  compact?: boolean;
}

export const AttemptRunner = forwardRef<AttemptRunnerHandle, AttemptRunnerProps>(function AttemptRunner(
  { attemptId, kind, title, initialQuestions, imageUrls, initialStatus, integritySummary, locked, onSubmitted, onAttachNotebook, compact },
  ref,
) {
  const isTest = kind === "test";
  const [rows, setRows] = useState<AttemptQuestionRow[]>(initialQuestions);
  const [status, setStatus] = useState<AttemptStatus>(initialStatus);
  const [responses, setResponses] = useState<Record<string, Response | null>>(() => responsesFrom(initialQuestions));
  const [marks, setMarks] = useState<Record<string, MarkResult>>(() => marksFrom(initialQuestions, initialStatus, isTest));
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [cursor, setCursor] = useState(0);
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const dirty = useRef(new Set<string>());
  const inflight = useRef(new Map<string, Promise<MarkResult | null>>());
  const responsesRef = useRef(responses);
  responsesRef.current = responses;

  const questions = useMemo<Question[]>(() => rows.map((r) => toQuestion(r, r.image_path ? (imageUrls?.[r.image_path] ?? null) : null)), [rows, imageUrls]);
  const submitted = status !== "in_progress";
  const answered = useMemo(() => questions.filter((q) => isAnswered(responses[q.id] ?? null)).length, [questions, responses]);

  // One save per question at a time: a "Check answer" right after typing joins the blur's save instead of racing it.
  const save = useCallback(
    (q: Question): Promise<MarkResult | null> => {
      const running = inflight.current.get(q.id);
      if (running) return running;
      const r = responsesRef.current[q.id] ?? null;
      if (!r || !isAnswered(r)) return Promise.resolve(null);
      setSaving((s) => ({ ...s, [q.id]: true }));
      const p = (async () => {
        try {
          const verdict = await answerQuestionAction(attemptId, q.id, r);
          dirty.current.delete(q.id);
          setError(null);
          return verdictToMark(verdict, q.marks);
        } catch (e) {
          setError(e instanceof Error ? e.message : "Your answer could not be saved.");
          return null;
        } finally {
          inflight.current.delete(q.id);
          setSaving((s) => ({ ...s, [q.id]: false }));
        }
      })();
      inflight.current.set(q.id, p);
      return p;
    },
    [attemptId],
  );

  const flushDirty = useCallback(async () => {
    const pending = questions.filter((q) => dirty.current.has(q.id));
    for (const q of pending) await save(q);
  }, [questions, save]);

  const setResponse = useCallback(
    (q: Question, r: Response) => {
      setResponses((prev) => ({ ...prev, [q.id]: r }));
      dirty.current.add(q.id);
      if (!isTest) setMarks((prev) => (prev[q.id] ? omit(prev, q.id) : prev));
      // A pick is saved at once; typed text waits for the field to blur or the page to move on.
      if (r.type === "mcq" || r.type === "multi_select") {
        responsesRef.current = { ...responsesRef.current, [q.id]: r };
        if (isTest) void save(q);
      }
    },
    [isTest, save],
  );

  const check = useCallback(
    async (q: Question) => {
      const mark = await save(q);
      if (mark) setMarks((prev) => ({ ...prev, [q.id]: mark }));
    },
    [save],
  );

  const finish = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    try {
      await flushDirty();
      const res = await submitAttemptAction(attemptId, integritySummary?.() ?? null);
      const loaded = await loadAttemptAction(attemptId);
      setRows(loaded.questions);
      setResponses(responsesFrom(loaded.questions));
      setMarks(marksFrom(loaded.questions, res.status, false));
      setStatus(res.status);
      setResult(res);
      setConfirm(false);
      onSubmitted?.(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The attempt could not be submitted.");
    } finally {
      setSubmitting(false);
    }
  }, [attemptId, flushDirty, integritySummary, onSubmitted]);

  useImperativeHandle(ref, () => ({ submitNow: finish, answeredCount: () => answered }), [finish, answered]);

  const onePerPage = isTest && !submitted;
  const visible = onePerPage ? [questions[cursor]].filter(Boolean) : questions;
  const move = async (next: number) => {
    const current = questions[cursor];
    if (current && dirty.current.has(current.id)) await save(current);
    setCursor(Math.max(0, Math.min(questions.length - 1, next)));
  };

  const pendingReview = rows.filter((r) => submitted && r.type === "worked" && r.response && r.is_correct == null).length;

  return (
    <div className={cn("space-y-4", compact && "space-y-3")}>
      {(title || onePerPage) && (
        <div className="flex items-center justify-between gap-3">
          {title && <h2 className={cn("font-semibold", compact ? "text-sm" : "text-base")}>{title}</h2>}
          {!submitted && (
            <span className="text-xs text-muted-foreground">
              {answered}/{questions.length} answered
            </span>
          )}
        </div>
      )}

      {submitted && (
        <div className="rounded-xl border bg-card p-4 text-sm shadow-sm">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="inline-flex items-center gap-1.5 font-semibold text-success">
              <CheckCircle2 className="h-4 w-4" /> Submitted
            </span>
            <span className="text-base font-semibold tabular-nums">
              {formatMark(result?.score ?? scoreFrom(rows))}/{formatMark(result?.out_of ?? outOfFrom(rows))}
            </span>
            {pendingReview > 0 && (
              <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                <Clock className="h-4 w-4" /> {pendingReview} answer{pendingReview > 1 ? "s" : ""} waiting to be marked
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {rows.some((r) => r.worked_solution || r.answer != null) ? "The answers and worked solutions are shown below." : "Your teacher will go through the answers with you."}
          </p>
        </div>
      )}

      {onePerPage && (
        <ol className="flex flex-wrap gap-1" aria-label="Questions">
          {questions.map((q, i) => (
            <li key={q.id}>
              <button
                type="button"
                onClick={() => void move(i)}
                disabled={locked}
                className={cn(
                  "h-7 min-w-7 rounded-md border px-1.5 text-xs tabular-nums",
                  i === cursor ? "border-primary bg-primary text-primary-foreground" : isAnswered(responses[q.id] ?? null) ? "bg-secondary" : "",
                )}
                aria-current={i === cursor ? "step" : undefined}
              >
                {i + 1}
              </button>
            </li>
          ))}
        </ol>
      )}

      {visible.map((q) => {
        const index = questions.indexOf(q);
        const row = rows[index]!;
        const mark = marks[q.id] ?? null;
        const checked = Boolean(mark) && mark!.status !== "unanswered";
        const showSolution = submitted && (row.worked_solution != null || row.answer != null);
        return (
          <div key={q.id} className="space-y-2" onBlur={() => dirty.current.has(q.id) && (responses[q.id]?.type === "numeric" || responses[q.id]?.type === "short" || responses[q.id]?.type === "worked") && void save(q)}>
            <QuestionCard
              question={q}
              index={index}
              response={responses[q.id] ?? null}
              onChange={(r) => setResponse(q, r)}
              result={isTest && !submitted ? null : mark}
              disabled={submitted || submitting || locked || (!isTest && checked && mark!.status !== "pending_review")}
              showSolution={showSolution}
              onAttachNotebook={
                onAttachNotebook && q.type === "worked"
                  ? () => {
                      const prev = responses[q.id];
                      setResponse(q, { type: "worked", final_answer: prev?.type === "worked" ? prev.final_answer : null, evidence: [{ kind: "notebook_page", ref: `attempt:${attemptId}:${q.id}` }] });
                      onAttachNotebook(q.id);
                    }
                  : undefined
              }
              attaching={saving[q.id]}
            />
            {!isTest && !submitted && !checked && (
              <div className="flex items-center justify-end gap-2">
                {saving[q.id] && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                <Button size="sm" variant="outline" onClick={() => void check(q)} disabled={!isAnswered(responses[q.id] ?? null) || locked}>
                  Check answer
                </Button>
              </div>
            )}
          </div>
        );
      })}

      {error && (
        <p className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </p>
      )}

      {!submitted && (
        <div className="flex items-center justify-between gap-3 border-t pt-3">
          {onePerPage ? (
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => void move(cursor - 1)} disabled={cursor === 0 || locked}>
                <ChevronLeft className="h-4 w-4" /> Previous
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void move(cursor + 1)} disabled={cursor >= questions.length - 1 || locked}>
                Next <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <span />
          )}
          <Button onClick={() => setConfirm(true)} disabled={submitting || locked || answered === 0}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {isTest ? "Submit test" : "Finish practice"}
          </Button>
        </div>
      )}

      <Dialog open={confirm} onOpenChange={(o) => !submitting && setConfirm(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{isTest ? "Submit the test?" : "Finish this practice?"}</DialogTitle>
            <DialogDescription>
              You have answered {answered} of {questions.length} question{questions.length === 1 ? "" : "s"}.
              {answered < questions.length ? " Unanswered questions score nothing." : ""} Nothing can be changed after this.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirm(false)} disabled={submitting}>
              Keep going
            </Button>
            <Button onClick={() => void finish()} disabled={submitting}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {isTest ? "Submit test" : "Finish and see the answers"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
});

function responsesFrom(rows: AttemptQuestionRow[]): Record<string, Response | null> {
  const out: Record<string, Response | null> = {};
  for (const r of rows) out[r.id] = toResponse(r);
  return out;
}

/** Marks to show on load: everything once submitted; in a practice only what was already checked; in a test nothing. */
function marksFrom(rows: AttemptQuestionRow[], status: AttemptStatus, isTest: boolean): Record<string, MarkResult> {
  const out: Record<string, MarkResult> = {};
  if (status === "in_progress" && isTest) return out;
  for (const r of rows) {
    const m = toMarkResult(r);
    if (m) out[r.id] = m;
  }
  return out;
}

function scoreFrom(rows: AttemptQuestionRow[]): number {
  return Math.round(rows.reduce((s, r) => s + (r.marks_awarded ?? 0), 0) * 100) / 100;
}

function outOfFrom(rows: AttemptQuestionRow[]): number {
  return rows.reduce((s, r) => s + (Number(r.marks) || 0), 0);
}

export function isAnswered(r: Response | null): boolean {
  if (!r) return false;
  switch (r.type) {
    case "mcq":
      return Boolean(r.key);
    case "multi_select":
      return r.keys.length > 0;
    case "numeric":
    case "short":
      return r.text.trim().length > 0;
    case "worked":
      return r.evidence.length > 0 || Boolean(r.final_answer?.trim());
  }
}

function omit<T extends Record<string, unknown>>(obj: T, key: string): T {
  const next = { ...obj };
  delete next[key];
  return next;
}
