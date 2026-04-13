-- Grant table-level permissions to Supabase roles.
-- Migrations don't automatically inherit default privileges, so we
-- must grant explicitly for PostgREST to accept authenticated requests.

grant select, insert, update, delete on table members                    to authenticated;
grant select, insert, update, delete on table tournaments                to authenticated;
grant select, insert, update, delete on table tiers                      to authenticated;
grant select, insert, update, delete on table registrations              to authenticated;
grant select, insert, update, delete on table lottery_results            to authenticated;
grant select, insert, update, delete on table prior_year_winners         to authenticated;
grant select, insert, update, delete on table flight_winner_registrations to authenticated;

-- anon role: read-only on public tables
grant select on table tournaments                to anon;
grant select on table tiers                      to anon;
grant select on table lottery_results            to anon;
grant select on table prior_year_winners         to anon;

-- anon insert on registrations (members self-register before they're authenticated)
grant select, insert on table registrations      to anon;
grant select on table members                    to anon;
