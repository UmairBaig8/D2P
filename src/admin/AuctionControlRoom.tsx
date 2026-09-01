import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Play, Save, Flag, RotateCcw, Hammer, X, Undo2, Shield, Gavel, TimerReset } from 'lucide-react';
import AdminTopbar from '@/admin/AdminTopbar';
import BorderGlow from '@/components/BorderGlow';
import { resolveAsset } from '@/lib/base';
import { useTheme } from '@/lib/useTheme';
import { Toaster } from '@/components/ui/sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  isCurrentUserAdmin,
  getCurrentUserEmail,
  signInAdmin,
  signOutAdmin,
  fetchAdminAuctionState,
  adminAuctionStartSession,
  adminAuctionUpdateSession,
  adminAuctionEndSession,
  adminAuctionResetSession,
  adminAuctionSetBase,
  adminAuctionOpen,
  adminAuctionBid,
  adminAuctionSell,
  adminAuctionUnsold,
  adminAuctionUndo,
  adminAuctionExtend,
  formatRupees,
  type AdminAuctionState,
  type AdminAuctionPlayer,
} from '@/lib/site';

function statusBadge(status: string): { label: string; className: string } {
  switch (status) {
    case 'on_auction': return { label: 'ON AUCTION', className: 'bg-amber-500/15 text-amber-600 hover:bg-amber-500/15' };
    case 'sold': return { label: 'SOLD', className: 'bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/15' };
    case 'unsold': return { label: 'UNSOLD', className: 'bg-destructive/15 text-destructive hover:bg-destructive/15' };
    default: return { label: 'POOL', className: 'bg-muted text-muted-foreground hover:bg-muted' };
  }
}

function useCountdown(endAt: string | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, []);
  const end = endAt ? new Date(endAt).getTime() : null;
  if (end == null) return null;
  return Math.max(0, Math.ceil((end - now) / 1000));
}

function phaseShell(dark: boolean, children: React.ReactNode) {
  return (
    <div className={dark ? 'app dark admin-page relative isolate' : 'app admin-page relative isolate'}>
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-32 -left-32 size-96 rounded-full bg-cyan-400/10 blur-3xl dark:bg-cyan-400/15" />
        <div className="absolute top-1/3 -right-32 size-96 rounded-full bg-purple-500/10 blur-3xl dark:bg-purple-500/15" />
        <div className="absolute -bottom-24 left-1/3 size-80 rounded-full bg-blue-500/10 blur-3xl dark:bg-blue-500/15" />
      </div>
      {children}
    </div>
  );
}

function SessionPanel({ state, onChanged }: { state: AdminAuctionState; onChanged: () => void }) {
  const session = state.session;
  const [name, setName] = useState(session?.name ?? '');
  const [purse, setPurse] = useState(String(session?.purse_budget ?? 5000000));
  const [increment, setIncrement] = useState(String(session?.increment ?? 100000));
  const [timer, setTimer] = useState(String(session?.lot_timer_seconds ?? 60));
  const [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    setName(session?.name ?? '');
    setPurse(String(session?.purse_budget ?? 5000000));
    setIncrement(String(session?.increment ?? 100000));
    setTimer(String(session?.lot_timer_seconds ?? 60));
  }, [session]);

  const start = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    const { error } = await adminAuctionStartSession(
      name.trim() || 'DPL 2026 AUCTION',
      Number(purse) || 5000000,
      Number(increment) || 100000,
      Number(timer) || 60,
    );
    setBusy(false);
    if (error) toast.error(`Failed: ${error}`);
    else { toast.success('Auction session started.'); onChanged(); }
  };

  const saveSettings = async () => {
    if (!session) return;
    setBusy(true);
    const { error } = await adminAuctionUpdateSession(session.id, {
      name: name.trim() || undefined,
      purse: Number(purse) || undefined,
      increment: Number(increment) || undefined,
      timer: Number(timer) || undefined,
    });
    setBusy(false);
    if (error) toast.error(`Failed: ${error}`);
    else { toast.success('Session settings saved.'); onChanged(); }
  };

  const end = async () => {
    if (!session) return;
    setBusy(true);
    const { error } = await adminAuctionEndSession(session.id);
    setBusy(false);
    if (error) toast.error(`Failed: ${error}`);
    else { toast.success('Session ended.'); onChanged(); }
  };

  const reset = async () => {
    if (!session) return;
    setBusy(true);
    const { error } = await adminAuctionResetSession(session.id);
    setBusy(false);
    setConfirmReset(false);
    if (error) toast.error(`Failed: ${error}`);
    else { toast.success('Session reset to draft.'); onChanged(); }
  };

  if (!session) {
    return (
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2 font-display"><Gavel /> START A NEW SESSION</CardTitle>
          <CardDescription>Creates the lot queue from all unassigned players, gives every team the purse, and sets the per-lot timer (auto-unsold on expiry).</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={start} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="grid gap-1.5 sm:col-span-2 lg:col-span-4">
              <Label htmlFor="auct-name">NAME</Label>
              <Input id="auct-name" placeholder="DPL 2026 AUCTION" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="auct-purse">PURSE / TEAM (₹)</Label>
              <Input id="auct-purse" type="number" min={0} value={purse} onChange={(e) => setPurse(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="auct-inc">BID INCREMENT (₹)</Label>
              <Input id="auct-inc" type="number" min={0} value={increment} onChange={(e) => setIncrement(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="auct-timer">LOT TIMER (SEC)</Label>
              <Input id="auct-timer" type="number" min={10} value={timer} onChange={(e) => setTimer(e.target.value)} />
            </div>
            <div className="flex items-end">
              <Button className="w-full" type="submit" disabled={busy}>
                {busy && <Loader2 className="animate-spin" />}
                <Play /> START LIVE AUCTION
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    );
  }

  const live = session.status === 'live';

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-4">
        <div>
          <CardTitle className="font-display">{session.name.toUpperCase()}</CardTitle>
          <CardDescription>
            {live
              ? `purse ${formatRupees(session.purse_budget)} · inc ${formatRupees(session.increment)} · timer ${session.lot_timer_seconds}s`
              : `STATUS: ${session.status.toUpperCase()}`}
          </CardDescription>
        </div>
        <Badge variant="default" className={live ? 'bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/15' : 'bg-muted text-muted-foreground hover:bg-muted'}>
          {live ? '● LIVE' : session.status.toUpperCase()}
        </Badge>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="grid gap-1.5">
            <Label htmlFor="auct-name-live">NAME</Label>
            <Input id="auct-name-live" value={name} onChange={(e) => setName(e.target.value)} disabled={!live} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="auct-purse-live">PURSE / TEAM (₹)</Label>
            <Input id="auct-purse-live" type="number" min={0} value={purse} onChange={(e) => setPurse(e.target.value)} disabled={!live} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="auct-inc-live">BID INCREMENT (₹)</Label>
            <Input id="auct-inc-live" type="number" min={0} value={increment} onChange={(e) => setIncrement(e.target.value)} disabled={!live} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="auct-timer-live">LOT TIMER (SEC)</Label>
            <Input id="auct-timer-live" type="number" min={10} value={timer} onChange={(e) => setTimer(e.target.value)} disabled={!live} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {live && (
            <>
              <Button size="sm" onClick={saveSettings} disabled={busy}>{busy && <Loader2 className="animate-spin" />}<Save /> SAVE SETTINGS</Button>
              <Button size="sm" variant="outline" className="text-destructive hover:bg-destructive/10" onClick={end} disabled={busy}><Flag /> END SESSION</Button>
            </>
          )}
          {!live && (
            <Button size="sm" variant="outline" onClick={() => setConfirmReset(true)} disabled={busy}><RotateCcw /> RESET SESSION</Button>
          )}
        </div>
      </CardContent>

      <Dialog open={confirmReset} onOpenChange={(open) => { if (!open) setConfirmReset(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>RESET SESSION?</DialogTitle>
            <DialogDescription>
              Clears all lots, bids, purses and any team assignments made through this session. Back to draft. (Use this to re-run a dry run.)
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmReset(false)}>CANCEL</Button>
            <Button variant="destructive" onClick={reset} disabled={busy}>{busy && <Loader2 className="animate-spin" />} RESET</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function LiveMirror({ state, onChanged }: { state: AdminAuctionState; onChanged: () => void }) {
  const session = state.session;
  const current = state.current_player;
  const bid = state.current_bid;
  const floor = bid ? bid.amount + (session?.increment ?? 100000) : current?.base_price ?? 0;
  const [amount, setAmount] = useState(String(floor));
  const [busy, setBusy] = useState(false);
  const [confirmSell, setConfirmSell] = useState(false);
  const left = useCountdown(current?.timer_ends_at ?? null);

  const leadTeam = bid ? state.teams.find((t) => t.team_id === bid.team_id) : null;
  const nextLot = useMemo(() => [...state.players].filter((p) => p.status === 'pool').sort((a, b) => a.lot_order - b.lot_order)[0], [state.players]);
  const sellPrice = bid?.amount ?? current?.base_price ?? 0;

  useEffect(() => {
    if (current) setAmount(String(floor));
    else setAmount('');
  }, [current?.player_id, floor]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (left === 0) onChanged();
  }, [left, onChanged]);

  const recordBid = async (teamId: string) => {
    const value = Number(amount);
    const min = bid ? bid.amount + 1 : current?.base_price ?? 0;
    const v = Number.isFinite(value) && value > min ? value : floor;
    if (!current || !teamId) return;
    setBusy(true);
    const { error } = await adminAuctionBid(teamId, v);
    setBusy(false);
    if (error) toast.error(`Failed: ${error}`);
    else { toast.success('Bid recorded.'); onChanged(); }
  };

  const doExtend = async (secs: number) => {
    if (!current) return;
    setBusy(true);
    const { error } = await adminAuctionExtend(current.player_id, secs);
    setBusy(false);
    if (error) toast.error(`Failed: ${error}`);
    else { toast.success(`+${secs}s added.`); onChanged(); }
  };

  const doUnsold = async () => {
    if (!current) return;
    setBusy(true);
    const { error } = await adminAuctionUnsold(current.player_id);
    setBusy(false);
    if (error) toast.error(`Failed: ${error}`);
    else { toast.success(`${current.name} marked unsold.`); onChanged(); }
  };

  const openLot = async (playerId: string) => {
    setBusy(true);
    const { error } = await adminAuctionOpen(playerId);
    setBusy(false);
    if (error) toast.error(`Failed: ${error}`);
    else { toast.success('Next lot on the stage.'); onChanged(); }
  };

  const confirmSale = async () => {
    if (!current || !leadTeam) return;
    setBusy(true);
    const { error } = await adminAuctionSell(current.player_id, leadTeam.team_id, sellPrice);
    setBusy(false);
    setConfirmSell(false);
    if (error) toast.error(`Failed: ${error}`);
    else { toast.success(`Sold! ${current.name} → ${leadTeam.code}`); onChanged(); }
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      const key = event.key.toLowerCase();
      if (key === 'n' && nextLot) { event.preventDefault(); void openLot(nextLot.player_id); }
      else if (key === 's' && current && leadTeam) { event.preventDefault(); setConfirmSell(true); }
      else if (key === 'u' && current) { event.preventDefault(); void doUnsold(); }
      else if ((key === '+' || key === '=') && current) { event.preventDefault(); void doExtend(15); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const bump = (step: number) => setAmount(String((Number(amount) || floor) + step));

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 font-display">
          LIVE BOARD
          <span className="flex items-center gap-2">
            {current && (
              <span className={`font-sans text-lg font-black tabular-nums ${left !== null && left <= 10 ? 'text-destructive' : 'text-foreground'}`}>
                <TimerReset className="mr-1 inline size-4" />
                {left === null ? '--:--' : `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`}
              </span>
            )}
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => doExtend(15)} disabled={!current || busy}><TimerReset /> +15s</Button>
            <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => doExtend(30)} disabled={!current || busy}><TimerReset /> +30s</Button>
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        {current ? (
          <>
            <div className="rounded-xl border bg-muted/30 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2.5">
                  {current.photo_url
                    ? <img src={current.photo_url} alt="" className="size-9 rounded-lg object-cover" />
                    : <div className="grid size-9 place-items-center rounded-lg bg-gradient-to-br from-cyan-500/20 to-purple-500/20 text-xs font-bold text-primary">{current.name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()}</div>}
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{current.name}</div>
                    <div className="text-xs text-muted-foreground">LOT {current.lot_order} · base {formatRupees(current.base_price)}</div>
                  </div>
                </div>
                <Badge variant="default" className="bg-amber-500/15 text-amber-600 hover:bg-amber-500/15">ON AUCTION</Badge>
              </div>
              <div className="flex items-center justify-between gap-2 border-t pt-2">
                <div>
                  <div className="text-xs font-semibold text-muted-foreground">CURRENT BID</div>
                  <div className="text-2xl font-black tabular-nums">{formatRupees(bid?.amount ?? current.base_price)}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs font-semibold text-muted-foreground">LEADING TEAM</div>
                  <div className={`text-lg font-black ${bid ? '' : 'text-muted-foreground'}`}>{bid ? bid.team_code : '—'}</div>
                </div>
              </div>
            </div>

            <div className="grid gap-1.5">
              <div className="flex items-center gap-2">
                <Label className="shrink-0 text-xs">BID ₹</Label>
                <Input type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} className="h-9 flex-1 text-sm font-bold tabular-nums" />
                <Button size="sm" variant="outline" className="h-9 px-2 text-xs" onClick={() => setAmount(String(floor))} disabled={!current}>+INC</Button>
                <Button size="sm" variant="outline" className="h-9 px-2 text-xs" onClick={() => bump(50000)} disabled={!current}>+50K</Button>
                <Button size="sm" variant="outline" className="h-9 px-2 text-xs" onClick={() => bump(100000)} disabled={!current}>+1L</Button>
              </div>
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between text-[10px] font-bold tracking-widest text-muted-foreground">
                <span>TAP A TEAM TO BID</span>
                <span>next {formatRupees(floor)}</span>
              </div>
              <div className="lb-team-grid">
                {state.teams.map((team) => {
                  const remaining = team.budget - team.spent;
                  const blocked = team.squad >= 11 || remaining <= 0;
                  const isLead = leadTeam?.team_id === team.team_id;
                  return (
                    <button
                      key={team.team_id}
                      type="button"
                      className={`lb-team${isLead ? ' lead' : ''}`}
                      disabled={!current || blocked || busy}
                      onClick={() => recordBid(team.team_id)}
                      title={`${team.name} · ${team.squad}/11 squad`}
                    >
                      <b>{team.code}</b>
                      <span>{formatRupees(remaining)}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button size="sm" className="flex-1 bg-emerald-600 text-white hover:bg-emerald-600/90" onClick={() => setConfirmSell(true)} disabled={!leadTeam || busy}>
                <Hammer /> SOLD → {leadTeam ? leadTeam.code : '…'}
              </Button>
              <Button size="sm" variant="outline" className="text-destructive hover:bg-destructive/10" onClick={doUnsold} disabled={busy}><X /> UNSOLD</Button>
            </div>

            <Button size="sm" variant="outline" className="w-full" onClick={() => nextLot && openLot(nextLot.player_id)} disabled={!nextLot || busy}>
              NEXT LOT → {nextLot ? nextLot.name : 'none left'}
            </Button>

            {state.bids.length > 0 && (
              <div className="rounded-lg border">
                <div className="border-b px-3 py-1.5 text-[10px] font-bold tracking-widest text-muted-foreground">RECENT BIDS</div>
                <ul className="max-h-28 divide-y overflow-y-auto">
                  {state.bids.slice(0, 6).map((row, index) => (
                    <li key={index} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                      <Badge variant="outline" className="h-5 min-w-9 justify-center font-bold">{row.team_code}</Badge>
                      <span className="min-w-0 flex-1 truncate text-muted-foreground">{row.player_name}</span>
                      <b className="font-bold tabular-nums">{formatRupees(row.amount)}</b>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <p className="text-center text-[10px] tracking-widest text-muted-foreground">KEYS: N next · S sell · U unsold · + 15s</p>
          </>
        ) : (
          <>
            <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">No player on the stage.</p>
            <Button size="sm" className="w-full" onClick={() => nextLot && openLot(nextLot.player_id)} disabled={!nextLot || busy}>
              OPEN NEXT LOT → {nextLot ? nextLot.name : 'none left'}
            </Button>
            <p className="text-center text-[10px] tracking-widest text-muted-foreground">KEY: N next lot</p>
          </>
        )}
      </CardContent>

      <Dialog open={confirmSell} onOpenChange={(open) => { if (!open) setConfirmSell(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>SOLD — {current?.name.toUpperCase()}</DialogTitle>
            <DialogDescription>
              {leadTeam
                ? `${leadTeam.name} wins at ${formatRupees(sellPrice)}. After sale: ${leadTeam.code} → ${formatRupees(leadTeam.budget - leadTeam.spent - sellPrice)} left, ${leadTeam.squad + 1}/11 squad.`
                : 'No leading bid to sell to.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmSell(false)}>CANCEL</Button>
            <Button className="bg-emerald-600 text-white hover:bg-emerald-600/90" onClick={confirmSale} disabled={!leadTeam || busy}>
              {busy && <Loader2 className="animate-spin" />}<Hammer /> CONFIRM SALE
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function PurseChips({ teams }: { teams: AdminAuctionState['teams'] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {teams.map((team) => {
        const remaining = team.budget - team.spent;
        return (
          <div className={`purse-chip${remaining <= 0 ? ' empty' : ''}`} key={team.team_id} title={`${team.name} — ${team.squad}/11 squad`}>
            {team.icon_url ? <img src={resolveAsset(team.icon_url)} alt="" /> : <span className="purse-chip-fallback">{team.code}</span>}
            <b>{team.code}</b>
            <span className="purse-chip-rem">{formatRupees(remaining)}</span>
            <small>{team.squad}/11</small>
          </div>
        );
      })}
    </div>
  );
}

function LotQueue({ state, onChanged }: { state: AdminAuctionState; onChanged: () => void }) {
  const [filter, setFilter] = useState('all');
  const [baseDrafts, setBaseDrafts] = useState<Record<string, string>>({});
  const [selling, setSelling] = useState<AdminAuctionPlayer | null>(null);
  const [sellTeam, setSellTeam] = useState('');
  const [sellPrice, setSellPrice] = useState('');
  const [busy, setBusy] = useState(false);

  const rows = useMemo(() => {
    const filtered = filter === 'all' ? state.players : state.players.filter((p) => p.status === filter);
    const onAuctionId = state.current_player?.player_id;
    return [...filtered].sort((a, b) => {
      if (a.player_id === onAuctionId) return -1;
      if (b.player_id === onAuctionId) return 1;
      return a.lot_order - b.lot_order;
    });
  }, [state.players, state.current_player, filter]);

  const saveBase = async (player: AdminAuctionPlayer) => {
    const value = Number(baseDrafts[player.player_id]);
    if (Number.isNaN(value) || value === player.base_price) return;
    setBusy(true);
    const { error } = await adminAuctionSetBase(player.player_id, value);
    setBusy(false);
    if (error) toast.error(`Failed: ${error}`);
    else { toast.success(`Base price saved for ${player.name}.`); onChanged(); }
  };

  const open = async (player: AdminAuctionPlayer) => {
    setBusy(true);
    const { error } = await adminAuctionOpen(player.player_id);
    setBusy(false);
    if (error) toast.error(`Failed: ${error}`);
    else { toast.success(`${player.name} is on the stage. Timer started.`); onChanged(); }
  };

  const unsold = async (player: AdminAuctionPlayer) => {
    setBusy(true);
    const { error } = await adminAuctionUnsold(player.player_id);
    setBusy(false);
    if (error) toast.error(`Failed: ${error}`);
    else { toast.success(`${player.name} marked unsold.`); onChanged(); }
  };

  const undo = async (player: AdminAuctionPlayer) => {
    setBusy(true);
    const { error } = await adminAuctionUndo(player.player_id);
    setBusy(false);
    if (error) toast.error(`Failed: ${error}`);
    else { toast.success(`${player.name} returned to the pool.`); onChanged(); }
  };

  const openSell = (player: AdminAuctionPlayer) => {
    setSelling(player);
    setSellTeam('');
    setSellPrice(String(player.sold_price ?? state.current_bid?.amount ?? player.base_price));
  };

  const confirmSell = async () => {
    if (!selling) return;
    const price = Number(sellPrice);
    const team = state.teams.find((t) => t.team_id === sellTeam);
    if (!team) { toast.error('Pick a team.'); return; }
    if (Number.isNaN(price)) { toast.error('Enter a valid price.'); return; }
    if (price < selling.base_price) { toast.error(`Price must be at least ${formatRupees(selling.base_price)}.`); return; }
    if (price > team.budget - team.spent) { toast.error(`${team.code} has only ${formatRupees(team.budget - team.spent)} left.`); return; }
    if (team.squad >= 11) { toast.error(`${team.code} squad is full (11).`); return; }
    setBusy(true);
    const { error } = await adminAuctionSell(selling.player_id, team.team_id, price);
    setBusy(false);
    if (error) toast.error(`Failed: ${error}`);
    else { toast.success(`Sold! ${selling.name} → ${team.code}`); setSelling(null); onChanged(); }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-4">
        <CardTitle className="font-display">LOT QUEUE <span className="text-xs font-sans font-normal text-muted-foreground">({state.players.length})</span></CardTitle>
        <div className="flex flex-wrap gap-1.5">
          {['all', 'pool', 'on_auction', 'sold', 'unsold'].map((key) => (
            <Button key={key} size="sm" variant={filter === key ? 'default' : 'outline'} className="h-7 px-2.5 text-[10px]" onClick={() => setFilter(key)}>
              {key.toUpperCase()}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">LOT</TableHead>
              <TableHead>PLAYER</TableHead>
              <TableHead className="w-32">BASE (₹)</TableHead>
              <TableHead>STATUS</TableHead>
              <TableHead className="text-right">ACTIONS</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow><TableCell colSpan={5} className="py-10 text-center text-muted-foreground">No players in this view.</TableCell></TableRow>
            )}
            {rows.map((player) => {
              const badge = statusBadge(player.status);
              const live = player.status === 'on_auction';
              return (
                <TableRow key={player.player_id} className={live ? 'bg-amber-500/5' : ''}>
                  <TableCell className="text-muted-foreground">{player.lot_order}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2.5">
                      {player.photo_url
                        ? <img src={player.photo_url} alt="" className="size-8 rounded-full object-cover" />
                        : <div className="grid size-8 place-items-center rounded-full bg-gradient-to-br from-cyan-500/20 to-purple-500/20 text-[10px] font-bold text-primary">{player.name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()}</div>}
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-semibold">{player.name}</span>
                          {live && <span className="size-1.5 animate-pulse rounded-full bg-amber-500" />}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">{player.player_type} · {player.location}{player.sold_to_team_id ? ` → ${state.teams.find((t) => t.team_id === player.sold_to_team_id)?.code ?? ''}` : ''}</div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <Input
                        type="number"
                        min={0}
                        className="h-7 w-24 px-2 text-xs"
                        value={baseDrafts[player.player_id] ?? String(player.base_price)}
                        onChange={(e) => setBaseDrafts((drafts) => ({ ...drafts, [player.player_id]: e.target.value }))}
                        onBlur={() => saveBase(player)}
                      />
                      {Number(baseDrafts[player.player_id]) !== player.base_price && !Number.isNaN(Number(baseDrafts[player.player_id])) && (
                        <Button size="sm" variant="ghost" className="h-7 px-1.5" onClick={() => saveBase(player)}><Save /></Button>
                      )}
                    </div>
                  </TableCell>
                  <TableCell><Badge variant="default" className={badge.className}>{badge.label}</Badge></TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1.5">
                      {player.status === 'pool' && (
                        <Button size="sm" variant="outline" disabled={busy} onClick={() => open(player)}><Hammer /> OPEN</Button>
                      )}
                      {live && (
                        <>
                          <Button size="sm" disabled={busy} onClick={() => openSell(player)}><Hammer /> SELL</Button>
                          <Button size="sm" variant="outline" className="text-destructive hover:bg-destructive/10" disabled={busy} onClick={() => unsold(player)}><X /> UNSOLD</Button>
                        </>
                      )}
                      {(player.status === 'sold' || player.status === 'unsold') && (
                        <Button size="sm" variant="outline" disabled={busy} onClick={() => undo(player)}><Undo2 /> UNDO</Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>

      <Dialog open={!!selling} onOpenChange={(open) => { if (!open) setSelling(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>SELL {selling?.name.toUpperCase()}</DialogTitle>
            <DialogDescription>
              Lot {selling?.lot_order} · base {formatRupees(selling?.base_price)}. Budget + squad size are enforced on save.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="sell-team">BUYING TEAM</Label>
              <Select value={sellTeam} onValueChange={setSellTeam}>
                <SelectTrigger id="sell-team" className="w-full"><SelectValue placeholder="Select team…" /></SelectTrigger>
                <SelectContent>
                  {state.teams.map((team) => {
                    const remaining = team.budget - team.spent;
                    const full = team.squad >= 11 || remaining <= 0;
                    return (
                      <SelectItem key={team.team_id} value={team.team_id} disabled={full}>
                        {team.name} · {formatRupees(remaining)} left · {team.squad}/11
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="sell-price">SOLD PRICE (₹)</Label>
              <Input id="sell-price" type="number" min={0} value={sellPrice} onChange={(e) => setSellPrice(e.target.value)} />
            </div>
            {sellTeam && (
              <p className="rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                {(() => {
                  const team = state.teams.find((t) => t.team_id === sellTeam);
                  if (!team) return null;
                  return `After this sale: ${team.code} spends ${formatRupees(Number(sellPrice) || 0)} → ${formatRupees(team.budget - team.spent - (Number(sellPrice) || 0))} left, ${team.squad + 1}/11 squad.`;
                })()}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSelling(null)}>CANCEL</Button>
            <Button onClick={confirmSell} disabled={busy || !sellTeam}>{busy && <Loader2 className="animate-spin" />}<Hammer /> CONFIRM SALE</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function ResultsPanel({ state }: { state: AdminAuctionState }) {
  const sold = state.results.filter((row) => row.status === 'sold');
  const unsold = state.results.filter((row) => row.status === 'unsold');
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="font-display">RESULTS <span className="text-xs font-sans font-normal text-muted-foreground">{sold.length} SOLD · {unsold.length} UNSOLD</span></CardTitle>
      </CardHeader>
      <CardContent className="max-h-72 space-y-1 overflow-y-auto p-2">
        {state.results.length === 0 && <p className="px-3 py-4 text-center text-sm text-muted-foreground">No results yet.</p>}
        {state.results.map((row, index) => (
          <div key={`${row.player_name}-${index}`} className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs ${row.status === 'sold' ? 'bg-emerald-500/5' : 'bg-destructive/5'}`}>
            <Shield className={`size-3.5 ${row.status === 'sold' ? 'text-emerald-500' : 'text-destructive'}`} />
            <span className="min-w-0 flex-1 truncate font-medium">{row.player_name}</span>
            <span className="font-bold">{row.status === 'sold' ? row.team_code : 'UNSOLD'}</span>
            <span className="text-muted-foreground">{row.status === 'sold' ? formatRupees(row.sold_price) : '—'}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export default function AuctionControlRoom() {
  const { dark, toggleTheme } = useTheme();
  const [phase, setPhase] = useState<'checking' | 'anon' | 'admin' | 'denied'>('checking');
  const [state, setState] = useState<AdminAuctionState | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(() => {
    fetchAdminAuctionState().then((data) => {
      setState(data);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      const userEmail = await getCurrentUserEmail();
      if (!userEmail) {
        if (alive) setPhase('anon');
        return;
      }
      const admin = await isCurrentUserAdmin();
      if (!alive) return;
      setPhase(admin ? 'admin' : 'denied');
      if (admin) reload();
    })();
    return () => { alive = false; };
  }, [reload]);

  useEffect(() => {
    if (phase !== 'admin') return;
    const id = window.setInterval(reload, 4000);
    return () => window.clearInterval(id);
  }, [phase, reload]);

  const handleLogout = async () => {
    await signOutAdmin();
    setPhase('anon');
  };

  if (phase === 'checking') {
    return phaseShell(dark, (
      <>
        <AdminTopbar dark={dark} onToggleTheme={toggleTheme} onLogout={handleLogout} showLogout={false} />
        <main className="admin-main shell"><div className="flex items-center justify-center gap-3 py-16 text-sm font-semibold text-muted-foreground"><Loader2 className="size-4 animate-spin" /> CHECKING…</div></main>
      </>
    ));
  }

  if (phase === 'anon') {
    return phaseShell(dark, (
      <>
        <AdminTopbar dark={dark} onToggleTheme={toggleTheme} onLogout={handleLogout} showLogout={false} />
        <main className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center px-4 py-10">
          <BorderGlow className="w-full max-w-sm" backgroundColor="#0b1420" colors={['#09c9d8', '#873cff', '#2f7dff']} glowColor="196 100 48" glowIntensity={1.05} glowRadius={26} edgeSensitivity={24} borderRadius={18}>
            <Card className="w-full max-w-sm border-border/60 shadow-2xl">
              <CardHeader className="justify-items-center pb-2 pt-8 text-center">
                <div className="mb-2 grid size-12 place-items-center rounded-xl bg-gradient-to-br from-cyan-500 via-blue-500 to-purple-500 text-white shadow-lg"><Gavel /></div>
                <CardTitle className="text-xl font-black tracking-wide">AUCTION CONTROL</CardTitle>
                <CardDescription>Sign in with your Supabase Auth account to run the DPL 2026 auction.</CardDescription>
              </CardHeader>
              <CardContent className="px-6 pb-7">
                <form className="grid gap-4" onSubmit={async (event) => {
                  event.preventDefault();
                  const form = new FormData(event.currentTarget);
                  const { error } = await signInAdmin(String(form.get('email')), String(form.get('password')));
                  if (error) toast.error(error);
                  else if (await isCurrentUserAdmin()) { setPhase('admin'); reload(); }
                  else { await signOutAdmin(); setPhase('denied'); }
                }}>
                  <div className="grid gap-1.5">
                    <Label htmlFor="acr-email">EMAIL</Label>
                    <Input id="acr-email" type="email" name="email" required autoComplete="email" />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="acr-password">PASSWORD</Label>
                    <Input id="acr-password" type="password" name="password" required autoComplete="current-password" />
                  </div>
                  <Button className="w-full" type="submit">SIGN IN</Button>
                </form>
              </CardContent>
            </Card>
          </BorderGlow>
        </main>
      </>
    ));
  }

  if (phase === 'denied') {
    return phaseShell(dark, (
      <>
        <AdminTopbar dark={dark} onToggleTheme={toggleTheme} onLogout={handleLogout} showLogout={false} />
        <main className="admin-main shell"><div className="admin-denied"><div className="admin-login-icon">🔒</div><h1>NOT AUTHORIZED</h1><p>This account isn&apos;t on the admin whitelist.</p><Button variant="outline" type="button" onClick={handleLogout}>SIGN OUT</Button></div></main>
      </>
    ));
  }

  return phaseShell(dark, (
    <>
      <Toaster theme={dark ? 'dark' : 'light'} position="bottom-center" richColors />
      <AdminTopbar dark={dark} onToggleTheme={toggleTheme} onLogout={handleLogout} showLogout />
      <main className="admin-main shell">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-display text-2xl font-black italic tracking-wide">AUCTION <span className="text-primary">CONTROL ROOM</span></h1>
          {state?.session && (
            <Badge variant="default" className={state.session.status === 'live' ? 'bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/15' : 'bg-muted text-muted-foreground hover:bg-muted'}>
              {state.session.status === 'live' ? '● LIVE' : state.session.status.toUpperCase()}
            </Badge>
          )}
        </div>

        {loading ? (
          <div className="space-y-4">
            <Skeleton className="h-28 w-full" />
            <div className="grid gap-4 lg:grid-cols-3">
              <div className="lg:col-span-2 space-y-4"><Skeleton className="h-96 w-full" /></div>
              <div className="space-y-4"><Skeleton className="h-64 w-full" /><Skeleton className="h-64 w-full" /></div>
            </div>
          </div>
        ) : !state?.session ? (
          <SessionPanel state={{ ...state!, players: [], teams: [], bids: [], results: [] }} onChanged={reload} />
        ) : (
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="space-y-4 lg:col-span-2">
              <SessionPanel state={state} onChanged={reload} />
              <PurseChips teams={state.teams} />
              <LotQueue state={state} onChanged={reload} />
            </div>
            <div className="space-y-4">
              <LiveMirror state={state} onChanged={reload} />
              <ResultsPanel state={state} />
            </div>
          </div>
        )}
      </main>
    </>
  ));
}
