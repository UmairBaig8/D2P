# Project Context

## Live Auction (2026-08-25)

[Root Cause] Auction page was a static showcase (DepthCarousel, hardcoded ₹0 bids) — no data model, no bidding, no budgets, no admin control.

[Surgical Fix] Added 4 NEW tables only (no ALTER on existing tables): `auction_sessions` (name/status/purse/increment — purse lives here, admin-adjustable, `settings` untouched), `auction_results` (per-player lot queue + sale record), `auction_bids` (bid trail), `auction_purses` (per-team budget). Public RPC `auction_live_state()` returns one jsonb board payload; admin RPCs all `is_admin()`-guarded: start/update/end/reset_session, set_base, open, bid, sell (enforces purse + squad 11), unsold, undo. Public page rewrote into LiveBoard (stage, bid panel, purse grid, results chips) polling every 4s + browse mode w/ last-results. Admin control lives at dedicated route `/admin/auction` (AuctionControlRoom.tsx) + topbar Gavel link — NOT an 8th tab. Sold players flow into existing `team_players`.

[Gotchas to Avoid]
- PL/pgSQL `FOR ... IN SELECT` loop requires a declared `record` var — use a single `DELETE ... USING` instead (first apply failed: `42601 loop variable`).
- Supabase default privileges auto-grant EXECUTE to `anon` on new functions even after `REVOKE ... FROM public` → all `admin_auction_*` MUST guard with `is_admin()` internally (they do) to stay safe; advisor WARNs are consistent with existing admin RPCs.
- Admin RPCs can't be smoke-tested via SQL editor (no JWT → `is_admin()` false); test via UI.
- `npx` hangs (network) in this repo — use `./node_modules/.bin/<tool>` directly. tsc/eslint/build only pass when invoked that way.
- Lot queue seeds ONLY unassigned registrations (excludes pre-assigned captains).
- Dev server already ran on :5173 (user's); don't spawn another.

## Auction v2 (timer + single-page board) 2026-08-25
[Root Cause] Public board scrolled (stage+purses+results too tall); admin had 4 right-rail cards (busy); no lot time limit → 145 players would overrun.
[Surgical Fix] Timer: `auction_sessions.lot_timer_seconds` (configurable, min 10) + `auction_results.opens_at`. `admin_auction_open` starts timer; `admin_auction_extend(+N)` adds time; auto-unsold on expiry via `auction_expire_overdue()` called at top of both state RPCs (converted to plpgsql). Public `/auction` now a single `100vh` board: top strip (title/counts/timer), full-bleed player focus (reuses `.player-card-bg` shade overlay), bid panel + trail, bottom purse-chip strip + result ticker; footer hidden when live. Admin: removed BidFeed + PurseTracker cards → purse chips strip + merged recent-bids into LiveMirror; added timer + `+15s/+30s` EXTEND; LiveMirror auto-reloads at 0. start/update_session take `p_timer`.
[Gotchas]
- plpgsql `RETURN (WITH s AS ...)` — a nested subquery referencing CTE `s` MUST list `s` in ITS OWN FROM (`join s on true`); `s.col` in the SELECT list alone throws `42P01 missing FROM-clause`. Applied once (fix_timer_correlation).
- `opens_at` backfilled to `now()` for the pre-timer live lot so countdown starts.
- Timer is server-authoritative (opens_at in DB); client polls 4s and computes countdown from `timer_ends_at`; frontend-only countdown is cosmetic.
- Admin state RPC requires JWT; verified via SQL only for public path; extend/expire tested by inserting past `opens_at` → auto-unsold works.
