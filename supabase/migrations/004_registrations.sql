create table registrations (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id),
  tier_id uuid not null references tiers(id),
  member_id uuid not null references members(id),
  guest_name text not null,
  guest_email text not null,
  guest_phone text not null,
  guest_ghin text not null check (guest_ghin ~ '^\d{7}$'),
  registered_at timestamptz not null default now(),
  status text not null default 'pending'
    check (status in ('pending', 'entered', 'selected', 'waitlisted', 'not_selected')),
  unique(tournament_id, member_id)
);
