import "server-only";
import * as Sentry from "@sentry/nextjs";

/**
 * Report a caught server-side error to Sentry (no-op without a DSN) while also
 * logging it. Use in catch blocks where we recover (e.g. AI falls back to a
 * heuristic) but still want visibility into the failure.
 */
export function captureError(error: unknown, context?: Record<string, unknown>) {
  console.error(context?.where ?? "error:", error);
  Sentry.captureException(error, context ? { extra: context } : undefined);
}
