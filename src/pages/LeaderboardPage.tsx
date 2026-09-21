import { useEffect, useMemo, useState } from 'react';
import { Loader2, Trophy } from 'lucide-react';
import SiteHeader from '@/components/SiteHeader';
import HoldScreen from '@/components/HoldScreen';
import { useTheme } from '@/lib/useTheme';
import { fetchLeaderboard, fetchPublicFlags, type Leaderboard, type PublicFlags } from '@/lib/fixtures';
import { isCurrentUserAdmin } from '@/lib/site';

const LEADERBOARD_QUOTES = [
  'Everyone’s average is currently 0.00. Including the spreadsheet.',
  'The leaderboard is still doing its warm-up stretches.',
  'No runs on the board yet — the scoreboard is on a strategic timeout.',
  'Stats loading slower than a Sunday afternoon innings.',
  'Top scorer: TBD. Top sledge: already decided.',
  'The only thing leading right now is the chai counter.',
];

type Tab = 'batting' | 'bowling' | 'fielding' | 'pom' | 'teams';
type BatSort = 'runs' | 'sixes' | 'fours' | 'sr';
type BowlSort = 'wickets' | 'economy' | 'dots';

export default function LeaderboardPage() {
  const { dark, toggleTheme } = useTheme();
  const [lb, setLb] = useState<Leaderboard | null>(null);
  const [flags, setFlags] = useState<PublicFlags | null>(null);
  const [admin, setAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('batting');
  const [batSort, setBatSort] = useState<BatSort>('runs');
  const [bowlSort, setBowlSort] = useState<BowlSort>('wickets');

  useEffect(() => {
    let alive = true;
    Promise.all([fetchLeaderboard(), fetchPublicFlags()]).then(([l, f]) => {
      if (!alive) return;
      setLb(l); setFlags(f); setLoading(false);
    });
    isCurrentUserAdmin().then((a) => { if (alive) setAdmin(a); });
    return () => { alive = false; };
  }, []);

  const batting = useMemo(() => {
    const arr = (lb?.batting ?? []).filter((b) => b.balls > 0);
    const cmp: Record<BatSort, (a: typeof arr[number], b: typeof arr[number]) => number> = {
      runs: (a, b) => b.runs - a.runs,
      sixes: (a, b) => b.sixes - a.sixes || b.runs - a.runs,
      fours: (a, b) => b.fours - a.fours || b.runs - a.runs,
      sr: (a, b) => (b.sr ?? 0) - (a.sr ?? 0),
    };
    return [...arr].sort(cmp[batSort]);
  }, [lb, batSort]);
  const bowling = useMemo(() => {
    const arr = (lb?.bowling ?? []).filter((b) => b.balls > 0);
    const cmp: Record<BowlSort, (a: typeof arr[number], b: typeof arr[number]) => number> = {
      wickets: (a, b) => b.wickets - a.wickets || (a.economy ?? 99) - (b.economy ?? 99),
      economy: (a, b) => (a.economy ?? 99) - (b.economy ?? 99),
      dots: (a, b) => b.dots - a.dots,
    };
    return [...arr].sort(cmp[bowlSort]);
  }, [lb, bowlSort]);
  const fielding = useMemo(() => [...(lb?.fielding ?? [])].sort((a, b) => b.total - a.total || b.catches - a.catches), [lb]);
  const poms = useMemo(() => [...(lb?.pom ?? [])].sort((a, b) => b.awards - a.awards || a.name.localeCompare(b.name)), [lb]);
  const teams = lb?.teams ?? [];
  const bestFig = useMemo(() => [...(lb?.bowling ?? [])].filter((b) => b.best).sort((a, b) => {
    const [aw, ar] = (a.best ?? '0/0').split('/').map(Number);
    const [bw, br] = (b.best ?? '0/0').split('/').map(Number);
    return bw - aw || ar - br;
  })[0], [lb]);
  const mostDots = useMemo(() => [...(lb?.bowling ?? [])].sort((a, b) => b.dots - a.dots)[0], [lb]);
  const mostSixes = useMemo(() => [...(lb?.batting ?? [])].sort((a, b) => b.sixes - a.sixes)[0], [lb]);
  const hidden = flags != null && !flags.leaderboard_public;

  if (flags?.leaderboard_hold && !admin) {
    return <div className={dark ? 'app dark lb-page' : 'app lb-page'}>
      <SiteHeader dark={dark} onToggleTheme={toggleTheme} relative />
      <HoldScreen eyebrow="DPL 2026 / LEADERBOARD" bgVar="--bg-leaderboard" quotes={LEADERBOARD_QUOTES} />
    </div>;
  }

  return <div className={dark ? 'app dark lb-page' : 'app lb-page'}>
    <SiteHeader dark={dark} onToggleTheme={toggleTheme} relative />
    <section className="lb-hero">
      <div className="lb-hero-bg" />
      <div className="lb-hero-content">
        <p className="lb-hero-eyebrow">DPL 2026 / STATS</p>
        <h1>Leaderboard</h1>
        <p className="lb-hero-sub">Auto-built from every ball scored in the tournament — batting, bowling, fielding, awards and team totals.</p>
      </div>
    </section>
    <main className="shell lb-main">

      {loading && <div className="grid place-items-center py-24 text-muted-foreground"><Loader2 className="animate-spin" /></div>}

      {!loading && hidden && <div className="rounded-2xl border border-dashed p-10 text-center text-muted-foreground">The leaderboard is not published yet.</div>}

      {!loading && !hidden && <>
        <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border bg-card p-4 shadow-sm">
            <div className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">Most POM awards</div>
            <div className="mt-1 font-display text-2xl font-black">{poms[0]?.awards ?? 0}</div>
            <div className="truncate text-[11px] text-muted-foreground">{poms[0]?.awards ? poms[0].name : 'No data yet'}</div>
          </div>
          <div className="rounded-2xl border bg-card p-4 shadow-sm">
            <div className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">Best figures</div>
            <div className="mt-1 font-display text-2xl font-black">{bestFig?.best ?? '—'}</div>
            <div className="truncate text-[11px] text-muted-foreground">{bestFig?.name ?? 'No bowling yet'}</div>
          </div>
          <div className="rounded-2xl border bg-card p-4 shadow-sm">
            <div className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">Most dots</div>
            <div className="mt-1 font-display text-2xl font-black">{mostDots?.dots ?? 0}</div>
            <div className="truncate text-[11px] text-muted-foreground">{mostDots?.dots ? mostDots.name : 'No data yet'}</div>
          </div>
          <div className="rounded-2xl border bg-card p-4 shadow-sm">
            <div className="text-[10px] font-black uppercase tracking-wider text-muted-foreground">Most sixes</div>
            <div className="mt-1 font-display text-2xl font-black">{mostSixes?.sixes ?? 0}</div>
            <div className="truncate text-[11px] text-muted-foreground">{mostSixes?.sixes ? mostSixes.name : 'No data yet'}</div>
          </div>
        </div>

        <div className="mb-5 flex flex-wrap items-center gap-3">
          <div className="admin-tabs-wrap max-w-full overflow-x-auto">
            <div className="inline-flex w-max gap-1 rounded-xl border bg-card p-1 shadow-sm">
              {(['batting', 'bowling', 'fielding', 'pom', 'teams'] as Tab[]).map((t) => (
                <button key={t} type="button" onClick={() => setTab(t)} className={`rounded-lg px-4 py-2 text-xs font-black uppercase tracking-wider transition-colors ${tab === t ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow' : 'text-muted-foreground hover:text-foreground'}`}>{t}</button>
              ))}
            </div>
          </div>
          {tab === 'batting' && (
            <div className="admin-tabs-wrap max-w-full overflow-x-auto">
              <div className="inline-flex w-max gap-1 rounded-xl border bg-card p-1 text-[10px] shadow-sm">
                {(['runs', 'sixes', 'fours', 'sr'] as BatSort[]).map((s) => <button key={s} type="button" onClick={() => setBatSort(s)} className={`rounded-lg px-3 py-1.5 font-black uppercase ${batSort === s ? 'bg-muted text-foreground' : 'text-muted-foreground'}`}>{s === 'sr' ? 'Strike rate' : s}</button>)}
              </div>
            </div>
          )}
          {tab === 'bowling' && (
            <div className="admin-tabs-wrap max-w-full overflow-x-auto">
              <div className="inline-flex w-max gap-1 rounded-xl border bg-card p-1 text-[10px] shadow-sm">
                {(['wickets', 'economy', 'dots'] as BowlSort[]).map((s) => <button key={s} type="button" onClick={() => setBowlSort(s)} className={`rounded-lg px-3 py-1.5 font-black uppercase ${bowlSort === s ? 'bg-muted text-foreground' : 'text-muted-foreground'}`}>{s}</button>)}
              </div>
            </div>
          )}
        </div>

        {tab === 'batting' && (
          <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
            <div className="grid grid-cols-[36px_minmax(0,1fr)_52px_44px_44px_44px_44px] gap-2 border-b bg-muted/40 px-4 py-2.5 text-[10px] font-black uppercase tracking-wider text-muted-foreground sm:grid-cols-[40px_minmax(0,1fr)_64px_56px_56px_56px_56px]">
              <span>#</span><span>Batter</span><span className="text-right">Runs</span><span className="text-right">Balls</span><span className="text-right">SR</span><span className="text-right">4s</span><span className="text-right">6s</span>
            </div>
            {batting.map((b, i) => (
              <div key={b.id} className="grid grid-cols-[36px_minmax(0,1fr)_52px_44px_44px_44px_44px] items-center gap-2 border-b px-4 py-2.5 last:border-0 sm:grid-cols-[40px_minmax(0,1fr)_64px_56px_56px_56px_56px]">
                <span className={`text-sm font-black ${i === 0 ? 'text-amber-500' : 'text-muted-foreground'}`}>{i + 1}</span>
                <span className="min-w-0"><b className="block truncate text-sm font-bold">{b.name}</b><small className="text-[10px] uppercase text-cyan-600">{b.team ?? '—'} · HS {b.hs}</small></span>
                <span className="text-right font-display text-lg font-black">{b.runs}</span>
                <span className="text-right text-sm text-muted-foreground">{b.balls}</span>
                <span className="text-right text-sm">{b.sr ?? '—'}</span>
                <span className="text-right text-sm text-muted-foreground">{b.fours}</span>
                <span className="text-right text-sm text-muted-foreground">{b.sixes}</span>
              </div>
            ))}
            {!batting.length && <p className="py-10 text-center text-sm text-muted-foreground">No batting data yet.</p>}
          </div>
        )}

        {tab === 'bowling' && (
          <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
            <div className="grid grid-cols-[36px_minmax(0,1fr)_44px_48px_44px_52px] gap-2 border-b bg-muted/40 px-4 py-2.5 text-[10px] font-black uppercase tracking-wider text-muted-foreground sm:grid-cols-[40px_minmax(0,1fr)_56px_64px_56px_64px]">
              <span>#</span><span>Bowler</span><span className="text-right">Wkts</span><span className="text-right">Overs</span><span className="text-right">Runs</span><span className="text-right">Econ</span>
            </div>
            {bowling.map((b, i) => (
              <div key={b.id} className="grid grid-cols-[36px_minmax(0,1fr)_44px_48px_44px_52px] items-center gap-2 border-b px-4 py-2.5 last:border-0 sm:grid-cols-[40px_minmax(0,1fr)_56px_64px_56px_64px]">
                <span className={`text-sm font-black ${i === 0 ? 'text-amber-500' : 'text-muted-foreground'}`}>{i + 1}</span>
                <span className="min-w-0"><b className="block truncate text-sm font-bold">{b.name}</b><small className="text-[10px] uppercase text-cyan-600">{b.team ?? '—'}</small></span>
                <span className="text-right font-display text-lg font-black">{b.wickets}</span>
                <span className="text-right text-sm text-muted-foreground">{Math.floor(b.balls / 6)}.{b.balls % 6}</span>
                <span className="text-right text-sm text-muted-foreground">{b.runs}</span>
                <span className="text-right text-sm">{b.economy ?? '—'}</span>
              </div>
            ))}
            {!bowling.length && <p className="py-10 text-center text-sm text-muted-foreground">No bowling data yet.</p>}
          </div>
        )}

        {tab === 'fielding' && (
          <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
            <div className="grid grid-cols-[36px_minmax(0,1fr)_44px_44px_44px_56px] gap-2 border-b bg-muted/40 px-4 py-2.5 text-[10px] font-black uppercase tracking-wider text-muted-foreground sm:grid-cols-[40px_minmax(0,1fr)_56px_56px_56px_72px]">
              <span>#</span><span>Fielder</span><span className="text-right">Ct</span><span className="text-right">RO</span><span className="text-right">St</span><span className="text-right">Total</span>
            </div>
            {fielding.map((f, i) => (
              <div key={f.id} className="grid grid-cols-[36px_minmax(0,1fr)_44px_44px_44px_56px] items-center gap-2 border-b px-4 py-2.5 last:border-0 sm:grid-cols-[40px_minmax(0,1fr)_56px_56px_56px_72px]">
                <span className={`text-sm font-black ${i === 0 ? 'text-amber-500' : 'text-muted-foreground'}`}>{i + 1}</span>
                <span className="min-w-0"><b className="block truncate text-sm font-bold">{f.name}</b><small className="text-[10px] uppercase text-cyan-600">{f.team ?? '—'}</small></span>
                <span className="text-right text-sm">{f.catches}</span>
                <span className="text-right text-sm">{f.run_outs}</span>
                <span className="text-right text-sm">{f.stumpings}</span>
                <span className="text-right font-display text-lg font-black">{f.total}</span>
              </div>
            ))}
            {!fielding.length && <p className="py-10 text-center text-sm text-muted-foreground">No fielding data yet.</p>}
          </div>
        )}

        {tab === 'pom' && (
          <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
            <div className="grid grid-cols-[36px_minmax(0,1fr)_56px] gap-2 border-b bg-muted/40 px-4 py-2.5 text-[10px] font-black uppercase tracking-wider text-muted-foreground sm:grid-cols-[40px_minmax(0,1fr)_80px]">
              <span>#</span><span>Player</span><span className="text-right">Awards</span>
            </div>
            {poms.map((p, i) => (
              <div key={p.id} className="grid grid-cols-[36px_minmax(0,1fr)_56px] items-center gap-2 border-b px-4 py-2.5 last:border-0 sm:grid-cols-[40px_minmax(0,1fr)_80px]">
                <span className={`text-sm font-black ${i === 0 ? 'text-amber-500' : 'text-muted-foreground'}`}>{i + 1}</span>
                <span className="min-w-0"><b className="block truncate text-sm font-bold">{p.name}</b><small className="text-[10px] uppercase text-cyan-600">{p.team ?? '—'}</small></span>
                <span className="text-right font-display text-lg font-black">{p.awards}</span>
              </div>
            ))}
            {!poms.length && <p className="py-10 text-center text-sm text-muted-foreground">No awards yet.</p>}
          </div>
        )}

        {tab === 'teams' && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {teams.map((t) => (
              <div key={t.code} className="flex items-center gap-4 rounded-2xl border bg-card p-4 shadow-sm">
                <div className="grid size-12 shrink-0 place-items-center rounded-xl bg-muted"><Trophy className="size-5 text-cyan-500" /></div>
                <div className="min-w-0 flex-1">
                  <b className="block font-display text-xl font-black italic">{t.code}</b>
                  <small className="block truncate text-[11px] uppercase text-muted-foreground">{t.name ?? ''}</small>
                </div>
                <div className="text-right">
                  <div className="font-display text-2xl font-black leading-none">{t.highest}</div>
                  <small className="text-[9px] uppercase text-muted-foreground">highest</small>
                </div>
              </div>
            ))}
            {!teams.length && <p className="py-10 text-center text-sm text-muted-foreground sm:col-span-2 lg:col-span-3">No team totals yet.</p>}
          </div>
        )}
      </>}
    </main>
    <footer className="border-t py-6 text-center text-[9px] text-muted-foreground">D2P / DPL 2026 / DIGITATE PREMIER LEAGUE / OFFICE CRICKET</footer>
  </div>;
}
