import { useEffect, useState } from 'react';
import SiteHeader from '@/components/SiteHeader';
import { useTheme } from '@/lib/useTheme';
import { fetchTeamsList, type TeamRow } from '@/lib/site';
import { withBase, resolveAsset } from '@/lib/base';

export default function TeamsPage() {
  const { dark, toggleTheme } = useTheme();
  const [teams, setTeams] = useState<TeamRow[]>([]);

  useEffect(() => {
    let alive = true;
    fetchTeamsList().then((rows) => {
      if (!alive) return;
      setTeams(rows);
    });
    return () => { alive = false; };
  }, []);

  const list = teams;

  return (
    <div className={dark ? 'app dark teams-page' : 'app teams-page'}>
      <SiteHeader dark={dark} onToggleTheme={toggleTheme} relative />
      <main className="teams-main shell">
        <section className="teams-grid">
          {list.map((t, i) => (
            <a className={`team-card ${t.theme}${t.champion ? ' champion' : ''}`} key={t.code} href={withBase(`/teams/${t.code}`)}>
              {t.champion && (
                <span className="team-champion" title="DPL 2025 Champions" aria-label="DPL 2025 Champions">
                  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2l2.6 6.6 7 .6-5.3 4.6 1.6 6.9L12 17.3l-5.9 3.4 1.6-6.9L2.4 9.2l7-.6z"/></svg>
                </span>
              )}
              <div className="team-sprite"><img src={resolveAsset(t.icon_url)} alt={t.name} /></div>
              <div className="team-meta">
                <div className="team-code">{t.code} · TEAM {String(i + 1).padStart(2, '0')}</div>
                <div className="team-name">{t.name}</div>
                <div className="team-leads">
                  <div className="team-lead"><span>OWNER</span><b>{t.owner || 'TBD'}</b></div>
                  {t.co_owner && <div className="team-lead"><span>CO-OWNER</span><b>{t.co_owner}</b></div>}
                  <div className="team-lead"><span>CAPTAIN</span><b>{t.captain || 'TBD'}</b></div>
                </div>
                <div className="team-players"><span className="team-count">{t.player_count} PLAYERS</span><span className="team-view">VIEW TEAM</span></div>
                <div className="team-arrow">↗</div>
              </div>
            </a>
          ))}
        </section>
      </main>
    </div>
  );
}