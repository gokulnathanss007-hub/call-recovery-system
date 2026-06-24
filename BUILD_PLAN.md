# CGE Missed Call Recovery — Stepwise Build Plan

**Companion to:** `CLAUDE.md`
**Goal:** Ship the demo-critical path (missed call → WhatsApp message lands in ~90s) first, then add optional limbs (voice, dashboard).
**How to use:** Build one step at a time. Don't start a step until its "depends on" is green. The 🎯 marks the demo milestone — everything before it is required for your sales pitch, everything after is upside.

---

## Corrections to apply before you start (from CLAUDE.md review)

- **WhatsApp host:** use `https://graph.facebook.com/<version>/<PHONE_NUMBER_ID>/messages`, NOT `graph.instagram.com`. Confirm the current Graph API version on Meta's docs (v18.0 is outdated).
- **Trigger.dev v4:** there is no `eventTrigger` in v4. Define a `task()` and call `.trigger()` on it from the webhook handler. Update the architecture mental model accordingly.
- **Secrets:** after your past key leak — everything sensitive lives in Vercel env vars + `.env.local` (gitignored). Never in `.env` that gets committed. Verify `.gitignore` before the first push.

---

## Phase 0 — Foundation & Secrets
*Depends on: nothing. Do this first.*

1. **Repo + env hygiene**
   - Confirm `.env.local` is in `.gitignore`. Confirm no keys are in `.env` or committed history.
   - Create env var placeholders: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `META_WA_TOKEN`, `META_PHONE_NUMBER_ID`, `META_VERIFY_TOKEN`, `EXOTEL_WEBHOOK_SECRET`, `TRIGGER_SECRET_KEY`, `ANTHROPIC_API_KEY`.
   - Mirror all of these into Vercel project settings.
2. **Supabase project** — create it, grab URL + service role key.

**Done when:** repo is clean, no secrets tracked, env scaffolding exists locally + on Vercel.

---

## Phase 1 — Database Schema
*Depends on: Phase 0.*

3. Create the 3 tables: `missed_calls`, `whatsapp_sessions`, `voice_callbacks` (schemas in CLAUDE.md). Note: `whatsapp_sessions` is the table you were missing — create it now.
4. Add **Row Level Security** policies (clinic-scoped). Even in demo, RLS-on-by-default avoids a rewrite later.
5. Seed one fake clinic row so you have a `clinic_id` to reference while testing.

**Done when:** you can insert/select a `missed_calls` row from the Supabase SQL editor.

---

## Phase 2 — Kick off the slow, async stuff IN PARALLEL
*Depends on: Phase 0. Start now so review/provisioning time runs in the background.*

6. **Submit Meta WhatsApp template** `missed_call_recovery` for approval. (Can take 24h+. Do not wait until you "reach" the WhatsApp step.)
7. **Provision Exotel DID + Passthru applet** pointing at your future webhook URL. Get API credentials.
8. (Optional now) Note Sarv as fallback DID — don't build it yet.

**Done when:** template is *submitted* and DID is *provisioned*. You'll consume these in later phases.

---

## Phase 3 — Webhook Handler (Detection)
*Depends on: Phase 1. Can build before Phase 2 finishes — test with fake payloads.*

9. Build `POST /api/webhooks/exotel` in Next.js (App Router route handler).
10. **Validate the Exotel signature** against `EXOTEL_WEBHOOK_SECRET` before trusting anything.
11. Parse payload (`cNumber`, `DID`, `callStatus`, `callId`, etc.), normalize phone to E.164.
12. Insert a row into `missed_calls`. Return 200 fast (under a few hundred ms).
13. **Test with curl/Postman** using a fake Exotel payload before any real call.

**Done when:** a simulated POST creates a `missed_calls` row and returns 200.

---

## Phase 4 — Trigger.dev v4 Job (the v4-correct way)
*Depends on: Phase 3.*

14. Install/configure `@trigger.dev/sdk` v4. Set `TRIGGER_SECRET_KEY`.
15. Define a `task()` (e.g. `recoverMissedCall`) — NOT `eventTrigger`/`defineJob`.
16. From the webhook handler (Phase 3), call `recoverMissedCall.trigger({ missedCallId, patientPhone, did, clinicId })` after the DB insert.
17. Add retries (3, exponential backoff) in the task config.
18. Verify in the Trigger.dev dashboard that the task fires when the webhook hits.

**Done when:** a simulated webhook → DB insert → task run visible in Trigger.dev.

---

## Phase 5 — WhatsApp Recovery Send  🎯 DEMO MILESTONE
*Depends on: Phase 4 + Phase 2's template approved.*

19. Inside the task, call Meta Cloud API: `POST https://graph.facebook.com/<version>/<PHONE_NUMBER_ID>/messages` with the approved template.
20. Log the send into `whatsapp_sessions` (status `active`, store `session_id`, `last_message_at`).
21. Handle send failures → mark for retry, log the error.
22. **End-to-end test:** real missed call to the Exotel DID → WhatsApp message lands on your phone.

**🎯 Done when: a real missed call produces a WhatsApp message in under ~90 seconds. This is your sellable demo. Stop and rehearse the pitch before going further.**

---

## Phase 6 — Inbound Replies + FAQ Chatbot (Claude Haiku)
*Depends on: Phase 5.*

23. Build the Meta **inbound** webhook (verify token handshake + message receive). Note: Meta sends a GET verification challenge — handle it.
24. On patient reply, load/append conversation `context` from `whatsapp_sessions`.
25. Route the message to **Claude Haiku** with a clinic-FAQ system prompt. Reply via Meta API.
26. Add the intents: book appointment, get info, speak to doctor (escalate → set session `status = escalated`).

**Done when:** you can hold a back-and-forth in WhatsApp and the bot books/answers/escalates correctly.

---

## Phase 7 — Smart Reminders (24h follow-up)
*Depends on: Phase 5/6.*

27. Add a delayed/scheduled Trigger.dev task: if a `missed_calls` row has no engagement after 24h, send a follow-up WhatsApp.
28. Make it cancel itself if the patient replies in the meantime.

**Done when:** an un-engaged missed call triggers exactly one 24h follow-up, and an engaged one triggers none.

---

## Phase 8 — Voice Callback (OPTIONAL — build last)
*Depends on: Phase 5. Skip entirely for the first sales push if time is tight.*

29. ElevenLabs Conversational AI setup (WebSocket), Claude Sonnet as the reasoning backend.
30. Trigger logic: no WhatsApp reply within 5 min → initiate callback.
31. Log to `voice_callbacks` (transcript, duration, outcome).

**Done when:** an un-replied missed call gets an AI voice callback that can book or hand off.

---

## Phase 9 — Dashboard + Monitoring
*Depends on: data flowing from earlier phases. This was already your "Phase 2 / coming later."*

32. Wire up dashboard auth (the auth gap you flagged).
33. Views: missed calls, recovery status, weekly digest.
34. Alerts: webhook failures, Meta rate limits, callback failures.

**Done when:** a clinic owner can log in and see their recovery numbers.

---

## Critical path vs. optional (at a glance)

| Must-have for demo | Optional / later |
|---|---|
| Phase 0–5 (detect → WhatsApp lands) | Phase 8 (voice callback) |
| Phase 6 (chatbot, if pitching the booking flow) | Phase 9 (dashboard) |
| Phase 7 (reminders) | Sarv fallback DID |

**If you only have a few days before Chennai outreach:** Phases 0 → 5 give you the live 90-second demo. Everything else can wait.
