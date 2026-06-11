"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Tldraw,
  PageRecordType,
  getSnapshot,
  type Editor,
  type TLPageId,
} from "tldraw";
import "tldraw/tldraw.css";
import { CheckCircle2, ChevronLeft, Loader2, Send, Sparkles } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AttachmentsBar } from "@/components/homework/attachments-bar";
import { GradeDialog } from "@/components/homework/grade-dialog";
import { HomeworkMarks } from "@/components/homework/homework-marks";
import { useNotebookSync } from "@/lib/notebook/use-notebook-sync";
import { saveNotebookSnapshot } from "@/lib/actions/notebook";
import { setHomeworkPage, submitHomework } from "@/lib/actions/homework";
import type { HomeworkAttachment, HomeworkStatus } from "@/lib/types";

interface CanvasProps {
  homeworkId: string;
  description: string;
  courseName: string;
  studentName: string;
  status: HomeworkStatus;
  reviewNote: string | null;
  notebookId: string;
  pageId: string | null;
  userId: string;
  userName: string;
  initialSnapshot: unknown | null;
  mode: "student" | "review" | "view";
  backHref: string;
  attachments: HomeworkAttachment[];
  marks: { correct: number | null; incorrect: number | null; notDone: number | null; feedback: string | null };
}

const STATUS: Record<HomeworkStatus, { label: string; variant: React.ComponentProps<typeof Badge>["variant"] }> = {
  assigned: { label: "To do", variant: "secondary" },
  submitted: { label: "Submitted — awaiting review", variant: "default" },
  completed: { label: "Verified", variant: "success" },
  incomplete: { label: "Sent back — redo", variant: "warning" },
};

export function HomeworkCanvas(props: CanvasProps) {
  const router = useRouter();
  const editorRef = useRef<Editor | null>(null);
  const sync = useNotebookSync({
    notebookId: props.notebookId,
    userId: props.userId,
    userName: props.userName,
    initialSnapshot: props.initialSnapshot,
  });

  const handleMount = (editor: Editor) => {
    editorRef.current = editor;
    sync.onMount(editor);

    const tag = `HW#${props.homeworkId}`;
    const existing = editor.getPages().find((p) => p.name.startsWith(tag));

    if (props.pageId && editor.getPage(props.pageId as TLPageId)) {
      editor.setCurrentPage(props.pageId as TLPageId);
    } else if (existing) {
      editor.setCurrentPage(existing.id);
    } else {
      const id = PageRecordType.createId();
      editor.createPage({ id, name: `${tag} · ${props.description.slice(0, 32)}` });
      editor.setCurrentPage(id);
      void setHomeworkPage(props.homeworkId, id);
    }
  };

  useEffect(() => sync.dispose, [sync.dispose]);

  async function flush() {
    const editor = editorRef.current;
    if (editor && sync.syncing) {
      try {
        await saveNotebookSnapshot(props.notebookId, getSnapshot(editor.store));
      } catch {
        /* best effort */
      }
    }
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-card px-3 md:px-4">
        <Button asChild variant="ghost" size="sm">
          <Link href={props.backHref}>
            <ChevronLeft className="h-4 w-4" /> Back
          </Link>
        </Button>
        <div className="hidden h-6 w-px bg-border sm:block" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold">{props.courseName} — homework</span>
            <Badge variant={STATUS[props.status].variant}>{STATUS[props.status].label}</Badge>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            {props.mode === "review" && <Avatar name={props.studentName} size={16} />}
            <span className="truncate">{props.description}</span>
          </div>
        </div>

        <Actions {...props} flush={flush} onDone={() => router.push(props.backHref)} />
      </header>

      <div className="border-b bg-accent/30 px-4 py-1.5 text-center text-xs text-muted-foreground">
        <Sparkles className="mr-1 inline h-3 w-3" />
        Do the work on this page — draw your working, type, <strong>drag a photo onto the canvas</strong>, or attach a PDF below.
      </div>

      <AttachmentsBar homeworkId={props.homeworkId} initial={props.attachments} canUpload={props.mode !== "review"} />

      <div className="relative flex-1">
        <div className="absolute inset-0">
          <Tldraw onMount={handleMount} persistenceKey={sync.syncing ? undefined : `notebook-${props.notebookId}`} />
        </div>
      </div>

      {/* Graded result — visible to student/parent and the teacher. */}
      {(props.status === "completed" || props.status === "incomplete") &&
        (props.marks.correct != null ||
          props.marks.incorrect != null ||
          props.marks.notDone != null ||
          props.marks.feedback) && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t bg-card px-4 py-2 text-sm">
            <HomeworkMarks
              correct={props.marks.correct}
              incorrect={props.marks.incorrect}
              notDone={props.marks.notDone}
            />
            {props.marks.feedback && <span className="text-muted-foreground">“{props.marks.feedback}”</span>}
          </div>
        )}
    </div>
  );
}

/** Student submits; teacher grades. */
function Actions({
  mode,
  status,
  homeworkId,
  backHref,
  flush,
  onDone,
}: CanvasProps & { flush: () => Promise<void>; onDone: () => void }) {
  const [pending, start] = useTransition();

  if (mode === "student") {
    if (status === "assigned" || status === "incomplete") {
      return (
        <Button
          size="sm"
          disabled={pending}
          onClick={() =>
            start(async () => {
              await flush();
              await submitHomework(homeworkId);
              onDone();
            })
          }
        >
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Submit for review
        </Button>
      );
    }
    return null;
  }

  if (mode === "review" && status === "submitted") {
    return <GradeDialog homeworkId={homeworkId} backHref={backHref} />;
  }

  return null;
}
