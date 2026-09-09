import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import SiteHeader from '@/components/SiteHeader';
import { useTheme } from '@/lib/useTheme';
import { fetchTeamRoster, fetchTeamsList, type TeamRosterPlayer, type TeamRow } from '@/lib/site';
import { fetchAuctionLiveState, formatCompact, type AuctionLiveState } from '@/lib/auction';
import { resolveAsset } from '@/lib/base';

const SQUAD_SIZE = 15;
const TEAM_HEADERS: Record<string, string> = {
  DSK: '/team-headers/digi-super-kings.png', SM: '/team-headers/sahyadriche-mavale.png', DMM: '/team-headers/digi-mitra-mandal.png',
  BB: '/team-headers/bhakarwadi-blasters.png', DD: '/team-headers/digi-dhadakebaaz.png', CW: '/team-headers/cricket-wala.png',
  DT: '/team-headers/digi-titans.png', DY: '/team-headers/digi-yodhas.png', GM: '/team-headers/gallit-maramari.png', DDH: '/team-headers/digi-dhurandhars.png',
};

function initials(name: string): string { return name.trim().split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase() || '?'; }
function roleLabel(role: string): string { return role === 'owner' ? 'OWNER' : role === 'co_owner' ? 'CO-OWNER' : role === 'captain' ? 'CAPTAIN' : role === 'vice_captain' ? 'VICE CAPTAIN' : 'PLAYER'; }
function playerKey(name: string): string { return name.trim().toLocaleLowerCase().replace(/\s+/g, ' '); }

export default function TeamPage() {
  const { dark, toggleTheme } = useTheme();
  const { code = '' } = useParams();
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [team, setTeam] = useState<TeamRow | null>(null);
  const [players, setPlayers] = useState<TeamRosterPlayer[]>([]);
  const [auction, setAuction] = useState<AuctionLiveState | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all([fetchTeamsList(), fetchAuctionLiveState()]).then(async ([rows, live]) => {
      const found = rows.find((item) => item.code.toLowerCase() === code.toLowerCase()) ?? null;
      if (!alive) return;
      setTeams(rows); setTeam(found); setAuction(live);
      if (found) setPlayers(await fetchTeamRoster(found.code));
      if (alive) setLoaded(true);
    });
    return () => { alive = false; };
  }, [code]);

  const index = team ? teams.findIndex((item) => item.code === team.code) : -1;
  const auctionTeam = team ? auction?.teams.find((entry) => entry.team_id === team.id || entry.code === team.code) : null;
  const budget = auctionTeam?.budget ?? auction?.session?.purse_budget ?? 0;
  const spent = auctionTeam?.spent ?? 0;
  const results = team ? auction?.results.filter((result) => result.status === 'sold' && result.team_code === team.code) ?? [] : [];
  const resultByPlayer = useMemo(() => new Map(results.map((result) => [playerKey(result.player_name), result])), [results]);
  const averageBuy = results.length ? results.reduce((total, result) => total + (result.sold_price ?? 0), 0) / results.length : 0;
  const highestBuy = results.reduce((high, result) => Math.max(high, result.sold_price ?? 0), 0);
  const mix = useMemo(() => players.reduce<Record<string, number>>((counts, player) => { const type = player.player_type || 'Player'; counts[type] = (counts[type] ?? 0) + 1; return counts; }, {}), [players]);
  const mixLabel = Object.entries(mix).map(([type, count]) => `${count} ${type.replace('Wicketkeeper-batter', 'WK')}`).join(' · ');
  const leaders = players.filter((player) => ['owner', 'co_owner', 'captain'].includes(player.role));
  const mixEntries = Object.entries(mix);
  const maxMixCount = Math.max(1, ...mixEntries.map(([, count]) => count));
  const pursePercent = budget ? Math.min(100, (spent / budget) * 100) : 0;
  const ratingBuckets = [1, 2, 3, 4, 5].map((rating) => players.filter((player) => player.self_rating === rating).length);
  const maxRatingCount = Math.max(1, ...ratingBuckets);
  const ratedPlayers = players.filter((player) => player.self_rating != null);
  const averageRating = ratedPlayers.length ? (ratedPlayers.reduce((total, player) => total + (player.self_rating ?? 0), 0) / ratedPlayers.length).toFixed(1) : '—';

  return (
    <div className={`app ${dark ? 'dark ' : ''}teams-page team-detail-page-v2 ${team?.theme ?? ''}`}>
      <SiteHeader dark={dark} onToggleTheme={toggleTheme} relative />
      <main className="shell team-detail-shell">
        <div className="team-detail-top"><Link className="team-back" to="/teams">← ALL TEAMS</Link>{team && <span>TEAM {String(index + 1).padStart(2, '0')} / {teams.length}</span>}</div>
        {teams.length > 0 && <nav className="team-detail-tabs" aria-label="Select team">{teams.map((item) => <Link className={item.code === team?.code ? 'active' : ''} to={`/teams/${item.code}`} key={item.code}>{item.code}</Link>)}</nav>}
        {!loaded ? <div className="teams-board-loading"><span /> Loading team…</div> : !team ? (
          <div className="teams-board-empty"><strong>TEAM NOT FOUND.</strong><Link className="team-back" to="/teams">← BACK TO TEAMS</Link></div>
        ) : (
          <>
            <section className="team-detail-hero">
              <div className="team-detail-banner" style={{ backgroundImage: `url(${resolveAsset(TEAM_HEADERS[team.code] ?? team.icon_url)})` }} role="img" aria-label={`${team.name} team banner`}><div className="team-detail-banner-scrim" /><div className="team-detail-banner-copy"><div className="team-detail-logo"><img src={resolveAsset(team.icon_url)} alt="" /></div><div><span>{team.code} · DPL 2026{team.champion ? ' · DEFENDING CHAMPIONS' : ''}</span><h1>{team.name}</h1></div></div><div className="team-detail-banner-leaders">{['owner', 'co_owner', 'captain'].map((role) => { const leader = leaders.find((player) => player.role === role); return leader ? <div className="team-detail-banner-leader" key={leader.id}><div className="team-detail-banner-leader-avatar">{leader.photo_url ? <img src={leader.photo_url} alt="" /> : initials(leader.name)}</div><div><span>{roleLabel(role)}</span><b>{leader.name}</b></div></div> : null; })}</div></div>
            </section>
            <section className="team-detail-metrics" aria-label="Team analytics">
              <div><span>ROSTER</span><b>{players.length}/{SQUAD_SIZE}</b><small>{SQUAD_SIZE - players.length} open places</small></div>
              <div><span>PURSE LEFT</span><b>{auction ? formatCompact(Math.max(0, budget - spent)) : '—'}</b><small>{auction ? `${formatCompact(spent)} spent` : 'Auction pending'}</small></div>
              <div><span>AVG BUY</span><b>{averageBuy ? formatCompact(averageBuy) : '—'}</b><small>{results.length} auctioned players</small></div>
              <div><span>TOP BUY</span><b>{highestBuy ? formatCompact(highestBuy) : '—'}</b><small>{mixLabel || 'No player mix yet'}</small></div>
            </section>
            <section className="team-detail-insights" aria-label="Team charts"><div className="team-detail-chart team-detail-purse-chart"><div className="team-detail-chart-head"><div><span>PURSE USED</span><strong>{auction ? formatCompact(spent) : '—'}</strong></div><b>{auction ? `${formatCompact(Math.max(0, budget - spent))} LEFT` : 'AUCTION PENDING'}</b></div><div className="team-detail-chart-track"><span style={{ width: `${pursePercent}%` }} /></div><div className="team-detail-chart-foot"><span>{auction ? `${formatCompact(spent)} spent` : 'No auction data yet'}</span><b>{auction ? `${Math.round(pursePercent)}% committed` : '—'}</b></div></div><div className="team-detail-chart team-detail-mix-chart"><div className="team-detail-chart-head"><div><span>SQUAD MIX</span><strong>{players.length} PLAYERS</strong></div><b>{mixEntries.length || '—'} TYPES</b></div><div className="team-detail-mix-bars">{mixEntries.length ? mixEntries.map(([type, count]) => <div className="team-detail-mix-row" key={type}><span>{type.replace('Wicketkeeper-batter', 'WK')}</span><div><i style={{ width: `${(count / maxMixCount) * 100}%` }} /></div><b>{count}</b></div>) : <span className="team-detail-chart-empty">Roster mix appears after players are assigned.</span>}</div></div><div className="team-detail-chart team-detail-rating-chart"><div className="team-detail-chart-head"><div><span>RATING PROFILE</span><strong>{averageRating}<small>/5</small></strong></div><b>{ratedPlayers.length} RATED</b></div><div className="team-detail-rating-bars">{ratingBuckets.map((count, index) => <div className="team-detail-rating-bar" key={index}><div><i style={{ height: `${(count / maxRatingCount) * 100}%` }} /></div><span>{index + 1}</span></div>)}</div></div></section>
            <section className="team-detail-roster-section"><div className="team-detail-section-head"><div><span className="eyebrow">THE SQUAD</span><h2>FIFTEEN PLACES.</h2></div><b>{players.length} LOCKED IN</b></div><div className="team-detail-roster">{Array.from({ length: SQUAD_SIZE }, (_, slot) => { const player = players[slot]; if (!player) return <article className="team-detail-player open" key={`${team.code}-open-${slot}`}><div className="team-detail-avatar">{String(slot + 1).padStart(2, '0')}</div><div className="team-detail-player-copy"><span>OPEN SLOT</span><h3>Available player place</h3><p>Squad position {String(slot + 1).padStart(2, '0')}</p></div><strong>OPEN</strong></article>; const result = resultByPlayer.get(playerKey(player.name)); return <article className={`team-detail-player${player.role !== 'player' ? ' leader' : ''}`} key={player.id}><div className="team-detail-avatar">{player.photo_url ? <img src={player.photo_url} alt="" /> : initials(player.name)}</div><div className="team-detail-player-copy"><span>{roleLabel(player.role)}</span><h3>{player.name}</h3><p>{player.location || 'Location pending'} · {player.player_type || 'Player'}</p><div className="team-detail-player-stats"><span>RATING <b>{player.self_rating ?? '—'}/5</b></span><span>PRICE <b>{result?.sold_price ? formatCompact(result.sold_price) : '—'}</b></span></div></div><strong>{player.dpl_played ? 'DPL VET' : 'ROOKIE'}</strong></article>; })}</div></section>
            <div className="team-detail-switcher">{index > 0 ? <Link to={`/teams/${teams[index - 1].code}`}>← {teams[index - 1].code}</Link> : <span />}<span>TEAM {String(index + 1).padStart(2, '0')} / {teams.length}</span>{index < teams.length - 1 ? <Link to={`/teams/${teams[index + 1].code}`}>{teams[index + 1].code} →</Link> : <span />}</div>
          </>
        )}
      </main>
      <footer>D2P · DPL 2026 · DIGITATE PREMIER LEAGUE · OFFICE CRICKET</footer>
    </div>
  );
}
