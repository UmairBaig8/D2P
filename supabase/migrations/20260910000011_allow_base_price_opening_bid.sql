-- Allow a player to be bought at the base price.
-- The opening bid may now equal the base price (it is the minimum, not a floor
-- that must be exceeded). Only once a bid exists must the next bid outbid it.
create or replace function public.admin_auction_bid(v_team uuid, p_amount integer)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_session uuid; v_player uuid; v_base integer; v_max integer;
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  select id into v_session from public.auction_sessions where status = 'live' order by created_at desc limit 1;
  if v_session is null then raise exception 'no live auction session'; end if;

  select player_id, greatest(coalesce(base_price, 0), 0) into v_player, v_base
    from public.auction_results
    where session_id = v_session and status = 'on_auction' limit 1;
  if v_player is null then raise exception 'no player is on auction'; end if;

  select max(amount) into v_max from public.auction_bids
    where session_id = v_session and player_id = v_player;

  if v_max is null then
    -- Opening bid: base price is the minimum, so a bid equal to base is allowed.
    if coalesce(p_amount, 0) < v_base then
      raise exception 'bid must be at least the base price';
    end if;
  else
    if coalesce(p_amount, 0) <= v_max then
      raise exception 'bid must exceed the current price';
    end if;
  end if;

  insert into public.auction_bids (session_id, player_id, team_id, amount)
  values (v_session, v_player, v_team, p_amount);
end;
$function$;
