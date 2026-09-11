# Project Context (auto post-mortem)

## Admin auction 3-column layout + tiered bids (2026-09-10)
- Root cause: admin stage panel was only ~430px, flat `increment`, no per-team fast-bid; lots slow to run.
- Surgical fix:
  - `src/lib/auction.ts`: added `AuctionIncrementTiers` + `DEFAULT_INCREMENT_TIERS` (100→+10, 200→+20, >200→+50), `incrementFor()`, `bidLadder()`; extended `AuctionSettings` + fetch/save with 5 `auction_inc_*` columns.
  - `src/admin/AuctionControlRoom.tsx`: grid `lg:grid-cols-[minmax(150px,11%)_minmax(0,1fr)_minmax(230px,19%)]` (teams / stage / queue, mobile order stage-first). New `TeamsRail` (per-team BID/SELL), center ladder chips + 5-col team bid grid, compact queue cards. SELL now targets the current leader at floor and no longer confirms (undo covers it). `DEFAULT_INCREMENT` corrected 100000 → 10.
  - Migration `20260910000006_add_auction_increment_tiers.sql` (also applied to remote).
- Gotchas: `admin_auction_bid` only enforces `> floor`; increments are UI-only. Sell requires `currentBid.team_id` (leader) — no manual team sell button. Settings save applies purse/inc/timer to the live session and resyncs pool.

## Female quota rule (2026-09-10)
- Rule: each team must end with >= N female players (default 2, `settings.auction_female_quota`).
- UI: TeamsRail shows `PURSE / MAX BID / Squad x/y / ♀ x/quota` + status `ACTIVE|SQUAD FULL|NO BID|♀ SHORT`. Stage team grid shows `♀x/quota` and blocks bidding on a MALE player when it would leave too few open slots to still sign the needed females. SELL re-checks the leader.
- Enforced client-side only; `admin_auction_sell` does NOT check the quota. Add a DB guard if bypass matters.
- Gotcha: female count derives from `AuctionAdminLot` rows with `status='sold' && gender='Female'` (includes retained). Slot guard = `squadSize - team.squad - 1 >= femaleQuota - females` for male lots.

## Lot queue UX + fastest-finger keys (2026-09-10)
- Queue: single-line `flex-nowrap` tabs (flex-1), one-line cards `#lot Name [base only if != default] …result`, whole card click = open lot directly at default base, tiny pencil = custom-base dialog, tiny undo icon on sold/unsold. Column widened to `minmax(250px,21%)`.
- Stage: `AUTO-NEXT` toggle (default ON) — after SELL/UNSOLD it opens `poolPlayers[0]`. Keyboard (window listener in StagePanel, ignored while typing / dialog open): `Enter` open next (only when no lot on stage), `1-9/0` bid team n at staged amount, `S` sell, `U` unsold, `+/-` extend.
- Gotcha: shortcuts live in `StagePanel`, so they only work while a session is mounted. `Enter` does nothing once a lot is on stage (use auto-next / S / U).

## Timer-end prompt + persisted auto-next (2026-09-10)
- `AUTO-NEXT` toggle now persists in `localStorage` key `dpl.auction.autoNext` (default ON). Click the header button to flip; choice survives reload.
- When `remaining` hits 0 on a live lot, a "TIME'S UP" dialog prompts UNSOLD / +30s / +60s / KEEP OPEN. Fires once per lot via `promptedRef` keyed on `player_id:timer_ends_at`; extending changes the key so it can fire again.
- Inline +15s/+30s no longer disabled at 0 (so you can extend after dismissing the dialog).
- Gotcha: bidding is NOT blocked at 0; admin can still SELL after time-up.

## Hold overdue lots for admin (2026-09-10)
- Root cause: `auction_expire_overdue(v_session)` auto-set `on_auction` lots past `opens_at + lot_timer_seconds` to `unsold`; both `admin_auction_state` and `auction_live_state` called it on every poll, so lots flipped to unsold ~3s after the timer ended, before the admin could answer.
- Fix: migration `20260910000008_hold_overdue_lots_for_admin.sql` (applied) redefines `auction_expire_overdue` as a no-op. Lot now HOLDS at 0 until admin picks UNSOLD / +30s / +60s in the TIME'S UP dialog.
- `admin_auction_extend` bumps `opens_at`, so `timer_ends_at` changes and the prompt re-arms for the new deadline.
- If you ever want auto-unsold back (e.g. unattended board), restore the original UPDATE in `auction_expire_overdue` or gate it behind a session flag.

## Prompt SELL, max-bid awareness, edit/delete results (2026-09-10)
- TIME'S UP dialog now has `SELL ₹x → CODE` (sells to the current leader = latest high bid) above UNSOLD / +30s / +60s.
- Max-bid awareness: stage team buttons disable when the staged amount > team balance (title shows max); ladder chips show a count of eligible teams and disable at 0. `bidWith` still validates server-side budget.
- Edit/delete: migration `20260910000009_admin_edit_delete_results.sql` (applied) adds `admin_auction_edit_result(v_player, v_team, p_price)` (moves team_players, checks budget/squad/base) and `admin_auction_delete_lot(v_player)` (drops bids + team_players + auction_results; blocks retained). Queue rows for sold/unsold show a pencil → MANAGE RESULT dialog: edit team/price, DELETE LOT, or BACK TO POOL.
- Gotcha: edit_result does NOT re-check the female quota when moving teams. Retained rows intentionally have no manage/undo.

## Faster-finger result management (2026-09-10)
- Whole result row (sold/unsold non-retained) is now clickable → opens MANAGE RESULT. Pool rows still click to open the lot. Consistent "click the card" model.
- Action icons enlarged to `size-6` tap targets with border/hover; undo icon = instant back-to-pool (no window.confirm), toasts `<name> → pool`. DELETE LOT keeps its confirm.
- Gotcha: manage/undo still only appear under SOLD/UNSOLD/ALL tabs (queue defaults to POOL).

## Lot queue search (2026-09-10)
- Search box in the queue header filters by name, exact lot #, or team code. A non-empty query spans ALL statuses (ignores the active tab) so any lot is findable. `/` focuses search, `Esc` clears it.
- Gotcha: `/` handler lives in QueuePanel and bails when an input is focused or a dialog is open; StagePanel's global keys also ignore inputs.

## Sold recency sort + hide retained (2026-09-10)
- `admin_auction_state` now includes `updated_at` per player (migration `20260910000010_admin_state_updated_at.sql`, applied); `AuctionAdminLot.updated_at`. Queue SOLD tab sorts by `updated_at` desc (most recent first); other tabs/search stay by lot_order.
- Added a `★ N` toggle in the queue header (`hideRetained`, default ON) that hides `source='retained'` rows and recomputes the tab counts. Active (amber) = retained shown.
- Gotcha: do not name the filtered list `base` inside QueuePanel — `base` is the base-price input state; it's called `visible`.

## Random lot draw with suspense (2026-09-10)
- Next-lot selection is now a lucky dip: `DRAW RANDOM LOT` button (and `Enter`) picks a random pool player, shuffles names for ~1.4s in a fixed overlay, then opens the pick. `pickRandom()` also drives auto-next after SELL/UNSOLD (instant, no overlay, to keep pace).
- Manual in-order pick is still available under a collapsed `OR PICK MANUALLY` `<details>`.
- Gotcha: overlay is a plain fixed div (not Dialog) so it has no close button; keyboard is suppressed while `drawing`. Draw timers tracked in `drawTimers` ref and cleared on unmount.
- Not yet shared with the public board — a session `drawing` flag/broadcast would be needed to show the same reveal to teams.






## Team AVG BUY excludes free leaders (2026-09-10)
- [Root Cause] TeamPage AVG BUY averaged ALL sold `auction.results` for the team, including `source='retained'` free leaders (owner/co_owner/captain seeded at `sold_price=0` by `retention_role_pricing.sql:31`), dragging the average down. Label also claimed "auctioned players" while counting retained lots.
- [Surgical Fix] `src/pages/TeamPage.tsx`: build `freeLeaderKeys` from roster roles (owner/co_owner/captain), filter those names out of `results`; wrapped `results` in `useMemo`. Label now "N paid players".
- [Gotcha] Auction results carry no role field — leader exclusion matches `result.player_name` to roster `players[].role` via `playerKey()`. Kept retained regulars (they pay `retention_price`). If a leader role is changed after results load, memo deps (`players`) handle re-compute.

## App log backup (2026-09-11)
- [Root Cause] User asked for "all app logs from Amplify". D2P is Amplify **static hosting only** (no backend envs, no SSR) → Amplify has **no request/access logs**. All API traffic goes to Supabase project `aoytfsgxzpqzakenerln`.
- [Surgical Fix] Pull Supabase logs via Management API `/v1/projects/{ref}/analytics/endpoints/logs` (`sbp_` token) → `.backup/db-YYYYMMDD/logs/*.ndjson.gz`. Also pull Amplify build/deploy logs: `aws amplify get-job` returns signed `logUrl` (S3, 1h TTL) per BUILD/DEPLOY step → curl immediately. Enumerate jobs with `list-jobs --max-results 50` (max 50; >50 needs pagination).
- [Gotcha] Management API `logs` query needs `iso_timestamp_start/end` (max 24h window) and pages via `limit/offset` ordered by `timestamp,id`. Amplify `get-job` signed URLs expire ~1h. Amplify access-logs feature is OFF (no `/aws/amplify/*` CW group); CloudFront dist disabled; no CloudTrail. Window is UTC — "yesterday IST" needs shift to `T-1 18:30Z .. T 18:30Z`. Summary via `edge_logs` fields: `request.method`, `request.path`, `response.status_code`, `request.cf.*` geo, `request.sb.auth_user`.

## Auction incident forensics 2026-09-10 15:00-19:00 IST (2026-09-11)
- [Root Cause A — celebration stuck] `auction_live_state`/`admin_auction_state` return `results` `ORDER BY lot_order`; `src/pages/AuctionPage.tsx:1211` celebrates `res[res.length-1]` (highest lot_order so far), not the newest sale. Selling out of lot_order order (e.g. session bc893081 sold lots 31→40→87→41→45→24→78) freezes the overlay on the max lot (87 = Deowrat Phatak) for every later sale. Evidence: `.backup/db-20260911/logs/analysis/celebration_bug_evidence.csv` (9 STUCK sales across 5 sessions). Fix = drive FX off newest `updated_at`/sell-RPC row, not array position.
- [Root Cause B — lost pre-break list] `admin_auction_reset_session(v_session)` deletes that session's `auction_results`, `auction_bids`, `auction_purses`, and auction-sold `team_players`, then sets session draft. Called once at 2026-09-10T11:19:10Z (16:49:10 IST) on pre-break session `baa47d27` (created 15:09:46), wiping ~54 in-window sells / 63 opens from 15:39-16:41. Not recoverable (rows deleted) — only API call history remains. `admin_auction_start_session` has NO guard against clobbering a live session (just ends any live + seeds fresh pool), so "resume" always discards in-session progress. RESET button is reachable whenever `status!=='live'` (`AuctionControlRoom.tsx:522`).
- [Gotcha] Each session start re-seeds ALL current `team_players` as `source='retained'` (leaders ₹0, others retention_price), so `auction_results.source='retained'` is NOT a pre-auction flag and `final_source` in reports is misleading — use `source='auction'` rows for real buys (40 total, ₹3,960). Final: 72 sold (32 retained + 40 buys), 79 pool, 1 unsold; pool is inflated by the reset returning pre-break sold players. Analysis outputs: `.backup/db-20260911/logs/analysis/` (`REPORT.md`, `timeline_3to7pm.csv`, `players_status.csv`, `teams_status.csv`).

## Offline-vs-DB reconciliation (2026-09-11)
- [Root Cause] Offline Excel (`DPL_Auction Data/Player_Auction_Manager_v8_Final.xlsx`) is the authoritative final auction result: 150 roster slots (15/team), 130 paid, itemized total ₹13,080. DB has only 72 `team_players` (32 retained + 40 auction buys, ₹3,960) because the 16:49 reset wiped the pre-break session. 78 roster entries missing, 92 players need price/team fixes.
- [Gotcha] 3 offline people are NOT in `registrations`: `Sachin Jadhav` (DDH owner), `Manoj Pathak` (BB owner), `Vaidehi` (DT co_owner). DB's `Sachin` is the separate DD player, not Sachin Jadhav. DB-only regs not in offline: Nitesh Kumar, Rohit Khandekar, mohini khedekar(forfeited). Offline per-team header "Spent" disagrees with itemized player sums for 8 teams (DDH −140, DY −80, GM −60, DT −60, DMM/SM/DD −20, DSK +10) — itemized used.
- [Artifacts] `.backup/db-20260911/logs/analysis/reconcile/`: `FIX_PLAN.md`, `reconciliation.csv`, `missing_from_db_roster.csv`, `diff_team_totals.csv`, `final_roster_proposal.csv`, `fix_from_offline.sql` (DRAFT, not executed). Fix = rebuild `team_players` from offline + update session `3c6ac6bf…` `auction_results` (sold/team/price/source) + reset others to pool; test on a Supabase branch first.

## APPLIED: auction FINAL fix + /auction wrap-up (2026-09-11)
- [Done] Applied migration `fix_auction_final_from_offline` via Supabase MCP. Added 3 regs (Sachin Jadhav/Manoj Pathak/Vaidehi, placeholder emails @dpl.local), created FINAL session `3e2cf487-0248-4c34-a53d-c93013a18991` name `DPL 2026 AUCTION (FINAL)` status `ended`, seeded `auction_purses` (1500×10), wrote 155 `auction_results` (152 sold + 3 pool), rebuilt `team_players` (152). Verified: per-team squad/spent = offline (BB 15/1490, CW 16/1140, DD 15/1270, DDH 15/1490, DMM 15/1180, DSK 15/1440, DT 16/1290, DY 15/1090, GM 15/1200, SM 15/1490; total ₹13,080). FINAL is latest session (no live) → `auction_live_state` picks it.
- [Gotcha] `registrations` CHECK constraints: `bowling_arm` ∈ {`Right arm`,`Left arm`,`Not applicable`} (NOT `Right`), `bowling_style` ∈ {`Right-arm pace`,`Left-arm pace`,`Right-arm spin`,`Left-arm spin`,`Do not bowl`}, `location` ∈ {CZ,SP,Mumbai,Other}, `gender` ∈ {Male,Female}. Migration is atomic (first failed on bowling_arm, rolled back cleanly).
- [Code] `/auction` ended-state now renders `src/components/AuctionWrapUp.tsx` (new) from `AuctionPage.tsx` `!live` branch when `session.status==='ended'` and there are auction sales: top-5 most expensive buys, team spend leaderboard, totals, thank-you + funny quips. `tsc -b` + eslint clean. NOT committed/deployed.
- [Gotcha] `npm run lint` (`eslint .`) and `npx tsc -b` can appear to hang >3min in this repo; run `node_modules/.bin/tsc -b` / `node_modules/.bin/eslint <files>` directly. Do not keep the Vite dev server blocking build checks.
- [Gotcha] `.la-main` (live auction layout) has `flex:1;min-height:0;overflow:hidden` → content taller than the viewport is clipped with no scroll. The `/auction` wrap-up adds `la-main--wrap` (`overflow:visible;height:auto;width:min(1800px,calc(100% - 24px))`) and `AuctionPage` drops the `shell` class when `showWrapUp`, so the page uses full width and can grow/scroll. The root `.auction-page.live-auction` still had `height:100dvh;overflow:hidden`; `AuctionPage` now also adds `is-wrapped` and `.auction-page.live-auction.is-wrapped{height:auto;min-height:100vh;overflow:visible}` unlocks real page scroll (verified: `scrollHeight > innerHeight`). Live board stays single-viewport.
- [Design] `/auction` ended-state redesigned as a modern broadcast "wrap show": hero (gradient + `Particles` + `ShinyBadge` + SOLD marquee reusing `.la-ticker-track`), 4 `NumberTicker` stat tiles with accent top-borders, bento grid of top-5 buys / team leaderboard (per-team accent colors) / funny "Auction Awards" (Deepest Pockets, Biggest Splash, Bargain Bin Boss, Frugal Flex, Full House, Chai Budget Heroes) / thank-you. App tokens: Barlow Condensed italic display, Inter body, neon `--cyan/#09c9d8 --blue/#2867ff --purple/#873cff --pink/#ed3aa8 --orange/#ff7b1a --green/#16c79a`, glass cards. Tiles use dark glass `bg-[#0b1220]/75` because the bright stadium bg kills contrast on `white/5`.

## Team-wise squad PDF export (2026-09-11)
- [Feature] `scripts/export-team-squads.py` (stdlib + `pillow` + `segno`): pulls live Supabase RPCs (`auction_live_state`, `team_roster`, `players_list`, `settings`) → base64 HTML → headless Chrome → `exports/DPL-2026-Team-Squads.pdf`. 12 pages A4 portrait: cover + contents/top-10 + 10 team pages. Includes player photos, self-rating, vet/rookie, location, type dots, squad mix + female count, leader photos, base-vs-sold value badges (base from `settings.auction_default_base`=20), per-team QR to `https://umairbaig8.github.io/D2P/teams/{code}`.
- [Root Cause] `DPL_Auction Data/DPL26 - Pune.xlsx` is a stale snapshot (DSK 1450 vs actual 1440; CW/DT 15 vs 16). Always use the live `DPL 2026 AUCTION (FINAL)` session (`3e2cf487…`), not the workbook.
- [Gotcha] Chrome print uses `@page size:A4 portrait; margin:0`; each `.page` is `210×297mm; overflow:hidden`. Adding avatars/badges/footer QR overflows row height → clipped (no extra PDF page because of `overflow:hidden`). Verify with a headless `--dump-dom` layout probe measuring `.squad`/`.page` `scrollHeight-clientHeight`; decorative `.cv-glow` legitimately reports pageOverflow.
- [Gotcha] Public deploy is GitHub Pages at `/D2P/` (repo remote `UmairBaig8/Cric` but site root `umairbaig8.github.io/D2P/`). Deep links return HTTP 404 but serve `404.html` (SPA shell) → render fine in-browser. Don't add a custom domain guess.
- [Gotcha] segno `svg_inline()` output has NO `viewBox` -- forcing `width:100%` in CSS clips the QR to the top-left corner (looks like a partial/unscannable code). Inject `viewBox="0 0 N N"` (+ `preserveAspectRatio`, `shape-rendering="crispEdges"`) into the `<svg>` tag. Verify by rendering the PDF page at 200 DPI and decoding with `cv2.QRCodeDetector().detectAndDecode()`.

## /auction wrap-up: light theme + logos + table redesign (2026-09-11)
- [Root Cause] `AuctionWrapUp.tsx` was hardcoded dark (`bg-[#0b1220]/75`, `text-white/*`) so it stayed dark on the light page; it also had a SOLD marquee and showed team codes with no crests, and the two leaderboard tiles left dead vertical space.
- [Surgical Fix] `AuctionWrapUp.tsx`: dropped the hero marquee; added `teamLogo()` (prefers `icon_url`, falls back to `THEME_LOGO[theme]`, note `kings→dsk.png`); replaced hardcoded colors with `--wrap-*` vars; rebuilt both tables as full-width `.la-wrow` leaderboards (rank · avatar/logo · name+team · progress bar · value), buys now top-8 to match 10 teams. `styles.css`: `.la-wrap`/`.dark .la-wrap` var sets + `.la-wtable/.la-wrow/.la-wrank/.la-wav/.la-wlogo/.la-wname/.la-wbar/.la-wval` (+ `max-width:640px` collapse hides bars).
- [Gotcha] Theme switch is a `.dark` class on the `.auction-page` root (`@custom-variant dark (&:is(.dark *))`); use `dark:` variants or `.dark .x` overrides. Verify themes headlessly by serving a same-origin `public/__themedark.html` that sets `localStorage['dpl-theme']='dark'` then redirects to `/D2P/auction` (delete it after).
