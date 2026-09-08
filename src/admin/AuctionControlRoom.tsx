import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Hammer, Play, Flag, RotateCcw, Undo2, TimerReset, ExternalLink, Gavel } from 'lucide-react';
import AdminTopbar from '@/admin/AdminTopbar';
import BorderGlow from '@/components/BorderGlow';
import { withBase, resolveAsset } from '@/lib/base';
import { useTheme } from '@/lib/useTheme';
import { Toaster } from '@/components/ui/sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  isCurrentUserAdmin,
  getCurrentUserEmail,
  signInAdmin,
  signOutAdmin,
} from '@/lib/site';
import {
  fetchAdminAuctionState,
  fetchAuctionSchedule,
  fetchAuctionSettings,
  saveAuctionSettings,
  saveAuctionSchedule,
  toDatetimeLocal,
  fromDatetimeLocal,
  auctionStartSession,
  auctionUpdateSession,
  auctionEndSession,
  auctionResetSession,
  auctionResyncPool,
  auctionSetBase,
  auctionOpenLot,
  auctionBid,
  auctionSell,
  auctionUnsold,
  auctionUndo,
  auctionExtend,
  formatCompact,
  formatInr,
  type AuctionAdminState,
  type AuctionAdminLot,
} from '@/lib/auction';

const DEFAULT_PURSE = 5000000;
const DEFAULT_INCREMENT = 100000;
const DEFAULT_TIMER = 60;

function useCountdown(endAt: string | null | undefined): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!endAt) return;
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [endAt]);
  if (!endAt) return null;
  return Math.max(0, Math.ceil((new Date(endAt).getTime() - now) / 1000));
}

function initials(name: string): string {
  return name.split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase();
}

function LotBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    on_auction: 'bg-amber-500/15 text-amber-600',
    sold: 'bg-emerald-500/15 text-emerald-600',
    unsold: 'bg-rose-500/15 text-rose-600',
    pool: 'bg-muted text-muted-foreground',
  };
  return <Badge className={map[status] ?? map.pool}>{status.replace('_', ' ').toUpperCase()}</Badge>;
}

type Phase = 'checking' | 'anon' | 'denied' | 'admin';

export default function AuctionControlRoom() {
  const { dark, toggleTheme } = useTheme();
  const [phase, setPhase] = useState<Phase>('checking');
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const userEmail = await getCurrentUserEmail();
      if (!userEmail) {
        if (alive) setPhase('anon');
        return;
      }
      setEmail(userEmail);
      const admin = await isCurrentUserAdmin();
      if (!alive) return;
      setPhase(admin ? 'admin' : 'denied');
    })();
    return () => { alive = false; };
  }, []);

  const handleLogout = useCallback(async () => {
    await signOutAdmin();
    setPhase('anon');
  }, []);

  // ---- live data ----
  const [data, setData] = useState<AuctionAdminState | null>(null);
  const [dataError, setDataError] = useState(false);

  useEffect(() => {
    if (phase !== 'admin') return;
    let alive = true;
    const tick = async () => {
      const next = await fetchAdminAuctionState();
      if (!alive) return;
      setDataError(!next);
      if (next) setData(next);
    };
    void tick();
    const id = window.setInterval(() => void tick(), 3000);
    return () => { alive = false; window.clearInterval(id); };
  }, [phase]);

  const refresh = useCallback(async () => {
    const next = await fetchAdminAuctionState();
    if (next) { setDataError(false); setData(next); }
  }, []);

  if (phase === 'checking' || phase === 'anon' || phase === 'denied') {
    return (
      <AdminGate
        dark={dark}
        phase={phase}
        email={email}
        onToggleTheme={toggleTheme}
        onLogout={handleLogout}
        onAuthed={async () => {
          const admin = await isCurrentUserAdmin();
          setPhase(admin ? 'admin' : 'denied');
        }}
      />
    );
  }

  const session = data?.session ?? null;
  const players = data?.players ?? [];
  const teams = data?.teams ?? [];
  const current = data?.current_player ?? null;
  const currentBid = data?.current_bid ?? null;

  if (data === null) {
    return (
      <div className={`app admin-page relative isolate ${dark ? 'dark' : ''}`}>
        <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
          <div className="absolute -top-32 -left-32 size-96 rounded-full bg-cyan-400/10 blur-3xl dark:bg-cyan-400/15" />
          <div className="absolute top-1/3 -right-32 size-96 rounded-full bg-purple-500/10 blur-3xl dark:bg-purple-500/15" />
          <div className="absolute -bottom-24 left-1/3 size-80 rounded-full bg-blue-500/10 blur-3xl dark:bg-blue-500/15" />
        </div>
        <Toaster theme={dark ? 'dark' : 'light'} position="bottom-center" richColors />
        <AdminTopbar dark={dark} onToggleTheme={toggleTheme} onLogout={handleLogout} auctionPage />
        <main className="grid min-h-[calc(100vh-3.5rem)] place-items-center px-4">
          {dataError ? (
            <Card className="w-full max-w-sm text-center">
              <CardContent className="flex flex-col items-center gap-3 py-10">
                <p className="text-lg font-black">STATE OFFLINE</p>
                <p className="text-sm text-muted-foreground">Could not reach the auction state. Check your admin session.</p>
                <Button onClick={() => void refresh()}><RotateCcw /> RETRY</Button>
              </CardContent>
            </Card>
          ) : (
            <div className="flex items-center gap-3 text-sm font-semibold text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> LOADING AUCTION STATE…
            </div>
          )}
        </main>
      </div>
    );
  }

  return (
    <div className={`app admin-page relative isolate ${dark ? 'dark' : ''}`}>
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-32 -left-32 size-96 rounded-full bg-cyan-400/10 blur-3xl dark:bg-cyan-400/15" />
        <div className="absolute top-1/3 -right-32 size-96 rounded-full bg-purple-500/10 blur-3xl dark:bg-purple-500/15" />
        <div className="absolute -bottom-24 left-1/3 size-80 rounded-full bg-blue-500/10 blur-3xl dark:bg-blue-500/15" />
      </div>
      <Toaster theme={dark ? 'dark' : 'light'} position="bottom-center" richColors />
      <AdminTopbar dark={dark} onToggleTheme={toggleTheme} onLogout={handleLogout} auctionPage />
      <main className="shell px-4 py-5 sm:px-6">
        <ControlHeader
          session={session}
          dataError={dataError}
          onChanged={refresh}
          onStart={async (args) => {
            const res = await auctionStartSession(args);
            if (res.error) { toast.error(res.error); return; }
            toast.success('Auction session started.');
            await refresh();
          }}
          onUpdate={async (args) => {
            const res = await auctionUpdateSession({ session: session!.id, ...args });
            if (res.error) { toast.error(res.error); return; }
            toast.success('Session updated.');
            await refresh();
          }}
        />

        {!session ? (
          <Card className="mt-6 border-dashed text-center">
            <CardContent className="flex flex-col items-center gap-3 py-16">
              <div className="grid size-14 place-items-center rounded-2xl bg-gradient-to-br from-cyan-500 via-blue-500 to-purple-500 text-white shadow-lg"><Gavel /></div>
              <div>
                <p className="text-lg font-black tracking-wide">NO ACTIVE AUCTION SESSION</p>
                <p className="text-sm text-muted-foreground">Start a session to seed the lot queue from unassigned registrations.</p>
              </div>
              <StartSessionButton
                trigger={<Button><Play /> START SESSION</Button>}
                onStart={async (args) => {
                  const res = await auctionStartSession(args);
                  if (res.error) { toast.error(res.error); return; }
                  toast.success('Auction session started.');
                  await refresh();
                }}
              />
            </CardContent>
          </Card>
        ) : (
          <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(340px,430px)_1fr]">
            <StagePanel
              session={session}
              state={data}
              current={current}
              currentBid={currentBid}
              players={players}
              teams={teams}
              onChanged={async () => refresh()}
            />
            <div className="grid min-w-0 gap-4">
              <QueuePanel
                players={players}
                teams={teams}
                current={current}
                onChanged={async () => refresh()}
              />
              <TeamsPanel teams={teams} />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Auth gate (mirrors AdminPage)
// ---------------------------------------------------------------------------

function AdminGate({
  dark, phase, email, onToggleTheme, onLogout, onAuthed,
}: {
  dark: boolean;
  phase: Phase;
  email: string | null;
  onToggleTheme: (dark: boolean) => void;
  onLogout: () => void;
  onAuthed: () => void;
}) {
  const [loginEmail, setLoginEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    const res = await signInAdmin(loginEmail.trim(), password);
    setBusy(false);
    if (res.error) { setError(res.error); return; }
    onAuthed();
  };

  return (
    <div className={`app admin-page relative isolate ${dark ? 'dark' : ''}`}>
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-32 -left-32 size-96 rounded-full bg-cyan-400/10 blur-3xl" />
        <div className="absolute top-1/3 -right-32 size-96 rounded-full bg-purple-500/10 blur-3xl" />
        <div className="absolute -bottom-24 left-1/3 size-80 rounded-full bg-blue-500/10 blur-3xl" />
      </div>
      <AdminTopbar dark={dark} onToggleTheme={onToggleTheme} onLogout={onLogout} showLogout={false} />
      <main className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center px-4 py-10">
        {phase === 'checking' && (
          <div className="flex items-center gap-3 text-sm font-semibold text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> CHECKING…
          </div>
        )}
        {phase === 'denied' && (
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="grid size-14 place-items-center rounded-2xl bg-gradient-to-br from-cyan-500 via-blue-500 to-purple-500 text-white text-2xl">🔒</div>
            <div>
              <p className="text-lg font-black">NOT AUTHORIZED</p>
              {email && <p className="text-sm text-muted-foreground">{email} isn&apos;t on the admin whitelist.</p>}
            </div>
            <Button variant="outline" onClick={onLogout}>SIGN OUT</Button>
          </div>
        )}
        {phase === 'anon' && (
          <BorderGlow className="w-full max-w-sm" backgroundColor="#0b1420" colors={['#09c9d8', '#873cff', '#2f7dff']} glowColor="196 100 48" glowIntensity={1.05} glowRadius={26} edgeSensitivity={24} borderRadius={18}>
            <Card className="w-full max-w-sm border-border/60 shadow-2xl">
              <CardHeader className="justify-items-center pb-2 pt-8 text-center">
                <div className="mb-2 grid size-12 place-items-center rounded-xl bg-gradient-to-br from-cyan-500 via-blue-500 to-purple-500 text-white shadow-lg"><Gavel /></div>
                <CardTitle className="text-xl font-black tracking-wide">AUCTION CONTROL</CardTitle>
                <p className="text-sm text-muted-foreground">Admin sign-in required to run the live auction.</p>
              </CardHeader>
              <CardContent className="px-6 pb-7">
                <form onSubmit={handleLogin} className="grid gap-4">
                  <div className="grid gap-1.5">
                    <Label htmlFor="au-email">EMAIL</Label>
                    <Input id="au-email" type="email" value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} required autoComplete="email" />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="au-password">PASSWORD</Label>
                    <Input id="au-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
                  </div>
                  {error && <div className="rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2 text-xs font-semibold text-destructive">{error}</div>}
                  <Button className="w-full" type="submit" disabled={busy}>{busy ? 'SIGNING IN…' : 'SIGN IN'}</Button>
                </form>
              </CardContent>
            </Card>
          </BorderGlow>
        )}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Session header + actions
// ---------------------------------------------------------------------------

type StartArgs = { name: string; purse: number; increment: number; timer: number };
type UpdateArgs = { name: string; purse: number; increment: number; timer: number; status: string };

function StartSessionButton({ trigger, onStart }: { trigger: React.ReactNode; onStart: (args: StartArgs) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('DPL 2026 AUCTION');
  const [purse, setPurse] = useState(String(DEFAULT_PURSE));
  const [increment, setIncrement] = useState(String(DEFAULT_INCREMENT));
  const [timer, setTimer] = useState(String(DEFAULT_TIMER));
  const [busy, setBusy] = useState(false);

  const openDialog = async () => {
    const settings = await fetchAuctionSettings();
    if (settings) {
      setPurse(String(settings.purse || DEFAULT_PURSE));
      setIncrement(String(settings.increment || DEFAULT_INCREMENT));
      setTimer(String(settings.timer || DEFAULT_TIMER));
    }
    setOpen(true);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    await onStart({
      name: name.trim() || 'DPL 2026 AUCTION',
      purse: Number(purse) || 0,
      increment: Number(increment) || 0,
      timer: Math.max(10, Number(timer) || 60),
    });
    setBusy(false);
    setOpen(false);
  };

  return (
    <>
      <button type="button" onClick={() => void openDialog()} className="contents">{trigger}</button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>START AUCTION SESSION</DialogTitle>
            <DialogDescription>Ends any live session, then seeds a fresh lot queue from unassigned registrations.</DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="grid gap-4">
            <div className="grid gap-1.5">
              <Label>SESSION NAME</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="grid gap-1.5">
                <Label>PURSE ₹</Label>
                <Input type="number" min={0} value={purse} onChange={(e) => setPurse(e.target.value)} required />
              </div>
              <div className="grid gap-1.5">
                <Label>INCREMENT ₹</Label>
                <Input type="number" min={0} value={increment} onChange={(e) => setIncrement(e.target.value)} required />
              </div>
              <div className="grid gap-1.5">
                <Label>TIMER (S)</Label>
                <Input type="number" min={10} value={timer} onChange={(e) => setTimer(e.target.value)} required />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>CANCEL</Button>
              <Button type="submit" disabled={busy}>{busy && <Loader2 className="animate-spin" />}START SESSION</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ControlHeader({ session, dataError, onStart, onUpdate, onChanged }: {
  session: AuctionAdminState['session'];
  dataError: boolean;
  onStart: (args: StartArgs) => Promise<void>;
  onUpdate: (args: UpdateArgs) => Promise<void>;
  onChanged: () => Promise<void>;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [name, setName] = useState('');
  const [purse, setPurse] = useState('');
  const [increment, setIncrement] = useState('');
  const [timer, setTimer] = useState('');
  const [status, setStatus] = useState('live');

  const openEdit = () => {
    if (!session) return;
    setName(session.name);
    setPurse(String(session.purse_budget));
    setIncrement(String(session.increment));
    setTimer(String(session.lot_timer_seconds));
    setStatus(session.status);
    setEditOpen(true);
  };

  const submitEdit = async (event: React.FormEvent) => {
    event.preventDefault();
    await onUpdate({ name, purse: Number(purse), increment: Number(increment), timer: Math.max(10, Number(timer) || 60), status });
    setEditOpen(false);
  };

  const endSession = async () => {
    if (!session) return;
    if (!window.confirm('End this auction session?')) return;
    const res = await auctionEndSession(session.id);
    if (res.error) toast.error(res.error); else toast.success('Session ended.');
    await onChanged();
  };

  const resetSession = async () => {
    if (!session) return;
    if (!window.confirm('RESET this session?\n\nDeletes this session\'s lots, bids and purses, and returns auction-sold players to the pool. Registrations and non-auction roster assignments are preserved.')) return;
    const res = await auctionResetSession(session.id);
    if (res.error) toast.error(res.error); else toast.success('Session reset to draft.');
    await onChanged();
  };

  const resyncPool = async () => {
    if (!session) return;
    if (!window.confirm(`Resync pool?\n\nRemoves now-rostered players from the queue and adds any unassigned registrations not yet in it (pool becomes ${`"currently unassigned"`}). Sales/results are kept. Registrations are untouched.`)) return;
    const res = await auctionResyncPool(session.id);
    if (res.error) toast.error(res.error); else toast.success('Pool resynced to unassigned registrations.');
    await onChanged();
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-3">
        <div className="grid size-10 place-items-center rounded-xl bg-gradient-to-br from-cyan-500 via-blue-500 to-purple-500 text-white shadow-lg"><Hammer /></div>
        <div>
          <p className="text-base font-black italic leading-tight tracking-wide">{session?.name ?? 'AUCTION CONTROL'}</p>
          <div className="flex items-center gap-2 text-xs">
            <Badge variant={session?.status === 'live' ? 'default' : 'secondary'}>{session?.status.toUpperCase() ?? 'NO SESSION'}</Badge>
            {session && <span className="text-muted-foreground">Purse {formatCompact(session.purse_budget)} · Inc {formatCompact(session.increment)} · Lot timer {session.lot_timer_seconds}s</span>}
          </div>
        </div>
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {dataError && <span className="rounded-md bg-destructive/10 px-2 py-1 text-xs font-bold text-destructive">STATE OFFLINE</span>}
        <AuctionSettingsButton session={session} onSaved={onChanged} />
        <ScheduleButton />
        <StartSessionButton trigger={<Button variant="outline" size="sm"><Play /> NEW</Button>} onStart={onStart} />
        {session && <Button variant="outline" size="sm" onClick={openEdit}><Hammer /> EDIT</Button>}
        {session?.status === 'live' && <Button variant="destructive" size="sm" onClick={endSession}><Flag /> END</Button>}
        {session && session.status === 'live' && <Button variant="outline" size="sm" onClick={resyncPool} title="Drop rostered players from the queue + add new unassigned signups">⟳ RESYNC</Button>}
        {session && session.status !== 'live' && <Button variant="outline" size="sm" onClick={resetSession}><RotateCcw /> RESET</Button>}
        <a href={withBase('/auction')} target="_blank" rel="noreferrer"><Button variant="ghost" size="sm"><ExternalLink /> PUBLIC BOARD</Button></a>
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>EDIT SESSION</DialogTitle>
          </DialogHeader>
          <form onSubmit={submitEdit} className="grid gap-4">
            <div className="grid gap-1.5"><Label>SESSION NAME</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div className="grid grid-cols-3 gap-3">
              <div className="grid gap-1.5"><Label>PURSE ₹</Label><Input type="number" min={0} value={purse} onChange={(e) => setPurse(e.target.value)} required /></div>
              <div className="grid gap-1.5"><Label>INCREMENT ₹</Label><Input type="number" min={0} value={increment} onChange={(e) => setIncrement(e.target.value)} required /></div>
              <div className="grid gap-1.5"><Label>TIMER (S)</Label><Input type="number" min={10} value={timer} onChange={(e) => setTimer(e.target.value)} required /></div>
            </div>
            <div className="grid gap-1.5">
              <Label>STATUS</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">DRAFT</SelectItem>
                  <SelectItem value="live">LIVE</SelectItem>
                  <SelectItem value="ended">ENDED</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>CANCEL</Button>
              <Button type="submit">SAVE</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stage panel: run the current lot
// ---------------------------------------------------------------------------

function StagePanel({ session, state, current, currentBid, players, teams, onChanged }: {
  session: NonNullable<AuctionAdminState['session']>;
  state: AuctionAdminState | null;
  current: AuctionAdminState['current_player'];
  currentBid: AuctionAdminState['current_bid'];
  players: AuctionAdminLot[];
  teams: AuctionAdminState['teams'];
  onChanged: () => Promise<void>;
}) {
  const live = session.status === 'live';
  const [bidTeam, setBidTeam] = useState<string>('');
  const [amount, setAmount] = useState('');
  const [nextPlayerId, setNextPlayerId] = useState<string>('');
  const [base, setBase] = useState('');
  const [busy, setBusy] = useState(false);
  const remaining = useCountdown(current?.timer_ends_at);

  const poolPlayers = useMemo(() => players.filter((p) => p.status === 'pool').sort((a, b) => a.lot_order - b.lot_order), [players]);
  const floor = Math.max(currentBid?.amount ?? 0, current?.base_price ?? 0, 0);
  const inc = session.increment || DEFAULT_INCREMENT;

  useEffect(() => {
    if (current) {
      setBidTeam((prev) => prev && teams.some((t) => t.team_id === prev) ? prev : (teams[0]?.team_id ?? ''));
    }
  }, [current, teams]);

  const selectedTeam = teams.find((t) => t.team_id === bidTeam);
  const selectedTeamBalance = (selectedTeam?.budget ?? 0) - (selectedTeam?.spent ?? 0);

  const act = async (label: string, fn: () => Promise<{ error?: string }>) => {
    setBusy(true);
    const res = await fn();
    setBusy(false);
    if (res.error) { toast.error(res.error); return false; }
    toast.success(label);
    await onChanged();
    return true;
  };

  const quickAmounts = useMemo(() => {
    const next = floor + inc;
    return [next, next + inc, next + inc * 2];
  }, [floor, inc]);

  const handleOpenNext = async () => {
    const player = poolPlayers.find((p) => p.player_id === nextPlayerId) ?? poolPlayers[0];
    if (!player) { toast.error('No pool players left.'); return; }
    const baseNum = Number(base);
    if (base && !Number.isNaN(baseNum)) {
      const ok = await act('Base saved', () => auctionSetBase(player.player_id, baseNum));
      if (!ok) return;
    }
    await act('Lot on the stage', () => auctionOpenLot(player.player_id));
  };

  const handleBid = async () => {
    if (!bidTeam) { toast.error('Pick a team first.'); return; }
    const amt = Number(amount);
    if (!amt || amt <= floor) { toast.error(`Bid must exceed ${formatInr(floor)}.`); return; }
    if (amt > selectedTeamBalance) { toast.error(`Budget exceeded — ${formatCompact(selectedTeamBalance)} left.`); return; }
    await act('Bid placed', () => auctionBid(bidTeam, amt));
  };

  const handleSell = async () => {
    if (!current) return;
    const price = Number(amount) || floor;
    const teamId = bidTeam;
    if (!teamId) { toast.error('Pick a team.'); return; }
    if (!window.confirm(`Sell ${current.name} to ${teams.find((t) => t.team_id === teamId)?.name ?? 'team'} for ${formatInr(price)}?`)) return;
    await act('Sold!', () => auctionSell(current.player_id, teamId, price));
  };

  const handleUnsold = async () => {
    if (!current) return;
    if (!window.confirm(`Mark ${current.name} UNSOLD?`)) return;
    await act('Marked unsold', () => auctionUnsold(current.player_id));
  };

  const handleExtend = async (seconds: number) => {
    if (!current) return;
    await act(`+${seconds}s`, () => auctionExtend(current.player_id, seconds));
  };

  const undoLast = async () => {
    const last = [...players]
      .filter((p) => p.source !== 'retained' && (p.status === 'sold' || p.status === 'unsold'))
      .sort((a, b) => b.lot_order - a.lot_order)[0];
    if (!last) return;
    if (!window.confirm(`Undo ${last.name} (${last.status})? Back to pool.`)) return;
    await act('Undone', () => auctionUndo(last.player_id));
  };

  return (
    <Card className="min-w-0">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-base">
          <span className="flex items-center gap-2"><Hammer /> STAGE</span>
          {current && <LotBadge status={current.player_id ? 'on_auction' : 'pool'} />}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        {current && live ? (
          <>
            <div className="flex items-center gap-3">
              <div className="size-14 shrink-0 overflow-hidden rounded-xl bg-gradient-to-br from-cyan-500 via-blue-500 to-purple-500">
                {current.photo_url
                  ? <img src={current.photo_url} alt="" className="size-full object-cover" />
                  : <div className="grid size-full place-items-center font-black italic text-white">{initials(current.name)}</div>}
              </div>
              <div className="min-w-0">
                <p className="truncate text-lg font-black italic leading-tight">{current.name}</p>
                <p className="text-xs text-muted-foreground">
                  LOT #{current.lot_order} · {current.player_type} · {current.location} · {current.self_rating}.0 ★ · Base {formatCompact(current.base_price)}
                </p>
              </div>
              {remaining != null && (
                <div className={`ml-auto shrink-0 text-right ${remaining <= 10 ? 'text-destructive' : ''}`}>
                  <p className="text-[10px] font-bold tracking-widest text-muted-foreground">LOT CLOSES</p>
                  <p className="text-2xl font-black tabular-nums">{remaining}s</p>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-2">
              <Button size="sm" variant="outline" disabled={busy || remaining === 0} onClick={() => handleExtend(15)}><TimerReset /> +15S</Button>
              <Button size="sm" variant="outline" disabled={busy || remaining === 0} onClick={() => handleExtend(30)}><TimerReset /> +30S</Button>
              <div className="ml-auto text-right">
                <p className="text-[10px] font-bold tracking-widest text-muted-foreground">HIGH BID</p>
                <p className={`text-xl font-black ${currentBid ? 'text-emerald-500' : 'text-foreground'}`}>{formatInr(currentBid?.amount ?? current.base_price)}</p>
                {currentBid && <p className="text-xs font-semibold text-muted-foreground">{currentBid.team_name}</p>}
              </div>
            </div>

            <div className="grid gap-2 rounded-xl border bg-background p-3">
              <Label className="text-[10px] font-bold tracking-widest text-muted-foreground">BID — {selectedTeam ? `${selectedTeam.code} has ${formatCompact(selectedTeamBalance)}` : 'pick a team'}</Label>
              <Select value={bidTeam} onValueChange={setBidTeam}>
                <SelectTrigger><SelectValue placeholder="Choose team" /></SelectTrigger>
                <SelectContent>
                  {teams.map((team) => (
                    <SelectItem key={team.team_id} value={team.team_id} disabled={team.squad >= 11 || team.budget - team.spent <= floor}>
                      {team.code || team.name} · {formatCompact(team.budget - team.spent)} left · {team.squad}/11
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex flex-wrap gap-2">
                {quickAmounts.map((value) => (
                  <Button key={value} type="button" size="sm" variant="secondary" onClick={() => setAmount(String(value))}>{formatCompact(value)}</Button>
                ))}
              </div>
              <Input type="number" min={floor + 1} placeholder={`Amount (min ${formatInr(floor + 1)})`} value={amount} onChange={(e) => setAmount(e.target.value)} />
              <Button onClick={handleBid} disabled={busy || remaining === 0 || !bidTeam}><Hammer /> PLACE BID</Button>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="destructive" onClick={handleUnsold} disabled={busy}>UNSOLD</Button>
                <Button variant="default" className="bg-emerald-600 hover:bg-emerald-500" onClick={handleSell} disabled={busy || !currentBid}>SELL @ {currentBid ? formatCompact(floor) : '—'}</Button>
              </div>
            </div>
          </>
        ) : (
          <div className="grid gap-3">
            <div className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">
              {live
                ? (poolPlayers.length ? 'No lot on stage. Open the next player below.' : 'Lot queue empty — all players processed.')
                : 'Session is not live. Edit status to LIVE or start a new session.'}
            </div>
            {live && poolPlayers.length > 0 && (
              <div className="grid gap-2 rounded-xl border bg-background p-3">
                <Label className="text-[10px] font-bold tracking-widest text-muted-foreground">OPEN NEXT LOT</Label>
                <Select value={nextPlayerId} onValueChange={setNextPlayerId}>
                  <SelectTrigger><SelectValue placeholder={poolPlayers[0]?.name ?? 'No pool players'} /></SelectTrigger>
                  <SelectContent>
                    {poolPlayers.map((player) => (
                      <SelectItem key={player.player_id} value={player.player_id}>#{player.lot_order} {player.name} · base {formatCompact(player.base_price)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="grid gap-1.5">
                  <Label className="text-[10px] font-bold tracking-widest text-muted-foreground">BASE PRICE ₹</Label>
                  <div className="flex gap-2">
                    <Input type="number" min={0} placeholder="e.g. 100000" value={base} onChange={(e) => setBase(e.target.value)} />
                    {[100000, 300000, 500000].map((b) => <Button key={b} type="button" size="sm" variant="outline" onClick={() => setBase(String(b))}>{formatCompact(b)}</Button>)}
                  </div>
                </div>
                <Button onClick={handleOpenNext} disabled={busy}><Play /> PUT ON STAGE</Button>
              </div>
            )}
          </div>
        )}

        {(state?.bids?.length ?? 0) > 0 && (
          <div className="rounded-xl border bg-background/60 p-3">
            <p className="mb-2 text-[10px] font-bold tracking-widest text-muted-foreground">RECENT BIDS</p>
            <ul className="grid gap-1 text-sm">
              {(state?.bids ?? []).slice(0, 8).map((bid, index) => (
                <li key={`${bid.created_at}-${index}`} className="flex items-center justify-between gap-2 border-b border-border/50 pb-1 last:border-0">
                  <span className="truncate"><b className="font-bold">{bid.team_code}</b> · {bid.player_name}</span>
                  <b className="shrink-0 tabular-nums">{formatCompact(bid.amount)}</b>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex items-center justify-between border-t pt-3">
          <Button size="sm" variant="outline" onClick={undoLast} disabled={busy}><Undo2 /> UNDO LAST RESULT</Button>
          <span className="text-xs text-muted-foreground">
            {players.filter((p) => p.source === 'retained').length} RETAINED · {players.filter((p) => p.source !== 'retained' && p.status === 'sold').length} SOLD · {players.filter((p) => p.status === 'unsold').length} UNSOLD · {poolPlayers.length} POOL
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Lot queue + results (with undo)
// ---------------------------------------------------------------------------

function QueuePanel({ players, teams, current, onChanged }: {
  players: AuctionAdminLot[];
  teams: AuctionAdminState['teams'];
  current: AuctionAdminState['current_player'];
  onChanged: () => Promise<void>;
}) {
  const [tab, setTab] = useState<'all' | 'pool' | 'sold' | 'unsold'>('pool');
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [base, setBase] = useState('');

  const teamName = (id: string | null) => teams.find((t) => t.team_id === id)?.code ?? '—';
  const counts = {
    all: players.length,
    pool: players.filter((p) => p.status === 'pool').length,
    sold: players.filter((p) => p.status === 'sold').length,
    unsold: players.filter((p) => p.status === 'unsold').length,
  };
  const rows = players
    .filter((p) => tab === 'all' || p.status === tab)
    .sort((a, b) => a.lot_order - b.lot_order);

  const openPlayer = async (player: AuctionAdminLot) => {
    const baseNum = Number(base);
    setBusy(true);
    if (base && !Number.isNaN(baseNum)) {
      const res = await auctionSetBase(player.player_id, baseNum);
      if (res.error) { toast.error(res.error); setBusy(false); return; }
    }
    const res = await auctionOpenLot(player.player_id);
    setBusy(false);
    if (res.error) { toast.error(res.error); return; }
    toast.success(`${player.name} is on the stage.`);
    setOpenId(null);
    setBase('');
    await onChanged();
  };

  const openBaseDialog = async (player: AuctionAdminLot) => {
    setOpenId(player.player_id);
    if (player.base_price && player.base_price > 0) {
      setBase(String(player.base_price));
      return;
    }
    const settings = await fetchAuctionSettings();
    setBase(settings && settings.default_base ? String(settings.default_base) : '');
  };

  const undoPlayer = async (player: AuctionAdminLot) => {
    if (player.source === 'retained') { toast.error('Retained players can’t be undone.'); return; }
    if (!window.confirm(`Undo ${player.name} (${player.status})? Back to pool.`)) return;
    const res = await auctionUndo(player.player_id);
    if (res.error) toast.error(res.error); else toast.success('Undone.');
    await onChanged();
  };

  return (
    <Card className="min-w-0">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-base">
          <span>LOT QUEUE · {counts.all}</span>
          <div className="flex gap-1">
            {(['all', 'pool', 'sold', 'unsold'] as const).map((key) => (
              <Button key={key} size="sm" variant={tab === key ? 'default' : 'ghost'} className="h-7 px-2 text-[11px]" onClick={() => setTab(key)}>
                {key.toUpperCase()} {counts[key]}
              </Button>
            ))}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Nothing here.</p>
        ) : (
          <div className="max-h-[340px] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card text-left text-[10px] uppercase tracking-widest text-muted-foreground">
                <tr>
                  <th className="px-2 py-1.5">#</th>
                  <th className="px-2 py-1.5">Player</th>
                  <th className="px-2 py-1.5 text-right">Base</th>
                  <th className="px-2 py-1.5 text-right">Result</th>
                  <th className="px-2 py-1.5" />
                </tr>
              </thead>
              <tbody>
                {rows.map((player) => {
                  const isCurrent = current?.player_id === player.player_id;
                  return (
                    <tr key={player.player_id} className={`border-t border-border/60 ${isCurrent ? 'bg-amber-500/10' : ''}`}>
                      <td className="px-2 py-1.5 tabular-nums text-muted-foreground">{player.lot_order}</td>
                      <td className="max-w-[200px] truncate px-2 py-1.5 font-semibold">
                        {player.name} {isCurrent && <span className="ml-1 text-[10px] font-bold text-amber-600">ON STAGE</span>}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{formatCompact(player.base_price)}</td>
                      <td className="px-2 py-1.5 text-right">
                        {player.status === 'sold' && player.source === 'retained' && <span className="font-bold text-amber-500">★ RETAINED · {teamName(player.sold_to_team_id)} · {formatCompact(player.sold_price ?? 0)}</span>}
                        {player.status === 'sold' && player.source !== 'retained' && <span className="text-emerald-600">{teamName(player.sold_to_team_id)} · {formatCompact(player.sold_price ?? 0)}</span>}
                        {player.status === 'unsold' && <span className="text-rose-500">UNSOLD</span>}
                        {player.status === 'pool' && <span className="text-muted-foreground">—</span>}
                        {player.status === 'on_auction' && <span className="font-bold text-amber-600">LIVE</span>}
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        {player.status === 'pool' && (
                          <Button size="sm" variant="outline" className="h-7 px-2" disabled={busy} onClick={() => void openBaseDialog(player)}>OPEN</Button>
                        )}
                        {(player.status === 'sold' || player.status === 'unsold') && player.source !== 'retained' && (
                          <Button size="sm" variant="ghost" className="h-7 px-2" disabled={busy} onClick={() => void undoPlayer(player)}><Undo2 /></Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>

      <Dialog open={openId !== null} onOpenChange={(o) => { if (!o) setOpenId(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>OPEN LOT</DialogTitle>
            <DialogDescription>Set base price (optional), then put the player on the stage.</DialogDescription>
          </DialogHeader>
          {(() => {
            const player = players.find((p) => p.player_id === openId);
            if (!player) return null;
            return (
              <div className="grid gap-3">
                <p className="font-black italic">{player.name}</p>
                <div className="grid gap-1.5">
                  <Label>BASE PRICE ₹</Label>
                  <Input type="number" min={0} value={base} onChange={(e) => setBase(e.target.value)} />
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setOpenId(null)}>CANCEL</Button>
                  <Button onClick={() => void openPlayer(player)} disabled={busy}>{busy ? 'OPENING…' : 'OPEN LOT'}</Button>
                </DialogFooter>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Teams + purses
// ---------------------------------------------------------------------------

function TeamsPanel({ teams }: { teams: AuctionAdminState['teams'] }) {
  return (
    <Card className="min-w-0">
      <CardHeader className="pb-2"><CardTitle className="text-base">TEAM PURSES</CardTitle></CardHeader>
      <CardContent>
        {teams.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">No teams in this session yet.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
            {teams.map((team) => {
              const balance = team.budget - team.spent;
              const pct = team.budget > 0 ? Math.max(0, Math.min(100, (balance / team.budget) * 100)) : 0;
              return (
                <div key={team.team_id} className="rounded-xl border bg-background/60 p-3">
                  <div className="flex items-center gap-2">
                    {team.icon_url ? <img src={resolveAsset(team.icon_url)} alt="" className="size-6 rounded-full object-cover" /> : <div className="grid size-6 place-items-center rounded-full bg-gradient-to-br from-cyan-500 to-purple-500 text-[10px] font-black text-white">{team.code?.slice(0, 2)}</div>}
                    <b className="truncate">{team.code || team.name}</b>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} /></div>
                  <div className="mt-1.5 flex items-center justify-between text-xs text-muted-foreground">
                    <span><b className="text-foreground">{formatCompact(balance)}</b> left</span>
                    <span>{team.squad}/11</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Schedule: set the target auction start date/time (public board shows countdown)
// ---------------------------------------------------------------------------

function AuctionSettingsButton({ session, onSaved }: {
  session: NonNullable<AuctionAdminState['session']> | null;
  onSaved?: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [retention, setRetention] = useState('');
  const [purse, setPurse] = useState('');
  const [increment, setIncrement] = useState('');
  const [timer, setTimer] = useState('');
  const [defaultBase, setDefaultBase] = useState('');
  const [busy, setBusy] = useState(false);

  const openDialog = async () => {
    const settings = await fetchAuctionSettings();
    if (settings) {
      setRetention(String(settings.retention_price));
      setPurse(String(settings.purse));
      setIncrement(String(settings.increment));
      setTimer(String(settings.timer));
      setDefaultBase(String(settings.default_base));
    }
    setOpen(true);
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    const payload = {
      retention_price: Number(retention) || 0,
      purse: Number(purse) || 0,
      increment: Number(increment) || 0,
      timer: Math.max(10, Number(timer) || 60),
      default_base: Math.max(0, Number(defaultBase) || 0),
    };
    setBusy(true);
    const res = await saveAuctionSettings(payload);
    if (res.error) { toast.error(res.error); setBusy(false); return; }

    let applied = 'Saved for the next NEW session.';
    if (session) {
      // apply purse / increment / timer to the current session
      const upd = await auctionUpdateSession({
        session: session.id,
        name: session.name,
        purse: payload.purse,
        increment: payload.increment,
        timer: payload.timer,
        status: session.status,
      });
      if (upd.error) { toast.error(`Settings saved, but session update failed: ${upd.error}`); }
      // refresh retained cost + pool from the new retention setting
      const sync = await auctionResyncPool(session.id);
      applied = upd.error
        ? 'Settings saved. Session NOT updated.'
        : `Applied to “${session.name}” (purse ₹${payload.purse}, inc ${payload.increment}, timer ${payload.timer}s). Retention + pool resynced.`;
      void sync;
    }
    setBusy(false);
    setOpen(false);
    toast.success(applied);
    await onSaved?.();
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => void openDialog()}>
        ⚙ AUCTION SETTINGS
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>AUCTION SETTINGS</DialogTitle>
            <DialogDescription>
              {session
                ? 'Saving applies purse/increment/timer to the current session, resyncs retained cost + pool.'
                : 'Defaults used when starting a NEW session. No session exists yet.'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={save} className="grid gap-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>RETAINED PLAYER COST ₹</Label>
                <Input type="number" min={0} value={retention} onChange={(e) => setRetention(e.target.value)} required />
              </div>
              <div className="grid gap-1.5">
                <Label>LOT TIMER (S)</Label>
                <Input type="number" min={10} value={timer} onChange={(e) => setTimer(e.target.value)} required />
              </div>
              <div className="grid gap-1.5">
                <Label>DEFAULT TEAM PURSE ₹</Label>
                <Input type="number" min={0} value={purse} onChange={(e) => setPurse(e.target.value)} required />
              </div>
              <div className="grid gap-1.5">
                <Label>DEFAULT INCREMENT ₹</Label>
                <Input type="number" min={0} value={increment} onChange={(e) => setIncrement(e.target.value)} required />
              </div>
              <div className="col-span-2 grid gap-1.5">
                <Label>DEFAULT PLAYER BASE PRICE ₹</Label>
                <Input type="number" min={0} value={defaultBase} onChange={(e) => setDefaultBase(e.target.value)} required placeholder="Used when a lot has no explicit base" />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>CANCEL</Button>
              <Button type="submit" disabled={busy}>{busy ? 'SAVING…' : 'SAVE'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ScheduleButton() {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [current, setCurrent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const openDialog = async () => {
    const scheduled = await fetchAuctionSchedule();
    setCurrent(scheduled);
    setValue(toDatetimeLocal(scheduled));
    setOpen(true);
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    const iso = fromDatetimeLocal(value);
    setBusy(true);
    const res = await saveAuctionSchedule(iso);
    setBusy(false);
    if (res.error) { toast.error(res.error); return; }
    setCurrent(iso);
    setOpen(false);
    toast.success(iso ? `Public board will count down to ${new Date(iso).toLocaleString()} on /auction.` : 'Schedule cleared.');
  };

  const clear = async () => {
    setBusy(true);
    const res = await saveAuctionSchedule(null);
    setBusy(false);
    if (res.error) { toast.error(res.error); return; }
    setCurrent(null);
    setValue('');
    toast.success('Schedule cleared.');
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => void openDialog()}>
        ⏱ SCHEDULE START
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>AUCTION START TIME</DialogTitle>
            <DialogDescription>The public board will show a live countdown to this moment instead of the idle screen.</DialogDescription>
          </DialogHeader>
          <form onSubmit={save} className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="au-sched">TARGET DATE &amp; TIME</Label>
              <Input id="au-sched" type="datetime-local" value={value} onChange={(e) => setValue(e.target.value)} />
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{current ? `Currently set: ${new Date(current).toLocaleString()}` : 'No start time set yet.'}</span>
              {current && (
                <button type="button" className="font-bold text-destructive underline-offset-2 hover:underline" onClick={() => void clear()}>
                  CLEAR
                </button>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>CANCEL</Button>
              <Button type="submit" disabled={busy}>{busy ? 'SAVING…' : 'SAVE'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
