"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Route error boundary for the lesson room. A thrown error (a failed Space
 * lookup, a Pencil misconfiguration surfacing server-side, …) renders this
 * instead of blanking the page, and "Try again" re-renders the segment.
 */
export default function LessonError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error(error);
  }, [error]);

  return (
    <div className="flex h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertTriangle className="h-7 w-7" />
      </div>
      <div>
        <h1 className="text-lg font-semibold">The classroom couldn&rsquo;t be opened</h1>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          Something went wrong while loading this lesson. Try again, or go back to your dashboard — if it keeps
          happening, contact an admin.
        </p>
        {error.digest && <p className="mt-2 font-mono text-xs text-muted-foreground">Digest: {error.digest}</p>}
      </div>
      <div className="flex gap-2">
        <Button onClick={reset}>Try again</Button>
        <Button asChild variant="outline">
          <Link href="/">
            <ChevronLeft className="h-4 w-4" /> Back to dashboard
          </Link>
        </Button>
      </div>
    </div>
  );
}
