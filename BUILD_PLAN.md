# BUILD_PLAN.md — Clinic Growth Engine (CGE)

> **Note:** This file was rebuilt from project knowledge after the local folder was
> deleted and the repo re-extracted from GitHub. It has since been **verified against
> the actual codebase on 2026-06-29**, and on the same day extended with auth, a
> clinic dashboard, patient/appointment tracking, and AI-driven appointment capture
> (see §5–§9a) to match a target architecture diagram the project owner provided.

---

## 1. What this app is

CGE is a **WhatsApp-first missed-call recovery and patient lifecycle automation** platform for small private clinics in Tamil Nadu. When a clinic misses an inbound call, CGE automatically reaches the caller on WhatsApp, answers common questions, and helps turn them into a booked patient — recovering revenue that would otherwise walk away.

- Built and operated solo under **Medixum AI**.
- Base price: **₹6,000/month per clinic**, with higher tiers (up to ₹15,000/month) for larger clinics.
- Go-to-market: land-and-expand, starting with clinic clusters in **KK Nagar and Anna Nagar, Madurai**.

---

## 2. The core flow (this must always work)

1. A patient calls the clinic's number; the call is missed (busy / after-hours / no answer).
2. **Exotel** (telephony / DID) fires a **Passthru applet webhook** to the app with the caller's number.
3. The app logs the missed call and enqueues a **Trigger.dev** background task.
4. The task sends the approved Meta WhatsApp **Utility** template `missed_call_recovery` to the caller.
5. If the patient replies, **Claude Haiku** handles FAQ-style replies; booking intent is captured.
6. The clinic sees recovered leads; lifecycle follow-ups continue from there.

**Demo (90 seconds):** missed call → WhatsApp recovery message → reply handled live.

---

## 3. Tech stack

- **Frontend / API:** Next.js (App Router) on **Vercel**
- **Database / auth:** **Supabase** (Postgres) — **Pro tier required from day one** (free tier auto-pauses and breaks webhooks)
- **Background jobs:** **Trigger.dev v4** (use the `task()` pattern; the v2→v4 migration is already done)
- **Telephony / DID:** **Exotel** (missed-call webhook via Passthru applet)
- **Messaging:** **Meta WhatsApp Cloud API**
- **Chatbot:** **Anthropic Claude Haiku** (patient reply handling / FAQ)

---

## 4. Architecture overview

Inbound missed calls arrive as webhooks from Exotel into a Next.js route handler. That handler does the minimum synchronous work (validate, log the call to Supabase) and then hands off to a Trigger.dev task so the HTTP response stays fast and the heavy lifting (WhatsApp send, retries, follow-ups) runs in the background.

Outbound recovery messages go through the Meta WhatsApp Cloud API using the pre-approved Utility template, which keeps per-message cost low and avoids needing the LLM for the first touch. Inbound WhatsApp replies hit a separate Meta webhook route, which routes the message text to Claude Haiku for an FAQ-style answer and records the conversation in Supabase. Lifecycle follow-ups are scheduled Trigger.dev tasks keyed off the lead's state.

---

## 5. Repository structure

```
/app
  page.tsx             # redirects to /dashboard or /login based on auth state
  layout.tsx / globals.css   # root layout, Tailwind v4 (@import "tailwindcss")
  /api/webhooks
    /exotel/route.ts   # missed-call Passthru receiver: HMAC-SHA1 signature check,
                        # E.164 normalization, missed-call detection, clinic lookup
                        # by DID, inserts missed_calls + upserts patients, triggers
                        # the missedCallRecovery task
    /whatsapp/route.ts # GET: Meta verification challenge
                        # POST: inbound patient messages — resolves clinic (from the
                        # session, or by Meta phone_number_id for cold sessions),
                        # calls Claude Haiku synchronously, replies in the same request
  /login, /signup      # auth pages + server actions (Supabase Auth, email/password)
  /dashboard           # clinic-facing UI, gated by proxy.ts — see §8
    layout.tsx, page.tsx (overview), calls/, conversations/[id]/, appointments/, settings/
proxy.ts               # Next.js 16 "proxy" (formerly middleware) — refreshes the
                        # Supabase auth cookie and redirects unauthenticated /dashboard
                        # requests to /login (api/ routes are excluded from the matcher)
/trigger
  missed-call-recovery.ts  # the only Trigger.dev task (see §7)
/lib
  supabase.ts            # service-role client (webhooks + Trigger.dev job — bypasses RLS)
  supabase-server.ts      # cookie-bound client for Server Components/Actions (RLS-scoped)
  supabase-middleware.ts   # session-refresh + redirect logic used by proxy.ts
  whatsapp.ts            # Meta Graph API senders: free-text + both templates
  chatbot.ts             # Claude Haiku reply handler — messages table + tool-use (see §7)
/types
  exotel.ts              # ExotelWebhookPayload type
/supabase/migrations
  001_initial_schema.sql
  002_auth_patients_messages_appointments.sql   # patients, messages, appointments,
                                                  # clinics.owner_user_id/whatsapp_phone_number_id, RLS policies
/docs
  phase2-setup-guide.md  # Meta template + Exotel DID/Passthru setup walkthrough
BUILD_PLAN.md
.env.example           # committed; .env.local is gitignored
```

No `CLAUDE.md` exists yet.

---

## 6. Data model

From `001_initial_schema.sql`:
- `clinics` — `id`, `name`, `did` (Exotel virtual number), `created_at`. Seeded with one demo clinic row.
- `missed_calls` — `patient_phone` (E.164), `exotel_did`, `call_status`, `call_timestamp`, `webhook_received_at`, `raw_payload` (jsonb, full Exotel body), `clinic_id`.
- `whatsapp_sessions` — `patient_phone`, `missed_call_id`, `session_id` (Meta message id), `status` (`active` | `closed` | `escalated`), `last_message_at`, `clinic_id`.
- `recovery_jobs` — one row per `missed_call_id` (unique index — idempotency guard for the Trigger.dev task), `whatsapp_sent`/`_at`, `reminder_sent`/`_at`, `status` (`pending` | `completed` | `failed`), `trigger_run_id`.
- `voice_callbacks` — schema exists but **nothing in `app/`, `lib/`, or `trigger/` references it yet**. Commented in the migration as "Phase 8 — built now, used later," with columns for an ElevenLabs transcript and call outcome.

Added in `002_auth_patients_messages_appointments.sql`:
- `clinics.owner_user_id` (→ `auth.users`, unique — one owner per clinic) and `clinics.whatsapp_phone_number_id` (Meta phone_number_id, used to identify the clinic on cold inbound WhatsApp messages).
- `patients` — `clinic_id`, `phone`, `name`, `first_seen_at`, `last_contact_at`. Unique on `(clinic_id, phone)`. Upserted from both webhooks whenever a clinic is successfully identified.
- `messages` — `session_id`, `clinic_id`, `role`, `content`, `created_at`. **Replaces** `whatsapp_sessions.context` (that jsonb column was dropped in this migration) as the source of conversation history — `lib/chatbot.ts` now reads/writes this table instead of a jsonb blob, which is what makes a real "Conversations" dashboard view possible.
- `appointments` — `clinic_id`, `patient_id`, `session_id`, `requested_date`, `requested_time`, `notes`, `status` (`pending` | `confirmed` | `cancelled`). Populated by Claude tool-use, not free text (see §7).
- RLS policies on every table scope rows to `clinic_id in (select id from clinics where owner_user_id = auth.uid())`. The service-role client (`lib/supabase.ts`, used by both webhooks and the Trigger.dev task) bypasses RLS as before, so the existing recovery flow is unaffected. Dashboard reads go through `lib/supabase-server.ts`, which is bound to the signed-in user's session and therefore RLS-scoped.

There's still no separate `templates` table — template names are hardcoded in `lib/whatsapp.ts`. There are no `conversations`/`leads` tables either; `whatsapp_sessions` + `messages` + `patients` cover that ground.

---

## 7. Background jobs (Trigger.dev v4)

Only **one** task exists: `trigger/missed-call-recovery.ts` (id `missed-call-recovery`). It does everything in a single run, in this order:

1. Upserts a `recovery_jobs` row keyed on `missed_call_id` (idempotency guard against retries).
2. Sends the initial WhatsApp template (skipped if `whatsapp_sent` is already true) and inserts a `whatsapp_sessions` row.
3. `wait.for({ hours: 24 })`, then checks `whatsapp_sessions.status`/`last_message_at` to see if the patient engaged.
4. If not engaged, sends the `missed_call_followup` template and marks the job `completed`.

**Reply handling is not a Trigger.dev task.** Inbound WhatsApp messages are handled synchronously, in-request, inside `app/api/webhooks/whatsapp/route.ts`, which calls `lib/chatbot.ts#handlePatientMessage` (Claude Haiku) directly and sends the reply before responding to Meta. There is no separate scheduled "lifecycle follow-up" job beyond the single 24h check baked into `missed-call-recovery`.

**`handlePatientMessage` now uses Claude tool-use** instead of free text + a string-matching hack:
- `book_appointment(requested_date, requested_time?, notes?)` — called once the patient has given a date (and optionally time); writes a row to `appointments`, linked to the matching `patients` row when one exists for that `(clinic_id, phone)`.
- `escalate_to_staff(reason?)` — replaces the old approach of asking Claude to literally write the word "ESCALATE" into its reply and stripping it back out. The tool call sets `whatsapp_sessions.status = "escalated"` directly.

The flow per inbound message: load history from `messages`, call Claude with both tools, and — only if it actually invokes a tool — run the corresponding DB write, feed the tool result back, and ask Claude for the final natural-language reply in a second call. If Claude just answers in text (the common FAQ case), there's no second call.

---

## 8. Integrations & configuration

### Exotel
- Missed calls arrive via a **Passthru applet** webhook.
- **[BLOCKER] The Passthru webhook URL must point to the LIVE Vercel deployment**, not localhost or a preview URL. Confirm this before any clinic test.
- Live deployment as of 2026-06-29: **https://call-recovery-system.vercel.app** (Vercel project `call-recovery-system`, linked to this GitHub repo's `main` branch). `EXOTEL_WEBHOOK_URL` still needs updating from its placeholder to `https://call-recovery-system.vercel.app/api/webhooks/exotel` once Exotel is set up.

### Meta WhatsApp Cloud API
- Business verified via the **UDYAM** certificate → **production sending is unlocked**.
- Template is **approved as Utility** (chosen over Marketing to minimize cost).
- **Live as of 2026-06-29.** Real production phone number is `+91 99400 59009` (`META_PHONE_NUMBER_ID=1229528263568640`, WABA name "Medixum AI", WABA ID `1367537938664056`) — verified production-grade, *not* Meta's sandbox Test Number (that was an earlier misconfiguration, now fixed).
- **[GOTCHA — cost real debugging time] Two separate subscriptions are required for inbound webhooks to actually arrive, not one:**
  1. App-level webhook config (`POST /{app-id}/subscriptions` with `callback_url` + `verify_token` + `fields`) — this is what most setup guides cover.
  2. **The WABA itself must separately be subscribed to that app** (`POST /{waba-id}/subscribed_apps`). Skipping this means the app-level webhook can be fully configured and "active": true, GET verification challenges pass fine, and yet **inbound messages never arrive** — there's no error, they just silently never get delivered. This is exactly what happened here: step 1 was done, step 2 wasn't, and a real test message produced no reply with no visible error anywhere. Confirmed via `GET /{waba-id}/subscribed_apps` returning an empty array; fixed by POSTing to that same endpoint.
- Webhook callback URL is now `https://call-recovery-system.vercel.app/api/webhooks/whatsapp` (previously pointed at a dead ngrok tunnel from an earlier session — also a dead end, separate from the gotcha above).
- **[BLOCKER] Template name mismatch between code and docs.** `lib/whatsapp.ts#sendMissedCallTemplate` sends template name `missedcall_recovery` (no underscore between "missed" and "call"), but `docs/phase2-setup-guide.md` and the rest of this plan call it `missed_call_recovery`. Confirm which name was actually approved in WhatsApp Manager — if it's `missed_call_recovery`, the live send will fail with a "template not found" error. The follow-up template name (`missed_call_followup`) matches between code and docs.
- Watch the template **language code** — both templates send hardcoded `language: { code: "en" }` in `lib/whatsapp.ts`, even though Tamil-language bodies are drafted in `docs/phase2-setup-guide.md`. There's no Tamil send path in code yet; a past bug was a language-code mismatch on send.

### Anthropic (Claude Haiku) — currently routed via a temporary stopgap
- Used only for inbound reply handling (outbound first-touch uses the Utility template, no LLM cost).
- **Direct Anthropic billing is still blocked on payment method** (Indian debit cards fail on international recurring charges) — this is unchanged and is the real fix once an international/forex card (Niyo Global / Wise) is available.
- **As of 2026-06-29, `lib/chatbot.ts` is temporarily wired to [AICredits](https://aicredits.in) instead of Anthropic directly** — an OpenAI-compatible LLM gateway billed in INR, used only to unblock testing and the first clinic before direct Anthropic billing works. This is a real architecture difference, not just an env var swap:
  - Uses the `openai` SDK (`baseURL: https://api.aicredits.in/v1`) instead of `@anthropic-ai/sdk`, because AICredits only exposes an OpenAI-compatible `/v1/chat/completions` endpoint, not Anthropic's native `/v1/messages` format.
  - Tool-use is in OpenAI's function-calling shape (`tools: [{type:"function", function:{...}}]`, results as `role:"tool"` messages) rather than Anthropic's content-block format.
  - Model id is `anthropic/claude-haiku-4.5` (AICredits' naming), not Anthropic's own `claude-haiku-4-5-20251001`.
  - Key lives in `AICREDITS_API_KEY`, not `ANTHROPIC_API_KEY` — kept deliberately separate so swapping back later is unambiguous.
  - **Caveat to be aware of:** AICredits is a third-party reseller/aggregator, not an official Anthropic partner (no such relationship is stated on their site). Patient conversation data (names, phone numbers, health-related appointment requests — DPDP-Act-covered per §12) currently transits through this third party. Move off it as soon as direct Anthropic billing is unblocked.
  - **To switch back:** revert `lib/chatbot.ts` to use `@anthropic-ai/sdk` with Anthropic's native tool-use format (the version before this stopgap), point it at `ANTHROPIC_API_KEY`, and update the model id back to `claude-haiku-4-5-20251001`. This is a real revert, not a config change, since the tool-calling formats differ.
- Enable **system prompt caching** — highest-leverage cost optimization for reply handling, once back on Anthropic directly (AICredits' caching behavior, if any, is unverified).
- **Verified working 2026-06-29**: simulated an inbound WhatsApp message end-to-end — Claude correctly called `book_appointment` with extracted date/time, wrote a real `appointments` row, and the natural-language reply was sent back over the real WhatsApp API.

---

## 9. Environment variables (verified against `.env.example`)

```
# Supabase
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
# Added for the dashboard's auth/RLS-bound client (browser + server-action use).
# Safe to expose client-side — RLS policies restrict what the anon key can read.
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=

# Exotel
EXOTEL_WEBHOOK_SECRET=     # Exotel Auth Token — used for the HMAC-SHA1 signature check
EXOTEL_WEBHOOK_URL=        # must exactly match the URL configured in the Passthru applet

# Meta WhatsApp Cloud API
META_WHATSAPP_TOKEN=
META_PHONE_NUMBER_ID=
META_APP_SECRET=           # used for the HMAC-SHA256 webhook signature check
META_WEBHOOK_VERIFY_TOKEN= # you choose this — must match the Meta webhook config

# Anthropic (direct — preferred once available)
ANTHROPIC_API_KEY=

# AICredits (temporary stopgap — see §8, only needed while ANTHROPIC_API_KEY isn't set up)
AICREDITS_API_KEY=

# Trigger.dev
TRIGGER_SECRET_KEY=
TRIGGER_PROJECT_ID=
```

No `WHATSAPP_BUSINESS_ACCOUNT_ID` is used anywhere in code, and Exotel/Meta var names follow the table above, not the originally-guessed `EXOTEL_SID`/`EXOTEL_API_KEY`/`WHATSAPP_TOKEN`/`META_VERIFY_TOKEN` names. `lib/supabase.ts` (service-role) is still the only client used by webhooks and the Trigger.dev job; the `NEXT_PUBLIC_*` pair above is new and only feeds `lib/supabase-server.ts` for the dashboard.

> **Supabase project setting to check:** by default Supabase requires email confirmation before `auth.signUp()` produces a usable session. For fast solo-clinic-owner onboarding, either disable "Confirm email" in Supabase Auth settings, or expect new signups to need to click an email link before `/dashboard` works.

---

## 9a. Auth & clinic dashboard

A clinic owner signs up at `/signup` (creates a Supabase Auth user + a `clinics` row with `owner_user_id` set to that user) and logs in at `/login`. `proxy.ts` (Next.js 16's middleware convention — see §5) refreshes the session cookie on every request and redirects signed-out users away from `/dashboard/*`, and signed-in users away from `/login`/`/signup`. `/api/*` routes are excluded from the proxy matcher — webhooks stay public, since Exotel/Meta call them directly with no Supabase session.

Dashboard pages (`/dashboard`, `/dashboard/calls`, `/dashboard/conversations[/[id]]`, `/dashboard/appointments`, `/dashboard/settings`) all read through `lib/supabase-server.ts`, so RLS does the clinic-scoping — no page needs to manually filter by `clinic_id`. Appointment status updates and clinic-settings edits go through Server Actions (`app/dashboard/appointments/actions.ts`, `app/dashboard/settings/actions.ts`).

One owner account per clinic — there's no multi-staff/roles model. WhatsApp interactive buttons (quick-reply "Book Appointment" / "Talk to Us") are explicitly out of scope for now; the chatbot is still plain text only.

---

## 10. Local setup

```bash
npm install
cp .env.example .env.local   # then fill in values from section 9
# apply both migrations to Supabase, in order:
#   supabase/migrations/001_initial_schema.sql
#   supabase/migrations/002_auth_patients_messages_appointments.sql
npx trigger.dev@latest dev   # run the Trigger.dev dev server
npm run dev                  # run Next.js
```

---

## 11. Current status & remaining blockers

Done:
- ✅ Meta Business Verification (via UDYAM) → production WhatsApp sending unlocked
- ✅ `missed_call_recovery` template approved (Utility)
- ✅ Trigger.dev v2 → v4 migration (`task()` pattern)
- ✅ Full codebase review
- ✅ Clinic auth (signup/login) + dashboard (overview, missed calls, conversations, appointments, settings) — see §9a
- ✅ `patients`, `messages`, `appointments` tables + RLS policies (migration `002_*`)
- ✅ Claude tool-use for appointment capture + escalation (see §7)
- ✅ Clinic identification by DID (Exotel) and by `whatsapp_phone_number_id` (cold WhatsApp messages)
- ✅ `npm run build` passes clean (typecheck + Next.js production build)
- ✅ Migration `002_auth_patients_messages_appointments.sql` applied to the real Supabase project; demo clinic's `whatsapp_phone_number_id` set
- ✅ Deployed live to Vercel: **https://call-recovery-system.vercel.app** (2026-06-29)
- ✅ Real production WhatsApp number confirmed and wired up (`+91 99400 59009`, WABA "Medixum AI") — replaced the earlier Test Number misconfiguration
- ✅ **Full live end-to-end WhatsApp chatbot test passed (2026-06-29)**: real inbound message via Meta webhook (no simulation) → Claude (via AICredits stopgap, see §8) → `book_appointment` tool called correctly → real `appointments` row written → real reply sent back over WhatsApp
- ✅ Meta webhook fully wired: app-level subscription + WABA-level `subscribed_apps` (see the gotcha noted in §8) + callback URL pointed at the live Vercel deployment

Blockers before first clinic test:
- [ ] Confirm **Exotel Passthru webhook URL → live Vercel deployment** — needs to be updated from its current placeholder to `https://call-recovery-system.vercel.app/api/webhooks/exotel` once Exotel is set up
- [ ] Obtain a **direct Anthropic API key** and move off the AICredits stopgap (resolve international card; see §8 for what reverting involves — it's a real code change, not just an env swap)
- [ ] **Resolve the WhatsApp template name mismatch** — code sends `missedcall_recovery`, docs/plan say `missed_call_recovery` (see §8). Whichever one isn't the real approved name will fail in production. (This only affects the Exotel-triggered first-touch template send, not the chatbot reply flow already tested live.)
- [ ] Decide on Supabase Auth email-confirmation setting for fast onboarding (see note in §9)
- [ ] Not yet built: WhatsApp interactive buttons (explicitly deferred — see §9a)

**Target:** first paying clinic by **end of July**; recurring revenue from **August**.

---

## 12. Compliance

Patient data falls under India's **DPDP Act** — treat caller numbers and conversation logs as personal data (consent, retention, access control).

---

## 13. Business context (brief)

- Sales structure: free 14-day pilot with an upfront setup fee.
- Proof milestone: one paying client with receipt, a video of the bot recovering a real patient, and an MRR tracker.
- Strategy: "Product-Led Prospecting" — niche demos that generate a warm prospect list.
