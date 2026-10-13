"use client";

import { useEffect, useState, useTransition } from "react";
import { ListPlus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChipRow } from "@/components/bank/chip-row";
import { Notice } from "@/components/bank/notice";
import { MathMarkdown } from "@/components/practice/math-markdown";
import { createPracticeSetAction } from "@/lib/actions/bank";
import { stemSummary } from "@/lib/bank/question-row";
import { SET_KINDS, SET_KIND_LABEL, TIME_LIMITS, type BankQuestion, type IntegritySettings, type PracticeSetRow, type SetKind } from "@/lib/bank/types";

const NO_TOPIC = "__none__";

/** Make a set from the picked questions: practice or a timed test, with its time limit and integrity settings. */
export function MakeSetDialog({
  open,
  onOpenChange,
  courseId,
  picked,
  topics,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  courseId: string;
  picked: BankQuestion[];
  topics: { id: string; label: string }[];
  onCreated: (set: PracticeSetRow, assignNow: boolean) => void;
}) {
  const [kind, setKind] = useState<SetKind>("practice");
  const [title, setTitle] = useState("");
  const [timeLimit, setTimeLimit] = useState<number | null>(20);
  const [integrity, setIntegrity] = useState<IntegritySettings>({ camera_required: false, hide_solutions: false });
  const [topicId, setTopicId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!open) return;
    setNotice(null);
    // One topic across the picked questions names the set and tags it.
    const topicIds = [...new Set(picked.map((q) => q.syllabus_topic_id).filter((t): t is string => Boolean(t)))];
    const only = topicIds.length === 1 ? topics.find((t) => t.id === topicIds[0]) ?? null : null;
    setTopicId(only?.id ?? null);
    setTitle(only ? `${only.label} — ${kind === "test" ? "topic test" : "practice"}` : "");
  }, [open, picked, topics, kind]);

  const totalMarks = picked.reduce((s, q) => s + (Number(q.marks) || 0), 0);

  function create(assignNow: boolean) {
    setNotice(null);
    start(async () => {
      const r = await createPracticeSetAction({ courseId, kind, title, questionIds: picked.map((q) => q.id), topicId, timeLimitMinutes: timeLimit, integrity });
      setNotice({ ok: r.ok, message: r.message });
      if (r.ok && r.set) {
        onCreated(r.set, assignNow);
        onOpenChange(false);
      }
    });
  }

  const flags = (Object.keys(integrity) as (keyof IntegritySettings)[]).filter((k) => integrity[k]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ListPlus className="h-5 w-5 text-primary" /> Make a set
          </DialogTitle>
          <DialogDescription>
            {picked.length} approved question{picked.length === 1 ? "" : "s"}, {totalMarks} mark{totalMarks === 1 ? "" : "s"}, in the order picked.
          </DialogDescription>
        </DialogHeader>

        <ol className="max-h-40 space-y-1 overflow-y-auto rounded-md border p-2 text-sm">
          {picked.map((q, i) => (
            <li key={q.id} className="flex gap-2 truncate">
              <span className="w-5 shrink-0 text-right text-xs text-muted-foreground">{i + 1}.</span>
              <span className="min-w-0 flex-1 truncate">
                <MathMarkdown source={stemSummary(q.stem, 90)} inline />
              </span>
            </li>
          ))}
        </ol>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Kind</Label>
            <ChipRow options={SET_KINDS.map((k) => ({ value: k, label: SET_KIND_LABEL[k] }))} value={kind} onChange={setKind} />
            <p className="text-xs text-muted-foreground">{kind === "practice" ? "Marked as the student goes, with the solution after each question." : "Opens in the browser full-screen with a timer; nothing is shown until the student submits."}</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="set-title">Title</Label>
            <Input id="set-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Quadratics — practice set" />
          </div>

          {kind === "test" && (
            <div className="space-y-1.5">
              <Label>Time limit</Label>
              <ChipRow options={TIME_LIMITS.map((m) => ({ value: m, label: m === null ? "No limit" : `${m} min` }))} value={timeLimit} onChange={setTimeLimit} />
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Integrity</Label>
            <ChipRow<keyof IntegritySettings>
              options={[
                { value: "camera_required", label: "Camera required", hint: "Snapshots during the test, when the family has consented", disabled: kind !== "test" },
                { value: "hide_solutions", label: "Hide solutions after submitting" },
              ]}
              value={flags}
              onChange={(k) => setIntegrity((s) => ({ ...s, [k]: !s[k] }))}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Syllabus topic</Label>
            <Select value={topicId ?? NO_TOPIC} onValueChange={(v) => setTopicId(v === NO_TOPIC ? null : v)}>
              <SelectTrigger aria-label="Set topic">
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
            <p className="text-xs text-muted-foreground">A test's topic is what its score counts towards on the child's progress page.</p>
          </div>
        </div>

        {notice && <Notice ok={notice.ok} message={notice.message} onDismiss={() => setNotice(null)} />}

        <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" variant="outline" disabled={pending} onClick={() => create(false)}>
            {pending ? <Loader2 className="animate-spin" /> : null} Make the set
          </Button>
          <Button type="button" disabled={pending} onClick={() => create(true)}>
            Make and assign…
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
