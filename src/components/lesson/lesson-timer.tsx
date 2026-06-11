"use client";

import { useEffect, useState } from "react";
import { DateTime } from "luxon";

/** Elapsed time since the lesson's scheduled start (or countdown until it). */
export function LessonTimer({ startISO }: { startISO: string }) {
  const [label, setLabel] = useState("");

  useEffect(() => {
    const tick = () => {
      const start = DateTime.fromISO(startISO, { zone: "utc" });
      const diff = DateTime.utc().diff(start, ["hours", "minutes", "seconds"]);
      const total = diff.as("seconds");
      const sign = total < 0 ? "-" : "";
      const abs = Math.abs(total);
      const h = Math.floor(abs / 3600);
      const m = Math.floor((abs % 3600) / 60);
      const s = Math.floor(abs % 60);
      const mm = String(m).padStart(2, "0");
      const ss = String(s).padStart(2, "0");
      setLabel(h > 0 ? `${sign}${h}:${mm}:${ss}` : `${sign}${mm}:${ss}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startISO]);

  return <span className="tabular-nums">{label}</span>;
}
