import { DateTime } from "luxon";

function dt(iso: string, tz: string) {
  return DateTime.fromISO(iso, { zone: "utc" }).setZone(tz || "UTC");
}

export function fmtDateTime(iso: string, tz = "UTC"): string {
  return dt(iso, tz).toFormat("ccc d LLL, h:mm a");
}

export function fmtTime(iso: string, tz = "UTC"): string {
  return dt(iso, tz).toFormat("h:mm a");
}

export function fmtDate(iso: string, tz = "UTC"): string {
  return dt(iso, tz).toFormat("ccc d LLL yyyy");
}

/** "Today", "Tomorrow", or a date — for grouping upcoming lessons. */
export function relativeDay(iso: string, tz = "UTC"): string {
  const d = dt(iso, tz).startOf("day");
  const today = DateTime.now().setZone(tz || "UTC").startOf("day");
  const diff = Math.round(d.diff(today, "days").days);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  return d.toFormat("ccc d LLL");
}

export function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
