import { vi } from "vitest";
import type { Row } from "./fake-db";

/** One recorded request to the fake Pencil API. */
export interface Call {
  method: string;
  path: string;
  body: Row | null;
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

/**
 * Stub `fetch` with a fake Pencil API: handlers are keyed `"<METHOD> <path
 * prefix>"` (path relative to `/public/api/`, query string included) and get
 * the call plus how many times that handler has run. Unhandled requests answer
 * 599 so a test fails loudly instead of hanging on retries. Every call is
 * recorded in `calls` — assert on them (never on the real network).
 */
export function pencilServer(handlers: Record<string, (call: Call, n: number) => Response>) {
  const calls: Call[] = [];
  const seen: Record<string, number> = {};
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
    const method = (init?.method ?? "GET").toUpperCase();
    const path = url.pathname.replace(/^\/public\/api\//, "") + url.search;
    const body = init?.body ? (JSON.parse(String(init.body)) as Row) : null;
    const call = { method, path, body };
    calls.push(call);
    const key = Object.keys(handlers).find((k) => {
      const [m, p] = k.split(" ") as [string, string];
      return m === method && (path === p || path.startsWith(p));
    });
    if (!key) return json({ err: `unhandled ${method} ${path}`, error_code: "TEST_UNHANDLED" }, 599);
    seen[key] = (seen[key] ?? 0) + 1;
    return handlers[key]!(call, seen[key]!);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}
