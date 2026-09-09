-- "Forfeit" player status: a registration that is no longer part of the
-- auction or any matches. Modeled as a flag on registrations (not a team role,
-- since a forfeited player isn't on a team).

alter table public.registrations
  add column if not exists forfeited boolean not null default false;

-- Expose the flag to the admin players list.
drop function if exists public.admin_players();
create function public.admin_players()
returns table (
  id uuid, name text, email text, employee_id text, photo_url text, player_type text,
  gender text, location text, dpl_played boolean, self_rating numeric,
  batting_style text, bowling_style text, bowling_arm text, availability text,
  jersey_size text, created_at timestamptz, forfeited boolean,
  team_id uuid, team_code text, role text
)
language sql
security definer
set search_path = public
as $$
  select
    r.id, r.name, r.email, r.employee_id, r.photo_url, r.player_type, r.gender,
    r.location, r.dpl_played, r.self_rating, r.batting_style, r.bowling_style,
    r.bowling_arm, r.availability, r.jersey_size, r.created_at, coalesce(r.forfeited, false),
    tp.team_id, t.code as team_code, tp.role
  from public.registrations r
  left join public.team_players tp on tp.player_id = r.id
  left join public.teams t on t.id = tp.team_id
  where public.is_admin()
$$;
grant execute on function public.admin_players() to public;

-- Exclude forfeited players from the auction pool when seeding a new session.
create or replace function public.admin_auction_start_session(
  p_name text, p_purse integer, p_increment integer, p_timer integer
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_session uuid; v_retention integer; v_lot_base integer;
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  select auction_retention_price, auction_purse into v_retention, v_lot_base from public.settings where id = 1;
  v_lot_base := coalesce(greatest(coalesce(p_purse, v_lot_base), 0), 5000000);
  v_retention := greatest(coalesce(v_retention, 0), 0);
  update public.auction_sessions set status = 'ended', ended_at = now(), updated_at = now() where status = 'live';
  insert into public.auction_sessions (name, status, purse_budget, increment, lot_timer_seconds, started_at)
  values (coalesce(nullif(p_name, ''), 'DPL 2026 AUCTION'), 'live', v_lot_base, greatest(coalesce(p_increment, 100000), 0), greatest(coalesce(p_timer, 60), 10), now())
  returning id into v_session;
  insert into public.auction_purses (session_id, team_id, budget)
  select v_session, t.id, v_lot_base from public.teams t;

  insert into public.auction_results (session_id, player_id, lot_order, base_price, status, sold_to_team_id, sold_price, source)
  select v_session, tp.player_id, -100000 + row_number() over (order by t.sort_order, r.name),
         0, 'sold', tp.team_id,
         case when tp.role in ('owner', 'co_owner', 'captain') then 0 else v_retention end, 'retained'
  from public.team_players tp
  join public.teams t on t.id = tp.team_id
  join public.registrations r on r.id = tp.player_id;

  insert into public.auction_results (session_id, player_id, lot_order)
  select v_session, r.id, row_number() over (order by r.created_at)
  from public.registrations r
  where not exists (select 1 from public.team_players tp where tp.player_id = r.id)
    and not coalesce(r.forfeited, false);
  return v_session;
end;
$$;

-- Same exclusion on resync.
create or replace function public.admin_auction_resync_pool(v_session uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_retention integer;
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  select auction_retention_price into v_retention from public.settings where id = 1;
  v_retention := greatest(coalesce(v_retention, 0), 0);
  delete from public.auction_bids b
  using public.auction_results ar
  where ar.session_id = v_session and ar.status = 'pool'
    and b.session_id = v_session and b.player_id = ar.player_id
    and exists (select 1 from public.team_players tp where tp.player_id = ar.player_id);
  delete from public.auction_results ar
  using public.team_players tp
  where ar.session_id = v_session and ar.status = 'pool' and tp.player_id = ar.player_id;
  delete from public.auction_results ar
  where ar.session_id = v_session and ar.source = 'retained'
    and not exists (select 1 from public.team_players tp where tp.player_id = ar.player_id);
  update public.auction_results ar set
    sold_price = case when tp.role in ('owner', 'co_owner', 'captain') then 0 else v_retention end,
    updated_at = now()
  from public.team_players tp
  where ar.session_id = v_session and ar.source = 'retained' and tp.player_id = ar.player_id;
  insert into public.auction_results (session_id, player_id, lot_order, base_price, status, sold_to_team_id, sold_price, source)
  select v_session, tp.player_id, -100000 + row_number() over (order by t.sort_order, r.name),
         0, 'sold', tp.team_id,
         case when tp.role in ('owner', 'co_owner', 'captain') then 0 else v_retention end, 'retained'
  from public.team_players tp
  join public.teams t on t.id = tp.team_id
  join public.registrations r on r.id = tp.player_id
  where not exists (select 1 from public.auction_results ar
                    where ar.session_id = v_session and ar.player_id = tp.player_id);
  insert into public.auction_results (session_id, player_id, lot_order)
  select v_session, r.id, (select coalesce(max(lot_order), 0) from public.auction_results ar2
                            where ar2.session_id = v_session and ar2.lot_order > 0) + row_number() over (order by r.created_at)
  from public.registrations r
  where not exists (select 1 from public.team_players tp where tp.player_id = r.id)
    and not coalesce(r.forfeited, false)
    and not exists (select 1 from public.auction_results ar
                    where ar.session_id = v_session and ar.player_id = r.id);
end;
$$;
