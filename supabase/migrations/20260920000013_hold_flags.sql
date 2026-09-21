-- Tournament dates on hold: let admins put Fixtures and Leaderboard into a
-- friendly "on hold" state without deleting anything.

alter table public.settings
  add column if not exists fixtures_hold    boolean not null default false,
  add column if not exists leaderboard_hold boolean not null default false;
