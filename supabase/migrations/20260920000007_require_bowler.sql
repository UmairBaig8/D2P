-- A bowler is mandatory for every delivery (bowling figures and the "no bowler
-- may bowl more than one over per innings" rule both depend on it).

create or replace function public.admin_ball_add(
  p_match_number integer, p_innings integer, p_bat_runs integer, p_extra text,
  p_is_wicket boolean, p_wicket_type text, p_bowler_id uuid
) returns void language plpgsql security definer set search_path = public as $$
declare v_seq integer; v_fh boolean; v_striker uuid;
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  if p_bowler_id is null then raise exception 'select a bowler before the next delivery'; end if;
  select free_hit, striker_id into v_fh, v_striker
    from public.match_innings where match_number = p_match_number and innings = p_innings and not closed;
  if not found then raise exception 'innings % is not open', p_innings; end if;
  if v_fh and coalesce(p_is_wicket, false) and coalesce(p_wicket_type, 'run_out') <> 'run_out' then
    raise exception 'on a free hit only a run-out is allowed';
  end if;
  select coalesce(max(ball_seq), 0) + 1 into v_seq from public.match_balls where match_number = p_match_number and innings = p_innings;
  insert into public.match_balls (match_number, innings, ball_seq, batter_id, bowler_id, bat_runs, extra, is_wicket, wicket_type, free_hit)
  values (p_match_number, p_innings, v_seq, v_striker, p_bowler_id, coalesce(p_bat_runs, 0), p_extra,
          coalesce(p_is_wicket, false), case when coalesce(p_is_wicket, false) then p_wicket_type else null end, v_fh);
  perform public.recompute_innings(p_match_number, p_innings);
end $$;
