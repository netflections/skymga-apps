create table prior_year_winners (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id),
  flight_name text not null,
  member_id uuid not null references members(id),
  guest_name text not null,
  created_at timestamptz not null default now()
);
