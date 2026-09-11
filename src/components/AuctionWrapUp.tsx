import { useMemo } from 'react';
import { formatCompact, formatInr, type AuctionResultRow, type AuctionTeamView } from '@/lib/auction';

function initials(name: string): string {
  return name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();
}

const QUIPS = [
  'The gavel has spoken. The purses are lighter, the WhatsApp groups are quieter, and one spreadsheet needs therapy.',
  'Some players went for a fortune. Some went for a chai. All of them are now someone’s problem on match day.',
  'Highest bid of the night: your enthusiasm. Lowest bid: your ability to stick to a budget.',
  'To everyone who was outbid: you were this close. To everyone who won: see you at practice.',
  'Game on. But first, ice packs for the hamstrings and the bank accounts.',
];

export default function AuctionWrapUp({ results, teams }: { results: AuctionResultRow[]; teams: AuctionTeamView[] }) {
  const data = useMemo(() => {
    const sold = results.filter((r) => r.status === 'sold' && r.source === 'auction' && (r.sold_price ?? 0) > 0);
    const top = [...sold].sort((a, b) => (b.sold_price ?? 0) - (a.sold_price ?? 0)).slice(0, 5);
    const maxPrice = top[0]?.sold_price ?? 0;
    const totalSpent = teams.reduce((s, t) => s + (t.spent ?? 0), 0);
    const maxSpent = Math.max(0, ...teams.map((t) => t.spent ?? 0));
    const bigSpenders = teams.filter((t) => (t.spent ?? 0) === maxSpent && maxSpent > 0);
    const avg = sold.length ? Math.round(totalSpent / sold.length) : 0;
    const ranked = [...teams].sort((a, b) => (b.spent ?? 0) - (a.spent ?? 0));
    return { sold, top, maxPrice, totalSpent, maxSpent, bigSpenders, avg, ranked };
  }, [results, teams]);

  const quip = QUIPS[new Date().getDate() % QUIPS.length];

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6">
      <div
        className="relative overflow-hidden rounded-3xl border border-white/15 p-6 sm:p-10 text-white shadow-2xl"
        style={{ background: 'linear-gradient(150deg,#1a1030 0%,#3a1b5e 40%,#7a2a6b 72%,#b13a4a 100%)' }}
      >
        <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full" style={{ background: 'radial-gradient(circle,rgba(255,180,80,.35),transparent 65%)' }} />
        <div className="pointer-events-none absolute -left-20 bottom-0 h-56 w-56 rounded-full" style={{ background: 'radial-gradient(circle,rgba(80,200,255,.28),transparent 65%)' }} />

        <div className="relative">
          <p className="text-[11px] font-black uppercase tracking-[3px] text-amber-300">DPL 2026 · Auction Closed</p>
          <h1 className="mt-2 text-5xl font-black italic leading-none tracking-tight sm:text-7xl" style={{ fontFamily: "'Barlow Condensed',sans-serif" }}>
            THAT’S A WRAP!
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-white/80">{quip}</p>

          <div className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Total spent" value={formatCompact(data.totalSpent)} tone="amber" />
            <Stat label="Players bought" value={String(data.sold.length)} tone="cyan" />
            <Stat label="Top buy" value={formatCompact(data.maxPrice)} tone="pink" />
            <Stat label="Avg price" value={formatCompact(data.avg)} tone="violet" />
          </div>

          <div className="mt-8 grid gap-6 lg:grid-cols-2">
            <section>
              <h2 className="text-lg font-black uppercase tracking-widest text-white/70">💰 Most expensive buys</h2>
              <ol className="mt-3 space-y-2">
                {data.top.map((r, i) => (
                  <li key={`${r.player_name}-${i}`} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-3 py-2.5">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-amber-300 to-orange-500 text-sm font-black text-black">{i + 1}</span>
                    <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full bg-white/10 text-xs font-black">
                      {r.photo_url ? <img src={r.photo_url} alt={r.player_name} className="h-full w-full object-cover" /> : initials(r.player_name)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-black uppercase tracking-wide">{r.player_name}</span>
                      <span className="block text-[11px] font-bold uppercase tracking-wider text-white/60">{r.team_code ?? '—'}</span>
                    </span>
                    <span className="shrink-0 font-black text-amber-300">{formatInr(r.sold_price ?? 0)}</span>
                  </li>
                ))}
              </ol>
            </section>

            <section>
              <h2 className="text-lg font-black uppercase tracking-widest text-white/70">🤑 Who spent it all</h2>
              <ul className="mt-3 space-y-2">
                {data.ranked.map((t) => (
                  <li key={t.team_id} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                    <div className="flex items-center justify-between text-xs font-black uppercase tracking-wider">
                      <span className="truncate">{t.name} <span className="text-white/50">({t.code})</span></span>
                      <span className="text-amber-300">{formatCompact(t.spent ?? 0)}</span>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/10">
                      <span className="block h-full rounded-full bg-gradient-to-r from-cyan-400 via-fuchsia-400 to-amber-300" style={{ width: `${data.maxSpent ? Math.round(((t.spent ?? 0) / data.maxSpent) * 100) : 0}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          </div>

          <div className="mt-8 rounded-2xl border border-amber-300/30 bg-amber-300/10 p-4 sm:p-5">
            <p className="text-sm font-bold leading-relaxed">
              🏏 <span className="font-black uppercase tracking-wider">Biggest spenders:</span>{' '}
              {data.bigSpenders.length ? data.bigSpenders.map((t) => `${t.name} (${t.code})`).join(', ') : '—'}{' '}
              — the accountants are still crying. Thanks to every player, owner, captain, volunteer and spreadsheet-wrangler who made DPL 2026 happen. You absolute legends. 💛
            </p>
          </div>

          <p className="mt-6 text-center text-2xl font-black italic tracking-wide text-white/90" style={{ fontFamily: "'Barlow Condensed',sans-serif" }}>
            🏆 GAME ON! 🏏
          </p>
          <p className="mt-1 text-center text-[11px] font-bold uppercase tracking-[2px] text-white/50">
            See you on the pitch — bring your bat and your budget.
          </p>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: 'amber' | 'cyan' | 'pink' | 'violet' }) {
  const toneClass = {
    amber: 'from-amber-300 to-orange-500',
    cyan: 'from-cyan-300 to-sky-500',
    pink: 'from-pink-400 to-rose-500',
    violet: 'from-violet-400 to-fuchsia-500',
  }[tone];
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
      <p className="text-[9px] font-black uppercase tracking-[2px] text-white/55">{label}</p>
      <p className={`mt-1 bg-gradient-to-r ${toneClass} bg-clip-text text-2xl font-black italic text-transparent sm:text-3xl`} style={{ fontFamily: "'Barlow Condensed',sans-serif" }}>
        {value}
      </p>
    </div>
  );
}
