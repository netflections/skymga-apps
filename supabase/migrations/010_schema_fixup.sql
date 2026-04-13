-- ── tournaments: add all missing columns ────────────────────────────────────
alter table tournaments
  add column if not exists deposit_amount        numeric(10,2) not null default 0,
  add column if not exists last_confirmation_seq int           not null default 0,
  add column if not exists seniority_acceptance_days int       not null default 7,
  add column if not exists general_acceptance_days   int       not null default 7,
  add column if not exists waitlist_acceptance_hours int       not null default 24,
  add column if not exists registration_opens_at              timestamptz,
  add column if not exists registration_deadline              timestamptz,
  add column if not exists flight_winner_registration_deadline timestamptz,
  add column if not exists confirmation_cc_email              text,
  add column if not exists timezone text not null default 'America/New_York';

-- ── tiers: fix column names, nullability, and add missing columns ────────────
-- rename registration_deadline -> acceptance_deadline
alter table tiers
  rename column registration_deadline to acceptance_deadline;

-- make draw_date and acceptance_deadline nullable (waitlist tier has neither)
alter table tiers
  alter column draw_date        drop not null,
  alter column acceptance_deadline drop not null;

alter table tiers
  add column if not exists reminder_hours_before_deadline int not null default 48;

-- ── registrations: add missing columns ──────────────────────────────────────
alter table registrations
  add column if not exists deposit_paid        boolean   not null default false,
  add column if not exists acceptance_token    text      unique,
  add column if not exists acceptance_deadline timestamptz,
  add column if not exists declined_at         timestamptz,
  add column if not exists reminder_sent_at    timestamptz,
  add column if not exists confirmation_number text      unique,
  add column if not exists paypal_order_id     text;

-- fix status check constraint to include post-draw statuses
alter table registrations
  drop constraint if exists registrations_status_check;
alter table registrations
  add constraint registrations_status_check
    check (status in ('pending', 'selected', 'waitlisted', 'not_selected', 'expired', 'declined', 'withdrawn'));

-- ── lottery_results: fix 'waitlist' typo → 'waitlisted' ─────────────────────
alter table lottery_results
  drop constraint if exists lottery_results_result_check;
alter table lottery_results
  add constraint lottery_results_result_check
    check (result in ('selected', 'waitlisted', 'not_selected'));
