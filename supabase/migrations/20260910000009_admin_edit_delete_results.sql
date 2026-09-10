-- Admin result management: edit a sold result (team/price) and delete a lot entirely.
create or replace function public.admin_auction_edit_result(v_player uuid, v_team uuid, p_price integer)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_session uuid; v_base integer; v_old_team uuid; v_budget integer; v_spent integer;
  v_squad integer; v_squad_size integer;
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  select id into v_session from public.auction_sessions where status = 'live' order by created_at desc limit 1;
  if v_session is null then raise exception 'no live auction session'; end if;

  select base_price, sold_to_team_id into v_base, v_old_team
    from public.auction_results
    where session_id = v_session and player_id = v_player and status = 'sold';
  if not found then raise exception 'player is not sold'; end if;

  if greatest(coalesce(p_price, 0), 0) < coalesce(v_base, 0) then
    raise exception 'price is below the base price';
  end if;

  select budget into v_budget from public.auction_purses where session_id = v_session and team_id = v_team;
  if v_budget is null then raise exception 'team is not part of this session'; end if;

  select coalesce(sum(sold_price), 0) into v_spent
    from public.auction_results
    where session_id = v_session and sold_to_team_id = v_team and status = 'sold' and player_id <> v_player;
  if coalesce(p_price, 0) > v_budget - v_spent then raise exception 'team budget exceeded'; end if;

  if v_team <> v_old_team then
    select coalesce(squad_size, 15) into v_squad_size from public.settings where id = 1;
    select count(*) into v_squad from public.team_players where team_id = v_team;
    if v_squad >= v_squad_size then raise exception 'squad is full (%)', v_squad_size; end if;
    delete from public.team_players where player_id = v_player;
    insert into public.team_players (team_id, player_id, role)
    values (v_team, v_player, 'player')
    on conflict (team_id, player_id) do update set role = 'player';
  end if;

  update public.auction_results
  set sold_to_team_id = v_team, sold_price = p_price, updated_at = now()
  where session_id = v_session and player_id = v_player;
end;
$function$;

create or replace function public.admin_auction_delete_lot(v_player uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_session uuid;
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  select id into v_session from public.auction_sessions where status = 'live' order by created_at desc limit 1;
  if v_session is null then raise exception 'no live auction session'; end if;

  if exists (select 1 from public.auction_results
             where session_id = v_session and player_id = v_player and source = 'retained') then
    raise exception 'retained players cannot be deleted';
  end if;

  delete from public.team_players where player_id = v_player;
  delete from public.auction_bids where player_id = v_player and session_id = v_session;
  delete from public.auction_results where player_id = v_player and session_id = v_session;
end;
$function$;

grant execute on function public.admin_auction_edit_result(uuid, uuid, integer) to authenticated;
grant execute on function public.admin_auction_delete_lot(uuid) to authenticated;
