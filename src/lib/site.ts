import { supabase } from './supabase';
import { getVisitorId } from './analytics';
import type { SiteSettings, Team } from '../types';

export async function fetchSiteSettings(): Promise<SiteSettings | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.from('settings').select('*').single();
  return error ? null : (data as SiteSettings);
}

export async function fetchTeams(): Promise<Team[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from('teams').select('*').order('sort_order');
  return error ? [] : (data as Team[]);
}

export async function fetchRegistrationsCount(): Promise<number | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('registrations_count');
  return error ? null : (data as number);
}

export type RecentPlayer = { id: string; name: string; photo_url: string | null };

export async function fetchRecentPlayers(limitCount = 5): Promise<RecentPlayer[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc('recent_registrations', { limit_count: limitCount });
  return error ? [] : (data as RecentPlayer[]);
}

export type PlayerCard = {
  id: string;
  name: string;
  photo_url: string | null;
  player_type: string;
  location: string;
  created_at: string;
};

export async function fetchPlayerCards(limitCount = 8): Promise<PlayerCard[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc('player_cards', { limit_count: limitCount });
  return error ? [] : (data as PlayerCard[]);
}

export type AuctionPlayer = {
  id: string;
  name: string;
  employee_id: string;
  photo_url: string | null;
  player_type: string;
  gender: string;
  location: string;
  dpl_played: boolean;
  self_rating: number;
  availability: string;
  batting_style: string;
  bowling_style: string;
  created_at: string;
};

export async function fetchAuctionPlayers(): Promise<AuctionPlayer[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc('auction_players');
  return error ? [] : (data as AuctionPlayer[]);
}

export type TeamRow = {
  id: string;
  name: string;
  code: string;
  icon_url: string;
  theme: string;
  owner: string | null;
  captain: string | null;
  champion: boolean;
  player_count: number;
  sort_order: number;
};

export async function fetchTeamsList(): Promise<TeamRow[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc('teams_list');
  return error ? [] : (data as TeamRow[]);
}

export type TeamRosterPlayer = {
  id: string;
  name: string;
  photo_url: string | null;
  player_type: string;
  location: string;
  dpl_played: boolean;
  role: string;
};

export async function fetchTeamRoster(teamCode: string): Promise<TeamRosterPlayer[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc('team_roster', { team_code: teamCode });
  return error ? [] : (data as TeamRosterPlayer[]);
}

export type PublicPlayer = {
  id: string;
  name: string;
  photo_url: string | null;
  player_type: string;
  gender: string;
  location: string;
  batting_style: string | null;
  bowling_style: string | null;
  bowling_arm: string | null;
  availability: string | null;
  self_rating: number | null;
  dpl_played: boolean;
  jersey_size: string | null;
  created_at: string;
};

export async function fetchPlayersList(): Promise<PublicPlayer[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc('players_list');
  return error ? [] : (data as PublicPlayer[]);
}

export type EditRequest = {
  id: string;
  player_id: string;
  player_name: string;
  changes: Record<string, unknown>;
  status: 'pending' | 'approved' | 'rejected';
  admin_note: string | null;
  created_at: string;
  reviewed_at: string | null;
};

export async function submitPlayerEdit(playerId: string, playerName: string, changes: Record<string, unknown>): Promise<{ error?: string }> {
  if (!supabase) return { error: 'Supabase is not configured.' };
  const { error } = await supabase.from('player_edit_requests').insert({ player_id: playerId, player_name: playerName, changes, visitor_id: getVisitorId() });
  if (error) return { error: error.message };
  return {};
}

export async function fetchPendingEdits(): Promise<EditRequest[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from('player_edit_requests').select('*').eq('status', 'pending').order('created_at', { ascending: false });
  return error ? [] : (data as EditRequest[]);
}

export async function reviewPlayerEdit(requestId: string, decision: 'approved' | 'rejected', note?: string | null): Promise<{ error?: string }> {
  if (!supabase) return { error: 'Supabase is not configured.' };
  const { data: request, error: fetchError } = await supabase.from('player_edit_requests').select('*').eq('id', requestId).single();
  if (fetchError || !request) return { error: fetchError?.message ?? 'Request not found.' };
  if (decision === 'approved') {
    const apply = await adminUpdatePlayer(request.player_id, request.changes as Parameters<typeof adminUpdatePlayer>[1]);
    if (apply.error) return apply;
  }
  const { error } = await supabase.from('player_edit_requests')
    .update({ status: decision, admin_note: note ?? null, reviewed_at: new Date().toISOString() })
    .eq('id', requestId);
  if (error) return { error: error.message };
  void logAudit(`edit.${decision}`, request.player_id, { request_id: requestId, note: note ?? null });
  return {};
}

// ---------- Admin ----------

export async function logAudit(action: string, targetId: string | null, detail?: Record<string, unknown>) {
  if (!supabase) return;
  const { data } = await supabase.auth.getUser();
  const actorEmail = data.user?.email ?? null;
  if (!actorEmail) return;
  await supabase.from('admin_audit').insert({ actor_email: actorEmail, action, target_id: targetId, detail: detail ?? null });
}

export type AdminPlayer = {
  id: string;
  name: string;
  email: string;
  employee_id: string | null;
  photo_url: string | null;
  player_type: string;
  gender: string;
  location: string;
  dpl_played: boolean;
  self_rating: number;
  batting_style: string | null;
  bowling_style: string | null;
  bowling_arm: string | null;
  availability: string | null;
  jersey_size: string | null;
  created_at: string;
  team_id: string | null;
  team_code: string | null;
  role: string | null;
};

export async function fetchAdminPlayers(): Promise<AdminPlayer[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc('admin_players');
  return error ? [] : (data as AdminPlayer[]);
}

export type AdminTeam = {
  id: string;
  name: string;
  icon: string;
  code: string | null;
  icon_url: string;
  theme: string;
  owner: string | null;
  captain: string | null;
  champion: boolean;
  sort_order: number;
};

export async function fetchAdminTeams(): Promise<AdminTeam[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc('admin_teams');
  return error ? [] : (data as AdminTeam[]);
}

export async function isCurrentUserAdmin(): Promise<boolean> {
  if (!supabase) return false;
  const { data, error } = await supabase.rpc('is_admin');
  return !error && data === true;
}

export async function getCurrentUserEmail(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  return data.user?.email ?? null;
}

export async function signInAdmin(email: string, password: string): Promise<{ error?: string }> {
  if (!supabase) return { error: 'Supabase is not configured.' };
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return error ? { error: error.message } : {};
}

export async function signOutAdmin(): Promise<void> {
  if (!supabase) return;
  await supabase.auth.signOut();
}

export async function adminSaveSettings(patch: {
  registration_open?: string | null;
  registration_deadline?: string | null;
  player_capacity?: number;
  total_teams?: number;
  total_matches?: number;
  champion?: string | null;
}): Promise<{ error?: string }> {
  if (!supabase) return { error: 'Supabase is not configured.' };
  const { error } = await supabase.from('settings').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', 1);
  return error ? { error: error.message } : {};
}

export async function adminUpsertTeam(team: {
  id?: string;
  name: string;
  code: string;
  icon_url: string;
  theme: string;
  owner: string;
  captain: string;
  champion: boolean;
  sort_order: number;
}): Promise<{ error?: string }> {
  if (!supabase) return { error: 'Supabase is not configured.' };
  const { error } = team.id
    ? await supabase.from('teams').update(team).eq('id', team.id)
    : await supabase.from('teams').insert(team);
  if (error) return { error: error.message };
  void logAudit(team.id ? 'team.update' : 'team.add', team.id ?? null, { name: team.name, code: team.code });
  return {};
}

export async function adminDeleteTeam(id: string): Promise<{ error?: string }> {
  if (!supabase) return { error: 'Supabase is not configured.' };
  const { error } = await supabase.from('teams').delete().eq('id', id);
  if (error) return { error: error.message };
  void logAudit('team.delete', id, {});
  return {};
}

export async function adminAssignPlayer(playerId: string, teamId: string, role: string): Promise<{ error?: string }> {
  if (!supabase) return { error: 'Supabase is not configured.' };
  const { error } = await supabase.from('team_players').upsert(
    { team_id: teamId, player_id: playerId, role },
    { onConflict: 'team_id,player_id' },
  );
  if (error) return { error: error.message };
  void logAudit('player.assign', playerId, { team_id: teamId, role });
  return {};
}

export async function adminRemovePlayerFromTeam(playerId: string): Promise<{ error?: string }> {
  if (!supabase) return { error: 'Supabase is not configured.' };
  const { error } = await supabase.from('team_players').delete().eq('player_id', playerId);
  if (error) return { error: error.message };
  void logAudit('player.unassign', playerId, {});
  return {};
}

export async function adminAddPlayer(player: {
  name: string;
  email: string;
  employee_id: string;
  gender?: string | null;
  location?: string | null;
  player_type: string;
  batting_style: string;
  bowling_style: string;
  bowling_arm: string;
  cricket_experience: string;
  jersey_size: string;
  availability: string;
  self_rating?: number;
  dpl_played?: boolean;
  photo_url?: string | null;
}): Promise<{ error?: string }> {
  if (!supabase) return { error: 'Supabase is not configured.' };
  const { error } = await supabase.from('registrations').insert(player);
  if (error) return { error: error.message };
  return {};
}

export async function adminUpdatePlayer(playerId: string, patch: {
  name?: string;
  email?: string;
  employee_id?: string | null;
  location?: string;
  dpl_played?: boolean;
  player_type?: string;
  gender?: string;
  self_rating?: number;
  batting_style?: string | null;
  bowling_style?: string | null;
  bowling_arm?: string | null;
  availability?: string | null;
  photo_url?: string | null;
}): Promise<{ error?: string }> {
  if (!supabase) return { error: 'Supabase is not configured.' };
  const { error } = await supabase.from('registrations').update(patch).eq('id', playerId);
  if (error) return { error: error.message };
  return {};
}

// ---------- Auction ----------

export type AuctionSessionInfo = {
  id: string;
  name: string;
  status: 'draft' | 'live' | 'ended';
  purse_budget: number;
  increment: number;
  lot_timer_seconds: number;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
};

export type AuctionBoardPlayer = {
  player_id: string;
  name: string;
  employee_id: string | null;
  photo_url: string | null;
  player_type: string;
  gender: string;
  location: string;
  dpl_played: boolean;
  self_rating: number;
  availability: string;
  batting_style: string | null;
  bowling_style: string | null;
  lot_order: number;
  base_price: number;
  timer_ends_at: string | null;
};

export type AuctionCurrentBid = {
  team_id: string;
  team_name: string;
  team_code: string;
  team_icon_url: string;
  amount: number;
  created_at: string;
};

export type AuctionBid = { team_code: string; amount: number; created_at: string };

export type AuctionTeamState = {
  team_id: string;
  name: string;
  code: string;
  icon_url: string;
  theme: string;
  budget: number;
  spent: number;
  squad: number;
  sold: number;
};

export type AuctionResultRow = {
  player_name: string;
  photo_url: string | null;
  player_type: string;
  team_code: string | null;
  sold_price: number | null;
  status: string;
  lot_order: number;
};

export type AuctionLiveState = {
  session: AuctionSessionInfo | null;
  current_player: AuctionBoardPlayer | null;
  current_bid: AuctionCurrentBid | null;
  bid_count: number;
  bids: AuctionBid[];
  teams: AuctionTeamState[];
  pool_count: number;
  results: AuctionResultRow[];
  up_next: AuctionUpNext[];
  recent_bids: AuctionRecentBid[];
};

export type AuctionUpNext = {
  player_id: string;
  name: string;
  photo_url: string | null;
  player_type: string;
  lot_order: number;
};

export type AuctionRecentBid = {
  team_code: string;
  amount: number;
  player_name: string;
  created_at: string;
};

export type AdminAuctionPlayer = {
  player_id: string;
  name: string;
  photo_url: string | null;
  employee_id: string | null;
  player_type: string;
  gender: string;
  location: string;
  dpl_played: boolean;
  self_rating: number;
  availability: string;
  lot_order: number;
  base_price: number;
  status: string;
  sold_to_team_id: string | null;
  sold_price: number | null;
  opens_at: string | null;
};

export type AdminAuctionBid = { team_code: string; amount: number; player_name: string; created_at: string };

export type AdminAuctionState = {
  session: AuctionSessionInfo | null;
  current_player: AuctionBoardPlayer | null;
  current_bid: AuctionCurrentBid | null;
  players: AdminAuctionPlayer[];
  teams: AuctionTeamState[];
  bids: AdminAuctionBid[];
  results: AuctionResultRow[];
};

export async function fetchAuctionLiveState(): Promise<AuctionLiveState | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('auction_live_state');
  return error ? null : (data as AuctionLiveState);
}

export async function fetchAuctionSessionResults(sessionId: string): Promise<AuctionResultRow[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc('auction_session_results', { session_id: sessionId });
  return error ? [] : (data as AuctionResultRow[]);
}

export async function fetchAdminAuctionState(): Promise<AdminAuctionState | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('admin_auction_state');
  return error ? null : (data as AdminAuctionState);
}

export async function adminAuctionStartSession(name: string, purse: number, increment: number, timer: number): Promise<{ error?: string; sessionId?: string }> {
  if (!supabase) return { error: 'Supabase is not configured.' };
  const { data, error } = await supabase.rpc('admin_auction_start_session', { p_name: name, p_purse: purse, p_increment: increment, p_timer: timer });
  if (error) return { error: error.message };
  void logAudit('auction.start', data as string, { name, purse, increment, timer });
  return { sessionId: data as string };
}

export async function adminAuctionUpdateSession(sessionId: string, patch: { name?: string; purse?: number; increment?: number; timer?: number; status?: string }): Promise<{ error?: string }> {
  if (!supabase) return { error: 'Supabase is not configured.' };
  const { error } = await supabase.rpc('admin_auction_update_session', {
    v_session: sessionId,
    p_name: patch.name ?? null,
    p_purse: patch.purse ?? null,
    p_increment: patch.increment ?? null,
    p_timer: patch.timer ?? null,
    p_status: patch.status ?? null,
  });
  if (error) return { error: error.message };
  void logAudit('auction.update', sessionId, patch);
  return {};
}

export async function adminAuctionEndSession(sessionId: string): Promise<{ error?: string }> {
  if (!supabase) return { error: 'Supabase is not configured.' };
  const { error } = await supabase.rpc('admin_auction_end_session', { v_session: sessionId });
  if (error) return { error: error.message };
  void logAudit('auction.end', sessionId, {});
  return {};
}

export async function adminAuctionResetSession(sessionId: string): Promise<{ error?: string }> {
  if (!supabase) return { error: 'Supabase is not configured.' };
  const { error } = await supabase.rpc('admin_auction_reset_session', { v_session: sessionId });
  if (error) return { error: error.message };
  void logAudit('auction.reset', sessionId, {});
  return {};
}

export async function adminAuctionSetBase(playerId: string, basePrice: number): Promise<{ error?: string }> {
  if (!supabase) return { error: 'Supabase is not configured.' };
  const { error } = await supabase.rpc('admin_auction_set_base', { v_player: playerId, p_base: basePrice });
  return error ? { error: error.message } : {};
}

export async function adminAuctionOpen(playerId: string): Promise<{ error?: string }> {
  if (!supabase) return { error: 'Supabase is not configured.' };
  const { error } = await supabase.rpc('admin_auction_open', { v_player: playerId });
  if (error) return { error: error.message };
  void logAudit('auction.open', playerId, {});
  return {};
}

export async function adminAuctionBid(teamId: string, amount: number): Promise<{ error?: string }> {
  if (!supabase) return { error: 'Supabase is not configured.' };
  const { error } = await supabase.rpc('admin_auction_bid', { v_team: teamId, p_amount: amount });
  if (error) return { error: error.message };
  void logAudit('auction.bid', teamId, { amount });
  return {};
}

export async function adminAuctionSell(playerId: string, teamId: string, price: number): Promise<{ error?: string }> {
  if (!supabase) return { error: 'Supabase is not configured.' };
  const { error } = await supabase.rpc('admin_auction_sell', { v_player: playerId, v_team: teamId, p_price: price });
  if (error) return { error: error.message };
  void logAudit('auction.sell', playerId, { team_id: teamId, price });
  return {};
}

export async function adminAuctionUnsold(playerId: string): Promise<{ error?: string }> {
  if (!supabase) return { error: 'Supabase is not configured.' };
  const { error } = await supabase.rpc('admin_auction_unsold', { v_player: playerId });
  if (error) return { error: error.message };
  void logAudit('auction.unsold', playerId, {});
  return {};
}

export async function adminAuctionExtend(playerId: string, seconds: number): Promise<{ error?: string }> {
  if (!supabase) return { error: 'Supabase is not configured.' };
  const { error } = await supabase.rpc('admin_auction_extend', { v_player: playerId, p_seconds: seconds });
  if (error) return { error: error.message };
  void logAudit('auction.extend', playerId, { seconds });
  return {};
}

export async function adminAuctionUndo(playerId: string): Promise<{ error?: string }> {
  if (!supabase) return { error: 'Supabase is not configured.' };
  const { error } = await supabase.rpc('admin_auction_undo', { v_player: playerId });
  if (error) return { error: error.message };
  void logAudit('auction.undo', playerId, {});
  return {};
}

export const formatRupees = (amount: number | null | undefined): string =>
  amount == null ? '—' : `₹${amount.toLocaleString('en-IN')}`;