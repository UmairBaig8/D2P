import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import SiteHeader from '@/components/SiteHeader';
import BorderGlow from '@/components/BorderGlow';
import { useTheme } from '@/lib/useTheme';
import { fetchTeamsList, fetchTeamRoster, type TeamRow, type TeamRosterPlayer } from '@/lib/site';
import { resolveAsset } from '@/lib/base';

export default function TeamPage() {
  const { dark, toggleTheme } = useTheme();
  const { code } = useParams();
  const [team, setTeam] = useState<TeamRow | null>(null);
  const [players, setPlayers] = useState<TeamRosterPlayer[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchTeamsList().then((rows) => {
      if (!alive) return;
      const found = rows.find((t) => t.code === code);
      setTeam(found ?? null);
      if (found) {
        fetchTeamRoster(code!).then((roster) => {
          if (alive) setPlayers(roster);
        });
      }
      setLoaded(true);
    });
    return () => { alive = false; };
  }, [code]);

  if (!loaded) return null;

  if (!team) {
    return (
      <div className={dark ? 'app dark teams-page' : 'app teams-page'}>
        <SiteHeader dark={dark} onToggleTheme={toggleTheme} relative />
        <main className="teams-main shell">
          <div className="teams-head">
            <h1>TEAM <span>NOT FOUND.</span></h1>
            <Link className="team-back" to="/teams">← ALL TEAMS</Link>
          </div>
        </main>
      </div>
    );
  }

  return (
    <TeamDetail
      dark={dark}
      toggleTheme={toggleTheme}
      name={team.name}
      code={team.code}
      img={resolveAsset(team.icon_url)}
      theme={team.theme}
      count={team.player_count}
      owner={team.owner || 'TBD'}
      coOwner={team.co_owner || ''}
      captain={team.captain || 'TBD'}
      champion={team.champion}
      players={players}
    />
  );
}

function TeamDetail({
  dark,
  toggleTheme,
  name,
  code,
  img,
  theme,
  count,
  owner,
  coOwner,
  captain,
  champion,
  players,
}: {
  dark: boolean;
  toggleTheme: (nextDark: boolean) => void;
  name: string;
  code: string;
  img: string;
  theme: string;
  count: number;
  owner: string;
  coOwner: string;
  captain: string;
  champion: boolean;
  players: TeamRosterPlayer[];
}) {
  return (
    <div className={`app ${dark ? 'dark ' : ''}teams-page team-detail-page ${theme}`}>
      <SiteHeader dark={dark} onToggleTheme={toggleTheme} relative />
      <main className="teams-main shell">
        <Link className="team-back" to="/teams">← ALL TEAMS</Link>
        <div className="team-hero">
          <BorderGlow className="team-hero-glow" backgroundColor="#0b1420" colors={['#2f7dff', '#09c9d8', '#873cff']} glowColor="215 100 60" glowIntensity={1} glowRadius={24} edgeSensitivity={26} borderRadius={22}>
            <div className="team-hero-icon">
              <img src={img} alt={name} />
              {champion && (
                <span className="team-champion team-champion--hero" title="DPL 2025 Champions" aria-label="DPL 2025 Champions">
                  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l2.6 6.6 7 .6-5.3 4.6 1.6 6.9L12 17.3l-5.9 3.4 1.6-6.9L2.4 9.2l7-.6z"/></svg>
                </span>
              )}
            </div>
          </BorderGlow>
          <div className="team-hero-info">
            <div className="eyebrow">
              {code} · DPL 2026{champion ? ' · DEFENDING CHAMPIONS' : ''}
            </div>
            <h1>{name}</h1>
            <p className="teams-desc">{count} players locked in. One goal: lift the DPL 2026 trophy.</p>
            <div className="team-leads">
              <div className="team-lead"><span>OWNER</span><b>{owner}</b></div>
              {coOwner && <div className="team-lead"><span>CO-OWNER</span><b>{coOwner}</b></div>}
              <div className="team-lead"><span>CAPTAIN</span><b>{captain}</b></div>
            </div>
          </div>
        </div>
        <section className="player-grid team-player-grid">
          {players.map((p) => (
            <article className={`player-card ${theme}`} key={p.id}>
              <div className="player-photo"><span>{p.name.split(' ').map((w) => w[0]).slice(0, 2).join('')}</span></div>
              <h3>{p.name}</h3>
              <span className="player-role">{p.role === 'owner' ? 'OWNER' : p.role === 'co_owner' ? 'CO-OWNER' : p.role === 'captain' ? 'CAPTAIN' : p.role === 'vice_captain' ? 'VICE CAPTAIN' : 'PLAYER'}</span>
              <div className="team-player-extra">
                <span className="player-squad">{p.location}</span>
                <span className={`player-dpl${p.dpl_played ? '' : ' no'}`}>{p.dpl_played ? 'DPL VET' : 'ROOKIE'}</span>
              </div>
            </article>
          ))}
        </section>
      </main>
      <footer>D2P · DPL 2026 · DIGITATE PREMIER LEAGUE · OFFICE CRICKET · BUILT FOR THE PEOPLE WHO TURN COFFEE BREAKS INTO CRICKET DEBATES.</footer>
    </div>
  );
}
