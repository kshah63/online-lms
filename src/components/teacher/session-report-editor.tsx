"use client";

import { useMemo, useState, useTransition } from "react";
import { Loader2, Plus, Send, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  GP_OPTIONS,
  OTR_BANDS,
  PREV_HW_OPTIONS,
  UNDERSTANDING_OPTIONS,
  testPercent,
  validateReportDraft,
  type PrevHw,
  type SessionReportDraft,
} from "@/lib/reports/mvapp-template";
import type { DraftedSessionReport } from "@/lib/reports/draft-session-report";
import { cn } from "@/lib/utils";

// ============================================================================
// The per-session report editor, in the centre app's vocabulary. Every scored
// field is chosen from a list (never typed): understanding 10→1, GP in
// quarters, the oral-test band, the nine previous-homework answers. The AI
// draft fills the form from the teacher's notes + the lesson; the teacher
// edits every field; submit goes through mv-app's submit_report.
// ============================================================================

const NONE = "__none__";

export function emptyDraft(bookedTopic?: string | null): SessionReportDraft {
  return {
    topic: bookedTopic ?? "",
    topic_completed: true,
    topics_not_done: null,
    understanding: 7,
    otr: null,
    gp: null,
    prev_hw: null,
    homework: "",
    remarks: "",
    written_tests: [],
    has_upcoming_tests: false,
  };
}

export function SessionReportEditor({
  studentName,
  course,
  topicOptions,
  bookedTopic,
  signs,
  initial,
  initialNotes,
  readOnly,
  onDraft,
  onSubmit,
}: {
  studentName: string;
  course: string;
  topicOptions: string[];
  bookedTopic?: string | null;
  /** The author's report publishes directly (staff, or a teacher with auto-approve): a GP is required. */
  signs: boolean;
  initial?: SessionReportDraft | null;
  initialNotes?: string;
  readOnly?: boolean;
  onDraft: (notes: string) => Promise<DraftedSessionReport>;
  onSubmit: (draft: SessionReportDraft) => Promise<{ ok: boolean; message: string }>;
}) {
  const [notes, setNotes] = useState(initialNotes ?? "");
  const [d, setD] = useState<SessionReportDraft>(initial ?? emptyDraft(bookedTopic));
  const [rationale, setRationale] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [customTopic, setCustomTopic] = useState(Boolean(initial?.topic && !topicOptions.includes(initial.topic)));

  const set = <K extends keyof SessionReportDraft>(k: K, v: SessionReportDraft[K]) => setD((p) => ({ ...p, [k]: v }));
  const errors = useMemo(() => validateReportDraft(d, { signs }), [d, signs]);
  const first = studentName.split(" ")[0];

  async function draft() {
    setDrafting(true);
    setMsg(null);
    try {
      const res = await onDraft(notes);
      setD(res.draft);
      setRationale(res.rationale);
      setCustomTopic(Boolean(res.draft.topic && !topicOptions.includes(res.draft.topic)));
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Could not draft the report." });
    } finally {
      setDrafting(false);
    }
  }

  function submit() {
    if (errors.length) return;
    startTransition(async () => {
      const res = await onSubmit(d);
      setMsg({ ok: res.ok, text: res.message });
    });
  }

  return (
    <div className="space-y-6">
      {!readOnly && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" /> Quick notes
            </CardTitle>
            <CardDescription>Jot what happened; the draft fills the form from your notes, the lesson transcript and any practice results. You edit every field.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder={`e.g. Solid on factorising; kept dropping the sign when the x² coefficient isn't 1. ${first} was tired today.`} />
            <div className="flex items-center gap-3">
              <Button type="button" variant="outline" onClick={draft} disabled={drafting}>
                {drafting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} Draft the report
              </Button>
              {rationale && <p className="text-xs text-muted-foreground">{rationale}</p>}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Session report</CardTitle>
          <CardDescription>
            {course} · {studentName}
            {signs ? " · publishes to the family when you submit" : " · goes to your in-charge for approval"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Topic taught</Label>
              {customTopic || topicOptions.length === 0 ? (
                <div className="flex gap-2">
                  <Input value={d.topic} onChange={(e) => set("topic", e.target.value)} placeholder="Topic" disabled={readOnly} />
                  {topicOptions.length > 0 && (
                    <Button type="button" variant="ghost" size="sm" onClick={() => setCustomTopic(false)}>
                      Pick from list
                    </Button>
                  )}
                </div>
              ) : (
                <div className="flex gap-2">
                  <Select value={d.topic || undefined} onValueChange={(v) => set("topic", v)} disabled={readOnly}>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose the topic" />
                    </SelectTrigger>
                    <SelectContent>
                      {topicOptions.map((t) => (
                        <SelectItem key={t} value={t}>
                          {t}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setCustomTopic(true)}>
                    Other
                  </Button>
                </div>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Was the topic completed?</Label>
              <ChipRow
                options={[
                  { key: "yes", label: "Completed" },
                  { key: "no", label: "Not yet" },
                ]}
                value={d.topic_completed ? "yes" : "no"}
                onChange={(k) => set("topic_completed", k === "yes")}
                disabled={readOnly}
              />
              {!d.topic_completed && (
                <Input className="mt-2" value={d.topics_not_done ?? ""} onChange={(e) => set("topics_not_done", e.target.value || null)} placeholder="What was left (e.g. vertex form)" disabled={readOnly} />
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Understanding of today&rsquo;s topic</Label>
            <ChipRow options={UNDERSTANDING_OPTIONS.map((n) => ({ key: String(n), label: String(n) }))} value={String(d.understanding)} onChange={(k) => set("understanding", Number(k))} disabled={readOnly} />
            <p className="text-xs text-muted-foreground">10 = fully secure, 1 = not yet grasped.</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            {signs && (
              <div className="space-y-1.5">
                <Label>GP (grade point)</Label>
                <Select value={d.gp == null ? NONE : String(d.gp)} onValueChange={(v) => set("gp", v === NONE ? null : Number(v))} disabled={readOnly}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Not set</SelectItem>
                    {GP_OPTIONS.map((g) => (
                      <SelectItem key={g} value={String(g)}>
                        {g.toFixed(2)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Oral test</Label>
              <Select value={d.otr == null ? NONE : String(d.otr)} onValueChange={(v) => set("otr", v === NONE ? null : Number(v))} disabled={readOnly}>
                <SelectTrigger>
                  <SelectValue placeholder="No oral test" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>No oral test</SelectItem>
                  {OTR_BANDS.map((b) => (
                    <SelectItem key={b.lower} value={String(b.lower)}>
                      {b.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Previous homework</Label>
              <Select value={d.prev_hw ?? NONE} onValueChange={(v) => set("prev_hw", v === NONE ? null : (v as PrevHw))} disabled={readOnly}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Not stated</SelectItem>
                  {PREV_HW_OPTIONS.map((o) => (
                    <SelectItem key={o} value={o}>
                      {o}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Written tests this lesson</Label>
            <WrittenTestsEditor tests={d.written_tests} onChange={(t) => set("written_tests", t)} disabled={readOnly} />
          </div>

          <div className="space-y-1.5">
            <Label>Homework</Label>
            <Input value={d.homework} onChange={(e) => set("homework", e.target.value)} placeholder="e.g. Ex 4B questions 1–8; practice set on the platform" disabled={readOnly} />
          </div>

          <div className="space-y-1.5">
            <Label>Remarks to the parent</Label>
            <Textarea value={d.remarks} onChange={(e) => set("remarks", e.target.value)} rows={4} placeholder={`What was covered, how ${first} did, one strength, one thing to work on.`} disabled={readOnly} />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={d.has_upcoming_tests} onChange={(e) => set("has_upcoming_tests", e.target.checked)} disabled={readOnly} className="h-4 w-4 rounded border" />
            {first} has a school test or exam coming up
          </label>

          {errors.length > 0 && (
            <ul className="space-y-1 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning-foreground">
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
          {msg && <p className={cn("text-sm", msg.ok ? "text-success" : "text-destructive")}>{msg.text}</p>}

          {!readOnly && (
            <div className="flex justify-end gap-2 border-t pt-4">
              <Button onClick={submit} disabled={pending || errors.length > 0}>
                {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {signs ? "Publish to the family" : "Send for approval"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ChipRow({ options, value, onChange, disabled }: { options: { key: string; label: string }[]; value: string; onChange: (k: string) => void; disabled?: boolean }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          role="radio"
          aria-checked={value === o.key}
          disabled={disabled}
          onClick={() => onChange(o.key)}
          className={cn("min-w-9 rounded-full border px-3 py-1 text-sm tabular-nums transition-colors", value === o.key ? "border-primary bg-primary text-primary-foreground" : "hover:bg-secondary", disabled && "cursor-default")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function WrittenTestsEditor({ tests, onChange, disabled }: { tests: SessionReportDraft["written_tests"]; onChange: (t: SessionReportDraft["written_tests"]) => void; disabled?: boolean }) {
  const update = (i: number, patch: Partial<SessionReportDraft["written_tests"][number]>) => {
    const next = tests.map((t, j) => (j === i ? { ...t, ...patch } : t));
    next[i] = { ...next[i]!, percent: testPercent(next[i]!.score, next[i]!.out_of) };
    onChange(next);
  };
  return (
    <div className="space-y-2">
      {tests.map((t, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2">
          <Input className="min-w-40 flex-1" value={t.name} onChange={(e) => update(i, { name: e.target.value })} placeholder="Test name" disabled={disabled} />
          <Input className="w-20" inputMode="numeric" value={t.score ?? ""} onChange={(e) => update(i, { score: e.target.value === "" ? null : Number(e.target.value) })} placeholder="Score" disabled={disabled} />
          <span className="text-sm text-muted-foreground">/</span>
          <Input className="w-20" inputMode="numeric" value={t.out_of ?? ""} onChange={(e) => update(i, { out_of: e.target.value === "" ? null : Number(e.target.value) })} placeholder="Out of" disabled={disabled} />
          <span className="w-12 text-sm tabular-nums text-muted-foreground">{t.percent != null ? `${t.percent}%` : ""}</span>
          {!disabled && (
            <button type="button" onClick={() => onChange(tests.filter((_, j) => j !== i))} className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-destructive" aria-label="Remove test">
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      ))}
      {!disabled && (
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange([...tests, { name: "", score: null, out_of: null, percent: null }])}>
          <Plus className="h-4 w-4" /> Add a test
        </Button>
      )}
    </div>
  );
}
