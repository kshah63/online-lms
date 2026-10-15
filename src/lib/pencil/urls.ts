import "server-only";
import { isDemoMode } from "@/lib/env";
import type { PencilSpace, Session } from "@/lib/types";
import { authorizeUrl, JOIN_FETCH, PencilError, pencilLive } from "@/lib/pencil/client";
import { mockSpaceLink } from "@/lib/pencil/mock";
import type { JoinPurpose } from "@/lib/pencil/types";

// ============================================================================
// Space URLs, join-URL minting and the outage fallback.
//
// A minted authorize URL logs the browser into Pencil as that user: it is a
// CREDENTIAL. Mint per click inside a POST/bearer route, return it as JSON,
// never put it in server-rendered HTML/RSC props, never log or persist it.
// ============================================================================

export const PENCIL_PRODUCTION_ORIGIN = "https://my.pencilapp.com";
export const PENCIL_STAGING_ORIGIN = "https://staging.pencilapp.com";

function normalizeOrigin(value: string | undefined): string | null {
  const v = (value ?? "").trim();
  if (!v) return null;
  try {
    const u = new URL(v);
    return u.protocol === "https:" ? u.origin : null;
  } catch {
    return null;
  }
}

/** Where the Space UI lives (NEXT_PUBLIC_PENCIL_APP_ORIGIN, default production). */
export const PENCIL_APP_ORIGIN = normalizeOrigin(process.env.NEXT_PUBLIC_PENCIL_APP_ORIGIN) ?? PENCIL_PRODUCTION_ORIGIN;

/**
 * postMessage origins the embed may speak from. The client component must use
 * the same list (it can read NEXT_PUBLIC_PENCIL_APP_ORIGIN itself — this module
 * is server-only) and ALSO check `event.source === iframe.contentWindow`.
 */
export const PENCIL_ALLOWED_ORIGINS: readonly string[] = Array.from(
  new Set([PENCIL_PRODUCTION_ORIGIN, PENCIL_STAGING_ORIGIN, PENCIL_APP_ORIGIN]),
);

export type SpaceUrlParams = Record<string, string | number | boolean | null | undefined>;

/**
 * Space URL params per purpose (api-notes "Space URL params"). They go on the
 * SPACE URL that becomes `redirectUrl`, not on the token URL.
 *  - lesson   (teacher AND student): the call auto-starts when the host does,
 *             participants too (skipCallHostCheck), standalone chrome, embed
 *             events for our clock, gallery view. skipDeviceSetup stays OFF so
 *             the child confirms mic/camera.
 *  - board    second device for writing (iPad): standalone only — no startCall,
 *             the person taps "Not Now" on the call prompt and keeps the speaker off.
 *  - homework Phase 3 deep link: standalone only (no call).
 */
export const JOIN_PARAMS: Readonly<Record<JoinPurpose, SpaceUrlParams>> = {
  lesson: { startCall: true, skipCallHostCheck: true, standalone: true, broadcastEvents: true, gv: true },
  board: { standalone: true },
  homework: { standalone: true },
};

/**
 * Append params to a Space link. Existing query params on the link are kept;
 * `true` → "true", numbers/strings are encoded, `false`/null/undefined are omitted.
 */
export function buildSpaceUrl(link: string, params: SpaceUrlParams = {}): string {
  const url = new URL(link);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === false) continue;
    url.searchParams.set(key, value === true ? "true" : String(value));
  }
  return url.toString();
}

/** The Space URL (link + purpose params) that goes into `redirectUrl`. Mock Spaces get a never-resolving link. */
export function spaceUrlFor(space: Pick<PencilSpace, "id" | "link" | "status">, purpose: JoinPurpose): string {
  const link = space.status === "mock" || !space.link ? mockSpaceLink(space) : space.link;
  return buildSpaceUrl(link, JOIN_PARAMS[purpose]);
}

export interface MintedJoinUrl {
  /** The credential. Return it from the route as JSON; the client sets iframe.src or window.open()s it. */
  url: string;
  /** True when Pencil is mocked — the url is a placeholder on a reserved host; render <MockSpacePanel> instead. */
  mock: boolean;
  purpose: JoinPurpose;
  /** Pencil tokens live 3600 s; re-mint on every click rather than caching. */
  expiresInSeconds: number;
}

/**
 * Mint a login+redirect URL for `viewerPencilUserId` into `space` for `purpose`.
 * One `GET /users/{id}/authorize` call, 5 s timeout, NO retry (JOIN_FETCH) —
 * on failure the caller offers the fallback link. Short-circuits to a mock URL
 * when Pencil is mocked or the Space row is a mock. Throws PencilError
 * ('SPACE_NOT_PROVISIONED') for a live row without a link.
 */
export async function mintJoinUrl(
  viewerPencilUserId: string,
  space: Pick<PencilSpace, "id" | "link" | "pencil_space_id" | "status">,
  purpose: JoinPurpose,
): Promise<MintedJoinUrl> {
  if (!pencilLive || space.status === "mock") {
    // Never hand out a real Pencil link while mocked — the placeholder host can't resolve.
    return { url: buildSpaceUrl(mockSpaceLink(space), JOIN_PARAMS[purpose]), mock: true, purpose, expiresInSeconds: 3600 };
  }
  if (!space.link || !space.pencil_space_id) {
    throw new PencilError(0, "Space row has no Pencil link yet — run ensureSpace first", "SPACE_NOT_PROVISIONED");
  }
  const redirectUrl = buildSpaceUrl(space.link, JOIN_PARAMS[purpose]);
  const { url } = await authorizeUrl(viewerPencilUserId, redirectUrl, JOIN_FETCH);
  return { url, mock: false, purpose, expiresInSeconds: 3600 };
}

// ---------------------------------------------------------------------------
// Outage fallback (owner decision 5: Zoom)
// ---------------------------------------------------------------------------

export function isHttpsUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * The master Zoom link must be https with a zoom.us host (`zoom.us` or any
 * `*.zoom.us`, e.g. `us02web.zoom.us`) — the validation rule for
 * LESSON_FALLBACK_URL.
 */
export function isZoomUrl(value: string | null | undefined): boolean {
  if (!isHttpsUrl(value)) return false;
  const host = new URL(value!).hostname.toLowerCase();
  return host === "zoom.us" || host.endsWith(".zoom.us");
}

/**
 * ONE master Zoom meeting link for the whole school (owner decision 5), from
 * the server env `LESSON_FALLBACK_URL`. Read at call time; null when unset or
 * not an https zoom.us link (a bad value is logged once at startup below).
 */
export function masterFallbackUrl(): string | null {
  const value = (process.env.LESSON_FALLBACK_URL ?? "").trim();
  return isZoomUrl(value) ? value : null;
}

{
  const raw = (process.env.LESSON_FALLBACK_URL ?? "").trim();
  if (raw && !isZoomUrl(raw)) {
    console.warn("LESSON_FALLBACK_URL is set but is not an https zoom.us link — it will be ignored.");
  }
}

/**
 * Where to send people when Pencil can't be used:
 *   sessions.fallback_join_url (admin per-lesson override, any https URL)
 *   → LESSON_FALLBACK_URL (the school's master Zoom link)
 *   → null ("No backup link — contact admin").
 * Nothing is stored per teacher. A plain https link, not a credential.
 */
export function resolveFallbackUrl(session: Pick<Session, "fallback_join_url"> | null | undefined): string | null {
  const override = session?.fallback_join_url ?? null;
  if (isHttpsUrl(override)) return override;
  return masterFallbackUrl();
}

/**
 * LESSON_FALLBACK_MODE=on|1|true forces EVERY lesson onto its fallback link
 * (Pencil outage). Read at call time so ops can flip it without a rebuild
 * being required for the check itself. Never unset the API key as the outage
 * path — the webhook pipeline must keep processing finished lessons.
 */
export function lessonFallbackForced(): boolean {
  const v = (process.env.LESSON_FALLBACK_MODE ?? "").trim().toLowerCase();
  return v === "on" || v === "1" || v === "true";
}

// ---------------------------------------------------------------------------
// Is anything actually being recorded?
// ---------------------------------------------------------------------------

/**
 * PENCIL_RECORDING_ENABLED=on|1|true once institution always-on recording is
 * switched on in Pencil — the start of Phase 2 (plan decision k). Until then
 * NOTHING is recorded, so no screen may tell a family or a teacher that a
 * lesson "is recorded" or will be analyzed; the opt-out flag and the Space
 * setting are still enforced (they must be in place before recording starts).
 * Unset → off, except in demo mode, which shows the full product so its copy
 * matches the demo coaching data. Read at call time.
 */
export function recordingActive(): boolean {
  const raw = (process.env.PENCIL_RECORDING_ENABLED ?? "").trim().toLowerCase();
  if (!raw) return isDemoMode;
  return raw === "on" || raw === "1" || raw === "true";
}
