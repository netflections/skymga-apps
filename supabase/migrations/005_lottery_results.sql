create table lottery_results (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id),
  tier_id uuid not null references tiers(id),
  member_id uuid not null references members(id),
  draw_position int,
  result text not null
    check (result in ('selected', 'waitlist', 'not_selected')),
  drawn_at timestamptz not null default now()
);
