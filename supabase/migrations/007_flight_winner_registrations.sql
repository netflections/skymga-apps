create table flight_winner_registrations (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id),
  member_id uuid not null references members(id),
  status text not null default 'no_response'
    check (status in ('accepted', 'declined', 'no_response')),
  responded_at timestamptz,
  unique(tournament_id, member_id)
);
