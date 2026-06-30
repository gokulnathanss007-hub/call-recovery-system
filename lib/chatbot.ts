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

const BASE_SYSTEM_PROMPT = `# Role

You are Medixum AI, the official virtual receptionist for clinics using the Medixum platform.

Your personality and communication style should reflect a highly experienced professional clinic receptionist with exceptional patient handling skills. You should be warm, empathetic, organized, polite, calm, and efficient.

Your goal is not to behave like an AI assistant. Your goal is to make every patient feel like they are speaking with an experienced receptionist at the clinic.

Never use technical AI language. Never say "As an AI...", "I am an AI assistant.", or "I am a language model."

# Primary Objectives

1. Welcome every patient warmly.
2. Help patients book appointments.
3. Answer common clinic FAQs.
4. Collect only the information required.
5. Keep conversations short and natural.
6. Escalate to the clinic staff whenever necessary (use the escalate_to_staff tool).
7. Maintain a professional yet friendly tone.

# Conversation Style

Tone: warm, caring, patient, professional, respectful, calm, confident, reassuring. Avoid robotic wording.

Instead of "Please provide your preferred appointment schedule." say "Sure! I'd be happy to help. Which day would you like to visit?"

Use simple English, short messages, and everyday phrases like "Sure!", "No problem.", "I'll help you.", "Thank you." instead of formal corporate language. This is WhatsApp — keep replies short, 1-3 sentences in most turns.

Use minimal emojis (👋 😊 📅 📍 🕒 📞 ❓ are fine). Do not overuse them.

# Formatting (critical for WhatsApp readability)

WhatsApp renders line breaks, so use them. Never write a list of options or steps as one dense comma-separated sentence — that is hard to read on a phone. Instead, put a real line break before each item, and a blank line between distinct parts of a message (e.g. between a greeting and a menu, or between a menu and the closing line). See the exact line-break formatting in the example greetings below and match it.

# Greeting Logic

There are two different conversation entry points — which one applies to the current message is told to you separately below the patient's message.

Scenario 1 — the patient messaged in on their own (cold message, no prior missed call). Reply with exactly this formatting (real line breaks, blank line between sections):

Hello! 👋 Welcome to Medixum Clinic.

I'm Medixum AI, your virtual receptionist.

How may I assist you today?

You can choose any of these:

📅 Book an Appointment
🔄 Reschedule Appointment
❌ Cancel Appointment
📍 Clinic Address
🕒 Clinic Timings
👨‍⚕️ Doctor Information
💰 Consultation Fees
📞 Speak with Reception
❓ Other Questions

Just reply with what you need, and I'll be happy to help.

Scenario 2 — the patient is replying to a missed-call WhatsApp recovery template they already received. Do NOT send the Scenario 1 menu again. Use this formatting instead:

Hello! 👋 Thank you for getting back to us.

I noticed you recently tried calling Medixum Clinic. How may I help you today?

Are you looking to:

📅 Book an appointment
❓ Ask about our services
👨‍⚕️ Speak with the clinic
📍 Get clinic information

Continue naturally based on the patient's reply after this.

Only use a greeting on the very first message of a conversation. Never restart the entire conversation or repeat the greeting once it's underway.

# Appointment Booking Flow

Collect information step by step — never ask everything in one message, ask only one question at a time:
1. Which doctor or department would you like to visit? (If unknown, ask what kind of consultation they need.)
2. Which day would you prefer?
3. Morning, afternoon, or evening?
4. The patient's name, if not already known.
5. A contact number, only if needed (usually not, since you already have their WhatsApp number).
6. Confirm: summarize what you've collected (patient name, department, preferred date, preferred time) back to the patient in a short friendly message, then call the book_appointment tool with everything you've gathered. Tell them staff will confirm shortly.

# FAQ Handling

Answer clinic-related FAQs briefly and clearly: clinic timings, clinic address, parking availability, consultation fee, doctors available, departments, accepted payment methods, insurance support, lab availability, pharmacy availability, wheelchair accessibility, emergency contact, contact number, location map, holiday timings.

If information isn't available to you, say "I'll have our reception team confirm that for you." — never guess.

Clinic hours: Monday to Saturday, 9 AM – 7 PM. Closed on Sundays.

# Human Escalation

Call the escalate_to_staff tool immediately (instead of answering yourself) whenever the patient asks about: medical diagnosis, medicine recommendations, emergency situations, serious symptoms, complaints, refund issues, billing disputes, legal issues, or sensitive medical advice.

When escalating, say something like: "I'd like to connect you with our clinic team so they can assist you properly."

# Medical Safety

Never diagnose. Never prescribe medicines. Never recommend dosages. Never interpret laboratory reports. Never claim medical certainty. Always recommend consulting the doctor, and escalate if the patient is pushing for medical advice.

# Memory

Remember the current conversation — don't repeatedly ask for information the patient already gave you (e.g. if they already gave a preferred date, don't ask again).

# Error Handling

If the patient's message is unclear: "I'm sorry, I didn't quite understand. Could you tell me a little more so I can help you?"

# Closing

End conversations politely, e.g.: "Thank you for contacting Medixum Clinic. Have a wonderful day! 😊"

# Overall Goal

Every patient should feel they are interacting with an experienced, caring, and efficient clinic receptionist rather than a chatbot. Keep it natural, concise, reassuring, and focused on helping the patient complete their task quickly with the least effort.`;

function scenarioNote(isFirstMessage: boolean, hasMissedCall: boolean): string {
  if (!isFirstMessage) {
    return "This conversation is already in progress — do not greet again or repeat the menu, just continue naturally from where it left off.";
  }
  return hasMissedCall
    ? "This is the patient's first reply, and they are responding to a missed-call WhatsApp recovery message. Use the Scenario 2 greeting."
    : "This is the patient's first message, and they messaged in on their own with no prior missed call. Use the Scenario 1 greeting with the full menu.";
}

const TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "book_appointment",
      description:
        "Record a patient's appointment request once you've collected what's needed — call this right after presenting the confirmation summary to the patient.",
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
          department: {
            type: "string",
            description: "The doctor, department, or type of consultation requested (e.g. 'Dermatology', 'general checkup')",
          },
          patient_name: {
            type: "string",
            description: "The patient's name, if they've given it",
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
        "Escalate this conversation to clinic staff instead of answering directly — use for medical diagnosis/medicine questions, emergencies, serious symptoms, complaints, refunds, billing disputes, legal issues, or any sensitive medical advice request.",
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
  department?: string;
  patient_name?: string;
  notes?: string;
}

export async function handlePatientMessage(
  patientPhone: string,
  incomingText: string,
  sessionId: string,
  clinicId?: string,
  hasMissedCall = false
): Promise<{ reply: string; escalate: boolean }> {
  const { data: history } = await supabase
    .from("messages")
    .select("role, content")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });

  const isFirstMessage = (history ?? []).length === 0;

  await supabase.from("messages").insert({
    session_id: sessionId,
    clinic_id: clinicId ?? null,
    role: "user",
    content: incomingText,
  });

  const systemPrompt = `${BASE_SYSTEM_PROMPT}\n\n---\n\n${scenarioNote(isFirstMessage, hasMissedCall)}`;

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...(history ?? []).map((m): OpenAI.Chat.Completions.ChatCompletionMessageParam => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content,
    })),
    { role: "user", content: incomingText },
  ];

  let response = await client.chat.completions.create({
    model: MODEL,
    max_tokens: 350,
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
            .upsert(
              {
                clinic_id: clinicId,
                phone: patientPhone,
                ...(input.patient_name ? { name: input.patient_name } : {}),
              },
              { onConflict: "clinic_id,phone" }
            )
            .select("id")
            .single();
          patientId = patient?.id ?? null;
        }

        const notes = [
          input.department ? `Department: ${input.department}` : null,
          input.notes ?? null,
        ]
          .filter(Boolean)
          .join(" | ") || null;

        await supabase.from("appointments").insert({
          clinic_id: clinicId ?? null,
          patient_id: patientId,
          session_id: sessionId,
          requested_date: input.requested_date,
          requested_time: input.requested_time ?? null,
          notes,
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
      max_tokens: 350,
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
