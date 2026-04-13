-- Enable RLS on all tables (explicit, in case not already enabled)
alter table members                     enable row level security;
alter table tournaments                 enable row level security;
alter table tiers                       enable row level security;
alter table registrations               enable row level security;
alter table lottery_results             enable row level security;
alter table prior_year_winners          enable row level security;
alter table flight_winner_registrations enable row level security;

-- ── Helper: identify the admin user ─────────────────────────────────────────
create or replace function is_admin()
returns boolean
language sql security definer
as $$
  select coalesce(auth.jwt() ->> 'email', '') = 'admin@skymga.org'
$$;

-- ── members ──────────────────────────────────────────────────────────────────
-- Admin: full access
create policy "members_admin_all" on members
  for all to authenticated
  using (is_admin())
  with check (is_admin());

-- Members: read own row only
create policy "members_own_read" on members
  for select to authenticated
  using (auth_uid = auth.uid());

-- ── tournaments ───────────────────────────────────────────────────────────────
-- Admin: full access
create policy "tournaments_admin_all" on tournaments
  for all to authenticated
  using (is_admin())
  with check (is_admin());

-- Public (anon + authenticated): read all
create policy "tournaments_public_read" on tournaments
  for select to anon, authenticated
  using (true);

-- ── tiers ─────────────────────────────────────────────────────────────────────
-- Admin: full access
create policy "tiers_admin_all" on tiers
  for all to authenticated
  using (is_admin())
  with check (is_admin());

-- Public: read all
create policy "tiers_public_read" on tiers
  for select to anon, authenticated
  using (true);

-- ── registrations ─────────────────────────────────────────────────────────────
-- Admin: full access
create policy "registrations_admin_all" on registrations
  for all to authenticated
  using (is_admin())
  with check (is_admin());

-- Members: read/insert own row
create policy "registrations_own_read" on registrations
  for select to authenticated
  using (
    member_id in (select id from members where auth_uid = auth.uid())
  );

create policy "registrations_own_insert" on registrations
  for insert to authenticated
  with check (
    member_id in (select id from members where auth_uid = auth.uid())
  );

-- Accept page: anon read by acceptance_token (no auth on that page)
create policy "registrations_token_read" on registrations
  for select to anon
  using (acceptance_token is not null);

-- ── lottery_results ───────────────────────────────────────────────────────────
-- Admin: full access
create policy "lottery_results_admin_all" on lottery_results
  for all to authenticated
  using (is_admin())
  with check (is_admin());

-- (Published read + own read policies already created in migration 009)

-- ── prior_year_winners ────────────────────────────────────────────────────────
-- Admin: full access
create policy "prior_year_winners_admin_all" on prior_year_winners
  for all to authenticated
  using (is_admin())
  with check (is_admin());

-- Public: read all
create policy "prior_year_winners_public_read" on prior_year_winners
  for select to anon, authenticated
  using (true);

-- ── flight_winner_registrations ───────────────────────────────────────────────
-- Admin: full access
create policy "fwr_admin_all" on flight_winner_registrations
  for all to authenticated
  using (is_admin())
  with check (is_admin());

-- Members: read own row
create policy "fwr_own_read" on flight_winner_registrations
  for select to authenticated
  using (
    member_id in (select id from members where auth_uid = auth.uid())
  );
