"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save, Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { generateReportDraft, saveReport, type ReportInput } from "@/lib/actions/reports";
import type { Report } from "@/lib/types";

export function ReportEditor({
  sessionId,
  studentName,
  course,
  initial,
}: {
  sessionId: string;
  studentName: string;
  course: string;
  initial: Report | null;
}) {
  const router = useRouter();
  const [drafting, setDrafting] = useState(false);
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [f, setF] = useState<ReportInput>({
    teacher_notes: initial?.teacher_notes ?? "",
    topics_covered: initial?.topics_covered ?? "",
    how_student_did: initial?.how_student_did ?? "",
    strengths: initial?.strengths ?? "",
    areas_to_work: initial?.areas_to_work ?? "",
    homework: initial?.homework ?? "",
    rating: initial?.rating ?? 4,
    needs_followup: initial?.needs_followup ?? false,
    followup_reason: initial?.followup_reason ?? "",
    ai_drafted: initial?.ai_drafted ?? false,
    homework_due: null,
  });

  const set = <K extends keyof ReportInput>(k: K, v: ReportInput[K]) => setF((p) => ({ ...p, [k]: v }));

  async function draft() {
    setDrafting(true);
    setMsg(null);
    try {
      const d = await generateReportDraft(sessionId, f.teacher_notes);
      setF((p) => ({
        ...p,
        topics_covered: d.topics_covered,
        how_student_did: d.how_student_did,
        strengths: d.strengths,
        areas_to_work: d.areas_to_work,
        homework: d.homework,
        rating: d.rating,
        needs_followup: d.needs_followup,
        followup_reason: d.followup_reason,
        ai_drafted: true,
      }));
    } finally {
      setDrafting(false);
    }
  }

  function submit(publish: boolean) {
    startTransition(async () => {
      const res = await saveReport(sessionId, f, publish);
      setMsg({ ok: res.ok, text: res.message });
      if (res.ok && publish) setTimeout(() => router.push("/teacher/reports"), 800);
    });
  }

  const published = Boolean(initial?.published_at);

  return (
    <div className="space-y-6">
      {/* AI draft from notes */}
      <Card className="border-primary/20 bg-accent/30">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-primary" /> Quick notes → AI draft
          </CardTitle>
          <CardDescription>
            Jot a few notes; AI drafts the report from them plus the lesson transcript and metrics. You edit and publish.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            rows={3}
            placeholder={`e.g. ${studentName.split(" ")[0]} got the method by the end; careless with signs; keen and asked good questions.`}
            value={f.teacher_notes}
            onChange={(e) => set("teacher_notes", e.target.value)}
          />
          <Button onClick={draft} disabled={drafting} variant="default">
            {drafting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {f.ai_drafted ? "Re-draft from notes" : "Draft with AI"}
          </Button>
        </CardContent>
      </Card>

      {/* Editable report */}
      <div className="grid gap-4">
        <Field label="Topics covered">
          <Textarea rows={2} value={f.topics_covered} onChange={(e) => set("topics_covered", e.target.value)} />
        </Field>
        <Field label="How they did">
          <Textarea rows={3} value={f.how_student_did} onChange={(e) => set("how_student_did", e.target.value)} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Strengths">
            <Textarea rows={3} value={f.strengths} onChange={(e) => set("strengths", e.target.value)} />
          </Field>
          <Field label="Areas to work on">
            <Textarea rows={3} value={f.areas_to_work} onChange={(e) => set("areas_to_work", e.target.value)} />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <Field label="Homework">
              <Textarea rows={2} value={f.homework} onChange={(e) => set("homework", e.target.value)} />
            </Field>
          </div>
          <div className="space-y-4">
            <Field label="Homework due">
              <Input type="date" value={f.homework_due ?? ""} onChange={(e) => set("homework_due", e.target.value || null)} />
            </Field>
            <Field label="Overall rating">
              <Select value={String(f.rating)} onValueChange={(v) => set("rating", Number(v))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n} / 5
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
        </div>

        {/* Follow-up flag */}
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border bg-card p-3">
          <input
            type="checkbox"
            checked={f.needs_followup}
            onChange={(e) => set("needs_followup", e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-[hsl(var(--primary))]"
          />
          <span className="flex-1">
            <span className="text-sm font-medium">Flag for admin follow-up</span>
            <span className="block text-xs text-muted-foreground">
              Raise an action item (e.g. a call to the parent) for the admin team.
            </span>
            {f.needs_followup && (
              <Input
                className="mt-2"
                placeholder="Reason for follow-up"
                value={f.followup_reason}
                onChange={(e) => set("followup_reason", e.target.value)}
              />
            )}
          </span>
        </label>
      </div>

      {msg && <p className={`text-sm ${msg.ok ? "text-success" : "text-destructive"}`}>{msg.text}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" onClick={() => submit(false)} disabled={pending}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save draft
        </Button>
        <Button onClick={() => submit(true)} disabled={pending}>
          <Send className="h-4 w-4" />
          {published ? "Re-publish" : "Publish to parent"}
        </Button>
        {published && <span className="text-xs text-success">Published — visible to parent &amp; student.</span>}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
