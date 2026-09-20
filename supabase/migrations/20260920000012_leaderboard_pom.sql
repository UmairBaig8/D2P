-- Leaderboard: Player-of-the-Match awards count (explicit override or auto).

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
  bowl_inn as (
    select b.bowler_id, b.match_number, b.innings,
      count(*) filter (where b.extra is null or b.extra in ('bye','leg_bye')) as balls,
      count(*) filter (where b.is_wicket) as wickets,
      coalesce(sum(case when b.extra is null or b.extra = 'no_ball' then b.bat_runs else 0 end),0)
        + coalesce(sum(case when b.extra in ('wide','no_ball') then 1 else 0 end),0) as runs
    from public.match_balls b where b.bowler_id is not null
    group by b.bowler_id, b.match_number, b.innings
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
        ::numeric / nullif(count(*) filter (where b.extra is null or b.extra in ('bye','leg_bye')), 0) * 6, 2) as economy,
      (select (bi.wickets || '/' || bi.runs) from bowl_inn bi where bi.bowler_id = b.bowler_id order by bi.wickets desc, bi.runs asc limit 1) as best
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
      count(*) filter (where b.wicket_type = 'stumped')::int as stumps,
      count(*)::int as total
    from public.match_balls b
    join public.registrations r on r.id = b.fielder_id
    left join public.team_players tp on tp.player_id = b.fielder_id
    left join public.teams t on t.id = tp.team_id
    where b.fielder_id is not null
    group by b.fielder_id, r.name, t.code
  ),
  pom_src as (
    select coalesce(f.player_of_match, (
      select agg.id from (
        select x.id, sum(x.p) as pts from (
          select b.batter_id as id, sum(case when b.extra is null or b.extra = 'no_ball' then b.bat_runs else 0 end) as p
            from public.match_balls b where b.match_number = f.match_number and b.batter_id is not null group by b.batter_id
          union all
          select b.bowler_id, sum(case when b.is_wicket then 20 else 0 end)
            from public.match_balls b where b.match_number = f.match_number and b.bowler_id is not null group by b.bowler_id
          union all
          select b.fielder_id, count(*) * 8
            from public.match_balls b where b.match_number = f.match_number and b.fielder_id is not null group by b.fielder_id
        ) x group by x.id
      ) agg order by agg.pts desc limit 1
    )) as id
    from public.fixtures f
    where f.status = 'completed' and exists (select 1 from public.match_balls b where b.match_number = f.match_number)
  ),
  pom as (
    select p.id, r.name, t.code as team, count(*)::int as awards
    from pom_src p
    join public.registrations r on r.id = p.id
    left join public.team_players tp on tp.player_id = p.id
    left join public.teams t on t.id = tp.team_id
    where p.id is not null
    group by p.id, r.name, t.code
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
        'dots', dots, 'economy', economy, 'best', best)
        order by wickets desc, economy asc) from bowl), '[]'::jsonb),
    'fielding', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'name', name, 'team', team, 'catches', catches, 'run_outs', run_outs, 'stumpings', stumps, 'total', total)
        order by total desc, catches desc) from field), '[]'::jsonb),
    'pom', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'name', name, 'team', team, 'awards', awards)
        order by awards desc, name) from pom), '[]'::jsonb),
    'teams', coalesce((select jsonb_agg(jsonb_build_object(
        'code', code, 'name', name, 'innings', innings, 'total_runs', total_runs, 'highest', highest)
        order by highest desc) from teams), '[]'::jsonb)
  );
$$;
