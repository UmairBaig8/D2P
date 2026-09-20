-- DPL 2026: persist the incoming batter (so UNDO after a wicket replays
-- correctly), auto Player-of-the-Match with admin override, and best bowling
-- figures for the leaderboard.

alter table public.match_balls add column if not exists incoming_batter_id uuid;

-- ---------- recompute: apply the incoming batter after a wicket ----------
create or replace function public.recompute_innings(p_match_number integer, p_innings integer)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_inn record; v_striker uuid; v_non uuid; v_bowler uuid; v_tmp uuid; v_fh boolean; v_legal integer; b record;
begin
  select * into v_inn from public.match_innings where match_number = p_match_number and innings = p_innings;
  if v_inn is null then return; end if;
  v_striker := v_inn.opener1_id; v_non := v_inn.opener2_id; v_bowler := null; v_fh := false; v_legal := 0;
  for b in select * from public.match_balls where match_number = p_match_number and innings = p_innings order by ball_seq loop
    v_bowler := b.bowler_id;
    if b.extra is null or b.extra in ('bye','leg_bye') then
      v_legal := v_legal + 1;
      if (b.bat_runs % 2) = 1 then v_tmp := v_striker; v_striker := v_non; v_non := v_tmp; end if;
      if (v_legal % 6) = 0 then v_tmp := v_striker; v_striker := v_non; v_non := v_tmp; v_bowler := null; end if;
      v_fh := false;
    elsif b.extra = 'no_ball' then
      v_fh := true;
    end if;
    if b.is_wicket and b.incoming_batter_id is not null then
      v_striker := b.incoming_batter_id;
    end if;
  end loop;
  update public.match_innings
     set striker_id = v_striker, non_striker_id = v_non, current_bowler_id = v_bowler, free_hit = v_fh, updated_at = now()
   where match_number = p_match_number and innings = p_innings;
end $$;

-- ---------- set the incoming batter (also records it on the last wicket) ----------
create or replace function public.admin_innings_set_batter(p_match_number integer, p_innings integer, p_striker uuid, p_non_striker uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  update public.match_balls set incoming_batter_id = p_striker
   where id = (select id from public.match_balls
               where match_number = p_match_number and innings = p_innings and is_wicket
               order by ball_seq desc limit 1);
  update public.match_innings set striker_id = p_striker, non_striker_id = p_non_striker, updated_at = now()
   where match_number = p_match_number and innings = p_innings;
  if not found then raise exception 'innings not set up'; end if;
  perform public.recompute_innings(p_match_number, p_innings);
end $$;

-- ---------- auto Player of the Match (+ explicit override) ----------
create or replace function public.match_pom(p_match_number integer)
returns jsonb language sql stable security definer set search_path = public as $$
  with bat as (
    select b.batter_id as id, sum(case when b.extra is null or b.extra = 'no_ball' then b.bat_runs else 0 end) as p
    from public.match_balls b where b.match_number = p_match_number and b.batter_id is not null group by b.batter_id
  ),
  bowl as (
    select b.bowler_id as id, sum(case when b.is_wicket then 20 else 0 end) as p
    from public.match_balls b where b.match_number = p_match_number and b.bowler_id is not null group by b.bowler_id
  ),
  field as (
    select b.fielder_id as id, count(*) * 8 as p
    from public.match_balls b where b.match_number = p_match_number and b.fielder_id is not null group by b.fielder_id
  ),
  allp as (
    select id, sum(p) as pts from (select * from bat union all select * from bowl union all select * from field) x
    group by id
  ),
  top as (
    select a.id, r.name, a.pts from allp a join public.registrations r on r.id = a.id
    order by a.pts desc, r.name limit 1
  ),
  chosen as (
    select f.player_of_match as id, r.name
    from public.fixtures f left join public.registrations r on r.id = f.player_of_match
    where f.match_number = p_match_number
  )
  select jsonb_build_object(
    'auto_id', (select id from top),
    'auto_name', (select name from top),
    'auto_points', (select pts from top),
    'chosen_id', coalesce((select id from chosen), (select id from top)),
    'chosen_name', coalesce((select name from chosen), (select name from top)),
    'is_auto', (select id from chosen) is null
  );
$$;

-- ---------- POM per match for the fixtures list ----------
create or replace function public.fixture_pom()
returns table(match_number integer, name text)
language sql stable security definer set search_path = public as $$
  select f.match_number,
         coalesce(explicit.name, auto.name)
  from public.fixtures f
  left join public.registrations explicit on explicit.id = f.player_of_match
  left join lateral (
    select r.name
    from (
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
    ) agg join public.registrations r on r.id = agg.id
    order by agg.pts desc, r.name limit 1
  ) auto on true
  where f.status = 'completed' and (explicit.name is not null or auto.name is not null);
$$;

-- ---------- leaderboard: best bowling figures ----------
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
    'teams', coalesce((select jsonb_agg(jsonb_build_object(
        'code', code, 'name', name, 'innings', innings, 'total_runs', total_runs, 'highest', highest)
        order by highest desc) from teams), '[]'::jsonb)
  );
$$;
