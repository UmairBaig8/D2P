-- DPL 2026: 10 teams, two groups of five, three league matches per team.
-- Group A: GM, DMM, DY, BB, SM. Group B: DD, DDH, DSK, CW, DT.
-- Seven in-group fixtures per group plus one cross-group derby (M1 DY vs DSK).
-- Top two from each group progress to two semifinals and the final.
-- NOTE: the canonical schedule lives in 20260920000001_fixtures_real_schedule.sql.

create table public.fixtures (
  id uuid primary key default gen_random_uuid(),
  match_number integer not null unique check (match_number > 0),
  stage text not null check (stage in ('league', 'semifinal', 'final')),
  group_name text check (group_name in ('A', 'B')),
  home_code text not null,
  away_code text not null,
  home_score integer check (home_score >= 0),
  away_score integer check (away_score >= 0),
  winner_code text,
  match_date date not null,
  match_time time not null,
  venue text not null,
  status text not null default 'upcoming' check (status in ('upcoming', 'live', 'completed', 'postponed')),
  sort_order integer not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (home_code <> away_code)
);

create index fixtures_date_order_idx on public.fixtures (match_date, sort_order);
create index fixtures_stage_idx on public.fixtures (stage);

alter table public.fixtures enable row level security;
create policy "Anyone can read fixtures"
  on public.fixtures for select to anon, authenticated using (true);

-- Day 1 (Oct 7): ten league matches. Day 2 (Oct 8): five league + playoffs.
insert into public.fixtures (match_number, stage, group_name, home_code, away_code, match_date, match_time, venue, sort_order) values
  (1,  'league',    null, 'DY',  'DSK', '2026-10-07', '08:00', 'DPL Arena', 1),
  (2,  'league',    'A',  'GM',  'DMM', '2026-10-07', '08:30', 'DPL Arena', 2),
  (3,  'league',    'B',  'DD',  'DDH', '2026-10-07', '09:00', 'DPL Arena', 3),
  (4,  'league',    'A',  'SM',  'DY',  '2026-10-07', '09:30', 'DPL Arena', 4),
  (5,  'league',    'B',  'DSK', 'DT',  '2026-10-07', '10:00', 'DPL Arena', 5),
  (6,  'league',    'A',  'BB',  'GM',  '2026-10-07', '10:30', 'DPL Arena', 6),
  (7,  'league',    'B',  'CW',  'DD',  '2026-10-07', '11:00', 'DPL Arena', 7),
  (8,  'league',    'A',  'BB',  'DMM', '2026-10-07', '11:30', 'DPL Arena', 8),
  (9,  'league',    'B',  'CW',  'DDH', '2026-10-07', '12:00', 'DPL Arena', 9),
  (10, 'league',    'A',  'SM',  'DMM', '2026-10-07', '12:30', 'DPL Arena', 10),
  (11, 'league',    'B',  'DDH', 'DT',  '2026-10-08', '08:00', 'DPL Arena', 11),
  (12, 'league',    'A',  'GM',  'DY',  '2026-10-08', '08:30', 'DPL Arena', 12),
  (13, 'league',    'A',  'BB',  'SM',  '2026-10-08', '09:00', 'DPL Arena', 13),
  (14, 'league',    'B',  'DD',  'DSK', '2026-10-08', '09:30', 'DPL Arena', 14),
  (15, 'league',    'B',  'CW',  'DT',  '2026-10-08', '10:00', 'DPL Arena', 15),
  (16, 'semifinal', null, 'A1',  'B2',  '2026-10-08', '10:30', 'DPL Arena', 16),
  (17, 'semifinal', null, 'B1',  'A2',  '2026-10-08', '11:00', 'DPL Arena', 17),
  (18, 'final',     null, 'SF1', 'SF2', '2026-10-08', '11:30', 'DPL Arena', 18);
