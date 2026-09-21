import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, RotateCcw, Undo2, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { fetchTeamRoster, type TeamRosterPlayer } from '@/lib/site';
import {
  adminBallUndo, adminInningsClose, adminInningsReopen, adminInningsSetStrike, adminInningsSetup,
  fetchInnings, fetchMatchScorecard, oversText,
  type Fixture, type MatchInnings, type MatchScorecard, type WicketType,
} from '@/lib/fixtures';
import { submitBall, submitBatter, flushQueue, queueLength } from '@/lib/scoreQueue';

const RUNS = [0, 1, 2, 3, 4, 6];
const WICKETS: Array<{ type: WicketType; label: string; runOut?: boolean }> = [
  { type: 'bowled', label: 'Bowled' },
  { type: 'caught', label: 'Caught' },
  { type: 'run_out', label: 'Run out', runOut: true },
  { type: 'stumped', label: 'Stumped' },
  { type: 'hit_wicket', label: 'Hit wicket' },
  { type: 'mankad', label: 'Mankad' },
  { type: 'other', label: 'Other' },
];

export default function AdminScorerDialog({ fixture, onClose, onSaved, fullscreen }: { fixture: Fixture; onClose: () => void; onSaved: () => void; fullscreen?: boolean }) {
  const [offline, setOffline] = useState<{ runs: number; wickets: number; legal: number } | null>(null);
  const [pendingChips, setPendingChips] = useState<string[]>([]);
  const [queued, setQueued] = useState(() => queueLength());
  const [innings, setInnings] = useState<MatchInnings[] | null>(null);
  const [card, setCard] = useState<MatchScorecard | null>(null);
  const [rosters, setRosters] = useState<Record<string, TeamRosterPlayer[]>>({});
  const [opener1, setOpener1] = useState('');
  const [opener2, setOpener2] = useState('');
  const [bowler, setBowler] = useState('');
  const [wicketOpen, setWicketOpen] = useState(false);
  const [pendingWicket, setPendingWicket] = useState<WicketType | null>(null);
  const [fielder, setFielder] = useState('');
  const [fieldNote, setFieldNote] = useState('');
  const [custom, setCustom] = useState('');
  const [customType, setCustomType] = useState('runs');
  const [newBatter, setNewBatter] = useState('');
  const [needBatter, setNeedBatter] = useState(false);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const [inn, sc] = await Promise.all([fetchInnings(fixture.match_number), fetchMatchScorecard(fixture.match_number)]);
    setInnings(inn);
    setCard(sc);
  }, [fixture.match_number]);

  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => {
    let alive = true;
    Promise.all([fetchTeamRoster(fixture.home_code), fetchTeamRoster(fixture.away_code)]).then(([h, a]) => {
      if (alive) setRosters({ [fixture.home_code]: h, [fixture.away_code]: a });
    });
    return () => { alive = false; };
  }, [fixture.home_code, fixture.away_code]);

  const current = useMemo(() => (innings ?? []).find((i) => !i.closed), [innings]);
  const allClosed = (innings?.length ?? 0) > 0 && !current;
  const summary = card?.innings.find((i) => i.innings === current?.innings);
  const nameOf = (id: string | null | undefined) => {
    if (!id) return '—';
    for (const list of Object.values(rosters)) {
      const p = list.find((x) => x.id === id);
      if (p) return p.name;
    }
    return '—';
  };

  const activeBowler = current?.current_bowler_id ?? null;
  const selectedBowler = bowler || activeBowler || '';
  const bowlerReady = Boolean(selectedBowler);
  const usedBowlers = new Set((card?.bowling ?? []).filter((b) => b.innings === current?.innings && b.balls >= 6).map((b) => b.id));

  useEffect(() => { if (activeBowler === null) setBowler(''); }, [activeBowler]);

  const setup = async (code: string) => {
    setBusy(true);
    const { error } = await adminInningsSetup(fixture.match_number, code);
    setBusy(false);
    if (error) return toast.error(error);
    await reload();
  };

  const confirmOpeners = async () => {
    if (!current || !opener1 || !opener2 || opener1 === opener2) return toast.error('Pick two different openers.');
    setBusy(true);
    const { error } = await adminInningsSetStrike(fixture.match_number, current.innings, opener1, opener2);
    setBusy(false);
    if (error) return toast.error(error);
    await reload();
  };

  const ball = async (batRuns: number, extra: string | null, isWicket: boolean, wicketType: WicketType | null, fielderId: string | null = null, fieldingNote: string | null = null) => {
    if (!current) return;
    setBusy(true);
    const { queued: wasQueued, error } = await submitBall(fixture.match_number, current.innings, { batRuns, extra, isWicket, wicketType, bowlerId: selectedBowler || null, fielderId, fieldingNote });
    setBusy(false);
    if (error) return toast.error(error);
    setWicketOpen(false);
    setPendingWicket(null);
    setFielder('');
    setFieldNote('');
    if (wasQueued) {
      const legal = extra === null || extra === 'bye' || extra === 'leg_bye';
      setOffline((o) => {
        const base = o ?? { runs: 0, wickets: 0, legal: 0 };
        return {
          runs: base.runs + batRuns + (extra === 'wide' || extra === 'no_ball' ? 1 : 0),
          wickets: base.wickets + (isWicket ? 1 : 0),
          legal: base.legal + (legal ? 1 : 0),
        };
      });
      setPendingChips((c) => [...c, extra === 'wide' ? 'wd' : extra === 'no_ball' ? 'nb' : extra === 'bye' ? 'b' : isWicket ? 'W' : String(batRuns)]);
      toast.message('Saved offline', { description: 'Will sync automatically when you are back online.' });
    }
    setQueued(queueLength());
    if (isWicket) setNeedBatter(true);
    if (!wasQueued) await reload();
  };

  const pickBatter = async () => {
    if (!current || !newBatter) return;
    setBusy(true);
    const { queued: wasQueued, error } = await submitBatter(fixture.match_number, current.innings, newBatter, current.non_striker_id);
    setBusy(false);
    if (error) return toast.error(error);
    setNeedBatter(false);
    setNewBatter('');
    setQueued(queueLength());
    if (!wasQueued) await reload();
  };

  useEffect(() => {
    const sync = async () => {
      const { flushed, error } = await flushQueue();
      setQueued(queueLength());
      if (flushed > 0) {
        toast.success(`Synced ${flushed} offline ball${flushed === 1 ? '' : 's'}.`);
        setOffline(null);
        setPendingChips([]);
        await reload();
        onSaved();
      } else if (error) {
        toast.error(`Sync failed: ${error}`);
      }
    };
    const onOnline = () => { void sync(); };
    window.addEventListener('online', onOnline);
    if (typeof navigator !== 'undefined' && navigator.onLine) void sync();
    return () => window.removeEventListener('online', onOnline);
  }, [reload, onSaved]);

  const undo = async () => {
    if (!current) return;
    setBusy(true);
    const { error } = await adminBallUndo(fixture.match_number, current.innings);
    setBusy(false);
    if (error) return toast.error(error);
    await reload();
  };

  const close = async () => {
    if (!current) return;
    if (!window.confirm(`Close innings ${current.innings} (${current.batting_code})? This writes the score to the fixture.`)) return;
    setBusy(true);
    const { error } = await adminInningsClose(fixture.match_number, current.innings);
    setBusy(false);
    if (error) return toast.error(error);
    toast.success(`Innings ${current.innings} closed.`);
    onSaved();
    await reload();
  };

  const reopen = async (n: number) => {
    setBusy(true);
    const { error } = await adminInningsReopen(fixture.match_number, n);
    setBusy(false);
    if (error) return toast.error(error);
    onSaved();
    await reload();
  };

  const battingRoster = current ? rosters[current.batting_code] ?? [] : [];
  const bowlingRoster = current ? rosters[current.bowling_code] ?? [] : [];
  const recent = (card?.commentary ?? []).filter((b) => b.innings === current?.innings).slice(-14).reverse();
  const dispRuns = (summary?.runs ?? 0) + (offline?.runs ?? 0);
  const dispWickets = (summary?.wickets ?? 0) + (offline?.wickets ?? 0);
  const dispBalls = (summary?.balls ?? 0) + (offline?.legal ?? 0);
  const dispOvers = Math.floor(dispBalls / 6) + (dispBalls % 6) / 10;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className={fullscreen
        ? 'h-[100dvh] max-h-[100dvh] w-full max-w-none overflow-y-auto rounded-none sm:h-auto sm:max-h-[92vh] sm:max-w-lg sm:rounded-lg'
        : 'max-h-[92vh] overflow-y-auto sm:max-w-lg'}>
        <DialogHeader>
          <DialogTitle>SCORER · {fixture.home_code} vs {fixture.away_code}</DialogTitle>
          <DialogDescription>Tap to score. Totals write back to the fixture when an innings is closed.</DialogDescription>
        </DialogHeader>

        {!innings && <div className="grid place-items-center py-10 text-sm text-muted-foreground"><Loader2 className="animate-spin" /></div>}

        {innings && innings.length === 0 && (
          <div className="space-y-4">
            <p className="text-sm font-semibold">Who bats first?</p>
            <div className="grid grid-cols-2 gap-3">
              {[fixture.home_code, fixture.away_code].map((code) => (
                <Button key={code} className="h-20 text-lg font-bold" disabled={busy} onClick={() => setup(code)}>{code}</Button>
              ))}
            </div>
          </div>
        )}

        {innings && innings.length > 0 && (
          <div className="space-y-4">
            {card?.innings.map((i) => (
              <div key={i.innings} className={`flex items-center justify-between rounded-xl border p-3 ${current?.innings === i.innings ? 'border-primary bg-primary/5' : ''}`}>
                <div>
                  <div className="text-xs font-bold uppercase text-muted-foreground">Innings {i.innings} · {i.batting_code}</div>
                  <div className="font-display text-2xl font-bold">{i.runs}/{i.wickets} <span className="text-sm font-normal text-muted-foreground">({oversText(i.overs)} ov)</span></div>
                </div>
                <div className="flex items-center gap-2">
                  {i.closed ? <Badge variant="secondary">CLOSED</Badge> : <Badge variant="default" className="bg-pink-500/15 text-pink-600">LIVE</Badge>}
                  {i.closed && <Button variant="ghost" size="sm" onClick={() => reopen(i.innings)} disabled={busy}><RotateCcw /> REOPEN</Button>}
                </div>
              </div>
            ))}

            {current && !current.striker_id && (
              <div className="space-y-3 rounded-xl border-2 border-primary/40 p-3">
                <p className="text-sm font-semibold">Select openers · {current.batting_code}</p>
                <div className="grid grid-cols-2 gap-2">
                  <Select value={opener1 || '__none'} onValueChange={(v) => setOpener1(v === '__none' ? '' : v)}>
                    <SelectTrigger><SelectValue placeholder="Striker" /></SelectTrigger>
                    <SelectContent><SelectItem value="__none">Striker…</SelectItem>{battingRoster.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                  </Select>
                  <Select value={opener2 || '__none'} onValueChange={(v) => setOpener2(v === '__none' ? '' : v)}>
                    <SelectTrigger><SelectValue placeholder="Non-striker" /></SelectTrigger>
                    <SelectContent><SelectItem value="__none">Non-striker…</SelectItem>{battingRoster.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <Button className="w-full" disabled={busy} onClick={confirmOpeners}>START INNINGS</Button>
              </div>
            )}

            {current && current.striker_id && (
              <>
                <div className="rounded-xl border-2 border-primary/40 bg-card p-3">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-xs font-bold uppercase text-muted-foreground">Batting · {current.batting_code}</span>
                    <span className="flex items-center gap-1.5">
                      {current.free_hit && <Badge variant="default" className="bg-amber-500/20 text-amber-600"><Zap /> FREE HIT</Badge>}
                      {queued > 0 && <Badge variant="default" className="bg-slate-500/20 text-slate-600">OFFLINE · {queued}</Badge>}
                    </span>
                  </div>
                  <div className="font-display text-4xl font-black leading-none">
                    {dispRuns}<span className="text-2xl text-muted-foreground">/{dispWickets}</span>
                    <span className="ml-2 text-base font-normal text-muted-foreground">({oversText(dispOvers)} ov)</span>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-lg bg-primary/10 px-2 py-1"><span className="text-muted-foreground">Striker</span><div className="font-semibold">{nameOf(current.striker_id)} *</div></div>
                    <div className="rounded-lg bg-muted px-2 py-1"><span className="text-muted-foreground">Non-striker</span><div className="font-semibold">{nameOf(current.non_striker_id)}</div></div>
                  </div>
                </div>

                {needBatter && (
                  <div className="space-y-2 rounded-xl border-2 border-amber-500/50 bg-amber-500/5 p-3">
                    <p className="text-sm font-semibold">Wicket fell — pick the incoming batter</p>
                    <Select value={newBatter || '__none'} onValueChange={(v) => setNewBatter(v === '__none' ? '' : v)}>
                      <SelectTrigger><SelectValue placeholder="Incoming batter" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none">Select…</SelectItem>
                        {battingRoster.filter((p) => p.id !== current.striker_id && p.id !== current.non_striker_id).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Button className="w-full" disabled={busy || !newBatter} onClick={pickBatter}>SET BATTER</Button>
                  </div>
                )}

                {activeBowler ? (
                  <div className="flex items-center justify-between rounded-lg border bg-muted/40 px-3 py-2 text-sm">
                    <span className="text-muted-foreground">Bowling this over</span>
                    <span className="font-semibold">{nameOf(activeBowler)}</span>
                  </div>
                ) : (
                  <Select value={bowler || '__none'} onValueChange={(v) => setBowler(v === '__none' ? '' : v)}>
                    <SelectTrigger className={bowlerReady ? '' : 'border-amber-500/60'}><SelectValue placeholder="Select bowler (required)" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">Select bowler…</SelectItem>
                      {bowlingRoster.map((p) => <SelectItem key={p.id} value={p.id} disabled={usedBowlers.has(p.id)}>{p.name}{usedBowlers.has(p.id) ? ' · over bowled' : ''}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
                {!bowlerReady && <p className="text-xs font-semibold text-amber-600">Select a bowler to start the over — a delivery cannot be scored without one.</p>}

                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {RUNS.map((r) => <Button key={r} variant="outline" className="h-16 text-2xl font-black" disabled={busy || !bowlerReady || needBatter} onClick={() => ball(r, null, false, null)}>{r}</Button>)}
                  <Button variant="destructive" className="h-16 text-xl font-black" disabled={busy || !bowlerReady || needBatter} onClick={() => setWicketOpen(true)}>W</Button>
                  <Button variant="outline" className="h-16 text-lg font-bold" disabled={busy || !bowlerReady || needBatter} onClick={() => ball(0, 'wide', false, null)}>WD</Button>
                  <Button variant="outline" className="h-16 text-lg font-bold" disabled={busy || !bowlerReady || needBatter} onClick={() => ball(0, 'no_ball', false, null)}>NB</Button>
                  <Button variant="outline" className="h-16 text-lg font-bold" disabled={busy || !bowlerReady || needBatter} onClick={() => ball(1, 'bye', false, null)}>B</Button>
                  <Button variant="secondary" className="h-16 text-lg font-bold" disabled={busy} onClick={undo}><Undo2 /> UNDO</Button>
                </div>

                <div className="flex items-center gap-2">
                  <Input type="number" min={0} max={12} inputMode="numeric" value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Runs" className="h-11 w-20" />
                  <Select value={customType} onValueChange={setCustomType}>
                    <SelectTrigger className="h-11 flex-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="runs">Runs off bat</SelectItem>
                      <SelectItem value="bye">Byes</SelectItem>
                      <SelectItem value="leg_bye">Leg byes</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button variant="outline" className="h-11" disabled={busy || !bowlerReady || needBatter || custom === ''} onClick={() => { ball(Number(custom), customType === 'runs' ? null : customType, false, null); setCustom(''); }}>ADD</Button>
                </div>

                {(pendingChips.length > 0 || recent.length > 0) && (
                  <div className="flex flex-wrap gap-1">
                    {pendingChips.map((c, i) => (
                      <span key={`p${i}`} className={`rounded-md border px-1.5 py-0.5 text-[11px] font-bold opacity-60 ${c === 'W' ? 'border-destructive/40 text-destructive' : c === 'wd' || c === 'nb' || c === 'b' ? 'border-amber-500/40 text-amber-600' : ''}`}>{c}</span>
                    ))}
                    {recent.map((b) => (
                      <span key={b.seq} className={`rounded-md border px-1.5 py-0.5 text-[11px] font-bold ${b.is_wicket ? 'border-destructive/40 text-destructive' : b.extra ? 'border-amber-500/40 text-amber-600' : ''}`}>
                        {b.extra === 'wide' ? 'wd' : b.extra === 'no_ball' ? 'nb' : b.extra === 'bye' ? 'b' : b.is_wicket ? 'W' : b.runs}
                      </span>
                    ))}
                  </div>
                )}

                <Button className="w-full" size="lg" disabled={busy} onClick={close}>CLOSE INNINGS {current.innings}</Button>
              </>
            )}

            {allClosed && <div className="rounded-xl border bg-emerald-500/5 p-3 text-center text-sm font-semibold text-emerald-700">Match complete — scores saved to the fixture.</div>}
          </div>
        )}

        {card && current && (() => {
          const bat = card.batting.filter((b) => b.innings === current.innings);
          const bowl = card.bowling.filter((b) => b.innings === current.innings);
          if (!bat.length && !bowl.length) return null;
          return <div className="mt-2 grid gap-3 sm:grid-cols-2">
            {bat.length > 0 && (
              <div className="rounded-xl border p-3">
                <div className="mb-2 text-xs font-bold uppercase text-muted-foreground">Batting · innings {current.innings}</div>
                {bat.map((b) => <div key={b.id} className="flex justify-between text-sm"><span>{b.name}{b.out ? '' : ' *'}</span><span className="font-mono">{b.runs} ({b.balls})</span></div>)}
              </div>
            )}
            {bowl.length > 0 && (
              <div className="rounded-xl border p-3">
                <div className="mb-2 text-xs font-bold uppercase text-muted-foreground">Bowling · innings {current.innings}</div>
                {bowl.map((b) => <div key={b.id} className="flex justify-between text-sm"><span>{b.name}</span><span className="font-mono">{b.wickets}/{b.runs}</span></div>)}
              </div>
            )}
          </div>;
        })()}

        <Dialog open={wicketOpen} onOpenChange={(o) => { setWicketOpen(o); if (!o) setPendingWicket(null); }}>
          <DialogContent className="sm:max-w-xs">
            <DialogHeader>
              <DialogTitle>{pendingWicket ? 'WHO FIELDED IT?' : 'HOW OUT?'}</DialogTitle>
              <DialogDescription>{pendingWicket ? 'Credit the fielder and optionally where it happened.' : current?.free_hit ? 'Free hit — only a run-out is allowed.' : 'Pick the dismissal type.'}</DialogDescription>
            </DialogHeader>
            {!pendingWicket ? (
              <div className="grid grid-cols-2 gap-2">
                {WICKETS.map((w) => {
                  const disabled = Boolean(current?.free_hit) && !w.runOut;
                  return <Button key={w.type} variant="outline" disabled={disabled || busy} onClick={() => {
                    if (w.type === 'caught' || w.type === 'run_out' || w.type === 'stumped') setPendingWicket(w.type);
                    else void ball(0, null, true, w.type);
                  }}>{w.label}</Button>;
                })}
              </div>
            ) : (
              <div className="space-y-3">
                <Select value={fielder || '__none'} onValueChange={(v) => setFielder(v === '__none' ? '' : v)}>
                  <SelectTrigger><SelectValue placeholder="Fielder (optional)" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">No fielder</SelectItem>
                    {bowlingRoster.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Input value={fieldNote} onChange={(e) => setFieldNote(e.target.value)} placeholder="Where? optional (e.g. mid-off, deep cover)" />
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1" disabled={busy} onClick={() => setPendingWicket(null)}>BACK</Button>
                  <Button className="flex-1" disabled={busy} onClick={() => void ball(0, null, true, pendingWicket, fielder || null, fieldNote || null)}>CONFIRM</Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}
