import React, { memo, useEffect, useRef, useState } from 'react';
import { useTheme } from '@/lib/useTheme';
import SiteHeader from '@/components/SiteHeader';
import { resolveAsset } from '@/lib/base';
import {
  fetchAuctionLiveState,
  fetchAuctionSchedule,
  subscribeAuctionRealtime,
  formatCompact,
  formatCountdown,
  formatInr,
  type AuctionLiveState,
  type AuctionResultRow,
} from '@/lib/auction';
import RetroGrid from '@/components/ui/RetroGrid';
import BorderBeam from '@/components/ui/BorderBeam';
import NumberTicker from '@/components/ui/NumberTicker';
import Particles from '@/components/ui/Particles';
import ShinyBadge from '@/components/ui/ShinyBadge';
import { Volume2, VolumeX, Radio, Sparkles } from 'lucide-react';

function initials(name: string): string {
  return name.split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase();
}

// Lightweight capability gate: skip expensive canvas/CSS effects on low-power
// devices or when the user prefers reduced motion.
const prefersReducedMotion = () =>
  typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
const isLowPower = () =>
  typeof navigator !== 'undefined' && (navigator.hardwareConcurrency ?? 8) <= 4;
const FX_ENABLED = !prefersReducedMotion() && !isLowPower();

// Cheap change-signature so we can skip a full re-render when the live state
// hasn't actually changed between polls/realtime events.
function liveStateSignature(state: AuctionLiveState | null): string {
  if (!state) return '';
  const bid = state.current_bid;
  const player = state.current_player;
  const results = state.results ?? [];
  const last = results[results.length - 1];
  return [
    state.session?.updated_at,
    state.session?.status,
    player?.player_id,
    player?.timer_ends_at,
    bid?.team_id,
    bid?.amount,
    bid?.created_at,
    state.bid_count,
    state.pool_count,
    results.length,
    last?.lot_order,
    last?.status,
    last?.sold_price,
    last?.team_code,
  ].join('|');
}

// Web Audio API Sound Synthesizer (No external assets required)
function createAudioSynth() {
  let ctx: AudioContext | null = null;

  const init = (): AudioContext | null => {
    if (!ctx) {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AC) ctx = new AC();
    }
    if (ctx && ctx.state === 'suspended') {
      void ctx.resume();
    }
    return ctx;
  };

  const unlock = () => {
    init();
  };

  // Single scheduling primitive — schedules against ctx.currentTime so a
  // still-resuming context plays correctly once it transitions to 'running'.
  const tone = (
    freqStart: number,
    freqEnd: number,
    gainLevel: number,
    duration: number,
    type: OscillatorType = 'triangle',
    delay = 0
  ) => {
    const c = init();
    if (!c) return;
    const t0 = c.currentTime + delay;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freqStart, t0);
    if (freqEnd !== freqStart) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t0 + duration);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(gainLevel, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(gain);
    gain.connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.05);
  };

  const playTick = () => tone(1050, 700, 0.22, 0.07, 'square');
  const playBid = () => {
    tone(523.25, 523.25, 0.2, 0.16, 'triangle');
    tone(659.25, 659.25, 0.2, 0.24, 'sine', 0.02);
  };
  const playSold = () => {
    tone(220, 440, 0.26, 0.5, 'sine');
    tone(660, 880, 0.18, 0.42, 'triangle', 0.1);
  };
  const playConfirm = () => {
    tone(660, 660, 0.24, 0.12, 'sine');
    tone(990, 990, 0.24, 0.18, 'sine', 0.09);
  };

  return { unlock, playTick, playBid, playSold, playConfirm };
}

const synth = createAudioSynth();

function useCountdown(endAt: string | null | undefined, soundOn: boolean): number | null {
  const [rem, setRem] = useState<number | null>(() =>
    endAt ? Math.max(0, Math.ceil((new Date(endAt).getTime() - Date.now()) / 1000)) : null
  );

  useEffect(() => {
    if (!endAt) {
      setRem(null);
      return;
    }
    const tick = () => {
      const next = Math.max(0, Math.ceil((new Date(endAt).getTime() - Date.now()) / 1000));
      setRem((prev) => (prev === next ? prev : next));
    };
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [endAt]);

  const prevSec = useRef<number | null>(null);
  useEffect(() => {
    if (soundOn && rem != null && rem > 0 && rem <= 10 && prevSec.current !== rem) {
      prevSec.current = rem;
      synth.playTick();
    }
  }, [rem, soundOn]);

  return rem;
}

function TeamStrip({ state }: { state: AuctionLiveState }) {
  const teams = state.teams ?? [];
  const squadSize = state.squad_size ?? 11;
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
                  {team.icon_url ? (
                    <img className="la-team-icon" src={resolveAsset(team.icon_url)} alt="" />
                  ) : (
                    <span className="la-team-icon la-team-icon--fb">{initials(team.name)}</span>
                  )}
                  <span className="la-team-code">{team.code || team.name}</span>
                  <span className="la-team-squad">{team.squad}/{squadSize}</span>
                </div>
                <div className="la-team-bar">
                  <i style={{ width: `${pct}%` }} />
                </div>
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
        <div className="la-purse-note">{teams.length || 8} teams · {formatInr(totalBudget)} combined purse</div>
      )}
    </div>
  );
}

function FlipDigit({ digit }: { digit: string }) {
  const [previous, setPrevious] = useState(digit);
  const [flipping, setFlipping] = useState(false);
  const prevRef = useRef(digit);

  useEffect(() => {
    if (digit === prevRef.current) return;
    setPrevious(prevRef.current);
    prevRef.current = digit;
    setFlipping(true);
    const t = window.setTimeout(() => setFlipping(false), 600);
    return () => window.clearTimeout(t);
  }, [digit]);

  return (
    <span className="flip-unit">
      <span className="flip-card">
        <span className="flip-half flip-top">
          <span className="flip-val">{digit}</span>
        </span>
        <span className="flip-half flip-bottom">
          <span className="flip-val">{flipping ? previous : digit}</span>
        </span>
        {flipping && (
          <span className="flip-half flip-fold">
            <span className="flip-val">{previous}</span>
          </span>
        )}
      </span>
    </span>
  );
}

function CountdownFace({ seconds, copy }: { seconds: number; copy: string }) {
  const parts = formatCountdown(seconds);
  const cells =
    parts.days > 0
      ? [
          { k: 'DAYS', v: parts.days },
          { k: 'HRS', v: parts.hours },
          { k: 'MIN', v: parts.minutes },
          { k: 'SEC', v: parts.seconds },
        ]
      : [
          { k: 'HRS', v: parts.hours },
          { k: 'MIN', v: parts.minutes },
          { k: 'SEC', v: parts.seconds },
        ];
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    <div className="la-countdown">
      <div className="la-cd-badge">
        <img className="la-countdown-hammer" src={resolveAsset('/hammer.svg')} alt="Auction hammer" />
      </div>
      <span className="la-cd-eyebrow">DPL 2026 · PLAYER AUCTION</span>
      <h1 className="la-countdown-title">{copy}</h1>
      <div className="la-countdown-cols">
        {cells.map((cell, i) => {
          const text = pad(cell.v);
          return (
            <React.Fragment key={cell.k}>
              {i > 0 && <span className="la-cd-sep">:</span>}
              <div className="la-cd-unit">
                <div className="la-cd-pair">
                  {text.split('').map((ch, j) => (
                    <FlipDigit key={j} digit={ch} />
                  ))}
                </div>
                <span className="la-cd-label">{cell.k}</span>
              </div>
            </React.Fragment>
          );
        })}
      </div>
      <p className="la-cd-sub">The hammer drops soon — watch this space.</p>
    </div>
  );
}

function Player3DCard({ player }: { player: NonNullable<AuctionLiveState['current_player']> }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [tilt, setTilt] = useState({ x: 0, y: 0, live: false });

  const onMove = (event: React.PointerEvent) => {
    const el = wrap.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = (event.clientX - rect.left) / rect.width - 0.5;
    const py = (event.clientY - rect.top) / rect.height - 0.5;
    setTilt({ x: py * -18, y: px * 22, live: true });
  };
  const onLeave = () => setTilt({ x: 0, y: 0, live: false });

  return (
    <div ref={wrap} className="la-3d-wrap" onPointerMove={onMove} onPointerLeave={onLeave}>
      <article
        className="la-3d"
        style={{
          transform: `rotateX(${tilt.x.toFixed(2)}deg) rotateY(${tilt.y.toFixed(2)}deg)`,
          transition: tilt.live ? 'transform 100ms linear' : 'transform 700ms cubic-bezier(.25,1.4,.35,1)',
        }}
      >
        <BorderBeam colorFrom="#09c9d8" colorTo="#ffd75e" duration={6} size={260} />
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
            <ShinyBadge variant={player.dpl_played ? 'gold' : 'cyan'}>
              {player.dpl_played ? '★ DPL VET' : 'ROOKIE'}
            </ShinyBadge>
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

function CircularTimer({ remaining, total }: { remaining: number | null; total: number }) {
  if (remaining == null || total <= 0) return null;
  const R = 52;
  const C = 2 * Math.PI * R;
  const frac = Math.max(0, Math.min(1, remaining / total));
  const urgent = remaining <= 10;
  const label =
    remaining >= 60
      ? `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`
      : String(remaining);

  return (
    <div className={`la-ring-podium${urgent ? ' urgent' : ''}`}>
      <div className={`la-ring${urgent ? ' la-ring--urgent' : ''}`} style={{ position: 'relative' }}>
        {/* Animated Radar Pulse Ring */}
        <div className="la-radar-ping" />

        <svg viewBox="0 0 128 128" width="128" height="128" aria-hidden>
          <circle className="la-ring-track" cx="64" cy="64" r={R} />
          <circle
            className="la-ring-bar"
            cx="64"
            cy="64"
            r={R}
            strokeDasharray={C}
            strokeDashoffset={C * (1 - frac)}
            style={{
              stroke: urgent ? '#ff4b6e' : 'url(#timerGrad)',
              transition: 'stroke-dashoffset 0.4s linear, stroke 0.3s ease',
            }}
          />
          <defs>
            <linearGradient id="timerGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#09c9d8" />
              <stop offset="100%" stopColor="#3ddc97" />
            </linearGradient>
          </defs>
        </svg>

        <div className="la-ring-num">
          <b>{label}</b>
          <span className={urgent ? 'la-urgent-text' : ''}>
            {urgent ? '⌛ FINAL CALL' : 'TIME REMAINING'}
          </span>
        </div>
      </div>
    </div>
  );
}

function PlayerStats({ player }: { player: NonNullable<AuctionLiveState['current_player']> }) {
  const bat = (player.batting_style ?? '').replace(/\s*batter$/i, '').trim() || '—';
  const bowl = player.bowling_style?.replace('Do not bowl', 'NO BOWL') || '—';
  const rating = Math.max(1, Math.min(5, player.self_rating || 0));

  const tiles: { icon: string; label: string; value: string; tone?: 'cyan' | 'green' | 'gold' | 'violet' }[] = [
    { icon: '🏏', label: 'BATTING', value: bat },
    { icon: '🎯', label: 'BOWLING', value: bowl, tone: 'violet' },
    { icon: '🎭', label: 'ROLE', value: player.player_type, tone: 'cyan' },
    { icon: '⚡', label: 'AVAILABILITY', value: AVAIL2(player.availability), tone: 'green' },
  ];

  return (
    <section className="pi-panel pi-stats">
      <div className="pi-head">
        <span className={`pi-avatar${player.dpl_played ? ' pi-avatar--vet' : ''}`}>{initials(player.name)}</span>
        <div className="pi-id">
          <div className="pi-id-row">
            <ShinyBadge variant={player.dpl_played ? 'gold' : 'cyan'}>
              {player.dpl_played ? '★ DPL VET' : 'DPL ROOKIE'}
            </ShinyBadge>
            <span className="pi-lot">LOT #{player.lot_order}</span>
          </div>
          <span className="pi-sub">
            {player.location}
            {player.gender ? ` · ${player.gender}` : ''}
          </span>
        </div>
        <span className="pi-rating" aria-label={`${player.self_rating} out of 5`}>
          {'★'.repeat(rating)}
          <em>{player.self_rating}.0</em>
        </span>
      </div>
      <div className="pi-sep" />
      <div className="pi-grid">
        {tiles.map((tile) => (
          <div className="pi-tile" key={tile.label}>
            <span className={`pi-ic${tile.tone ? ` pi-ic--${tile.tone}` : ''}`}>{tile.icon}</span>
            <div className="pi-tbody">
              <span>{tile.label}</span>
              <b className={tile.tone ? `val-${tile.tone}` : ''}>{tile.value}</b>
            </div>
          </div>
        ))}
      </div>
      <div className="pi-meta">
        <span className="pi-chip">BASE <b>{formatCompact(player.base_price)}</b></span>
        <span className="pi-chip">TYPE <b>{player.player_type}</b></span>
      </div>
    </section>
  );
}

function TeamsPanel({
  teams,
  bid,
  bidRows,
  floor,
  squadSize,
}: {
  teams: AuctionLiveState['teams'];
  bid: AuctionLiveState['current_bid'];
  bidRows: AuctionLiveState['bids'];
  floor: number;
  squadSize: number;
}) {
  const [pulseCode, setPulseCode] = useState<string | null>(null);
  const prevBid = useRef<string | null>(null);

  useEffect(() => {
    if (!bid) {
      prevBid.current = null;
      return;
    }
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
          const isFull = team.squad >= squadSize;
          const inRange = left > floor;
          const low = !isHighest && !isFull && team.budget > 0 && left / team.budget < 0.15;
          const squadCount = Math.min(squadSize, Math.max(0, team.squad || 0));

          let status: { text: string; cls: string; dot: string; badgeVar: 'cyan' | 'gold' | 'green' | 'red' | 'purple' } = {
            text: '',
            cls: '',
            dot: 'watch',
            badgeVar: 'cyan',
          };
          if (isFull) status = { text: 'FULL', cls: 'full', dot: 'full', badgeVar: 'purple' as const };
          else if (isHighest) status = { text: '👑 HIGHEST', cls: 'high', dot: 'high', badgeVar: 'gold' as const };
          else if (activeCodes.has(team.code)) status = { text: 'BIDDING', cls: 'bid', dot: 'bid', badgeVar: 'green' as const };
          else if (!inRange) status = { text: 'OUT OF RANGE', cls: 'out', dot: 'out', badgeVar: 'red' as const };

          const cls = [
            'la-tcard',
            isHighest ? 'high' : '',
            pulseCode === team.code ? 'pulse' : '',
            low ? 'low' : '',
            !inRange && !isHighest ? 'out' : '',
          ]
            .filter(Boolean)
            .join(' ');

          return (
            <div className={cls} key={team.team_id} title={team.name} style={{ position: 'relative' }}>
              {isHighest && <BorderBeam colorFrom="#ffd75e" colorTo="#3ddc97" duration={4} size={200} />}

              {/* Franchise Header */}
              <div className="la-tcard-top">
                {team.icon_url ? (
                  <img className="la-tcard-icon" src={resolveAsset(team.icon_url)} alt="" />
                ) : (
                  <span className="la-tcard-icon la-tcard-fb">{initials(team.name)}</span>
                )}
                <div className="la-tcard-id">
                  <b className="la-tcard-code">{team.code || team.name}</b>
                  <span className="la-tcard-name">{team.name}</span>
                </div>
                <span className={`la-tdot ${status.dot}`} />
                {status.text && <ShinyBadge variant={status.badgeVar}>{status.text}</ShinyBadge>}
              </div>

              {/* Remaining Purse Hero Figure */}
              <div className="la-tcard-amt">
                <span>{low ? '⚠ PURSE LEFT' : 'REMAINING PURSE'}</span>
                <strong>
                  <NumberTicker value={left} formatter={(val) => formatCompact(val)} />
                </strong>
              </div>

              {/* Purse Progress Bar */}
              <div className="la-pbar">
                <span
                  style={{
                    width: `${team.budget > 0 ? Math.max(0, Math.min(100, (left / team.budget) * 100)) : 0}%`,
                    background: low
                      ? 'linear-gradient(90deg, #ff8a3c, #ffd75e)'
                      : 'linear-gradient(90deg, #16c79a, #0fd8c4)',
                  }}
                />
              </div>

              {/* Visual Squad Slot Matrix */}
              <div className="la-tcard-sq">
                <div className="la-tcard-line">
                  <span>SQUAD SLOTS</span>
                  <b>{squadCount}/{squadSize}</b>
                </div>
                <div className="la-sq-matrix" aria-label={`Squad ${squadCount} of ${squadSize} filled`}>
                  {Array.from({ length: squadSize }).map((_, i) => (
                    <span
                      key={i}
                      className={`la-sq-dot${i < squadCount ? ' filled' : ''}`}
                      title={`Slot ${i + 1}: ${i < squadCount ? 'Filled' : 'Empty'}`}
                    />
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

type FxEvent = {
  name: string;
  photo_url: string | null;
  status: 'sold' | 'unsold';
  team_code: string | null;
  sold_price: number | null;
};

function ConfettiLayer({ heat }: { heat: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!FX_ENABLED) return;
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
        p.x += p.vx + Math.sin(t / 400 + p.r) * 0.6;
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
  if (!FX_ENABLED) return null;
  return <canvas ref={ref} className="fx-confetti" />;
}

function Celebration({
  fx,
  teams,
  onDone,
}: {
  fx: FxEvent;
  teams: AuctionLiveState['teams'];
  onDone: () => void;
}) {
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
            {fx.sold_price != null && (
              <strong className="fx-price">
                <NumberTicker value={fx.sold_price} formatter={(v) => formatInr(v)} />
              </strong>
            )}
          </>
        ) : (
          <span className="fx-team fx-team--unsold">UNSOLD</span>
        )}
      </div>
    </div>
  );
}

function PricePanel({
  player,
  bid,
}: {
  player: NonNullable<AuctionLiveState['current_player']>;
  bid: AuctionLiveState['current_bid'];
}) {
  const currentVal = bid?.amount ?? player.base_price;
  const isHighBid = Boolean(bid);

  return (
    <section className={`la-pricep${isHighBid ? ' is-live' : ''}`} style={{ position: 'relative' }}>
      <BorderBeam
        colorFrom={isHighBid ? '#3ddc97' : '#09c9d8'}
        colorTo={isHighBid ? '#ffd75e' : '#2f7dff'}
        duration={isHighBid ? 3.5 : 6}
        size={240}
      />

      <div className="la-hero-top">
        <ShinyBadge variant={isHighBid ? 'gold' : 'cyan'}>
          {isHighBid ? '🔥 LIVE HIGH BID' : '🔨 BASE BID'}
        </ShinyBadge>
        <span className="la-hero-base">
          BASE <b>{formatCompact(player.base_price)}</b>
        </span>
      </div>

      <div className="la-hero-num">
        <NumberTicker value={currentVal} formatter={(val) => formatInr(val)} />
      </div>

      {bid ? (
        <div className="la-leader-spotlight">
          <span className="la-leader-badge">
            <span className="la-leader-crown">👑</span>
            <b className="la-leader-code">{bid.team_code}</b>
            <span className="la-leader-name">{bid.team_name || 'LEADING BIDDER'}</span>
          </span>
          <span className="la-leader-tag">HOLDING LOT</span>
        </div>
      ) : (
        <div className="la-leader-spotlight la-leader-waiting">
          <span>● AWAITING FIRST BID FROM TEAMS</span>
        </div>
      )}
    </section>
  );
}

function AVAIL2(availability: string | null | undefined): string {
  if (!availability) return '—';
  return availability.replace('Available for ', '').replace('Need schedule confirmation', 'CONFIRM').toUpperCase();
}

// Suspense teaser shown while the session is live but no lot is on stage —
// the next player is a surprise, so we reveal nothing about who's coming.
function NextLotTeaser() {
  return (
    <div className="la-teaser">
      <span className="la-teaser-ring" />
      <div className="la-teaser-copy">
        <span className="la-teaser-eyebrow">DPL 2026 · AUCTION LIVE</span>
        <h2>DRAWING THE NEXT LOT…</h2>
        <p>The committee is selecting the next player. Hold tight — the hammer drops soon.</p>
      </div>
    </div>
  );
}

// Interactive profile cards for the recently closed lots (sold + unsold).
function ResultCards({ results, teams }: { results: AuctionResultRow[]; teams: AuctionLiveState['teams'] }) {
  const rows = [...results].reverse().slice(0, 6);
  return (
    <div className="la-results-stage">
      <div className="la-results-head">
        <div>
          <span className="la-results-eyebrow">AUCTION LEDGER</span>
          <h2>RECENTLY CLOSED LOTS</h2>
        </div>
        <span className="la-results-count">{results.length} CLOSED</span>
      </div>
      {rows.length === 0 ? (
        <div className="la-results-empty">No lots closed yet — the first hammer drop lands here.</div>
      ) : (
        <div className="la-results-grid">
          {rows.map((row) => {
            const team = teams.find((t) => t.code === row.team_code);
            const sold = row.status === 'sold';
            const retainedFree = row.source === 'retained' && !row.sold_price;
            return (
              <div className={`la-rcard${sold ? ' sold' : ' unsold'}`} key={`${row.lot_order}-${row.player_name}`}>
                <div className="la-rcard-av">
                  {row.photo_url ? (
                    <img src={row.photo_url} alt={row.player_name} />
                  ) : (
                    <span>{initials(row.player_name)}</span>
                  )}
                  {sold && team?.icon_url && <img className="la-rcard-team" src={resolveAsset(team.icon_url)} alt="" />}
                </div>
                <div className="la-rcard-body">
                  <span className="la-rcard-type">{row.player_type}</span>
                  <b className="la-rcard-name">{row.player_name}</b>
                  <span className="la-rcard-meta">LOT #{row.lot_order}{row.source === 'retained' ? ' · ★ RETAINED' : ''}</span>
                </div>
                <div className="la-rcard-price">
                  {sold ? (
                    retainedFree ? (
                      <span className="la-rcard-retained">RETAINED</span>
                    ) : (
                      <>
                        <span className="la-rcard-team">{row.team_code ?? '—'}</span>
                        <b>{formatInr(row.sold_price ?? 0)}</b>
                      </>
                    )
                  ) : (
                    <span className="la-rcard-unsold">UNSOLD</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Generate rich mock demo live state when offline or demo toggled
function createMockDemoState(): AuctionLiveState {
  const mockTeams = [
    { team_id: 't1', name: 'Royal Strikers', code: 'RST', icon_url: '', theme: '#09c9d8', budget: 10000000, spent: 4200000, squad: 6, sold: 6 },
    { team_id: 't2', name: 'Titan Warriors', code: 'TWR', icon_url: '', theme: '#ffd75e', budget: 10000000, spent: 3800000, squad: 5, sold: 5 },
    { team_id: 't3', name: 'Thunder Kings', code: 'TKG', icon_url: '', theme: '#ff8a3c', budget: 10000000, spent: 5100000, squad: 7, sold: 7 },
    { team_id: 't4', name: 'Cyber Panthers', code: 'CPN', icon_url: '', theme: '#3ddc97', budget: 10000000, spent: 2900000, squad: 4, sold: 4 },
    { team_id: 't5', name: 'Phoenix Eleven', code: 'PHX', icon_url: '', theme: '#873cff', budget: 10000000, spent: 4600000, squad: 6, sold: 6 },
    { team_id: 't6', name: 'Vanguard Tigers', code: 'VGT', icon_url: '', theme: '#ff4b6e', budget: 10000000, spent: 3100000, squad: 5, sold: 5 },
  ];

  return {
    session: {
      id: 'demo-s1',
      name: 'DPL 2026 Mega Auction (Live Demo)',
      status: 'live',
      purse_budget: 10000000,
      increment: 100000,
      started_at: new Date().toISOString(),
      ended_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      lot_timer_seconds: 45,
    },
    current_player: {
      player_id: 'p-hero',
      name: 'Karan Sharma',
      employee_id: 'EMP-104',
      photo_url: null,
      player_type: 'All-Rounder',
      gender: 'Male',
      location: 'Pune Stadium',
      dpl_played: true,
      self_rating: 5,
      availability: 'Available for full tournament',
      batting_style: 'Right-Handed Power Hitter',
      bowling_style: 'Right-Arm Fast Medium',
      lot_order: 14,
      base_price: 500000,
      timer_ends_at: new Date(Date.now() + 38000).toISOString(),
    },
    current_bid: {
      team_id: 't1',
      team_name: 'Royal Strikers',
      team_code: 'RST',
      amount: 1800000,
    },
    bid_count: 7,
    bids: [
      { team_code: 'RST', amount: 1800000, created_at: new Date(Date.now() - 3000).toISOString() },
      { team_code: 'TWR', amount: 1600000, created_at: new Date(Date.now() - 12000).toISOString() },
      { team_code: 'RST', amount: 1400000, created_at: new Date(Date.now() - 21000).toISOString() },
      { team_code: 'CPN', amount: 1100000, created_at: new Date(Date.now() - 29000).toISOString() },
      { team_code: 'TWR', amount: 800000, created_at: new Date(Date.now() - 38000).toISOString() },
    ],
    teams: mockTeams,
    pool_count: 24,
    results: [
      { player_name: 'Rahul Varma', photo_url: null, player_type: 'Batter', team_code: 'TKG', sold_price: 2400000, status: 'sold', lot_order: 13 },
      { player_name: 'Amit Deshmukh', photo_url: null, player_type: 'Bowler', team_code: 'PHX', sold_price: 1500000, status: 'sold', lot_order: 12 },
      { player_name: 'Siddharth Roy', photo_url: null, player_type: 'Wicket Keeper', team_code: null, sold_price: null, status: 'unsold', lot_order: 11 },
    ],
    next_up: [
      { player_id: 'p-next1', name: 'Vikramaditya Singh', photo_url: null, player_type: 'Fast Bowler', lot_order: 15, base_price: 400000 },
      { player_id: 'p-next2', name: 'Rohan Mehta', photo_url: null, player_type: 'Spin Bowler', lot_order: 16, base_price: 300000 },
    ],
  };
}

const MemoTeamStrip = memo(TeamStrip);
const MemoPlayer3DCard = memo(Player3DCard);
const MemoCircularTimer = memo(CircularTimer);
const MemoPlayerStats = memo(PlayerStats);
const MemoTeamsPanel = memo(TeamsPanel);
const MemoPricePanel = memo(PricePanel);
const MemoResultCards = memo(ResultCards);

export default function AuctionPage() {
  const { dark, toggleTheme } = useTheme();
  const [state, setState] = useState<AuctionLiveState | null>(null);
  const [scheduledAt, setScheduledAt] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const [soundOn, setSoundOn] = useState(true);
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [activeDrawer, setActiveDrawer] = useState<'bids' | 'activity' | null>(null);
  const lastSigRef = useRef<string>('');

  // Unlock Web Audio on first user gesture (browsers block audio until interaction)
  useEffect(() => {
    const unlock = () => synth.unlock();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    window.addEventListener('touchstart', unlock);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('touchstart', unlock);
    };
  }, []);

  // Load backend live state: realtime-driven with a slow polling fallback.
  useEffect(() => {
    if (isDemoMode) return;
    let alive = true;
    lastSigRef.current = '';

    const load = async () => {
      const next = await fetchAuctionLiveState();
      if (!alive) return;
      setOnline(Boolean(next));
      if (!next) return;
      const sig = liveStateSignature(next);
      if (sig === lastSigRef.current) return;
      lastSigRef.current = sig;
      if (next.session) {
        setState(next);
      } else {
        // If server state has no active session, provide fallback demo preview
        setState(createMockDemoState());
      }
    };

    void load();
    const unsubscribe = subscribeAuctionRealtime(() => void load());
    const poll = window.setInterval(() => void load(), 15000);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      alive = false;
      unsubscribe();
      window.clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [isDemoMode]);

  // Schedule is fetched once (it rarely changes).
  useEffect(() => {
    let alive = true;
    fetchAuctionSchedule().then((schedule) => {
      if (alive) setScheduledAt(schedule);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Demo simulation mode toggle
  const toggleDemo = () => {
    if (!isDemoMode) {
      setIsDemoMode(true);
      setState(createMockDemoState());
      synth.unlock();
      synth.playConfirm();
    } else {
      setIsDemoMode(false);
    }
  };

  // Demo bidding interval simulation
  useEffect(() => {
    if (!isDemoMode || !state?.current_player) return;
    const demoTeams = ['RST', 'TWR', 'TKG', 'CPN', 'PHX', 'VGT'];

    const interval = window.setInterval(() => {
      setState((prev) => {
        if (!prev || !prev.current_player) return prev;
        const curBid = prev.current_bid?.amount || prev.current_player.base_price;
        const nextAmt = curBid + 200000;
        const randomTeamCode = demoTeams[Math.floor(Math.random() * demoTeams.length)];
        const targetTeam = prev.teams.find((t) => t.code === randomTeamCode) || prev.teams[0];

        if (soundOn) synth.playBid();

        return {
          ...prev,
          current_bid: {
            team_id: targetTeam.team_id,
            team_name: targetTeam.name,
            team_code: targetTeam.code,
            amount: nextAmt,
          },
          bids: [
            { team_code: targetTeam.code, amount: nextAmt, created_at: new Date().toISOString() },
            ...(prev.bids || []).slice(0, 7),
          ],
        };
      });
    }, 5500);

    return () => window.clearInterval(interval);
  }, [isDemoMode, state?.current_player, soundOn]);

  const session = state?.session ?? null;
  const live = session?.status === 'live';
  const player = state?.current_player ?? null;
  const bid = state?.current_bid ?? null;
  const remaining = useCountdown(player?.timer_ends_at, soundOn);
  const scheduledRemaining = useCountdown(scheduledAt, soundOn);
  const scheduledLeft = scheduledRemaining != null && scheduledRemaining > 0 ? scheduledRemaining : null;

  const countdown = live && player ? null : scheduledLeft;
  const results = state?.results ?? [];
  const totalLots = results.length + (state?.pool_count ?? 0);
  const progressPct = totalLots > 0 ? Math.round((results.length / totalLots) * 100) : 0;

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
          setFx({
            name: last.player_name,
            photo_url: last.photo_url,
            status: last.status,
            team_code: last.team_code,
            sold_price: last.sold_price,
          });
          if (soundOn) synth.playSold();
        }
      }
    } else {
      prevResLen.current = null;
    }
  }, [state, live, soundOn]);

  return (
    <div
      className={`app auction-page live-auction${dark ? ' dark' : ''}`}
      style={{ position: 'relative' }}
      data-reduced={FX_ENABLED ? undefined : ''}
    >
      {FX_ENABLED && <RetroGrid angle={60} />}
      {FX_ENABLED && <Particles quantity={45} color="#09c9d8" />}

      <SiteHeader dark={dark} onToggleTheme={toggleTheme} relative={!live} />
      <main className="la-main shell" style={{ position: 'relative', zIndex: 10 }}>
        {!state ? (
          <div className="la-stage-empty">
            <div className="la-stage-empty-badge">⌛</div>
            <h2>LOADING LIVE BROADCAST AUCTION…</h2>
            {!online && <p>Connecting to broadcast feed — retrying…</p>}
          </div>
        ) : !live ? (
          <div className="la-countdown-only">
            {countdown != null ? (
              <CountdownFace
                seconds={countdown}
                copy={countdown > 0 ? 'AUCTION STARTS IN' : 'AUCTION TIME — GET READY'}
              />
            ) : (
              <div className="la-stage-empty">
                <div className="la-stage-empty-badge">
                  <img src={resolveAsset('/hammer.svg')} alt="Auction hammer" />
                </div>
                <h2>DPL 2026 AUCTION</h2>
                <p>Live broadcast starts soon — stay tuned.</p>
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Top Broadcast Header */}
            <div className="la-top">
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
                <span className="la-strip">
                  {live ? 'LIVE BROADCAST AUCTION' : 'AUCTION'}
                </span>
                {live && <ShinyBadge variant="red">● LIVE</ShinyBadge>}

                {/* AUCTION PROGRESS BAR MOVED TO TOP HEADER */}
                {live && (
                  <div className="la-top-progress-chip" title={`${results.length} of ${totalLots} lots completed`}>
                    <span className="la-top-prog-label">PROGRESS: {progressPct}%</span>
                    <div className="la-top-prog-bar">
                      <span style={{ width: `${progressPct}%` }} />
                    </div>
                    <span className="la-top-prog-sub">{results.length}/{totalLots} CLOSED</span>
                  </div>
                )}
              </div>

              <div className="la-header-actions">
                {/* Left Drawer Triggers */}
                {live && (
                  <>
                    <button
                      type="button"
                      className={`la-ctrl-btn${activeDrawer === 'bids' ? ' active' : ''}`}
                      onClick={() => setActiveDrawer(activeDrawer === 'bids' ? null : 'bids')}
                      title="Toggle Bid History Side Drawer"
                    >
                      <span>📜 BIDS ({state?.bids?.length ?? 0})</span>
                    </button>

                    <button
                      type="button"
                      className={`la-ctrl-btn${activeDrawer === 'activity' ? ' active' : ''}`}
                      onClick={() => setActiveDrawer(activeDrawer === 'activity' ? null : 'activity')}
                      title="Toggle Activity Feed Side Drawer"
                    >
                      <span>⚡ ACTIVITY</span>
                    </button>
                  </>
                )}

                <button
                  type="button"
                  className={`la-ctrl-btn${soundOn ? ' active' : ''}`}
                  onClick={() => {
                    synth.unlock();
                    const next = !soundOn;
                    setSoundOn(next);
                    if (next) synth.playConfirm();
                  }}
                  title="Toggle Audio Feedback SFX"
                >
                  {soundOn ? <Volume2 size={14} /> : <VolumeX size={14} />}
                  <span>{soundOn ? 'AUDIO ON' : 'MUTED'}</span>
                </button>

                <button
                  type="button"
                  className={`la-ctrl-btn${isDemoMode ? ' active' : ''}`}
                  onClick={toggleDemo}
                  title="Toggle Interactive Broadcast Demo Simulation"
                >
                  <Sparkles size={14} />
                  <span>{isDemoMode ? 'DEMO BROADCASTING' : 'DEMO MODE'}</span>
                </button>
              </div>
            </div>

            {/* Main Stage Grid (Teams Panel Gets Full Height) */}
            <div className="la-stage" style={{ flex: 1, minHeight: 0 }}>
              {live && player ? (
                <>
                  <div className="la-live" style={{ height: '100%' }}>
                    <div className="lg lg-stats">
                      <MemoPlayerStats player={player} />
                    </div>
                    <div className="lg lg-card">
                      <MemoPlayer3DCard key={player.player_id} player={player} />
                    </div>
                    <div className="lg lg-ctop">
                      <MemoCircularTimer remaining={remaining} total={session.lot_timer_seconds} />
                      <MemoPricePanel player={player} bid={bid} />
                    </div>
                    <div className="lg lg-teams" style={{ height: '100%' }}>
                      <MemoTeamsPanel
                        teams={state?.teams ?? []}
                        bid={bid}
                        bidRows={state?.bids ?? []}
                        floor={bid?.amount ?? player.base_price ?? 0}
                        squadSize={state?.squad_size ?? 11}
                      />
                    </div>
                  </div>
                </>
              ) : (
                <div className="la-between">
                  <NextLotTeaser />
                  <MemoResultCards results={results} teams={state?.teams ?? []} />
                </div>
              )}
            </div>

            {!(live && player) && <MemoTeamStrip state={state} />}
          </>
        )}
      </main>

      {/* LEFT SIDE DRAWER POPUP FOR BID HISTORY & RECENT ACTIVITY */}
      {activeDrawer && (
        <div className="la-drawer-backdrop" onClick={() => setActiveDrawer(null)}>
          <aside className="la-drawer-left" onClick={(e) => e.stopPropagation()}>
            <div className="la-drawer-head">
              <div className="la-drawer-tabs">
                <button
                  type="button"
                  className={`la-drawer-tab${activeDrawer === 'bids' ? ' active' : ''}`}
                  onClick={() => setActiveDrawer('bids')}
                >
                  📜 BID HISTORY ({state?.bids?.length ?? 0})
                </button>
                <button
                  type="button"
                  className={`la-drawer-tab${activeDrawer === 'activity' ? ' active' : ''}`}
                  onClick={() => setActiveDrawer('activity')}
                >
                  ⚡ RECENT ACTIVITY
                </button>
              </div>
              <button type="button" className="la-drawer-close" onClick={() => setActiveDrawer(null)}>
                ✕
              </button>
            </div>

            <div className="la-drawer-body">
              {activeDrawer === 'bids' ? (
                <div className="la-drawer-section">
                  {(state?.bids?.length ?? 0) === 0 ? (
                    <p className="la-data-empty">No bids submitted on this lot yet.</p>
                  ) : (
                    <ul className="la-drawer-list">
                      {(state?.bids ?? []).map((row, index) => (
                        <li key={`${row.created_at}-${index}`} className="la-drawer-item">
                          <time>
                            {new Date(row.created_at).toLocaleTimeString([], {
                              hour12: false,
                              hour: '2-digit',
                              minute: '2-digit',
                              second: '2-digit',
                            })}
                          </time>
                          <b className="la-drawer-team">{row.team_code}</b>
                          <span className="la-drawer-amt">
                            <NumberTicker value={row.amount} formatter={(v) => formatInr(v)} />
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : (
                <div className="la-drawer-section">
                  {(state?.bids?.length ?? 0) === 0 ? (
                    <p className="la-data-empty">● Auction opened · waiting for first bid</p>
                  ) : (
                    <ul className="la-drawer-list">
                      {(state?.bids ?? []).map((row, index) => {
                        const isTop = index === 0;
                        return (
                          <li key={`act-${row.created_at}-${index}`} className="la-drawer-item">
                            <span className="la-drawer-act-text">
                              {isTop ? '🔥' : '↑'} <b>{row.team_code}</b> {isTop ? 'took the lead' : 'raised bid'} to{' '}
                              <strong className="la-drawer-gold">{formatInr(row.amount)}</strong>
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              )}
            </div>
          </aside>
        </div>
      )}

      {/* Broadcast Rolling Ticker Marquee */}
      {live && player && (
        <footer className="la-ticker-wrap">
          <div className="la-ticker-tag">
            <Radio size={12} style={{ display: 'inline', marginRight: 4 }} /> LIVE FEED
          </div>
          <div className="la-ticker-track">
            <div className="la-ticker-item">
              <span>LOT #{player.lot_order}</span> <b>{player.name.toUpperCase()}</b> ({player.player_type}) · BASE{' '}
              {formatCompact(player.base_price)}
            </div>
            <div className="la-ticker-item">
              <span>CURRENT HIGH BIDDER</span>{' '}
              <b>{bid ? `${bid.team_code} @ ${formatInr(bid.amount)}` : 'WAITING FOR OPENING BID'}</b>
            </div>
            <div className="la-ticker-item">
              <span>DPL 2026 LEAGUE PURSE</span> <b>{formatInr(10000000)} CR PER TEAM</b>
            </div>
            <div className="la-ticker-item">
              <span>BROADCAST STREAM</span> <b>DIGITATE PREMIER LEAGUE</b>
            </div>
          </div>
        </footer>
      )}

      {fx && <Celebration fx={fx} teams={state?.teams ?? []} onDone={() => setFx(null)} />}
    </div>
  );
}

