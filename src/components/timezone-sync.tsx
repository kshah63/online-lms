"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { syncTimezone } from "@/lib/actions/profile";

/**
 * Keeps the viewer's timezone following their device. On mount, if the
 * browser's detected zone differs from the stored profile timezone, update it
 * and refresh so every (server-rendered) time re-renders in the new zone.
 * Disabled in demo mode (nothing to persist).
 */
export function TimezoneSync({ currentTz, enabled }: { currentTz: string; enabled: boolean }) {
  const router = useRouter();
  const done = useRef(false);

  useEffect(() => {
    if (!enabled || done.current) return;
    let browserTz = "";
    try {
      browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return;
    }
    if (!browserTz || browserTz === currentTz) return;
    done.current = true;
    syncTimezone(browserTz)
      .then(() => router.refresh())
      .catch(() => {});
  }, [enabled, currentTz, router]);

  return null;
}
