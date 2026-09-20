-- DPL 2026: live detail, auto leaderboard, match-timing insight, and the
-- admin visibility toggles for the last two.

-- ---------- visibility settings ----------
alter table public.settings
  add column if not exists leaderboard_public   boolean not null default true,
  add column if not exists match_timing_public  boolean not null default true;

-- ---------- live detail (hero + Live Centre) ----------
create or replace function public.live_detail(p_match_number integer)
returns jsonb language sql stable security definer set search_path = public as $$
  with f as (select * from public.fixtures where match_number = p_match_number),
  cfg as (select coalesce(overs_per_innings, 5) opi from public.settings where id = 1),
  cfg1 as (select * from cfg union all select 5 limit 1),
  inn as (
    select i.innings, i.batting_code, i.bowling_code, i.closed,
      (select count(*) filter (where b.extra is null or b.extra in ('bye','leg_bye')) from public.match_balls b where b.match_number = i.match_number and b.innings = i.innings) as balls,
      (select coalesce(sum(b.bat_runs),0) + coalesce(sum(case when b.extra in ('wide','no_ball') then 1 else 0 end),0) from public.match_balls b where b.match_number = i.match_number and b.innings = i.innings) as runs,
      (select count(*) filter (where b.is_wicket) from public.match_balls b where b.match_number = i.match_number and b.innings = i.innings) as wickets
    from public.match_innings i where i.match_number = p_match_number
  ),
  cur as (
    select mi.innings, mi.batting_code, mi.bowling_code, mi.striker_id, mi.non_striker_id, mi.current_bowler_id, mi.free_hit,
      (select count(*) filter (where b.extra is null or b.extra in ('bye','leg_bye')) from public.match_balls b where b.match_number = mi.match_number and b.innings = mi.innings) as balls,
      (select coalesce(sum(b.bat_runs),0) + coalesce(sum(case when b.extra in ('wide','no_ball') then 1 else 0 end),0) from public.match_balls b where b.match_number = mi.match_number and b.innings = mi.innings) as runs
    from public.match_innings mi where mi.match_number = p_match_number and not mi.closed order by mi.innings limit 1
  ),
  recent as (
    select b.ball_seq, b.bat_runs, b.extra, b.is_wicket, b.wicket_type, b.free_hit, rb.name as batter
    from public.match_balls b left join public.registrations rb on rb.id = b.batter_id
    where b.match_number = p_match_number and b.innings = (select innings from cur)
    order by b.ball_seq desc limit 6
  )
  select jsonb_build_object(
    'home_code', (select home_code from f),
    'away_code', (select away_code from f),
    'status', (select status from f),
    'innings', coalesce((select jsonb_agg(jsonb_build_object(
        'innings', innings, 'batting_code', batting_code, 'runs', runs, 'wickets', wickets, 'balls', balls,
        'overs', floor(balls / 6.0) + (balls % 6) / 10.0, 'closed', closed) order by innings) from inn), '[]'::jsonb),
    'current', case when (select innings from cur) is null then null else jsonb_build_object(
        'innings', (select innings from cur),
        'batting_code', (select batting_code from cur),
        'bowling_code', (select bowling_code from cur),
        'runs', (select runs from cur),
        'balls', (select balls from cur),
        'free_hit', (select free_hit from cur),
        'striker', (select r.name from public.registrations r where r.id = (select striker_id from cur)),
        'non_striker', (select r.name from public.registrations r where r.id = (select non_striker_id from cur)),
        'bowler', (select r.name from public.registrations r where r.id = (select current_bowler_id from cur)),
        'run_rate', round(((select runs from cur)::numeric / nullif((select balls from cur), 0) * 6), 2),
        'target', case when (select innings from cur) = 2 then
            coalesce((select runs from inn where innings = 1), 0) + 1 else null end,
        'required', case when (select innings from cur) = 2 then
            (coalesce((select runs from inn where innings = 1), 0) + 1) - (select runs from cur) else null end,
        'balls_left', greatest(0, ((select opi from cfg1) * 6) - (select balls from cur))
      ) end,
    'recent', coalesce((select jsonb_agg(jsonb_build_object(
        'seq', ball_seq, 'runs', bat_runs, 'extra', extra, 'is_wicket', is_wicket,
        'wicket_type', wicket_type, 'free_hit', free_hit, 'batter', batter) order by ball_seq desc) from recent), '[]'::jsonb)
  );
$$;

-- ---------- auto leaderboard ----------
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
        'economy', economy)
        order by wickets desc, economy asc) from bowl), '[]'::jsonb),
    'teams', coalesce((select jsonb_agg(jsonb_build_object(
        'code', code, 'name', name, 'innings', innings, 'total_runs', total_runs, 'highest', highest)
        order by highest desc) from teams), '[]'::jsonb)
  );
$$;

-- ---------- match timing (duration vs the next slot) ----------
create or replace function public.fixtures_timing()
returns table (match_number integer, started_at timestamptz, ended_at timestamptz, minutes numeric, allotted_minutes numeric, within_slot boolean)
language sql stable security definer set search_path = public as $$
  with allowed as (
    select coalesce((select match_timing_public from public.settings where id = 1), true) as pub
  ),
  m as (
    select f.match_number, f.match_date, f.match_time,
      min(b.created_at) as started_at, max(b.created_at) as ended_at
    from public.fixtures f
    join public.match_balls b on b.match_number = f.match_number
    group by f.match_number, f.match_date, f.match_time
  ),
  s as (
    select m.*,
      round(extract(epoch from (m.ended_at - m.started_at)) / 60.0, 1) as minutes,
      coalesce((
        select round(extract(epoch from (n.match_time - m.match_time)) / 60.0, 1)
        from public.fixtures n
        where n.match_date = m.match_date and n.match_time > m.match_time
        order by n.match_time limit 1
      ), 30) as allotted_minutes
    from m
  )
  select s.match_number, s.started_at, s.ended_at, s.minutes, s.allotted_minutes,
         (s.minutes <= s.allotted_minutes) as within_slot
  from s
  where (select pub from allowed) or public.is_admin()
  order by s.match_number;
$$;
