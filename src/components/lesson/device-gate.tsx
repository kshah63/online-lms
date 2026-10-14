"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft, Laptop, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { lessonFitsScreen } from "@/lib/lessons/device";
import { dayLabel, formatRange, tzAbbrev } from "@/lib/time";

/**
 * No lessons from a phone. The gate measures the screen before the room
 * mounts — so before the video stage asks for a Daily token, before the
 * notebook loads, before any channel opens — and on a screen too small for
 * the room shows a notice with the lesson's time and the student's name
 * instead. A window widened to fit shows the room; a window narrowed once
 * the room is up keeps it, because tearing down a live call over a drag of
 * the window edge would be worse than a cramped notebook.
 */
export function LessonDeviceGate({
  startISO,
  endISO,
  tz,
  courseName,
  studentName,
  backHref,
  children,
}: {
  startISO: string;
  endISO: string;
  tz: string;
  courseName: string;
  studentName: string;
  backHref: string;
  children: React.ReactNode;
}) {
  const fits = useScreenFits();
  const [admitted, setAdmitted] = useState(false);
  useEffect(() => {
    if (fits) setAdmitted(true);
  }, [fits]);

  if (admitted) return <>{children}</>;

  if (fits == null) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Opening the lesson…
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Laptop className="h-7 w-7" />
      </div>
      <div>
        <h1 className="text-lg font-semibold">Open this lesson on a laptop or tablet</h1>
        <p className="mt-2 text-sm font-medium">
          {courseName} · {studentName}
        </p>
        <p className="text-sm text-muted-foreground">
          {dayLabel(startISO, tz)}, {formatRange(startISO, endISO, tz)} {tzAbbrev(tz, startISO)}
        </p>
        <p className="mt-3 max-w-sm text-sm text-muted-foreground">
          The room puts the notebook and the video side by side, which a phone screen cannot hold. Open the same link on a laptop
          or a tablet and the lesson starts there.
        </p>
      </div>
      <Button asChild variant="outline">
        <Link href={backHref}>
          <ChevronLeft className="h-4 w-4" /> Back
        </Link>
      </Button>
    </div>
  );
}

/** Whether the screen fits the room; null until the first client measurement. Re-measured on resize and when the pointer kind changes. */
function useScreenFits(): boolean | null {
  const [fits, setFits] = useState<boolean | null>(null);
  useEffect(() => {
    const coarse = window.matchMedia("(pointer: coarse)");
    const update = () => setFits(lessonFitsScreen(window.innerWidth, coarse.matches));
    update();
    window.addEventListener("resize", update);
    coarse.addEventListener("change", update);
    return () => {
      window.removeEventListener("resize", update);
      coarse.removeEventListener("change", update);
    };
  }, []);
  return fits;
}
