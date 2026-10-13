"use client";

import { Sparkles } from "lucide-react";
import { SessionReportEditor } from "@/components/teacher/session-report-editor";
import { draftSessionReportAction, submitSessionReportAction } from "@/lib/actions/session-report";
import type { SessionReportDraft } from "@/lib/reports/mvapp-template";

/** Binds the editor to the server actions for one lesson. */
export function ReportEditorClient({
  sessionId,
  studentName,
  course,
  topicOptions,
  bookedTopic,
  signs,
  initial,
  rationale,
  source,
}: {
  sessionId: string;
  studentName: string;
  course: string;
  topicOptions: string[];
  bookedTopic: string | null;
  signs: boolean;
  initial: SessionReportDraft | null;
  rationale: string | null;
  source: "ai" | "heuristic" | null;
}) {
  return (
    <div className="space-y-4">
      {initial && (
        <div className="flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div>
            <div className="font-medium">Prefilled from the {source === "ai" ? "AI" : "heuristic"} draft of this lesson.</div>
            {rationale && <p className="mt-0.5 text-muted-foreground">{rationale}</p>}
          </div>
        </div>
      )}
      <SessionReportEditor
        studentName={studentName}
        course={course}
        topicOptions={topicOptions}
        bookedTopic={bookedTopic}
        signs={signs}
        initial={initial}
        onDraft={(notes) => draftSessionReportAction({ sessionId, notes, topicOptions })}
        onSubmit={(draft) => submitSessionReportAction(sessionId, draft)}
      />
    </div>
  );
}
