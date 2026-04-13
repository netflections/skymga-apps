-- RLS policy: anon users can read lottery_results only for published tournaments
-- (replaces the plan's "status = complete" check with the explicit results_published flag)
create policy "lottery_results_published_read"
  on lottery_results for select
  to anon, authenticated
  using (
    exists (
      select 1 from tournaments t
      where t.id = lottery_results.tournament_id
        and t.results_published = true
    )
  );

-- Also allow members to read their own lottery results regardless of publish status
create policy "lottery_results_own_read"
  on lottery_results for select
  to authenticated
  using (
    member_id in (
      select id from members where auth_uid = auth.uid()
    )
  );
