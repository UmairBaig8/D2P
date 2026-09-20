-- DPL 2026: ball-by-ball scoring (mobile scorer) with derived innings totals
-- and a public scorecard. Writes are admin-only via security definer RPCs.
--
-- Ball model per delivery:
--   bat_runs : runs off the bat (0-6); for bye/leg_bye it holds the byes; for
--              wide/no_ball it holds any runs run in addition to the 1 penalty.
--   extra    : null | 'wide' | 'no_ball' | 'bye' | 'leg_bye'
--   is_wicket: true when the batter is out
-- Legal delivery = extra is null or bye/leg_bye (wide/no_ball are not legal).

create table if not exists public.match_innings (
  match_number integer not null,
  innings integer not null check (innings in (1, 2)),
  batting_code text not null,
  bowling_code text not null,
  closed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (match_number, innings)
);

create table if not exists public.match_balls (
  id bigint generated always as identity primary key,
  match_number integer not null,
  innings integer not null check (innings in (1, 2)),
  ball_seq integer not null,
  batter_id uuid,
  bowler_id uuid,
  bat_runs integer not null default 0 check (bat_runs between 0 and 12),
  extra text check (extra in ('wide', 'no_ball', 'bye', 'leg_bye')),
  is_wicket boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists match_balls_idx on public.match_balls (match_number, innings, ball_seq);

alter table public.match_innings enable row level security;
alter table public.match_balls enable row level security;
drop policy if exists "anyone can read match innings" on public.match_innings;
create policy "anyone can read match innings" on public.match_innings for select to anon, authenticated using (true);
drop policy if exists "anyone can read match balls" on public.match_balls;
create policy "anyone can read match balls" on public.match_balls for select to anon, authenticated using (true);

-- ---------- setup ----------
create or replace function public.admin_innings_setup(p_match_number integer, p_batting_first text)
returns void language plpgsql security definer set search_path = public as $$
declare v_home text; v_away text;
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  select home_code, away_code into v_home, v_away from public.fixtures where match_number = p_match_number;
  if v_home is null then raise exception 'match % not found', p_match_number; end if;
  if p_batting_first not in (v_home, v_away) then raise exception 'batting team must be % or %', v_home, v_away; end if;
  insert into public.match_innings (match_number, innings, batting_code, bowling_code) values
    (p_match_number, 1, p_batting_first, case when p_batting_first = v_home then v_away else v_home end),
    (p_match_number, 2, case when p_batting_first = v_home then v_away else v_home end, p_batting_first)
  on conflict (match_number, innings) do nothing;
end $$;

-- ---------- ball entry ----------
create or replace function public.admin_ball_add(
  p_match_number integer, p_innings integer, p_bat_runs integer, p_extra text,
  p_is_wicket boolean, p_batter_id uuid, p_bowler_id uuid
) returns void language plpgsql security definer set search_path = public as $$
declare v_seq integer;
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  if not exists (select 1 from public.match_innings where match_number = p_match_number and innings = p_innings and not closed) then
    raise exception 'innings % is not open', p_innings;
  end if;
  select coalesce(max(ball_seq), 0) + 1 into v_seq from public.match_balls where match_number = p_match_number and innings = p_innings;
  insert into public.match_balls (match_number, innings, ball_seq, batter_id, bowler_id, bat_runs, extra, is_wicket)
  values (p_match_number, p_innings, v_seq, p_batter_id, p_bowler_id, coalesce(p_bat_runs, 0), p_extra, coalesce(p_is_wicket, false));
end $$;

create or replace function public.admin_ball_undo(p_match_number integer, p_innings integer)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  delete from public.match_balls where id = (
    select id from public.match_balls where match_number = p_match_number and innings = p_innings order by ball_seq desc limit 1
  );
end $$;

-- ---------- close / reopen ----------
create or replace function public.admin_innings_close(p_match_number integer, p_innings integer)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_home text; v_locked boolean; v_batting text;
  v_balls integer; v_runs integer; v_wickets integer; v_overs numeric;
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  select home_code, locked into v_home, v_locked from public.fixtures where match_number = p_match_number;
  if v_home is null then raise exception 'match % not found', p_match_number; end if;
  if v_locked then raise exception 'match is locked'; end if;
  select batting_code into v_batting from public.match_innings where match_number = p_match_number and innings = p_innings;
  if v_batting is null then raise exception 'innings not set up'; end if;

  select count(*) filter (where extra is null or extra in ('bye','leg_bye')),
         coalesce(sum(bat_runs), 0) + coalesce(sum(case when extra in ('wide','no_ball') then 1 else 0 end), 0),
         count(*) filter (where is_wicket)
    into v_balls, v_runs, v_wickets
  from public.match_balls where match_number = p_match_number and innings = p_innings;

  v_overs := floor(v_balls / 6.0) + (v_balls % 6) / 10.0;
  perform set_config('dpl.fixture_action', 'innings_close', true);

  if v_batting = v_home then
    update public.fixtures set home_score = v_runs, home_overs = v_overs, updated_at = now() where match_number = p_match_number;
  else
    update public.fixtures set away_score = v_runs, away_overs = v_overs, updated_at = now() where match_number = p_match_number;
  end if;

  update public.match_innings set closed = true, updated_at = now() where match_number = p_match_number and innings = p_innings;

  if not exists (select 1 from public.match_innings where match_number = p_match_number and not closed) then
    update public.fixtures f set
      status = 'completed',
      winner_code = case
        when f.home_score is null or f.away_score is null then null
        when f.home_score > f.away_score then f.home_code
        when f.away_score > f.home_score then f.away_code
        else null end,
      updated_at = now()
    where match_number = p_match_number;
  end if;

  perform public.advance_knockout();
end $$;

create or replace function public.admin_innings_reopen(p_match_number integer, p_innings integer)
returns void language plpgsql security definer set search_path = public as $$
declare v_home text; v_locked boolean; v_batting text;
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  select home_code, locked into v_home, v_locked from public.fixtures where match_number = p_match_number;
  if v_locked then raise exception 'match is locked'; end if;
  select batting_code into v_batting from public.match_innings where match_number = p_match_number and innings = p_innings;
  if v_batting is null then raise exception 'innings not set up'; end if;
  perform set_config('dpl.fixture_action', 'innings_reopen', true);
  update public.match_innings set closed = false, updated_at = now() where match_number = p_match_number and innings = p_innings;
  if v_batting = v_home then
    update public.fixtures set home_score = null, home_overs = null, status = 'live', winner_code = null, updated_at = now() where match_number = p_match_number;
  else
    update public.fixtures set away_score = null, away_overs = null, status = 'live', winner_code = null, updated_at = now() where match_number = p_match_number;
  end if;
  perform public.advance_knockout();
end $$;

-- ---------- public scorecard ----------
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
  )
  select jsonb_build_object(
    'innings', coalesce((select jsonb_agg(jsonb_build_object(
        'innings', innings, 'batting_code', batting_code, 'bowling_code', bowling_code, 'closed', closed,
        'runs', runs, 'wickets', wickets, 'balls', balls,
        'overs', floor(balls / 6.0) + (balls % 6) / 10.0) order by innings) from inn), '[]'::jsonb),
    'batting', coalesce((select jsonb_agg(jsonb_build_object('id', batter_id, 'name', coalesce(name,'Player'), 'runs', runs, 'balls', balls, 'out', out) order by runs desc) from bat), '[]'::jsonb),
    'bowling', coalesce((select jsonb_agg(jsonb_build_object('id', bowler_id, 'name', coalesce(name,'Player'), 'balls', balls, 'runs', runs, 'wickets', wickets) order by wickets desc, runs asc) from bowl), '[]'::jsonb)
  );
$$;
