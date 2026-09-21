import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, Download, Loader2, MapPin, Trophy, Zap } from 'lucide-react';
import SiteHeader from '@/components/SiteHeader';
import PublicScorecardDialog from '@/components/PublicScorecardDialog';
import HoldScreen from '@/components/HoldScreen';
import { resolveAsset } from '@/lib/base';
import {
  computeStandings, fetchFixtureConfig, fetchFixtures, fetchFixturePom, fetchFixturesTiming, fetchLiveDetail, fetchPublicFlags, formatFixtureDate, formatFixtureTime, oversText,
  DEFAULT_FIXTURE_CONFIG, type Fixture, type FixtureConfig, type LiveDetail, type MatchTiming, type PublicFlags, type Standing,
} from '@/lib/fixtures';
import { fetchTeamsList, isCurrentUserAdmin, type TeamRow } from '@/lib/site';
import { useTheme } from '@/lib/useTheme';

const FIXTURE_QUOTES = [
  'The fixture list is in the DRS review. Third umpire is fetching chai.',
  'Not rain. Not bad light. Just… dates doing a slow over-rate.',
  'Our schedule went for a strategic timeout. Back after the drinks break.',
  'The calendar pulled a hamstring. Physio says two–three days.',
  'Dates under negotiation — the trophy is already practising its speech.',
  'Fixtures are on a water break. Hydration is important, people.',
  'We’ve appealed for a postponement. Decision pending with the match referee.',
];

type Groups = Record<'A' | 'B', string[]>;
type Slot = { code: string; name: string; captain: string; team?: TeamRow };

function groupCodes(fixtures: Fixture[]): Groups {
  const groups: Groups = { A: [], B: [] };
  fixtures.forEach((f) => {
    if (f.stage !== 'league' || (f.group_name !== 'A' && f.group_name !== 'B')) return;
    [f.home_code, f.away_code].forEach((code) => {
      if (!groups[f.group_name as 'A' | 'B'].includes(code)) groups[f.group_name as 'A' | 'B'].push(code);
    });
  });
  return groups;
}

function resolveSlot(slot: string, tables: Record<'A' | 'B', Standing[]>, fixtures: Fixture[], teams: TeamRow[]): Slot {
  const q = /^([AB])([12])$/.exec(slot);
  if (q) {
    const group = q[1] as 'A' | 'B';
    const rank = Number(q[2]) - 1;
    const leagueDone = fixtures.filter((f) => f.stage === 'league').every((f) => f.status === 'completed');
    if (leagueDone) {
      const entry = tables[group][rank];
      if (entry) return { code: entry.team.code, name: entry.team.name, captain: entry.team.captain || 'TBD', team: entry.team };
    }
    return { code: `GRP ${group} #${rank + 1}`, name: `Group ${group} #${rank + 1}`, captain: 'TBD' };
  }
  const sf = /^SF([12])$/.exec(slot);
  if (sf) {
    const semis = fixtures.filter((f) => f.stage === 'semifinal').sort((a, b) => a.sort_order - b.sort_order);
    const semiFixture = semis[Number(sf[1]) - 1];
    if (semiFixture?.status === 'completed' && semiFixture.winner_code) {
      const t = teams.find((t) => t.code === semiFixture.winner_code);
      return { code: semiFixture.winner_code, name: t?.name ?? semiFixture.winner_code, captain: t?.captain ?? 'TBD', team: t };
    }
    return { code: `SF ${sf[1]}`, name: `Semi-final ${sf[1]} Winner`, captain: 'TBD' };
  }
  const team = teams.find((t) => t.code === slot);
  if (team) return { code: team.code, name: team.name, captain: team.captain || 'TBD', team };
  return { code: slot, name: slot, captain: 'TBD' };
}

export default function FixturesPage() {
  const { dark, toggleTheme } = useTheme();
  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [config, setConfig] = useState<FixtureConfig>(DEFAULT_FIXTURE_CONFIG);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState('all');
  const [scorecardFor, setScorecardFor] = useState<Fixture | null>(null);
  const [timing, setTiming] = useState<Record<number, MatchTiming>>({});
  const [pom, setPom] = useState<Record<number, string>>({});
  const [flags, setFlags] = useState<PublicFlags | null>(null);
  const [admin, setAdmin] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([fetchFixtures(), fetchTeamsList(), fetchFixtureConfig()]).then(([fr, tr, cfg]) => {
      if (!active) return;
      setFixtures(fr.data); setTeams(tr); setConfig(cfg); setError(fr.error ?? null);
    });
    fetchFixturesTiming().then((rows) => { if (active) setTiming(Object.fromEntries(rows.map((r) => [r.match_number, r]))); });
    fetchFixturePom().then((m) => { if (active) setPom(m); });
    fetchPublicFlags().then((f) => { if (active) setFlags(f); });
    isCurrentUserAdmin().then((a) => { if (active) setAdmin(a); });
    return () => { active = false; };
  }, []);

  const published = useMemo(() => fixtures.filter((f) => f.published), [fixtures]);
  const groups = useMemo(() => groupCodes(published), [published]);
  const tables = useMemo(() => ({
    A: computeStandings(published, teams, groups.A, config),
    B: computeStandings(published, teams, groups.B, config),
  }), [published, teams, groups, config]);
  const league = published.filter((f) => f.stage === 'league');
  const playoff = published.filter((f) => f.stage !== 'league');
  const days = useMemo(() => [...new Set(league.map((f) => f.match_date))].sort(), [league]);
  const loading = !error && fixtures.length === 0;
  const rulebookHref = resolveAsset(dark ? '/DPL-2026-Rulebook.pdf' : '/DPL-2026-Rulebook-Light.pdf');

  const featured = useMemo(
    () => published.find((f) => f.status === 'live') ?? published.find((f) => f.status === 'upcoming') ?? [...published].reverse().find((f) => f.status === 'completed'),
    [published],
  );

  const liveFixtures = published.filter((f) => f.status === 'live');
  const nextUp = published.find((f) => f.status === 'upcoming');

  const buckets = useMemo(() => [
    { key: 'all', label: 'All Matches', count: league.length },
    ...days.map((date, i) => ({ key: `day${i + 1}`, label: `Day ${i + 1}`, count: league.filter((f) => f.match_date === date).length })),
    { key: 'knockout', label: 'Knockout', count: playoff.length },
    { key: 'live', label: 'Live', count: liveFixtures.length },
  ], [days, league, playoff.length, liveFixtures.length]);

  const visibleLeague = view.startsWith('day') ? league.filter((f) => f.match_date === days[Number(view.slice(3)) - 1]) : league;
  const showBracket = view === 'knockout';
  const showLive = view === 'live';
  const showSchedule = !showBracket && !showLive;
  const scheduleDays = useMemo(() => {
    const map = new Map<string, Fixture[]>();
    visibleLeague.forEach((f) => map.set(f.match_date, [...(map.get(f.match_date) ?? []), f]));
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [visibleLeague]);

  if (flags?.fixtures_hold && !admin) {
    return <div className={dark ? 'app dark fx-page' : 'app fx-page'}>
      <SiteHeader dark={dark} onToggleTheme={toggleTheme} relative />
      <HoldScreen eyebrow="DPL 2026 / FIXTURES" bgVar="--bg-fixtures" quotes={FIXTURE_QUOTES} />
    </div>;
  }

  return <div className={dark ? 'app dark fx-page' : 'app fx-page'}>
    <SiteHeader dark={dark} onToggleTheme={toggleTheme} relative />
    <main className="fx-main">
      <section className="fx-hero">
        <div className="fx-hero-bg" />
        <div className="fx-hero-inner">
          <div className="fx-hero-copy">
            <span className="fx-live"><i /> DPL 2026 · Official Fixtures</span>
            <h1>The Road to<br /><span>The Final.</span></h1>
            <p className="fx-hero-sub">Ten teams. Two groups. Eighteen matches across two days at DPL Arena — every ball counts on the road to the final.</p>
            <div className="fx-hero-actions">
              <a className="fx-btn fx-btn-primary" href={rulebookHref} download><Download /> Download Rule Book</a>
              <a className="fx-btn fx-btn-ghost" href="#schedule"><CalendarDays /> View Schedule</a>
            </div>
            <div className="fx-hero-stats">
              <div className="fx-hero-stat"><b>{league.length + playoff.length}</b><span>Matches</span></div>
              <div className="fx-hero-stat"><b>{teams.length || 10}</b><span>Teams</span></div>
              <div className="fx-hero-stat"><b>{days.length}</b><span>Match Days</span></div>
            </div>
          </div>
          {featured && <FeatureCard fixture={featured} teams={teams} tables={tables} allFixtures={published} onScorecard={() => setScorecardFor(featured)} />}
        </div>
      </section>

      {loading && <div className="fx-state"><Loader2 className="spin" /> Loading fixtures…</div>}
      {error && <div className="fx-state fx-error"><strong>Fixtures are not published yet.</strong><span>{error}</span></div>}
      {!loading && !error && <>
        <nav className="fx-buckets" aria-label="Filter fixtures">
          {buckets.map((b) => <button key={b.key} type="button" className={`fx-bucket${view === b.key ? ' on' : ''}`} aria-pressed={view === b.key} onClick={() => setView(b.key)}>
            {b.label}<small>{b.count}</small>
          </button>)}
        </nav>

        {showLive && <section className="fx-panel" aria-label="Live matches">
          <header className="fx-panel-head"><Zap /><h2>Live Now</h2><span>{liveFixtures.length} live</span></header>
          {liveFixtures.length > 0
            ? <div className="fx-live-grid">{liveFixtures.map((f) => <LiveCard key={f.id} fixture={f} teams={teams} onScorecard={() => setScorecardFor(f)} />)}</div>
            : <div className="fx-live-empty">
                <Zap />
                <b>No match is live right now.</b>
                {nextUp
                  ? <span>Next up · M{nextUp.match_number} · {nextUp.home_code} vs {nextUp.away_code} · {formatFixtureDate(nextUp.match_date)} {formatFixtureTime(nextUp.match_time)}</span>
                  : <span>Check back on match day.</span>}
              </div>}
        </section>}

        {showSchedule && <section className="fx-panel" aria-label="Group standings">
          <header className="fx-panel-head"><Trophy /><h2>Group Standings</h2><span>Top 2 qualify</span></header>
          <div className="fx-groups">
            <GroupTable name="Group A" rows={tables.A} />
            <GroupTable name="Group B" rows={tables.B} />
          </div>
        </section>}

        {showSchedule && <section className="fx-panel" id="schedule" aria-label="Match schedule">
          <header className="fx-panel-head"><CalendarDays /><h2>Match Schedule</h2><span>{visibleLeague.length} matches</span></header>
          {scheduleDays.map(([date, list]) => <div className="fx-day" key={date}>
            <div className="fx-day-head"><h3>{formatFixtureDate(date)}</h3><span>{list.length} matches</span><i /></div>
            <div className="fx-matches">{list.map((f) => <MatchCard key={f.id} fixture={f} teams={teams} tables={tables} allFixtures={published} timing={timing[f.match_number]} pom={pom[f.match_number]} onScorecard={() => setScorecardFor(f)} />)}</div>
          </div>)}
        </section>}

        {showBracket && <section className="fx-panel" aria-label="Knockout bracket">
          <header className="fx-panel-head"><Zap /><h2>Knockout Stage</h2><span>Top 2 from each group</span></header>
          <Bracket playoff={playoff} teams={teams} tables={tables} allFixtures={fixtures} />
        </section>}

        <section className="fx-cta">
          <div>
            <h2>Know the rules before you play.</h2>
            <p>Download the official DPL 2026 rule book — squad composition, no-balls &amp; free hits, retirements, scoring and the Super Over.</p>
          </div>
          <a className="fx-btn fx-btn-primary" href={rulebookHref} download><Download /> Download Rule Book</a>
        </section>
      </>}
      {scorecardFor && <PublicScorecardDialog fixture={scorecardFor} onClose={() => setScorecardFor(null)} />}
    </main>
    <footer>D2P / DPL 2026 / DIGITATE PREMIER LEAGUE / OFFICE CRICKET</footer>
  </div>;
}

function FeatureCard({ fixture, teams, tables, allFixtures, onScorecard }: { fixture: Fixture; teams: TeamRow[]; tables: Record<'A' | 'B', Standing[]>; allFixtures: Fixture[]; onScorecard: () => void }) {
  const home = resolveSlot(fixture.home_code, tables, allFixtures, teams);
  const away = resolveSlot(fixture.away_code, tables, allFixtures, teams);
  const [live, setLive] = useState<LiveDetail | null>(null);
  useEffect(() => {
    if (fixture.status !== 'live') { setLive(null); return; }
    let alive = true;
    const load = () => fetchLiveDetail(fixture.match_number).then((d) => { if (alive) setLive(d); });
    load();
    const id = window.setInterval(load, 15000);
    return () => { alive = false; window.clearInterval(id); };
  }, [fixture.match_number, fixture.status]);

  const scoreText = (code: string, fallback: number | null) => {
    const i = live?.innings.find((x) => x.batting_code === code);
    if (i) return `${i.runs}/${i.wickets} (${oversText(i.overs)})`;
    return fallback != null ? String(fallback) : null;
  };

  return <aside className="fx-feature">
    <div className="fx-feature-tag"><span>{fixture.status === 'live' ? 'Live Now' : fixture.status === 'upcoming' ? 'Next Up' : 'Latest Result'}</span><em>Match {fixture.match_number}</em></div>
    <div className="fx-feature-body">
      <FeatureTeam slot={home} scoreText={scoreText(fixture.home_code, fixture.home_score)} win={fixture.winner_code === home.code} />
      <span className="fx-feature-vs">VS</span>
      <FeatureTeam slot={away} scoreText={scoreText(fixture.away_code, fixture.away_score)} win={fixture.winner_code === away.code} />
    </div>
    {live?.current && <div className="fx-feature-live">{live.current.striker ?? '—'} &amp; {live.current.non_striker ?? '—'} batting · {live.current.bowler ?? '—'} bowling</div>}
    <div className="fx-feature-foot">
      <span><CalendarDays /> {formatFixtureDate(fixture.match_date)} · {formatFixtureTime(fixture.match_time)}</span>
      <span><MapPin /> {fixture.venue}</span>
      {(fixture.status === 'completed' || fixture.status === 'live') && <button type="button" className="fx-sc-btn" onClick={onScorecard}>SCORECARD</button>}
    </div>
  </aside>;
}

function FeatureTeam({ slot, scoreText, win }: { slot: Slot; scoreText: string | null; win: boolean }) {
  return <div className={`fx-feature-team${win ? ' win' : ''}`}>
    {slot.team ? <img src={resolveAsset(slot.team.icon_url)} alt={slot.name} /> : <span className="fx-feature-ph" />}
    <b>{slot.team?.code ?? slot.name}</b>
    <span>{slot.captain}</span>
    {scoreText && <em className="fx-feature-score">{scoreText}</em>}
  </div>;
}

function GroupTable({ name, rows }: { name: string; rows: Standing[] }) {
  return <article className="fx-group">
    <header className="fx-group-head"><h3>{name}</h3><span>{rows.length} teams</span></header>
    <div className="fx-tr head"><span>#</span><span /><span>Team</span><span>P</span><span>W</span><span>L</span><span>Pts</span><span>NRR</span></div>
    {rows.map((r, i) => <div className={`fx-tr${i < 2 ? ' qual' : ''}`} key={r.team.id}>
      <span className="fx-pos">{i + 1}</span>
      <span className="fx-crest">{r.team.icon_url ? <img src={resolveAsset(r.team.icon_url)} alt={r.team.name} /> : null}</span>
      <span className="fx-team"><b>{r.team.code}</b><span>{r.team.name}</span></span>
      <span className="fx-num">{r.played}</span>
      <span className="fx-num w">{r.won}</span>
      <span className="fx-num l">{r.lost}</span>
      <span className="fx-num pts"><b>{r.points}</b></span>
      <span className={`fx-nrr${r.nrr > 0 ? ' pos' : r.nrr < 0 ? ' neg' : ''}`}>{r.played ? `${r.nrr > 0 ? '+' : ''}${r.nrr.toFixed(2)}` : '—'}</span>
    </div>)}
  </article>;
}

function LiveCard({ fixture, teams, onScorecard }: { fixture: Fixture; teams: TeamRow[]; onScorecard: () => void }) {
  const [detail, setDetail] = useState<LiveDetail | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => fetchLiveDetail(fixture.match_number).then((d) => { if (alive) setDetail(d); });
    load();
    const id = window.setInterval(load, 15000);
    return () => { alive = false; window.clearInterval(id); };
  }, [fixture.match_number]);

  const cur = detail?.current;
  const sides = [
    { code: fixture.home_code, team: teams.find((t) => t.code === fixture.home_code) },
    { code: fixture.away_code, team: teams.find((t) => t.code === fixture.away_code) },
  ];
  return <article className="fx-live-card">
    <div className="fx-live-top"><span className="fx-live-dot" /> Live · Match {fixture.match_number}{cur?.free_hit && <em className="fx-live-fh">Free hit</em>}</div>
    {sides.map(({ code, team }) => {
      const inn = detail?.innings.find((i) => i.batting_code === code);
      const batting = cur?.batting_code === code;
      return <div className={`fx-live-row${batting ? ' batting' : ''}`} key={code}>
        {team?.icon_url ? <img src={resolveAsset(team.icon_url)} alt={team.name} /> : null}
        <span className="fx-live-code">{code}</span>
        <span className="fx-live-score">{inn ? <>{inn.runs}<i>/{inn.wickets}</i> <small>({oversText(inn.overs)} ov)</small></> : <small>yet to bat</small>}</span>
      </div>;
    })}
    {cur && (
      <div className="fx-live-insights">
        <span><b>{cur.striker ?? '—'}</b> *</span>
        <span>{cur.non_striker ?? '—'}</span>
        <span>Bowl · {cur.bowler ?? '—'}</span>
        <span>RR {cur.run_rate ?? '—'}</span>
        {cur.target != null && <span className="fx-live-need">Need {cur.required} off {cur.balls_left}</span>}
      </div>
    )}
    {detail && detail.recent.length > 0 && (
      <div className="fx-live-balls">
        {detail.recent.map((b) => <span key={b.seq} className={`fx-ball${b.is_wicket ? ' w' : b.extra ? ' x' : ''}`}>{b.extra === 'wide' ? 'wd' : b.extra === 'no_ball' ? 'nb' : b.extra === 'bye' ? 'b' : b.is_wicket ? 'W' : b.runs}</span>)}
      </div>
    )}
    <div className="fx-live-foot"><span>{fixture.venue}</span><button type="button" className="fx-sc-btn" onClick={onScorecard}>Scorecard</button></div>
  </article>;
}

function MatchCard({ fixture, teams, tables, allFixtures, timing, pom, onScorecard }: { fixture: Fixture; teams: TeamRow[]; tables: Record<'A' | 'B', Standing[]>; allFixtures: Fixture[]; timing?: MatchTiming; pom?: string; onScorecard: () => void }) {
  const home = resolveSlot(fixture.home_code, tables, allFixtures, teams);
  const away = resolveSlot(fixture.away_code, tables, allFixtures, teams);
  return <article className={`fx-match${fixture.status === 'live' ? ' live' : ''}`}>
    <div className="fx-match-time">
      <b>{formatFixtureTime(fixture.match_time)}</b><span>M{fixture.match_number}</span><span>{fixture.venue}</span>
      {timing && <span className={`fx-timing${timing.within_slot ? '' : ' over'}`}>{timing.minutes < 1 ? '<1' : Math.round(timing.minutes)} min · {timing.within_slot ? 'within slot' : 'over slot'}</span>}
    </div>
    <div className="fx-match-teams">
      <TeamSide side="home" slot={home} score={fixture.home_score} overs={fixture.home_overs} win={fixture.winner_code === home.code} />
      <span className="fx-vs">VS</span>
      <TeamSide side="away" slot={away} score={fixture.away_score} overs={fixture.away_overs} win={fixture.winner_code === away.code} />
    </div>
    <div className="fx-match-side">
      <span className={`fx-pill ${fixture.status}`}>{fixture.status}</span>
      {pom && <span className="fx-pom" title={`Player of the Match: ${pom}`}>POM · {pom}</span>}
      {(fixture.status === 'completed' || fixture.status === 'live') && <button type="button" className="fx-sc-btn" onClick={onScorecard}>SCORECARD</button>}
    </div>
  </article>;
}

function TeamSide({ side, slot, score, overs, win }: { side: 'home' | 'away'; slot: Slot; score: number | null; overs: number | null; win: boolean }) {
  return <div className={`fx-side ${side}${win ? ' win' : ''}`}>
    {slot.team ? <img src={resolveAsset(slot.team.icon_url)} alt={slot.name} /> : <span className="fx-side-ph" />}
    <span className="fx-side-info"><b>{slot.team?.code ?? slot.name}</b><span>{slot.captain}</span></span>
    {score != null && <span className="fx-side-stat"><em className="fx-side-score">{score}</em>{overs != null && <i className="fx-side-overs">{overs} ov</i>}</span>}
  </div>;
}

function Bracket({ playoff, teams, tables, allFixtures }: { playoff: Fixture[]; teams: TeamRow[]; tables: Record<'A' | 'B', Standing[]>; allFixtures: Fixture[] }) {
  const semis = playoff.filter((f) => f.stage === 'semifinal').sort((a, b) => a.sort_order - b.sort_order);
  const final = playoff.find((f) => f.stage === 'final');
  const champion = final?.status === 'completed' && final.winner_code ? teams.find((t) => t.code === final.winner_code) : undefined;
  return <div className="fx-bracket">
    <div className="fx-bracket-col">
      <h3>Semi-finals</h3>
      {semis.map((f) => <BracketMatch key={f.id} fixture={f} teams={teams} tables={tables} allFixtures={allFixtures} kind="semi" />)}
    </div>
    <span className="fx-bracket-arrow" aria-hidden="true">›</span>
    <div className="fx-bracket-col">
      <h3>Grand Final</h3>
      {final && <BracketMatch fixture={final} teams={teams} tables={tables} allFixtures={allFixtures} kind="final" />}
    </div>
    <span className="fx-bracket-arrow" aria-hidden="true">›</span>
    <div className="fx-bracket-col">
      <h3>Champion</h3>
      <div className="fx-champ">
        {champion ? <img src={resolveAsset(champion.icon_url)} alt={champion.name} /> : <Trophy />}
        <b>{champion?.name ?? 'To be crowned'}</b>
        <span>DPL 2026</span>
      </div>
    </div>
  </div>;
}

function BracketMatch({ fixture, teams, tables, allFixtures, kind }: { fixture: Fixture; teams: TeamRow[]; tables: Record<'A' | 'B', Standing[]>; allFixtures: Fixture[]; kind: 'semi' | 'final' }) {
  const home = resolveSlot(fixture.home_code, tables, allFixtures, teams);
  const away = resolveSlot(fixture.away_code, tables, allFixtures, teams);
  return <article className={`fx-bmatch ${kind}`}>
    <div className="fx-bmatch-label">{kind === 'final' ? 'Grand Final' : 'Semi-final'} · M{fixture.match_number}</div>
    <BracketTeam slot={home} score={fixture.home_score} win={fixture.winner_code === home.code} />
    <BracketTeam slot={away} score={fixture.away_score} win={fixture.winner_code === away.code} />
    <div className="fx-btime">{formatFixtureTime(fixture.match_time)} · {fixture.venue}</div>
  </article>;
}

function BracketTeam({ slot, score, win }: { slot: Slot; score: number | null; win: boolean }) {
  return <div className={`fx-bteam${win ? ' win' : ''}`}>
    {slot.team ? <img src={resolveAsset(slot.team.icon_url)} alt={slot.name} /> : <span className="fx-bteam-ph" />}
    <span className="fx-bteam-info"><b>{slot.team?.code ?? slot.name}</b><span>{slot.captain}</span></span>
    {score != null && <em className="fx-side-score">{score}</em>}
  </div>;
}
