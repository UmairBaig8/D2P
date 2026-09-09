-- Team leadership via normalized team_players.role.
-- Adds 'owner' to the role enum, enforces at-most-one owner/captain/vice_captain
-- per team, and derives names in teams_list() by joining registrations.
-- teams.owner / teams.captain text columns remain as fallback for owners/captains
-- who have not registered yet (coalesce fallback) and are deprecated over time.

-- 1. Drop the existing role check constraint (auto-named by Postgres), re-add with 'owner'.
do $$
declare
  c text;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.team_players'::regclass
      and contype = 'c'
      and conkey = (
        select array[attnum]
        from pg_attribute
        where attrelid = 'public.team_players'::regclass and attname = 'role'
      )
  loop
    execute format('alter table public.team_players drop constraint %I', c);
  end loop;
end $$;

alter table public.team_players
  add constraint team_players_role_check
  check (role in ('owner', 'captain', 'vice_captain', 'player'));

-- 2. At most one owner / captain / vice_captain per team.
create unique index if not exists team_players_one_owner
  on public.team_players (team_id) where role = 'owner';
create unique index if not exists team_players_one_captain
  on public.team_players (team_id) where role = 'captain';
create unique index if not exists team_players_one_vc
  on public.team_players (team_id) where role = 'vice_captain';

-- 3. teams_list(): derive owner/captain from team_players, fall back to text columns.
create or replace function public.teams_list()
returns table (
  id uuid,
  name text,
  code text,
  icon_url text,
  theme text,
  owner text,
  captain text,
  champion boolean,
  player_count bigint,
  sort_order integer
)
language sql
security definer
set search_path = public
as $$
  select
    t.id, t.name, t.code, t.icon_url, t.theme,
    coalesce(
      (select r.name from public.team_players tp
       join public.registrations r on r.id = tp.player_id
       where tp.team_id = t.id and tp.role = 'owner'),
      t.owner
    ) as owner,
    coalesce(
      (select r.name from public.team_players tp
       join public.registrations r on r.id = tp.player_id
       where tp.team_id = t.id and tp.role = 'captain'),
      t.captain
    ) as captain,
    t.champion,
    (select count(*) from public.team_players tp where tp.team_id = t.id) as player_count,
    t.sort_order
  from public.teams t
  order by t.sort_order;
$$;

revoke all on function public.teams_list() from public;
grant execute on function public.teams_list() to anon, authenticated;

-- 4. team_roster(): order owner first.
create or replace function public.team_roster(team_code text)
returns table (
  id uuid,
  name text,
  photo_url text,
  player_type text,
  location text,
  dpl_played boolean,
  role text
)
language sql
security definer
set search_path = public
as $$
  select
    r.id, r.name, r.photo_url, r.player_type, r.location, r.dpl_played, tp.role
  from public.team_players tp
  join public.registrations r on r.id = tp.player_id
  join public.teams t on t.id = tp.team_id
  where t.code = team_code
  order by case tp.role
    when 'owner' then 0
    when 'captain' then 1
    when 'vice_captain' then 2
    else 3 end, r.created_at;
$$;

revoke all on function public.team_roster(text) from public;
grant execute on function public.team_roster(text) to anon, authenticated;
