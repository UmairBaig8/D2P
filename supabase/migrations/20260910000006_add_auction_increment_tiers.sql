-- Tiered bid increments (editable from AUCTION SETTINGS).
-- Default bands: up to 100 → +10, up to 200 → +20, above 200 → +50.
alter table public.settings
  add column if not exists auction_inc_tier1_max integer default 100,
  add column if not exists auction_inc_tier1 integer default 10,
  add column if not exists auction_inc_tier2_max integer default 200,
  add column if not exists auction_inc_tier2 integer default 20,
  add column if not exists auction_inc_tier3 integer default 50;
