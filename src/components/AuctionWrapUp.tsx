import { useMemo, type ReactNode } from 'react';
import { Download } from 'lucide-react';
import { NumberTicker } from '@/components/ui/NumberTicker';
import ShinyBadge from '@/components/ui/ShinyBadge';
import { Particles } from '@/components/ui/Particles';
import { resolveAsset } from '@/lib/base';
import { formatCompact, type AuctionResultRow, type AuctionTeamView } from '@/lib/auction';

function initials(name: string): string {
  return name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
}

const TEAM_ACCENT: Record<string, string> = {
  DSK: '#f5b301', SM: '#ff7b1a', DMM: '#2867ff', BB: '#e5484d', DD: '#873cff',
  CW: '#16c79a', DT: '#09c9d8', DY: '#ed3aa8', GM: '#8bd450', DDH: '#ffb03a',
};

// Theme -> logo file. Only 'kings' deviates from its slug (file is dsk.png).
const THEME_LOGO: Record<string, string> = {
  kings: '/D2P/teams/dsk.png',
  mavale: '/D2P/teams/mavale.png',
  mitra: '/D2P/teams/mitra.png',
  blaster: '/D2P/teams/blaster.png',
  dhada: '/D2P/teams/dhada.png',
  wala: '/D2P/teams/wala.png',
  titans: '/D2P/teams/titans.png',
  yodhas: '/D2P/teams/yodhas.png',
  gallit: '/D2P/teams/gallit.png',
  dhurandhars: '/D2P/teams/dhurandhars.png',
};

// Resolve a team's crest: prefer the stored icon_url, fall back to the
// theme-keyed logo so cards never render a blank crest.
function teamLogo(team?: Pick<AuctionTeamView, 'icon_url' | 'theme'> | null): string {
  if (!team) return '';
  const raw = (team.icon_url || '').trim() || THEME_LOGO[team.theme] || '';
  return raw ? resolveAsset(raw) : '';
}

const QUIPS = [
  'The gavel has spoken. The purses are lighter, the WhatsApp groups are quieter, and one spreadsheet needs therapy.',
  'Some players went for a fortune, some for a chai. All of them are now someone’s problem on match day.',
  'Highest bid of the night: your enthusiasm. Lowest bid: your ability to stick to a budget.',
  'To everyone who was outbid: you were this close. To everyone who won: see you at practice.',
  'Game on. But first, ice packs for the hamstrings and the bank accounts.',
];

export default function AuctionWrapUp({ results, teams }: { results: AuctionResultRow[]; teams: AuctionTeamView[] }) {
  const d = useMemo(() => {
    const sold = results.filter((r) => r.status === 'sold' && r.source === 'auction' && (r.sold_price ?? 0) > 0);
    const top = [...sold].sort((a, b) => (b.sold_price ?? 0) - (a.sold_price ?? 0)).slice(0, 8);
    const prices = sold.map((r) => r.sold_price ?? 0);
    const maxPrice = Math.max(0, ...prices);
    const minPrice = Math.min(...prices);
    const totalSpent = teams.reduce((s, t) => s + (t.spent ?? 0), 0);
    const maxSpent = Math.max(0, ...teams.map((t) => t.spent ?? 0));
    const deepest = teams.filter((t) => (t.spent ?? 0) === maxSpent && maxSpent > 0);
    const avg = sold.length ? Math.round(totalSpent / sold.length) : 0;
    const ranked = [...teams].sort((a, b) => (b.spent ?? 0) - (a.spent ?? 0));
    const frugal = [...teams].sort((a, b) => (b.budget - b.spent) - (a.budget - a.spent))[0];
    const fullHouse = teams.filter((t) => t.squad > 15);
    const bargainCount = (code: string) => sold.filter((r) => r.team_code === code && (r.sold_price ?? 0) === minPrice).length;
    const bargainTeam = [...teams].sort((a, b) => bargainCount(b.code) - bargainCount(a.code))[0];
    const topBuy = top[0];
    return { sold, top, maxPrice, minPrice, totalSpent, maxSpent, deepest, avg, ranked, frugal, fullHouse, bargainTeam, bargainCount, topBuy };
  }, [results, teams]);

  const teamByCode = useMemo(() => {
    const map = new Map<string, AuctionTeamView>();
    for (const t of teams) map.set(t.code, t);
    return map;
  }, [teams]);

  const quip = QUIPS[new Date().getDate() % QUIPS.length];

  return (
    <div className="la-wrap flex w-full flex-1 flex-col gap-3 sm:gap-4">
      {/* HERO */}
      <section
        className="relative overflow-hidden rounded-3xl border border-[var(--wrap-line)] px-5 py-6 sm:px-8 sm:py-7"
        style={{ background: 'var(--wrap-hero-bg)' }}
      >
        <Particles className="pointer-events-none absolute inset-0 opacity-70" quantity={55} color="#ffd75e" />
        <div className="relative flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[3px] text-cyan-700 dark:text-cyan-300">DPL 2026 · Auction Closed</p>
            <h1 className="mt-1 text-5xl font-black italic leading-[0.88] tracking-tight sm:text-6xl">
              THAT’S A{' '}
              <span className="bg-gradient-to-r from-[#09c9d8] via-[#873cff] to-[#ed3aa8] bg-clip-text text-transparent">WRAP!</span>
            </h1>
            <p className="mt-2 max-w-xl text-xs leading-snug text-[var(--wrap-ink-soft)] sm:text-sm">{quip}</p>
          </div>
          <div className="flex flex-col items-start gap-2 sm:items-end">
            <ShinyBadge variant="gold">🏆 GAME ON!</ShinyBadge>
            <span className="text-[10px] font-black uppercase tracking-[2px] text-[var(--wrap-ink-faint)]">
              {d.sold.length} sold · {formatCompact(d.totalSpent)} spent
            </span>
            <a
              className="la-wrap-dl"
              href={resolveAsset('/DPL-2026-Team-Squads.pdf')}
              download="DPL-2026-Team-Squads.pdf"
            >
              <Download size={13} /> Squad PDF
            </a>
          </div>
        </div>
      </section>

      {/* STAT TILES */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Total spent" value={d.totalSpent} prefix="₹" accent="#ffb03a" />
        <StatTile label="Players bought" value={d.sold.length} accent="#09c9d8" />
        <StatTile label="Biggest splash" value={d.maxPrice} prefix="₹" accent="#ed3aa8" />
        <StatTile label="Average price" value={d.avg} prefix="₹" accent="#873cff" />
      </div>

      {/* BENTO: buys + leaderboard */}
      <div className="grid gap-3 lg:grid-cols-[1.05fr_1fr]">
        <Tile title="💰 Most expensive buys" hint="the wallet-melters">
          <ol className="la-wtable">
            {d.top.map((r, i) => {
              const team = teamByCode.get(r.team_code ?? '');
              const logo = teamLogo(team);
              const accent = TEAM_ACCENT[r.team_code ?? ''] ?? '#ffd75e';
              const pct = d.maxPrice ? Math.round(((r.sold_price ?? 0) / d.maxPrice) * 100) : 0;
              return (
                <li key={`${r.player_name}-${i}`} className="la-wrow la-wrow--buy">
                  <span className="la-wrank" style={{ background: `linear-gradient(135deg, ${accent}, #ffffffaa)` }}>{i + 1}</span>
                  <span className="la-wav">
                    {r.photo_url ? <img src={r.photo_url} alt={r.player_name} /> : initials(r.player_name)}
                    {logo && <img src={logo} alt="" className="la-wteamlogo" />}
                  </span>
                  <span className="la-wname">
                    <b>{r.player_name}</b>
                    <span style={{ color: accent }}>{r.team_code}{team ? ` · ${team.name}` : ''}</span>
                  </span>
                  <span className="la-wbar">
                    <i style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${accent}, #ffffffaa)` }} />
                  </span>
                  <span className="la-wval">₹{formatCompact(r.sold_price ?? 0)}</span>
                </li>
              );
            })}
          </ol>
        </Tile>

        <Tile title="🤑 Who spent it all" hint="purses were harmed">
          <ol className="la-wtable">
            {d.ranked.map((t, i) => {
              const logo = teamLogo(t);
              const accent = TEAM_ACCENT[t.code] ?? '#ffd75e';
              const pct = d.maxSpent ? Math.round(((t.spent ?? 0) / d.maxSpent) * 100) : 0;
              const left = (t.budget ?? 0) - (t.spent ?? 0);
              return (
                <li key={t.team_id} className="la-wrow la-wrow--team">
                  <span className="la-wrank" style={{ background: `linear-gradient(135deg, ${accent}, #ffffffaa)` }}>{i + 1}</span>
                  <span className="la-wlogo">
                    {logo ? <img src={logo} alt="" /> : <span>{t.code}</span>}
                  </span>
                  <span className="la-wname">
                    <b>{t.name}</b>
                    <span>{t.code} · ₹{formatCompact(left)} LEFT</span>
                  </span>
                  <span className="la-wbar">
                    <i style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${accent}, #ffffffaa)` }} />
                  </span>
                  <span className="la-wval">₹{formatCompact(t.spent ?? 0)}</span>
                </li>
              );
            })}
          </ol>
        </Tile>
      </div>

      {/* BENTO: awards + thanks */}
      <div className="grid gap-3 lg:grid-cols-[1.05fr_1fr]">
        <Tile title="🏅 The Auction Awards" hint="totally official">
          <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
            <Award emoji="💸" title="Deepest Pockets" value={d.deepest.map((t) => t.code).join(' & ') || '—'} note="biggest spenders" />
            <Award emoji="🚀" title="Biggest Splash" value={d.topBuy ? `${d.topBuy.player_name} · ₹${formatCompact(d.topBuy.sold_price ?? 0)}` : '—'} note="single-buy record" />
            <Award emoji="🛒" title="Bargain Bin Boss" value={`${d.bargainTeam.code} (${d.bargainCount(d.bargainTeam.code)}× ₹${d.minPrice})`} note="base-price hoarder" />
            <Award emoji="🧊" title="Frugal Flex" value={`${d.frugal.code} · ₹${formatCompact(d.frugal.budget - d.frugal.spent)} left`} note="most money unspent" />
            <Award emoji="👑" title="Full House" value={d.fullHouse.length ? d.fullHouse.map((t) => t.code).join(', ') : '—'} note="16 on the sheet" />
            <Award emoji="🎲" title="Chai Budget Heroes" value={`${d.sold.filter((r) => (r.sold_price ?? 0) === d.minPrice).length} players @ ₹${d.minPrice}`} note="the ₹20 club" />
          </div>
        </Tile>

        <Tile title="💛 Thank you" hint="for real though">
          <p className="mt-2 text-sm leading-relaxed text-[var(--wrap-ink-soft)]">
            To every player who threw their name in, every owner and captain who bet big (and bigger), every volunteer who
            kept the chaos on schedule, and every spreadsheet-wrangler who aged ten years tonight — <b className="text-[var(--wrap-ink)]">thank you</b>.
            DPL 2026 would be nothing without you. 🫶
          </p>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-500/30 bg-amber-400/15 px-3 py-2 dark:border-amber-300/30 dark:bg-amber-300/10">
            <span className="text-[11px] font-black uppercase tracking-[2px] text-amber-700 dark:text-amber-200">See you on the pitch</span>
            <span className="text-xl font-black italic tracking-wide" style={{ fontFamily: "'Barlow Condensed',sans-serif" }}>🏏 GAME ON! 🏆</span>
          </div>
        </Tile>
      </div>
    </div>
  );
}

function Tile({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-[var(--wrap-line)] bg-[var(--wrap-card)] p-3.5 backdrop-blur-md sm:p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-black uppercase tracking-widest text-[var(--wrap-ink)]">{title}</h2>
        {hint && <span className="text-[9px] font-bold uppercase tracking-[2px] text-[var(--wrap-ink-faint)]">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

function StatTile({ label, value, prefix, accent }: { label: string; value: number; prefix?: string; accent: string }) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-[var(--wrap-line)] bg-[var(--wrap-card)] px-3 py-2.5 backdrop-blur-md">
      <span className="absolute inset-x-0 top-0 h-0.5" style={{ background: `linear-gradient(90deg, transparent, ${accent}, transparent)` }} />
      <p className="text-[9px] font-black uppercase tracking-[2px] text-[var(--wrap-ink-faint)]">{label}</p>
      <p className="mt-0.5 text-2xl font-black italic sm:text-3xl" style={{ fontFamily: "'Barlow Condensed',sans-serif", color: accent }}>
        {prefix}<NumberTicker value={value} />
      </p>
    </div>
  );
}

function Award({ emoji, title, value, note }: { emoji: string; title: string; value: string; note: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-[var(--wrap-line)] bg-[var(--wrap-chip)] px-2.5 py-2">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[var(--wrap-chip)] text-base">{emoji}</span>
      <span className="min-w-0">
        <span className="block text-[9px] font-black uppercase tracking-[1.5px] text-[var(--wrap-ink-faint)]">{title} · {note}</span>
        <span className="block truncate text-xs font-black uppercase tracking-wide text-[var(--wrap-ink)]">{value}</span>
      </span>
    </div>
  );
}
