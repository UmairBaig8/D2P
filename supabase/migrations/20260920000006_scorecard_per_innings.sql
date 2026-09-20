-- Fix: batting/bowling lines must be scoped per innings (they were aggregated
-- across both innings, so innings 2 re-displayed innings 1's figures).

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
        order by innings, ball_seq) from cmt), '[]'::jsonb)
  );
$$;
