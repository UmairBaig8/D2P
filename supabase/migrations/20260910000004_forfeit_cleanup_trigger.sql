-- Forfeit follow-ups:
-- 1. Auto-unassign + remove from auction when a player is forfeited (trigger).
-- 2. Hide forfeited players from the public players list.

create or replace function public.registrations_forfeit_cleanup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.forfeited and not coalesce(old.forfeited, false) then
    delete from public.team_players where player_id = new.id;
    delete from public.auction_bids where player_id = new.id;
    delete from public.auction_results where player_id = new.id and status in ('pool', 'on_auction');
  end if;
  return new;
end;
$$;

drop trigger if exists registrations_forfeit_cleanup on public.registrations;
create trigger registrations_forfeit_cleanup
  after update of forfeited on public.registrations
  for each row execute function public.registrations_forfeit_cleanup();

create or replace function public.players_list()
returns table (
  id uuid, name text, photo_url text, player_type text, gender text, location text,
  batting_style text, bowling_style text, bowling_arm text, availability text,
  self_rating integer, dpl_played boolean, jersey_size text, created_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select r.id, r.name, r.photo_url, r.player_type, r.gender, r.location,
         r.batting_style, r.bowling_style, r.bowling_arm, r.availability,
         r.self_rating, r.dpl_played, r.jersey_size, r.created_at
  from public.registrations r
  where not coalesce(r.forfeited, false)
  order by r.created_at asc;
$$;
