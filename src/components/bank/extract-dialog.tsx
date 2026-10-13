"use client";

import { useEffect, useState, useTransition } from "react";
import { AlertTriangle, ChevronLeft, Loader2, Wand2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MathMarkdown } from "@/components/practice/math-markdown";
import { MaterialsPicker, type PickableFile } from "@/components/bank/materials-picker";
import { Notice } from "@/components/bank/notice";
import { extractWorksheetAction, materialsViewUrlAction, storeExtractedQuestionsAction } from "@/lib/actions/bank";
import { QUESTION_TYPE_LABEL, type BankQuestion } from "@/lib/bank/types";
import { flattenFiles, type MaterialsTree } from "@/lib/materials/portal";
import type { DraftQuestion } from "@/lib/practice/extract-parse";
import { cn } from "@/lib/utils";

type Picked = { fileId: string; name: string } | null;

/**
 * Extract from a worksheet: pick the PDF (and its answer key) from the course's
 * materials, run the extraction, read what came back with its review notes,
 * and add the ones worth keeping to the bank as drafts.
 */
export function ExtractDialog({
  open,
  onOpenChange,
  courseId,
  onStored,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  courseId: string;
  /** Rows in demo mode (the RPC has nothing to read back); the live path refreshes the page. */
  onStored: (count: number, rows: BankQuestion[] | null) => void;
}) {
  const [files, setFiles] = useState<PickableFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [worksheet, setWorksheet] = useState<Picked>(null);
  const [answerKey, setAnswerKey] = useState<Picked>(null);
  const [hints, setHints] = useState("");
  const [result, setResult] = useState<{ title: string; questions: DraftQuestion[]; errors: string[] } | null>(null);
  const [keep, setKeep] = useState<Set<number>>(new Set());
  const [notice, setNotice] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!open) return;
    setResult(null);
    setNotice(null);
    setLoading(true);
    setTreeError(null);
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/practice/materials?course=${encodeURIComponent(courseId)}`);
        const data = (await res.json()) as MaterialsTree | { error?: string };
        if (cancelled) return;
        if (!res.ok || !("root" in data)) throw new Error("error" in data && data.error ? data.error : "Could not load the course's materials.");
        setFiles(flattenFiles(data.root));
      } catch (e) {
        if (!cancelled) setTreeError(e instanceof Error ? e.message : "Could not load the course's materials.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, courseId]);

  function openFile(fileId: string) {
    start(async () => {
      const r = await materialsViewUrlAction(courseId, fileId);
      if (r.ok && r.url) window.open(r.url, "_blank", "noopener");
      else setNotice({ ok: false, message: r.message });
    });
  }

  function extract() {
    if (!worksheet) return;
    setNotice(null);
    start(async () => {
      const r = await extractWorksheetAction({ courseId, worksheet, answerKey, hints });
      if (!r.ok) {
        setNotice({ ok: false, message: r.message });
        return;
      }
      setResult({ title: r.title, questions: r.questions, errors: r.errors });
      setKeep(new Set(r.questions.map((_, i) => i)));
      setNotice({ ok: true, message: r.message });
    });
  }

  function store() {
    if (!result || !worksheet) return;
    const chosen = result.questions.filter((_, i) => keep.has(i));
    setNotice(null);
    start(async () => {
      const r = await storeExtractedQuestionsAction(courseId, chosen, { file_id: worksheet.fileId, answer_key_file_id: answerKey?.fileId ?? null, title: result.title });
      setNotice({ ok: r.ok, message: r.message });
      if (r.ok) {
        onStored(r.count, r.rows ?? null);
        onOpenChange(false);
      }
    });
  }

  const toggle = (i: number) =>
    setKeep((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="h-5 w-5 text-primary" /> Extract from a worksheet
          </DialogTitle>
          <DialogDescription>
            {result ? "Read each question before it goes in; everything lands as a draft for a person to approve." : "The worksheet and its answer key come from the course's materials; answers are copied from the key, never invented."}
          </DialogDescription>
        </DialogHeader>

        {!result ? (
          <div className="space-y-4">
            <MaterialsPicker label="Worksheet" files={files} loading={loading} error={treeError} value={worksheet} onChange={setWorksheet} onOpen={openFile} excludeId={answerKey?.fileId} />
            <MaterialsPicker label="Answer key" optional files={files} loading={loading} error={treeError} value={answerKey} onChange={setAnswerKey} onOpen={openFile} excludeId={worksheet?.fileId} />
            <div className="space-y-1.5">
              <Label htmlFor="hints">Notes for the extraction (optional)</Label>
              <Textarea id="hints" rows={2} value={hints} onChange={(e) => setHints(e.target.value)} placeholder="Sec 3, chapter 4; skip the investigation on page 6." />
            </div>
            {notice && <Notice ok={notice.ok} message={notice.message} onDismiss={() => setNotice(null)} />}
            <div className="flex justify-end gap-2 border-t pt-4">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="button" disabled={!worksheet || pending} onClick={extract}>
                {pending ? <Loader2 className="animate-spin" /> : <Wand2 />} Extract questions
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">{result.title || worksheet?.name}</span>
              <Badge variant="secondary">{result.questions.length} found</Badge>
              <Badge variant={answerKey ? "success" : "warning"}>{answerKey ? "with answer key" : "no answer key"}</Badge>
              <span className="ml-auto text-xs text-muted-foreground">{keep.size} selected</span>
            </div>
            {result.errors.length > 0 && <Notice ok={false} message={result.errors.join(" ")} />}
            <ul className="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
              {result.questions.map((q, i) => {
                const on = keep.has(i);
                return (
                  <li key={i}>
                    <button type="button" aria-pressed={on} onClick={() => toggle(i)} className={cn("w-full rounded-lg border p-3 text-left text-sm transition-colors", on ? "border-primary/50 bg-primary/5" : "opacity-70 hover:bg-secondary")}>
                      <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span className="font-semibold text-foreground">Q{q.number}</span>
                        <span>{QUESTION_TYPE_LABEL[q.type]}</span>
                        <span>· {q.marks} mark{q.marks === 1 ? "" : "s"}</span>
                        {q.topic_label && <span>· {q.topic_label}</span>}
                        <span className="ml-auto">{Math.round(q.confidence * 100)}% sure</span>
                      </div>
                      <MathMarkdown source={q.stem} />
                      {(q.answer || q.answers.length > 0) && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Answer: <code className="rounded bg-secondary px-1">{q.answer ?? q.answers.join(", ")}</code>
                        </p>
                      )}
                      {q.review_notes.length > 0 && (
                        <ul className="mt-1.5 space-y-0.5 text-xs text-warning-foreground">
                          {q.review_notes.map((n, j) => (
                            <li key={j} className="flex gap-1.5">
                              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {n}
                            </li>
                          ))}
                        </ul>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
            {notice && <Notice ok={notice.ok} message={notice.message} onDismiss={() => setNotice(null)} />}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4">
              <Button type="button" variant="ghost" size="sm" onClick={() => setResult(null)}>
                <ChevronLeft /> Pick another file
              </Button>
              <Button type="button" disabled={keep.size === 0 || pending} onClick={store}>
                {pending ? <Loader2 className="animate-spin" /> : null} Add {keep.size} to the bank as drafts
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
