import "server-only";

// ============================================================================
// Recording playback — Daily keeps the bytes; the room asks for a short-lived
// access link once the database has said the caller may see the row. Nothing
// is cached: every click is a fresh link that expires on its own.
// ============================================================================

const API_KEY = process.env.DAILY_API_KEY ?? "";
const API = "https://api.daily.co/v1";

export const recordingPlaybackConfigured = Boolean(API_KEY);

/** GET /recordings/{id}/access-link → the download link Daily signs for a few hours. */
export async function recordingAccessLink(providerRecordingId: string): Promise<string> {
  if (!API_KEY) throw new Error("Recording playback is not configured on this server (DAILY_API_KEY is unset).");
  const res = await fetch(`${API}/recordings/${encodeURIComponent(providerRecordingId)}/access-link`, {
    headers: { Authorization: `Bearer ${API_KEY}` },
    cache: "no-store",
  });
  if (res.status === 404) throw new Error("Daily no longer holds this recording.");
  if (!res.ok) throw new Error(`Daily could not issue a playback link (${res.status}).`);
  const data = (await res.json()) as { download_link?: string };
  if (!data.download_link) throw new Error("Daily answered without a playback link.");
  return data.download_link;
}
