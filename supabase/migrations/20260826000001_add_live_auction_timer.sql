-- Live Auction Timer: configurable per-lot countdown with auto-unsold.
-- Adds lot_timer_seconds to sessions, opens_at to results, auto-expiry in state
-- RPCs, and an EXTEND RPC so the auctioneer can add time mid-lot.

alter table public.auction_sessions
  add column if not exists lot_timer_seconds integer not null default 60 check (lot_timer_seconds >= 10);

alter table public.auction_results
  add column if not exists opens_at timestamptz;

-- Internal helper: flip any expired on-auction lot to unsold.
drop function if exists public.auction_expire_overdue(uuid);
create or replace function public.auction_expire_overdue(v_session uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.auction_results ar
  set status = 'unsold', opens_at = null, updated_at = now()
  from public.auction_sessions s
  where ar.session_id = v_session
    and s.id = ar.session_id
    and ar.status = 'on_auction'
    and ar.opens_at is not null
    and ar.opens_at + make_interval(secs => s.lot_timer_seconds) < now();
$$;

revoke all on function public.auction_expire_overdue(uuid) from public;

-- ---------------------------------------------------------------------------
-- Public RPC (now plpgsql so it can expire overdue lots, adds timer_ends_at)
-- ---------------------------------------------------------------------------

drop function if exists public.auction_live_state();
create or replace function public.auction_live_state()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_session uuid;
begin
  select id into v_session from public.auction_sessions
  order by (status = 'live') desc, created_at desc limit 1;
  if v_session is not null then
    perform public.auction_expire_overdue(v_session);
  end if;
  return (
    with s as (
      select * from public.auction_sessions
      order by (status = 'live') desc, created_at desc limit 1
    ),
    cur as (
      select ar.* from public.auction_results ar
      join s on s.id = ar.session_id
      where ar.status = 'on_auction'
      order by ar.updated_at desc limit 1
    ),
    curbids as (
      select b.* from public.auction_bids b
      join cur on cur.player_id = b.player_id
      join s on s.id = b.session_id
    )
    select jsonb_build_object(
      'session', (select to_jsonb(s) from s),
      'current_player', case when exists (select 1 from cur) then (
        select jsonb_build_object(
          'player_id', r.id, 'name', r.name, 'employee_id', r.employee_id, 'photo_url', r.photo_url,
          'player_type', r.player_type, 'gender', r.gender, 'location', r.location,
          'dpl_played', r.dpl_played, 'self_rating', r.self_rating, 'availability', r.availability,
          'batting_style', r.batting_style, 'bowling_style', r.bowling_style,
          'lot_order', cur.lot_order, 'base_price', cur.base_price,
          'timer_ends_at', to_char(cur.opens_at + make_interval(secs => s.lot_timer_seconds), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        )
        from cur join public.registrations r on r.id = cur.player_id
      ) else null end,
      'current_bid', case when exists (select 1 from curbids) then (
        select jsonb_build_object(
          'team_id', t.id, 'team_name', t.name, 'team_code', t.code, 'team_icon_url', t.icon_url,
          'amount', cb.amount, 'created_at', cb.created_at
        )
        from curbids cb join public.teams t on t.id = cb.team_id
        order by cb.amount desc, cb.created_at desc limit 1
      ) else null end,
      'bid_count', (select count(*) from curbids),
      'bids', coalesce((select jsonb_agg(
          jsonb_build_object('team_code', t.code, 'amount', cb.amount, 'created_at', cb.created_at)
          order by cb.created_at desc
        ) from curbids cb join public.teams t on t.id = cb.team_id), '[]'::jsonb),
      'teams', coalesce((select jsonb_agg(jsonb_build_object(
          'team_id', t.id, 'name', t.name, 'code', t.code, 'icon_url', t.icon_url, 'theme', t.theme,
          'budget', p.budget,
          'spent', coalesce((select sum(ar.sold_price) from public.auction_results ar
                             where ar.session_id = s.id and ar.sold_to_team_id = t.id and ar.status = 'sold'), 0),
          'squad', (select count(*) from public.team_players tp where tp.team_id = t.id),
          'sold', (select count(*) from public.auction_results ar
                   where ar.session_id = s.id and ar.sold_to_team_id = t.id and ar.status = 'sold')
        ) order by t.sort_order)
        from public.auction_purses p join public.teams t on t.id = p.team_id
        join s on s.id = p.session_id), '[]'::jsonb),
      'pool_count', (select count(*) from public.auction_results ar
                     join s on s.id = ar.session_id where ar.status = 'pool'),
      'results', coalesce((select jsonb_agg(jsonb_build_object(
          'player_name', r.name, 'photo_url', r.photo_url, 'player_type', r.player_type,
          'team_code', t.code, 'sold_price', ar.sold_price, 'status', ar.status, 'lot_order', ar.lot_order
        ) order by ar.lot_order)
        from public.auction_results ar
        join public.registrations r on r.id = ar.player_id
        left join public.teams t on t.id = ar.sold_to_team_id
        join s on s.id = ar.session_id
        where ar.status in ('sold', 'unsold')), '[]'::jsonb)
    )
  );
end;
$$;

revoke all on function public.auction_live_state() from public;
grant execute on function public.auction_live_state() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Admin RPCs
-- ---------------------------------------------------------------------------

drop function if exists public.admin_auction_state();
create or replace function public.admin_auction_state()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_session uuid;
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  select id into v_session from public.auction_sessions
  order by (status = 'live') desc, created_at desc limit 1;
  if v_session is not null then
    perform public.auction_expire_overdue(v_session);
  end if;
  return (
    with s as (
      select * from public.auction_sessions
      order by (status = 'live') desc, created_at desc limit 1
    ),
    cur as (
      select ar.* from public.auction_results ar
      join s on s.id = ar.session_id
      where ar.status = 'on_auction'
      order by ar.updated_at desc limit 1
    ),
    curbids as (
      select b.* from public.auction_bids b
      join cur on cur.player_id = b.player_id
      join s on s.id = b.session_id
    )
    select jsonb_build_object(
      'session', (select to_jsonb(s) from s),
      'current_player', case when exists (select 1 from cur) then (
        select jsonb_build_object(
          'player_id', r.id, 'name', r.name, 'employee_id', r.employee_id, 'photo_url', r.photo_url,
          'player_type', r.player_type, 'gender', r.gender, 'location', r.location,
          'dpl_played', r.dpl_played, 'self_rating', r.self_rating, 'availability', r.availability,
          'batting_style', r.batting_style, 'bowling_style', r.bowling_style,
          'lot_order', cur.lot_order, 'base_price', cur.base_price,
          'timer_ends_at', to_char(cur.opens_at + make_interval(secs => s.lot_timer_seconds), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        )
        from cur join public.registrations r on r.id = cur.player_id
      ) else null end,
      'current_bid', case when exists (select 1 from curbids) then (
        select jsonb_build_object(
          'team_id', t.id, 'team_name', t.name, 'team_code', t.code, 'amount', cb.amount
        )
        from curbids cb join public.teams t on t.id = cb.team_id
        order by cb.amount desc, cb.created_at desc limit 1
      ) else null end,
      'players', coalesce((select jsonb_agg(jsonb_build_object(
          'player_id', r.id, 'name', r.name, 'photo_url', r.photo_url, 'employee_id', r.employee_id,
          'player_type', r.player_type, 'gender', r.gender, 'location', r.location, 'dpl_played', r.dpl_played,
          'self_rating', r.self_rating, 'availability', r.availability,
          'lot_order', ar.lot_order, 'base_price', ar.base_price, 'status', ar.status,
          'sold_to_team_id', ar.sold_to_team_id, 'sold_price', ar.sold_price,
          'opens_at', ar.opens_at
        ) order by ar.lot_order)
        from public.auction_results ar
        join public.registrations r on r.id = ar.player_id
        join s on s.id = ar.session_id), '[]'::jsonb),
      'teams', coalesce((select jsonb_agg(jsonb_build_object(
          'team_id', t.id, 'name', t.name, 'code', t.code, 'icon_url', t.icon_url, 'theme', t.theme,
          'budget', p.budget,
          'spent', coalesce((select sum(ar.sold_price) from public.auction_results ar
                             where ar.session_id = s.id and ar.sold_to_team_id = t.id and ar.status = 'sold'), 0),
          'squad', (select count(*) from public.team_players tp where tp.team_id = t.id),
          'sold', (select count(*) from public.auction_results ar
                   where ar.session_id = s.id and ar.sold_to_team_id = t.id and ar.status = 'sold')
        ) order by t.sort_order)
        from public.auction_purses p join public.teams t on t.id = p.team_id
        join s on s.id = p.session_id), '[]'::jsonb),
      'bids', coalesce((select jsonb_agg(jsonb_build_object(
          'team_code', t.code, 'amount', b.amount, 'player_name', r.name, 'created_at', b.created_at
        ) order by b.created_at desc)
        from public.auction_bids b
        join public.teams t on t.id = b.team_id
        join public.registrations r on r.id = b.player_id
        join s on s.id = b.session_id), '[]'::jsonb),
      'results', coalesce((select jsonb_agg(jsonb_build_object(
          'player_name', r.name, 'photo_url', r.photo_url, 'player_type', r.player_type,
          'team_code', t.code, 'sold_price', ar.sold_price, 'status', ar.status, 'lot_order', ar.lot_order
        ) order by ar.lot_order)
        from public.auction_results ar
        join public.registrations r on r.id = ar.player_id
        left join public.teams t on t.id = ar.sold_to_team_id
        join s on s.id = ar.session_id
        where ar.status in ('sold', 'unsold')), '[]'::jsonb)
    )
  );
end;
$$;

revoke all on function public.admin_auction_state() from public;
grant execute on function public.admin_auction_state() to authenticated;

-- Start session now accepts a default lot timer (seconds).
drop function if exists public.admin_auction_start_session(text, integer, integer, integer);
create or replace function public.admin_auction_start_session(p_name text, p_purse integer, p_increment integer, p_timer integer)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_session uuid;
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  update public.auction_sessions set status = 'ended', ended_at = now(), updated_at = now() where status = 'live';
  insert into public.auction_sessions (name, status, purse_budget, increment, lot_timer_seconds, started_at)
  values (coalesce(nullif(p_name, ''), 'DPL 2026 AUCTION'), 'live', greatest(coalesce(p_purse, 5000000), 0), greatest(coalesce(p_increment, 100000), 0), greatest(coalesce(p_timer, 60), 10), now())
  returning id into v_session;
  insert into public.auction_purses (session_id, team_id, budget)
  select v_session, t.id, greatest(coalesce(p_purse, 5000000), 0)
  from public.teams t;
  insert into public.auction_results (session_id, player_id, lot_order)
  select v_session, r.id, row_number() over (order by r.created_at)
  from public.registrations r
  where not exists (select 1 from public.team_players tp where tp.player_id = r.id);
  return v_session;
end;
$$;

revoke all on function public.admin_auction_start_session(text, integer, integer, integer) from public;
grant execute on function public.admin_auction_start_session(text, integer, integer, integer) to authenticated;

-- Edit session: add timer. Signature: (session, name, purse, increment, timer, status).
drop function if exists public.admin_auction_update_session(uuid, text, integer, integer, integer, text);
create or replace function public.admin_auction_update_session(v_session uuid, p_name text, p_purse integer, p_increment integer, p_timer integer, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
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
end;
$$;

revoke all on function public.admin_auction_update_session(uuid, text, integer, integer, integer, text) from public;
grant execute on function public.admin_auction_update_session(uuid, text, integer, integer, integer, text) to authenticated;

-- Open a lot: starts the session timer. Previous on-auction lot resolves to
-- unsold if its timer already expired, otherwise back to pool.
drop function if exists public.admin_auction_open(uuid);
create or replace function public.admin_auction_open(v_player uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_session uuid; v_timer integer;
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  select id into v_session from public.auction_sessions where status = 'live' order by created_at desc limit 1;
  if v_session is null then raise exception 'no live auction session'; end if;
  select lot_timer_seconds into v_timer from public.auction_sessions where id = v_session;
  delete from public.auction_bids b
    using public.auction_results ar
    where ar.session_id = v_session
      and ar.status = 'on_auction'
      and b.session_id = v_session
      and b.player_id = ar.player_id;
  update public.auction_results ar
  set status = case
        when ar.opens_at is not null and ar.opens_at + make_interval(secs => v_timer) < now() then 'unsold'
        else 'pool'
      end,
      opens_at = null, updated_at = now()
  from public.auction_sessions s
  where ar.session_id = v_session
    and ar.status = 'on_auction'
    and s.id = v_session;
  update public.auction_results set status = 'on_auction', opens_at = now(), updated_at = now()
    where session_id = v_session and player_id = v_player;
end;
$$;

revoke all on function public.admin_auction_open(uuid) from public;
grant execute on function public.admin_auction_open(uuid) to authenticated;

-- Extend the current lot's timer by N seconds.
drop function if exists public.admin_auction_extend(uuid, integer);
create or replace function public.admin_auction_extend(v_player uuid, p_seconds integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  update public.auction_results ar
  set opens_at = opens_at + make_interval(secs => greatest(coalesce(p_seconds, 15), 1)), updated_at = now()
  from public.auction_sessions s
  where ar.session_id = s.id
    and s.status = 'live'
    and ar.player_id = v_player
    and ar.status = 'on_auction'
    and ar.opens_at is not null;
end;
$$;

revoke all on function public.admin_auction_extend(uuid, integer) from public;
grant execute on function public.admin_auction_extend(uuid, integer) to authenticated;

-- End / sell / unsold / undo now clear the lot timer.
drop function if exists public.admin_auction_end_session(uuid);
create or replace function public.admin_auction_end_session(v_session uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  update public.auction_sessions set status = 'ended', ended_at = now(), updated_at = now() where id = v_session;
  update public.auction_results set status = 'pool', opens_at = null, updated_at = now()
    where session_id = v_session and status = 'on_auction';
end;
$$;

revoke all on function public.admin_auction_end_session(uuid) from public;
grant execute on function public.admin_auction_end_session(uuid) to authenticated;

drop function if exists public.admin_auction_sell(uuid, uuid, integer);
create or replace function public.admin_auction_sell(v_player uuid, v_team uuid, p_price integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_session uuid; v_base integer; v_budget integer; v_spent integer; v_squad integer;
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  select id into v_session from public.auction_sessions where status = 'live' order by created_at desc limit 1;
  if v_session is null then raise exception 'no live auction session'; end if;
  select base_price into v_base from public.auction_results
    where session_id = v_session and player_id = v_player and status = 'on_auction';
  if v_base is null then raise exception 'player is not on auction'; end if;
  if p_price < v_base then raise exception 'price is below the base price'; end if;
  select budget into v_budget from public.auction_purses where session_id = v_session and team_id = v_team;
  if v_budget is null then raise exception 'team is not part of this session'; end if;
  select coalesce(sum(sold_price), 0) into v_spent from public.auction_results
    where session_id = v_session and sold_to_team_id = v_team and status = 'sold';
  if p_price > v_budget - v_spent then raise exception 'team budget exceeded'; end if;
  select count(*) into v_squad from public.team_players where team_id = v_team;
  if v_squad >= 11 then raise exception 'squad is full (11 players)'; end if;
  insert into public.team_players (team_id, player_id, role)
  values (v_team, v_player, 'player')
  on conflict (team_id, player_id) do update set role = 'player';
  update public.auction_results set
    status = 'sold', sold_to_team_id = v_team, sold_price = p_price, opens_at = null, updated_at = now()
  where session_id = v_session and player_id = v_player;
end;
$$;

revoke all on function public.admin_auction_sell(uuid, uuid, integer) from public;
grant execute on function public.admin_auction_sell(uuid, uuid, integer) to authenticated;

drop function if exists public.admin_auction_unsold(uuid);
create or replace function public.admin_auction_unsold(v_player uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  update public.auction_results set status = 'unsold', opens_at = null, updated_at = now()
  where player_id = v_player
    and session_id = (select id from public.auction_sessions where status = 'live' order by created_at desc limit 1);
end;
$$;

revoke all on function public.admin_auction_unsold(uuid) from public;
grant execute on function public.admin_auction_unsold(uuid) to authenticated;

drop function if exists public.admin_auction_undo(uuid);
create or replace function public.admin_auction_undo(v_player uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_session uuid;
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  select id into v_session from public.auction_sessions where status = 'live' order by created_at desc limit 1;
  delete from public.team_players where player_id = v_player;
  delete from public.auction_bids where player_id = v_player and session_id = v_session;
  update public.auction_results set
    status = 'pool', sold_to_team_id = null, sold_price = null, opens_at = null, updated_at = now()
  where player_id = v_player and session_id = v_session;
end;
$$;

revoke all on function public.admin_auction_undo(uuid) from public;
grant execute on function public.admin_auction_undo(uuid) to authenticated;
