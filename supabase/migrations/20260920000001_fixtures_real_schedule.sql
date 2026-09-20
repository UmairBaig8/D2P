-- DPL 2026: real schedule from the official workbook "DPL26 - Pune_18Sep.xlsx"
-- (FINAL DRAWS + Groups sheets). Replaces the earlier placeholder seed.
--
-- Structure: 10 teams, two groups of five.
--   Group A: GM, DMM, DY, BB, SM
--   Group B: DD, DDH, DSK, CW, DT
-- League: 7 Group A + 7 Group B + 1 cross-group derby (M1 DY vs DSK) = 15 matches.
-- Each team plays 3 league matches; top two from each group reach the semifinals.
-- Day 1 = 2026-10-07, Day 2 = 2026-10-08. Single ground, 30-minute slots.

delete from public.fixtures;

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
