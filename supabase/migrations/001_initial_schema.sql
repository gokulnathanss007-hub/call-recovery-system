-- Enable UUID generation
create extension if not exists "pgcrypto";

-- ─────────────────────────────────────────
-- clinics  (seed row for demo)
-- ─────────────────────────────────────────
create table if not exists clinics (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  did        text,             -- Exotel virtual DID
  created_at timestamptz not null default now()
);

-- Demo clinic seed row (use this clinic_id everywhere during testing)
insert into clinics (id, name, did)
values ('00000000-0000-0000-0000-000000000001', 'Demo Clinic - Medixum CGE', '+914422000000')
on conflict do nothing;

-- ─────────────────────────────────────────
-- missed_calls
-- ─────────────────────────────────────────
create table if not exists missed_calls (
  id                  uuid primary key default gen_random_uuid(),
  clinic_id           uuid references clinics(id) on delete set null,
  patient_phone       text not null,        -- E.164 e.g. +919876543210
  exotel_did          text not null,        -- virtual DID the patient called
  call_status         text not null,        -- no-answer | busy | failed
  call_timestamp      timestamptz not null, -- when the call came in
  webhook_received_at timestamptz not null,
  raw_payload         jsonb,                -- full Exotel webhook body for debugging
  created_at          timestamptz not null default now()
);

create index on missed_calls (patient_phone);
create index on missed_calls (call_timestamp desc);
create index on missed_calls (clinic_id);

alter table missed_calls enable row level security;
-- Service role (used by webhooks/jobs) bypasses RLS automatically.
-- Future: add per-clinic dashboard policies here.

-- ─────────────────────────────────────────
-- whatsapp_sessions
-- ─────────────────────────────────────────
create table if not exists whatsapp_sessions (
  id              uuid primary key default gen_random_uuid(),
  clinic_id       uuid references clinics(id) on delete set null,
  patient_phone   text not null,
  missed_call_id  uuid references missed_calls(id) on delete set null,
  session_id      text,                           -- Meta WhatsApp message ID
  last_message_at timestamptz,
  context         jsonb not null default '[]',    -- [{role, content}] for Claude Haiku
  status          text not null default 'active', -- active | closed | escalated
  created_at      timestamptz not null default now()
);

create index on whatsapp_sessions (patient_phone);
create index on whatsapp_sessions (status);
create index on whatsapp_sessions (missed_call_id);

alter table whatsapp_sessions enable row level security;

-- ─────────────────────────────────────────
-- voice_callbacks  (Phase 8 — built now, used later)
-- ─────────────────────────────────────────
create table if not exists voice_callbacks (
  id               uuid primary key default gen_random_uuid(),
  missed_call_id   uuid references missed_calls(id) on delete cascade,
  patient_phone    text not null,
  call_initiated_at timestamptz,
  call_duration    int,                  -- seconds
  transcript       jsonb,               -- ElevenLabs + Claude transcript
  outcome          text,                -- booked | info_given | escalated | no_answer
  created_at       timestamptz not null default now()
);

create index on voice_callbacks (missed_call_id);

alter table voice_callbacks enable row level security;

-- ─────────────────────────────────────────
-- recovery_jobs
-- Idempotency guard — one job row per missed call
-- ─────────────────────────────────────────
create table if not exists recovery_jobs (
  id               uuid primary key default gen_random_uuid(),
  missed_call_id   uuid not null references missed_calls(id) on delete cascade,
  trigger_run_id   text,
  whatsapp_sent    boolean not null default false,
  whatsapp_sent_at timestamptz,
  reminder_sent    boolean not null default false,
  reminder_sent_at timestamptz,
  status           text not null default 'pending', -- pending | completed | failed
  created_at       timestamptz not null default now()
);

create unique index on recovery_jobs (missed_call_id);

alter table recovery_jobs enable row level security;
