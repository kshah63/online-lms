// Sentry — server runtime. Loaded via src/instrumentation.ts.
// Entirely env-gated: with no DSN set, init is disabled and this is a no-op,
// so the app runs exactly as before until you opt in.
import * as Sentry from "@sentry/nextjs";
import { scrubDeep, scrubEvent } from "./src/lib/sentry-scrub";

const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  environment: process.env.NEXT_PUBLIC_SENTRY_ENV ?? process.env.VERCEL_ENV ?? "development",
  tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
  // We deal with minors' data — never capture request bodies/PII by default.
  sendDefaultPii: false,
  // Pencil authorize URLs are credentials: scrub token=/…/authorize? everywhere.
  beforeSend(event) {
    return scrubEvent(event);
  },
  beforeSendTransaction(event) {
    return scrubEvent(event);
  },
  beforeBreadcrumb(breadcrumb) {
    return scrubDeep(breadcrumb);
  },
});
