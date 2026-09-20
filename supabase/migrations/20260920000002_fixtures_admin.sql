-- DPL 2026: fixture admin controls.
-- Adds result detail (overs for run-rate/NRR, result type, per-match points
-- override, notes, publish flag), configurable points in settings, and the
-- admin RPCs the /admin Fixtures tab calls. All writes are guarded by is_admin().

-- ---------- fixtures: richer result data ----------
alter table public.fixtures
  add column if not exists home_overs  numeric(4,1) check (home_overs >= 0),
  add column if not exists away_overs  numeric(4,1) check (away_overs >= 0),
  add column if not exists result_type text not null default 'normal'
    check (result_type in ('normal', 'tie', 'no_result', 'abandoned', 'forfeit')),
  add column if not exists points_home integer check (points_home >= 0),
  add column if not exists points_away integer check (points_away >= 0),
  add column if not exists note text,
  add column if not exists published boolean not null default true;

-- sort_order must be freely reshufflable while reordering.
alter table public.fixtures drop constraint if exists fixtures_sort_order_key;
create index if not exists fixtures_sort_order_idx on public.fixtures (sort_order);

-- ---------- settings: league points + overs ----------
alter table public.settings
  add column if not exists points_win       integer not null default 2,
  add column if not exists points_tie       integer not null default 1,
  add column if not exists points_no_result integer not null default 1,
  add column if not exists overs_per_innings integer not null default 5;

-- ---------- admin RPCs ----------

-- Patch any subset of a fixture's fields. Auto-derives winner_code from scores
-- for completed "normal" results unless winner_code is explicitly patched.
create or replace function public.admin_fixture_update(p_match_number integer, p_patch jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;

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
    updated_at  = now()
  where match_number = p_match_number;

  if not found then raise exception 'match % not found', p_match_number; end if;

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
end $$;

-- Rewrite the running order from a full list of match numbers (index = order).
create or replace function public.admin_fixture_reorder(p_order integer[])
returns void language plpgsql security definer set search_path = public as $$
declare i integer;
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  if p_order is null or array_length(p_order, 1) is null then return; end if;
  for i in 1..array_length(p_order, 1) loop
    update public.fixtures set sort_order = i, updated_at = now() where match_number = p_order[i];
  end loop;
end $$;

create or replace function public.admin_fixture_create(
  p_stage text, p_group text, p_home text, p_away text,
  p_match_date date, p_match_time time, p_venue text
) returns integer language plpgsql security definer set search_path = public as $$
declare v_num integer; v_sort integer;
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  if p_stage not in ('league', 'semifinal', 'final') then raise exception 'bad stage'; end if;
  if p_group is not null and p_group not in ('A', 'B') then raise exception 'bad group'; end if;
  select coalesce(max(match_number), 0) + 1, coalesce(max(sort_order), 0) + 1 into v_num, v_sort from public.fixtures;
  insert into public.fixtures (match_number, stage, group_name, home_code, away_code, match_date, match_time, venue, sort_order)
  values (v_num, p_stage, p_group, upper(p_home), upper(p_away), p_match_date, p_match_time, coalesce(p_venue, 'DPL Arena'), v_sort);
  return v_num;
end $$;

create or replace function public.admin_fixture_delete(p_match_number integer)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  delete from public.fixtures where match_number = p_match_number;
  if not found then raise exception 'match % not found', p_match_number; end if;
end $$;

-- Clear a result back to "upcoming".
create or replace function public.admin_fixture_reset(p_match_number integer)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  update public.fixtures set
    status = 'upcoming', home_score = null, away_score = null,
    home_overs = null, away_overs = null, winner_code = null,
    points_home = null, points_away = null, result_type = 'normal',
    note = null, updated_at = now()
  where match_number = p_match_number;
  if not found then raise exception 'match % not found', p_match_number; end if;
end $$;

create or replace function public.admin_fixture_bulk_status(p_matches integer[], p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  if p_status not in ('upcoming', 'live', 'completed', 'postponed') then raise exception 'bad status'; end if;
  update public.fixtures set status = p_status, updated_at = now() where match_number = any(p_matches);
end $$;
