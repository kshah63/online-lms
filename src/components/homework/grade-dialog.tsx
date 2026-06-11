"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, RotateCcw } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { gradeHomework } from "@/lib/actions/homework";

export function GradeDialog({ homeworkId, backHref }: { homeworkId: string; backHref: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [correct, setCorrect] = useState("");
  const [incorrect, setIncorrect] = useState("");
  const [notDone, setNotDone] = useState("");
  const [feedback, setFeedback] = useState("");

  function num(v: string): number | null {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
  }

  function submit(verified: boolean) {
    start(async () => {
      await gradeHomework(homeworkId, {
        verified,
        correct: num(correct),
        incorrect: num(incorrect),
        notDone: num(notDone),
        feedback: feedback || null,
      });
      setOpen(false);
      router.push(backHref);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="success">
          <CheckCircle2 className="h-4 w-4" /> Grade
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Grade homework</DialogTitle>
          <DialogDescription>Record marks and a comment. The student and parent will see this.</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <Label className="text-success">Correct</Label>
            <Input type="number" min={0} value={correct} onChange={(e) => setCorrect(e.target.value)} placeholder="0" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-destructive">Incorrect</Label>
            <Input type="number" min={0} value={incorrect} onChange={(e) => setIncorrect(e.target.value)} placeholder="0" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-warning-foreground">Not done</Label>
            <Input type="number" min={0} value={notDone} onChange={(e) => setNotDone(e.target.value)} placeholder="0" />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Comment for the student / parent</Label>
          <Textarea rows={3} value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="e.g. Great effort — review question 4." />
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" disabled={pending} onClick={() => submit(false)}>
            <RotateCcw className="h-4 w-4" /> Send back to redo
          </Button>
          <Button variant="success" disabled={pending} onClick={() => submit(true)}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Mark complete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
