-- DPL 2026: fielders (+ optional fielding location), player of the match,
-- partnerships, and richer leaderboard aggregates.

-- ---------- columns ----------
alter table public.match_balls
  add column if not exists fielder_id uuid,
  add column if not exists fielding_note text,
  add column if not exists non_striker_id uuid;

alter table public.fixtures
  add column if not exists player_of_match uuid;

-- ---------- ball add: fielder + note + non-striker ----------
drop function if exists public.admin_ball_add(integer, integer, integer, text, boolean, text, uuid);
create or replace function public.admin_ball_add(
  p_match_number integer, p_innings integer, p_bat_runs integer, p_extra text,
  p_is_wicket boolean, p_wicket_type text, p_bowler_id uuid,
  p_fielder_id uuid default null, p_fielding_note text default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_seq integer; v_fh boolean; v_striker uuid; v_non uuid;
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  if p_bowler_id is null then raise exception 'select a bowler before the next delivery'; end if;
  select free_hit, striker_id, non_striker_id into v_fh, v_striker, v_non
    from public.match_innings where match_number = p_match_number and innings = p_innings and not closed;
  if not found then raise exception 'innings % is not open', p_innings; end if;
  if v_fh and coalesce(p_is_wicket, false) and coalesce(p_wicket_type, 'run_out') <> 'run_out' then
    raise exception 'on a free hit only a run-out is allowed';
  end if;
  select coalesce(max(ball_seq), 0) + 1 into v_seq from public.match_balls where match_number = p_match_number and innings = p_innings;
  insert into public.match_balls (match_number, innings, ball_seq, batter_id, non_striker_id, bowler_id, bat_runs, extra, is_wicket, wicket_type, free_hit, fielder_id, fielding_note)
  values (p_match_number, p_innings, v_seq, v_striker, v_non, p_bowler_id, coalesce(p_bat_runs, 0), p_extra,
          coalesce(p_is_wicket, false), case when coalesce(p_is_wicket, false) then p_wicket_type else null end, v_fh,
          case when coalesce(p_is_wicket, false) and coalesce(p_wicket_type,'') in ('caught','run_out','stumped') then p_fielder_id else null end,
          nullif(p_fielding_note, ''));
  perform public.recompute_innings(p_match_number, p_innings);
end $$;

-- ---------- admin_fixture_update: player_of_match ----------
create or replace function public.admin_fixture_update(p_match_number integer, p_patch jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_locked boolean; v_home text; v_away text; v_new_home text; v_new_away text;
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  select locked, home_code, away_code into v_locked, v_home, v_away from public.fixtures where match_number = p_match_number;
  if v_locked is null then raise exception 'match % not found', p_match_number; end if;
  if v_locked and exists (select 1 from jsonb_object_keys(p_patch) k where k not in ('locked', 'published')) then
    raise exception 'match % is locked — unlock it before editing', p_match_number;
  end if;
  if p_patch ? 'home_code' or p_patch ? 'away_code' then
    v_new_home := upper(coalesce(nullif(p_patch->>'home_code', ''), v_home));
    v_new_away := upper(coalesce(nullif(p_patch->>'away_code', ''), v_away));
    if v_new_home = v_new_away then raise exception 'home and away teams must differ'; end if;
  end if;
  perform set_config('dpl.fixture_action', 'update', true);
  update public.fixtures set
    match_date  = case when p_patch ? 'match_date'  then (p_patch->>'match_date')::date else match_date end,
    match_time  = case when p_patch ? 'match_time'  then (p_patch->>'match_time')::time else match_time end,
    venue       = case when p_patch ? 'venue'       then p_patch->>'venue' else venue end,
    status      = case when p_patch ? 'status'      then p_patch->>'status' else status end,
    home_code   = case when p_patch ? 'home_code'   then v_new_home else home_code end,
    away_code   = case when p_patch ? 'away_code'   then v_new_away else away_code end,
    home_score  = case when p_patch ? 'home_score'  then nullif(p_patch->>'home_score', '')::integer else home_score end,
    away_score  = case when p_patch ? 'away_score'  then nullif(p_patch->>'away_score', '')::integer else away_score end,
    home_overs  = case when p_patch ? 'home_overs'  then nullif(p_patch->>'home_overs', '')::numeric else home_overs end,
    away_overs  = case when p_patch ? 'away_overs'  then nullif(p_patch->>'away_overs', '')::numeric else away_overs end,
    result_type = case when p_patch ? 'result_type' then p_patch->>'result_type' else result_type end,
    winner_code = case when p_patch ? 'winner_code' then nullif(p_patch->>'winner_code', '') else winner_code end,
    points_home = case when p_patch ? 'points_home' then nullif(p_patch->>'points_home', '')::integer else points_home end,
    points_away = case when p_patch ? 'points_away' then nullif(p_patch->>'points_away', '')::integer else points_away end,
    note        = case when p_patch ? 'note'        then p_patch->>'note' else note end,
    published   = case when p_patch ? 'published'   then (p_patch->>'published')::boolean else published end,
    locked      = case when p_patch ? 'locked'      then (p_patch->>'locked')::boolean else locked end,
    pinned      = case when p_patch ? 'pinned'      then (p_patch->>'pinned')::boolean else pinned end,
    player_of_match = case when p_patch ? 'player_of_match' then nullif(p_patch->>'player_of_match', '')::uuid else player_of_match end,
    updated_at  = now()
  where match_number = p_match_number;

  if not (p_patch ? 'winner_code')
     and (p_patch ? 'status' or p_patch ? 'home_score' or p_patch ? 'away_score' or p_patch ? 'result_type') then
    update public.fixtures f set
      winner_code = case
        when f.status <> 'completed' then null
        when f.result_type <> 'normal' then null
        when f.home_score is null or f.away_score is null then null
        when f.home_score > f.away_score then f.home_code
        when f.away_score > f.home_score then f.away_code
        else null end
    where f.match_number = p_match_number;
  end if;
  perform public.advance_knockout();
end $$;

-- ---------- leaderboard: fielding + dots ----------
create or replace function public.leaderboard()
returns jsonb language sql stable security definer set search_path = public as $$
  with bat_inn as (
    select b.batter_id, b.match_number, b.innings,
      sum(case when b.extra is null or b.extra = 'no_ball' then b.bat_runs else 0 end) as runs,
      count(*) filter (where b.extra is null or b.extra in ('bye','leg_bye')) as balls,
      count(*) filter (where b.bat_runs = 4 and (b.extra is null or b.extra = 'no_ball')) as fours,
      count(*) filter (where b.bat_runs = 6 and (b.extra is null or b.extra = 'no_ball')) as sixes
    from public.match_balls b where b.batter_id is not null
    group by b.batter_id, b.match_number, b.innings
  ),
  bat as (
    select bi.batter_id as id, r.name, t.code as team,
      count(*)::int as innings, sum(bi.runs)::int as runs, sum(bi.balls)::int as balls,
      sum(bi.fours)::int as fours, sum(bi.sixes)::int as sixes, max(bi.runs)::int as hs,
      round(sum(bi.runs)::numeric / nullif(sum(bi.balls), 0) * 100, 1) as sr
    from bat_inn bi
    join public.registrations r on r.id = bi.batter_id
    left join public.team_players tp on tp.player_id = bi.batter_id
    left join public.teams t on t.id = tp.team_id
    group by bi.batter_id, r.name, t.code
  ),
  bowl as (
    select b.bowler_id as id, r.name, t.code as team,
      count(distinct (b.match_number, b.innings))::int as innings,
      count(*) filter (where b.extra is null or b.extra in ('bye','leg_bye'))::int as balls,
      (coalesce(sum(case when b.extra is null or b.extra = 'no_ball' then b.bat_runs else 0 end),0)
        + coalesce(sum(case when b.extra in ('wide','no_ball') then 1 else 0 end),0))::int as runs,
      count(*) filter (where b.is_wicket)::int as wickets,
      count(*) filter (where b.extra is null and b.bat_runs = 0 and not b.is_wicket)::int as dots,
      round((coalesce(sum(case when b.extra is null or b.extra = 'no_ball' then b.bat_runs else 0 end),0)
        + coalesce(sum(case when b.extra in ('wide','no_ball') then 1 else 0 end),0))
        ::numeric / nullif(count(*) filter (where b.extra is null or b.extra in ('bye','leg_bye')), 0) * 6, 2) as economy
    from public.match_balls b
    join public.registrations r on r.id = b.bowler_id
    left join public.team_players tp on tp.player_id = b.bowler_id
    left join public.teams t on t.id = tp.team_id
    where b.bowler_id is not null
    group by b.bowler_id, r.name, t.code
  ),
  field as (
    select b.fielder_id as id, r.name, t.code as team,
      count(*) filter (where b.wicket_type = 'caught')::int as catches,
      count(*) filter (where b.wicket_type = 'run_out')::int as run_outs,
      count(*) filter (where b.wicket_type = 'stumped')::int as stumpings,
      count(*)::int as total
    from public.match_balls b
    join public.registrations r on r.id = b.fielder_id
    left join public.team_players tp on tp.player_id = b.fielder_id
    left join public.teams t on t.id = tp.team_id
    where b.fielder_id is not null
    group by b.fielder_id, r.name, t.code
  ),
  team_inn as (
    select i.batting_code as code, i.match_number, i.innings,
      (select coalesce(sum(b.bat_runs),0) + coalesce(sum(case when b.extra in ('wide','no_ball') then 1 else 0 end),0)
         from public.match_balls b where b.match_number = i.match_number and b.innings = i.innings) as runs
    from public.match_innings i
  ),
  teams as (
    select ti.code, t.name,
      count(*)::int as innings, sum(ti.runs)::int as total_runs, max(ti.runs)::int as highest
    from team_inn ti left join public.teams t on t.code = ti.code
    group by ti.code, t.name
  )
  select jsonb_build_object(
    'batting', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'name', name, 'team', team, 'innings', innings, 'runs', runs, 'balls', balls,
        'sr', sr, 'fours', fours, 'sixes', sixes, 'hs', hs)
        order by runs desc, sr desc) from bat), '[]'::jsonb),
    'bowling', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'name', name, 'team', team, 'innings', innings, 'balls', balls, 'runs', runs, 'wickets', wickets,
        'dots', dots, 'economy', economy)
        order by wickets desc, economy asc) from bowl), '[]'::jsonb),
    'fielding', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'name', name, 'team', team, 'catches', catches, 'run_outs', run_outs, 'stumpings', stumpings, 'total', total)
        order by total desc, catches desc) from field), '[]'::jsonb),
    'teams', coalesce((select jsonb_agg(jsonb_build_object(
        'code', code, 'name', name, 'innings', innings, 'total_runs', total_runs, 'highest', highest)
        order by highest desc) from teams), '[]'::jsonb)
  );
$$;

-- ---------- scorecard: partnerships ----------
create or replace function public.match_scorecard(p_match_number integer)
returns jsonb language sql stable security definer set search_path = public as $$
  with inn as (
    select i.innings, i.batting_code, i.bowling_code, i.closed,
      (select count(*) filter (where b.extra is null or b.extra in ('bye','leg_bye')) from public.match_balls b where b.match_number = i.match_number and b.innings = i.innings) as balls,
      (select coalesce(sum(b.bat_runs),0) + coalesce(sum(case when b.extra in ('wide','no_ball') then 1 else 0 end),0) from public.match_balls b where b.match_number = i.match_number and b.innings = i.innings) as runs,
      (select count(*) filter (where b.is_wicket) from public.match_balls b where b.match_number = i.match_number and b.innings = i.innings) as wickets
    from public.match_innings i where i.match_number = p_match_number
  ),
  bat as (
    select b.innings, b.batter_id, r.name,
      sum(case when b.extra is null or b.extra = 'no_ball' then b.bat_runs else 0 end) as runs,
      count(*) filter (where b.extra is null or b.extra in ('bye','leg_bye')) as balls,
      bool_or(b.is_wicket) as out
    from public.match_balls b left join public.registrations r on r.id = b.batter_id
    where b.match_number = p_match_number and b.batter_id is not null
    group by b.innings, b.batter_id, r.name
  ),
  bowl as (
    select b.innings, b.bowler_id, r.name,
      count(*) filter (where b.extra is null or b.extra in ('bye','leg_bye')) as balls,
      coalesce(sum(case when b.extra is null or b.extra = 'no_ball' then b.bat_runs else 0 end),0)
        + coalesce(sum(case when b.extra in ('wide','no_ball') then 1 else 0 end),0) as runs,
      count(*) filter (where b.is_wicket) as wickets
    from public.match_balls b left join public.registrations r on r.id = b.bowler_id
    where b.match_number = p_match_number and b.bowler_id is not null
    group by b.innings, b.bowler_id, r.name
  ),
  cmt as (
    select b.innings, b.ball_seq, b.bat_runs, b.extra, b.is_wicket, b.wicket_type, b.free_hit, rb.name as batter
    from public.match_balls b left join public.registrations rb on rb.id = b.batter_id
    where b.match_number = p_match_number order by b.innings, b.ball_seq
  ),
  part_src as (
    select b.innings, b.ball_seq, b.batter_id, b.non_striker_id, b.bat_runs, b.extra,
      sum(case when b.is_wicket then 1 else 0 end) over (partition by b.innings order by b.ball_seq rows between unbounded preceding and current row) as wk
    from public.match_balls b where b.match_number = p_match_number
  ),
  part as (
    select p.innings, p.wk,
      (array_agg(p.batter_id order by p.ball_seq))[1] as b1,
      (array_agg(p.non_striker_id order by p.ball_seq))[1] as b2,
      sum(case when p.extra is null or p.extra = 'no_ball' then p.bat_runs else 0 end)
        + sum(case when p.extra in ('wide','no_ball') then 1 else 0 end) as runs
    from part_src p group by p.innings, p.wk
  )
  select jsonb_build_object(
    'innings', coalesce((select jsonb_agg(jsonb_build_object(
        'innings', innings, 'batting_code', batting_code, 'bowling_code', bowling_code, 'closed', closed,
        'runs', runs, 'wickets', wickets, 'balls', balls,
        'overs', floor(balls / 6.0) + (balls % 6) / 10.0) order by innings) from inn), '[]'::jsonb),
    'batting', coalesce((select jsonb_agg(jsonb_build_object('innings', innings, 'id', batter_id, 'name', coalesce(name,'Player'), 'runs', runs, 'balls', balls, 'out', out) order by innings, runs desc) from bat), '[]'::jsonb),
    'bowling', coalesce((select jsonb_agg(jsonb_build_object('innings', innings, 'id', bowler_id, 'name', coalesce(name,'Player'), 'balls', balls, 'runs', runs, 'wickets', wickets) order by innings, wickets desc, runs asc) from bowl), '[]'::jsonb),
    'commentary', coalesce((select jsonb_agg(jsonb_build_object(
        'innings', innings, 'seq', ball_seq, 'runs', bat_runs, 'extra', extra,
        'is_wicket', is_wicket, 'wicket_type', wicket_type, 'free_hit', free_hit, 'batter', batter)
        order by innings, ball_seq) from cmt), '[]'::jsonb),
    'partnerships', coalesce((select jsonb_agg(jsonb_build_object(
        'innings', p.innings, 'b1', rb1.name, 'b2', rb2.name, 'runs', p.runs)
        order by p.innings, p.wk) from part p
        left join public.registrations rb1 on rb1.id = p.b1
        left join public.registrations rb2 on rb2.id = p.b2), '[]'::jsonb)
  );
$$;
