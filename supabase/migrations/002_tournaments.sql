create table tournaments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  year int not null unique,
  description text,
  status text not null default 'draft'
    check (status in ('draft', 'open', 'closed', 'complete')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger tournaments_updated_at
  before update on tournaments
  for each row execute function update_updated_at();
