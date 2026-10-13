"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, ShieldX } from "lucide-react";
import { BrandWordmark } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { isDemoMode } from "@/lib/env";
import { parseTicketFragment } from "@/lib/join/path";

/**
 * The ticket hand-off from the app: /join#t=<token>&next=/lesson/<id>. The token
 * lives in the fragment, so it never reaches a server log or a Referer; this
 * page posts it to /api/join, which redeems it and sets the session cookie.
 */
export default function JoinPage() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const { token, next } = parseTicketFragment(window.location.hash);
    const dest = next ?? "/";

    if (isDemoMode) {
      window.location.replace(dest);
      return;
    }
    if (!token) {
      setError("This link is missing its ticket. Open the lesson from the MathVision app again.");
      return;
    }

    let cancelled = false;
    fetch("/api/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, next: dest }),
    })
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as { next?: string; error?: string };
        if (cancelled) return;
        if (res.ok && body.next) {
          window.location.replace(body.next);
          return;
        }
        setError(body.error ?? "This link could not be opened.");
      })
      .catch(() => !cancelled && setError("We could not reach the room. Check your connection and try again."));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-5 px-6 text-center">
      <BrandWordmark size={32} textClassName="text-lg" />
      {error ? (
        <>
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <ShieldX className="h-7 w-7" />
          </div>
          <div className="max-w-sm">
            <h1 className="text-lg font-semibold">We couldn&rsquo;t open your lesson</h1>
            <p className="mt-2 text-sm text-muted-foreground">{error}</p>
          </div>
          <Button asChild variant="outline">
            <Link href="/login">Sign in instead</Link>
          </Button>
        </>
      ) : (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Opening your lesson…
        </p>
      )}
    </div>
  );
}
