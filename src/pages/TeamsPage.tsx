import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Crown } from 'lucide-react';
import SiteHeader from '@/components/SiteHeader';
import { useTheme } from '@/lib/useTheme';
import { fetchTeamsList, type TeamRow } from '@/lib/site';
import { fetchAuctionLiveState, formatCompact, type AuctionLiveState } from '@/lib/auction';
import { resolveAsset } from '@/lib/base';

const TEAM_HEADERS: Record<string, string> = {
  DSK: '/team-headers/digi-super-kings.png', SM: '/team-headers/sahyadriche-mavale.png', DMM: '/team-headers/digi-mitra-mandal.png',
  BB: '/team-headers/bhakarwadi-blasters.png', DD: '/team-headers/digi-dhadakebaaz.png', CW: '/team-headers/cricket-wala.png',
  DT: '/team-headers/digi-titans.png', DY: '/team-headers/digi-yodhas.png', GM: '/team-headers/gallit-maramari.png', DDH: '/team-headers/digi-dhurandhars.png',
};

export default function TeamsPage() {
  const { dark, toggleTheme } = useTheme();
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [auction, setAuction] = useState<AuctionLiveState | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    Promise.all([fetchTeamsList(), fetchAuctionLiveState()]).then(([rows, live]) => {
      setTeams(rows);
      setAuction(live);
      setLoaded(true);
    });
  }, []);

  return (
    <div className={dark ? 'app dark teams-page' : 'app teams-page'}>
      <SiteHeader dark={dark} onToggleTheme={toggleTheme} relative />
      <main className="teams-main shell teams-overview-page">
        <header className="teams-overview-header"><div><div className="eyebrow">DPL 2026 · THE LEAGUE</div><h1>CHOOSE YOUR <span>TEAM.</span></h1><p>Meet every squad. Open a team for its full roster, purse and auction story.</p></div><div className="teams-overview-count"><strong>{teams.length || '—'}</strong><span>TEAMS READY</span></div></header>
        {!loaded ? <div className="teams-board-loading"><span /> Loading teams…</div> : (
          <section className="team-overview-grid" aria-label="DPL teams">
            {teams.map((team, index) => {
              const auctionTeam = auction?.teams.find((entry) => entry.team_id === team.id || entry.code === team.code);
              const budget = auctionTeam?.budget ?? auction?.session?.purse_budget ?? 0;
              const spent = auctionTeam?.spent ?? 0;
              return (
                <Link className={`team-overview-card ${team.theme}${team.champion ? ' champion' : ''}`} to={`/teams/${team.code}`} key={team.code}>
                  <div className="team-overview-banner" style={{ backgroundImage: `url(${resolveAsset(TEAM_HEADERS[team.code] ?? team.icon_url)})` }} role="img" aria-label={`${team.name} team banner`}><div className="team-overview-scrim" />{team.champion && <span className="team-champion" title="DPL 2025 Champions" aria-label="DPL 2025 Champions"><Crown /></span>}<div className="team-overview-logo"><img src={resolveAsset(team.icon_url)} alt="" /></div><div className="team-overview-index">TEAM {String(index + 1).padStart(2, '0')} · {team.code}</div></div>
                  <div className="team-overview-body"><div className="team-overview-name">{team.name}</div><div className="team-overview-leads"><span>OWNER <b>{team.owner || 'TBD'}</b></span><span>CAPTAIN <b>{team.captain || 'TBD'}</b></span></div><div className="team-overview-footer"><b>{team.player_count}/{team.squad_size ?? 15} PLAYERS</b>{auction ? <b>{formatCompact(Math.max(0, budget - spent))} LEFT</b> : <b>VIEW TEAM →</b>}</div></div>
                </Link>
              );
            })}
          </section>
        )}
      </main>
      <footer>D2P · DPL 2026 · DIGITATE PREMIER LEAGUE · OFFICE CRICKET</footer>
    </div>
  );
}
