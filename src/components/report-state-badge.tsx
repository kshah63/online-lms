import Link from "next/link";
import { ExternalLink, PenLine } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { reportState } from "@/lib/data/reports";
import type { OnlineLesson } from "@/lib/types";

/** The universal link the app captures: the session screen, where the report form lives. */
export function appSessionUrl(sessionId: string): string {
  return `https://mathvisionapp.com/sessions/${sessionId}`;
}

/** What my_online_lessons says about a lesson's report, as a badge. */
export function ReportStateBadge({ lesson }: { lesson: OnlineLesson }) {
  switch (reportState(lesson)) {
    case "published":
      return <Badge variant="success">Report published</Badge>;
    case "pending":
      return <Badge variant="secondary">Awaiting approval</Badge>;
    case "rejected":
      return <Badge variant="destructive">Report sent back</Badge>;
    case "draft_ready":
      return <Badge variant="warning">Draft ready</Badge>;
    case "none":
      return <Badge variant="outline">No report yet</Badge>;
  }
}

/** A report can still be written when none exists, one was sent back, or only the draft is waiting. */
export function canWriteReport(lesson: OnlineLesson): boolean {
  const state = reportState(lesson);
  return state !== "published" && state !== "pending";
}

/** The two doors to writing a lesson's report: here, from the draft, or in the app. */
export function WriteReportLinks({ lesson, size = "sm" }: { lesson: OnlineLesson; size?: "sm" | "default" }) {
  const state = reportState(lesson);
  if (!canWriteReport(lesson)) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button asChild size={size} variant={state === "draft_ready" ? "default" : "outline"}>
        <Link href={`/teacher/reports/${lesson.session_id}`}>
          <PenLine className="h-4 w-4" /> {state === "draft_ready" ? "Write from the draft" : "Write here"}
        </Link>
      </Button>
      <Button asChild size={size} variant="ghost">
        <a href={appSessionUrl(lesson.session_id)} target="_blank" rel="noreferrer">
          <ExternalLink className="h-4 w-4" /> Write the report in the app
        </a>
      </Button>
    </div>
  );
}
