-- ============================================================================
-- 0012_notifications_whatsapp.sql — automated WhatsApp notifications
-- ----------------------------------------------------------------------------
-- Builds on 0004's outbound_messages (the comms log + sendWhatsApp). Adds:
--   - a per-profile opt-in so families control WhatsApp messaging
--   - kind / session_id / dedupe_key on outbound_messages so the dispatcher can
--     classify messages and guarantee we never send the same event twice (the
--     reminders cron runs every 15 min and must be idempotent).
-- ============================================================================

-- Families default opted-in (they signed up for the tutoring service); they can
-- be turned off per profile. Reminders/notifications skip anyone opted out.
alter table profiles add column if not exists whatsapp_opt_in boolean not null default true;

alter table outbound_messages add column if not exists kind       text;
alter table outbound_messages add column if not exists session_id uuid references sessions(id) on delete set null;
alter table outbound_messages add column if not exists dedupe_key text;

-- Claim-then-send: the dispatcher inserts a 'queued' row keyed by dedupe_key
-- BEFORE calling WhatsApp, so concurrent cron runs can't double-send. NULLs are
-- distinct in Postgres, so manual (un-keyed) messages are unaffected.
create unique index if not exists outbound_messages_dedupe_key_idx
  on outbound_messages (dedupe_key);

create index if not exists outbound_messages_session_idx on outbound_messages (session_id);

notify pgrst, 'reload schema';
