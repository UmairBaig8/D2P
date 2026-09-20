-- DPL 2026: knockout auto-advance, match lock, per-match undo history,
-- and ball-accurate NRR.
--
-- NRR note: `home_overs`/`away_overs` use cricket notation (4.3 = 4 overs 3
-- balls). NRR must convert to balls, so `overs_to_balls()` is the single
-- source of truth used by fixture_standings().

-- ---------- ball-accurate overs ----------
create or replace function public.overs_to_balls(p numeric)
returns integer language sql immutable as $$
  select case when p is null then null
              else floor(p)::int * 6 + round((p - floor(p)) * 10)::int end;
$$;

-- ---------- match lock ----------
alter table public.fixtures add column if not exists locked boolean not null default false;

-- ---------- history (undo) ----------
create table if not exists public.fixture_history (
  id bigint generated always as identity primary key,
  match_number integer not null,
  action text not null default 'update',
  actor_email text,
  snapshot jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists fixture_history_match_idx on public.fixture_history (match_number, created_at desc);
alter table public.fixture_history enable row level security;
drop policy if exists "admins read fixture history" on public.fixture_history;
create policy "admins read fixture history" on public.fixture_history
  for select to authenticated using (public.is_admin());

create or replace function public.log_fixture_history()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.fixture_history (match_number, action, actor_email, snapshot)
  values (coalesce(old.match_number, new.match_number),
          coalesce(nullif(current_setting('dpl.fixture_action', true), ''), lower(tg_op)),
          lower(coalesce(auth.jwt() ->> 'email', '')),
          to_jsonb(old));
  return coalesce(new, old);
end $$;

drop trigger if exists fixtures_history on public.fixtures;
create trigger fixtures_history after update or delete on public.fixtures
  for each row execute function public.log_fixture_history();

-- ---------- standings (ball-accurate NRR) ----------
create or replace function public.fixture_standings()
returns table (
  group_name text, team_code text, rank integer, played integer, won integer,
  lost integer, tied integer, points integer, nrr numeric
)
language sql stable security definer set search_path = public as $$
  with cfg as (
    select coalesce(points_win, 2) pw, coalesce(points_tie, 1) pt,
           coalesce(points_no_result, 1) pn, coalesce(overs_per_innings, 5) opi
    from public.settings where id = 1
  ),
  cfg1 as (select * from cfg union all select 2, 1, 1, 5 limit 1),
  members as (
    select group_name, home_code as code from public.fixtures where stage = 'league' and group_name is not null
    union
    select group_name, away_code from public.fixtures where stage = 'league' and group_name is not null
  ),
  m as (select * from public.fixtures where stage = 'league' and status = 'completed'),
  agg as (
    select mem.group_name, mem.code,
      count(m.id)::int as played,
      sum(case when m.winner_code = mem.code then 1 else 0 end)::int as won,
      sum(case when m.winner_code is not null and m.winner_code <> mem.code then 1 else 0 end)::int as lost,
      sum(case when m.result_type in ('tie','no_result','abandoned') or m.winner_code is null then 1 else 0 end)::int as tied,
      sum(case
            when m.result_type in ('tie','no_result','abandoned') or m.winner_code is null
              then coalesce(case when mem.code = m.home_code then m.points_home else m.points_away end, (select pt from cfg1))
            when m.winner_code = mem.code
              then coalesce(case when mem.code = m.home_code then m.points_home else m.points_away end, (select pw from cfg1))
            else coalesce(case when mem.code = m.home_code then m.points_home else m.points_away end, 0)
          end)::int as points,
      sum(case when mem.code = m.home_code then coalesce(m.home_score,0) else coalesce(m.away_score,0) end)::numeric as runs_for,
      sum(case when mem.code = m.home_code then coalesce(m.away_score,0) else coalesce(m.home_score,0) end)::numeric as runs_against,
      sum(coalesce(public.overs_to_balls(case when mem.code = m.home_code then m.home_overs else m.away_overs end), (select opi from cfg1) * 6))::numeric as balls_for,
      sum(coalesce(public.overs_to_balls(case when mem.code = m.home_code then m.away_overs else m.home_overs end), (select opi from cfg1) * 6))::numeric as balls_against
    from members mem
    join m on m.home_code = mem.code or m.away_code = mem.code
    group by mem.group_name, mem.code
  ),
  scored as (
    select a.*,
      round((case when a.balls_for > 0 then a.runs_for / (a.balls_for / 6) else 0 end)
          - (case when a.balls_against > 0 then a.runs_against / (a.balls_against / 6) else 0 end), 3) as nrr
    from agg a
  ),
  ranked as (
    select s.*, row_number() over (partition by s.group_name order by s.points desc, s.nrr desc, t.sort_order asc) as rn
    from scored s join public.teams t on t.code = s.code
  )
  select r.group_name, r.code, r.rn::int, r.played, r.won, r.lost, r.tied, r.points, r.nrr
  from ranked r
  order by r.group_name, r.rn;
$$;

-- ---------- knockout auto-advance ----------
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
       and f.status = 'upcoming' and not f.locked and v_a1 is not null and v_b2 is not null;

    update public.fixtures f set home_code = v_b1, away_code = v_a2, updated_at = now()
      from (select match_number, row_number() over (order by sort_order) rn from public.fixtures where stage = 'semifinal') s
     where f.match_number = s.match_number and s.rn = 2
       and f.status = 'upcoming' and not f.locked and v_b1 is not null and v_a2 is not null;
  else
    update public.fixtures f set home_code = 'A1', away_code = 'B2', updated_at = now()
      from (select match_number, row_number() over (order by sort_order) rn from public.fixtures where stage = 'semifinal') s
     where f.match_number = s.match_number and s.rn = 1 and f.status = 'upcoming' and not f.locked;

    update public.fixtures f set home_code = 'B1', away_code = 'A2', updated_at = now()
      from (select match_number, row_number() over (order by sort_order) rn from public.fixtures where stage = 'semifinal') s
     where f.match_number = s.match_number and s.rn = 2 and f.status = 'upcoming' and not f.locked;
  end if;

  select max(case when rn = 1 then winner_code end), max(case when rn = 2 then winner_code end)
    into v_sf1, v_sf2
  from (select winner_code, row_number() over (order by sort_order) rn from public.fixtures where stage = 'semifinal') s;

  if v_sf1 is not null and v_sf2 is not null then
    update public.fixtures set home_code = v_sf1, away_code = v_sf2, updated_at = now()
     where stage = 'final' and status = 'upcoming' and not locked;
  else
    update public.fixtures set home_code = 'SF1', away_code = 'SF2', updated_at = now()
     where stage = 'final' and status = 'upcoming' and not locked;
  end if;
end $$;

revoke all on function public.advance_knockout() from public;

-- ---------- admin_fixture_update (lock-aware + advance) ----------
create or replace function public.admin_fixture_update(p_match_number integer, p_patch jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_locked boolean;
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;

  select locked into v_locked from public.fixtures where match_number = p_match_number;
  if v_locked is null then raise exception 'match % not found', p_match_number; end if;
  if v_locked and exists (select 1 from jsonb_object_keys(p_patch) k where k not in ('locked', 'published')) then
    raise exception 'match % is locked — unlock it before editing', p_match_number;
  end if;

  perform set_config('dpl.fixture_action', 'update', true);

  update public.fixtures set
    match_date  = case when p_patch ? 'match_date'  then (p_patch->>'match_date')::date else match_date end,
    match_time  = case when p_patch ? 'match_time'  then (p_patch->>'match_time')::time else match_time end,
    venue       = case when p_patch ? 'venue'       then p_patch->>'venue' else venue end,
    status      = case when p_patch ? 'status'      then p_patch->>'status' else status end,
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

-- ---------- admin_fixture_reset (lock-aware + advance) ----------
create or replace function public.admin_fixture_reset(p_match_number integer)
returns void language plpgsql security definer set search_path = public as $$
declare v_locked boolean;
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  select locked into v_locked from public.fixtures where match_number = p_match_number;
  if v_locked then raise exception 'match % is locked — unlock it first', p_match_number; end if;
  perform set_config('dpl.fixture_action', 'reset', true);
  update public.fixtures set
    status = 'upcoming', home_score = null, away_score = null,
    home_overs = null, away_overs = null, winner_code = null,
    points_home = null, points_away = null, result_type = 'normal',
    note = null, updated_at = now()
  where match_number = p_match_number;
  if not found then raise exception 'match % not found', p_match_number; end if;
  perform public.advance_knockout();
end $$;

-- ---------- admin_fixture_bulk_status (skip locked + advance) ----------
create or replace function public.admin_fixture_bulk_status(p_matches integer[], p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  if p_status not in ('upcoming', 'live', 'completed', 'postponed') then raise exception 'bad status'; end if;
  perform set_config('dpl.fixture_action', 'bulk_status', true);
  update public.fixtures set status = p_status, updated_at = now()
   where match_number = any(p_matches) and not locked;
  perform public.advance_knockout();
end $$;

-- ---------- history + restore ----------
create or replace function public.admin_fixture_history(p_match_number integer, p_limit integer default 30)
returns table (id bigint, action text, actor_email text, created_at timestamptz, status text, home_code text, away_code text, home_score integer, away_score integer, winner_code text)
language sql stable security definer set search_path = public as $$
  select h.id, h.action, h.actor_email, h.created_at,
         h.snapshot->>'status', h.snapshot->>'home_code', h.snapshot->>'away_code',
         nullif(h.snapshot->>'home_score','')::int, nullif(h.snapshot->>'away_score','')::int, h.snapshot->>'winner_code'
  from public.fixture_history h
  where h.match_number = p_match_number and public.is_admin()
  order by h.created_at desc
  limit coalesce(p_limit, 30);
$$;

create or replace function public.admin_fixture_restore(p_history_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare s jsonb;
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  select snapshot into s from public.fixture_history where id = p_history_id;
  if s is null then raise exception 'history % not found', p_history_id; end if;
  perform set_config('dpl.fixture_action', 'restore', true);
  update public.fixtures set
    stage       = s->>'stage',
    group_name  = nullif(s->>'group_name', ''),
    home_code   = s->>'home_code',
    away_code   = s->>'away_code',
    home_score  = nullif(s->>'home_score', '')::integer,
    away_score  = nullif(s->>'away_score', '')::integer,
    home_overs  = nullif(s->>'home_overs', '')::numeric,
    away_overs  = nullif(s->>'away_overs', '')::numeric,
    winner_code = nullif(s->>'winner_code', ''),
    match_date  = (s->>'match_date')::date,
    match_time  = (s->>'match_time')::time,
    venue       = s->>'venue',
    status      = s->>'status',
    result_type = s->>'result_type',
    points_home = nullif(s->>'points_home', '')::integer,
    points_away = nullif(s->>'points_away', '')::integer,
    note        = nullif(s->>'note', ''),
    published   = coalesce((s->>'published')::boolean, true),
    locked      = coalesce((s->>'locked')::boolean, false),
    updated_at  = now()
  where match_number = (s->>'match_number')::integer;
  perform public.advance_knockout();
end $$;
