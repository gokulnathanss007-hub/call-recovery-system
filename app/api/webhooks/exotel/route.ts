import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { supabase } from "@/lib/supabase";
import { missedCallRecovery } from "@/trigger/missed-call-recovery";
import type { ExotelWebhookPayload } from "@/types/exotel";

// Exotel marks these DialCallStatus values when the clinic didn't pick up
const MISSED_DIAL_STATUSES = new Set(["no-answer", "busy", "failed"]);

function validateSignature(rawBody: string, receivedSig: string): boolean {
  const secret = process.env.EXOTEL_WEBHOOK_SECRET;
  const webhookUrl = process.env.EXOTEL_WEBHOOK_URL;
  if (!secret || !webhookUrl) return false;

  // Exotel signature: HMAC-SHA1( url + alphabetically-sorted POST params, auth_token )
  const params = new URLSearchParams(rawBody);
  const sorted = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("");

  const expected = createHmac("sha1", secret)
    .update(webhookUrl + sorted)
    .digest("base64");

  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(receivedSig));
  } catch {
    return false;
  }
}

function parsePayload(rawBody: string): ExotelWebhookPayload {
  const params = new URLSearchParams(rawBody);
  return Object.fromEntries(params) as ExotelWebhookPayload;
}

/**
 * Normalizes Indian phone numbers to E.164 (+91XXXXXXXXXX).
 * Exotel sends numbers as: 0XXXXXXXXXX, 91XXXXXXXXXX, or XXXXXXXXXX (10-digit).
 */
function toE164(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("91") && digits.length === 12) return `+${digits}`;
  if (digits.startsWith("0") && digits.length === 11) return `+91${digits.slice(1)}`;
  if (digits.length === 10) return `+91${digits}`;
  return `+${digits}`; // already has country code or unknown format
}

function isMissedCall(payload: ExotelWebhookPayload): boolean {
  // Primary check: DialCallStatus tells us if the connect leg was answered
  const dialStatus = payload.DialCallStatus?.toLowerCase();
  if (dialStatus && MISSED_DIAL_STATUSES.has(dialStatus)) return true;

  // Fallback: some Exotel applet configs surface this in CallStatus
  const callStatus = (payload.CallStatus || payload.callStatus)?.toLowerCase();
  if (callStatus && MISSED_DIAL_STATUSES.has(callStatus)) return true;

  return false;
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  // Signature validation — skip in local dev if env vars not set
  if (process.env.NODE_ENV === "production") {
    const sig = req.headers.get("x-exotel-signature") ?? "";
    if (!validateSignature(rawBody, sig)) {
      console.warn("[exotel-webhook] invalid signature");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  // Exotel sends application/x-www-form-urlencoded
  const payload = parsePayload(rawBody);

  const rawCaller = payload.CallFrom || payload.cNumber;
  const rawDid = payload.CallTo || payload.DID;
  const callerNumber = rawCaller ? toE164(rawCaller) : undefined;
  const did = rawDid ? toE164(rawDid) : undefined;
  const callId = payload.CallSid || payload.callId;
  const callStatus = payload.DialCallStatus || payload.CallStatus || payload.callStatus;

  if (!callerNumber || !did || !callId) {
    console.error("[exotel-webhook] missing required fields", { callerNumber, did, callId });
    return NextResponse.json({ error: "Bad payload" }, { status: 400 });
  }

  if (!isMissedCall(payload)) {
    // Answered calls — acknowledge and ignore
    return NextResponse.json({ status: "ignored", reason: "call was answered" });
  }

  const callTimestamp = payload.StartTime
    ? new Date(payload.StartTime).toISOString()
    : new Date().toISOString();

  const { data: inserted, error: dbError } = await supabase
    .from("missed_calls")
    .insert({
      patient_phone: callerNumber,
      exotel_did: did,
      call_status: callStatus,
      call_timestamp: callTimestamp,
      webhook_received_at: new Date().toISOString(),
      raw_payload: payload,
    })
    .select("id")
    .single();

  if (dbError) {
    // Log but return 200 — prevent Exotel from retrying on DB errors
    console.error("[exotel-webhook] supabase insert failed", dbError.message);
    return NextResponse.json({ status: "ok" });
  }

  await missedCallRecovery.trigger({
    missedCallId: inserted.id,
    patientPhone: callerNumber,
    exotelDid: did,
    callTimestamp: callTimestamp,
  });

  console.log(`[exotel-webhook] recovery job enqueued — ${callerNumber}`);

  return NextResponse.json({ status: "ok" });
}
