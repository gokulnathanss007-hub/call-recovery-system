import Anthropic from "@anthropic-ai/sdk";
import { supabase } from "./supabase";

const client = new Anthropic();

type MessageParam = { role: "user" | "assistant"; content: string };

const SYSTEM_PROMPT = `You are a helpful clinic assistant for a medical clinic in Tamil Nadu, India.
The patient is messaging because they missed a call from the clinic (or the clinic missed their call).

Your job:
- Help them book an appointment — ask for preferred date and time, confirm staff will call back to finalize
- Answer common questions: clinic hours, doctor availability, location, services
- If they ask for something urgent or want to speak to a doctor directly, say you'll escalate and include the word "ESCALATE" at the end of your reply
- Keep every reply SHORT — 1 to 3 sentences max. This is WhatsApp.
- Be warm and professional. English or Tamil is fine, match what the patient uses.

Clinic hours: Monday to Saturday, 9 AM – 7 PM. Closed on Sundays.
For appointments: collect the preferred date and time, then say "Our staff will call to confirm your appointment shortly."`;

export async function handlePatientMessage(
  patientPhone: string,
  incomingText: string,
  sessionId: string
): Promise<{ reply: string; escalate: boolean }> {
  // Load conversation history from Supabase
  const { data: session } = await supabase
    .from("whatsapp_sessions")
    .select("context")
    .eq("id", sessionId)
    .single();

  const history = (session?.context as MessageParam[]) ?? [];

  const messages: MessageParam[] = [
    ...history,
    { role: "user", content: incomingText },
  ];

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 300,
    system: SYSTEM_PROMPT,
    messages,
  });

  const replyText =
    response.content[0].type === "text" ? response.content[0].text.replace("ESCALATE", "").trim() : "";

  const escalate =
    response.content[0].type === "text" &&
    response.content[0].text.includes("ESCALATE");

  // Persist updated conversation history
  const updatedContext: MessageParam[] = [
    ...messages,
    { role: "assistant", content: replyText },
  ];

  await supabase
    .from("whatsapp_sessions")
    .update({
      context: updatedContext,
      last_message_at: new Date().toISOString(),
      status: escalate ? "escalated" : "active",
    })
    .eq("id", sessionId);

  return { reply: replyText, escalate };
}
