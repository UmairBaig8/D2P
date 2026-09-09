-- Expose player rating on public team roster cards.
drop function if exists public.team_roster(text);
create or replace function public.team_roster(team_code text)
returns table (
  id uuid,
  name text,
  photo_url text,
  player_type text,
  location text,
  dpl_played boolean,
  self_rating integer,
  role text
)
language sql
security definer
set search_path = public
as $$
  select
    r.id, r.name, r.photo_url, r.player_type, r.location, r.dpl_played,
    r.self_rating, tp.role
  from public.team_players tp
  join public.registrations r on r.id = tp.player_id
  join public.teams t on t.id = tp.team_id
  where t.code = team_code
  order by case tp.role
    when 'owner' then 0
    when 'co_owner' then 1
    when 'captain' then 2
    when 'vice_captain' then 3
    else 4 end, r.created_at;
$$;

revoke all on function public.team_roster(text) from public;
grant execute on function public.team_roster(text) to anon, authenticated;
