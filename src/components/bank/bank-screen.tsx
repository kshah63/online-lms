"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Image as ImageIcon, ListPlus, Plus, Send, Wand2 } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MathMarkdown } from "@/components/practice/math-markdown";
import { AssignDialog } from "@/components/bank/assign-dialog";
import { ChipRow } from "@/components/bank/chip-row";
import { ExtractDialog } from "@/components/bank/extract-dialog";
import { MakeSetDialog } from "@/components/bank/make-set-dialog";
import { Notice } from "@/components/bank/notice";
import { QuestionEditor, STATUS_VARIANT } from "@/components/bank/question-editor";
import { stemSummary } from "@/lib/bank/question-row";
import {
  QUESTION_STATUSES,
  QUESTION_STATUS_LABEL,
  QUESTION_TYPE_LABEL,
  type BankQuestion,
  type CourseStudent,
  type PracticeSetRow,
  type QuestionStatus,
} from "@/lib/bank/types";
import type { Course } from "@/lib/types";
import { cn } from "@/lib/utils";

type StatusFilter = QuestionStatus | "all";
type TopicFilter = string | "all" | "none";

/**
 * One course's question bank: the list by status, the editor, extraction from
 * a worksheet, and the two doors out — make a set, assign a set. The rows are
 * what the page read under RLS; every change here is also applied to the list
 * so the screen agrees with what the database was just told.
 */
export function BankScreen({
  course,
  questions: initial,
  total,
  topics,
  sets: initialSets,
  students,
  imageUrls,
  demoMode,
  tz,
}: {
  course: Course;
  questions: BankQuestion[];
  total: number;
  topics: { id: string; label: string }[];
  sets: PracticeSetRow[];
  students: CourseStudent[];
  imageUrls: Record<string, string>;
  demoMode: boolean;
  tz: string;
}) {
  const router = useRouter();
  const [questions, setQuestions] = useState(initial);
  const [sets, setSets] = useState(initialSets);
  const [status, setStatus] = useState<StatusFilter>("all");
  const [topic, setTopic] = useState<TopicFilter>("all");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<{ open: boolean; question: BankQuestion | null }>({ open: false, question: null });
  const [extracting, setExtracting] = useState(false);
  const [making, setMaking] = useState(false);
  const [assigning, setAssigning] = useState<{ open: boolean; setId: string | null }>({ open: false, setId: null });
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null);

  const topicLabel = useMemo(() => new Map(topics.map((t) => [t.id, t.label])), [topics]);
  const counts = useMemo(() => {
    const c: Record<StatusFilter, number> = { all: questions.length, draft: 0, approved: 0, retired: 0 };
    for (const q of questions) c[q.status] += 1;
    return c;
  }, [questions]);

  const visible = useMemo(
    () => questions.filter((q) => (status === "all" || q.status === status) && (topic === "all" || (topic === "none" ? !q.syllabus_topic_id : q.syllabus_topic_id === topic))),
    [questions, status, topic],
  );
  const pickedRows = useMemo(() => questions.filter((q) => picked.has(q.id) && q.status === "approved"), [questions, picked]);
  const usedTopics = useMemo(() => topics.filter((t) => questions.some((q) => q.syllabus_topic_id === t.id)), [topics, questions]);
  const untagged = questions.some((q) => !q.syllabus_topic_id);

  const upsertRow = (row: BankQuestion) => setQuestions((prev) => (prev.some((q) => q.id === row.id) ? prev.map((q) => (q.id === row.id ? row : q)) : [row, ...prev]));
  const togglePick = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <ChipRow
          options={(["all", ...QUESTION_STATUSES] as StatusFilter[]).map((s) => ({ value: s, label: `${s === "all" ? "All" : QUESTION_STATUS_LABEL[s]} (${counts[s]})` }))}
          value={status}
          onChange={setStatus}
          label="Status"
        />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setExtracting(true)}>
            <Wand2 /> Extract from a worksheet
          </Button>
          <Button type="button" size="sm" onClick={() => setEditing({ open: true, question: null })}>
            <Plus /> New question
          </Button>
        </div>
      </div>

      {(usedTopics.length > 0 || untagged) && (
        <ChipRow
          size="sm"
          label="Topic"
          options={[
            { value: "all" as TopicFilter, label: "Any topic" },
            ...usedTopics.map((t) => ({ value: t.id as TopicFilter, label: t.label })),
            ...(untagged ? [{ value: "none" as TopicFilter, label: "No topic" }] : []),
          ]}
          value={topic}
          onChange={setTopic}
        />
      )}

      {notice && <Notice ok={notice.ok} message={notice.message} onDismiss={() => setNotice(null)} />}

      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm">
        <span className="text-muted-foreground">
          {picked.size === 0 ? "Tick approved questions to make a set." : `${pickedRows.length} picked${picked.size !== pickedRows.length ? ` (${picked.size - pickedRows.length} not approved, left out)` : ""}.`}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {picked.size > 0 && (
            <Button type="button" variant="ghost" size="sm" onClick={() => setPicked(new Set())}>
              Clear
            </Button>
          )}
          <Button type="button" variant="outline" size="sm" disabled={pickedRows.length === 0} onClick={() => setMaking(true)}>
            <ListPlus /> Make a set{pickedRows.length ? ` (${pickedRows.length})` : ""}
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={sets.filter((s) => s.status === "live").length === 0} onClick={() => setAssigning({ open: true, setId: null })}>
            <Send /> Assign a set{sets.length ? ` (${sets.filter((s) => s.status === "live").length})` : ""}
          </Button>
        </div>
      </div>

      {total > questions.length && <p className="text-sm text-muted-foreground">Showing the newest {questions.length} of {total} questions.</p>}

      {visible.length === 0 ? (
        <EmptyState
          icon={<ListPlus className="h-5 w-5" />}
          title={questions.length === 0 ? "No questions on this course yet" : "Nothing matches these filters"}
          description={questions.length === 0 ? "Extract them from a worksheet in the course's materials, or write one by hand." : "Pick another status or topic."}
          action={
            questions.length === 0 ? (
              <Button type="button" variant="outline" onClick={() => setExtracting(true)}>
                <Wand2 /> Extract from a worksheet
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="space-y-2">
          {visible.map((q) => {
            const on = picked.has(q.id);
            const pickable = q.status === "approved";
            return (
              <li key={q.id} className={cn("flex items-start gap-3 rounded-xl border bg-card p-3 shadow-sm transition-colors", on && "border-primary/50 bg-primary/5")}>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  aria-label={pickable ? "Pick for a set" : "Only approved questions go in a set"}
                  disabled={!pickable}
                  onClick={() => togglePick(q.id)}
                  className={cn("mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors disabled:opacity-30", on && "border-primary bg-primary text-primary-foreground")}
                >
                  {on && <Check className="h-3.5 w-3.5" />}
                </button>
                <button type="button" onClick={() => setEditing({ open: true, question: q })} className="min-w-0 flex-1 text-left">
                  <div className="text-sm leading-relaxed">
                    <MathMarkdown source={stemSummary(q.stem)} inline />
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <Badge variant={STATUS_VARIANT[q.status]}>{QUESTION_STATUS_LABEL[q.status]}</Badge>
                    <span>{QUESTION_TYPE_LABEL[q.type]}</span>
                    <span aria-label={`Difficulty ${q.difficulty} of 5`} className="tracking-tight">
                      {"●".repeat(q.difficulty)}
                      <span className="opacity-30">{"●".repeat(5 - q.difficulty)}</span>
                    </span>
                    <span>
                      {q.marks} mark{Number(q.marks) === 1 ? "" : "s"}
                    </span>
                    {q.syllabus_topic_id && <span>· {topicLabel.get(q.syllabus_topic_id) ?? "topic"}</span>}
                    {q.image_path && <ImageIcon className="h-3.5 w-3.5" aria-label="Has an image" />}
                    {q.source?.kind === "pdf" && <span>· from a worksheet</span>}
                    {q.type !== "worked" && (q.answer == null || (Array.isArray(q.answer) && q.answer.length === 0)) && <Badge variant="warning">needs an answer</Badge>}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <QuestionEditor
        open={editing.open}
        onOpenChange={(open) => setEditing((e) => ({ ...e, open }))}
        courseId={course.id}
        topics={topics}
        question={editing.question}
        imageUrl={editing.question?.image_path ? imageUrls[editing.question.image_path] ?? null : null}
        demoMode={demoMode}
        onSaved={(row) => {
          upsertRow(row);
          setNotice({ ok: true, message: row.status === "draft" ? `Saved "${stemSummary(row.stem, 60)}" as a draft.` : "Question saved." });
        }}
        onStatusChanged={(id, next) => {
          setQuestions((prev) => prev.map((q) => (q.id === id ? { ...q, status: next, reviewed_at: new Date().toISOString() } : q)));
          if (next === "retired") setPicked((prev) => { const n = new Set(prev); n.delete(id); return n; });
          setNotice({ ok: true, message: next === "approved" ? "Approved: it can go in a set now." : "Retired: it stays for the attempts that used it and leaves the pick lists." });
        }}
      />

      <ExtractDialog
        open={extracting}
        onOpenChange={setExtracting}
        courseId={course.id}
        onStored={(count, rows) => {
          if (rows) setQuestions((prev) => [...rows, ...prev]);
          else router.refresh();
          setStatus("draft");
          setNotice({ ok: true, message: `${count} draft question${count === 1 ? "" : "s"} added — approve each after reading it.` });
        }}
      />

      <MakeSetDialog
        open={making}
        onOpenChange={setMaking}
        courseId={course.id}
        picked={pickedRows}
        topics={topics}
        onCreated={(set, assignNow) => {
          setSets((prev) => [set, ...prev]);
          setPicked(new Set());
          setNotice({ ok: true, message: `Made "${set.title}" with ${set.question_count} question${set.question_count === 1 ? "" : "s"}.` });
          if (assignNow) setAssigning({ open: true, setId: set.id });
        }}
      />

      <AssignDialog
        open={assigning.open}
        onOpenChange={(open) => setAssigning((a) => ({ ...a, open }))}
        courseId={course.id}
        sets={sets}
        students={students}
        initialSetId={assigning.setId}
        tz={tz}
        onAssigned={(message) => setNotice({ ok: true, message })}
      />
    </div>
  );
}
