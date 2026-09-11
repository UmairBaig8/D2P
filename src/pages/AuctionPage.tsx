import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTheme } from '@/lib/useTheme';
import SiteHeader from '@/components/SiteHeader';
import { resolveAsset } from '@/lib/base';
import {
  fetchAuctionLiveState,
  fetchAuctionSchedule,
  fetchAuctionSettings,
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
import AuctionWrapUp from '@/components/AuctionWrapUp';
import { Volume2, VolumeX, Radio, Sparkles, Download } from 'lucide-react';

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
  const R = 52;
  const C = 2 * Math.PI * R;
  const standby = remaining == null || total <= 0;
  const frac = standby ? 1 : Math.max(0, Math.min(1, remaining / total));
  const urgent = !standby && remaining <= 10;
  const label = standby
    ? '—'
    : remaining >= 60
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
            {standby ? 'STANDBY' : urgent ? '⌛ FINAL CALL' : 'TIME REMAINING'}
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
  basePrice,
}: {
  teams: AuctionLiveState['teams'];
  bid: AuctionLiveState['current_bid'];
  bidRows: AuctionLiveState['bids'];
  floor: number;
  squadSize: number;
  basePrice: number;
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
        {spreadTeams(teams).map((team) => {
          const left = team.budget - team.spent;
          const isHighest = bid?.team_id === team.team_id;
          const isFull = team.squad >= squadSize;
          const inRange = bid ? left > floor : left >= floor;
          const low = !isHighest && !isFull && team.budget > 0 && left / team.budget < 0.15;
          const squadCount = Math.min(squadSize, Math.max(0, team.squad || 0));
          const maxBid = Math.max(0, left - Math.max(0, squadSize - squadCount) * basePrice);

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
            <div className={`${cls} ${team.theme}`} key={team.team_id} title={team.name} style={{ position: 'relative' }}>
              {isHighest && <BorderBeam colorFrom="#ffd75e" colorTo="#3ddc97" duration={4} size={200} />}

              {/* Franchise Header */}
              <div className="la-tcard-top">
                {team.icon_url ? (
                  <img className="la-tcard-icon" src={resolveAsset(team.icon_url)} alt="" />
                ) : (
                  <span className="la-tcard-icon la-tcard-fb">{initials(team.name)}</span>
                )}
                <div className="la-tcard-id">
                  <b className="la-tcard-name">{team.name}</b>
                </div>
                <span className={`la-tdot ${status.dot}`} />
                <span className="la-tcard-code">{team.code || team.name}</span>
                {status.text && <ShinyBadge variant={status.badgeVar}>{status.text}</ShinyBadge>}
              </div>

              {/* Purse + Max Bid tiles */}
              <div className="la-tcard-metrics">
                <div className="la-tcard-metric la-tcard-metric--purse">
                  <span>{low ? '⚠ PURSE LEFT' : 'PURSE LEFT'}</span>
                  <b>{formatCompact(left)}</b>
                </div>
                <div className="la-tcard-metric la-tcard-metric--maxbid">
                  <span>MAX BID</span>
                  <b>{maxBid > 0 ? formatCompact(maxBid) : '—'}</b>
                </div>
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
  seq: number;
  first: boolean;
};

function ConfettiLayer({ heat, accent }: { heat: number; accent?: string }) {
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

    const colors = ['#09c9d8', '#2f7dff', '#ffd75e', '#ff8a3c', '#ffffff', '#3ddc97'];
    if (accent) colors.push(accent, accent, accent);

    // Continuous confetti cannons from both sides — keeps throwing for the
    // whole hold; particles fall with gravity and are culled off-screen.
    const parts: { x: number; y: number; vx: number; vy: number; s: number; r: number; vr: number; c: string }[] = [];
    let raf = 0;
    let last = performance.now();
    let acc = 0;

    const spawnBurst = () => {
      const count = 6 + Math.floor(Math.random() * 5);
      for (let i = 0; i < count; i++) {
        const fromLeft = Math.random() < 0.5;
        parts.push({
          x: fromLeft ? -10 : w + 10,
          y: h * (0.12 + Math.random() * 0.7),
          vx: (fromLeft ? 1 : -1) * (4 + Math.random() * 10),
          vy: (Math.random() - 0.5) * 9,
          s: 7 + Math.random() * 9,
          r: Math.random() * Math.PI,
          vr: -0.3 + Math.random() * 0.6,
          c: colors[Math.floor(Math.random() * colors.length)],
        });
      }
      // extra top-rain for density
      for (let i = 0; i < 4; i++) {
        parts.push({
          x: Math.random() * w,
          y: -20,
          vx: -1.5 + Math.random() * 3,
          vy: 2 + Math.random() * 4,
          s: 6 + Math.random() * 8,
          r: Math.random() * Math.PI,
          vr: -0.25 + Math.random() * 0.5,
          c: colors[Math.floor(Math.random() * colors.length)],
        });
      }
    };

    const tick = (t: number) => {
      const dt = (t - last) / 1000;
      last = t;
      acc += dt;
      while (acc > 0.05) {
        acc -= 0.05;
        spawnBurst();
      }

      ctx.clearRect(0, 0, w, h);
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.vy += 0.14;
        p.x += p.vx;
        p.y += p.vy;
        p.r += p.vr;
        if (p.y > h + 40 || p.x < -80 || p.x > w + 80) {
          parts.splice(i, 1);
          continue;
        }
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.r);
        ctx.fillStyle = p.c;
        ctx.fillRect(-p.s / 2, -p.s / 3, p.s, p.s * 0.66);
        ctx.restore();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [heat, accent]);
  return <canvas ref={ref} className="fx-confetti" />;
}

const TEAM_ACCENTS: Record<string, string> = {
  kings: '#ffc22e',
  mavale: '#ff6b24',
  mitra: '#35e783',
  blaster: '#ff9d1c',
  dhada: '#28a9ff',
  wala: '#a4ef31',
  titans: '#48aaff',
  yodhas: '#ff7c27',
  gallit: '#d9ff24',
  dhurandhars: '#e9b94d',
};

const TEAM_FAMILIES: Record<string, string> = {
  kings: 'gold',
  dhurandhars: 'gold',
  mavale: 'orange',
  blaster: 'orange',
  yodhas: 'orange',
  dhada: 'blue',
  titans: 'blue',
  wala: 'lime',
  gallit: 'lime',
  mitra: 'green',
};

// Reorders teams so same-colour franchises are never adjacent in the 2-col grid.
function spreadTeams(teams: AuctionLiveState['teams']): AuctionLiveState['teams'] {
  const familyOf = (t: AuctionLiveState['teams'][number]) => TEAM_FAMILIES[t.theme] || t.theme || t.team_id;
  const groups = new Map<string, AuctionLiveState['teams']>();
  const order: string[] = [];
  for (const t of teams) {
    const f = familyOf(t);
    if (!groups.has(f)) {
      groups.set(f, []);
      order.push(f);
    }
    groups.get(f)!.push(t);
  }
  const buckets = order.map((f) => groups.get(f)!).sort((a, b) => b.length - a.length);
  const result: AuctionLiveState['teams'] = [];
  let placed = true;
  while (placed) {
    placed = false;
    for (const bucket of buckets) {
      const t = bucket.shift();
      if (t) {
        result.push(t);
        placed = true;
      }
    }
  }
  return result;
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
  const sold = fx.status === 'sold';
  const team = teams.find((t) => t.code === fx.team_code);
  const themeClass = team?.theme ?? '';
  const accent = TEAM_ACCENTS[team?.theme ?? ''] ?? '#ffd75e';
  const price = fx.sold_price ?? 0;
  const dur = sold ? (fx.first ? 7400 : 6900) : 3000;

  useEffect(() => {
    const t = window.setTimeout(onDone, dur);
    return () => window.clearTimeout(t);
  }, [fx, onDone, dur]);

  if (!sold) {
    return (
      <div className="fx fx-unsold" key={fx.seq} style={{ '--accent': '#ff4b6e' } as React.CSSProperties}>
        <button type="button" className="fx-close" onClick={onDone} aria-label="Close">
          ✕
        </button>
        <div className="fx-tk-soldcard">
          <div className="fx-tk-soldcard-photo">
            <BorderBeam colorFrom="#ff4b6e" colorTo="#ff8fa3" duration={5} size={220} />
            {fx.photo_url ? <img src={fx.photo_url} alt="" /> : <span>{initials(fx.name)}</span>}
            <div className="fx-tk-soldcard-unsold">UNSOLD</div>
          </div>
          <div className="fx-tk-soldcard-name">{fx.name}</div>
          <div className="fx-tk-soldcard-funny">
            <b>NO TAKERS!</b>
            <span>Even the hammer stayed quiet — better luck next lot 🏏</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`fx fx-takeover${fx.first ? '' : ' fx-quick'} ${themeClass}`}
      key={fx.seq}
    >
      <div className="fx-tk-veil" />
      <div className="fx-tk-burst" />

      <div className="fx-tk-sold">SOLD!</div>

      <div className="fx-tk-fly">
        {fx.photo_url ? <img src={fx.photo_url} alt="" /> : <span>{initials(fx.name)}</span>}
      </div>

      <div className="fx-tk-trail" />

      <div className="fx-tk-soldcard">
        <div className="fx-tk-soldcard-photo">
          <BorderBeam colorFrom="var(--accent)" colorTo="#ffffff" duration={5} size={220} />
          {fx.photo_url ? <img src={fx.photo_url} alt="" /> : <span>{initials(fx.name)}</span>}
          <div className="fx-tk-soldcard-team">
            {team?.icon_url ? (
              <img src={resolveAsset(team.icon_url)} alt="" />
            ) : (
              <span>{initials(team?.name ?? fx.team_code ?? '')}</span>
            )}
          </div>
          <div className="fx-tk-soldcard-price">
            SOLD · <NumberTicker value={price} formatter={(v) => formatInr(v)} />
          </div>
        </div>
        <div className="fx-tk-soldcard-name">{fx.name}</div>
        <div className="fx-tk-soldcard-welcome">
          WELCOME TO <b>{team?.name ?? fx.team_code ?? ''}</b>
        </div>
      </div>

      <ConfettiLayer heat={price} accent={accent} />
    </div>
  );
}

function PricePanel({
  player,
  bid,
}: {
  player: AuctionLiveState['current_player'];
  bid: AuctionLiveState['current_bid'];
}) {
  if (!player) {
    return (
      <section className="la-pricep" style={{ position: 'relative' }}>
        <BorderBeam colorFrom="#09c9d8" colorTo="#2f7dff" duration={6} size={240} />
        <div className="la-hero-top">
          <ShinyBadge variant="cyan">🔨 NEXT LOT</ShinyBadge>
          <span className="la-hero-base">
            BASE <b>—</b>
          </span>
        </div>
        <div className="la-hero-num">—</div>
        <div className="la-leader-spotlight la-leader-waiting">
          <span>● AWAITING NEXT LOT</span>
        </div>
      </section>
    );
  }

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

// Funny no-spoiler panel for the stats column while no lot is on stage.
function SurprisePanel() {
  return (
    <section className="pi-panel la-surprise">
      <span className="la-surprise-emoji">🤫</span>
      <div className="la-surprise-copy">
        <span className="la-surprise-eyebrow">TOP SECRET</span>
        <h2>NO PEEKING!</h2>
        <p>The committee is keeping the next star under wraps — even the auctioneer signed an NDA. 🤐</p>
      </div>
    </section>
  );
}

// Static face-down card back shown while the session is live but no lot is on
// stage — stays un-flipped until the committee selects a player. Reuses the
// exact `.la-3d` card frame so size/position match the live player card.
function CardBack() {
  return (
    <div className="la-3d-wrap">
      <article className="la-3d la-3d--back">
        <BorderBeam colorFrom="#09c9d8" colorTo="#ffd75e" duration={6} size={260} />
        <div className="la-3d-face la-3d-back la-3d-back--static la-cardback">
          <div className="la-cardback-top">
            <span className="la-cardback-brand">
              DPL <b>2026</b>
            </span>
            <span className="la-cardback-live">
              <i /> LIVE
            </span>
          </div>

          <div className="la-cardback-center">
            <div className="la-cardback-mark">?</div>
            <div className="la-cardback-title">NEXT LOT</div>
            <div className="la-cardback-sub">THE HAMMER IS READY</div>
          </div>

          <div className="la-cardback-bottom">
            <span className="la-cardback-eyebrow">PLAYER AUCTION</span>
            <div className="la-cardback-dots">
              <i />
              <i />
              <i />
            </div>
            <span className="la-cardback-status">DRAWING SOON</span>
          </div>
        </div>
      </article>
    </div>
  );
}

// Generate rich mock demo live state when offline or demo toggled
function createMockDemoState(): AuctionLiveState {
  const mockTeams = [
    { team_id: 't1', name: 'Royal Strikers', code: 'RST', icon_url: '', theme: 'kings', budget: 10000000, spent: 4200000, squad: 6, sold: 6 },
    { team_id: 't2', name: 'Titan Warriors', code: 'TWR', icon_url: '', theme: 'titans', budget: 10000000, spent: 3800000, squad: 5, sold: 5 },
    { team_id: 't3', name: 'Thunder Kings', code: 'TKG', icon_url: '', theme: 'dhada', budget: 10000000, spent: 5100000, squad: 7, sold: 7 },
    { team_id: 't4', name: 'Cyber Panthers', code: 'CPN', icon_url: '', theme: 'mitra', budget: 10000000, spent: 2900000, squad: 4, sold: 4 },
    { team_id: 't5', name: 'Phoenix Eleven', code: 'PHX', icon_url: '', theme: 'mavale', budget: 10000000, spent: 4600000, squad: 6, sold: 6 },
    { team_id: 't6', name: 'Vanguard Tigers', code: 'VGT', icon_url: '', theme: 'blaster', budget: 10000000, spent: 3100000, squad: 5, sold: 5 },
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
      timer_ends_at: new Date(Date.now() + 20000).toISOString(),
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

const MemoPlayer3DCard = memo(Player3DCard);
const MemoCircularTimer = memo(CircularTimer);
const MemoPlayerStats = memo(PlayerStats);
const MemoTeamsPanel = memo(TeamsPanel);
const MemoPricePanel = memo(PricePanel);

export default function AuctionPage() {
  const { dark, toggleTheme } = useTheme();
  const [state, setState] = useState<AuctionLiveState | null>(null);
  const [scheduledAt, setScheduledAt] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const [soundOn, setSoundOn] = useState(true);
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [activeDrawer, setActiveDrawer] = useState<'bids' | 'activity' | null>(null);
  const [defaultBase, setDefaultBase] = useState(0);
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

  // Default base price (used for max-bid reserve math) is fetched once.
  useEffect(() => {
    let alive = true;
    fetchAuctionSettings().then((settings) => {
      if (alive) setDefaultBase(settings?.default_base ?? 0);
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
  const showWrapUp = !live && session?.status === 'ended' && results.some((r) => r.status === 'sold' && r.source === 'auction');
  const totalLots = results.length + (state?.pool_count ?? 0);
  const progressPct = totalLots > 0 ? Math.round((results.length / totalLots) * 100) : 0;

  // Live ticker content: recently sold players. Falls back to the current lot
  // so the feed never looks empty before the first sale.
  const recentSold = results.filter((row) => row.status === 'sold').slice(-8).reverse();
  const tickerItems: React.ReactNode[] =
    recentSold.length > 0
      ? recentSold.map((row, index) => (
          <React.Fragment key={`sold-${row.lot_order}-${index}`}>
            {row.photo_url ? (
              <img className="la-ticker-avatar" src={row.photo_url} alt={row.player_name} />
            ) : (
              <i className="la-ticker-avatar la-ticker-avatar-fallback">{initials(row.player_name)}</i>
            )}
            <span>{row.source === 'retained' ? 'RETAINED' : 'SOLD'}</span>
            <b>{row.player_name.toUpperCase()}</b>
            <span>
              {row.team_code ? `→ ${row.team_code}` : '→ UNSOLD'} · {formatCompact(row.sold_price ?? 0)}
            </span>
          </React.Fragment>
        ))
      : [
          <React.Fragment key="cur-lot">
            <span>LOT #{player?.lot_order ?? '—'}</span>
            <b>{player ? player.name.toUpperCase() : 'DRAWING IN PROGRESS'}</b>
            {player && <span>{player.player_type} · BASE {formatCompact(player.base_price)}</span>}
          </React.Fragment>,
          <React.Fragment key="cur-bid">
            <span>CURRENT HIGH BIDDER</span>
            <b>{bid ? `${bid.team_code} @ ${formatInr(bid.amount)}` : 'WAITING FOR OPENING BID'}</b>
          </React.Fragment>,
        ];

  // Demo auto-sell: when the lot timer expires, close the lot to the current
  // highest bidder and bring up the next player so the SOLD reveal fires.
  useEffect(() => {
    if (!isDemoMode || !state?.current_player) return;
    if (remaining !== 0) return;

    setState((prev) => {
      if (!prev || !prev.current_player) return prev;
      const p = prev.current_player;
      const winner = prev.current_bid;
      const winnerTeam = winner
        ? prev.teams.find((t) => t.team_id === winner.team_id) ?? prev.teams[0]
        : prev.teams[0];
      const price = winner?.amount ?? p.base_price;

      const result: AuctionResultRow = {
        player_name: p.name,
        photo_url: p.photo_url,
        player_type: p.player_type,
        team_code: winnerTeam?.code ?? null,
        sold_price: price,
        status: 'sold',
        source: 'auction',
        lot_order: p.lot_order,
      };

      const next = prev.next_up?.[0];
      const nextPlayer: AuctionLiveState['current_player'] = next
        ? {
            player_id: next.player_id,
            name: next.name,
            employee_id: `EMP-${100 + next.lot_order}`,
            photo_url: next.photo_url,
            player_type: next.player_type,
            gender: 'Male',
            location: 'DPL Arena',
            dpl_played: true,
            self_rating: 4,
            availability: 'Available for full tournament',
            batting_style: 'Right-Handed Batter',
            bowling_style: 'Right-Arm Fast Medium',
            lot_order: next.lot_order,
            base_price: next.base_price,
            timer_ends_at: new Date(Date.now() + 20000).toISOString(),
          }
        : null;

      return {
        ...prev,
        current_player: nextPlayer,
        current_bid: null,
        bids: [],
        bid_count: (prev.bid_count ?? 0) + 1,
        pool_count: Math.max(0, (prev.pool_count ?? 0) - 1),
        next_up: prev.next_up.slice(1),
        results: [...(prev.results ?? []), result],
      };
    });
  }, [isDemoMode, remaining, state?.current_player]);

  const [fx, setFx] = useState<FxEvent | null>(null);
  const prevResLen = useRef<number | null>(null);
  const fxSeq = useRef(0);
  const soldCount = useRef(0);
  const handleFxDone = useCallback(() => setFx(null), []);

  useEffect(() => {
    const res = state?.results ?? [];
    if (state && live) {
      const prev = prevResLen.current;
      prevResLen.current = res.length;
      if (prev != null && res.length > prev) {
        const last = res[res.length - 1];
        if (last.source !== 'retained' && (last.status === 'sold' || last.status === 'unsold')) {
          const isSold = last.status === 'sold';
          const first = isSold ? soldCount.current === 0 : false;
          if (isSold) soldCount.current += 1;
          setFx({
            name: last.player_name,
            photo_url: last.photo_url,
            status: last.status,
            team_code: last.team_code,
            sold_price: last.sold_price,
            seq: ++fxSeq.current,
            first,
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
      className={`app auction-page live-auction${dark ? ' dark' : ''}${showWrapUp ? ' is-wrapped' : ''}`}
      style={{ position: 'relative' }}
      data-reduced={FX_ENABLED ? undefined : ''}
    >
      {FX_ENABLED && <RetroGrid angle={60} />}
      {FX_ENABLED && <Particles quantity={45} color="#09c9d8" />}

      <SiteHeader dark={dark} onToggleTheme={toggleTheme} relative={!live} />
      <main className={`la-main${showWrapUp ? ' la-main--wrap' : ' shell'}`} style={{ position: 'relative', zIndex: 10 }}>
        {!state ? (
          <div className="la-stage-empty">
            <div className="la-stage-empty-badge">⌛</div>
            <h2>LOADING LIVE BROADCAST AUCTION…</h2>
            {!online && <p>Connecting to broadcast feed — retrying…</p>}
          </div>
        ) : !live ? (
          showWrapUp ? (
            <AuctionWrapUp results={results} teams={state.teams} />
          ) : (
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
          )
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

                <a
                  className="la-ctrl-btn"
                  href={resolveAsset('/DPL-2026-Team-Squads.pdf')}
                  download="DPL-2026-Team-Squads.pdf"
                  title="Download team-wise squad PDF"
                >
                  <Download size={14} />
                  <span>SQUAD PDF</span>
                </a>
              </div>
            </div>

            {/* Main Stage Grid */}
            <div className="la-stage" style={{ flex: 1, minHeight: 0 }}>
              <div className="la-live" style={{ height: '100%' }}>
                <div className="lg lg-stats">
                  {player ? <MemoPlayerStats player={player} /> : <SurprisePanel />}
                </div>
                <div className="lg lg-card">
                  {player ? <MemoPlayer3DCard key={player.player_id} player={player} /> : <CardBack />}
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
                    floor={bid?.amount ?? player?.base_price ?? 0}
                    squadSize={state?.squad_size ?? 11}
                    basePrice={defaultBase}
                  />
                </div>
              </div>
            </div>
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
      {live && (
        <footer className="la-ticker-wrap">
          <div className="la-ticker-tag">
            <Radio size={12} style={{ display: 'inline', marginRight: 4 }} /> LIVE FEED
          </div>
          <div className="la-ticker-track">
            {tickerItems.length === 0 ? (
              <div className="la-ticker-item">
                <span>NO SALES YET</span> <b>AWAITING FIRST LOT</b>
              </div>
            ) : (
              [...tickerItems, ...tickerItems].map((node, index) => (
                <div className="la-ticker-item" key={`ticker-${index}`}>
                  {node}
                </div>
              ))
            )}
          </div>
        </footer>
      )}

      {fx && <Celebration fx={fx} teams={state?.teams ?? []} onDone={handleFxDone} />}
    </div>
  );
}

