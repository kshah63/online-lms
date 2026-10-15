// Sentry — server runtime. Loaded via src/instrumentation.ts.
// Entirely env-gated: with no DSN set, init is disabled and this is a no-op,
// so the app runs exactly as before until you opt in.
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;

// Pencil authorize URLs log a browser into Pencil (valid 3600 s): a credential.
// Scrub `token=`-style query params and anything after `/authorize` from every
// string before it leaves the process (fetch breadcrumbs, request urls, error
// messages, extras). PencilError messages never carry URLs, but a stray
// `console.error(url)` breadcrumb would.
const TOKEN_PARAM = /([?&#;]|\b)(token|access_token|id_token|refresh_token|authToken)=([^&#\s"']*)/gi;
const AUTHORIZE_QUERY = /(\/authorize[^\s"'?#]*)\?[^\s"'#]*/gi;

function scrubString(value: string): string {
  return value.replace(TOKEN_PARAM, "$1$2=[redacted]").replace(AUTHORIZE_QUERY, "$1?[redacted]");
}

function scrubDeep<T>(value: T, depth = 0): T {
  if (value === null || value === undefined || depth > 12) return value;
  if (typeof value === "string") return scrubString(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => scrubDeep(v, depth + 1)) as unknown as T;
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = scrubDeep(v, depth + 1);
    return out as T;
  }
  return value;
}

/** The parts of an error/transaction event that can carry a URL or message. */
interface ScrubbableEvent {
  request?: unknown;
  message?: unknown;
  transaction?: unknown;
  exception?: { values?: { value?: string }[] };
  breadcrumbs?: unknown;
  extra?: unknown;
  contexts?: unknown;
  tags?: unknown;
}

/** Targeted (not whole-event) so Sentry's internal, non-JSON metadata is left intact. */
function scrubEvent<E extends ScrubbableEvent>(event: E): E {
  if (event.request !== undefined) event.request = scrubDeep(event.request);
  if (event.message !== undefined) event.message = scrubDeep(event.message);
  if (event.transaction !== undefined) event.transaction = scrubDeep(event.transaction);
  const values = event.exception?.values;
  if (values) {
    for (const v of values) if (typeof v.value === "string") v.value = scrubString(v.value);
  }
  if (event.breadcrumbs !== undefined) event.breadcrumbs = scrubDeep(event.breadcrumbs);
  if (event.extra !== undefined) event.extra = scrubDeep(event.extra);
  if (event.contexts !== undefined) event.contexts = scrubDeep(event.contexts);
  if (event.tags !== undefined) event.tags = scrubDeep(event.tags);
  return event;
}

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  environment: process.env.NEXT_PUBLIC_SENTRY_ENV ?? process.env.VERCEL_ENV ?? "development",
  tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
  // We deal with minors' data — never capture request bodies/PII by default.
  sendDefaultPii: false,
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
