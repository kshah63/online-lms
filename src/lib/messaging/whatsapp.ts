import "server-only";

// ============================================================================
// WhatsApp (§11) via the Meta WhatsApp Cloud API. When WHATSAPP_TOKEN /
// WHATSAPP_PHONE_ID aren't set, sends are SIMULATED (logged, not delivered) so
// the follow-up flow is fully usable in development.
// ============================================================================

const TOKEN = process.env.WHATSAPP_TOKEN ?? "";
const PHONE_ID = process.env.WHATSAPP_PHONE_ID ?? "";
const GRAPH = process.env.WHATSAPP_GRAPH_VERSION ?? "v21.0";

export const whatsappConfigured = Boolean(TOKEN && PHONE_ID);

export type SendResult = { status: "sent" | "simulated" | "failed"; ref: string | null };

export async function sendWhatsApp(toPhone: string, body: string): Promise<SendResult> {
  const to = toPhone.replace(/[^\d]/g, "");
  if (!whatsappConfigured || !to) {
    return { status: "simulated", ref: null };
  }
  try {
    const res = await fetch(`https://graph.facebook.com/${GRAPH}/${PHONE_ID}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body },
      }),
    });
    if (!res.ok) return { status: "failed", ref: null };
    const data = (await res.json()) as { messages?: { id: string }[] };
    return { status: "sent", ref: data.messages?.[0]?.id ?? null };
  } catch {
    return { status: "failed", ref: null };
  }
}
