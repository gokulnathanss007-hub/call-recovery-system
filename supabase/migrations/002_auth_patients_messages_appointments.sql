-- ─────────────────────────────────────────
-- clinics: auth + lookup columns
-- ─────────────────────────────────────────
alter table clinics add column if not exists owner_user_id uuid references auth.users(id) on delete set null;
alter table clinics add column if not exists whatsapp_phone_number_id text; -- Meta phone_number_id, for identifying clinic on cold inbound messages

create unique index if not exists clinics_owner_user_id_key on clinics (owner_user_id);

-- ─────────────────────────────────────────
-- missed_calls: backfill index for clinic lookups (clinic_id column already existed)
-- ─────────────────────────────────────────
-- (no schema change needed — clinic_id already exists per 001_initial_schema.sql)

-- ─────────────────────────────────────────
-- whatsapp_sessions: conversation history now lives in the `messages` table
-- ─────────────────────────────────────────
alter table whatsapp_sessions drop column if exists context;

-- ─────────────────────────────────────────
-- patients — normalized patient identity per clinic
-- ─────────────────────────────────────────
create table if not exists patients (
  id               uuid primary key default gen_random_uuid(),
  clinic_id        uuid not null references clinics(id) on delete cascade,
  phone            text not null,
  name             text,
  first_seen_at    timestamptz not null default now(),
  last_contact_at  timestamptz,
  created_at       timestamptz not null default now()
);

create unique index if not exists patients_clinic_phone_key on patients (clinic_id, phone);

alter table patients enable row level security;

-- ─────────────────────────────────────────
-- messages — normalized chat history (replaces whatsapp_sessions.context jsonb)
-- ─────────────────────────────────────────
create table if not exists messages (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references whatsapp_sessions(id) on delete cascade,
  clinic_id   uuid references clinics(id) on delete set null,
  role        text not null,  -- user | assistant
  content     text not null,
  created_at  timestamptz not null default now()
);

create index if not exists messages_session_created_idx on messages (session_id, created_at);
create index if not exists messages_clinic_idx on messages (clinic_id);

alter table messages enable row level security;

-- ─────────────────────────────────────────
-- appointments — structured bookings captured via Claude tool-use
-- ─────────────────────────────────────────
create table if not exists appointments (
  id              uuid primary key default gen_random_uuid(),
  clinic_id       uuid references clinics(id) on delete cascade,
  patient_id      uuid references patients(id) on delete set null,
  session_id      uuid references whatsapp_sessions(id) on delete set null,
  requested_date  text not null,   -- free-form as captured from conversation, e.g. "tomorrow morning"
  requested_time  text,
  notes           text,
  status          text not null default 'pending', -- pending | confirmed | cancelled
  created_at      timestamptz not null default now()
);

create index if not exists appointments_clinic_status_idx on appointments (clinic_id, status);
create index if not exists appointments_patient_idx on appointments (patient_id);

alter table appointments enable row level security;

-- ─────────────────────────────────────────
-- RLS policies — clinic owner can read/manage their own clinic's rows.
-- Service role (used by webhooks + Trigger.dev jobs) bypasses RLS automatically,
-- so the existing recovery flow is unaffected by any of this.
-- ─────────────────────────────────────────

create policy "Owner can view own clinic" on clinics
  for select using (auth.uid() = owner_user_id);

create policy "Owner can update own clinic" on clinics
  for update using (auth.uid() = owner_user_id);

create policy "Owner can view own missed_calls" on missed_calls
  for select using (
    clinic_id in (select id from clinics where owner_user_id = auth.uid())
  );

create policy "Owner can view own whatsapp_sessions" on whatsapp_sessions
  for select using (
    clinic_id in (select id from clinics where owner_user_id = auth.uid())
  );

create policy "Owner can view own messages" on messages
  for select using (
    clinic_id in (select id from clinics where owner_user_id = auth.uid())
  );

create policy "Owner can view own patients" on patients
  for select using (
    clinic_id in (select id from clinics where owner_user_id = auth.uid())
  );

create policy "Owner can view own appointments" on appointments
  for select using (
    clinic_id in (select id from clinics where owner_user_id = auth.uid())
  );

create policy "Owner can update own appointments" on appointments
  for update using (
    clinic_id in (select id from clinics where owner_user_id = auth.uid())
  );

create policy "Owner can view own recovery_jobs" on recovery_jobs
  for select using (
    missed_call_id in (
      select id from missed_calls where clinic_id in (
        select id from clinics where owner_user_id = auth.uid()
      )
    )
  );
