import "server-only";

// ============================================================================
// §4 Video provider — Daily. Rooms are created per session; meeting tokens are
// minted server-side so the assigned-teacher-only rule is enforced at the token
// (the teacher joins as owner — able to record/transcribe; others as guests).
// When DAILY_API_KEY isn't set, callers fall back to the built-in mock room.
//
// LiveKit is the alternative if you want a server-side agent tapping live audio
// directly; Daily is chosen here for the fastest clean embed plus built-in
// recording + transcription that feed §7's coaching pipeline.
// ============================================================================

const API_KEY = process.env.DAILY_API_KEY ?? "";
const API = "https://api.daily.co/v1";

export const dailyConfigured = Boolean(API_KEY);

function roomName(sessionId: string) {
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

/** Ensure the session's room exists; return its URL. */
export async function ensureRoom(sessionId: string): Promise<string> {
  const name = roomName(sessionId);

  const existing = await daily(`/rooms/${name}`);
  if (existing.ok) {
    const data = (await existing.json()) as { url: string };
    return data.url;
  }

  const created = await daily("/rooms", {
    method: "POST",
    body: JSON.stringify({
      name,
      privacy: "private",
      properties: {
        // Recording intentionally disabled — we only use transcription for AI
        // feedback, which avoids storing video of minors.
        enable_transcription: true,
        enable_prejoin_ui: false,
        exp: Math.floor(Date.now() / 1000) + 60 * 60 * 6, // 6h
      },
    }),
  });
  if (!created.ok) throw new Error(`Daily room create failed: ${created.status}`);
  const data = (await created.json()) as { url: string };
  return data.url;
}

/** Mint a meeting token. The assigned teacher gets owner rights (record/transcribe). */
export async function mintToken(
  sessionId: string,
  userName: string,
  isOwner: boolean,
): Promise<string> {
  const res = await daily("/meeting-tokens", {
    method: "POST",
    body: JSON.stringify({
      properties: {
        room_name: roomName(sessionId),
        user_name: userName,
        is_owner: isOwner,
        exp: Math.floor(Date.now() / 1000) + 60 * 60 * 3, // 3h
      },
    }),
  });
  if (!res.ok) throw new Error(`Daily token mint failed: ${res.status}`);
  const data = (await res.json()) as { token: string };
  return data.token;
}
