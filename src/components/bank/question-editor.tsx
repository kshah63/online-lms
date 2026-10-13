"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Archive, CheckCircle2, Loader2, Plus, Save, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ChipRow } from "@/components/bank/chip-row";
import { ImageUpload } from "@/components/bank/image-upload";
import { Notice } from "@/components/bank/notice";
import { QuestionPreview } from "@/components/bank/question-preview";
import { approveQuestionAction, retireQuestionAction, saveQuestionAction } from "@/lib/actions/bank";
import { OPTION_KEYS, editorToPayload, emptyEditor, payloadToRow, rowToEditor, rowToQuestion } from "@/lib/bank/question-row";
import {
  DIFFICULTIES,
  DIFFICULTY_LABEL,
  QUESTION_STATUS_LABEL,
  QUESTION_TYPES,
  QUESTION_TYPE_LABEL,
  type BankQuestion,
  type QuestionDraftInput,
  type QuestionStatus,
} from "@/lib/bank/types";
import type { QuestionType } from "@/lib/practice/model";
import { cn } from "@/lib/utils";

const NO_TOPIC = "__none__";
const MARKS = [1, 2, 3, 4, 5, 6, 8, 10] as const;

export const STATUS_VARIANT: Record<QuestionStatus, "warning" | "success" | "secondary"> = {
  draft: "warning",
  approved: "success",
  retired: "secondary",
};

/**
 * One question, new or existing: the fields its type needs, a live preview of
 * the stem and options with LaTeX, and the approve / retire doors. Saves
 * through upsert_question; a retired row is shown but not edited.
 */
export function QuestionEditor({
  open,
  onOpenChange,
  courseId,
  topics,
  question,
  imageUrl,
  onSaved,
  onStatusChanged,
  demoMode,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  courseId: string;
  topics: { id: string; label: string }[];
  /** null for a new question. */
  question: BankQuestion | null;
  /** A signed URL for the stored image, when the page resolved one. */
  imageUrl?: string | null;
  onSaved: (row: BankQuestion) => void;
  onStatusChanged: (id: string, status: QuestionStatus) => void;
  demoMode: boolean;
}) {
  const [form, setForm] = useState<QuestionDraftInput>(() => (question ? rowToEditor(question) : emptyEditor()));
  const [preview, setPreview] = useState<string | null>(imageUrl ?? null);
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!open) return;
    setForm(question ? rowToEditor(question) : emptyEditor());
    setPreview(imageUrl ?? null);
    setNotice(null);
  }, [open, question, imageUrl]);

  const retired = question?.status === "retired";
  const choice = form.type === "mcq" || form.type === "multi_select";
  const topicLabel = topics.find((t) => t.id === form.syllabus_topic_id)?.label ?? null;

  const previewQuestion = useMemo(() => {
    const built = editorToPayload(form);
    const payload = built.ok ? built.payload : { ...editorToPayloadLoose(form) };
    return rowToQuestion(payloadToRow(payload, question, courseId, question?.id ?? "preview", "", new Date().toISOString()), preview, topicLabel);
  }, [form, question, courseId, preview, topicLabel]);

  const set = <K extends keyof QuestionDraftInput>(key: K, value: QuestionDraftInput[K]) => setForm((f) => ({ ...f, [key]: value }));

  function changeType(type: QuestionType) {
    setForm((f) => {
      const nextChoice = type === "mcq" || type === "multi_select";
      return {
        ...f,
        type,
        options: nextChoice ? (f.options.length >= 2 ? f.options : [{ key: "A", text: "" }, { key: "B", text: "" }]) : f.options,
        answer: type === "mcq" || type === "numeric" || type === "short" ? (f.type === type ? f.answer : "") : "",
        answers: type === "multi_select" ? f.answers : [],
      };
    });
  }

  function save() {
    setNotice(null);
    start(async () => {
      const result = await saveQuestionAction(courseId, form);
      setNotice({ ok: result.ok, message: result.message });
      if (result.ok && result.row) {
        onSaved(result.row);
        onOpenChange(false);
      }
    });
  }

  function changeStatus(next: "approved" | "retired") {
    if (!question) return;
    setNotice(null);
    start(async () => {
      const result = next === "approved" ? await approveQuestionAction(courseId, question.id) : await retireQuestionAction(courseId, question.id);
      setNotice({ ok: result.ok, message: result.message });
      if (result.ok) {
        onStatusChanged(question.id, next);
        onOpenChange(false);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {question ? "Edit question" : "New question"}
            {question && <Badge variant={STATUS_VARIANT[question.status]}>{QUESTION_STATUS_LABEL[question.status]}</Badge>}
          </DialogTitle>
          <DialogDescription>
            {retired ? "A retired question stays as it was for the attempts that used it." : "Markdown with LaTeX: $x^2$ inline, $$…$$ on its own line."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 lg:grid-cols-2">
          <fieldset disabled={retired || pending} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <ChipRow options={QUESTION_TYPES.map((t) => ({ value: t, label: QUESTION_TYPE_LABEL[t] }))} value={form.type} onChange={changeType} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="stem">Question</Label>
              <Textarea id="stem" rows={5} value={form.stem} onChange={(e) => set("stem", e.target.value)} placeholder="Solve $x^2 - 5x + 6 = 0$." />
            </div>

            {choice && (
              <div className="space-y-1.5">
                <Label>{form.type === "mcq" ? "Options — pick the correct one" : "Options — tick every correct one"}</Label>
                <ul className="space-y-1.5">
                  {form.options.map((o, i) => {
                    const key = OPTION_KEYS[i] ?? o.key;
                    const right = form.type === "mcq" ? form.answer === key : form.answers.includes(key);
                    return (
                      <li key={i} className="flex items-center gap-2">
                        <button
                          type="button"
                          role={form.type === "mcq" ? "radio" : "checkbox"}
                          aria-checked={right}
                          aria-label={`Option ${key} is correct`}
                          onClick={() =>
                            form.type === "mcq" ? set("answer", key) : set("answers", right ? form.answers.filter((k) => k !== key) : [...form.answers, key])
                          }
                          className={cn(
                            "flex h-8 w-8 shrink-0 items-center justify-center border text-xs font-semibold transition-colors",
                            form.type === "mcq" ? "rounded-full" : "rounded-md",
                            right ? "border-success bg-success text-success-foreground" : "hover:bg-secondary",
                          )}
                        >
                          {key}
                        </button>
                        <Input value={o.text} onChange={(e) => set("options", form.options.map((x, j) => (j === i ? { key, text: e.target.value } : x)))} placeholder={`Option ${key}`} aria-label={`Option ${key} text`} />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 shrink-0"
                          disabled={form.options.length <= 2}
                          aria-label={`Remove option ${key}`}
                          onClick={() => {
                            const options = form.options.filter((_, j) => j !== i).map((x, j) => ({ ...x, key: OPTION_KEYS[j] ?? x.key }));
                            setForm((f) => ({ ...f, options, answer: f.type === "mcq" && f.answer === key ? "" : f.answer, answers: f.answers.filter((k) => k !== key) }));
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </li>
                    );
                  })}
                </ul>
                <Button type="button" variant="outline" size="sm" disabled={form.options.length >= OPTION_KEYS.length} onClick={() => set("options", [...form.options, { key: OPTION_KEYS[form.options.length] ?? "?", text: "" }])}>
                  <Plus /> Add an option
                </Button>
              </div>
            )}

            {form.type === "numeric" && (
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="num-answer">Answer</Label>
                  <Input id="num-answer" inputMode="decimal" value={form.answer} onChange={(e) => set("answer", e.target.value)} placeholder="12.5" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="num-tol">Tolerance (±)</Label>
                  <Input id="num-tol" inputMode="decimal" value={form.tolerance} onChange={(e) => set("tolerance", e.target.value)} placeholder="half the last place" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="num-unit">Unit</Label>
                  <Input id="num-unit" value={form.unit} onChange={(e) => set("unit", e.target.value)} placeholder="cm" />
                </div>
              </div>
            )}

            {form.type === "short" && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="short-answer">Answer</Label>
                  <Input id="short-answer" value={form.answer} onChange={(e) => set("answer", e.target.value)} placeholder="(x-2)(x-3)" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="short-accepted">Also accepted, one per line</Label>
                  <Textarea id="short-accepted" rows={2} value={form.accepted.join("\n")} onChange={(e) => set("accepted", e.target.value.split("\n"))} placeholder="(x-3)(x-2)" />
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="solution">{form.type === "worked" ? "Worked solution and marking scheme" : "Worked solution (shown after an attempt)"}</Label>
              <Textarea id="solution" rows={form.type === "worked" ? 5 : 3} value={form.worked_solution} onChange={(e) => set("worked_solution", e.target.value)} placeholder={form.type === "worked" ? "M1 divide by 2; M1 complete the square; A1 …" : "Complete the square: …"} />
            </div>

            <div className="space-y-1.5">
              <Label>Difficulty</Label>
              <ChipRow options={DIFFICULTIES.map((d) => ({ value: d, label: `${d} · ${DIFFICULTY_LABEL[d]}` }))} value={form.difficulty} onChange={(d) => set("difficulty", d)} />
            </div>

            <div className="space-y-1.5">
              <Label>Marks</Label>
              <ChipRow options={MARKS.map((m) => ({ value: m, label: String(m) }))} value={form.marks} onChange={(m) => set("marks", m)} />
            </div>

            <div className="space-y-1.5">
              <Label>Syllabus topic</Label>
              <Select value={form.syllabus_topic_id ?? NO_TOPIC} onValueChange={(v) => set("syllabus_topic_id", v === NO_TOPIC ? null : v)}>
                <SelectTrigger aria-label="Syllabus topic">
                  <SelectValue placeholder="No topic" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_TOPIC}>No topic</SelectItem>
                  {topics.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {topics.length === 0 && <p className="text-xs text-muted-foreground">This course has no syllabus topics yet; seed them in the syllabus editor.</p>}
            </div>

            <div className="space-y-1.5">
              <Label>Image</Label>
              <ImageUpload courseId={courseId} imagePath={form.image_path} previewUrl={preview} demoMode={demoMode} onChange={(path, url) => { set("image_path", path); setPreview(url); }} />
            </div>
          </fieldset>

          <div className="space-y-3">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Preview</div>
            <QuestionPreview question={previewQuestion} imageUrl={preview} />
            {question && (
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <dt>Source</dt>
                <dd>{question.source?.kind === "pdf" ? `Worksheet${question.source.page ? `, page ${question.source.page}` : ""}` : question.source?.kind === "generated" ? "Generated variant" : "Entered by hand"}</dd>
                <dt>Added</dt>
                <dd>{new Date(question.created_at).toLocaleDateString()}</dd>
                {question.reviewed_at && (
                  <>
                    <dt>Reviewed</dt>
                    <dd>{new Date(question.reviewed_at).toLocaleDateString()}</dd>
                  </>
                )}
              </dl>
            )}
          </div>
        </div>

        {notice && <Notice ok={notice.ok} message={notice.message} onDismiss={() => setNotice(null)} />}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4">
          <div className="flex items-center gap-2">
            {question && question.status === "draft" && (
              <Button type="button" variant="success" size="sm" disabled={pending} onClick={() => changeStatus("approved")}>
                <CheckCircle2 /> Approve
              </Button>
            )}
            {question && question.status !== "retired" && (
              <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => changeStatus("retired")}>
                <Archive /> Retire
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {retired ? "Close" : "Cancel"}
            </Button>
            {!retired && (
              <Button type="button" disabled={pending} onClick={save}>
                {pending ? <Loader2 className="animate-spin" /> : <Save />} {question ? "Save changes" : "Add as a draft"}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** The preview must render while the form is still incomplete, so it takes the fields as they are. */
function editorToPayloadLoose(form: QuestionDraftInput): Record<string, unknown> {
  const options = form.options.map((o, i) => ({ key: OPTION_KEYS[i] ?? o.key, text: o.text }));
  const choice = form.type === "mcq" || form.type === "multi_select";
  const answer =
    form.type === "mcq" ? form.answer : form.type === "multi_select" ? form.answers : form.type === "numeric" ? Number(form.answer) || form.answer : form.type === "short" ? form.answer : null;
  return {
    id: form.id,
    type: form.type,
    stem: form.stem,
    options: choice ? options : null,
    answer,
    tolerance: form.tolerance.trim() ? Number(form.tolerance) : null,
    unit: form.unit || null,
    accepted: form.type === "short" ? form.accepted.filter((a) => a.trim()) : null,
    difficulty: form.difficulty,
    marks: form.marks,
    worked_solution: form.worked_solution || null,
    image_path: form.image_path,
    syllabus_topic_id: form.syllabus_topic_id,
    source: form.source,
  };
}
