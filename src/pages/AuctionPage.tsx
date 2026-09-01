import { useEffect, useRef, useState } from 'react';
import { useTheme } from '@/lib/useTheme';
import { withBase } from '@/lib/base';
import SiteHeader from '@/components/SiteHeader';
import DepthCarousel from '@/components/DepthCarousel';
import SpotlightCard from '@/components/SpotlightCard';
import Confetti from '@/components/Confetti';
import { playGavel, playBuzz } from '@/lib/sound';
import {
  fetchAuctionPlayers,
  fetchAuctionLiveState,
  formatRupees,
  type AuctionPlayer,
  type AuctionLiveState,
} from '@/lib/site';

const availabilityShort: Record<string, string> = {
  'Available for all matches': 'ALL MATCHES',
  'Available for most matches': 'MOST MATCHES',
  'Need schedule confirmation': 'CONFIRM',
};

function PlayerCard({ player }: { player: AuctionPlayer }) {
  const avail = player.availability === 'Available for all matches' ? 3 : player.availability === 'Available for most matches' ? 2 : 1;
  const availLabel = availabilityShort[player.availability] ?? player.availability;
  return (
    <SpotlightCard className="ac-card-spotlight" spotlightColor="rgba(255, 255, 255, 0.16)">
      <div className="ac-slide">
        <div className="auction-card-top">
          <span className="ac-league">DPL <b>2026</b></span>
          <span className="ac-no">#{player.employee_id}</span>
        </div>
        <div className="ac-photo">
          {player.photo_url ? <img alt={player.name} src={player.photo_url} /> : <span className="ac-photo-fallback"><i>{player.name.split(' ').map((word) => word[0]).slice(0, 2).join('')}</i></span>}
          <span className="ac-photo-grad" />
          <span className="ac-role">{player.player_type}</span>
          <span className={`ac-gender ${player.gender?.toLowerCase()}`}>{player.gender === 'Female' ? '♀' : '♂'}</span>
        </div>
        <div className="ac-body">
          <strong className="ac-name">{player.name}</strong>
          <span className="ac-squad"><span className="ac-squad-dot" />{player.location}</span>
          <div className="ac-rating" aria-label={`${player.self_rating} out of 5 stars`}>
            {[1, 2, 3, 4, 5].map((star) => (
              <svg key={star} viewBox="0 0 24 24" className={star <= player.self_rating ? 'on' : ''} fill="currentColor" aria-hidden="true"><path d="M12 2l2.6 6.6 7 .6-5.3 4.6 1.6 6.9L12 17.3l-5.9 3.4 1.6-6.9L2.4 9.2l7-.6z"/></svg>
            ))}
            <span className="ac-rating-num">{player.self_rating}.0</span>
          </div>
          <div className="ac-chips">
            <span className="ac-chip"><i className="ac-chip-icon">🏏</i>{player.batting_style.replace('hand batter', '')}</span>
            <span className="ac-chip"><i className="ac-chip-icon">🎯</i>{player.bowling_style.replace('Do not bowl', 'NO BOWL')}</span>
          </div>
          <div className="ac-avail">
            <div className="ac-avail-head"><span>AVAILABILITY</span><b>{availLabel}</b></div>
            <div className="ac-avail-bar"><i className={`lvl-${avail}`} /></div>
          </div>
        </div>
        <div className="ac-bid">
          <div className="ac-bid-top">
            <span className={`ac-bid-status${player.dpl_played ? ' vet' : ''}`}>{player.dpl_played ? '★' : '·'} {player.dpl_played ? 'DPL VET' : 'DPL ROOKIE'}</span>
            <span className="ac-bid-label">OPENING BID</span>
          </div>
          <div className="ac-bid-amount">
            <span className="ac-bid-cur">₹</span>
            <b>0</b>
            <small>/BASE</small>
          </div>
        </div>
      </div>
    </SpotlightCard>
  );
}

function useCountdown(endAt: string | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);
  const end = endAt ? new Date(endAt).getTime() : null;
  if (end == null) return null;
  return Math.max(0, Math.floor((end - now) / 1000));
}

function LotTimer({ endAt, size }: { endAt: string | null; size?: 'sm' | 'lg' }) {
  const left = useCountdown(endAt);
  const cls = `auction-timer${size === 'lg' ? ' lg' : ''}`;
  if (left === null) return <div className={`${cls} off`}>--:--</div>;
  const danger = left <= 10;
  const mm = String(Math.floor(left / 60)).padStart(2, '0');
  const ss = String(left % 60).padStart(2, '0');
  return <div className={`${cls}${danger ? ' danger' : ''}`}><b>{mm}:{ss}</b><span>{danger ? 'TIME UP' : 'LEFT'}</span></div>;
}

function initials(name: string): string {
  return name.split(' ').map((word) => word[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
}

function Ticker({ state }: { state: AuctionLiveState }) {
  const items = [
    ...state.recent_bids.map((b) => ({ key: `b-${b.created_at}-${b.team_code}`, cls: 'bid', text: `${b.team_code} ${formatRupees(b.amount)} · ${b.player_name}` })),
    ...state.results.map((r, index) => ({
      key: `r-${r.player_name}-${index}`,
      cls: r.status,
      text: r.status === 'sold' ? `SOLD → ${r.team_code} ${r.player_name} ${formatRupees(r.sold_price)}` : `UNSOLD ✕ ${r.player_name}`,
    })),
  ];
  if (items.length < 2) return null;
  return (
    <div className="auction-ticker">
      <div className="auction-ticker-label">LIVE</div>
      <div className="auction-ticker-track">
        <div className="auction-ticker-run">
          {[...items, ...items].map((item, index) => (
            <span className={`auction-ticker-item ${item.cls}`} key={`${item.key}-${index}`}>{item.text}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

function LiveBoard({ state }: { state: AuctionLiveState }) {
  const session = state.session;
  const player = state.current_player;
  const bid = state.current_bid;
  const sold = state.results.filter((row) => row.status === 'sold');
  const unsold = state.results.filter((row) => row.status === 'unsold');
  const avail = player?.availability === 'Available for all matches' ? 3 : player?.availability === 'Available for most matches' ? 2 : 1;
  const availLabel = player ? (availabilityShort[player.availability] ?? player.availability) : '';
  const [flash, setFlash] = useState<AuctionLiveState['results'][number] | null>(null);
  const [callout, setCallout] = useState<'once' | 'twice' | null>(null);
  const seenRef = useRef<Set<string>>(new Set(state.results.map((r) => `${r.player_name}-${r.status}-${r.sold_price}`)));
  const calloutRef = useRef({ once: false, twice: false });
  const left = useCountdown(player?.timer_ends_at ?? null);

  useEffect(() => {
    for (const row of state.results) {
      const key = `${row.player_name}-${row.status}-${row.sold_price}`;
      if (!seenRef.current.has(key)) {
        seenRef.current.add(key);
        setFlash(row);
        if (row.status === 'sold') playGavel();
        else playBuzz();
        const timer = window.setTimeout(() => setFlash(null), 2600);
        return () => window.clearTimeout(timer);
      }
    }
  }, [state.results]);

  useEffect(() => {
    calloutRef.current = { once: false, twice: false };
    setCallout(null);
  }, [player?.player_id]);

  useEffect(() => {
    if (left === null) return;
    if (left <= 10 && !calloutRef.current.once) {
      calloutRef.current.once = true;
      setCallout('once');
    }
    if (left <= 5 && !calloutRef.current.twice) {
      calloutRef.current.twice = true;
      setCallout('twice');
    }
  }, [left]);

  useEffect(() => {
    if (!callout) return;
    const timer = window.setTimeout(() => setCallout(null), 2200);
    return () => window.clearTimeout(timer);
  }, [callout]);

  return (
    <>
    <div className="auction-board-shell">
      <div className="auction-board-top">
        <div className="auction-board-title">
          <span className="kicker-live"><i /><b>LIVE</b></span>
          <h1>{session?.name ?? 'DPL 2026 AUCTION'}</h1>
        </div>
        <div className="auction-board-counts">
          <span>{state.pool_count} POOL</span>
          <span>{sold.length} SOLD</span>
          <span>{unsold.length} UNSOLD</span>
        </div>
        <div className="auction-board-timer">
          <LotTimer endAt={player?.timer_ends_at ?? null} size="lg" />
          <span className="auction-board-timer-label">{player ? `LOT ${player.lot_order}` : 'STANDBY'}</span>
        </div>
      </div>

      <div className="auction-board-stage">
        <div className="auction-board-left">
          <div className="auction-bid-strip">
            <div className="auction-bid-stat live">
              <span>CURRENT BID</span>
              <b key={bid?.amount ?? player?.base_price ?? 0} className="auction-bid-pop">{formatRupees(bid?.amount ?? player?.base_price ?? null)}</b>
              {bid ? <em>{bid.team_name}</em> : <em>{player ? 'AT BASE · AWAITING FIRST BID' : 'STANDBY'}</em>}
            </div>
          </div>

          <div className="auction-focus">
            {player ? (
              <>
                {player.photo_url
                  ? <img className="player-card-bg" src={player.photo_url} alt={player.name} />
                  : <div className="player-card-bg player-card-bg-fallback">{initials(player.name)}</div>}
                <div className="player-card-shade" />
                <div className="auction-focus-top">
                  <span className="ac-league">DPL <b>2026</b></span>
                  <span className="auction-focus-no">#{player.employee_id}</span>
                </div>
                <div className="auction-focus-bottom">
                  <div className="auction-focus-id">
                    <div className="auction-focus-name">{player.name}</div>
                    <div className="auction-focus-meta">{player.player_type} · {player.location} · {player.gender === 'Female' ? '♀' : '♂'}</div>
                    <div className="auction-focus-chips">
                      <span className="ac-chip"><i className="ac-chip-icon">🏏</i>{player.batting_style?.replace('hand batter', '') ?? '—'}</span>
                      <span className="ac-chip"><i className="ac-chip-icon">🎯</i>{player.bowling_style?.replace('Do not bowl', 'NO BOWL') ?? '—'}</span>
                    </div>
                    <div className="auction-focus-stats">
                      <div className="ac-rating" aria-label={`${player.self_rating} out of 5 stars`}>
                        {[1, 2, 3, 4, 5].map((star) => (
                          <svg key={star} viewBox="0 0 24 24" className={star <= player.self_rating ? 'on' : ''} fill="currentColor" aria-hidden="true"><path d="M12 2l2.6 6.6 7 .6-5.3 4.6 1.6 6.9L12 17.3l-5.9 3.4 1.6-6.9L2.4 9.2l7-.6z"/></svg>
                        ))}
                        <span className="ac-rating-num">{player.self_rating}.0</span>
                      </div>
                      <div className="ac-avail">
                        <div className="ac-avail-head"><span>AVAILABILITY</span><b>{availLabel}</b></div>
                        <div className="ac-avail-bar"><i className={`lvl-${avail}`} /></div>
                      </div>
                    </div>
                  </div>
                  <div className="auction-focus-badge">
                    <b>{formatRupees(player.base_price)}</b>
                    <span>BASE PRICE</span>
                  </div>
                </div>
              </>
            ) : (
              <div className="auction-focus-idle">
                <div className="auction-empty-badge">⏳</div>
                <h2>NEXT LOT COMING UP</h2>
                <p>The auctioneer is putting the next player under the hammer.</p>
              </div>
            )}
          </div>
        </div>

        <div className="auction-board-right">
          <div className="auction-teams-head">
            <h3><span>PURSE</span> BOARD</h3>
            <small>{state.teams.length} TEAMS</small>
          </div>
          <div className="auction-teams-grid">
            {state.teams.map((team) => {
              const remaining = team.budget - team.spent;
              const pct = team.budget > 0 ? Math.min(100, Math.round((team.spent / team.budget) * 100)) : 0;
              const leading = bid?.team_id === team.team_id;
              const blocked = team.squad >= 11 || remaining <= 0;
              return (
                <div className={`auction-team-card${leading ? ' leading' : ''}${remaining <= 0 ? ' empty' : ''}${blocked ? ' blocked' : ''}`} key={team.team_id} title={`${team.name} — ${team.squad} players · ${team.sold} bought here`}>
                  <div className="atc-head">
                    {team.icon_url ? <img src={team.icon_url} alt="" /> : <span className="atc-fallback">{team.code}</span>}
                    <div className="atc-id">
                      <b>{team.code}</b>
                      <span>{team.name}</span>
                    </div>
                    <small className="atc-squad">{team.squad}/11</small>
                  </div>
                  <div className="atc-money">
                    <b>{formatRupees(remaining)}</b>
                    <span>LEFT</span>
                  </div>
                  <div className="atc-bar"><i style={{ width: `${pct}%` }} /></div>
                  <div className="atc-foot">
                    <span>SPENT {formatRupees(team.spent)}</span>
                    <span>{team.sold} SOLD</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {(state.up_next.length > 1 || state.recent_bids.length + state.results.length >= 2) && (
        <div className="auction-board-bottom">
          {state.up_next.length > 1 && (
            <div className="auction-upnext">
              <span className="auction-upnext-label"><span>UP</span> NEXT</span>
              <div className="auction-upnext-list">
                {state.up_next.slice(0, 5).map((p) => (
                  <div className="auction-upnext-card" key={p.player_id}>
                    {p.photo_url ? <img src={p.photo_url} alt="" /> : <span className="aun-fallback">{initials(p.name)}</span>}
                    <div className="auction-upnext-info">
                      <b>{p.name}</b>
                      <span>LOT {p.lot_order} · {p.player_type}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          <Ticker state={state} />
        </div>
      )}
      </div>

      {flash && (
        <div className={`auction-flash ${flash.status}`}>
          {flash.status === 'sold' && <Confetti />}
          <div className="auction-flash-card">
            <div className="auction-flash-verdict">{flash.status === 'sold' ? 'SOLD' : 'UNSOLD'}</div>
            {flash.status === 'sold' && flash.team_code && <div className="auction-flash-team">→ {flash.team_code}</div>}
            <div className="auction-flash-player">{flash.player_name}</div>
            {flash.status === 'sold' ? <div className="auction-flash-price">{formatRupees(flash.sold_price)}</div> : <div className="auction-flash-price">NOT PURCHASED</div>}
          </div>
        </div>
      )}

      {callout && (
        <div className={`auction-callout ${callout}`}>
          <b>{callout === 'once' ? 'GOING ONCE…' : 'GOING TWICE…'}</b>
        </div>
      )}
    </>
  );
}

function BrowseMode({ players, loading, query, onQueryChange, lastResults }: { players: AuctionPlayer[]; loading: boolean; query: string; onQueryChange: (value: string) => void; lastResults?: AuctionLiveState['results'] }) {
  const filtered = query.trim()
    ? players.filter((player) =>
        `${player.name} ${player.player_type} ${player.location} ${player.gender}`.toLowerCase().includes(query.trim().toLowerCase()),
      )
    : players;

  const sold = (lastResults ?? []).filter((row) => row.status === 'sold');

  return (
    <>
      <section className="auction-head">
        <div className="kicker"><span className="kicker-live"><i /><b>PREP</b></span> DPL 2026 · AUCTION DAY</div>
        <h1>READY FOR<br /><span>AUCTION.</span></h1>
        <p>Every registered player is up for grabs. Study the profile, set your price, bid on auction day.</p>
      </section>
      <div className="auction-toolbar">
        <div className="auction-count">{players.length} PLAYERS IN THE POOL</div>
        <div className="auction-search"><span className="auction-search-icon">🔎</span><input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Search name, role, squad, gender…" /></div>
      </div>
      {loading ? (
        <div className="auction-empty"><div className="auction-empty-badge">⚒</div><h2>LOADING PLAYERS…</h2></div>
      ) : filtered.length ? (
        <div className="auction-carousel-wrap">
          <DepthCarousel
            items={filtered.map((player) => ({ alt: player.name, content: <PlayerCard player={player} /> }))}
            cardWidth={300}
            cardHeight={420}
            radius={18}
            depth={240}
            spread={110}
            tilt={22}
            tiltDirection="right"
            perspective={1400}
            visibleCards={4}
            falloff={0.2}
            blur={6}
            duration={700}
            autoplay
            autoplayDelay={3200}
            loop
            showIndicators={filtered.length <= 8}
          />
        </div>
      ) : (
        <div className="auction-empty">
          <div className="auction-empty-badge">{query.trim() ? '🔍' : '⚒'}</div>
          <h2>{query.trim() ? 'NO MATCHES' : 'NO PLAYERS YET'}</h2>
          <p>{query.trim() ? `Nothing matches "${query.trim()}". Try a different search.` : 'Players registered so far will appear here as soon as they sign up.'}</p>
          {query.trim() ? null : <a className="btn btn-primary" href={withBase("/register")}>🏏 REGISTER AS A PLAYER →</a>}
        </div>
      )}

      {lastResults && lastResults.length > 0 && (
        <section className="auction-results">
          <div className="auction-section-title"><span>LAST</span> AUCTION RESULTS</div>
          <div className="results-strip">
            {lastResults.map((row, index) => (
              <div className={`results-chip ${row.status}`} key={`${row.player_name}-${index}`}>
                <b>{row.status === 'sold' ? `→ ${row.team_code}` : '✕'}</b>
                <span>{row.player_name}</span>
                <em>{row.status === 'sold' ? formatRupees(row.sold_price) : 'UNSOLD'}</em>
              </div>
            ))}
          </div>
          <p className="auction-results-foot">{sold.length} players sold in the last auction.</p>
        </section>
      )}
    </>
  );
}

export default function AuctionPage() {
  const { dark, toggleTheme } = useTheme();
  const [state, setState] = useState<AuctionLiveState | null>(null);
  const [players, setPlayers] = useState<AuctionPlayer[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');

  useEffect(() => {
    void fetchAuctionLiveState().then(setState);
    void fetchAuctionPlayers().then((data) => {
      setPlayers(data);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => {
      void fetchAuctionLiveState().then(setState);
    }, 4000);
    return () => window.clearInterval(id);
  }, []);

  const live = state?.session?.status === 'live';

  return (
    <div className={dark ? `app dark auction-page${live ? ' auction-live' : ''}` : `app auction-page${live ? ' auction-live' : ''}`}>
      {!live && <SiteHeader dark={dark} onToggleTheme={toggleTheme} relative />}
      <main className={live ? 'auction-main auction-live-main' : 'auction-main shell'}>
        {live && state ? (
          <LiveBoard state={state} />
        ) : (
          <BrowseMode players={players} loading={loading} query={query} onQueryChange={setQuery} lastResults={state?.results} />
        )}
      </main>
      {!live && <footer>DPL 2026 · DIGITATE PREMIER LEAGUE · OFFICE CRICKET</footer>}
    </div>
  );
}
