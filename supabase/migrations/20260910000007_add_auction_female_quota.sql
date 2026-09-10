-- Each team must end the auction with at least N female players (default 2).
alter table public.settings
  add column if not exists auction_female_quota integer default 2;
