import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Hammer, Play, Flag, RotateCcw, Undo2, TimerReset, ExternalLink, Gavel, Pencil, Trash2, Search, Shuffle } from 'lucide-react';
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
  auctionEditResult,
  auctionDeleteLot,
  formatCompact,
  formatInr,
  incrementFor,
  bidLadder,
  DEFAULT_INCREMENT_TIERS,
  type AuctionAdminState,
  type AuctionAdminLot,
  type AuctionIncrementTiers,
  type AuctionSettings,
} from '@/lib/auction';

const DEFAULT_PURSE = 5000000;
const DEFAULT_INCREMENT = 10;
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
  const [settings, setSettings] = useState<AuctionSettings | null>(null);

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
    void fetchAuctionSettings().then((s) => { if (alive && s) setSettings(s); });
    const id = window.setInterval(() => void tick(), 3000);
    return () => { alive = false; window.clearInterval(id); };
  }, [phase]);

  const refresh = useCallback(async () => {
    const next = await fetchAdminAuctionState();
    if (next) { setDataError(false); setData(next); }
  }, []);

  const reloadSettings = useCallback(async () => {
    const next = await fetchAuctionSettings();
    if (next) setSettings(next);
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.all([refresh(), reloadSettings()]);
  }, [refresh, reloadSettings]);

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
  const tiers = settings?.tiers ?? DEFAULT_INCREMENT_TIERS;
  const femaleQuota = settings?.female_quota ?? 2;
  const floor = Math.max(currentBid?.amount ?? 0, current?.base_price ?? 0, 0);

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
      <main className="w-full px-4 py-5 sm:px-6">
        <ControlHeader
          session={session}
          dataError={dataError}
          onChanged={refreshAll}
          onStart={async (args) => {
            const res = await auctionStartSession(args);
            if (res.error) { toast.error(res.error); return; }
            toast.success('Auction session started.');
            await refreshAll();
          }}
          onUpdate={async (args) => {
            const res = await auctionUpdateSession({ session: session!.id, ...args });
            if (res.error) { toast.error(res.error); return; }
            toast.success('Session updated.');
            await refreshAll();
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
                  await refreshAll();
                }}
              />
            </CardContent>
          </Card>
        ) : (
          <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(190px,15%)_minmax(0,1fr)_minmax(250px,21%)]">
            <div className="order-2 min-w-0 lg:order-1">
              <TeamsRail
                teams={teams}
                players={players}
                squadSize={data?.squad_size ?? 11}
                femaleQuota={femaleQuota}
                currentBid={currentBid}
                floor={floor}
              />
            </div>
            <div className="order-1 min-w-0 lg:order-2">
              <StagePanel
                session={session}
                state={data}
                current={current}
                currentBid={currentBid}
                players={players}
                teams={teams}
                tiers={tiers}
                femaleQuota={femaleQuota}
                onChanged={refreshAll}
              />
            </div>
            <div className="order-3 min-w-0">
              <QueuePanel
                players={players}
                teams={teams}
                current={current}
                defaultBase={settings?.default_base ?? 0}
                onChanged={refreshAll}
              />
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

function StagePanel({ session, state, current, currentBid, players, teams, tiers, femaleQuota, onChanged }: {
  session: NonNullable<AuctionAdminState['session']>;
  state: AuctionAdminState | null;
  current: AuctionAdminState['current_player'];
  currentBid: AuctionAdminState['current_bid'];
  players: AuctionAdminLot[];
  teams: AuctionAdminState['teams'];
  tiers: AuctionIncrementTiers;
  femaleQuota: number;
  onChanged: () => Promise<void>;
}) {
  const live = session.status === 'live';
  const [amount, setAmount] = useState('');
  const [nextPlayerId, setNextPlayerId] = useState<string>('');
  const [base, setBase] = useState('');
  const [busy, setBusy] = useState(false);
  const [autoNext, setAutoNext] = useState<boolean>(() => {
    try { const v = window.localStorage.getItem('dpl.auction.autoNext'); return v === null ? true : v === '1'; } catch { return true; }
  });
  const [timeUp, setTimeUp] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [drawName, setDrawName] = useState('');
  const drawTimers = useRef<number[]>([]);
  const promptedRef = useRef<string | null>(null);
  const remaining = useCountdown(current?.timer_ends_at);

  useEffect(() => {
    try { window.localStorage.setItem('dpl.auction.autoNext', autoNext ? '1' : '0'); } catch { /* ignore */ }
  }, [autoNext]);

  const poolPlayers = useMemo(() => players.filter((p) => p.status === 'pool').sort((a, b) => a.lot_order - b.lot_order), [players]);
  const floor = Math.max(currentBid?.amount ?? 0, current?.base_price ?? 0, 0);
  const ladder = useMemo(() => bidLadder(floor, tiers, 8), [floor, tiers]);
  const minNext = ladder[0] ?? floor + incrementFor(floor, tiers);
  const staged = Number(amount) || minNext;
  const squadSize = state?.squad_size ?? 11;
  const leaderId = currentBid?.team_id ?? null;
  const leader = teams.find((t) => t.team_id === leaderId) ?? null;
  const currentIsFemale = current?.gender === 'Female';

  // Female players already bought per team (retained + auction).
  const femaleByTeam = useMemo(() => {
    const map: Record<string, number> = {};
    for (const p of players) {
      if (p.status === 'sold' && p.gender === 'Female' && p.sold_to_team_id) {
        map[p.sold_to_team_id] = (map[p.sold_to_team_id] ?? 0) + 1;
      }
    }
    return map;
  }, [players]);

  const femalesOf = (team: AuctionAdminState['teams'][number]) => femaleByTeam[team.team_id] ?? 0;
  const femaleNeed = (team: AuctionAdminState['teams'][number]) => Math.max(0, femaleQuota - femalesOf(team));
  // Buying a male uses a slot; must keep enough slots open to still reach the female quota.
  const quotaBlocksMale = (team: AuctionAdminState['teams'][number]) =>
    !currentIsFemale && (squadSize - team.squad - 1) < femaleNeed(team);

  // Keep the staged amount one step ahead of the floor as bidding progresses.
  useEffect(() => { setAmount(String(minNext)); }, [minNext]);

  const act = async (label: string, fn: () => Promise<{ error?: string }>) => {
    setBusy(true);
    const res = await fn();
    setBusy(false);
    if (res.error) { toast.error(res.error); return false; }
    toast.success(label);
    await onChanged();
    return true;
  };

  const teamBalance = (team: AuctionAdminState['teams'][number]) => team.budget - team.spent;
  const canTeamBid = (team: AuctionAdminState['teams'][number]) =>
    Boolean(live && current) && team.squad < squadSize && teamBalance(team) > floor && !quotaBlocksMale(team);
  // How many teams can actually afford (and are allowed to) bid a given amount.
  const affordableCount = (value: number) =>
    teams.filter((t) => teamBalance(t) >= value && t.squad < squadSize && (currentIsFemale || (squadSize - t.squad - 1) >= femaleNeed(t))).length;

  const bidWith = async (team: AuctionAdminState['teams'][number], value: string | number) => {
    if (!live || !current) { toast.error('No lot on the stage.'); return; }
    const amt = Number(value) || minNext;
    if (amt <= floor) { toast.error(`Bid must exceed ${formatInr(floor)}.`); return; }
    if (team.squad >= squadSize) { toast.error(`${team.code} squad is full (${squadSize}).`); return; }
    if (quotaBlocksMale(team)) { toast.error(`${team.code} must still sign ${femaleNeed(team)} female player(s).`); return; }
    if (amt > teamBalance(team)) { toast.error(`Budget exceeded — ${formatCompact(teamBalance(team))} left.`); return; }
    await act(`${team.code} bids ${formatInr(amt)}`, () => auctionBid(team.team_id, amt));
  };

  const openLotDirect = async (player: AuctionAdminLot) => {
    await act(`On stage: ${player.name}`, () => auctionOpenLot(player.player_id));
  };

  const pickRandom = () => (poolPlayers.length ? poolPlayers[Math.floor(Math.random() * poolPlayers.length)] : null);

  const clearDrawTimers = () => {
    drawTimers.current.forEach((t) => { window.clearInterval(t); window.clearTimeout(t); });
    drawTimers.current = [];
  };

  // Lucky-dip: shuffle names for suspense, then open the drawn lot.
  const startDraw = () => {
    if (!live) { toast.error('Session is not live.'); return; }
    if (poolPlayers.length === 0) { toast.error('No pool players left.'); return; }
    const pick = pickRandom()!;
    clearDrawTimers();
    setDrawName(poolPlayers[Math.floor(Math.random() * poolPlayers.length)].name);
    setDrawing(true);
    const shuffle = window.setInterval(() => {
      const p = poolPlayers[Math.floor(Math.random() * poolPlayers.length)];
      setDrawName(p.name);
    }, 70);
    drawTimers.current.push(shuffle);
    drawTimers.current.push(window.setTimeout(() => {
      window.clearInterval(shuffle);
      setDrawName(pick.name);
    }, 1400));
    drawTimers.current.push(window.setTimeout(() => {
      setDrawing(false);
      void openLotDirect(pick);
    }, 2050));
  };

  useEffect(() => () => {
    drawTimers.current.forEach((t) => { window.clearInterval(t); window.clearTimeout(t); });
  }, []);

  const handleSell = async () => {
    if (!current || !leader) { toast.error('No bid to sell to.'); return; }
    if (quotaBlocksMale(leader)) { toast.error(`${leader.code} must still sign ${femaleNeed(leader)} female player(s).`); return; }
    const upcoming = pickRandom();
    const ok = await act(`Sold to ${leader.code}`, () => auctionSell(current.player_id, leader.team_id, floor));
    if (ok && autoNext && upcoming) await openLotDirect(upcoming);
  };

  const handleUnsold = async () => {
    if (!current) return;
    const upcoming = pickRandom();
    const ok = await act('Marked unsold', () => auctionUnsold(current.player_id));
    if (ok && autoNext && upcoming) await openLotDirect(upcoming);
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

  // Fastest-finger keyboard controls (ignored while typing or a dialog is open).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!live || drawing) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      if (document.querySelector('[role="dialog"][data-state="open"]')) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key;
      if (k === 'Enter') {
        if (!current && poolPlayers[0]) { e.preventDefault(); startDraw(); }
        return;
      }
      if (k === 's' || k === 'S') { e.preventDefault(); void handleSell(); return; }
      if (k === 'u' || k === 'U') { e.preventDefault(); void handleUnsold(); return; }
      if (k === '+' || k === '=') { e.preventDefault(); void handleExtend(15); return; }
      if (k === '-' || k === '_') { e.preventDefault(); void handleExtend(30); return; }
      if (/^([1-9]|0)$/.test(k) && current) {
        const team = teams[k === '0' ? 9 : Number(k) - 1];
        if (team) { e.preventDefault(); void bidWith(team, amount); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // When the lot timer hits 0, prompt the admin once per lot.
  useEffect(() => {
    if (!live || !current) return;
    if (remaining === null || remaining > 0) return;
    const key = `${current.player_id}:${current.timer_ends_at ?? ''}`;
    if (promptedRef.current === key) return;
    promptedRef.current = key;
    setTimeUp(true);
  }, [live, current, remaining]);

  return (
    <Card className="min-w-0 gap-3 py-4">
      <CardHeader className="px-4 pb-2">
        <CardTitle className="flex items-center justify-between text-base">
          <span className="flex items-center gap-2"><Hammer /> STAGE</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setAutoNext((v) => !v)}
              aria-pressed={autoNext}
              title="After a sale/unsold, automatically open the next lot"
              className={`inline-flex cursor-pointer select-none items-center gap-1.5 rounded-md border px-2 py-0.5 text-[10px] font-bold transition-all active:scale-95 ${
                autoNext
                  ? 'border-emerald-500 bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/25'
                  : 'border-border bg-muted/40 text-muted-foreground hover:bg-accent'
              }`}
            >
              <span className={`size-1.5 rounded-full transition-colors ${autoNext ? 'bg-emerald-500' : 'bg-muted-foreground'}`} />
              AUTO-NEXT {autoNext ? 'ON' : 'OFF'}
            </button>
            {current && <LotBadge status="on_auction" />}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 px-4">
        {current && live ? (
          <>
            <div className="flex items-center gap-4 rounded-xl border bg-background p-3">
              <div className="size-20 shrink-0 overflow-hidden rounded-xl bg-gradient-to-br from-cyan-500 via-blue-500 to-purple-500">
                {current.photo_url
                  ? <img src={current.photo_url} alt="" className="size-full object-cover" />
                  : <div className="grid size-full place-items-center text-xl font-black italic text-white">{initials(current.name)}</div>}
              </div>
              <div className="min-w-0">
                <p className="truncate text-2xl font-black italic leading-tight">{current.name}</p>
                <p className="text-xs text-muted-foreground">
                  LOT #{current.lot_order} · {current.player_type} · {current.location} · {current.self_rating}.0 ★ · Base {formatCompact(current.base_price)}
                </p>
              </div>
              <div className="ml-auto flex items-center gap-5">
                <div className="text-right">
                  <p className="text-[10px] font-bold tracking-widest text-muted-foreground">HIGH BID</p>
                  <p className={`text-4xl font-black leading-none ${currentBid ? 'text-emerald-500' : 'text-foreground'}`}>{formatCompact(currentBid?.amount ?? current.base_price)}</p>
                  <p className="mt-1 text-xs font-bold text-muted-foreground">{leader ? leader.code : 'no bids yet'}</p>
                </div>
                {remaining != null && (
                  <div className={`shrink-0 text-right ${remaining <= 10 ? 'text-destructive' : ''}`}>
                    <p className="text-[10px] font-bold tracking-widest text-muted-foreground">CLOSES</p>
                    <p className="text-4xl font-black leading-none tabular-nums">{remaining}s</p>
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold tracking-widest text-muted-foreground">NEXT BID</span>
              <div className="flex flex-wrap gap-1.5">
                {ladder.map((value) => {
                  const canAfford = affordableCount(value);
                  return (
                    <Button
                      key={value}
                      type="button"
                      size="sm"
                      variant={Number(amount) === value ? 'default' : 'secondary'}
                      className="h-8 tabular-nums"
                      disabled={canAfford === 0}
                      title={canAfford === 0 ? 'No eligible team can afford this' : `${canAfford} team(s) can bid this`}
                      onClick={() => setAmount(String(value))}
                    >
                      {formatCompact(value)}
                      <span className="ml-1 text-[9px] font-bold opacity-70">{canAfford}</span>
                    </Button>
                  );
                })}
              </div>
              <Input
                type="number"
                min={floor + 1}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="ml-auto h-8 w-28 tabular-nums"
                placeholder={`min ${floor + 1}`}
              />
              <Button size="sm" variant="outline" className="h-8" disabled={busy} onClick={() => handleExtend(15)}><TimerReset /> +15s</Button>
              <Button size="sm" variant="outline" className="h-8" disabled={busy} onClick={() => handleExtend(30)}><TimerReset /> +30s</Button>
            </div>

            <div className="grid gap-1.5 rounded-xl border bg-background p-3">
              <Label className="flex items-center justify-between text-[10px] font-bold tracking-widest text-muted-foreground">
                <span>TAP A TEAM TO BID {formatInr(Number(amount) || minNext)} · {teams.length} TEAMS</span>
                {femaleQuota > 0 && <span className="text-pink-500">♀ MIN {femaleQuota} / TEAM</span>}
              </Label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                {teams.map((team) => {
                  const isLeader = team.team_id === leaderId;
                  const need = femaleNeed(team);
                  const overMax = staged > teamBalance(team);
                  const disabled = busy || !canTeamBid(team) || overMax;
                  return (
                    <Button
                      key={team.team_id}
                      type="button"
                      variant={isLeader ? 'default' : 'outline'}
                      className={`h-auto flex-col items-start gap-0.5 py-2 ${isLeader ? 'bg-emerald-600 hover:bg-emerald-500' : ''}`}
                      disabled={disabled}
                      title={
                        overMax ? `Max bid ${formatCompact(teamBalance(team))} — staged bid is higher`
                        : need > 0 ? `${team.code} still needs ${need} female player(s)`
                        : `${team.code} female quota met`
                      }
                      onClick={() => void bidWith(team, amount)}
                    >
                      <span className="flex w-full items-center justify-between gap-1 text-sm font-black">
                        <span className="truncate">{team.code || team.name}</span>
                        {isLeader && <span className="text-[9px] font-bold opacity-90">TOP</span>}
                      </span>
                      <span className="text-[9px] font-semibold opacity-80">
                        MAX {formatCompact(teamBalance(team))} · {team.squad}/{squadSize} · ♀{femalesOf(team)}/{femaleQuota}
                      </span>
                      {!currentIsFemale && need > 0 && (
                        <span className="text-[8px] font-bold text-pink-500">♀ NEED {need}</span>
                      )}
                    </Button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Button variant="destructive" onClick={handleUnsold} disabled={busy}>UNSOLD</Button>
              <Button className="bg-emerald-600 hover:bg-emerald-500" onClick={handleSell} disabled={busy || !leader}>
                {leader ? `SELL ${formatCompact(floor)} → ${leader.code}` : 'SELL (no bid)'}
              </Button>
            </div>
          </>
        ) : (
          <div className="grid gap-3">
            <div className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">
              {live
                ? (poolPlayers.length ? 'No lot on stage. Draw the next lot below.' : 'Lot queue empty — all players processed.')
                : 'Session is not live. Edit status to LIVE or start a new session.'}
            </div>
            {live && poolPlayers.length > 0 && (
              <div className="grid gap-2 rounded-xl border bg-background p-3">
                <Button onClick={startDraw} disabled={busy} className="h-12 text-sm font-black tracking-widest">
                  <Shuffle /> DRAW RANDOM LOT
                </Button>
                <details className="text-xs">
                  <summary className="cursor-pointer select-none text-[10px] font-bold tracking-widest text-muted-foreground">OR PICK MANUALLY</summary>
                  <div className="mt-2 grid gap-2">
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
                        <Input type="number" min={0} placeholder="e.g. 20" value={base} onChange={(e) => setBase(e.target.value)} />
                        {[20, 50, 100].map((b) => <Button key={b} type="button" size="sm" variant="outline" onClick={() => setBase(String(b))}>{formatCompact(b)}</Button>)}
                      </div>
                    </div>
                    <Button onClick={handleOpenNext} disabled={busy}><Play /> PUT ON STAGE</Button>
                  </div>
                </details>
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[9px] text-muted-foreground">
          <span className="font-bold tracking-widest">KEYS</span>
          <span><b className="text-foreground">ENTER</b> draw</span>
          <span><b className="text-foreground">1–9/0</b> team bid</span>
          <span><b className="text-foreground">S</b> sell</span>
          <span><b className="text-foreground">U</b> unsold</span>
          <span><b className="text-foreground">+/−</b> extend</span>
        </div>

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

      <Dialog open={timeUp} onOpenChange={setTimeUp}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>TIME&apos;S UP</DialogTitle>
            <DialogDescription>
              {current ? `Lot time ended for ${current.name}. Mark unsold or extend the clock?` : 'Lot time ended.'}
            </DialogDescription>
          </DialogHeader>
          {current && (
            <div className="rounded-lg border bg-background p-3 text-sm">
              {leader
                ? <span><b>{leader.code}</b> leads at <b className="text-emerald-600">{formatCompact(floor)}</b></span>
                : <span className="text-muted-foreground">No bids yet · base {formatCompact(current.base_price)}</span>}
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Button className="col-span-2 bg-emerald-600 hover:bg-emerald-500" disabled={busy || !leader} onClick={() => { setTimeUp(false); void handleSell(); }}>
              {leader ? `SELL ${formatCompact(floor)} → ${leader.code}` : 'SELL (no bid)'}
            </Button>
            <Button variant="destructive" disabled={busy} onClick={() => { setTimeUp(false); void handleUnsold(); }}>UNSOLD</Button>
            <Button variant="outline" disabled={busy} onClick={() => { setTimeUp(false); void handleExtend(30); }}><TimerReset /> +30s</Button>
            <Button variant="outline" className="col-span-2" disabled={busy} onClick={() => { setTimeUp(false); void handleExtend(60); }}><TimerReset /> +60s</Button>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setTimeUp(false)}>KEEP OPEN</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {drawing && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-3xl border border-primary/40 bg-background p-10 text-center shadow-2xl">
            <p className="text-xs font-black tracking-[0.35em] text-primary">DRAWING NEXT LOT</p>
            <div className="my-8 grid place-items-center">
              <Shuffle className="mb-4 size-6 animate-spin text-muted-foreground" />
              <p className="min-h-[2.5rem] text-4xl font-black italic tabular-nums">{drawName || '—'}</p>
            </div>
            <p className="text-xs text-muted-foreground">Lucky dip — good luck teams!</p>
          </div>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Lot queue + results (with undo)
// ---------------------------------------------------------------------------

function QueuePanel({ players, teams, current, defaultBase, onChanged }: {
  players: AuctionAdminLot[];
  teams: AuctionAdminState['teams'];
  current: AuctionAdminState['current_player'];
  defaultBase: number;
  onChanged: () => Promise<void>;
}) {
  const [tab, setTab] = useState<'all' | 'pool' | 'sold' | 'unsold'>('pool');
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [base, setBase] = useState('');
  const [manageId, setManageId] = useState<string | null>(null);
  const [editTeam, setEditTeam] = useState('');
  const [editPrice, setEditPrice] = useState('');
  const [q, setQ] = useState('');
  const [hideRetained, setHideRetained] = useState(true);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
      if (e.key === '/' && !typing && !document.querySelector('[role="dialog"][data-state="open"]')) {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === 'Escape' && document.activeElement === searchRef.current) {
        setQ('');
        searchRef.current?.blur();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const teamName = (id: string | null) => teams.find((t) => t.team_id === id)?.code ?? '—';
  const visible = players.filter((p) => !hideRetained || p.source !== 'retained');
  const retainedCount = players.filter((p) => p.source === 'retained').length;
  const counts = {
    all: visible.length,
    pool: visible.filter((p) => p.status === 'pool').length,
    sold: visible.filter((p) => p.status === 'sold').length,
    unsold: visible.filter((p) => p.status === 'unsold').length,
  };
  const query = q.trim().toLowerCase();
  const rows = visible
    .filter((p) => {
      if (query) {
        // A search spans all statuses so you can find any lot by name / # / team.
        return p.name.toLowerCase().includes(query)
          || String(p.lot_order) === query
          || (p.sold_to_team_id ? teamName(p.sold_to_team_id).toLowerCase().includes(query) : false);
      }
      return tab === 'all' || p.status === tab;
    })
    .sort((a, b) => {
      // SOLD tab: most recently sold first. Everything else: lot order.
      if (!query && tab === 'sold') {
        return new Date(b.updated_at ?? 0).getTime() - new Date(a.updated_at ?? 0).getTime();
      }
      return a.lot_order - b.lot_order;
    });

  const openDirect = async (player: AuctionAdminLot) => {
    setBusy(true);
    const res = await auctionOpenLot(player.player_id);
    setBusy(false);
    if (res.error) { toast.error(res.error); return; }
    toast.success(`${player.name} is on the stage.`);
    await onChanged();
  };

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
    setBusy(true);
    const res = await auctionUndo(player.player_id);
    setBusy(false);
    if (res.error) toast.error(res.error); else toast.success(`${player.name} → pool`);
    await onChanged();
  };

  const openManage = (player: AuctionAdminLot) => {
    setManageId(player.player_id);
    setEditTeam(player.sold_to_team_id ?? '');
    setEditPrice(String(player.sold_price ?? ''));
  };

  const saveEdit = async (player: AuctionAdminLot) => {
    if (!editTeam) { toast.error('Pick a team.'); return; }
    const price = Number(editPrice);
    if (!price || price < 0) { toast.error('Enter a valid price.'); return; }
    setBusy(true);
    const res = await auctionEditResult(player.player_id, editTeam, price);
    setBusy(false);
    if (res.error) { toast.error(res.error); return; }
    toast.success('Result updated.');
    setManageId(null);
    await onChanged();
  };

  const deleteLot = async (player: AuctionAdminLot) => {
    if (!window.confirm(`Delete ${player.name} from this auction entirely?\n\nRemoves the lot, its bids and any sale.`)) return;
    setBusy(true);
    const res = await auctionDeleteLot(player.player_id);
    setBusy(false);
    if (res.error) { toast.error(res.error); return; }
    toast.success('Lot deleted.');
    setManageId(null);
    await onChanged();
  };

  return (
    <Card className="flex min-w-0 flex-col gap-2 py-3">
      <CardHeader className="gap-1.5 px-3 pb-1">
        <CardTitle className="text-base">LOT QUEUE · {counts.all}</CardTitle>
        <div className="flex flex-nowrap items-center gap-1">
          {(['all', 'pool', 'sold', 'unsold'] as const).map((key) => (
            <Button key={key} size="sm" variant={tab === key ? 'default' : 'ghost'} className="h-6 min-w-0 flex-1 whitespace-nowrap px-1 text-[9px]" onClick={() => setTab(key)}>
              {key.toUpperCase()} {counts[key]}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name / lot # / team  (/)"
              className="h-7 pl-7 pr-7 text-[11px]"
            />
            {q && (
              <button
                type="button"
                onClick={() => setQ('')}
                title="Clear"
                className="absolute right-1.5 top-1/2 grid size-4 -translate-y-1/2 place-items-center rounded text-muted-foreground hover:text-foreground"
              >
                ×
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => setHideRetained((v) => !v)}
            aria-pressed={!hideRetained}
            title={hideRetained ? 'Show retained players' : 'Hide retained players'}
            className={`shrink-0 rounded-md border px-1.5 py-1 text-[9px] font-bold transition-colors ${
              !hideRetained
                ? 'border-amber-500 bg-amber-500/15 text-amber-600'
                : 'border-border bg-muted/40 text-muted-foreground hover:bg-accent'
            }`}
          >
            ★ {retainedCount}
          </button>
        </div>
      </CardHeader>
      <CardContent className="min-h-0 flex-1 px-3">
        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{query ? 'No matches.' : 'Nothing here.'}</p>
        ) : (
          <div className="max-h-[calc(100vh-15rem)] space-y-1 overflow-auto pr-1">
            {rows.map((player) => {
              const isCurrent = current?.player_id === player.player_id;
              const undoable = (player.status === 'sold' || player.status === 'unsold') && player.source !== 'retained';
              const openable = player.status === 'pool';
              const clickable = openable || undoable;
              const onRow = openable ? () => void openDirect(player) : undoable ? () => openManage(player) : undefined;
              const customBase = defaultBase > 0 && player.base_price !== defaultBase;
              const result =
                player.status === 'sold' && player.source === 'retained' ? <span className="font-bold text-amber-500">★ {teamName(player.sold_to_team_id)} · {formatCompact(player.sold_price ?? 0)}</span>
                : player.status === 'sold' ? <span className="font-semibold text-emerald-600">{teamName(player.sold_to_team_id)} · {formatCompact(player.sold_price ?? 0)}</span>
                : player.status === 'unsold' ? <span className="font-semibold text-rose-500">UNSOLD</span>
                : player.status === 'on_auction' ? <span className="font-bold text-amber-600">LIVE</span>
                : null;
              return (
                <div
                  key={player.player_id}
                  role={clickable ? 'button' : undefined}
                  tabIndex={clickable ? 0 : undefined}
                  onClick={onRow}
                  onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onRow?.(); } } : undefined}
                  title={openable ? `Open ${player.name}` : undoable ? `Manage ${player.name}` : undefined}
                  className={`flex items-center gap-1.5 rounded-md border px-1.5 py-1 ${clickable ? 'cursor-pointer hover:border-primary hover:bg-accent/40' : ''} ${isCurrent ? 'border-amber-500 bg-amber-500/10' : ''}`}
                >
                  <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">#{player.lot_order}</span>
                  <span className="truncate text-xs font-bold">{player.name}</span>
                  {customBase && <span className="shrink-0 text-[9px] tabular-nums text-muted-foreground">{formatCompact(player.base_price)}</span>}
                  {result && <span className="ml-auto shrink-0 text-[9px]">{result}</span>}
                  {openable && (
                    <button
                      type="button"
                      title={`Custom base for ${player.name}`}
                      disabled={busy}
                      onClick={(e) => { e.stopPropagation(); void openBaseDialog(player); }}
                      className="ml-auto grid size-6 shrink-0 place-items-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-40"
                    >
                      <Pencil className="size-3.5" />
                    </button>
                  )}
                  {undoable && (
                    <button
                      type="button"
                      title={`Undo ${player.name} → pool`}
                      disabled={busy}
                      onClick={(e) => { e.stopPropagation(); void undoPlayer(player); }}
                      className="ml-auto grid size-6 shrink-0 place-items-center rounded-md border border-border bg-background text-muted-foreground transition-colors hover:border-destructive hover:text-destructive disabled:opacity-40"
                    >
                      <Undo2 className="size-3.5" />
                    </button>
                  )}
                </div>
              );
            })}
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

      <Dialog open={manageId !== null} onOpenChange={(o) => { if (!o) setManageId(null); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>MANAGE RESULT</DialogTitle>
            <DialogDescription>Edit the sale or remove the lot from this auction.</DialogDescription>
          </DialogHeader>
          {(() => {
            const player = players.find((p) => p.player_id === manageId);
            if (!player) return null;
            const sold = player.status === 'sold';
            return (
              <div className="grid gap-3">
                <p className="font-black italic">{player.name}</p>
                {sold ? (
                  <>
                    <div className="grid gap-1.5">
                      <Label>TEAM</Label>
                      <Select value={editTeam} onValueChange={setEditTeam}>
                        <SelectTrigger><SelectValue placeholder="Choose team" /></SelectTrigger>
                        <SelectContent>
                          {teams.map((t) => <SelectItem key={t.team_id} value={t.team_id}>{t.code || t.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-1.5">
                      <Label>SOLD PRICE ₹</Label>
                      <Input type="number" min={0} value={editPrice} onChange={(e) => setEditPrice(e.target.value)} />
                    </div>
                    <DialogFooter className="gap-2">
                      <Button variant="destructive" disabled={busy} onClick={() => void deleteLot(player)}><Trash2 /> DELETE LOT</Button>
                      <Button disabled={busy} onClick={() => void saveEdit(player)}>{busy ? 'SAVING…' : 'SAVE'}</Button>
                    </DialogFooter>
                  </>
                ) : (
                  <>
                    <p className="text-sm text-muted-foreground">This lot is {player.status}. Return it to the pool or delete it from the auction.</p>
                    <DialogFooter className="gap-2">
                      <Button variant="destructive" disabled={busy} onClick={() => void deleteLot(player)}><Trash2 /> DELETE LOT</Button>
                      <Button variant="outline" disabled={busy} onClick={() => { setManageId(null); void undoPlayer(player); }}><Undo2 /> BACK TO POOL</Button>
                    </DialogFooter>
                  </>
                )}
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Teams rail: purse, max bid and status (bidding happens on the stage)
// ---------------------------------------------------------------------------

function TeamsRail({ teams, players, squadSize, femaleQuota, currentBid, floor }: {
  teams: AuctionAdminState['teams'];
  players: AuctionAdminLot[];
  squadSize: number;
  femaleQuota: number;
  currentBid: AuctionAdminState['current_bid'];
  floor: number;
}) {
  const leaderId = currentBid?.team_id ?? null;
  const anyLot = floor > 0;
  const femaleByTeam = useMemo(() => {
    const map: Record<string, number> = {};
    for (const p of players) {
      if (p.status === 'sold' && p.gender === 'Female' && p.sold_to_team_id) {
        map[p.sold_to_team_id] = (map[p.sold_to_team_id] ?? 0) + 1;
      }
    }
    return map;
  }, [players]);

  return (
    <Card className="flex min-w-0 flex-col gap-2 py-3">
      <CardHeader className="px-3 pb-1"><CardTitle className="text-base">TEAMS</CardTitle></CardHeader>
      <CardContent className="px-3">
        {teams.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">No teams in this session yet.</p>
        ) : (
          <div className="space-y-1">
            {teams.map((team) => {
              const purse = team.budget;
              const maxBid = Math.max(0, team.budget - team.spent);
              const isLeader = team.team_id === leaderId;
              const females = femaleByTeam[team.team_id] ?? 0;
              const femaleNeed = Math.max(0, femaleQuota - females);
              const full = team.squad >= squadSize;
              const noBid = anyLot && maxBid <= floor;
              const short = femaleNeed > 0 && (squadSize - team.squad) < femaleNeed;
              const status = full ? 'SQUAD FULL' : noBid ? 'NO BID' : short ? '♀ SHORT' : 'ACTIVE';
              const statusClass = full || noBid || short ? 'text-rose-500' : 'text-emerald-600';
              return (
                <div key={team.team_id} className={`rounded-md border px-1.5 py-1 ${isLeader ? 'border-emerald-500 bg-emerald-500/10' : ''}`}>
                  <div className="flex items-center gap-1">
                    {team.icon_url
                      ? <img src={resolveAsset(team.icon_url)} alt="" className="size-4 shrink-0 rounded-full object-cover" />
                      : <div className="grid size-4 shrink-0 place-items-center rounded-full bg-gradient-to-br from-cyan-500 to-purple-500 text-[8px] font-black text-white">{team.code?.slice(0, 2)}</div>}
                    <b className="truncate text-[11px] leading-tight">{team.code || team.name}</b>
                    {isLeader && <span className="shrink-0 text-[8px] font-bold text-emerald-600">TOP</span>}
                    <span className={`ml-auto shrink-0 text-[8px] font-bold ${statusClass}`}>{status}</span>
                  </div>
                  <div className="mt-0.5 flex items-center justify-between text-[10px] leading-tight">
                    <span className="text-muted-foreground">PURSE <b className="text-foreground tabular-nums">{formatCompact(purse)}</b></span>
                    <span className="text-muted-foreground">MAX BID <b className="text-foreground tabular-nums">{formatCompact(maxBid)}</b></span>
                  </div>
                  <div className="mt-0.5 flex items-center justify-between text-[9px] leading-tight text-muted-foreground">
                    <span>Squad {team.squad}/{squadSize}</span>
                    <span className={femaleNeed > 0 ? 'font-bold text-pink-500' : 'text-emerald-600'}>♀ {females}/{femaleQuota}</span>
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
  const [femaleQuota, setFemaleQuota] = useState('');
  const [t1max, setT1max] = useState('');
  const [t1, setT1] = useState('');
  const [t2max, setT2max] = useState('');
  const [t2, setT2] = useState('');
  const [t3, setT3] = useState('');
  const [busy, setBusy] = useState(false);

  const openDialog = async () => {
    const settings = await fetchAuctionSettings();
    if (settings) {
      setRetention(String(settings.retention_price));
      setPurse(String(settings.purse));
      setIncrement(String(settings.increment));
      setTimer(String(settings.timer));
      setDefaultBase(String(settings.default_base));
      setFemaleQuota(String(settings.female_quota));
      setT1max(String(settings.tiers.tier1_max));
      setT1(String(settings.tiers.tier1));
      setT2max(String(settings.tiers.tier2_max));
      setT2(String(settings.tiers.tier2));
      setT3(String(settings.tiers.tier3));
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
      female_quota: Math.max(0, Number(femaleQuota) || 0),
      tiers: {
        tier1_max: Math.max(1, Number(t1max) || DEFAULT_INCREMENT_TIERS.tier1_max),
        tier1: Math.max(0, Number(t1) || 0),
        tier2_max: Math.max(2, Number(t2max) || DEFAULT_INCREMENT_TIERS.tier2_max),
        tier2: Math.max(0, Number(t2) || 0),
        tier3: Math.max(0, Number(t3) || 0),
      },
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
              <div className="grid gap-1.5">
                <Label>DEFAULT PLAYER BASE PRICE ₹</Label>
                <Input type="number" min={0} value={defaultBase} onChange={(e) => setDefaultBase(e.target.value)} required placeholder="Used when a lot has no explicit base" />
              </div>
              <div className="grid gap-1.5">
                <Label>MIN FEMALE PLAYERS / TEAM</Label>
                <Input type="number" min={0} value={femaleQuota} onChange={(e) => setFemaleQuota(e.target.value)} required />
              </div>
              <div className="col-span-2 mt-1 border-t pt-3 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Bid increments by price band
              </div>
              <div className="grid gap-1.5">
                <Label>BAND 1 UP TO ₹</Label>
                <Input type="number" min={1} value={t1max} onChange={(e) => setT1max(e.target.value)} required />
              </div>
              <div className="grid gap-1.5">
                <Label>BAND 1 STEP ₹</Label>
                <Input type="number" min={0} value={t1} onChange={(e) => setT1(e.target.value)} required />
              </div>
              <div className="grid gap-1.5">
                <Label>BAND 2 UP TO ₹</Label>
                <Input type="number" min={2} value={t2max} onChange={(e) => setT2max(e.target.value)} required />
              </div>
              <div className="grid gap-1.5">
                <Label>BAND 2 STEP ₹</Label>
                <Input type="number" min={0} value={t2} onChange={(e) => setT2(e.target.value)} required />
              </div>
              <div className="col-span-2 grid gap-1.5">
                <Label>ABOVE BAND 2 STEP ₹</Label>
                <Input type="number" min={0} value={t3} onChange={(e) => setT3(e.target.value)} required />
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
