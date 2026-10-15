// Sentry — browser runtime. Env-gated; no-op without a DSN.
// Session Replay is intentionally NOT enabled: the app shows minors' lessons
// and personal data, and replay records the DOM.
import * as Sentry from "@sentry/nextjs";
import { scrubDeep, scrubEvent } from "./src/lib/sentry-scrub";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  environment: process.env.NEXT_PUBLIC_SENTRY_ENV ?? process.env.VERCEL_ENV ?? "development",
  tracesSampleRate: Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
  sendDefaultPii: false,
  // Pencil authorize URLs are credentials: scrub token=/…/authorize? from
  // navigation/fetch breadcrumbs, request urls, messages and extras.
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
