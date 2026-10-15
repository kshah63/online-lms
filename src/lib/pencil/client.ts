import "server-only";
import type { z } from "zod";
import { isDemoMode } from "@/lib/env";
import {
  PencilApiSpaceListSchema,
  PencilApiSpaceSchema,
  PencilApiUserSchema,
  PencilAuthorizeResponseSchema,
  PencilEmptySchema,
  PencilEndOngoingSessionSchema,
  PencilErrorBodySchema,
  PencilWebhookConfigSchema,
  type CreateApiUserBody,
  type CreateSpaceBody,
  type PatchUserBody,
  type PencilApiSpace,
  type SpaceSettingsPatch,
  type UpdateSpaceUsersBody,
  type WebhookConfigBody,
} from "@/lib/pencil/types";

// ============================================================================
// Pencil Spaces HTTP client (server-only). Thin typed wrappers over `fetch`
// with a timeout and 429/5xx back-off. Everything here uses the institution
// API key, so EVERY caller must run an explicit authorization check first
// (canJoinLesson / canHostSpace / requireRole('admin')) — RLS does not protect
// the admin client and Pencil knows nothing about our roles.
//
// Secrets: the key never leaves this module; authorize URLs are credentials
// (valid 3600 s) — callers return them from POST/bearer routes only, never
// render, log or persist them. Error messages built here contain status +
// Pencil's error code/text, never the URL that was called.
// ============================================================================

const KEY = (process.env.PENCIL_SPACES_API_KEY ?? "").trim();

/** Trailing slash guaranteed; staging is https://staging-apis.pencilapp.com/public/api/ */
export const PENCIL_API_BASE_URL = (
  (process.env.PENCIL_API_BASE_URL ?? "").trim() || "https://apis.pencilapp.com/public/api/"
).replace(/\/?$/, "/");

/** An API key is present. */
export const pencilConfigured = Boolean(KEY);

/**
 * Real HTTP happens only when a key is set AND we're not in demo mode. When
 * false, provision.ts / urls.ts short-circuit to mock.ts and the wrappers below
 * throw `PencilError(0, …, 'NOT_CONFIGURED')` instead of touching the network.
 */
export const pencilLive = pencilConfigured && !isDemoMode;

export class PencilError extends Error {
  readonly name = "PencilError";
  constructor(
    /** HTTP status; 0 = no response (timeout / network / not configured / bad response shape). */
    public readonly status: number,
    /** Pencil's `err` (or `error`) text, or our own short description. */
    public readonly err?: string,
    /** Pencil's `error_code`, or TIMEOUT | NETWORK | NOT_CONFIGURED | INVALID_RESPONSE | … */
    public readonly error_code?: string,
  ) {
    super(`Pencil ${status}${error_code ? ` ${error_code}` : ""}${err ? `: ${err}` : ""}`);
  }

  /** 429 / 5xx / timeout / network — retryable, and a reason to offer the fallback link. */
  get transient(): boolean {
    return this.status === 0 ? this.error_code === "TIMEOUT" || this.error_code === "NETWORK" : this.status === 429 || this.status >= 500;
  }
}

export interface PencilFetchOptions {
  /** Abort after this long (per attempt). */
  timeoutMs?: number;
  /** Extra attempts after the first on 429 / 5xx / timeout / network. */
  retries?: number;
  /** Base back-off (ms); attempt n waits `base * (n+1) + jitter`, or Retry-After when sent. */
  backoffBaseMs?: number;
}

/** Background jobs: generous timeout, two retries. */
export const JOB_FETCH: PencilFetchOptions = { timeoutMs: 15_000, retries: 2 };
/** The join path (authorize, endOngoingSession): fast fail, no retry — the UI offers the fallback. */
export const JOIN_FETCH: PencilFetchOptions = { timeoutMs: 5_000, retries: 0 };

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function retryDelayMs(attempt: number, base: number, retryAfterHeader: string | null): number {
  const retryAfter = retryAfterHeader ? Number(retryAfterHeader) : NaN;
  if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(retryAfter * 1000, 10_000);
  return base * (attempt + 1) + Math.random() * Math.min(base / 3, 500);
}

/**
 * Low-level call. `path` is relative to PENCIL_API_BASE_URL (leading slash
 * optional). The JSON body is validated with `schema`; a shape mismatch throws
 * `PencilError(status, …, 'INVALID_RESPONSE')` rather than leaking `any`.
 */
export async function pencilFetch<T>(
  path: string,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  init: RequestInit = {},
  opts: PencilFetchOptions = {},
): Promise<T> {
  if (!pencilLive) throw new PencilError(0, "Pencil Spaces is not configured", "NOT_CONFIGURED");

  const { timeoutMs = JOB_FETCH.timeoutMs!, retries = JOB_FETCH.retries!, backoffBaseMs = 1500 } = opts;
  const url = PENCIL_API_BASE_URL + path.replace(/^\//, "");

  for (let attempt = 0; ; attempt++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(url, {
        ...init,
        cache: "no-store",
        signal: ctl.signal,
        headers: {
          Authorization: `Bearer ${KEY}`,
          Accept: "application/json",
          "Content-Type": "application/json",
          ...(init.headers ?? {}),
        },
      });
    } catch (cause) {
      clearTimeout(timer);
      const aborted = cause instanceof Error && cause.name === "AbortError";
      if (attempt < retries) {
        await sleep(retryDelayMs(attempt, backoffBaseMs, null));
        continue;
      }
      throw new PencilError(0, aborted ? `Timed out after ${timeoutMs} ms` : "Network error", aborted ? "TIMEOUT" : "NETWORK");
    }
    clearTimeout(timer);

    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      await sleep(retryDelayMs(attempt, backoffBaseMs, res.headers.get("retry-after")));
      continue;
    }

    const text = await res.text();
    let body: unknown = {};
    if (text.trim()) {
      try {
        body = JSON.parse(text);
      } catch {
        body = {};
      }
    }

    if (!res.ok) {
      const parsed = PencilErrorBodySchema.safeParse(body);
      const e = parsed.success ? parsed.data : {};
      throw new PencilError(res.status, e.err ?? e.error ?? res.statusText, e.error_code);
    }

    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      const where = parsed.error.issues.map((i) => i.path.join(".") || "(root)").slice(0, 5).join(", ");
      throw new PencilError(res.status, `Unexpected response shape at ${where}`, "INVALID_RESPONSE");
    }
    return parsed.data;
  }
}

const seg = (id: string) => encodeURIComponent(id);

/** Filters for list endpoints travel as `?filters=<base64(JSON)>`. */
export function encodeFilters(filters: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(filters), "utf8").toString("base64");
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

/** `POST /users/createAPIUser` → `{userId, email, …}`. externalId should be our profiles.id. */
export function createApiUser(body: CreateApiUserBody, opts?: PencilFetchOptions) {
  return pencilFetch(
    "users/createAPIUser",
    PencilApiUserSchema,
    { method: "POST", body: JSON.stringify(body) },
    opts,
  );
}

/** `PATCH /users/{userId}` (rename on display_name change). */
export function patchUser(userId: string, body: PatchUserBody, opts?: PencilFetchOptions) {
  return pencilFetch(`users/${seg(userId)}`, PencilApiUserSchema, { method: "PATCH", body: JSON.stringify(body) }, opts);
}

/**
 * `GET /users/{userId}/authorize?redirectUrl=…` → `{url}`. 5 s, no retry.
 * `redirectUrl` must be the FULL Space URL including params (see urls.ts).
 * The returned url logs the browser into Pencil as that user — a credential.
 */
export function authorizeUrl(userId: string, redirectUrl: string, opts: PencilFetchOptions = JOIN_FETCH) {
  return pencilFetch(
    `users/${seg(userId)}/authorize?redirectUrl=${encodeURIComponent(redirectUrl)}`,
    PencilAuthorizeResponseSchema,
    {},
    opts,
  );
}

// ---------------------------------------------------------------------------
// Spaces
// ---------------------------------------------------------------------------

/** `POST /spaces/create`. Defaults: visibility private, notifyInvitees false. */
export function createSpace(body: CreateSpaceBody, opts?: PencilFetchOptions) {
  return pencilFetch(
    "spaces/create",
    PencilApiSpaceSchema,
    { method: "POST", body: JSON.stringify({ visibility: "private", notifyInvitees: false, ...body }) },
    opts,
  );
}

/**
 * `GET /spaces?filters=base64({externalId, archiveStatus:'ALL'})` → the Space
 * with exactly that externalId, or null. Used to recover idempotently after a
 * Pencil create succeeded but our DB insert failed.
 */
export async function findSpaceByExternalId(externalId: string, opts?: PencilFetchOptions): Promise<PencilApiSpace | null> {
  const filters = encodeFilters({ externalId, archiveStatus: "ALL" });
  const page = await pencilFetch(
    `spaces?filters=${encodeURIComponent(filters)}&pageSize=10&pageNumber=1`,
    PencilApiSpaceListSchema,
    {},
    opts,
  );
  return page.results.find((s) => s.externalId === externalId) ?? null;
}

/** `GET /spaces/{spaceId}` — also the read-back for settings/hosts. */
export function getSpace(spaceId: string, opts?: PencilFetchOptions) {
  return pencilFetch(`spaces/${seg(spaceId)}`, PencilApiSpaceSchema, {}, opts);
}

/** `PATCH /spaces/{spaceId}/updateUsers` (host/participant changes). notifyInvitees defaults false. */
export function updateSpaceUsers(spaceId: string, body: UpdateSpaceUsersBody, opts?: PencilFetchOptions) {
  return pencilFetch(
    `spaces/${seg(spaceId)}/updateUsers`,
    PencilApiSpaceSchema,
    { method: "PATCH", body: JSON.stringify({ notifyInvitees: false, ...body }) },
    opts,
  );
}

/** `PATCH /spaces/{spaceId}/settings/` → `{}`. Confirm with getSpace() afterwards. */
export function updateSpaceSettings(spaceId: string, settings: SpaceSettingsPatch, opts?: PencilFetchOptions) {
  return pencilFetch(
    `spaces/${seg(spaceId)}/settings/`,
    PencilEmptySchema,
    { method: "PATCH", body: JSON.stringify({ settings }) },
    opts,
  );
}

/**
 * `POST /spaces/{spaceId}/endOngoingSession` → `{endedSessionId, newSessionId}`.
 * 5 s, no retry: called best-effort from "End lesson" so one Pencil session ==
 * one of our lessons and SESSION_ENDED fires promptly.
 */
export function endOngoingSession(spaceId: string, opts: PencilFetchOptions = JOIN_FETCH) {
  return pencilFetch(`spaces/${seg(spaceId)}/endOngoingSession`, PencilEndOngoingSessionSchema, { method: "POST" }, opts);
}

// ---------------------------------------------------------------------------
// Webhooks (one config per institution per environment; consumed in Phase 2)
// ---------------------------------------------------------------------------

/** `POST /webhooks {url, secret}` — create or replace the institution's webhook. */
export function registerWebhook(config: WebhookConfigBody, opts?: PencilFetchOptions) {
  return pencilFetch("webhooks", PencilWebhookConfigSchema, { method: "POST", body: JSON.stringify(config) }, opts);
}

/** `GET /webhooks` → `{url, secret}` or `{}` when none is set. */
export function getWebhook(opts?: PencilFetchOptions) {
  return pencilFetch("webhooks", PencilWebhookConfigSchema, {}, opts);
}
