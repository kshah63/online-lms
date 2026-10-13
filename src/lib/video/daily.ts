import "server-only";
import { roomPropertiesFor, type LessonConsents } from "@/lib/video/daily-config";

// ============================================================================
// Video provider — Daily. One private room per session (lesson-<session_id>,
// 6 hour expiry) created lazily; meeting tokens are minted server-side after
// rpc lesson_room_state says which seat the caller holds. The host joins as
// owner (record / transcribe); learners and observers join as guests.
// What the room may capture comes from the family's consents through
// roomPropertiesFor, never from a hardcoded body. When DAILY_API_KEY isn't set,
// callers fall back to the built-in mock room.
// ============================================================================

const API_KEY = process.env.DAILY_API_KEY ?? "";
const API = "https://api.daily.co/v1";

export const dailyConfigured = Boolean(API_KEY);

export function roomName(sessionId: string) {
  return `lesson-${sessionId}`;
}

async function daily(path: string, init?: RequestInit) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  return res;
}

const ROOM_TTL_SECONDS = 60 * 60 * 6;

/** Ensure the session's room exists with the consent-derived properties; return its URL. */
export async function ensureRoom(sessionId: string, consents: LessonConsents): Promise<string> {
  const name = roomName(sessionId);

  const existing = await daily(`/rooms/${name}`);
  if (existing.ok) {
    const data = (await existing.json()) as { url: string };
    return data.url;
  }

  const body = roomPropertiesFor({ consents, expiresAt: Math.floor(Date.now() / 1000) + ROOM_TTL_SECONDS });
  const created = await daily("/rooms", {
    method: "POST",
    body: JSON.stringify({ name, ...body }),
  });
  if (!created.ok) throw new Error(`Daily room create failed: ${created.status}`);
  const data = (await created.json()) as { url: string };
  return data.url;
}

/**
 * Mint a meeting token. user_id is the mv-app profile id, so Daily's webhooks
 * (participant joined / left, recording ready) carry who it was.
 */
export async function mintToken(
  sessionId: string,
  participant: { userId: string; userName: string; isOwner: boolean },
): Promise<string> {
  const res = await daily("/meeting-tokens", {
    method: "POST",
    body: JSON.stringify({
      properties: {
        room_name: roomName(sessionId),
        user_id: participant.userId,
        user_name: participant.userName,
        is_owner: participant.isOwner,
        exp: Math.floor(Date.now() / 1000) + 60 * 60 * 3, // 3h
      },
    }),
  });
  if (!res.ok) throw new Error(`Daily token mint failed: ${res.status}`);
  const data = (await res.json()) as { token: string };
  return data.token;
}
