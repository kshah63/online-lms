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

async function postMessage(payload: Record<string, unknown>): Promise<SendResult> {
  try {
    const res = await fetch(`https://graph.facebook.com/${GRAPH}/${PHONE_ID}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", ...payload }),
    });
    if (!res.ok) return { status: "failed", ref: null };
    const data = (await res.json()) as { messages?: { id: string }[] };
    return { status: "sent", ref: data.messages?.[0]?.id ?? null };
  } catch {
    return { status: "failed", ref: null };
  }
}

/**
 * Free-form text message. NOTE: WhatsApp only delivers free-form text inside the
 * 24-hour customer-service window (i.e. after the user messaged you). For
 * proactive notifications/reminders outside that window you must use an approved
 * template — see sendWhatsAppTemplate. Without a provider configured this is
 * SIMULATED so the whole flow is testable in development.
 */
export async function sendWhatsApp(toPhone: string, body: string): Promise<SendResult> {
  const to = toPhone.replace(/[^\d]/g, "");
  if (!whatsappConfigured || !to) return { status: "simulated", ref: null };
  return postMessage({ to, type: "text", text: { body } });
}

/**
 * Approved-template message — the supported way to send business-initiated
 * notifications (reminders, report-ready, booking confirmations) at any time.
 * `params` fill the template body's {{1}}, {{2}}, … placeholders in order.
 */
export async function sendWhatsAppTemplate(
  toPhone: string,
  templateName: string,
  params: string[],
  languageCode = "en",
): Promise<SendResult> {
  const to = toPhone.replace(/[^\d]/g, "");
  if (!whatsappConfigured || !to) return { status: "simulated", ref: null };
  return postMessage({
    to,
    type: "template",
    template: {
      name: templateName,
      language: { code: languageCode },
      components: params.length
        ? [{ type: "body", parameters: params.map((text) => ({ type: "text", text })) }]
        : [],
    },
  });
}
