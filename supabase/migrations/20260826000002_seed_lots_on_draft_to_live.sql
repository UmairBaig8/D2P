-- Live auction: allow STARTING an existing DRAFT session without recreating it.
-- admin_auction_update_session can now flip draft → live AND seeds the per-team
-- purses and the unassigned-player lot queue at that moment.
--
-- Idempotent by design: every insert uses `where not exists`, so re-running or
-- toggling a session live again never duplicates or overwrites existing data.
-- Only reads public.registrations (never modifies the registrations table).

drop function if exists public.admin_auction_update_session(uuid, text, integer, integer, integer, text);
create or replace function public.admin_auction_update_session(v_session uuid, p_name text, p_purse integer, p_increment integer, p_timer integer, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_before text;
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;

  select status into v_before from public.auction_sessions where id = v_session;

  update public.auction_sessions s set
    name = coalesce(nullif(p_name, ''), s.name),
    purse_budget = coalesce(p_purse, s.purse_budget),
    increment = coalesce(p_increment, s.increment),
    lot_timer_seconds = greatest(coalesce(p_timer, s.lot_timer_seconds), 10),
    status = coalesce(nullif(p_status, ''), s.status),
    started_at = case when s.status = 'draft' and coalesce(nullif(p_status, ''), s.status) = 'live' then now() else s.started_at end,
    ended_at = case when coalesce(nullif(p_status, ''), s.status) = 'ended' then now() else null end,
    updated_at = now()
  where s.id = v_session;

  if p_purse is not null then
    update public.auction_purses set budget = greatest(p_purse, 0) where session_id = v_session;
  end if;

  -- Seed the lot queue + purses the first time a draft session goes live.
  if v_before = 'draft' and coalesce(nullif(p_status, ''), '') = 'live' then
    insert into public.auction_purses (session_id, team_id, budget)
    select v_session, t.id, coalesce(
      (select purse_budget from public.auction_sessions where id = v_session), 5000000)
    from public.teams t
    where not exists (
      select 1 from public.auction_purses p where p.session_id = v_session and p.team_id = t.id
    );

    insert into public.auction_results (session_id, player_id, lot_order)
    select v_session, r.id, row_number() over (order by r.created_at)
    from public.registrations r
    where not exists (select 1 from public.team_players tp where tp.player_id = r.id)
      and not exists (
        select 1 from public.auction_results ar
        where ar.session_id = v_session and ar.player_id = r.id
      );
  end if;
end;
$$;

revoke all on function public.admin_auction_update_session(uuid, text, integer, integer, integer, text) from public;
grant execute on function public.admin_auction_update_session(uuid, text, integer, integer, integer, text) to authenticated;
