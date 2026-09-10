import { useEffect, useState } from 'react';
import { hasSupabaseConfig } from '@/env';
import { fetchRecentPlayers, fetchRegistrationsCount, fetchSiteSettings } from '@/lib/site';
import type { RecentPlayer } from '@/lib/site';
import { useTheme } from '@/lib/useTheme';
import { withBase } from '@/lib/base';
import ElectricBorder from '@/components/ElectricBorder';
import Magnet from '@/components/Magnet';
import SiteHeader from '@/components/SiteHeader';
const FALLBACK_SECONDS = 15 * 86400 + 8 * 3600 + 42 * 60 + 33;

function useCountUp(target: number, duration = 1100, delay = 0) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    let raf = 0;
    const start = performance.now() + delay;
    const tick = (t: number) => {
      const p = Math.min(1, Math.max(0, (t - start) / duration));
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(Math.round(target * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration, delay]);
  return value;
}

function TapeStat({ value, raw, label, gold }: { value: number; raw?: string; label: string; gold?: boolean }) {
  const n = useCountUp(value, 1400);
  return (
    <span className={gold ? 'tape-item tape-gold' : 'tape-item'}>
      <b>{raw !== undefined ? raw : String(n)}</b>{label}<i>✦</i>
    </span>
  );
}

export default function App() {
  const { dark, toggleTheme } = useTheme();
  const [deadlineAt, setDeadlineAt] = useState<number | null>(null);
  const [fallbackSeconds, setFallbackSeconds] = useState(FALLBACK_SECONDS);
  const [now, setNow] = useState(() => Date.now());

  const [playerCount, setPlayerCount] = useState(87);
  const [capacity, setCapacity] = useState(128);
  const [totalTeams, setTotalTeams] = useState(16);
  const [totalMatches, setTotalMatches] = useState(24);
  const [championLabel, setChampionLabel] = useState('1');
  const [recentPlayers, setRecentPlayers] = useState<RecentPlayer[]>([]);

  useEffect(() => {
    let mounted = true;
    Promise.all([fetchSiteSettings(), fetchRegistrationsCount(), fetchRecentPlayers(5)]).then(([settings, count, players]) => {
      if (!mounted) return;
      if (settings) {
        if (settings.registration_deadline) setDeadlineAt(new Date(settings.registration_deadline).getTime());
        setCapacity(settings.player_capacity);
        setTotalTeams(settings.total_teams);
        setTotalMatches(settings.total_matches);
        if (settings.champion) setChampionLabel(settings.champion);
      }
      if (typeof count === 'number') setPlayerCount(count);
      if (players.length) setRecentPlayers(players);
    });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
      setFallbackSeconds((value) => Math.max(0, value - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const secondsLeft = deadlineAt !== null ? Math.max(0, Math.floor((deadlineAt - now) / 1000)) : fallbackSeconds;
  const spotsLeft = Math.max(0, capacity - playerCount);
  const meterWidth = capacity > 0 ? Math.min(100, Math.round((playerCount / capacity) * 100)) : 0;
  const days = Math.floor(secondsLeft / 86400);
  const hours = Math.floor((secondsLeft % 86400) / 3600);
  const mins = Math.floor((secondsLeft % 3600) / 60);
  const secs = secondsLeft % 60;
  const time = (value: number) => String(value).padStart(2, '0');
  const championNum = Number(championLabel);
  const championRaw = Number.isNaN(championNum) ? championLabel : undefined;
  const tapeItems = [
    { value: totalTeams, label: 'TEAMS' },
    { value: capacity, label: 'PLAYERS' },
    { value: totalMatches, label: 'MATCHES' },
    { value: Number.isNaN(championNum) ? 0 : championNum, raw: championRaw, label: 'CHAMPION', gold: true },
  ];
  const tapeTrack = (key: string) => (
    <div className="stat-tape-track" key={key}>
      {tapeItems.map((item, idx) => <TapeStat key={idx} value={item.value} raw={item.raw} label={item.label} gold={item.gold} />)}
    </div>
  );

  return (
    <div className={dark ? 'app dark home-page' : 'app home-page'}>
      <SiteHeader dark={dark} onToggleTheme={toggleTheme} />

      <main id="top">
        <section className="hero" id="tournament">
          <div className="hero-art" aria-hidden="true" />
          <div className="hero-content">
            <div className="kicker"><span className="kicker-live"><i /><b>LIVE</b></span> DPL 2026 · REGISTRATION OPEN</div>
            <div className="social-proof"><div className="avatars">{(recentPlayers.length ? recentPlayers : []).map((player) => player.photo_url ? <img alt={player.name} className="avatar" key={player.id} src={player.photo_url} /> : <i className="avatar" key={player.id} />)}{!recentPlayers.length ? [1, 2, 3, 4, 5].map((avatar) => <i className="avatar" key={avatar} />) : null}</div><strong>{playerCount}+</strong> players already joined</div>
            <h1>DESK TO<br /><span>PITCH.</span></h1>
            <div className="hero-sub">DIGITATE PREMIER LEAGUE · THE OFFICE CRICKET LEAGUE</div>
            <div className="hero-copy">Same office. Different game.<br />This time, let&apos;s <strong>play for keeps.</strong></div>
            <div className="stat-tape"><div className="stat-tape-rail">{tapeTrack('a')}{tapeTrack('b')}</div></div>
          </div>
          {/* <ElectricBorder className="hero-flame" color="#00E5FF" speed={2.2} chaos={0.34} borderRadius={20}><aside className="hero-panel"><div className="panel-label">DPL 2026 / REGISTRATION WINDOW</div><div className="panel-title">Your spot is waiting.</div><div className="countdown"><div className="time"><b>{time(days)}</b><span>DAYS</span></div><div className="time"><b>{time(hours)}</b><span>HRS</span></div><div className="time"><b>{time(mins)}</b><span>MINS</span></div><div className="time"><b>{time(secs)}</b><span>SECS</span></div></div><div className="capacity"><div className="capacity-head"><span>PLAYERS REGISTERED</span><strong><span>{playerCount}</span> / {capacity}</strong></div><div className="meter"><i style={{ width: `${meterWidth}%` }} /></div><div className="spots">Only <strong>{spotsLeft} spots</strong> left. Don&apos;t sit this one out.</div></div><Magnet magnetStrength={3} padding={90}><a className="btn btn-primary panel-cta" href={withBase("/register")}>YES, COUNT ME IN →</a></Magnet></aside></ElectricBorder> */}
        </section>

        <div className="home-quote">
          <div className="home-quote-text">Don&apos;t just work. <span>Play together.</span></div>
          {/* <a className="home-quote-cta" href={withBase("/register")}>🏏 YES, COUNT ME IN →</a> */}
          <div className="home-quote-credit">D2P · DPL 2026 · DIGITATE PREMIER LEAGUE · {hasSupabaseConfig ? 'CONNECTED' : 'DEMO MODE'}</div>
        </div>
      </main>
    </div>
  );
}