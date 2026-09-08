import { supabase } from './supabase';

// ---- Shared shapes (mirror the DB jsonb contracts) ----

export type AuctionSessionStatus = 'draft' | 'live' | 'ended';

export type AuctionSession = {
  id: string;
  name: string;
  status: AuctionSessionStatus;
  purse_budget: number;
  increment: number;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
  lot_timer_seconds: number;
};

export type AuctionTeamView = {
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
  status: 'sold' | 'unsold';
  source?: 'auction' | 'retained';
  lot_order: number;
};

export type AuctionPublicBid = {
  team_code: string;
  amount: number;
  created_at: string;
};

export type AuctionPlayerView = {
  player_id: string;
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
  bowling_arm?: string | null;
  lot_order: number;
  base_price: number;
  timer_ends_at?: string | null;
};

export type AuctionCurrentBid = {
  team_id: string;
  team_name: string;
  team_code: string;
  team_icon_url?: string;
  amount: number;
  created_at?: string;
};

export type NextUpPlayer = {
  player_id: string;
  name: string;
  photo_url: string | null;
  player_type: string;
  lot_order: number;
  base_price: number;
};

export type AuctionLiveState = {
  session: AuctionSession | null;
  current_player: AuctionPlayerView | null;
  current_bid: AuctionCurrentBid | null;
  bid_count: number;
  bids: AuctionPublicBid[];
  teams: AuctionTeamView[];
  pool_count: number;
  results: AuctionResultRow[];
  next_up: NextUpPlayer[];
};

export type AuctionLotStatus = 'pool' | 'on_auction' | 'sold' | 'unsold';

export type AuctionAdminLot = {
  player_id: string;
  name: string;
  photo_url: string | null;
  employee_id: string;
  player_type: string;
  gender: string;
  location: string;
  dpl_played: boolean;
  self_rating: number;
  availability: string;
  lot_order: number;
  base_price: number;
  status: AuctionLotStatus;
  sold_to_team_id: string | null;
  sold_price: number | null;
  opens_at: string | null;
  source?: 'auction' | 'retained';
};

export type AuctionAdminBid = {
  team_code: string;
  amount: number;
  player_name: string;
  created_at: string;
};

export type AuctionAdminState = {
  session: AuctionSession | null;
  current_player: AuctionPlayerView | null;
  current_bid: AuctionCurrentBid | null;
  players: AuctionAdminLot[];
  teams: AuctionTeamView[];
  bids: AuctionAdminBid[];
  results: AuctionResultRow[];
};

// ---- Money helpers ----

export function formatInr(amount: number | null | undefined): string {
  const value = Number(amount) || 0;
  return `₹${value.toLocaleString('en-IN')}`;
}

export function formatCompact(amount: number | null | undefined): string {
  const value = Number(amount) || 0;
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 10000000) return `${sign}₹${trimZero((abs / 10000000).toFixed(1))}Cr`;
  if (abs >= 100000) return `${sign}₹${trimZero((abs / 100000).toFixed(1))}L`;
  if (abs >= 1000) return `${sign}₹${(abs / 1000).toFixed(0)}K`;
  return `${sign}₹${abs}`;
}

function trimZero(text: string): string {
  return text.replace(/\.0$/, '');
}

// ---- Auction schedule (target start date/time, stored in settings) ----

export async function fetchAuctionSchedule(): Promise<string | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.from('settings').select('auction_scheduled_at').eq('id', 1).single();
  if (error || !data?.auction_scheduled_at) return null;
  return data.auction_scheduled_at as string;
}

export async function saveAuctionSchedule(iso: string | null): Promise<{ error?: string }> {
  if (!supabase) return { error: 'Supabase is not configured.' };
  const { error } = await supabase
    .from('settings')
    .update({ auction_scheduled_at: iso, updated_at: new Date().toISOString() })
    .eq('id', 1);
  return error ? { error: error.message } : {};
}

export function formatCountdown(totalSeconds: number): { days: number; hours: number; minutes: number; seconds: number } {
  const total = Math.max(0, Math.floor(totalSeconds));
  return {
    days: Math.floor(total / 86400),
    hours: Math.floor((total % 86400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  };
}

export function toDatetimeLocal(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromDatetimeLocal(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// ---- Auction settings (persisted auction config) ----

export type AuctionSettings = {
  retention_price: number;
  purse: number;
  increment: number;
  timer: number;
  default_base: number;
};

export async function fetchAuctionSettings(): Promise<AuctionSettings | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('settings')
    .select('auction_retention_price,auction_purse,auction_increment,auction_timer,auction_default_base')
    .eq('id', 1)
    .single();
  if (error || !data) return null;
  return {
    retention_price: Number(data.auction_retention_price) || 0,
    purse: Number(data.auction_purse) || 0,
    increment: Number(data.auction_increment) || 0,
    timer: Number(data.auction_timer) || 60,
    default_base: Number(data.auction_default_base) || 0,
  };
}

export async function saveAuctionSettings(settings: AuctionSettings): Promise<{ error?: string }> {
  if (!supabase) return { error: 'Supabase is not configured.' };
  const { error } = await supabase
    .from('settings')
    .update({
      auction_retention_price: settings.retention_price,
      auction_purse: settings.purse,
      auction_increment: settings.increment,
      auction_timer: settings.timer,
      auction_default_base: settings.default_base,
      updated_at: new Date().toISOString(),
    })
    .eq('id', 1);
  return error ? { error: error.message } : {};
}

export function bidFloor(state: Pick<AuctionAdminState, 'current_bid' | 'current_player'>): number {
  return Math.max(state.current_bid?.amount ?? 0, state.current_player?.base_price ?? 0, 0);
}

// ---- Public RPC ----

export async function fetchAuctionLiveState(): Promise<AuctionLiveState | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('auction_live_state');
  if (error || !data) return null;
  return data as AuctionLiveState;
}

// ---- Admin RPCs (all guarded by is_admin() server-side) ----

type RpcResult = { error?: string };

async function run(rpcName: string, args: Record<string, unknown> = {}): Promise<RpcResult> {
  if (!supabase) return { error: 'Supabase is not configured.' };
  const { error } = await supabase.rpc(rpcName, args);
  return error ? { error: error.message } : {};
}

export async function fetchAdminAuctionState(): Promise<AuctionAdminState | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('admin_auction_state');
  if (error || !data) return null;
  return data as AuctionAdminState;
}

export async function auctionStartSession(args: {
  name: string;
  purse: number;
  increment: number;
  timer: number;
}): Promise<RpcResult & { sessionId?: string }> {
  if (!supabase) return { error: 'Supabase is not configured.' };
  const { data, error } = await supabase.rpc('admin_auction_start_session', {
    p_name: args.name,
    p_purse: args.purse,
    p_increment: args.increment,
    p_timer: args.timer,
  });
  if (error) return { error: error.message };
  return { sessionId: typeof data === 'string' ? data : undefined };
}

export async function auctionUpdateSession(args: {
  session: string;
  name: string;
  purse: number;
  increment: number;
  timer: number;
  status: string;
}): Promise<RpcResult> {
  return run('admin_auction_update_session', {
    v_session: args.session,
    p_name: args.name,
    p_purse: args.purse,
    p_increment: args.increment,
    p_timer: args.timer,
    p_status: args.status,
  });
}

export function auctionEndSession(session: string): Promise<RpcResult> {
  return run('admin_auction_end_session', { v_session: session });
}

export function auctionResetSession(session: string): Promise<RpcResult> {
  return run('admin_auction_reset_session', { v_session: session });
}

export function auctionResyncPool(session: string): Promise<RpcResult> {
  return run('admin_auction_resync_pool', { v_session: session });
}

export function auctionSetBase(playerId: string, base: number): Promise<RpcResult> {
  return run('admin_auction_set_base', { v_player: playerId, p_base: base });
}

export function auctionOpenLot(playerId: string): Promise<RpcResult> {
  return run('admin_auction_open', { v_player: playerId });
}

export function auctionBid(teamId: string, amount: number): Promise<RpcResult> {
  return run('admin_auction_bid', { v_team: teamId, p_amount: amount });
}

export function auctionSell(playerId: string, teamId: string, price: number): Promise<RpcResult> {
  return run('admin_auction_sell', { v_player: playerId, v_team: teamId, p_price: price });
}

export function auctionUnsold(playerId: string): Promise<RpcResult> {
  return run('admin_auction_unsold', { v_player: playerId });
}

export function auctionUndo(playerId: string): Promise<RpcResult> {
  return run('admin_auction_undo', { v_player: playerId });
}

export function auctionExtend(playerId: string, seconds: number): Promise<RpcResult> {
  return run('admin_auction_extend', { v_player: playerId, p_seconds: seconds });
}
