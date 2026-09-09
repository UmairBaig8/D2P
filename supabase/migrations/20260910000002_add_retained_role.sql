-- Add 'retained' as an explicit team_players role: a pre-kept playing member
-- (distinct from leadership roles owner/co_owner/captain and auction-bought 'player').

alter table public.team_players drop constraint if exists team_players_role_check;
alter table public.team_players
  add constraint team_players_role_check
  check (role in ('owner', 'co_owner', 'captain', 'vice_captain', 'retained', 'player'));
