-- Include updated_at in the admin players payload so the queue can sort the
-- SOLD tab by recency (most recently sold first).
create or replace function public.admin_auction_state()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
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
          'source', ar.source, 'opens_at', ar.opens_at, 'updated_at', ar.updated_at
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
$function$;
