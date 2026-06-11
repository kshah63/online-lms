import { DateTime } from "luxon";

// ============================================================================
// Timezone helpers — §2: store everything in UTC, render in the viewer's tz.
// The single most common source of scheduling bugs; centralised here.
// ============================================================================

/** Format a UTC ISO timestamp in a viewer's IANA timezone. */
export function formatInTz(
  utcISO: string,
  tz: string,
  fmt: string = "ccc d LLL, h:mm a",
): string {
  return DateTime.fromISO(utcISO, { zone: "utc" }).setZone(tz).toFormat(fmt);
}

/** "9:00 – 10:00 AM" style range, rendered in the viewer's tz. */
export function formatRange(startISO: string, endISO: string, tz: string): string {
  const start = DateTime.fromISO(startISO, { zone: "utc" }).setZone(tz);
  const end = DateTime.fromISO(endISO, { zone: "utc" }).setZone(tz);
  const sameMeridiem = start.toFormat("a") === end.toFormat("a");
  return `${start.toFormat(sameMeridiem ? "h:mm" : "h:mm a")} – ${end.toFormat("h:mm a")}`;
}

/** Short timezone label, e.g. "SGT", "EDT". */
export function tzAbbrev(tz: string, atISO?: string): string {
  const dt = atISO ? DateTime.fromISO(atISO, { zone: "utc" }).setZone(tz) : DateTime.now().setZone(tz);
  return dt.toFormat("ZZZZ");
}

/** Time-of-day in the viewer's tz, e.g. "09:00". */
export function clockInTz(utcISO: string, tz: string): string {
  return DateTime.fromISO(utcISO, { zone: "utc" }).setZone(tz).toFormat("h:mm a");
}

/** Human relative label: Today / Tomorrow / weekday, in the viewer's tz. */
export function dayLabel(utcISO: string, tz: string): string {
  const dt = DateTime.fromISO(utcISO, { zone: "utc" }).setZone(tz).startOf("day");
  const today = DateTime.now().setZone(tz).startOf("day");
  const diff = dt.diff(today, "days").days;
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  return dt.toFormat("cccc d LLL");
}

/**
 * UTC window [startUTC, endUTC) covering a calendar day in `tz`.
 * Used to query "today's sessions" correctly for any viewer.
 */
export function dayWindowUTC(tz: string, dayISO?: string): { startUTC: string; endUTC: string } {
  const base = dayISO
    ? DateTime.fromISO(dayISO, { zone: tz })
    : DateTime.now().setZone(tz);
  const start = base.startOf("day");
  return {
    startUTC: start.toUTC().toISO()!,
    endUTC: start.plus({ days: 1 }).toUTC().toISO()!,
  };
}

/** Combine a local date + time in a tz into a UTC ISO string (for scheduling). */
export function localToUTC(dateISO: string, time: string, tz: string): string {
  return DateTime.fromISO(`${dateISO}T${time}`, { zone: tz }).toUTC().toISO()!;
}

/** Is the given UTC instant in the past? */
export function isPast(utcISO: string): boolean {
  return DateTime.fromISO(utcISO, { zone: "utc" }) < DateTime.utc();
}

/** Minutes until a UTC instant (negative if past). */
export function minutesUntil(utcISO: string): number {
  return Math.round(DateTime.fromISO(utcISO, { zone: "utc" }).diff(DateTime.utc(), "minutes").minutes);
}

/** A curated set of common IANA timezones for pickers. */
export const COMMON_TIMEZONES: string[] = [
  "Pacific/Auckland",
  "Australia/Sydney",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Asia/Shanghai",
  "Asia/Singapore",
  "Asia/Kolkata",
  "Asia/Dubai",
  "Europe/Moscow",
  "Europe/Istanbul",
  "Europe/Paris",
  "Europe/London",
  "Atlantic/Reykjavik",
  "America/Sao_Paulo",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Pacific/Honolulu",
  "UTC",
];

/** The viewer's browser timezone, falling back to UTC. */
export function guessBrowserTz(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
