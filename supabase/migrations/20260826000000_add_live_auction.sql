-- Live Auction: sessions, per-player results, bid trail, and per-team purses.
-- New tables + RPCs only. No edits to existing tables.

-- 1. auction_sessions — one auction run; purse + increment live here (admin-adjustable).
create table if not exists public.auction_sessions (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'DPL 2026 AUCTION',
  status text not null default 'draft' check (status in ('draft', 'live', 'ended')),
  purse_budget integer not null default 5000000 check (purse_budget >= 0),
  increment integer not null default 100000 check (increment >= 0),
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.auction_sessions enable row level security;

drop policy if exists "Anyone can read auction_sessions" on public.auction_sessions;
create policy "Anyone can read auction_sessions"
  on public.auction_sessions for select to anon, authenticated using (true);

drop policy if exists "Admins can insert auction_sessions" on public.auction_sessions;
create policy "Admins can insert auction_sessions"
  on public.auction_sessions for insert to authenticated with check (public.is_admin());

drop policy if exists "Admins can update auction_sessions" on public.auction_sessions;
create policy "Admins can update auction_sessions"
  on public.auction_sessions for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Admins can delete auction_sessions" on public.auction_sessions;
create policy "Admins can delete auction_sessions"
  on public.auction_sessions for delete to authenticated using (public.is_admin());

-- 2. auction_results — one row per player per session (the lot queue + sale record).
create table if not exists public.auction_results (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.auction_sessions(id) on delete cascade,
  player_id uuid not null references public.registrations(id) on delete cascade,
  lot_order integer not null default 0,
  base_price integer not null default 0 check (base_price >= 0),
  status text not null default 'pool' check (status in ('pool', 'on_auction', 'sold', 'unsold')),
  sold_to_team_id uuid references public.teams(id) on delete set null,
  sold_price integer check (sold_price is null or sold_price >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, player_id)
);

create index if not exists auction_results_session_idx on public.auction_results (session_id);
create index if not exists auction_results_player_idx on public.auction_results (player_id);
create index if not exists auction_results_status_idx on public.auction_results (session_id, status);

alter table public.auction_results enable row level security;

drop policy if exists "Anyone can read auction_results" on public.auction_results;
create policy "Anyone can read auction_results"
  on public.auction_results for select to anon, authenticated using (true);

drop policy if exists "Admins can insert auction_results" on public.auction_results;
create policy "Admins can insert auction_results"
  on public.auction_results for insert to authenticated with check (public.is_admin());

drop policy if exists "Admins can update auction_results" on public.auction_results;
create policy "Admins can update auction_results"
  on public.auction_results for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Admins can delete auction_results" on public.auction_results;
create policy "Admins can delete auction_results"
  on public.auction_results for delete to authenticated using (public.is_admin());

-- 3. auction_bids — the bid trail shown on the board (record-keeping for manual auctions).
create table if not exists public.auction_bids (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.auction_sessions(id) on delete cascade,
  player_id uuid not null references public.registrations(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  amount integer not null check (amount >= 0),
  created_at timestamptz not null default now()
);

create index if not exists auction_bids_session_idx on public.auction_bids (session_id);
create index if not exists auction_bids_player_idx on public.auction_bids (player_id);

alter table public.auction_bids enable row level security;

drop policy if exists "Anyone can read auction_bids" on public.auction_bids;
create policy "Anyone can read auction_bids"
  on public.auction_bids for select to anon, authenticated using (true);

drop policy if exists "Admins can insert auction_bids" on public.auction_bids;
create policy "Admins can insert auction_bids"
  on public.auction_bids for insert to authenticated with check (public.is_admin());

drop policy if exists "Admins can update auction_bids" on public.auction_bids;
create policy "Admins can update auction_bids"
  on public.auction_bids for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Admins can delete auction_bids" on public.auction_bids;
create policy "Admins can delete auction_bids"
  on public.auction_bids for delete to authenticated using (public.is_admin());

-- 4. auction_purses — per-team budget within a session (spent is derived from results).
create table if not exists public.auction_purses (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.auction_sessions(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  budget integer not null default 0 check (budget >= 0),
  created_at timestamptz not null default now(),
  unique (session_id, team_id)
);

alter table public.auction_purses enable row level security;

drop policy if exists "Anyone can read auction_purses" on public.auction_purses;
create policy "Anyone can read auction_purses"
  on public.auction_purses for select to anon, authenticated using (true);

drop policy if exists "Admins can insert auction_purses" on public.auction_purses;
create policy "Admins can insert auction_purses"
  on public.auction_purses for insert to authenticated with check (public.is_admin());

drop policy if exists "Admins can update auction_purses" on public.auction_purses;
create policy "Admins can update auction_purses"
  on public.auction_purses for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "Admins can delete auction_purses" on public.auction_purses;
create policy "Admins can delete auction_purses"
  on public.auction_purses for delete to authenticated using (public.is_admin());

-- ---------------------------------------------------------------------------
-- Public RPCs
-- ---------------------------------------------------------------------------

-- auction_live_state: everything the public board needs, in one jsonb payload.
drop function if exists public.auction_live_state();
create or replace function public.auction_live_state()
returns jsonb
language sql
security definer
set search_path = public
as $$
  with s as (
    select * from public.auction_sessions
    order by (status = 'live') desc, created_at desc
    limit 1
  ),
  cur as (
    select ar.* from public.auction_results ar
    join s on s.id = ar.session_id
    where ar.status = 'on_auction'
    order by ar.updated_at desc
    limit 1
  ),
  curbids as (
    select b.* from public.auction_bids b
    join cur on cur.player_id = b.player_id
    join s on s.id = b.session_id
  )
  select jsonb_build_object(
    'session', (select to_jsonb(s) from s),
    'current_player', case when exists (select 1 from cur) then (
      select jsonb_build_object(
        'player_id', r.id, 'name', r.name, 'employee_id', r.employee_id, 'photo_url', r.photo_url,
        'player_type', r.player_type, 'gender', r.gender, 'location', r.location,
        'dpl_played', r.dpl_played, 'self_rating', r.self_rating, 'availability', r.availability,
        'batting_style', r.batting_style, 'bowling_style', r.bowling_style,
        'lot_order', cur.lot_order, 'base_price', cur.base_price
      )
      from cur join public.registrations r on r.id = cur.player_id
    ) else null end,
    'current_bid', case when exists (select 1 from curbids) then (
      select jsonb_build_object(
        'team_id', t.id, 'team_name', t.name, 'team_code', t.code, 'team_icon_url', t.icon_url,
        'amount', cb.amount, 'created_at', cb.created_at
      )
      from curbids cb join public.teams t on t.id = cb.team_id
      order by cb.amount desc, cb.created_at desc
      limit 1
    ) else null end,
    'bid_count', (select count(*) from curbids),
    'bids', coalesce((select jsonb_agg(
        jsonb_build_object('team_code', t.code, 'amount', cb.amount, 'created_at', cb.created_at)
        order by cb.created_at desc
      ) from curbids cb join public.teams t on t.id = cb.team_id), '[]'::jsonb),
    'teams', coalesce((select jsonb_agg(jsonb_build_object(
        'team_id', t.id, 'name', t.name, 'code', t.code, 'icon_url', t.icon_url, 'theme', t.theme,
        'budget', p.budget,
        'spent', coalesce((select sum(ar.sold_price) from public.auction_results ar
                           where ar.session_id = s.id and ar.sold_to_team_id = t.id and ar.status = 'sold'), 0),
        'squad', (select count(*) from public.team_players tp where tp.team_id = t.id),
        'sold', (select count(*) from public.auction_results ar
                 where ar.session_id = s.id and ar.sold_to_team_id = t.id and ar.status = 'sold')
      ) order by t.sort_order)
      from public.auction_purses p join public.teams t on t.id = p.team_id
      join s on s.id = p.session_id), '[]'::jsonb),
    'pool_count', (select count(*) from public.auction_results ar
                   join s on s.id = ar.session_id where ar.status = 'pool'),
    'results', coalesce((select jsonb_agg(jsonb_build_object(
        'player_name', r.name, 'photo_url', r.photo_url, 'player_type', r.player_type,
        'team_code', t.code, 'sold_price', ar.sold_price, 'status', ar.status, 'lot_order', ar.lot_order
      ) order by ar.lot_order)
      from public.auction_results ar
      join public.registrations r on r.id = ar.player_id
      left join public.teams t on t.id = ar.sold_to_team_id
      join s on s.id = ar.session_id
      where ar.status in ('sold', 'unsold')), '[]'::jsonb)
  );
$$;

revoke all on function public.auction_live_state() from public;
grant execute on function public.auction_live_state() to anon, authenticated;

-- auction_session_results: full sold/unsold breakdown for a specific session.
drop function if exists public.auction_session_results(uuid);
create or replace function public.auction_session_results(session_id uuid)
returns table (
  player_name text,
  photo_url text,
  player_type text,
  team_code text,
  sold_price integer,
  status text,
  lot_order integer,
  base_price integer
)
language sql
security definer
set search_path = public
as $$
  select r.name, r.photo_url, r.player_type, t.code, ar.sold_price, ar.status, ar.lot_order, ar.base_price
  from public.auction_results ar
  join public.registrations r on r.id = ar.player_id
  left join public.teams t on t.id = ar.sold_to_team_id
  where ar.session_id = auction_session_results.session_id
  order by ar.lot_order;
$$;

revoke all on function public.auction_session_results(uuid) from public;
grant execute on function public.auction_session_results(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Admin RPCs
-- ---------------------------------------------------------------------------

-- admin_auction_state: full control-room payload (lot queue + purses + bid trail + results).
drop function if exists public.admin_auction_state();
create or replace function public.admin_auction_state()
returns jsonb
language sql
security definer
set search_path = public
as $$
  with s as (
    select * from public.auction_sessions
    order by (status = 'live') desc, created_at desc
    limit 1
  ),
  cur as (
    select ar.* from public.auction_results ar
    join s on s.id = ar.session_id
    where ar.status = 'on_auction'
    order by ar.updated_at desc
    limit 1
  ),
  curbids as (
    select b.* from public.auction_bids b
    join cur on cur.player_id = b.player_id
    join s on s.id = b.session_id
  )
  select jsonb_build_object(
    'session', (select to_jsonb(s) from s),
    'current_player', case when exists (select 1 from cur) then (
      select jsonb_build_object(
        'player_id', r.id, 'name', r.name, 'employee_id', r.employee_id, 'photo_url', r.photo_url,
        'player_type', r.player_type, 'gender', r.gender, 'location', r.location,
        'dpl_played', r.dpl_played, 'self_rating', r.self_rating, 'availability', r.availability,
        'lot_order', cur.lot_order, 'base_price', cur.base_price
      )
      from cur join public.registrations r on r.id = cur.player_id
    ) else null end,
    'current_bid', case when exists (select 1 from curbids) then (
      select jsonb_build_object(
        'team_id', t.id, 'team_name', t.name, 'team_code', t.code, 'amount', cb.amount
      )
      from curbids cb join public.teams t on t.id = cb.team_id
      order by cb.amount desc, cb.created_at desc
      limit 1
    ) else null end,
    'players', coalesce((select jsonb_agg(jsonb_build_object(
        'player_id', r.id, 'name', r.name, 'photo_url', r.photo_url, 'employee_id', r.employee_id,
        'player_type', r.player_type, 'gender', r.gender, 'location', r.location, 'dpl_played', r.dpl_played,
        'self_rating', r.self_rating, 'availability', r.availability,
        'lot_order', ar.lot_order, 'base_price', ar.base_price, 'status', ar.status,
        'sold_to_team_id', ar.sold_to_team_id, 'sold_price', ar.sold_price
      ) order by ar.lot_order)
      from public.auction_results ar
      join public.registrations r on r.id = ar.player_id
      join s on s.id = ar.session_id), '[]'::jsonb),
    'teams', coalesce((select jsonb_agg(jsonb_build_object(
        'team_id', t.id, 'name', t.name, 'code', t.code, 'icon_url', t.icon_url, 'theme', t.theme,
        'budget', p.budget,
        'spent', coalesce((select sum(ar.sold_price) from public.auction_results ar
                           where ar.session_id = s.id and ar.sold_to_team_id = t.id and ar.status = 'sold'), 0),
        'squad', (select count(*) from public.team_players tp where tp.team_id = t.id),
        'sold', (select count(*) from public.auction_results ar
                 where ar.session_id = s.id and ar.sold_to_team_id = t.id and ar.status = 'sold')
      ) order by t.sort_order)
      from public.auction_purses p join public.teams t on t.id = p.team_id
      join s on s.id = p.session_id), '[]'::jsonb),
    'bids', coalesce((select jsonb_agg(jsonb_build_object(
        'team_code', t.code, 'amount', b.amount, 'player_name', r.name, 'created_at', b.created_at
      ) order by b.created_at desc)
      from public.auction_bids b
      join public.teams t on t.id = b.team_id
      join public.registrations r on r.id = b.player_id
      join s on s.id = b.session_id), '[]'::jsonb),
    'results', coalesce((select jsonb_agg(jsonb_build_object(
        'player_name', r.name, 'photo_url', r.photo_url, 'player_type', r.player_type,
        'team_code', t.code, 'sold_price', ar.sold_price, 'status', ar.status, 'lot_order', ar.lot_order
      ) order by ar.lot_order)
      from public.auction_results ar
      join public.registrations r on r.id = ar.player_id
      left join public.teams t on t.id = ar.sold_to_team_id
      join s on s.id = ar.session_id
      where ar.status in ('sold', 'unsold')), '[]'::jsonb)
  )
  where public.is_admin();
$$;

revoke all on function public.admin_auction_state() from public;
grant execute on function public.admin_auction_state() to authenticated;

-- Start a session: closes any live one, seeds purses + lot queue (unassigned players only).
drop function if exists public.admin_auction_start_session(text, integer, integer);
create or replace function public.admin_auction_start_session(p_name text, p_purse integer, p_increment integer)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_session uuid;
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  update public.auction_sessions set status = 'ended', ended_at = now(), updated_at = now() where status = 'live';
  insert into public.auction_sessions (name, status, purse_budget, increment, started_at)
  values (coalesce(nullif(p_name, ''), 'DPL 2026 AUCTION'), 'live', greatest(coalesce(p_purse, 5000000), 0), greatest(coalesce(p_increment, 100000), 0), now())
  returning id into v_session;
  insert into public.auction_purses (session_id, team_id, budget)
  select v_session, t.id, greatest(coalesce(p_purse, 5000000), 0)
  from public.teams t;
  insert into public.auction_results (session_id, player_id, lot_order)
  select v_session, r.id, row_number() over (order by r.created_at)
  from public.registrations r
  where not exists (select 1 from public.team_players tp where tp.player_id = r.id);
  return v_session;
end;
$$;

revoke all on function public.admin_auction_start_session(text, integer, integer) from public;
grant execute on function public.admin_auction_start_session(text, integer, integer) to authenticated;

-- Edit a session (name / purse / increment / status). Adjusts purses when budget changes.
drop function if exists public.admin_auction_update_session(uuid, text, integer, integer, text);
create or replace function public.admin_auction_update_session(v_session uuid, p_name text, p_purse integer, p_increment integer, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  update public.auction_sessions s set
    name = coalesce(nullif(p_name, ''), s.name),
    purse_budget = coalesce(p_purse, s.purse_budget),
    increment = coalesce(p_increment, s.increment),
    status = coalesce(nullif(p_status, ''), s.status),
    started_at = case when s.status = 'draft' and coalesce(nullif(p_status, ''), s.status) = 'live' then now() else s.started_at end,
    ended_at = case when coalesce(nullif(p_status, ''), s.status) = 'ended' then now() else null end,
    updated_at = now()
  where s.id = v_session;
  if p_purse is not null then
    update public.auction_purses set budget = greatest(p_purse, 0) where session_id = v_session;
  end if;
end;
$$;

revoke all on function public.admin_auction_update_session(uuid, text, integer, integer, text) from public;
grant execute on function public.admin_auction_update_session(uuid, text, integer, integer, text) to authenticated;

-- End a session.
drop function if exists public.admin_auction_end_session(uuid);
create or replace function public.admin_auction_end_session(v_session uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  update public.auction_sessions set status = 'ended', ended_at = now(), updated_at = now() where id = v_session;
  update public.auction_results set status = 'pool', updated_at = now()
    where session_id = v_session and status = 'on_auction';
end;
$$;

revoke all on function public.admin_auction_end_session(uuid) from public;
grant execute on function public.admin_auction_end_session(uuid) to authenticated;

-- Set a player's base price in the live session.
drop function if exists public.admin_auction_set_base(uuid, integer);
create or replace function public.admin_auction_set_base(v_player uuid, p_base integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  update public.auction_results ar set base_price = greatest(coalesce(p_base, 0), 0), updated_at = now()
  where ar.player_id = v_player
    and ar.session_id = (select id from public.auction_sessions where status = 'live' order by created_at desc limit 1);
end;
$$;

revoke all on function public.admin_auction_set_base(uuid, integer) from public;
grant execute on function public.admin_auction_set_base(uuid, integer) to authenticated;

-- Put a player on the auction stage (closes the previous on-auction player, clears its bids).
drop function if exists public.admin_auction_open(uuid);
create or replace function public.admin_auction_open(v_player uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_session uuid;
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  select id into v_session from public.auction_sessions where status = 'live' order by created_at desc limit 1;
  if v_session is null then raise exception 'no live auction session'; end if;
  delete from public.auction_bids b
    using public.auction_results ar
    where ar.session_id = v_session
      and ar.status = 'on_auction'
      and b.session_id = v_session
      and b.player_id = ar.player_id;
  update public.auction_results set status = 'pool', updated_at = now()
    where session_id = v_session and status = 'on_auction';
  update public.auction_results set status = 'on_auction', updated_at = now()
    where session_id = v_session and player_id = v_player;
end;
$$;

revoke all on function public.admin_auction_open(uuid) from public;
grant execute on function public.admin_auction_open(uuid) to authenticated;

-- Record a bid on the current player (must exceed the current price).
drop function if exists public.admin_auction_bid(uuid, integer);
create or replace function public.admin_auction_bid(v_team uuid, p_amount integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_session uuid; v_player uuid; v_floor integer;
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  select id into v_session from public.auction_sessions where status = 'live' order by created_at desc limit 1;
  if v_session is null then raise exception 'no live auction session'; end if;
  select player_id into v_player from public.auction_results
    where session_id = v_session and status = 'on_auction' limit 1;
  if v_player is null then raise exception 'no player is on auction'; end if;
  select greatest(coalesce(max(amount), base_price), 0) into v_floor
    from public.auction_results ar
    left join public.auction_bids b on b.session_id = ar.session_id and b.player_id = ar.player_id
    where ar.session_id = v_session and ar.player_id = v_player
    group by ar.base_price;
  if coalesce(p_amount, 0) <= v_floor then
    raise exception 'bid must exceed the current price';
  end if;
  insert into public.auction_bids (session_id, player_id, team_id, amount)
  values (v_session, v_player, v_team, p_amount);
end;
$$;

revoke all on function public.admin_auction_bid(uuid, integer) from public;
grant execute on function public.admin_auction_bid(uuid, integer) to authenticated;

-- Sell the current player to a team (budget + squad size enforced here).
drop function if exists public.admin_auction_sell(uuid, uuid, integer);
create or replace function public.admin_auction_sell(v_player uuid, v_team uuid, p_price integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_session uuid; v_base integer; v_budget integer; v_spent integer; v_squad integer;
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  select id into v_session from public.auction_sessions where status = 'live' order by created_at desc limit 1;
  if v_session is null then raise exception 'no live auction session'; end if;
  select base_price into v_base from public.auction_results
    where session_id = v_session and player_id = v_player and status = 'on_auction';
  if v_base is null then raise exception 'player is not on auction'; end if;
  if p_price < v_base then raise exception 'price is below the base price'; end if;
  select budget into v_budget from public.auction_purses where session_id = v_session and team_id = v_team;
  if v_budget is null then raise exception 'team is not part of this session'; end if;
  select coalesce(sum(sold_price), 0) into v_spent from public.auction_results
    where session_id = v_session and sold_to_team_id = v_team and status = 'sold';
  if p_price > v_budget - v_spent then raise exception 'team budget exceeded'; end if;
  select count(*) into v_squad from public.team_players where team_id = v_team;
  if v_squad >= 11 then raise exception 'squad is full (11 players)'; end if;
  insert into public.team_players (team_id, player_id, role)
  values (v_team, v_player, 'player')
  on conflict (team_id, player_id) do update set role = 'player';
  update public.auction_results set
    status = 'sold', sold_to_team_id = v_team, sold_price = p_price, updated_at = now()
  where session_id = v_session and player_id = v_player;
end;
$$;

revoke all on function public.admin_auction_sell(uuid, uuid, integer) from public;
grant execute on function public.admin_auction_sell(uuid, uuid, integer) to authenticated;

-- Mark the current player unsold.
drop function if exists public.admin_auction_unsold(uuid);
create or replace function public.admin_auction_unsold(v_player uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  update public.auction_results set status = 'unsold', updated_at = now()
  where player_id = v_player
    and session_id = (select id from public.auction_sessions where status = 'live' order by created_at desc limit 1);
end;
$$;

revoke all on function public.admin_auction_unsold(uuid) from public;
grant execute on function public.admin_auction_unsold(uuid) to authenticated;

-- Undo a sale: back to pool, team mapping removed, bid trail cleared.
drop function if exists public.admin_auction_undo(uuid);
create or replace function public.admin_auction_undo(v_player uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_session uuid;
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  select id into v_session from public.auction_sessions where status = 'live' order by created_at desc limit 1;
  delete from public.team_players where player_id = v_player;
  delete from public.auction_bids where player_id = v_player and session_id = v_session;
  update public.auction_results set
    status = 'pool', sold_to_team_id = null, sold_price = null, updated_at = now()
  where player_id = v_player and session_id = v_session;
end;
$$;

revoke all on function public.admin_auction_undo(uuid) from public;
grant execute on function public.admin_auction_undo(uuid) to authenticated;

-- Reset a session entirely (used for dry runs): clears lots, bids, purses and
-- any team mappings created through that session, back to draft.
drop function if exists public.admin_auction_reset_session(uuid);
create or replace function public.admin_auction_reset_session(v_session uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'not authorized'; end if;
  delete from public.team_players tp
    where tp.player_id in (
      select player_id from public.auction_results where session_id = v_session
    );
  delete from public.auction_bids where session_id = v_session;
  delete from public.auction_purses where session_id = v_session;
  delete from public.auction_results where session_id = v_session;
  update public.auction_sessions set
    status = 'draft', started_at = null, ended_at = null, updated_at = now()
  where id = v_session;
end;
$$;

revoke all on function public.admin_auction_reset_session(uuid) from public;
grant execute on function public.admin_auction_reset_session(uuid) to authenticated;
