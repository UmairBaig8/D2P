import { supabase } from './supabase';
import type { TeamRow } from './site';

export type FixtureStage = 'league' | 'semifinal' | 'final';
export type FixtureStatus = 'upcoming' | 'live' | 'completed' | 'postponed';
export type FixtureResultType = 'normal' | 'tie' | 'no_result' | 'abandoned' | 'forfeit';

export type Fixture = {
  id: string;
  match_number: number;
  stage: FixtureStage;
  group_name: 'A' | 'B' | null;
  home_code: string;
  away_code: string;
  home_score: number | null;
  away_score: number | null;
  home_overs: number | null;
  away_overs: number | null;
  winner_code: string | null;
  match_date: string;
  match_time: string;
  venue: string;
  status: FixtureStatus;
  result_type: FixtureResultType;
  points_home: number | null;
  points_away: number | null;
  note: string | null;
  published: boolean;
  locked: boolean;
  pinned: boolean;
  player_of_match: string | null;
  sort_order: number;
};

export type FixtureConfig = {
  points_win: number;
  points_tie: number;
  points_no_result: number;
  overs_per_innings: number;
};

export const DEFAULT_FIXTURE_CONFIG: FixtureConfig = { points_win: 2, points_tie: 1, points_no_result: 1, overs_per_innings: 5 };

export type Standing = { team: TeamRow; played: number; won: number; lost: number; tied: number; points: number; nrr: number };

export async function fetchFixtures(): Promise<{ data: Fixture[]; error?: string }> {
  if (!supabase) return { data: [], error: 'Supabase is not configured.' };
  const { data, error } = await supabase.from('fixtures').select('*').order('sort_order');
  return error ? { data: [], error: error.message } : { data: data as Fixture[] };
}

export async function fetchFixtureConfig(): Promise<FixtureConfig> {
  if (!supabase) return DEFAULT_FIXTURE_CONFIG;
  const { data, error } = await supabase.from('settings')
    .select('points_win, points_tie, points_no_result, overs_per_innings').eq('id', 1).single();
  if (error || !data) return DEFAULT_FIXTURE_CONFIG;
  return { ...DEFAULT_FIXTURE_CONFIG, ...(data as Partial<FixtureConfig>) };
}

// League table with net run rate. Points honour per-match overrides, then the
// configured win/tie/no-result values.
export function computeStandings(fixtures: Fixture[], teams: TeamRow[], codes: string[], config: FixtureConfig): Standing[] {
  type Row = { team: TeamRow | undefined; played: number; won: number; lost: number; tied: number; points: number; runsFor: number; ballsFor: number; runsAgainst: number; ballsAgainst: number; nrr: number };
  const teamMap = new Map(teams.map((t) => [t.code, t]));
  const table = new Map<string, Row>(codes.map((code) => [code, { team: teamMap.get(code), played: 0, won: 0, lost: 0, tied: 0, points: 0, runsFor: 0, ballsFor: 0, runsAgainst: 0, ballsAgainst: 0, nrr: 0 }]));

  fixtures.filter((f) => f.stage === 'league' && f.status === 'completed').forEach((f) => {
    const rows: Array<[string, number | null, number | null, number | null, number | null]> = [
      [f.home_code, f.home_score, f.away_score, f.home_overs, f.away_overs],
      [f.away_code, f.away_score, f.home_score, f.away_overs, f.home_overs],
    ];
    rows.forEach(([code, scored, conceded, oversFor, oversAgainst]) => {
      const entry = table.get(code);
      if (!entry) return;
      entry.played += 1;
      if (scored != null) { entry.runsFor += scored; entry.ballsFor += oversToBalls(oversFor) ?? config.overs_per_innings * 6; }
      if (conceded != null) { entry.runsAgainst += conceded; entry.ballsAgainst += oversToBalls(oversAgainst) ?? config.overs_per_innings * 6; }
      const override = code === f.home_code ? f.points_home : f.points_away;
      if (f.result_type === 'tie') { entry.tied += 1; entry.points += override ?? config.points_tie; }
      else if (f.result_type === 'no_result' || f.result_type === 'abandoned') { entry.tied += 1; entry.points += override ?? config.points_no_result; }
      else if (f.winner_code === code) { entry.won += 1; entry.points += override ?? config.points_win; }
      else if (f.winner_code) { entry.lost += 1; }
      else { entry.tied += 1; entry.points += override ?? config.points_tie; }
    });
  });

  table.forEach((entry) => {
    const rrFor = entry.ballsFor > 0 ? entry.runsFor / (entry.ballsFor / 6) : 0;
    const rrAgainst = entry.ballsAgainst > 0 ? entry.runsAgainst / (entry.ballsAgainst / 6) : 0;
    entry.nrr = Number((rrFor - rrAgainst).toFixed(3));
  });

  return [...table.values()]
    .filter((e): e is Row & { team: TeamRow } => Boolean(e.team))
    .sort((a, b) => b.points - a.points || b.nrr - a.nrr || a.team.sort_order - b.team.sort_order)
    .map(({ team, played, won, lost, tied, points, nrr }): Standing => ({ team, played, won, lost, tied, points, nrr }));
}

export function formatFixtureTime(value: string): string {
  const [hour = 0, minute = 0] = value.split(':').map(Number);
  const suffix = hour >= 12 ? 'PM' : 'AM';
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${suffix}`;
}

export function formatFixtureDate(value: string): string {
  return new Date(`${value}T00:00:00`).toLocaleDateString('en-IN', {
    weekday: 'short', month: 'short', day: 'numeric',
  });
}

export function oversText(value: number | null): string {
  return value == null ? '—' : value.toFixed(1);
}

// Cricket notation (4.3 = 4 overs 3 balls) -> legal balls.
export function oversToBalls(value: number | null): number | null {
  if (value == null) return null;
  const whole = Math.floor(value);
  return whole * 6 + Math.round((value - whole) * 10);
}

// ---------- Admin ----------

export async function adminFixtureUpdate(matchNumber: number, patch: Record<string, unknown>): Promise<{ error?: string }> {
  if (!supabase) return { error: 'Supabase is not configured.' };
  const { error } = await supabase.rpc('admin_fixture_update', { p_match_number: matchNumber, p_patch: patch });
  return error ? { error: error.message } : {};
}

export async function adminFixtureReorder(order: number[]): Promise<{ error?: string }> {
  if (!supabase) return { error: 'Supabase is not configured.' };
  const { error } = await supabase.rpc('admin_fixture_reorder', { p_order: order });
  return error ? { error: error.message } : {};
}

export async function adminFixtureCreate(input: {
  stage: FixtureStage; group: 'A' | 'B' | null; home: string; away: string;
  date: string; time: string; venue: string;
}): Promise<{ error?: string; matchNumber?: number }> {
  if (!supabase) return { error: 'Supabase is not configured.' };
  const { data, error } = await supabase.rpc('admin_fixture_create', {
    p_stage: input.stage, p_group: input.group, p_home: input.home, p_away: input.away,
    p_match_date: input.date, p_match_time: input.time, p_venue: input.venue,
  });
  return error ? { error: error.message } : { matchNumber: data as number };
}

export async function adminFixtureDelete(matchNumber: number): Promise<{ error?: string }> {
  if (!supabase) return { error: 'Supabase is not configured.' };
  const { error } = await supabase.rpc('admin_fixture_delete', { p_match_number: matchNumber });
  return error ? { error: error.message } : {};
}

export async function adminFixtureReset(matchNumber: number): Promise<{ error?: string }> {
  if (!supabase) return { error: 'Supabase is not configured.' };
  const { error } = await supabase.rpc('admin_fixture_reset', { p_match_number: matchNumber });
  return error ? { error: error.message } : {};
}

export async function adminFixtureBulkStatus(matches: number[], status: FixtureStatus): Promise<{ error?: string }> {
  if (!supabase) return { error: 'Supabase is not configured.' };
  const { error } = await supabase.rpc('admin_fixture_bulk_status', { p_matches: matches, p_status: status });
  return error ? { error: error.message } : {};
}

export type FixtureHistoryRow = {
  id: number; action: string; actor_email: string | null; created_at: string;
  status: string | null; home_code: string | null; away_code: string | null;
  home_score: number | null; away_score: number | null; winner_code: string | null;
};

export async function fetchFixtureHistory(matchNumber: number): Promise<FixtureHistoryRow[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc('admin_fixture_history', { p_match_number: matchNumber, p_limit: 30 });
  return error ? [] : (data as FixtureHistoryRow[]);
}

export async function adminFixtureRestore(historyId: number): Promise<{ error?: string }> {
  if (!supabase) return { error: 'Supabase is not configured.' };
  const { error } = await supabase.rpc('admin_fixture_restore', { p_history_id: historyId });
  return error ? { error: error.message } : {};
}

// ---------- Ball-by-ball scoring ----------

export type MatchInnings = {
  match_number: number; innings: number; batting_code: string; bowling_code: string; closed: boolean;
  opener1_id: string | null; opener2_id: string | null; striker_id: string | null;
  non_striker_id: string | null; current_bowler_id: string | null; free_hit: boolean;
};
export type ScorecardInnings = { innings: number; batting_code: string; bowling_code: string; closed: boolean; runs: number; wickets: number; balls: number; overs: number };
export type ScorecardBatting = { innings: number; id: string; name: string; runs: number; balls: number; out: boolean };
export type ScorecardBowling = { innings: number; id: string; name: string; balls: number; runs: number; wickets: number };
export type ScorecardBall = { innings: number; seq: number; runs: number; extra: string | null; is_wicket: boolean; wicket_type: string | null; free_hit: boolean; batter: string | null };
export type ScorecardPartnership = { innings: number; b1: string | null; b2: string | null; runs: number };
export type MatchScorecard = { innings: ScorecardInnings[]; batting: ScorecardBatting[]; bowling: ScorecardBowling[]; commentary: ScorecardBall[]; partnerships: ScorecardPartnership[] };
export type MatchBall = { ball_seq: number; bat_runs: number; extra: string | null; is_wicket: boolean; wicket_type: string | null; free_hit: boolean; batter: string | null; bowler: string | null };
export type WicketType = 'bowled' | 'caught' | 'run_out' | 'stumped' | 'hit_wicket' | 'mankad' | 'other';

export async function fetchInnings(matchNumber: number): Promise<MatchInnings[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from('match_innings').select('*').eq('match_number', matchNumber).order('innings');
  return error ? [] : (data as MatchInnings[]);
}

export async function fetchMatchScorecard(matchNumber: number): Promise<MatchScorecard | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('match_scorecard', { p_match_number: matchNumber });
  return error ? null : (data as MatchScorecard);
}

export async function adminInningsSetup(matchNumber: number, battingFirst: string): Promise<{ error?: string }> {
  if (!supabase) return { error: 'Supabase is not configured.' };
  const { error } = await supabase.rpc('admin_innings_setup', { p_match_number: matchNumber, p_batting_first: battingFirst });
  return error ? { error: error.message } : {};
}

export async function adminBallAdd(matchNumber: number, innings: number, ball: {
  batRuns: number; extra: string | null; isWicket: boolean; wicketType: WicketType | null; bowlerId: string | null;
  fielderId?: string | null; fieldingNote?: string | null;
}): Promise<{ error?: string }> {
  if (!supabase) return { error: 'Supabase is not configured.' };
  const { error } = await supabase.rpc('admin_ball_add', {
    p_match_number: matchNumber, p_innings: innings, p_bat_runs: ball.batRuns,
    p_extra: ball.extra, p_is_wicket: ball.isWicket, p_wicket_type: ball.wicketType, p_bowler_id: ball.bowlerId,
    p_fielder_id: ball.fielderId ?? null, p_fielding_note: ball.fieldingNote ?? null,
  });
  return error ? { error: error.message } : {};
}

export async function adminInningsSetStrike(matchNumber: number, innings: number, opener1: string, opener2: string): Promise<{ error?: string }> {
  if (!supabase) return { error: 'Supabase is not configured.' };
  const { error } = await supabase.rpc('admin_innings_set_strike', { p_match_number: matchNumber, p_innings: innings, p_opener1: opener1, p_opener2: opener2 });
  return error ? { error: error.message } : {};
}

export async function adminInningsSetBatter(matchNumber: number, innings: number, striker: string, nonStriker: string | null): Promise<{ error?: string }> {
  if (!supabase) return { error: 'Supabase is not configured.' };
  const { error } = await supabase.rpc('admin_innings_set_batter', { p_match_number: matchNumber, p_innings: innings, p_striker: striker, p_non_striker: nonStriker });
  return error ? { error: error.message } : {};
}

export async function fetchBallsList(matchNumber: number, innings: number): Promise<MatchBall[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc('match_balls_list', { p_match_number: matchNumber, p_innings: innings });
  return error ? [] : (data as MatchBall[]);
}

// ---------- Live centre ----------

export type LiveInnings = { innings: number; batting_code: string; runs: number; wickets: number; balls: number; overs: number; closed: boolean };
export type LiveRecent = { seq: number; runs: number; extra: string | null; is_wicket: boolean; wicket_type: string | null; free_hit: boolean; batter: string | null };
export type LiveCurrent = {
  innings: number; batting_code: string; bowling_code: string; runs: number; balls: number; free_hit: boolean;
  striker: string | null; non_striker: string | null; bowler: string | null;
  run_rate: number | null; target: number | null; required: number | null; balls_left: number;
};
export type LiveDetail = { home_code: string; away_code: string; status: FixtureStatus; innings: LiveInnings[]; current: LiveCurrent | null; recent: LiveRecent[] };

export async function fetchLiveDetail(matchNumber: number): Promise<LiveDetail | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('live_detail', { p_match_number: matchNumber });
  return error ? null : (data as LiveDetail);
}

// ---------- Leaderboard ----------

export type LeaderboardBatting = { id: string; name: string; team: string | null; innings: number; runs: number; balls: number; sr: number | null; fours: number; sixes: number; hs: number };
export type LeaderboardBowling = { id: string; name: string; team: string | null; innings: number; balls: number; runs: number; wickets: number; dots: number; economy: number | null; best: string | null };
export type LeaderboardFielding = { id: string; name: string; team: string | null; catches: number; run_outs: number; stumpings: number; total: number };
export type LeaderboardTeam = { code: string; name: string | null; innings: number; total_runs: number; highest: number };
export type LeaderboardPom = { id: string; name: string; team: string | null; awards: number };
export type Leaderboard = { batting: LeaderboardBatting[]; bowling: LeaderboardBowling[]; fielding: LeaderboardFielding[]; pom: LeaderboardPom[]; teams: LeaderboardTeam[] };

export async function fetchLeaderboard(): Promise<Leaderboard | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('leaderboard');
  return error ? null : (data as Leaderboard);
}

export type MatchTiming = { match_number: number; started_at: string; ended_at: string; minutes: number; allotted_minutes: number; within_slot: boolean };

export async function fetchFixturesTiming(): Promise<MatchTiming[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc('fixtures_timing');
  return error ? [] : (data as MatchTiming[]);
}

export type MatchPom = { auto_id: string | null; auto_name: string | null; auto_points: number | null; chosen_id: string | null; chosen_name: string | null; is_auto: boolean };

export async function fetchMatchPom(matchNumber: number): Promise<MatchPom | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('match_pom', { p_match_number: matchNumber });
  return error ? null : (data as MatchPom);
}

export async function fetchFixturePom(): Promise<Record<number, string>> {
  if (!supabase) return {};
  const { data, error } = await supabase.rpc('fixture_pom');
  if (error || !data) return {};
  return Object.fromEntries((data as { match_number: number; name: string }[]).map((r) => [r.match_number, r.name]));
}

export type PublicFlags = { leaderboard_public: boolean; match_timing_public: boolean; fixtures_hold: boolean; leaderboard_hold: boolean };

const DEFAULT_FLAGS: PublicFlags = { leaderboard_public: true, match_timing_public: true, fixtures_hold: false, leaderboard_hold: false };

export async function fetchPublicFlags(): Promise<PublicFlags> {
  if (!supabase) return DEFAULT_FLAGS;
  const { data, error } = await supabase.from('settings')
    .select('leaderboard_public, match_timing_public, fixtures_hold, leaderboard_hold').eq('id', 1).single();
  if (error || !data) return DEFAULT_FLAGS;
  return {
    leaderboard_public: data.leaderboard_public !== false,
    match_timing_public: data.match_timing_public !== false,
    fixtures_hold: data.fixtures_hold === true,
    leaderboard_hold: data.leaderboard_hold === true,
  };
}

export async function adminBallUndo(matchNumber: number, innings: number): Promise<{ error?: string }> {
  if (!supabase) return { error: 'Supabase is not configured.' };
  const { error } = await supabase.rpc('admin_ball_undo', { p_match_number: matchNumber, p_innings: innings });
  return error ? { error: error.message } : {};
}

export async function adminInningsClose(matchNumber: number, innings: number): Promise<{ error?: string }> {
  if (!supabase) return { error: 'Supabase is not configured.' };
  const { error } = await supabase.rpc('admin_innings_close', { p_match_number: matchNumber, p_innings: innings });
  return error ? { error: error.message } : {};
}

export async function adminInningsReopen(matchNumber: number, innings: number): Promise<{ error?: string }> {
  if (!supabase) return { error: 'Supabase is not configured.' };
  const { error } = await supabase.rpc('admin_innings_reopen', { p_match_number: matchNumber, p_innings: innings });
  return error ? { error: error.message } : {};
}
