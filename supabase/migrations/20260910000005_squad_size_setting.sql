-- Single source of truth for squad size (max players per team).
-- Default 15. Enforced by the auction sell path and surfaced to the UI.

alter table public.settings
  add column if not exists squad_size integer not null default 15;

-- Enforce the configured squad size when selling a player.
create or replace function public.admin_auction_sell(v_player uuid, v_team uuid, p_price integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_session uuid; v_base integer; v_budget integer; v_spent integer; v_squad integer; v_squad_size integer;
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
  select coalesce(squad_size, 15) into v_squad_size from public.settings where id = 1;
  select count(*) into v_squad from public.team_players where team_id = v_team;
  if v_squad >= v_squad_size then raise exception 'squad is full (% players)', v_squad_size; end if;
  insert into public.team_players (team_id, player_id, role)
  values (v_team, v_player, 'player')
  on conflict (team_id, player_id) do update set role = 'player';
  update public.auction_results set
    status = 'sold', sold_to_team_id = v_team, sold_price = p_price, opens_at = null, updated_at = now()
  where session_id = v_session and player_id = v_player;
end;
$$;

-- Surface squad_size to the public live board.
create or replace function public.auction_live_state()
returns jsonb
language plpgsql
security definer
set search_path = public
volatile
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
    ),
    team_agg as (
      select ar.sold_to_team_id,
             count(*) filter (where ar.status = 'sold') as sold,
             coalesce(sum(ar.sold_price) filter (where ar.status = 'sold'), 0) as spent
      from public.auction_results ar
      join s on s.id = ar.session_id
      group by ar.sold_to_team_id
    ),
    squad_agg as (
      select team_id, count(*) as squad
      from public.team_players
      group by team_id
    )
    select jsonb_build_object(
      'session', (select to_jsonb(s) from s),
      'squad_size', (select coalesce(squad_size, 15) from public.settings where id = 1),
      'current_player', case when exists (select 1 from cur) then (
        select jsonb_build_object(
          'player_id', r.id, 'name', r.name, 'employee_id', r.employee_id, 'photo_url', r.photo_url,
          'player_type', r.player_type, 'gender', r.gender, 'location', r.location,
          'dpl_played', r.dpl_played, 'self_rating', r.self_rating, 'availability', r.availability,
          'batting_style', r.batting_style, 'bowling_style', r.bowling_style, 'bowling_arm', r.bowling_arm,
          'lot_order', cur.lot_order, 'base_price', cur.base_price,
          'timer_ends_at', to_char(cur.opens_at + make_interval(secs => s.lot_timer_seconds), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        )
        from cur join public.registrations r on r.id = cur.player_id join s on true
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
          'spent', coalesce(ta.spent, 0),
          'squad', coalesce(sa.squad, 0),
          'sold', coalesce(ta.sold, 0)
        ) order by t.sort_order)
        from public.auction_purses p
        join public.teams t on t.id = p.team_id
        join s on s.id = p.session_id
        left join team_agg ta on ta.sold_to_team_id = t.id
        left join squad_agg sa on sa.team_id = t.id), '[]'::jsonb),
      'pool_count', (select count(*) from public.auction_results ar
                     join s on s.id = ar.session_id where ar.status = 'pool'),
      'next_up', coalesce((select jsonb_agg(jsonb_build_object('player_id', r.id, 'name', r.name, 'photo_url', r.photo_url, 'player_type', r.player_type, 'lot_order', ar.lot_order, 'base_price', case when coalesce(ar.base_price, 0) > 0 then ar.base_price else coalesce((select sd.auction_default_base from public.settings sd where sd.id = 1), 0) end)) from (select ar2.* from public.auction_results ar2 join s on s.id = ar2.session_id where ar2.status = 'pool' order by ar2.lot_order limit 4) ar join public.registrations r on r.id = ar.player_id), '[]'::jsonb),
      'results', coalesce((select jsonb_agg(jsonb_build_object(
          'player_name', r.name, 'photo_url', r.photo_url, 'player_type', r.player_type,
          'team_code', t.code, 'sold_price', ar.sold_price, 'status', ar.status, 'source', ar.source, 'lot_order', ar.lot_order
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

-- Surface squad_size to the admin control room.
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
      'squad_size', (select coalesce(squad_size, 15) from public.settings where id = 1),
      'current_player', case when exists (select 1 from cur) then (
        select jsonb_build_object(
          'player_id', r.id, 'name', r.name, 'employee_id', r.employee_id, 'photo_url', r.photo_url,
          'player_type', r.player_type, 'gender', r.gender, 'location', r.location,
          'dpl_played', r.dpl_played, 'self_rating', r.self_rating, 'availability', r.availability,
          'batting_style', r.batting_style, 'bowling_style', r.bowling_style,
          'lot_order', cur.lot_order, 'base_price', cur.base_price,
          'timer_ends_at', to_char(cur.opens_at + make_interval(secs => s.lot_timer_seconds), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
        )
        from cur join public.registrations r on r.id = cur.player_id join s on true
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
          'source', ar.source, 'opens_at', ar.opens_at
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
          'team_code', t.code, 'sold_price', ar.sold_price, 'status', ar.status, 'source', ar.source, 'lot_order', ar.lot_order
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

-- Surface squad_size on the teams list (Team/Teams pages).
drop function if exists public.teams_list();
create function public.teams_list()
returns table (
  id uuid, name text, code text, icon_url text, theme text,
  owner text, co_owner text, captain text, champion boolean,
  player_count bigint, squad_size integer, sort_order integer
)
language sql
security definer
set search_path = public
as $$
  select
    t.id, t.name, t.code, t.icon_url, t.theme,
    (select r.name from public.team_players tp join public.registrations r on r.id = tp.player_id
     where tp.team_id = t.id and tp.role = 'owner') as owner,
    (select r.name from public.team_players tp join public.registrations r on r.id = tp.player_id
     where tp.team_id = t.id and tp.role = 'co_owner') as co_owner,
    (select r.name from public.team_players tp join public.registrations r on r.id = tp.player_id
     where tp.team_id = t.id and tp.role = 'captain') as captain,
    t.champion,
    (select count(*) from public.team_players tp where tp.team_id = t.id) as player_count,
    (select coalesce(sd.squad_size, 15) from public.settings sd where sd.id = 1) as squad_size,
    t.sort_order
  from public.teams t
  order by t.sort_order;
$$;
grant execute on function public.teams_list() to public;
