import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { fetchMatchPom, fetchMatchScorecard, oversText, type Fixture, type MatchScorecard, type ScorecardBall } from '@/lib/fixtures';

function ballText(b: ScorecardBall): string {
  if (b.is_wicket) return `W · ${b.wicket_type ? b.wicket_type.replace('_', ' ') : 'out'}`;
  if (b.extra === 'wide') return b.runs > 0 ? `Wide +${b.runs}` : 'Wide';
  if (b.extra === 'no_ball') return b.runs > 0 ? `No ball +${b.runs}` : 'No ball';
  if (b.extra === 'bye') return `${b.runs} bye${b.runs === 1 ? '' : 's'}`;
  if (b.extra === 'leg_bye') return `${b.runs} leg bye${b.runs === 1 ? '' : 's'}`;
  return `${b.runs} run${b.runs === 1 ? '' : 's'}`;
}

function oversFromBalls(balls: number): string {
  return `${Math.floor(balls / 6)}.${balls % 6}`;
}

export default function PublicScorecardDialog({ fixture, onClose }: { fixture: Fixture; onClose: () => void }) {
  const [card, setCard] = useState<MatchScorecard | null>(null);
  const [pom, setPom] = useState<{ name: string; auto: boolean } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetchMatchScorecard(fixture.match_number).then((c) => { if (alive) { setCard(c); setLoading(false); } });
    fetchMatchPom(fixture.match_number).then((p) => {
      if (alive && p?.chosen_name) setPom({ name: p.chosen_name, auto: p.is_auto });
    });
    return () => { alive = false; };
  }, [fixture.match_number]);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{fixture.home_code} vs {fixture.away_code}</DialogTitle>
          <DialogDescription>Match {fixture.match_number} · full scorecard</DialogDescription>
        </DialogHeader>
        {pom && <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-bold uppercase tracking-wider text-amber-700">Player of the Match · {pom.name}{pom.auto ? ' (auto)' : ''}</div>}

        {loading && <div className="grid place-items-center py-10"><Loader2 className="animate-spin" /></div>}
        {!loading && (!card || card.innings.length === 0) && <p className="py-8 text-center text-sm text-muted-foreground">No ball-by-ball scorecard for this match.</p>}

        {!loading && card && card.innings.map((inn) => {
          const batting = card.batting.filter((b) => b.innings === inn.innings);
          const bowling = card.bowling.filter((b) => b.innings === inn.innings);
          const commentary = card.commentary.filter((b) => b.innings === inn.innings).slice().reverse();
          return (
            <div key={inn.innings} className="mt-2 space-y-3">
              <div className="flex items-baseline justify-between rounded-xl border bg-card p-3">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Innings {inn.innings} · {inn.batting_code}</div>
                  <div className="font-display text-3xl font-black">{inn.runs}<span className="text-xl text-muted-foreground">/{inn.wickets}</span>
                    <span className="ml-2 text-sm font-normal text-muted-foreground">({oversText(inn.overs)} ov)</span>
                  </div>
                </div>
                <div className="text-right text-[10px] uppercase text-muted-foreground">vs {inn.bowling_code}</div>
              </div>

              {batting.length > 0 && (
                <div className="overflow-hidden rounded-xl border">
                  <div className="bg-muted/40 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Batting</div>
                  {batting.map((b) => (
                    <div key={b.id} className="flex items-center justify-between border-t px-3 py-1.5 text-sm">
                      <span className="font-medium">{b.name}{b.out ? '' : ' *'}</span>
                      <span className="font-mono text-xs">{b.runs} <span className="text-muted-foreground">({b.balls})</span></span>
                    </div>
                  ))}
                </div>
              )}

              {bowling.length > 0 && (
                <div className="overflow-hidden rounded-xl border">
                  <div className="grid grid-cols-[1fr_auto_auto_auto] gap-3 bg-muted/40 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    <span>Bowling</span><span>O</span><span>R</span><span>W</span>
                  </div>
                  {bowling.map((b) => (
                    <div key={b.id} className="grid grid-cols-[1fr_auto_auto_auto] gap-3 border-t px-3 py-1.5 text-sm">
                      <span className="font-medium">{b.name}</span>
                      <span className="font-mono text-xs">{oversFromBalls(b.balls)}</span>
                      <span className="font-mono text-xs">{b.runs}</span>
                      <span className="font-mono text-xs font-bold">{b.wickets}</span>
                    </div>
                  ))}
                </div>
              )}

              {(() => {
                const parts = card.partnerships.filter((p) => p.innings === inn.innings);
                if (!parts.length) return null;
                return <div className="overflow-hidden rounded-xl border">
                  <div className="bg-muted/40 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Partnerships</div>
                  {parts.map((p, i) => (
                    <div key={i} className="flex items-center justify-between border-t px-3 py-1.5 text-sm">
                      <span className="font-medium">{p.b1 ?? '—'} &amp; {p.b2 ?? '—'}</span>
                      <span className="font-mono text-xs">{p.runs}</span>
                    </div>
                  ))}
                </div>;
              })()}

              {commentary.length > 0 && (
                <div className="rounded-xl border p-3">
                  <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Commentary</div>
                  <div className="max-h-52 space-y-1 overflow-y-auto pr-1">
                    {commentary.map((b) => (
                      <div key={b.seq} className={`flex items-center justify-between rounded-md px-2 py-1 text-xs ${b.is_wicket ? 'bg-destructive/10 text-destructive' : b.free_hit ? 'bg-amber-500/10' : ''}`}>
                        <span>{b.batter ?? 'Batter'} — {ballText(b)}</span>
                        {b.free_hit && <span className="text-[9px] font-bold uppercase text-amber-600">free hit</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </DialogContent>
    </Dialog>
  );
}
