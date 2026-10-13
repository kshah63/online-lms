"use client";

// ============================================================================
// In-lesson activities: the teacher pushes a quick check, a practice set or a
// short test into the room; the student answers in a side panel (or on the
// notebook for worked questions); the teacher watches results live.
//
// Transport is Supabase Realtime broadcast on the lesson's channel when a
// project is configured; otherwise the browser's BroadcastChannel, which
// makes the whole flow work across two tabs in demo mode and in tests.
// Persistence (attempts, marks) is the caller's: see onSubmitted.
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { markSet } from "@/lib/practice/marking";
import type { MarkResult, Question, Response } from "@/lib/practice/model";

export type ActivityMode = "practice" | "test";

export interface PushedActivity {
  id: string;
  title: string;
  mode: ActivityMode;
  questions: Question[];
  time_limit_s: number | null;
  pushed_at: string;
}

export type ActivityMessage =
  | { kind: "activity.hello"; from: string; role: "teacher" | "student" }
  | { kind: "activity.push"; activity: PushedActivity }
  | { kind: "activity.response"; activity_id: string; question_id: string; response: Response; from: string }
  | { kind: "activity.submit"; activity_id: string; responses: Record<string, Response | null>; from: string; submitted_at: string }
  | { kind: "activity.release"; activity_id: string; marks: Record<string, MarkResult>; score: number; max: number }
  | { kind: "activity.close"; activity_id: string };

export interface ActivityTransport {
  send(msg: ActivityMessage): void;
  subscribe(handler: (msg: ActivityMessage) => void): () => void;
  close(): void;
}

export function createActivityTransport(sessionId: string): ActivityTransport {
  const supabase = createSupabaseBrowserClient();
  const name = `lesson-activity:${sessionId}`;

  if (supabase) {
    const channel = supabase.channel(name, { config: { broadcast: { self: false } } });
    const handlers = new Set<(m: ActivityMessage) => void>();
    channel.on("broadcast", { event: "activity" }, ({ payload }) => {
      for (const h of handlers) h(payload as ActivityMessage);
    });
    channel.subscribe();
    return {
      send: (msg) => void channel.send({ type: "broadcast", event: "activity", payload: msg }),
      subscribe: (h) => {
        handlers.add(h);
        return () => handlers.delete(h);
      },
      close: () => void supabase.removeChannel(channel),
    };
  }

  if (typeof BroadcastChannel !== "undefined") {
    const bc = new BroadcastChannel(name);
    const handlers = new Set<(m: ActivityMessage) => void>();
    bc.onmessage = (e) => {
      for (const h of handlers) h(e.data as ActivityMessage);
    };
    return {
      send: (msg) => bc.postMessage(msg),
      subscribe: (h) => {
        handlers.add(h);
        return () => handlers.delete(h);
      },
      close: () => bc.close(),
    };
  }

  return { send: () => undefined, subscribe: () => () => undefined, close: () => undefined };
}

export interface StudentSubmission {
  from: string;
  responses: Record<string, Response | null>;
  marks: Record<string, MarkResult>;
  score: number;
  max: number;
  pending: number;
  submitted_at: string;
}

export interface UseLessonActivityArgs {
  sessionId: string;
  selfId: string;
  role: "teacher" | "student";
  /** Teacher side: called when a student submits (persist the attempt here). */
  onSubmitted?: (activity: PushedActivity, submission: StudentSubmission) => void;
  /** Student side: called when an activity arrives (so the room can open the panel). */
  onActivity?: (activity: PushedActivity) => void;
}

export function useLessonActivity({ sessionId, selfId, role, onSubmitted, onActivity }: UseLessonActivityArgs) {
  const transportRef = useRef<ActivityTransport | null>(null);
  const [activity, setActivity] = useState<PushedActivity | null>(null);
  const [liveResponses, setLiveResponses] = useState<Record<string, Response>>({});
  const [submission, setSubmission] = useState<StudentSubmission | null>(null);
  const [released, setReleased] = useState<{ marks: Record<string, MarkResult>; score: number; max: number } | null>(null);
  const activityRef = useRef<PushedActivity | null>(null);
  activityRef.current = activity;
  const callbacks = useRef({ onSubmitted, onActivity });
  callbacks.current = { onSubmitted, onActivity };

  useEffect(() => {
    const t = createActivityTransport(sessionId);
    transportRef.current = t;
    const unsub = t.subscribe((msg) => {
      switch (msg.kind) {
        case "activity.hello":
          // A late joiner asks what is on; the teacher re-sends the current activity.
          if (role === "teacher" && activityRef.current) t.send({ kind: "activity.push", activity: activityRef.current });
          break;
        case "activity.push":
          if (role === "student") {
            setActivity(msg.activity);
            setSubmission(null);
            setReleased(null);
            setLiveResponses({});
            callbacks.current.onActivity?.(msg.activity);
          }
          break;
        case "activity.response":
          if (role === "teacher" && msg.activity_id === activityRef.current?.id) {
            setLiveResponses((prev) => ({ ...prev, [msg.question_id]: msg.response }));
          }
          break;
        case "activity.submit": {
          const act = activityRef.current;
          if (role === "teacher" && act && msg.activity_id === act.id) {
            const set = markSet(act.questions.map((q) => ({ question: q, response: msg.responses[q.id] ?? null })));
            const marks: Record<string, MarkResult> = {};
            act.questions.forEach((q, i) => (marks[q.id] = set.results[i]!));
            const sub: StudentSubmission = { from: msg.from, responses: msg.responses, marks, score: set.score, max: set.max, pending: set.pending, submitted_at: msg.submitted_at };
            setSubmission(sub);
            callbacks.current.onSubmitted?.(act, sub);
          }
          break;
        }
        case "activity.release":
          if (role === "student" && msg.activity_id === activityRef.current?.id) setReleased({ marks: msg.marks, score: msg.score, max: msg.max });
          break;
        case "activity.close":
          if (msg.activity_id === activityRef.current?.id) {
            setActivity(null);
            setSubmission(null);
            setReleased(null);
            setLiveResponses({});
          }
          break;
      }
    });
    t.send({ kind: "activity.hello", from: selfId, role });
    return () => {
      unsub();
      t.close();
      transportRef.current = null;
    };
  }, [sessionId, selfId, role]);

  const push = useCallback((input: Omit<PushedActivity, "id" | "pushed_at">) => {
    const act: PushedActivity = { ...input, id: crypto.randomUUID(), pushed_at: new Date().toISOString() };
    setActivity(act);
    setSubmission(null);
    setReleased(null);
    setLiveResponses({});
    transportRef.current?.send({ kind: "activity.push", activity: act });
    return act;
  }, []);

  const respond = useCallback(
    (question_id: string, response: Response) => {
      if (!activityRef.current) return;
      transportRef.current?.send({ kind: "activity.response", activity_id: activityRef.current.id, question_id, response, from: selfId });
    },
    [selfId],
  );

  const submit = useCallback(
    (responses: Record<string, Response | null>, marks: Record<string, MarkResult>) => {
      const act = activityRef.current;
      if (!act) return;
      const set = markSet(act.questions.map((q) => ({ question: q, response: responses[q.id] ?? null })));
      setSubmission({ from: selfId, responses, marks, score: set.score, max: set.max, pending: set.pending, submitted_at: new Date().toISOString() });
      transportRef.current?.send({ kind: "activity.submit", activity_id: act.id, responses, from: selfId, submitted_at: new Date().toISOString() });
    },
    [selfId],
  );

  const release = useCallback(() => {
    const act = activityRef.current;
    if (!act || !submission) return;
    setReleased({ marks: submission.marks, score: submission.score, max: submission.max });
    transportRef.current?.send({ kind: "activity.release", activity_id: act.id, marks: submission.marks, score: submission.score, max: submission.max });
  }, [submission]);

  const close = useCallback(() => {
    const act = activityRef.current;
    if (!act) return;
    transportRef.current?.send({ kind: "activity.close", activity_id: act.id });
    setActivity(null);
    setSubmission(null);
    setReleased(null);
    setLiveResponses({});
  }, []);

  return useMemo(
    () => ({ activity, liveResponses, submission, released, push, respond, submit, release, close }),
    [activity, liveResponses, submission, released, push, respond, submit, release, close],
  );
}
