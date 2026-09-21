import { useEffect, useState } from 'react';
import { Loader2, RefreshCw, Smartphone, Wifi, WifiOff } from 'lucide-react';
import { toast } from 'sonner';
import SiteHeader from '@/components/SiteHeader';
import AdminScorerDialog from '@/admin/AdminScorerDialog';
import { Toaster } from '@/components/ui/sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { fetchFixtures, formatFixtureDate, formatFixtureTime, type Fixture } from '@/lib/fixtures';
import { fetchTeamsList, type TeamRow } from '@/lib/site';
import { useTheme } from '@/lib/useTheme';
import { flushQueue, queueLength } from '@/lib/scoreQueue';

function useIsMobile() {
  const check = () => window.matchMedia('(max-width: 820px)').matches || window.matchMedia('(pointer: coarse)').matches;
  const [mobile, setMobile] = useState(check);
  useEffect(() => {
    const on = () => setMobile(check());
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return mobile;
}

export default function ScorePage() {
  const { dark, toggleTheme } = useTheme();
  const mobile = useIsMobile();
  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Fixture | null>(null);
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  const [queued, setQueued] = useState(() => queueLength());

  useEffect(() => {
    Promise.all([fetchFixtures(), fetchTeamsList()]).then(([fr, tr]) => { setFixtures(fr.data); setTeams(tr); setLoading(false); });
  }, []);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  // Keep the screen awake while scoring.
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const request = async () => {
      try {
        const wl = (navigator as unknown as { wakeLock?: { request: (t: string) => Promise<unknown> } }).wakeLock;
        if (wl) lock = (await wl.request('screen')) as { release: () => Promise<void> };
      } catch { /* unsupported */ }
    };
    const onVis = () => { if (document.visibilityState === 'visible') void request(); };
    void request();
    document.addEventListener('visibilitychange', onVis);
    return () => { document.removeEventListener('visibilitychange', onVis); void lock?.release().catch(() => {}); };
  }, []);

  const sync = async () => {
    const { flushed, error } = await flushQueue();
    setQueued(queueLength());
    if (error) return toast.error(`Sync failed: ${error}`);
    toast.success(flushed ? `Synced ${flushed} ball${flushed === 1 ? '' : 's'}.` : 'Nothing to sync.');
  };

  if (!mobile) {
    return <div className={dark ? 'app dark' : 'app'}>
      <SiteHeader dark={dark} onToggleTheme={toggleTheme} relative />
      <main className="shell" style={{ padding: '90px 0', textAlign: 'center' }}>
        <Smartphone className="mx-auto mb-4 size-10 text-cyan-500" />
        <h1 className="font-display text-3xl font-black italic uppercase">Scorer mode is for phones</h1>
        <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
          Open <b>{window.location.origin}/score</b> on a phone to score a match.
        </p>
      </main>
    </div>;
  }

  const live = fixtures.filter((f) => f.status === 'live');
  const upcoming = fixtures.filter((f) => f.status === 'upcoming');
  const done = fixtures.filter((f) => f.status !== 'live' && f.status !== 'upcoming');

  return <div className={dark ? 'app dark' : 'app'}>
    <Toaster theme={dark ? 'dark' : 'light'} position="bottom-center" richColors />
    <SiteHeader dark={dark} onToggleTheme={toggleTheme} relative />
    <main className="shell" style={{ padding: '16px 0 80px' }}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[2px] text-cyan-500">DPL 2026 / SCORER</p>
          <h1 className="font-display text-3xl font-black italic uppercase leading-none">Score a match</h1>
        </div>
        <div className="flex items-center gap-2">
          {queued > 0 && <Badge variant="default" className="bg-amber-500/20 text-amber-600">{queued} queued</Badge>}
          {online ? <Wifi className="size-4 text-emerald-500" /> : <WifiOff className="size-4 text-destructive" />}
          <Button variant="outline" size="sm" onClick={sync} disabled={queued === 0}><RefreshCw /> SYNC</Button>
        </div>
      </div>

      {loading && <div className="grid place-items-center py-16 text-muted-foreground"><Loader2 className="animate-spin" /></div>}
      {!loading && <div className="space-y-5">
        <MatchGroup title="Live now" list={live} teams={teams} onPick={setSelected} />
        <MatchGroup title="Upcoming" list={upcoming} teams={teams} onPick={setSelected} />
        <MatchGroup title="Completed" list={done} teams={teams} onPick={setSelected} />
      </div>}
    </main>
    {selected && <AdminScorerDialog fixture={selected} fullscreen onClose={() => setSelected(null)} onSaved={() => setQueued(queueLength())} />}
  </div>;
}

function MatchGroup({ title, list, teams, onPick }: { title: string; list: Fixture[]; teams: TeamRow[]; onPick: (f: Fixture) => void }) {
  if (!list.length) return null;
  return <section>
    <h2 className="mb-2 text-xs font-black uppercase tracking-wider text-muted-foreground">{title} · {list.length}</h2>
    <div className="space-y-2">
      {list.map((f) => {
        const home = teams.find((t) => t.code === f.home_code);
        const away = teams.find((t) => t.code === f.away_code);
        return <button key={f.id} type="button" onClick={() => onPick(f)}
          className="flex w-full items-center gap-3 rounded-xl border bg-card px-4 py-3 text-left shadow-sm active:scale-[.99]">
          <div className="w-16 shrink-0">
            <div className="whitespace-nowrap font-display text-lg font-black leading-none text-cyan-600">{formatFixtureTime(f.match_time)}</div>
            <div className="text-[10px] uppercase text-muted-foreground">M{f.match_number}</div>
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-bold">{home?.code ?? f.home_code} <span className="text-muted-foreground">vs</span> {away?.code ?? f.away_code}</div>
            <div className="truncate text-[11px] text-muted-foreground">{formatFixtureDate(f.match_date)} · {f.venue}</div>
          </div>
          <Badge variant="default" className={f.status === 'live' ? 'bg-pink-500/15 text-pink-600' : f.status === 'completed' ? 'bg-emerald-500/15 text-emerald-600' : 'bg-cyan-500/15 text-cyan-600'}>{f.status}</Badge>
        </button>;
      })}
    </div>
  </section>;
}
