-- Timer end must HOLD the lot until the admin decides (unsold vs extend).
-- Previously both state RPCs (admin_auction_state, auction_live_state) called
-- auction_expire_overdue(), which auto-marked overdue lots unsold on every poll.
-- Make it a no-op so the TIME'S UP prompt drives the decision instead.
create or replace function public.auction_expire_overdue(v_session uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  return;
end;
$function$;
