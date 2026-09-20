-- DPL 2026: manual knockout override (pinned teams), plus scorer depth —
-- dismissal types, free-hit tracking, strike rotation, and per-ball commentary.
--
-- Pinned teams: advance_knockout() will not overwrite home_code/away_code for a
-- fixture where pinned = true (so an admin can hand-pick SF/Final matchups).
-- Locked fixtures are also skipped. Recovery from a lock: UNLOCK, or
-- HISTORY -> RESTORE (restore intentionally ignores the lock).

-- ---------- pinned ----------
alter table public.fixtures add column if not exists pinned boolean not null default false;

-- ---------- scorer state ----------
alter table public.match_innings
  add column if not exists opener1_id uuid,
  add column if not exists opener2_id uuid,
  add column if not exists striker_id uuid,
  add column if not exists non_striker_id uuid,
  add column if not exists current_bowler_id uuid,
  add column if not exists free_hit boolean not null default false;

alter table public.match_balls
  add column if not exists wicket_type text,
  add column if not exists free_hit boolean not null default false;
alter table public.match_balls drop constraint if exists match_balls_wicket_type_check;
alter table public.match_balls add constraint match_balls_wicket_type_check
  check (wicket_type is null or wicket_type in ('bowled','caught','run_out','stumped','hit_wicket','mankad','other'));

-- ---------- advance_knockout: respect pinned ----------
create or replace function public.advance_knockout()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_league_done boolean;
  v_a1 text; v_a2 text; v_b1 text; v_b2 text;
  v_sf1 text; v_sf2 text;
begin
  select bool_and(status = 'completed') into v_league_done from public.fixtures where stage = 'league';

  if coalesce(v_league_done, false) then
    select max(case when group_name = 'A' and rank = 1 then team_code end),
           max(case when group_name = 'A' and rank = 2 then team_code end),
           max(case when group_name = 'B' and rank = 1 then team_code end),
           max(case when group_name = 'B' and rank = 2 then team_code end)
      into v_a1, v_a2, v_b1, v_b2
    from public.fixture_standings();

    update public.fixtures f set home_code = v_a1, away_code = v_b2, updated_at = now()
      from (select match_number, row_number() over (order by sort_order) rn from public.fixtures where stage = 'semifinal') s
     where f.match_number = s.match_number and s.rn = 1
       and f.status = 'upcoming' and not f.locked and not f.pinned and v_a1 is not null and v_b2 is not null;

    update public.fixtures f set home_code = v_b1, away_code = v_a2, updated_at = now()
      from (select match_number, row_number() over (order by sort_order) rn from public.fixtures where stage = 'semifinal') s
     where f.match_number = s.match_number and s.rn = 2
       and f.status = 'upcoming' and not f.locked and not f.pinned and v_b1 is not null and v_a2 is not null;
  else
    update public.fixtures f set home_code = 'A1', away_code = 'B2', updated_at = now()
      from (select match_number, row_number() over (order by sort_order) rn from public.fixtures where stage = 'semifinal') s
     where f.match_number = s.match_number and s.rn = 1 and f.status = 'upcoming' and not f.locked and not f.pinned;

    update public.fixtures f set home_code = 'B1', away_code = 'A2', updated_at = now()
      from (select match_number, row_number() over (order by sort_order) rn from public.fixtures where stage = 'semifinal') s
     where f.match_number = s.match_number and s.rn = 2 and f.status = 'upcoming' and not f.locked and not f.pinned;
  end if;

  select max(case when rn = 1 then winner_code end), max(case when rn = 2 then winner_code end)
    into v_sf1, v_sf2
  from (select winner_code, row_number() over (order by sort_order) rn from public.fixtures where stage = 'semifinal') s;

  if v_sf1 is not null and v_sf2 is not null then
    update public.fixtures set home_code = v_sf1, away_code = v_sf2, updated_at = now()
     where stage = 'final' and status = 'upcoming' and not locked and not pinned;
  else
    update public.fixtures set home_code = 'SF1', away_code = 'SF2', updated_at = now()
     where stage = 'final' and status = 'upcoming' and not locked and not pinned;
  end if;
end $$;
revoke all on function public.advance_knockout() from public;

-- ---------- admin_fixture_update: home/away/pinned + validation ----------
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

-- ---------- restore: include pinned ----------
create or replace function public.admin_fixture_restore(p_history_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare s jsonb;
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  select snapshot into s from public.fixture_history where id = p_history_id;
  if s is null then raise exception 'history % not found', p_history_id; end if;
  perform set_config('dpl.fixture_action', 'restore', true);
  update public.fixtures set
    stage = s->>'stage', group_name = nullif(s->>'group_name', ''),
    home_code = s->>'home_code', away_code = s->>'away_code',
    home_score = nullif(s->>'home_score', '')::integer, away_score = nullif(s->>'away_score', '')::integer,
    home_overs = nullif(s->>'home_overs', '')::numeric, away_overs = nullif(s->>'away_overs', '')::numeric,
    winner_code = nullif(s->>'winner_code', ''),
    match_date = (s->>'match_date')::date, match_time = (s->>'match_time')::time,
    venue = s->>'venue', status = s->>'status', result_type = s->>'result_type',
    points_home = nullif(s->>'points_home', '')::integer, points_away = nullif(s->>'points_away', '')::integer,
    note = nullif(s->>'note', ''),
    published = coalesce((s->>'published')::boolean, true),
    locked = coalesce((s->>'locked')::boolean, false),
    pinned = coalesce((s->>'pinned')::boolean, false),
    updated_at = now()
  where match_number = (s->>'match_number')::integer;
  perform public.advance_knockout();
end $$;

-- ---------- innings: openers + strike ----------
create or replace function public.admin_innings_set_strike(p_match_number integer, p_innings integer, p_opener1 uuid, p_opener2 uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  update public.match_innings
     set opener1_id = p_opener1, opener2_id = p_opener2,
         striker_id = p_opener1, non_striker_id = p_opener2,
         free_hit = false, updated_at = now()
   where match_number = p_match_number and innings = p_innings;
  if not found then raise exception 'innings not set up'; end if;
end $$;

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
  end loop;
  update public.match_innings
     set striker_id = v_striker, non_striker_id = v_non, current_bowler_id = v_bowler, free_hit = v_fh, updated_at = now()
   where match_number = p_match_number and innings = p_innings;
end $$;

-- ---------- ball add (new signature) ----------
drop function if exists public.admin_ball_add(integer, integer, integer, text, boolean, uuid, uuid);
create or replace function public.admin_ball_add(
  p_match_number integer, p_innings integer, p_bat_runs integer, p_extra text,
  p_is_wicket boolean, p_wicket_type text, p_bowler_id uuid
) returns void language plpgsql security definer set search_path = public as $$
declare v_seq integer; v_fh boolean; v_striker uuid;
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  select free_hit, striker_id into v_fh, v_striker
    from public.match_innings where match_number = p_match_number and innings = p_innings and not closed;
  if not found then raise exception 'innings % is not open', p_innings; end if;
  if v_fh and coalesce(p_is_wicket, false) and coalesce(p_wicket_type, 'run_out') <> 'run_out' then
    raise exception 'on a free hit only a run-out is allowed';
  end if;
  select coalesce(max(ball_seq), 0) + 1 into v_seq from public.match_balls where match_number = p_match_number and innings = p_innings;
  insert into public.match_balls (match_number, innings, ball_seq, batter_id, bowler_id, bat_runs, extra, is_wicket, wicket_type, free_hit)
  values (p_match_number, p_innings, v_seq, v_striker, p_bowler_id, coalesce(p_bat_runs, 0), p_extra,
          coalesce(p_is_wicket, false), case when coalesce(p_is_wicket, false) then p_wicket_type else null end, v_fh);
  perform public.recompute_innings(p_match_number, p_innings);
end $$;

create or replace function public.admin_ball_undo(p_match_number integer, p_innings integer)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  delete from public.match_balls where id = (
    select id from public.match_balls where match_number = p_match_number and innings = p_innings order by ball_seq desc limit 1
  );
  perform public.recompute_innings(p_match_number, p_innings);
end $$;

-- ---------- per-ball list ----------
create or replace function public.match_balls_list(p_match_number integer, p_innings integer)
returns table (ball_seq integer, bat_runs integer, extra text, is_wicket boolean, wicket_type text, free_hit boolean, batter text, bowler text)
language sql stable security definer set search_path = public as $$
  select b.ball_seq, b.bat_runs, b.extra, b.is_wicket, b.wicket_type, b.free_hit,
         rb.name, rbow.name
  from public.match_balls b
  left join public.registrations rb on rb.id = b.batter_id
  left join public.registrations rbow on rbow.id = b.bowler_id
  where b.match_number = p_match_number and b.innings = p_innings
  order by b.ball_seq;
$$;

-- ---------- scorecard: add per-ball commentary ----------
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
    select b.batter_id, r.name,
      sum(case when b.extra is null or b.extra = 'no_ball' then b.bat_runs else 0 end) as runs,
      count(*) filter (where b.extra is null or b.extra in ('bye','leg_bye')) as balls,
      bool_or(b.is_wicket) as out
    from public.match_balls b left join public.registrations r on r.id = b.batter_id
    where b.match_number = p_match_number and b.batter_id is not null
    group by b.batter_id, r.name
  ),
  bowl as (
    select b.bowler_id, r.name,
      count(*) filter (where b.extra is null or b.extra in ('bye','leg_bye')) as balls,
      coalesce(sum(case when b.extra is null or b.extra = 'no_ball' then b.bat_runs else 0 end),0)
        + coalesce(sum(case when b.extra in ('wide','no_ball') then 1 else 0 end),0) as runs,
      count(*) filter (where b.is_wicket) as wickets
    from public.match_balls b left join public.registrations r on r.id = b.bowler_id
    where b.match_number = p_match_number and b.bowler_id is not null
    group by b.bowler_id, r.name
  ),
  cmt as (
    select b.innings, b.ball_seq, b.bat_runs, b.extra, b.is_wicket, b.wicket_type, b.free_hit,
           rb.name as batter
    from public.match_balls b left join public.registrations rb on rb.id = b.batter_id
    where b.match_number = p_match_number
    order by b.innings, b.ball_seq
  )
  select jsonb_build_object(
    'innings', coalesce((select jsonb_agg(jsonb_build_object(
        'innings', innings, 'batting_code', batting_code, 'bowling_code', bowling_code, 'closed', closed,
        'runs', runs, 'wickets', wickets, 'balls', balls,
        'overs', floor(balls / 6.0) + (balls % 6) / 10.0) order by innings) from inn), '[]'::jsonb),
    'batting', coalesce((select jsonb_agg(jsonb_build_object('id', batter_id, 'name', coalesce(name,'Player'), 'runs', runs, 'balls', balls, 'out', out) order by runs desc) from bat), '[]'::jsonb),
    'bowling', coalesce((select jsonb_agg(jsonb_build_object('id', bowler_id, 'name', coalesce(name,'Player'), 'balls', balls, 'runs', runs, 'wickets', wickets) order by wickets desc, runs asc) from bowl), '[]'::jsonb),
    'commentary', coalesce((select jsonb_agg(jsonb_build_object(
        'innings', innings, 'seq', ball_seq, 'runs', bat_runs, 'extra', extra,
        'is_wicket', is_wicket, 'wicket_type', wicket_type, 'free_hit', free_hit, 'batter', batter)
        order by innings, ball_seq) from cmt), '[]'::jsonb)
  );
$$;
