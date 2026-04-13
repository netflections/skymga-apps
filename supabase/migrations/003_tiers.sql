create table tiers (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  name text not null,
  type text not null
    check (type in ('flight_winners', 'seniority', 'general', 'waitlist')),
  min_years int,          -- seniority tiers only: cumulative threshold (e.g. 15 = "15+ years")
  allocated_spots int not null,
  registration_deadline timestamptz not null,
  draw_date timestamptz not null,
  draw_order int not null,
  created_at timestamptz not null default now()
);
