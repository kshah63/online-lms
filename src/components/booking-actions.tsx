"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { Loader2, X } from "lucide-react";
import { DateTime } from "luxon";
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
import { BookingDialog } from "@/components/booking-dialog";
import { cancelBooking } from "@/lib/actions/bookings";
import type { ActionResult } from "@/lib/actions/types";

const initial: ActionResult = { ok: false, message: "" };

/** Reschedule + Cancel controls for one booking (admin or the owner). */
export function BookingActions({
  sessionId,
  startISO,
  endISO,
  studentName,
  courseName,
  viewerTz,
}: {
  sessionId: string;
  startISO: string;
  endISO: string;
  studentName: string;
  courseName: string;
  viewerTz: string;
}) {
  const start = DateTime.fromISO(startISO, { zone: "utc" }).setZone(viewerTz);
  const end = DateTime.fromISO(endISO, { zone: "utc" }).setZone(viewerTz);

  return (
    <div className="flex items-center gap-2">
      <BookingDialog
        mode="edit"
        defaultTz={viewerTz}
        edit={{
          sessionId,
          studentName,
          courseName,
          date: start.toISODate() ?? "",
          time: start.toFormat("HH:mm"),
          duration: Math.max(15, Math.round(end.diff(start, "minutes").minutes)),
        }}
      />
      <CancelButton sessionId={sessionId} />
    </div>
  );
}

function CancelButton({ sessionId }: { sessionId: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useFormState(async (_: ActionResult, fd: FormData) => {
    const res = await cancelBooking(fd);
    if (res.ok) setTimeout(() => setOpen(false), 700);
    return res;
  }, initial);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive">
          <X className="h-4 w-4" /> Cancel
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cancel this lesson?</DialogTitle>
          <DialogDescription>This frees the slot. You can book another lesson anytime.</DialogDescription>
        </DialogHeader>
        <form action={formAction} className="space-y-3">
          <input type="hidden" name="session_id" value={sessionId} />
          <Input name="reason" placeholder="Reason (optional)" />
          {state.message && (
            <p className={`text-sm ${state.ok ? "text-success" : "text-destructive"}`}>{state.message}</p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Keep lesson
            </Button>
            <ConfirmCancel />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ConfirmCancel() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="destructive" disabled={pending}>
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
      Cancel lesson
    </Button>
  );
}
