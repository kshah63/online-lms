"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { voidAttemptAction } from "@/lib/actions/attempts";

/** Void an attempt (rpc void_attempt) after a confirmation; the refusal's sentence is shown as it came. */
export function VoidAttemptButton({ attemptId, studentName }: { attemptId: string; studentName: string }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  return (
    <>
      <Button variant="destructive" size="sm" onClick={() => setOpen(true)}>
        <Ban className="h-4 w-4" /> Void attempt
      </Button>
      {message && <span className="text-sm text-destructive">{message}</span>}
      <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Void this attempt?</DialogTitle>
            <DialogDescription>
              The mark will not count for {studentName} and the attempt is kept, with its events, as voided. This cannot be undone; set the test again if they should retake it.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Keep it
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const res = await voidAttemptAction(attemptId);
                  if (res.ok) {
                    setOpen(false);
                    router.refresh();
                  } else {
                    setMessage(res.message);
                    setOpen(false);
                  }
                })
              }
            >
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />} Void attempt
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
