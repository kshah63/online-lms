// ============================================================================
// Where a ticket may send someone. The hand-off from the app (docs/INTEGRATION.md
// "Zero-login hand-off") carries next=/lesson/<id>; a redeemed ticket may only
// land on a relative path of this site, never on another origin.
// ============================================================================

/** A safe same-site path, or null: must start with one "/", carry no scheme, host or control characters. */
export function safeRelativePath(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const next = input.trim();
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(next)) return null;
  if (/^\/[^/?#]*:/.test(next)) return null; // "/javascript:..." style tricks
  return next;
}

/** The fragment of a ticket URL: #t=<token>&next=<path>. */
export function parseTicketFragment(hash: string): { token: string | null; next: string | null } {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  const params = new URLSearchParams(raw);
  const token = params.get("t");
  return { token: token && token.length > 0 ? token : null, next: safeRelativePath(params.get("next")) };
}
