"use client";

// ============================================================================
// In-lesson activities, on mv-app's practice RPCs. The host picks questions and
// sends a quick check: create_practice_set(kind quick_check, p_session_id) and
// assign_practice(in_session) for the session's student — both through server
// actions. What travels on the lesson's broadcast channel is only a NUDGE
// carrying the assignment id (and the title, for the dot in the header): the
// student's panel then starts the attempt and runs it against the database,
// and the host watches live_attempts. A late joiner says hello and the host
// re-sends the nudge; a student who missed both finds the assignment by a
// slow poll of their own practice_assignments for the session.
//
// Transport is Supabase Realtime broadcast when a project is configured;
// otherwise the browser's BroadcastChannel, which carries the nudge across two
// tabs in demo mode.
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { myOpenActivityAction, pushQuickCheckAction } from "@/lib/actions/attempts";
import { canOpen } from "@/lib/practice/attempts";
import type { MarkResult, Question, Response } from "@/lib/practice/model";

export type ActivityMode = "practice" | "test";

/** The current in-lesson activity: a practice_assignments row the room knows about. */
export interface PushedActivity {
  /** The assignment id. */
  id: string;
  set_id: string;
  title: string;
  mode: ActivityMode;
  /** The host's picked questions (the student's panel reads its own copy through attempt_questions). */
  questions: Question[];
  time_limit_s: number | null;
  pushed_at: string;
}

export type ActivityMessage =
  | { kind: "activity.hello"; from: string; role: "teacher" | "student" }
  | { kind: "activity.push"; assignment_id: string; set_id: string; title: string; question_count: number; pushed_at: string }
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

/**
 * Kept for the room's prop contract: the panel now reads marks from the
 * database (live_attempts, attempt_questions), so nothing fills this any more.
 */
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
  /** Unused since marks live in the database; kept so the room's call site type-checks. */
  onSubmitted?: (activity: PushedActivity, submission: StudentSubmission) => void;
  /** Student side: called when an activity arrives (so the room can open the panel). */
  onActivity?: (activity: PushedActivity) => void;
}

export interface PushInput {
  title: string;
  questions: Question[];
  mode?: ActivityMode;
  time_limit_s?: number | null;
}

const LATE_JOINER_POLL_MS = 15_000;

export function useLessonActivity({ sessionId, selfId, role, onSubmitted, onActivity }: UseLessonActivityArgs) {
  const transportRef = useRef<ActivityTransport | null>(null);
  const [activity, setActivity] = useState<PushedActivity | null>(null);
  const [pushError, setPushError] = useState<string | null>(null);
  const activityRef = useRef<PushedActivity | null>(null);
  activityRef.current = activity;
  const callbacks = useRef({ onSubmitted, onActivity });
  callbacks.current = { onSubmitted, onActivity };

  const arrive = useCallback((next: PushedActivity) => {
    if (activityRef.current?.id === next.id) return;
    setActivity(next);
    callbacks.current.onActivity?.(next);
  }, []);

  useEffect(() => {
    const t = createActivityTransport(sessionId);
    transportRef.current = t;
    const unsub = t.subscribe((msg) => {
      switch (msg.kind) {
        case "activity.hello": {
          const act = activityRef.current;
          if (role === "teacher" && act) t.send({ kind: "activity.push", assignment_id: act.id, set_id: act.set_id, title: act.title, question_count: act.questions.length, pushed_at: act.pushed_at });
          break;
        }
        case "activity.push":
          if (role === "student") arrive({ id: msg.assignment_id, set_id: msg.set_id, title: msg.title, mode: "practice", questions: [], time_limit_s: null, pushed_at: msg.pushed_at });
          break;
        case "activity.close":
          if (msg.activity_id === activityRef.current?.id) setActivity(null);
          break;
      }
    });
    t.send({ kind: "activity.hello", from: selfId, role });
    return () => {
      unsub();
      t.close();
      transportRef.current = null;
    };
  }, [sessionId, selfId, role, arrive]);

  // The student's backstop: a quick check assigned before they joined, or whose nudge was missed.
  useEffect(() => {
    if (role !== "student") return;
    let stop = false;
    const look = async () => {
      if (stop || activityRef.current) return;
      try {
        const row = await myOpenActivityAction(sessionId);
        if (row && canOpen(row)) arrive({ id: row.assignment_id, set_id: row.set_id, title: row.set_title, mode: "practice", questions: [], time_limit_s: null, pushed_at: row.assigned_at });
      } catch {
        /* the nudge is the main path; the poll is a backstop */
      }
    };
    void look();
    const id = setInterval(look, LATE_JOINER_POLL_MS);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [role, sessionId, arrive]);

  /** Host: create the set and the assignment, then nudge the student. */
  const push = useCallback(
    async (input: PushInput): Promise<PushedActivity | null> => {
      setPushError(null);
      try {
        const { setId, assignmentId } = await pushQuickCheckAction({ sessionId, title: input.title, questionIds: input.questions.map((q) => q.id) });
        const act: PushedActivity = { id: assignmentId ?? setId, set_id: setId, title: input.title, mode: input.mode ?? "practice", questions: input.questions, time_limit_s: input.time_limit_s ?? null, pushed_at: new Date().toISOString() };
        setActivity(act);
        transportRef.current?.send({ kind: "activity.push", assignment_id: act.id, set_id: act.set_id, title: act.title, question_count: act.questions.length, pushed_at: act.pushed_at });
        return act;
      } catch (e) {
        setPushError(e instanceof Error ? e.message : "The quick check could not be sent.");
        return null;
      }
    },
    [sessionId],
  );

  /** Kept for the prop contract: answers go to answer_question from the panel. */
  const respond = useCallback((_questionId: string, _response: Response) => undefined, []);
  const submit = useCallback((_responses: Record<string, Response | null>, _marks: Record<string, MarkResult>) => undefined, []);
  const release = useCallback(() => undefined, []);

  const close = useCallback(() => {
    const act = activityRef.current;
    if (!act) return;
    if (role === "teacher") transportRef.current?.send({ kind: "activity.close", activity_id: act.id });
    setActivity(null);
  }, [role]);

  return useMemo(
    () => ({ activity, liveResponses: {} as Record<string, Response>, submission: null as StudentSubmission | null, released: null as { marks: Record<string, MarkResult>; score: number; max: number } | null, pushError, push, respond, submit, release, close }),
    [activity, pushError, push, respond, submit, release, close],
  );
}
