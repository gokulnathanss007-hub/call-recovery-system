import OpenAI from "openai";
import { supabase } from "./supabase";

// Temporary stopgap: routed through AICredits (an OpenAI-compatible gateway,
// billed in INR) instead of Anthropic directly, since direct Anthropic billing
// is blocked on getting an international card. Swap back to @anthropic-ai/sdk
// (Anthropic's native Messages API + tool-use format) once that's resolved —
// the request/response shapes differ enough that this isn't a drop-in env swap.
const client = new OpenAI({
  apiKey: process.env.AICREDITS_API_KEY,
  baseURL: "https://api.aicredits.in/v1",
});

const MODEL = "anthropic/claude-haiku-4.5";

const SYSTEM_PROMPT = `You are a helpful clinic assistant for a medical clinic in Tamil Nadu, India.
The patient is messaging because they missed a call from the clinic (or the clinic missed their call).

Your job:
- Help them book an appointment — once they've given you a preferred date (and time, if mentioned), call the book_appointment tool, then tell them staff will call to confirm.
- Answer common questions: clinic hours, doctor availability, location, services.
- If they ask for something urgent or want to speak to a doctor directly, call the escalate_to_staff tool instead of answering yourself.
- Keep every reply SHORT — 1 to 3 sentences max. This is WhatsApp.
- Be warm and professional. English or Tamil is fine, match what the patient uses.

Clinic hours: Monday to Saturday, 9 AM – 7 PM. Closed on Sundays.`;

const TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "book_appointment",
      description:
        "Record a patient's requested appointment date/time once they've provided it.",
      parameters: {
        type: "object",
        properties: {
          requested_date: {
            type: "string",
            description: "Date the patient asked for, in their own words (e.g. 'tomorrow', '5th July')",
          },
          requested_time: {
            type: "string",
            description: "Time the patient asked for, in their own words (e.g. 'morning', '4pm')",
          },
          notes: {
            type: "string",
            description: "Any other relevant detail the patient mentioned",
          },
        },
        required: ["requested_date"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "escalate_to_staff",
      description:
        "Escalate this conversation to clinic staff instead of answering directly — use for urgent requests or when the patient asks for a human.",
      parameters: {
        type: "object",
        properties: {
          reason: { type: "string", description: "Why this needs staff attention" },
        },
      },
    },
  },
];

interface BookAppointmentInput {
  requested_date: string;
  requested_time?: string;
  notes?: string;
}

export async function handlePatientMessage(
  patientPhone: string,
  incomingText: string,
  sessionId: string,
  clinicId?: string
): Promise<{ reply: string; escalate: boolean }> {
  const { data: history } = await supabase
    .from("messages")
    .select("role, content")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });

  await supabase.from("messages").insert({
    session_id: sessionId,
    clinic_id: clinicId ?? null,
    role: "user",
    content: incomingText,
  });

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...(history ?? []).map((m): OpenAI.Chat.Completions.ChatCompletionMessageParam => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content,
    })),
    { role: "user", content: incomingText },
  ];

  let response = await client.chat.completions.create({
    model: MODEL,
    max_tokens: 300,
    messages,
    tools: TOOLS,
  });

  let choice = response.choices[0];
  let escalate = false;

  if (choice.finish_reason === "tool_calls" && choice.message.tool_calls) {
    const toolResultMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];

    for (const call of choice.message.tool_calls) {
      if (call.type !== "function") continue;

      if (call.function.name === "book_appointment") {
        const input = JSON.parse(call.function.arguments) as BookAppointmentInput;

        let patientId: string | null = null;
        if (clinicId) {
          const { data: patient } = await supabase
            .from("patients")
            .select("id")
            .eq("clinic_id", clinicId)
            .eq("phone", patientPhone)
            .maybeSingle();
          patientId = patient?.id ?? null;
        }

        await supabase.from("appointments").insert({
          clinic_id: clinicId ?? null,
          patient_id: patientId,
          session_id: sessionId,
          requested_date: input.requested_date,
          requested_time: input.requested_time ?? null,
          notes: input.notes ?? null,
        });

        toolResultMessages.push({
          role: "tool",
          tool_call_id: call.id,
          content: "Appointment request recorded.",
        });
      } else if (call.function.name === "escalate_to_staff") {
        escalate = true;
        toolResultMessages.push({
          role: "tool",
          tool_call_id: call.id,
          content: "Escalated to staff.",
        });
      }
    }

    response = await client.chat.completions.create({
      model: MODEL,
      max_tokens: 300,
      messages: [...messages, choice.message, ...toolResultMessages],
      tools: TOOLS,
    });
    choice = response.choices[0];
  }

  const replyText = choice.message.content ?? "";

  await supabase.from("messages").insert({
    session_id: sessionId,
    clinic_id: clinicId ?? null,
    role: "assistant",
    content: replyText,
  });

  await supabase
    .from("whatsapp_sessions")
    .update({
      last_message_at: new Date().toISOString(),
      status: escalate ? "escalated" : "active",
    })
    .eq("id", sessionId);

  return { reply: replyText, escalate };
}
