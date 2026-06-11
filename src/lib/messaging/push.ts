import "server-only";

// Expo push notifications — send to device tokens registered by the mobile app.
// Best-effort and free (no key needed for the public Expo push service). Invalid
// tokens are simply ignored. Used by the notify dispatcher alongside WhatsApp.

export async function sendExpoPush(
  tokens: string[],
  title: string,
  body: string,
  data?: Record<string, unknown>,
): Promise<void> {
  const valid = tokens.filter((t) => typeof t === "string" && t.startsWith("ExponentPushToken"));
  if (!valid.length) return;
  try {
    await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(
        valid.map((to) => ({ to, title, body, data, sound: "default" })),
      ),
    });
  } catch {
    // best effort — push must never break the originating action
  }
}
