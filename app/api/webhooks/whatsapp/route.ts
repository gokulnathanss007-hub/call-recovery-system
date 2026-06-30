import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { supabase } from "@/lib/supabase";
import { handlePatientMessage } from "@/lib/chatbot";
import { sendTextMessage } from "@/lib/whatsapp";

function verifySignature(rawBody: string, signature: string | null): boolean {
  if (!signature) return false;
  const secret = process.env.META_APP_SECRET!;
  const expected =
    "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

// ── GET: Meta webhook verification challenge ──────────────────────────────────
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === process.env.META_WEBHOOK_VERIFY_TOKEN) {
    return new Response(challenge, { status: 200 });
  }

  return new Response("Forbidden", { status: 403 });
}

// ── POST: Incoming messages from patients ─────────────────────────────────────
export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  if (process.env.NODE_ENV === "production") {
    const sig = req.headers.get("x-hub-signature-256");
    if (!verifySignature(rawBody, sig)) {
      return new Response("Unauthorized", { status: 401 });
    }
  }

  const body = JSON.parse(rawBody);

  // Meta routes delivery receipts + status updates through the same endpoint
  const changes = body?.entry?.[0]?.changes?.[0]?.value;
  if (!changes?.messages?.length) {
    return NextResponse.json({ status: "ok" });
  }

  const message = changes.messages[0];

  // Only handle text for now — ignore images, audio, etc.
  if (message.type !== "text") {
    return NextResponse.json({ status: "ok" });
  }

  const patientPhone = `+${message.from}`;
  const incomingText: string = message.text?.body ?? "";

  // Look up the most recent active session for this patient
  const { data: session } = await supabase
    .from("whatsapp_sessions")
    .select("id, status, clinic_id, missed_call_id")
    .eq("patient_phone", patientPhone)
    .in("status", ["active", "escalated"])
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  // No prior session — patient messaged us cold (unusual but possible)
  if (!session) {
    // Identify the clinic from the Meta business phone number that received this message
    const phoneNumberId = changes.metadata?.phone_number_id as string | undefined;
    const { data: clinic } = phoneNumberId
      ? await supabase
          .from("clinics")
          .select("id")
          .eq("whatsapp_phone_number_id", phoneNumberId)
          .maybeSingle()
      : { data: null };

    const { data: newSession } = await supabase
      .from("whatsapp_sessions")
      .insert({
        clinic_id: clinic?.id ?? null,
        patient_phone: patientPhone,
        status: "active",
        last_message_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (clinic) {
      await supabase
        .from("patients")
        .upsert(
          { clinic_id: clinic.id, phone: patientPhone, last_contact_at: new Date().toISOString() },
          { onConflict: "clinic_id,phone" }
        );
    }

    if (newSession) {
      const { reply } = await handlePatientMessage(
        patientPhone,
        incomingText,
        newSession.id,
        clinic?.id,
        false // cold session — patient messaged in on their own, no missed call
      );
      const { error: sendError } = await sendTextMessage(patientPhone, reply);
      if (sendError) console.error("[whatsapp-webhook] send failed", sendError);
    }
    return NextResponse.json({ status: "ok" });
  }

  // Already escalated — don't let the bot respond again
  if (session.status === "escalated") {
    const { error: sendError } = await sendTextMessage(
      patientPhone,
      "Your request has been escalated. Our staff will contact you shortly."
    );
    if (sendError) console.error("[whatsapp-webhook] send failed", sendError);
    return NextResponse.json({ status: "ok" });
  }

  // Normal chatbot flow
  const { reply, escalate } = await handlePatientMessage(
    patientPhone,
    incomingText,
    session.id,
    session.clinic_id ?? undefined,
    !!session.missed_call_id
  );

  const { error: sendError } = await sendTextMessage(patientPhone, reply);
  if (sendError) console.error("[whatsapp-webhook] send failed", sendError);

  if (escalate) {
    console.log(`[whatsapp-webhook] escalation triggered for ${patientPhone}`);
    // TODO Phase 2: push notification to clinic dashboard
  }

  return NextResponse.json({ status: "ok" });
}
