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





