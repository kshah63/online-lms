// ============================================================================
// Sentry scrubbers shared by sentry.client/server/edge.config.ts.
//
// Pencil authorize URLs log a browser into Pencil (valid 3600 s): they are
// CREDENTIALS. Scrub `token=`-style query params and anything after
// `/authorize` from every string before it leaves the process or the browser
// (fetch/navigation breadcrumbs, request urls, error messages, extras).
// PencilError messages never carry URLs, but a stray `console.error(url)`
// breadcrumb would. No "server-only" guard: the browser config uses this too.
// ============================================================================

const TOKEN_PARAM = /([?&#;]|\b)(token|access_token|id_token|refresh_token|authToken)=([^&#\s"']*)/gi;
const AUTHORIZE_QUERY = /(\/authorize[^\s"'?#]*)\?[^\s"'#]*/gi;

export function scrubString(value: string): string {
  return value.replace(TOKEN_PARAM, "$1$2=[redacted]").replace(AUTHORIZE_QUERY, "$1?[redacted]");
}

/** Recursively scrub every string in a plain JSON-ish value (depth-capped). */
export function scrubDeep<T>(value: T, depth = 0): T {
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
export interface ScrubbableEvent {
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
export function scrubEvent<E extends ScrubbableEvent>(event: E): E {
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
