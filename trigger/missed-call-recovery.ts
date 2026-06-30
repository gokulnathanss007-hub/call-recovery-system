import { task, wait, logger } from "@trigger.dev/sdk/v3";
import { supabase } from "@/lib/supabase";
import { sendMissedCallTemplate, sendFollowUpTemplate } from "@/lib/whatsapp";

export interface MissedCallPayload {
  missedCallId: string;
  clinicId?: string;
  patientPhone: string;
  exotelDid: string;
  callTimestamp: string;
}

export const missedCallRecovery = task({
  id: "missed-call-recovery",
  run: async (payload: MissedCallPayload, { ctx }) => {
    const { missedCallId, clinicId, patientPhone, exotelDid } = payload;

    logger.info("Starting missed call recovery", { missedCallId, patientPhone });

    // Create the recovery job record (idempotency guard)
    const { data: job, error: jobError } = await supabase
      .from("recovery_jobs")
      .upsert(
        { missed_call_id: missedCallId, trigger_run_id: ctx.run.id },
        { onConflict: "missed_call_id", ignoreDuplicates: false }
      )
      .select("id, whatsapp_sent")
      .single();

    if (jobError) {
      logger.error("Failed to create recovery job", { error: jobError.message });
      throw new Error(jobError.message);
    }

    // ── Step 1: Send WhatsApp template (skip if already sent on a prior retry) ──
    if (!job.whatsapp_sent) {
      const { messageId, error: waError } = await sendMissedCallTemplate(patientPhone);

      if (waError) {
        logger.error("WhatsApp send failed", { error: waError });
        throw new Error(`WhatsApp failed: ${waError}`);
      }

      logger.info("WhatsApp template sent", { messageId });

      // Create the WhatsApp session record
      await supabase.from("whatsapp_sessions").insert({
        clinic_id: clinicId ?? null,
        patient_phone: patientPhone,
        missed_call_id: missedCallId,
        session_id: messageId,
        last_message_at: new Date().toISOString(),
      });

      await supabase
        .from("recovery_jobs")
        .update({ whatsapp_sent: true, whatsapp_sent_at: new Date().toISOString() })
        .eq("id", job.id);
    }

    // ── Step 2: Wait 24 hours then check for engagement ──
    logger.info("Waiting 24h before follow-up check");
    await wait.for({ hours: 24 });

    // Check if the patient replied within the 24h window
    const { data: session } = await supabase
      .from("whatsapp_sessions")
      .select("status, last_message_at")
      .eq("patient_phone", patientPhone)
      .eq("missed_call_id", missedCallId)
      .single();

    const patientReplied = session?.status === "active" &&
      session?.last_message_at &&
      new Date(session.last_message_at) > new Date(new Date().getTime() - 24 * 60 * 60 * 1000);

    if (patientReplied) {
      logger.info("Patient already engaged — skipping follow-up", { patientPhone });
      await supabase
        .from("recovery_jobs")
        .update({ status: "completed" })
        .eq("id", job.id);
      return { outcome: "engaged" };
    }

    // ── Step 3: Send 24h follow-up reminder ──
    const { error: reminderError } = await sendFollowUpTemplate(patientPhone, exotelDid);

    if (reminderError) {
      logger.warn("Follow-up send failed (non-fatal)", { error: reminderError });
    } else {
      logger.info("24h follow-up sent", { patientPhone });
      await supabase
        .from("recovery_jobs")
        .update({
          reminder_sent: true,
          reminder_sent_at: new Date().toISOString(),
          status: "completed",
        })
        .eq("id", job.id);
    }

    return { outcome: "follow-up-sent" };
  },
});
