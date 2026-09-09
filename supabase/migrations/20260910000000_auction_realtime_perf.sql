-- Realtime + performance: expose auction tables to Supabase Realtime,
-- add supporting indexes, and rewrite auction_live_state() as a single-pass
-- aggregate (no per-team correlated subqueries).

-- 1) Realtime publication
alter publication supabase_realtime add table public.auction_sessions;
alter publication supabase_realtime add table public.auction_results;
alter publication supabase_realtime add table public.auction_bids;
alter publication supabase_realtime add table public.auction_purses;

-- 2) Indexes for the live-state aggregate
create index if not exists auction_results_session_status_idx
  on public.auction_results (session_id, status);
create index if not exists auction_results_session_team_status_idx
  on public.auction_results (session_id, sold_to_team_id, status);
create index if not exists auction_results_session_lot_idx
  on public.auction_results (session_id, lot_order);
create index if not exists auction_bids_session_player_created_idx
  on public.auction_bids (session_id, player_id, created_at desc);

-- 3) Optimized live-state snapshot (output shape unchanged)
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
