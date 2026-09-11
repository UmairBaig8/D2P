#!/usr/bin/env python3
"""Export DPL 2026 team-wise squad sheets (1 page per team) to a portrait PDF.

Data source: the live Supabase project (anon key, public RPCs) -- canonical for the
"DPL 2026 AUCTION (FINAL)" session:
    - rpc/auction_live_state  -> teams + sold results (price, source, type, photo)
    - rpc/team_roster         -> per-player role (owner / captain / retained / player)
    - rpc/players_list        -> player profile (self_rating, gender, dpl_played, ...)
    - /rest/v1/teams          -> team order + champion flag
    - /rest/v1/settings       -> base price + purse

Pipeline: live data + player photos + QR codes -> single HTML -> headless Chrome
        -> exports/DPL-2026-Team-Squads.pdf  (cover + summary + 10 team pages)

Usage:
    python3 scripts/export-team-squads.py
"""

from __future__ import annotations

import base64
import html
import io
import json
import re
import subprocess
import sys
import urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EXPORTS = ROOT / "exports"
PHOTO_CACHE = Path("/tmp/dpl-player-avatars")
OUT_PDF = EXPORTS / "DPL-2026-Team-Squads.pdf"
OUT_HTML = Path("/tmp/dpl-team-squads.html")
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
SITE_BASE = "https://umairbaig8.github.io/D2P"  # team page -> {SITE_BASE}/teams/{code}

# code -> visual assets + accent (mirrors src/styles.css team themes).
META = {
    "DSK": dict(accent="#ffc22e", logo="public/teams/dsk.png",
                banner="public/team-headers/digi-super-kings.png"),
    "SM": dict(accent="#ff6b24", logo="public/teams/mavale.png",
               banner="public/team-headers/sahyadriche-mavale.png"),
    "DMM": dict(accent="#35e783", logo="public/teams/mitra.png",
                banner="public/team-headers/digi-mitra-mandal.png"),
    "BB": dict(accent="#ff9d1c", logo="public/teams/blaster.png",
               banner="public/team-headers/bhakarwadi-blasters.png"),
    "DD": dict(accent="#28a9ff", logo="public/teams/dhada.png",
               banner="public/team-headers/digi-dhadakebaaz.png"),
    "CW": dict(accent="#a4ef31", logo="public/teams/wala.png",
               banner="public/team-headers/cricket-wala.png"),
    "DT": dict(accent="#48aaff", logo="public/teams/titans.png",
               banner="public/team-headers/digi-titans.png"),
    "DY": dict(accent="#ff7c27", logo="public/teams/yodhas.png",
               banner="public/team-headers/digi-yodhas.png"),
    "GM": dict(accent="#d9ff24", logo="public/teams/gallit.png",
               banner="public/team-headers/gallit-maramari.png"),
    "DDH": dict(accent="#e9b94d", logo="public/teams/dhurandhars.png",
                banner="public/team-headers/digi-dhurandhars.png"),
}

ROLE_ORDER = {"owner": 0, "co_owner": 1, "captain": 2, "vice_captain": 3, "retained": 4, "player": 5}
ROLE_LABEL = {"owner": "OWNER", "co_owner": "CO-OWNER", "captain": "CAPTAIN",
              "vice_captain": "VICE CAPTAIN", "retained": "RETAINED", "player": "PLAYER"}
LEADER_ROLES = ("owner", "co_owner", "captain")
TYPE_COLOR = {"Batter": "#f6a821", "Bowler": "#f2555a", "All-rounder": "#3ddc84",
              "Wicketkeeper-batter": "#4cc3ff"}


def env() -> tuple[str, str]:
    values = {}
    for line in (ROOT / ".env.local").read_text().splitlines():
        if "=" in line and not line.strip().startswith("#"):
            key, _, value = line.partition("=")
            values[key.strip()] = value.strip()
    return values["VITE_SUPABASE_URL"], values["VITE_SUPABASE_ANON_KEY"]


def rest(url: str, key: str, path: str, body: dict | None = None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url + path, data=data, method="POST" if body is not None else "GET")
    req.add_header("apikey", key)
    req.add_header("Authorization", f"Bearer {key}")
    req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=30) as response:
        return json.load(response)


def data_uri(rel: str) -> str:
    return "data:image/png;base64," + base64.b64encode((ROOT / rel).read_bytes()).decode("ascii")


def esc(value: str) -> str:
    return html.escape(value, quote=True)


def initials(name: str) -> str:
    parts = [p for p in re.split(r"\s+", name.strip()) if p]
    return "".join(p[0] for p in parts[:2]).upper() or "?"


def avatar_data_uri(photo_url: str | None, name: str) -> str | None:
    """Download + square-crop + downscale a player photo; returns a small JPEG data URI."""
    if not photo_url:
        return None
    PHOTO_CACHE.mkdir(parents=True, exist_ok=True)
    cache = PHOTO_CACHE / re.sub(r"[^A-Za-z0-9._-]", "_", photo_url.rsplit("/", 1)[-1])
    if not cache.exists():
        try:
            req = urllib.request.Request(photo_url, headers={"User-Agent": "dpl-export"})
            with urllib.request.urlopen(req, timeout=30) as response:
                cache.write_bytes(response.read())
        except Exception as exc:  # noqa: BLE001 - missing photo must not fail the export
            print(f"  ! photo {name}: {exc}", file=sys.stderr)
            return None
    try:
        from PIL import Image  # lazy: only needed for photos
        img = Image.open(cache).convert("RGB")
        side = min(img.size)
        left = (img.width - side) // 2
        top = (img.height - side) // 2
        img = img.crop((left, top, left + side, top + side)).resize((96, 96), Image.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=82, optimize=True)
        return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode("ascii")
    except ImportError:
        print("  ! Pillow not installed -- run: pip install pillow", file=sys.stderr)
        return None


def qr_svg(url: str) -> str:
    """Inline QR SVG. segno emits width/height but no viewBox, so add one -- otherwise
    a CSS `width:100%` clips the modules to the top-left corner (unscannable)."""
    import segno
    svg = segno.make(url, error="m").svg_inline(scale=4, border=1)
    match = re.search(r'width="(\d+)" height="(\d+)"', svg)
    if match:
        svg = svg.replace(
            match.group(0),
            f'viewBox="0 0 {match.group(1)} {match.group(2)}" preserveAspectRatio="xMidYMid meet" shape-rendering="crispEdges"',
            1)
    return svg


def face(photo: str | None, name: str, css: str) -> str:
    if photo:
        return f'<img class="{css}" src="{photo}" alt="">'
    return f'<span class="{css} face-init">{esc(initials(name))}</span>'


def fetch_state(url: str, key: str) -> dict:
    live = rest(url, key, "/rest/v1/rpc/auction_live_state", {})
    teams = rest(url, key, "/rest/v1/teams?select=code,name,champion,sort_order")
    rosters = {t["code"]: rest(url, key, "/rest/v1/rpc/team_roster", {"team_code": t["code"]}) for t in teams}
    profiles = rest(url, key, "/rest/v1/rpc/players_list", {})
    settings = rest(url, key, "/rest/v1/settings?select=auction_default_base,auction_purse")
    return {"live": live, "teams": teams, "rosters": rosters, "profiles": profiles, "settings": settings[0]}


def squad_for(code: str, state: dict) -> list[dict]:
    role_by_name = {p["name"].strip().lower(): p["role"] for p in state["rosters"].get(code, [])}
    profile_by_name = {p["name"].strip().lower(): p for p in state["profiles"]}
    squad = []
    for result in state["live"]["results"]:
        if result["status"] != "sold" or result["team_code"] != code:
            continue
        name = result["player_name"].strip()
        key = name.lower()
        profile = profile_by_name.get(key, {})
        squad.append({
            "name": name,
            "role": role_by_name.get(key, "player"),
            "price": int(result["sold_price"] or 0),
            "type": result.get("player_type") or profile.get("player_type") or "Player",
            "rating": profile.get("self_rating"),
            "gender": profile.get("gender"),
            "location": profile.get("location"),
            "vet": bool(profile.get("dpl_played")),
            "photo": avatar_data_uri(result.get("photo_url") or profile.get("photo_url"), name),
        })
    squad.sort(key=lambda p: (ROLE_ORDER.get(p["role"], 9), -p["price"], p["name"].lower()))
    return squad


def value_badge(price: int, base: int) -> str:
    if price <= 0:
        return ""
    delta = price - base
    if delta > 0:
        return f'<span class="delta up">+₹{delta:,}</span>'
    if delta < 0:
        return f'<span class="delta down">−₹{abs(delta):,}</span>'
    return '<span class="delta even">BASE</span>'


def team_page(team: dict, squad: list[dict], base: int, purse: int, index: int, total: int) -> str:
    meta = META.get(team["code"], {})
    accent = meta.get("accent", "#7dd3fc")
    leaders = {p["role"]: p for p in squad if p["role"] in LEADER_ROLES}
    paid = [p for p in squad if p["role"] not in ("owner", "co_owner", "captain", "retained") or p["price"] > 0]
    spent = sum(p["price"] for p in squad)
    top = max(squad, key=lambda p: p["price"], default={"name": "—", "price": 0})
    left = max(0, purse - spent)
    qr = qr_svg(f"{SITE_BASE}/teams/{team['code']}")

    rows = []
    for slot, player in enumerate(squad, start=1):
        free = player["price"] == 0
        price = '<span class="price free">—</span>' if free else f'<span class="price">₹{player["price"]:,}</span>'
        badge = value_badge(player["price"], base)
        bits = [f'<i class="dot" style="background:{TYPE_COLOR.get(player["type"], "#8ea0b6")}"></i>{esc(player["type"])}']
        if player["rating"] is not None:
            bits.append(f'<span class="star">★ {player["rating"]}</span>')
        if player["location"]:
            bits.append(esc(player["location"]))
        bits.append('<span class="vet">DPL VET</span>' if player["vet"] else '<span class="rookie">ROOKIE</span>')
        rows.append(
            f'<tr class="{"lead" if player["role"] != "player" else ""}">'
            f'<td class="slot">{slot:02d}</td>'
            f'<td class="pcell">{face(player["photo"], player["name"], "face")}<span class="pinfo"><b>{esc(player["name"])}</b>'
            f'<small>{" · ".join(bits)}</small></span></td>'
            f'<td class="prole"><span class="tag {player["role"]}">{ROLE_LABEL.get(player["role"], "PLAYER")}</span></td>'
            f'<td class="pprice">{price}{badge}</td>'
            f'</tr>'
        )

    def count_of(label: str) -> int:
        return sum(1 for p in squad if p["type"] == label)

    females = sum(1 for p in squad if p["gender"] == "Female")
    mix = "".join(
        f'<span class="chip"><i style="background:{TYPE_COLOR[label]}"></i>{count_of(label)} {label.replace("Wicketkeeper-batter", "WK")}</span>'
        for label in ("Batter", "Bowler", "All-rounder", "Wicketkeeper-batter") if count_of(label)
    )
    champion = '<span class="champ">★ DEFENDING CHAMPIONS</span>' if team.get("champion") else ""

    leader_html = ""
    for role in LEADER_ROLES:
        leader = leaders.get(role)
        if not leader:
            continue
        leader_html += (
            f'<div class="leader">{face(leader["photo"], leader["name"], "lface")}'
            f'<div class="lt"><span>{ROLE_LABEL[role]}</span><b>{esc(leader["name"])}</b></div></div>'
        )

    return f"""
    <section class="page" style="--accent:{accent}">
      <header class="hero">
        <img class="banner" src="{data_uri(meta['banner'])}" alt="">
        <div class="scrim"></div>
        <div class="hero-top">
          <span class="brand">DPL 2026 · DIGITATE PREMIER LEAGUE</span>
          <span class="pageno">{index:02d} / {total:02d}</span>
        </div>
        <div class="hero-main">
          <div class="logo"><img src="{data_uri(meta['logo'])}" alt=""></div>
          <div class="title">
            <span class="code">{team['code']} · TEAM {index:02d}</span>
            <h1>{esc(team['name'])}</h1>
            {champion}
          </div>
          <div class="leaders">{leader_html}</div>
        </div>
      </header>

      <div class="stats">
        <div class="stat"><span>SQUAD</span><b>{len(squad)}</b><small>{len(paid)} bought · {len(squad) - len(paid)} free</small></div>
        <div class="stat"><span>SPENT</span><b>₹{spent:,}</b><small>of ₹{purse:,} purse</small></div>
        <div class="stat"><span>PURSE LEFT</span><b>₹{left:,}</b><small>{round(spent / purse * 100)}% committed</small></div>
        <div class="stat"><span>TOP BUY</span><b>₹{top['price']:,}</b><small>{esc(top['name'])}</small></div>
      </div>

      <div class="squad">
        <div class="squad-head">
          <span class="eyebrow">THE SQUAD</span>
          <div class="mix">{mix}<span class="chip"><i style="background:#ff7ab6"></i>{females} ♀</span></div>
        </div>
        <table>
          <thead>
            <tr><th>#</th><th>PLAYER</th><th>ROLE</th><th class="r">PRICE · vs ₹{base} BASE</th></tr>
          </thead>
          <tbody>{''.join(rows)}</tbody>
        </table>
      </div>

      <footer>
        <div class="fcol"><span>D2P · DPL 2026 · OFFICE CRICKET</span>
          <span>GENERATED {date.today().isoformat()}</span></div>
        <div class="fqr"><span class="qrchip">{qr}</span><span class="qrlabel">SCAN · LIVE SQUAD</span></div>
        <span class="fteam">{esc(team['name'])} · {team['code']}</span>
      </footer>
    </section>
    """


def cover_page(teams: list[dict], squads: dict[str, list[dict]], total_spent: int, total_players: int) -> str:
    logos = "".join(
        f'<span class="cv-logo" style="--accent:{META.get(t["code"], {}).get("accent", "#7dd3fc")}">'
        f'<img src="{data_uri(META[t["code"]]["logo"])}" alt=""></span>' for t in teams)
    top = max((p for s in squads.values() for p in s), key=lambda p: p["price"], default={"price": 0})
    return f"""
    <section class="page cover">
      <div class="cv-glow g1"></div><div class="cv-glow g2"></div>
      <div class="cv-inner">
        <span class="cv-eyebrow">DIGITATE PREMIER LEAGUE · DPL 2026</span>
        <h1 class="cv-title">TEAM<br><em>SQUADS</em></h1>
        <p class="cv-sub">The official post-auction squad sheet · {len(teams)} teams · every buy, every price.</p>
        <div class="cv-logos">{logos}</div>
        <div class="cv-stats">
          <div><span>TEAMS</span><b>{len(teams)}</b></div>
          <div><span>PLAYERS</span><b>{total_players}</b></div>
          <div><span>TOTAL SPENT</span><b>₹{total_spent:,}</b></div>
          <div><span>TOP BUY</span><b>₹{top['price']:,}</b></div>
        </div>
        <span class="cv-foot">AUCTION CLOSED · GENERATED {date.today().strftime('%d %b %Y').upper()}</span>
      </div>
    </section>
    """


def summary_page(teams: list[dict], squads: dict[str, list[dict]], purse: int, total_spent: int) -> str:
    rows = ""
    for i, team in enumerate(teams, start=1):
        squad = squads[team["code"]]
        spent = sum(p["price"] for p in squad)
        top = max(squad, key=lambda p: p["price"], default={"price": 0, "name": "—"})
        accent = META.get(team["code"], {}).get("accent", "#7dd3fc")
        rows += (
            f'<div class="ct-row" style="--accent:{accent}">'
            f'<span class="ct-num">{i:02d}</span>'
            f'<img class="ct-logo" src="{data_uri(META[team["code"]]["logo"])}" alt="">'
            f'<span class="ct-name"><b>{esc(team["name"])}</b><small>{team["code"]} · {len(squad)} players · top {esc(top["name"])}</small></span>'
            f'<span class="ct-spent"><b>₹{spent:,}</b><small>{round(spent / purse * 100)}% of ₹{purse:,}</small></span>'
            f'</div>'
        )

    buys = sorted((p for s in squads.values() for p in s if p["price"] > 0),
                  key=lambda p: p["price"], reverse=True)[:10]
    board = ""
    for i, p in enumerate(buys, start=1):
        board += (
            f'<li><span class="tb-rank">{i}</span>'
            f'{face(p["photo"], p["name"], "tb-face")}'
            f'<span class="tb-name"><b>{esc(p["name"])}</b><small>{p["team_code"]}</small></span>'
            f'<span class="tb-price">₹{p["price"]:,}</span></li>'
        )

    return f"""
    <section class="page summary">
      <div class="sm-head">
        <div><span class="eyebrow">DPL 2026 · AUCTION WRAP</span><h2>CONTENTS &amp; TOP BUYS</h2></div>
        <span class="sm-total">₹{total_spent:,} SPENT</span>
      </div>
      <div class="sm-body">
        <div class="sm-col">
          <h3>THE 10 TEAMS</h3>
          <div class="ct-list">{rows}</div>
        </div>
        <div class="sm-col">
          <h3>TOP 10 BUYS</h3>
          <ol class="tb-list">{board}</ol>
        </div>
      </div>
      <footer><span>D2P · DPL 2026 · OFFICE CRICKET</span><span>CONTENTS</span><span>PAGE 02 / 12</span></footer>
    </section>
    """


CSS = """
@page { size: A4 portrait; margin: 0; }
* { margin: 0; padding: 0; box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
html, body { background: #05070d; }
body { font-family: "Helvetica Neue", Arial, sans-serif; color: #eaf0f7; }
.page { position: relative; width: 210mm; height: 297mm; overflow: hidden; page-break-after: always;
  background: linear-gradient(180deg,#0a0f1c 0%,#070a13 100%); display: flex; flex-direction: column; }
.page:last-child { page-break-after: auto; }

/* ---------- cover ---------- */
.cover { justify-content: center; background: radial-gradient(120% 80% at 50% -10%, #14213d 0%, #0a0f1c 55%, #05070d 100%); }
.cv-glow { position: absolute; border-radius: 50%; filter: blur(60px); opacity: .5; }
.cv-glow.g1 { width: 120mm; height: 120mm; left: -30mm; top: -20mm; background: radial-gradient(circle,#ff9d1c66,transparent 65%); }
.cv-glow.g2 { width: 130mm; height: 130mm; right: -35mm; bottom: -30mm; background: radial-gradient(circle,#3ddc8455,transparent 65%); }
.cv-inner { position: relative; padding: 0 16mm; text-align: center; display: flex; flex-direction: column; align-items: center; }
.cv-eyebrow { font-size: 9px; font-weight: 900; letter-spacing: 4px; color: #8ea0b6; text-transform: uppercase; }
.cv-title { margin: 5mm 0 3mm; font-size: 58px; font-weight: 900; line-height: .84; letter-spacing: -1px; text-transform: uppercase; color: #fff; }
.cv-title em { font-style: normal; color: #ffd76a; }
.cv-sub { max-width: 120mm; font-size: 11px; font-weight: 600; line-height: 1.5; color: #9fb0c4; }
.cv-logos { display: flex; flex-wrap: wrap; justify-content: center; gap: 3mm; margin: 7mm 0; }
.cv-logo { width: 18mm; height: 18mm; border-radius: 50%; padding: 1.4mm; background: rgba(255,255,255,.05);
  border: 1.5px solid var(--accent); box-shadow: 0 6px 18px rgba(0,0,0,.5); }
.cv-logo img { width: 100%; height: 100%; object-fit: contain; }
.cv-stats { display: grid; grid-template-columns: repeat(4,1fr); gap: 4mm; width: 100%; margin-top: 2mm; }
.cv-stats div { background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.1); border-radius: 3mm; padding: 3.2mm 3mm; }
.cv-stats span { display: block; font-size: 7.5px; font-weight: 900; letter-spacing: 2px; color: #8ea0b6; }
.cv-stats b { display: block; margin-top: 1.2mm; font-size: 20px; font-weight: 900; color: #fff; }
.cv-foot { margin-top: 7mm; font-size: 8px; font-weight: 900; letter-spacing: 3px; color: #55647a; text-transform: uppercase; }

/* ---------- summary ---------- */
.summary { padding: 14mm 10mm 0; }
.sm-head { display: flex; justify-content: space-between; align-items: flex-end; padding-bottom: 4mm; border-bottom: 2px solid rgba(255,255,255,.12); }
.sm-head .eyebrow { font-size: 9px; font-weight: 900; letter-spacing: 3px; color: #ffd76a; text-transform: uppercase; }
.sm-head h2 { margin-top: 1.5mm; font-size: 30px; font-weight: 900; letter-spacing: -.5px; text-transform: uppercase; }
.sm-total { font-size: 16px; font-weight: 900; color: #fff; background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.12); border-radius: 3mm; padding: 2.5mm 4mm; }
.sm-body { flex: 1 1 auto; min-height: 0; display: grid; grid-template-columns: 1.25fr 1fr; gap: 8mm; padding-top: 6mm; }
.sm-col h3 { font-size: 9px; font-weight: 900; letter-spacing: 2.4px; color: #8ea0b6; text-transform: uppercase; margin-bottom: 3mm; }
.ct-list { display: flex; flex-direction: column; gap: 2mm; }
.ct-row { display: flex; align-items: center; gap: 3mm; background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.08);
  border-left: 2.5px solid var(--accent); border-radius: 2.5mm; padding: 2.2mm 3mm; }
.ct-num { font-size: 10px; font-weight: 900; color: #55647a; width: 6mm; }
.ct-logo { width: 9mm; height: 9mm; object-fit: contain; }
.ct-name { flex: 1 1 auto; min-width: 0; }
.ct-name b { display: block; font-size: 11px; font-weight: 800; color: #f2f6fb; }
.ct-name small { display: block; font-size: 7px; font-weight: 700; color: #8ea0b6; text-transform: uppercase; letter-spacing: .3px; }
.ct-spent { text-align: right; }
.ct-spent b { display: block; font-size: 13px; font-weight: 900; color: #fff; }
.ct-spent small { font-size: 7px; font-weight: 700; color: #7f8fa4; }
.tb-list { list-style: none; display: flex; flex-direction: column; gap: 1.8mm; }
.tb-list li { display: flex; align-items: center; gap: 2.6mm; background: rgba(255,255,255,.04);
  border: 1px solid rgba(255,255,255,.08); border-radius: 2.5mm; padding: 1.8mm 3mm; }
.tb-rank { width: 6mm; font-size: 11px; font-weight: 900; color: #ffd76a; }
.tb-face { width: 7mm; height: 7mm; border-radius: 50%; object-fit: cover; border: 1.5px solid rgba(255,255,255,.2); }
.tb-name { flex: 1 1 auto; min-width: 0; }
.tb-name b { display: block; font-size: 10.5px; font-weight: 800; color: #f2f6fb; }
.tb-name small { font-size: 7px; font-weight: 800; color: #8ea0b6; letter-spacing: 1px; }
.tb-price { font-size: 12px; font-weight: 900; color: #fff; }

/* ---------- team ---------- */
.hero { position: relative; height: 80mm; flex: 0 0 auto; }
.hero .banner { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.hero .scrim { position: absolute; inset: 0;
  background: linear-gradient(180deg, rgba(5,7,13,.15) 0%, rgba(5,7,13,.35) 45%, rgba(5,7,13,.94) 100%),
              linear-gradient(90deg, rgba(5,7,13,.78) 0%, rgba(5,7,13,.15) 55%, rgba(5,7,13,.55) 100%); }
.hero-top { position: absolute; top: 7mm; left: 10mm; right: 10mm; display: flex; justify-content: space-between;
  font-size: 8.5px; font-weight: 800; letter-spacing: 2.6px; text-transform: uppercase; color: rgba(255,255,255,.82); }
.hero-top .pageno { color: var(--accent); }
.hero-main { position: absolute; left: 10mm; right: 10mm; bottom: 5mm; display: flex; align-items: flex-end; gap: 5mm; }
.logo { flex: 0 0 auto; width: 28mm; height: 35mm; border-radius: 3mm; overflow: hidden; padding: 1.4mm;
  background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.18); box-shadow: 0 8px 22px rgba(0,0,0,.55); }
.logo img { width: 100%; height: 100%; object-fit: contain; }
.title { flex: 1 1 auto; min-width: 0; padding-bottom: 1mm; }
.title .code { display: inline-block; font-size: 9px; font-weight: 900; letter-spacing: 2.4px; color: #06101f;
  background: var(--accent); padding: 2px 8px; border-radius: 3px; }
.title h1 { margin-top: 2.5mm; font-size: 31px; font-weight: 900; line-height: .95; letter-spacing: -.5px;
  text-transform: uppercase; text-shadow: 0 3px 16px rgba(0,0,0,.6); }
.champ { display: inline-block; margin-top: 1.5mm; font-size: 8.5px; font-weight: 900; letter-spacing: 2px; color: #ffd76a; }
.leaders { flex: 0 0 auto; display: flex; flex-direction: column; gap: 1.8mm; padding-bottom: 1mm; }
.leader { display: flex; align-items: center; justify-content: flex-end; gap: 2.4mm; }
.lface { width: 7.4mm; height: 7.4mm; border-radius: 50%; object-fit: cover; border: 1.5px solid var(--accent); background: rgba(255,255,255,.1); }
.lt { text-align: right; }
.lt span { display: block; font-size: 7px; font-weight: 900; letter-spacing: 1.8px; color: var(--accent); }
.lt b { display: block; font-size: 11.5px; font-weight: 800; color: #fff; max-width: 52mm; }

.stats { flex: 0 0 auto; display: grid; grid-template-columns: repeat(4,1fr); gap: 3mm; padding: 4.5mm 10mm 0; }
.stat { background: rgba(255,255,255,.045); border: 1px solid rgba(255,255,255,.09); border-radius: 3mm;
  padding: 2.8mm 3.4mm; border-top: 2px solid var(--accent); }
.stat span { display: block; font-size: 7.5px; font-weight: 900; letter-spacing: 1.8px; color: #8ea0b6; }
.stat b { display: block; margin: 1mm 0 .4mm; font-size: 17px; font-weight: 900; color: #fff; }
.stat small { display: block; font-size: 7.5px; font-weight: 700; letter-spacing: .3px; color: #7f8fa4; text-transform: uppercase; }

.squad { flex: 1 1 auto; padding: 4mm 10mm 0; min-height: 0; display: flex; flex-direction: column; }
.squad-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 2mm; }
.eyebrow { font-size: 10px; font-weight: 900; letter-spacing: 3px; color: #fff; text-transform: uppercase; }
.mix { display: flex; gap: 1.6mm; flex-wrap: wrap; justify-content: flex-end; }
.chip { display: inline-flex; align-items: center; gap: 1.2mm; font-size: 7.5px; font-weight: 900; letter-spacing: .6px;
  color: #b9c6d6; background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.09);
  padding: 1mm 2mm; border-radius: 2mm; text-transform: uppercase; }
.chip i { width: 4px; height: 4px; border-radius: 50%; display: inline-block; }
table { width: 100%; border-collapse: collapse; }
thead th { text-align: left; font-size: 7.5px; font-weight: 900; letter-spacing: 1.6px; color: #8ea0b6;
  padding: 0 3mm 1.4mm; border-bottom: 1.5px solid var(--accent); }
thead th.r { text-align: right; }
tbody tr { border-bottom: 1px solid rgba(255,255,255,.07); }
tbody tr.lead { background: rgba(255,255,255,.035); }
td { padding: 1mm 3mm; vertical-align: middle; }
td.slot { width: 8mm; font-size: 9.5px; font-weight: 900; color: #55647a; }
td.pcell { display: flex; align-items: center; gap: 2.4mm; }
.face { flex: 0 0 auto; width: 7mm; height: 7mm; border-radius: 50%; object-fit: cover;
  border: 1.5px solid rgba(255,255,255,.22); background: rgba(255,255,255,.08); }
.face-init { display: inline-flex; align-items: center; justify-content: center; font-size: 8px; font-weight: 900; color: #cfd9e6; }
.pinfo { display: flex; flex-direction: column; min-width: 0; }
.pinfo b { font-size: 11.5px; font-weight: 800; color: #f2f6fb; line-height: 1.08; }
.pinfo small { display: flex; align-items: center; gap: 1.4mm; margin-top: .3mm; font-size: 7.5px;
  font-weight: 700; color: #8ea0b6; text-transform: uppercase; letter-spacing: .4px; }
.pinfo .dot { width: 4px; height: 4px; border-radius: 50%; display: inline-block; }
.pinfo .star { color: #ffd76a; }
.pinfo .vet { color: #7ee0a4; }
.pinfo .rookie { color: #7f8fa4; }
td.prole { width: 25mm; }
td.pprice { width: 22mm; text-align: right; }
.price { font-size: 12px; font-weight: 900; color: #fff; }
.price.free { color: #55647a; }
.delta { display: block; margin-top: .3mm; font-size: 7.5px; font-weight: 900; letter-spacing: .4px; }
.delta.up { color: #ff8f6b; }
.delta.down { color: #5fe08a; }
.delta.even { color: #7f8fa4; }
.tag { display: inline-block; font-size: 7.5px; font-weight: 900; letter-spacing: 1.2px; padding: 1.1mm 2.2mm;
  border-radius: 2mm; color: #06101f; background: rgba(255,255,255,.16); }
.tag.owner { background: var(--accent); }
.tag.captain { background: #ffffff; }
.tag.co_owner { background: #b8e8ff; }
.tag.player, .tag.retained { background: rgba(255,255,255,.14); color: #c9d4e2; }

footer { flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between; gap: 4mm;
  padding: 3.5mm 10mm 4mm; font-size: 7.5px; font-weight: 800; letter-spacing: 1.4px; color: #55647a; text-transform: uppercase; }
.fcol { display: flex; flex-direction: column; gap: .8mm; }
.fqr { display: flex; align-items: center; gap: 2.4mm; }
.qrchip { display: inline-flex; width: 15mm; height: 15mm; padding: 1mm; background: #fff; border-radius: 2mm; }
.qrchip svg { width: 100%; height: 100%; display: block; }
.qrlabel { font-size: 7px; font-weight: 900; letter-spacing: 1.6px; color: #8ea0b6; }
.fteam { text-align: right; }
"""


def main() -> int:
    url, key = env()
    state = fetch_state(url, key)
    base = int(state["settings"].get("auction_default_base") or 20)
    purse = int(state["settings"].get("auction_purse") or 1500)
    teams = sorted(state["teams"], key=lambda t: t["sort_order"])
    squads = {t["code"]: squad_for(t["code"], state) for t in teams}
    for code, squad in squads.items():
        for player in squad:
            player["team_code"] = code
    total_spent = sum(p["price"] for s in squads.values() for p in s)
    total_players = sum(len(s) for s in squads.values())

    pages = [cover_page(teams, squads, total_spent, total_players),
             summary_page(teams, squads, purse, total_spent)]
    pages += [team_page(team, squads[team["code"]], base, purse, i, len(teams))
              for i, team in enumerate(teams, start=1)]

    EXPORTS.mkdir(exist_ok=True)
    OUT_HTML.write_text(
        "<!doctype html><html><head><meta charset='utf-8'><title>DPL 2026 · Team Squads</title>"
        f"<style>{CSS}</style></head><body>{''.join(pages)}</body></html>", encoding="utf-8")
    print(f"  html: {OUT_HTML} ({OUT_HTML.stat().st_size / 1e6:.1f} MB)")

    subprocess.run(
        [CHROME, "--headless=new", "--disable-gpu", "--no-pdf-header-footer",
         f"--print-to-pdf={OUT_PDF}", OUT_HTML.as_uri()],
        check=True, capture_output=True)
    print(f"  pdf : {OUT_PDF} ({OUT_PDF.stat().st_size / 1e6:.1f} MB, {len(pages)} pages)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
