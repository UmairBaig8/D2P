import { useEffect, useRef, useState } from 'react';
import { useTheme } from '@/lib/useTheme';
import SiteHeader from '@/components/SiteHeader';
import { resolveAsset } from '@/lib/base';
import {
  fetchAuctionLiveState,
  fetchAuctionSchedule,
  formatCompact,
  formatCountdown,
  formatInr,
  type AuctionLiveState,
  type NextUpPlayer,
} from '@/lib/auction';

function initials(name: string): string {
  return name.split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase();
}

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

function TeamStrip({ state }: { state: AuctionLiveState }) {
  const teams = state.teams ?? [];
  const totalBudget = teams.reduce((sum, team) => sum + team.budget, 0);
  return (
    <div className="la-purse">
      {teams.length === 0 ? (
        <div className="la-purse-empty">Team purses will appear here when the auction starts.</div>
      ) : (
        <div className="la-purse-grid">
          {teams.map((team) => {
            const remaining = team.budget - team.spent;
            const pct = team.budget > 0 ? Math.max(0, Math.min(100, (remaining / team.budget) * 100)) : 0;
            return (
              <div className="la-team" key={team.team_id} title={team.name}>
                <div className="la-team-head">
                  {team.icon_url ? <img className="la-team-icon" src={resolveAsset(team.icon_url)} alt="" /> : <span className="la-team-icon la-team-icon--fb">{initials(team.name)}</span>}
                  <span className="la-team-code">{team.code || team.name}</span>
                  <span className="la-team-squad">{team.squad}/11</span>
                </div>
                <div className="la-team-bar"><i style={{ width: `${pct}%` }} /></div>
                <div className="la-team-foot">
                  <b>{formatCompact(remaining)}</b>
                  <span>LEFT</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {totalBudget > 0 && (
        <div className="la-purse-note">10 teams · {formatInr(totalBudget)} combined purse</div>
      )}
    </div>
  );
}

function CountdownFace({ seconds, copy }: { seconds: number; copy: string }) {
  const parts = formatCountdown(seconds);
  const cells = parts.days > 0
    ? [{ k: 'DAYS', v: parts.days }, { k: 'HRS', v: parts.hours }, { k: 'MIN', v: parts.minutes }, { k: 'SEC', v: parts.seconds }]
    : [{ k: 'HRS', v: parts.hours }, { k: 'MIN', v: parts.minutes }, { k: 'SEC', v: parts.seconds }];
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    <div className="la-countdown">
      <span className="la-eyebrow">{copy}</span>
      <div className="la-countdown-cols">
        {cells.map((cell) => (
          <div className="la-countdown-cell" key={cell.k}>
            <b>{cell.k === 'DAYS' ? cell.v : pad(cell.v)}</b>
            <span>{cell.k}</span>
          </div>
        ))}
      </div>
      <p>Registration closes soon — get your team sheet ready for DPL 2026.</p>
    </div>
  );
}

function Player3DCard({ player }: {
  player: NonNullable<AuctionLiveState['current_player']>;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [tilt, setTilt] = useState({ x: 0, y: 0, live: false });

  const onMove = (event: React.PointerEvent) => {
    const el = wrap.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = (event.clientX - rect.left) / rect.width - 0.5;
    const py = (event.clientY - rect.top) / rect.height - 0.5;
    setTilt({ x: py * -16, y: px * 20, live: true });
  };
  const onLeave = () => setTilt({ x: 0, y: 0, live: false });

  return (
    <div ref={wrap} className="la-3d-wrap" onPointerMove={onMove} onPointerLeave={onLeave}>
      <article
        className="la-3d"
        style={{
          transform: `rotateX(${tilt.x.toFixed(2)}deg) rotateY(${tilt.y.toFixed(2)}deg)`,
          transition: tilt.live ? 'transform 120ms linear' : 'transform 700ms cubic-bezier(.25,1.4,.35,1)',
        }}
      >
        <div className="la-3d-face la-3d-back">
          <div className="la-3d-back-badge">DPL <b>2026</b></div>
          <div className="la-3d-back-mark">{initials(player.name)}</div>
          <p className="la-3d-back-lot">LOT #{player.lot_order}</p>
          <p className="la-3d-back-sub">PLAYER AUCTION · PLAYER CARD</p>
        </div>
        <div className="la-3d-face la-3d-front">
          <div className="la-3d-photo">
            {player.photo_url ? (
              <img src={player.photo_url} alt={player.name} />
            ) : (
              <span className="la-3d-fallback">{initials(player.name)}</span>
            )}
          </div>
          <div className="la-3d-grad" />
          <div className="la-3d-top">
            <span className="la-3d-lot">LOT #{player.lot_order}</span>
            <span className={`la-3d-badge${player.dpl_played ? ' vet' : ''}`}>{player.dpl_played ? '★ VET' : 'ROOKIE'}</span>
            <span className="la-3d-loc">{player.location}{player.gender ? ` · ${player.gender}` : ''}</span>
            <span className="la-3d-stars">
              {'★'.repeat(Math.max(1, Math.min(5, player.self_rating || 0)))}
              <em>{player.self_rating}.0</em>
            </span>
          </div>
          <div className="la-3d-name">
            <h2>{player.name}</h2>
          </div>
          <div className="la-3d-sheen" />
          <div className="la-3d-edge" />
        </div>
      </article>
    </div>
  );
}

function FoldNumber({ value, className }: { value: string; className?: string }) {
  const first = useRef(true);
  const [items, setItems] = useState<{ id: number; text: string }[]>([{ id: 0, text: value }]);

  useEffect(() => {
    if (first.current) { first.current = false; return; }
    setItems((prev) => [...prev.slice(-1), { id: Date.now(), text: value }]);
  }, [value]);

  useEffect(() => {
    if (items.length <= 1) return;
    const t = window.setTimeout(() => setItems((prev) => prev.slice(1)), 360);
    return () => window.clearTimeout(t);
  }, [items]);

  return (
    <span className={`bid-fold${className ? ` ${className}` : ''}`}>
      {items.map((item, index) => (
        <b key={item.id} className={index === items.length - 1 ? 'bid-fold-cur' : 'bid-fold-out'}>{item.text}</b>
      ))}
    </span>
  );
}

function CircularTimer({ remaining, total }: { remaining: number | null; total: number }) {
  if (remaining == null || total <= 0) return null;
  const R = 52;
  const C = 2 * Math.PI * R;
  const frac = Math.max(0, Math.min(1, remaining / total));
  const urgent = remaining <= 10;
  const label = remaining >= 60 ? `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}` : String(remaining);
  return (
    <div className={`la-ring${urgent ? ' la-ring--urgent' : ''}`}>
      <svg viewBox="0 0 128 128" width="128" height="128" aria-hidden>
        <circle className="la-ring-track" cx="64" cy="64" r={R} />
        <circle
          className="la-ring-bar"
          cx="64" cy="64" r={R}
          strokeDasharray={C}
          strokeDashoffset={C * (1 - frac)}
        />
      </svg>
      <div className="la-ring-num">
        <b>{label}</b>
        <span>LOT CLOSES</span>
      </div>
    </div>
  );
}

function PlayerStats({ player, nextUp }: {
  player: NonNullable<AuctionLiveState['current_player']>;
  nextUp: NextUpPlayer[];
}) {
  const bat = (player.batting_style ?? '').replace(/\s*batter$/i, '').trim() || '—';
  const bowl = player.bowling_style?.replace('Do not bowl', 'NO BOWL') || '—';
  const rating = Math.max(1, Math.min(5, player.self_rating || 0));
  const next = nextUp[0];

  const tiles: { icon: string; label: string; value: string; highlight?: string }[] = [
    { icon: '🏏', label: 'BATTING', value: bat },
    { icon: '🎯', label: 'BOWLING', value: bowl },
    { icon: '◉', label: 'ROLE', value: player.player_type, highlight: 'cyan' },
    { icon: '◉', label: 'AVAILABILITY', value: AVAIL2(player.availability), highlight: 'green' },
  ];

  return (
    <>
      <section className="pi-panel pi-stats">
        <div className="pi-head">
          <span className={`pi-badge${player.dpl_played ? ' gold' : ''}`}>{player.dpl_played ? '★ DPL VET' : 'DPL ROOKIE'}</span>
          <span className="pi-sub">{player.location}{player.gender ? ` · ${player.gender}` : ''}</span>
          <span className="pi-rating" aria-label={`${player.self_rating} out of 5`}>
            {'★'.repeat(rating)}<em>{player.self_rating}.0</em>
          </span>
        </div>
        <div className="pi-sep" />
        <div className="pi-grid">
          {tiles.map((tile) => (
            <div className="pi-tile" key={tile.label}>
              <span className={`pi-ic${tile.highlight ? ` ${tile.highlight}` : ''}`}>{tile.icon}</span>
              <div className="pi-tbody">
                <span>{tile.label}</span>
                <b className={tile.highlight ? `val-${tile.highlight}` : ''}>{tile.value}</b>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="pi-panel pi-nextcard">
        <div className="pi-next-head">
          <span>UP NEXT</span>
        </div>
        {next ? (
          <div className="pi-next-row">
            {next.photo_url
              ? <img src={next.photo_url} alt={next.name} />
              : <span className="pi-next-av">{initials(next.name)}</span>}
            <div className="pi-next-info">
              <b>{next.name}</b>
              <span>LOT #{next.lot_order} · {next.player_type}</span>
            </div>
            <em>BASE {formatCompact(next.base_price)}</em>
          </div>
        ) : (
          <div className="pi-next-empty">Queue complete — every player has been processed.</div>
        )}
      </section>
    </>
  );
}

function TeamsPanel({ teams, bid, bidRows, floor }: {
  teams: AuctionLiveState['teams'];
  bid: AuctionLiveState['current_bid'];
  bidRows: AuctionLiveState['bids'];
  floor: number;
}) {
  const [pulseCode, setPulseCode] = useState<string | null>(null);
  const prevBid = useRef<string | null>(null);

  useEffect(() => {
    if (!bid) { prevBid.current = null; return; }
    const key = `${bid.amount}`;
    if (prevBid.current !== null && prevBid.current !== key) {
      setPulseCode(bid.team_code);
      const t = window.setTimeout(() => setPulseCode(null), 700);
      return () => window.clearTimeout(t);
    }
    prevBid.current = key;
  }, [bid]);

  const activeCodes = new Set((bidRows ?? []).slice(0, 3).map((row) => row.team_code));

  return (
    <section className="tps">
      <div className="la-teams">
        {teams.map((team) => {
          const left = team.budget - team.spent;
          const isHighest = bid?.team_id === team.team_id;
          const isFull = team.squad >= 11;
          const inRange = left > floor;
          const low = !isHighest && !isFull && team.budget > 0 && left / team.budget < 0.15;

          let status = { text: '', cls: '', dot: 'watch' };
          if (isFull) status = { text: 'FULL', cls: 'full', dot: 'full' };
          else if (isHighest) status = { text: '👑 HIGHEST', cls: 'high', dot: 'high' };
          else if (activeCodes.has(team.code)) status = { text: 'BIDDING', cls: 'bid', dot: 'bid' };
          else if (!inRange) status = { text: 'OUT OF RANGE', cls: 'out', dot: 'out' };

          const cls = [
            'la-tcard',
            isHighest ? 'high' : '',
            pulseCode === team.code ? 'pulse' : '',
            low ? 'low' : '',
            !inRange && !isHighest ? 'out' : '',
          ].filter(Boolean).join(' ');

          return (
            <div className={cls} key={team.team_id} title={team.name}>
              <div className="la-tcard-top">
                {team.icon_url ? <img className="la-tcard-icon" src={resolveAsset(team.icon_url)} alt="" /> : <span className="la-tcard-icon la-tcard-fb">{initials(team.name)}</span>}
                <div className="la-tcard-id">
                  <b className="la-tcard-code">{team.code || team.name}</b>
                  <span className="la-tcard-name">{team.name}</span>
                </div>
                <span className={`la-tdot ${status.dot}`} />
                {status.text && <span className={`la-tcard-status ${status.cls}`}>{status.text}</span>}
              </div>
              <div className="la-tcard-amt">
                <span>{low ? '⚠ REMAINING' : 'REMAINING'}</span>
                <strong>{formatCompact(left)}</strong>
              </div>
              <div className="la-tcard-budget">
                <span>BUDGET {formatCompact(team.budget)}</span>
                <i>·</i>
                <span>SPENT {formatCompact(team.spent)}</span>
              </div>
              <div className="la-pbar"><span style={{ width: `${team.budget > 0 ? Math.max(0, Math.min(100, (left / team.budget) * 100)) : 0}%` }} /></div>
              <div className="la-tcard-sq">
                <div className="la-tcard-line"><span>SQUAD</span><b>{team.squad}/11</b></div>
                <div className="la-sqbar"><span style={{ width: `${Math.max(0, Math.min(100, (team.squad / 11) * 100))}%` }} /></div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

type FxEvent = { name: string; photo_url: string | null; status: 'sold' | 'unsold'; team_code: string | null; sold_price: number | null };

function ConfettiLayer({ heat }: { heat: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    ctx.scale(dpr, dpr);

    const count = Math.min(240, Math.max(70, Math.round(heat / 4000)));
    const colors = ['#09c9d8', '#2f7dff', '#ffd75e', '#ff8a3c', '#ffffff', '#3ddc97'];
    const parts = Array.from({ length: count }, () => ({
      x: Math.random() * w,
      y: -20 - Math.random() * h * 0.35,
      vy: 2.5 + Math.random() * 3.5,
      vx: -2 + Math.random() * 4,
      s: 5 + Math.random() * 7,
      r: Math.random() * Math.PI,
      vr: -0.2 + Math.random() * 0.4,
      c: colors[Math.floor(Math.random() * colors.length)],
    }));
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const el = (t - t0) / 1000;
      ctx.clearRect(0, 0, w, h);
      for (const p of parts) {
        p.y += p.vy;
        p.x += p.vx + Math.sin((t / 400) + p.r) * 0.6;
        p.r += p.vr;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.r);
        ctx.fillStyle = p.c;
        ctx.globalAlpha = el > 1.8 ? Math.max(0, 1 - (el - 1.8) / 0.6) : 1;
        ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
        ctx.restore();
      }
      if (el < 2.6) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [heat]);
  return <canvas ref={ref} className="fx-confetti" />;
}

function Celebration({ fx, teams, onDone }: { fx: FxEvent; teams: AuctionLiveState['teams']; onDone: () => void }) {
  useEffect(() => {
    const t = window.setTimeout(onDone, 3000);
    return () => window.clearTimeout(t);
  }, [fx, onDone]);

  const sold = fx.status === 'sold';
  const team = teams.find((t) => t.code === fx.team_code);
  return (
    <div className={`fx fx-${fx.status}`} key={`${fx.name}-${fx.status}`}>
      {sold && <ConfettiLayer heat={fx.sold_price ?? 100000} />}
      <div className="fx-stamp">
        <span className="fx-eyebrow">DPL 2026 · PLAYER {sold ? 'SOLD' : 'UNSOLD'}</span>
        <div className={`fx-av${fx.photo_url ? ' has-img' : ''}`}>
          {fx.photo_url ? <img src={fx.photo_url} alt="" /> : <span>{initials(fx.name)}</span>}
          {sold && team?.icon_url && <img className="fx-team-ic" src={resolveAsset(team.icon_url)} alt="" />}
        </div>
        <h2 className="fx-name">{fx.name}</h2>
        {sold ? (
          <>
            <span className="fx-team">{fx.team_code ?? '—'}</span>
            {fx.sold_price != null && <strong className="fx-price">{formatInr(fx.sold_price)}</strong>}
          </>
        ) : (
          <span className="fx-team fx-team--unsold">UNSOLD</span>
        )}
      </div>
    </div>
  );
}

function PricePanel({ player, bid }: {
  player: NonNullable<AuctionLiveState['current_player']>;
  bid: AuctionLiveState['current_bid'];
}) {
  return (
    <section className={`la-pricep${bid ? ' is-live' : ''}`}>
      <div className="la-hero-top">
        <span className="la-hero-label">{bid ? 'CURRENT BID' : 'OPENING BID'}</span>
        <span className="la-hero-base">BASE <b>{formatCompact(player.base_price)}</b></span>
      </div>
      <div className="la-hero-num">
        <FoldNumber value={formatInr(bid?.amount ?? player.base_price)} />
      </div>
    </section>
  );
}

function AVAIL2(availability: string | null | undefined): string {
  if (!availability) return '—';
  return availability.replace('Available for ', '').replace('Need schedule confirmation', 'CONFIRM').toUpperCase();
}

function EmptyStage({ state, countdown }: { state: AuctionLiveState; countdown: number | null }) {
  if (countdown != null) {
    return (
      <div className="la-stage-empty la-stage-empty--count">
        <div className="la-stage-empty-badge">🔨</div>
        <h2>DPL 2026 <span>PLAYER AUCTION</span></h2>
        <CountdownFace seconds={countdown} copy={countdown > 0 ? 'AUCTION STARTS IN' : 'AUCTION TIME — GET READY'} />
      </div>
    );
  }
  const live = state.session?.status === 'live';
  const done = (state.results ?? []).length;
  return (
    <div className="la-stage-empty">
      <div className="la-stage-empty-badge">{live ? '⏳' : state.session ? '🔚' : '🔨'}</div>
      <h2>
        {!state.session ? 'AUCTION PLATFORM' : live ? 'NEXT LOT COMING UP…' : 'AUCTION WRAPPED'}
      </h2>
      <p>
        {!state.session
          ? 'The DPL 2026 player auction has not started yet.'
          : live
            ? `${state.pool_count ?? 0} players still in the pool. Watch this space.`
            : `${done} lots closed — every squad is set. Final results below.`}
      </p>
    </div>
  );
}

export default function AuctionPage() {
  const { dark, toggleTheme } = useTheme();
  const [state, setState] = useState<AuctionLiveState | null>(null);
  const [scheduledAt, setScheduledAt] = useState<string | null>(null);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const [next, schedule] = await Promise.all([fetchAuctionLiveState(), fetchAuctionSchedule()]);
      if (!alive) return;
      setOnline(Boolean(next));
      setScheduledAt(schedule);
      setState(next);
    };
    void load();
    const id = window.setInterval(() => void load(), 4000);
    return () => { alive = false; window.clearInterval(id); };
  }, []);

  const session = state?.session ?? null;
  const live = session?.status === 'live';
  const player = state?.current_player ?? null;
  const bid = state?.current_bid ?? null;
  const remaining = useCountdown(player?.timer_ends_at);
  const scheduledRemaining = useCountdown(scheduledAt);
  const scheduledLeft = scheduledRemaining != null && scheduledRemaining > 0 ? scheduledRemaining : null;

  const countdown = live && player ? null : scheduledLeft;
  const results = state?.results ?? [];

  const [fx, setFx] = useState<FxEvent | null>(null);
  const prevResLen = useRef<number | null>(null);
  useEffect(() => {
    const res = state?.results ?? [];
    if (state && live) {
      const prev = prevResLen.current;
      prevResLen.current = res.length;
      if (prev != null && res.length > prev) {
        const last = res[res.length - 1];
        if (last.source !== 'retained' && (last.status === 'sold' || last.status === 'unsold')) {
          setFx({ name: last.player_name, photo_url: last.photo_url, status: last.status, team_code: last.team_code, sold_price: last.sold_price });
        }
      }
    } else {
      prevResLen.current = null;
    }
  }, [state, live]);

  return (
    <div className={`app auction-page live-auction${dark ? ' dark' : ''}`}>
      <SiteHeader dark={dark} onToggleTheme={toggleTheme} relative={!live} />
      <main className="la-main shell">
        {!state ? (
          <div className="la-stage-empty">
            <div className="la-stage-empty-badge">⌛</div>
            <h2>LOADING AUCTION…</h2>
            {!online && <p>Can&apos;t reach the board — retrying…</p>}
          </div>
        ) : !session ? (
          <EmptyStage state={state} countdown={countdown} />
        ) : (
          <>
            <div className="la-top">
              <span className="la-strip">
                {live ? 'LIVE AUCTION' : 'AUCTION'}
                {player ? <b> · LOT #{player.lot_order}</b> : null}
                <em> · {results.length} CLOSED · {(state?.pool_count ?? 0)} IN POOL</em>
              </span>
              {live ? (
                <span className="la-live-badge"><i /> LIVE</span>
              ) : null}
            </div>

            <div className="la-stage">
              {live && player ? (
                <>
                  <div className="la-live">
                    <div className="lg lg-stats">
                      <PlayerStats player={player} nextUp={state?.next_up ?? []} />
                    </div>
                    <div className="lg lg-card">
                      <Player3DCard key={player.player_id} player={player} />
                    </div>
                    <div className="lg lg-ctop">
                      <CircularTimer remaining={remaining} total={session.lot_timer_seconds} />
                      <PricePanel player={player} bid={bid} />
                    </div>
                    <div className="lg lg-teams">
                      <TeamsPanel
                        teams={state?.teams ?? []}
                        bid={bid}
                        bidRows={state?.bids ?? []}
                        floor={bid?.amount ?? player.base_price ?? 0}
                      />
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <EmptyStage state={state} countdown={countdown} />
                  <aside className="la-rail">
                    <div className="la-panel la-results">
                      <h3>RESULTS</h3>
                      {results.length === 0 ? (
                        <div className="la-panel-empty">Sold &amp; unsold players land here.</div>
                      ) : (
                        <ul>
                          {results.slice(-12).reverse().map((row) => (
                            <li key={`${row.lot_order}-${row.player_name}`} className={row.status}>
                              <span className="la-res-name">{row.player_name}</span>
                              <span className="la-res-price">
                                {row.status === 'sold'
                                  ? `${row.team_code ?? '—'} · ${formatCompact(row.sold_price ?? 0)}${row.source === 'retained' ? ' ★ RETAINED' : ''}`
                                  : 'UNSOLD'}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </aside>
                </>
              )}
            </div>

            {live && player && (
              <section className="la-data">
                <div className="la-data-col">
                  <h3>BID HISTORY</h3>
                  {(state?.bids?.length ?? 0) === 0 ? (
                    <p className="la-data-empty">No bids yet on this lot.</p>
                  ) : (
                    <ul>
                      {(state?.bids ?? []).slice(0, 6).map((row, index) => (
                        <li key={`${row.created_at}-${index}`}>
                          <time>{new Date(row.created_at).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time>
                          <b>{row.team_code}</b>
                          <span>{formatCompact(row.amount)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="la-data-col">
                  <h3>RECENT ACTIVITY</h3>
                  {((state?.bids?.length ?? 0) === 0) ? (
                    <p className="la-data-empty">● Auction opened · waiting for first bid</p>
                  ) : (
                    <ul>
                      {(state?.bids ?? []).slice(0, 6).map((row, index) => {
                        const isTop = index === 0;
                        return (
                          <li key={`a-${row.created_at}-${index}`}>
                            <span>{isTop ? '🔥' : '↑'} {row.team_code} {isTop ? 'took the lead' : 'raised'} to {formatCompact(row.amount)}</span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
                <div className="la-progress">
                  <div className="la-progress-head">
                    <h3>AUCTION PROGRESS</h3>
                    <b>{results.length} / {results.length + (state?.pool_count ?? 0)}</b>
                    <em>{Math.round((results.length / Math.max(1, results.length + (state?.pool_count ?? 0))) * 100)}% COMPLETE · {results.filter((row) => row.status === 'sold').length} SOLD</em>
                  </div>
                  <div className="la-pbar big"><span style={{ width: `${(results.length / Math.max(1, results.length + (state?.pool_count ?? 0))) * 100}%` }} /></div>
                </div>
              </section>
            )}

            {!(live && player) && <TeamStrip state={state} />}
          </>
        )}
      </main>
      {!live && <footer>DPL 2026 · DIGITATE PREMIER LEAGUE · OFFICE CRICKET</footer>}
      {fx && <Celebration fx={fx} teams={state?.teams ?? []} onDone={() => setFx(null)} />}
    </div>
  );
}
