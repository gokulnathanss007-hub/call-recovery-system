const GRAPH_API = "https://graph.facebook.com/v21.0";

/**
 * Sends a free-form text reply within the 24-hour customer service window.
 * Only usable after the patient has messaged first.
 */
export async function sendTextMessage(
  patientPhone: string,
  text: string
): Promise<WhatsAppTemplateResult> {
  const phoneNumberId = process.env.META_PHONE_NUMBER_ID!;
  const token = process.env.META_WHATSAPP_TOKEN!;

  const res = await fetch(`${GRAPH_API}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: patientPhone,
      type: "text",
      text: { body: text },
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    return { messageId: null, error: data?.error?.message ?? "WhatsApp API error" };
  }
  return { messageId: data?.messages?.[0]?.id ?? null, error: null };
}

export interface WhatsAppTemplateResult {
  messageId: string | null;
  error: string | null;
}

/**
 * Sends the pre-approved "missedcall_recovery" template to a patient.
 * Approved template has no body parameters.
 */
export async function sendMissedCallTemplate(
  patientPhone: string
): Promise<WhatsAppTemplateResult> {
  const phoneNumberId = process.env.META_PHONE_NUMBER_ID!;
  const token = process.env.META_WHATSAPP_TOKEN!;

  const body = {
    messaging_product: "whatsapp",
    to: patientPhone,
    type: "template",
    template: {
      name: "missedcall_recovery",
      language: { code: "en" },
    },
  };

  const res = await fetch(`${GRAPH_API}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();

  if (!res.ok) {
    return { messageId: null, error: data?.error?.message ?? "WhatsApp API error" };
  }

  return { messageId: data?.messages?.[0]?.id ?? null, error: null };
}

/**
 * Sends the 24-hour follow-up reminder template if no response was received.
 */
export async function sendFollowUpTemplate(
  patientPhone: string,
  clinicDid: string
): Promise<WhatsAppTemplateResult> {
  const phoneNumberId = process.env.META_PHONE_NUMBER_ID!;
  const token = process.env.META_WHATSAPP_TOKEN!;

  const body = {
    messaging_product: "whatsapp",
    to: patientPhone,
    type: "template",
    template: {
      name: "missed_call_followup",
      language: { code: "en" },
      components: [
        {
          type: "body",
          parameters: [{ type: "text", text: clinicDid }],
        },
      ],
    },
  };

  const res = await fetch(`${GRAPH_API}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();

  if (!res.ok) {
    return { messageId: null, error: data?.error?.message ?? "WhatsApp API error" };
  }

  return { messageId: data?.messages?.[0]?.id ?? null, error: null };
}
