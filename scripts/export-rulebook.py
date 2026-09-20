#!/usr/bin/env python3
"""Export the DPL 2026 official rule book to a print-ready A4 PDF.

Source: public/DPL_Rules.md (the canonical match rules). The file is a flat text
document: section headers are plain lines, rules are unnumbered sentences, and
sub-points are "1 Owner" / "a. ..." style lines. This script groups the rules
under their sections, numbers them (1.1, 1.2, ...), applies light copy-edits for
obvious typos, and renders a branded cover + contents + one page per section.

Output (served by the app):
    public/DPL-2026-Rulebook.pdf         (dark theme)
    public/DPL-2026-Rulebook-Light.pdf   (light theme)

Usage:
    python3 scripts/export-rulebook.py                 # both themes
    python3 scripts/export-rulebook.py --theme light   # light only
    python3 scripts/export-rulebook.py --theme dark    # dark only
"""

from __future__ import annotations

import base64
import html
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"
SOURCE = PUBLIC / "DPL_Rules.md"
OUT_PDF = PUBLIC / "DPL-2026-Rulebook.pdf"
OUT_PDF_LIGHT = PUBLIC / "DPL-2026-Rulebook-Light.pdf"
OUT_HTML = Path("/tmp/dpl-rulebook.html")
OUT_HTML_LIGHT = Path("/tmp/dpl-rulebook-light.html")
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
LOGO = PUBLIC / "logo-512.png"

TITLE = "DPL 2026"
SUBTITLE = "Official Match Rule Book"
TAGLINE = "Digitate Premier League · Office Cricket"
META = "October 7–8, 2026 · DPL Arena"

# Ordered section headers exactly as they appear in DPL_Rules.md.
SECTION_HEADERS = [
    "1. Team Composition",
    "Playing Rules",
    "Dismissal Modes for Batter",
    "No Ball & Free Hit and Extras",
    "Bowling Action",
    "Injuries and Retiring",
    "Fielding Restrictions",
    "Scoring",
    "Women Player Scoring",
    "Misbehavior and Decision Making",
    "Communication",
    "Tie Breaker",
    "Additional Conditions",
    "Responsibility",
]

# Minimal copy-edits: fix clear typos/spelling without changing any rule's meaning.
FIXES = [
    ("wise versa", "vice versa"),
    ("a female players role", "a female player's role"),
    ("won't", "will not"),
    ("won\u2019t", "will not"),
    ('A " One tip one hand" catch', 'A "one tip, one hand" catch'),
    ("The Female player Batting", "The female player batting"),
    ("b c and d", "b, c and d"),
    ("crosses the any side", "crosses either side"),
    ("If a player is retired due to injury, player can substitute them in the match from the squad.",
     "If a player is retired due to injury, they can be substituted in the match from the squad."),
]

# "Bowling Action Details" is followed by four points written without a/b/c/d prefixes.
BULLET_CONTINUATIONS = (
    "Arm Extension Above the Head",
    "Elbow Behind the Back",
    "Arm Movement Behind the Ear",
    "Legs should be placed parallel",
)


def esc(value: str) -> str:
    return html.escape(value, quote=True)


def clean(value: str) -> str:
    for old, new in FIXES:
        value = value.replace(old, new)
    return re.sub(r"\s+", " ", value).strip()


def norm(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip()).lower()


def data_uri(path: Path) -> str:
    return "data:image/png;base64," + base64.b64encode(path.read_bytes()).decode("ascii")


def parse_rules() -> tuple[list[dict], str]:
    """Return ([{title, rules:[{text, bullets}]}], closing_note)."""
    lines = SOURCE.read_text(encoding="utf-8").splitlines()
    header_map = {norm(h): h for h in SECTION_HEADERS}
    sections: list[dict] = []
    current: dict | None = None
    last_rule: dict | None = None
    closing = ""

    def find_section(title: str) -> dict:
        for section in sections:
            if section["title"] == title:
                return section
        section = {"title": title, "rules": []}
        sections.append(section)
        return section

    for raw in lines[1:]:
        text = raw.strip()
        if not text:
            continue
        if text.startswith("**") and text.endswith("**"):
            closing = text.strip("*").strip()
            continue
        if norm(text) in header_map:
            title = re.sub(r"^\d+\.\s*", "", text).strip()
            current = find_section(title)
            last_rule = None
            continue
        if re.match(r"^[a-d]\.\s+", text):
            if last_rule is not None:
                last_rule["bullets"].append(clean(re.sub(r"^[a-d]\.\s+", "", text)))
            continue
        if last_rule is not None and text.startswith(BULLET_CONTINUATIONS):
            letter = chr(ord("a") + len(last_rule["bullets"]))
            last_rule["bullets"].append(clean(f"{letter}. {text}"))
            continue
        numbered = re.match(r"^\d+\.\s+(.*)$", text)
        if numbered:
            # The file misplaces the "communication" rule at the end; restore it.
            target = find_section("Communication") if "communicate with the umpires" in text else current
            if target is not None:
                rule = {"text": clean(numbered.group(1)), "bullets": []}
                target["rules"].append(rule)
                last_rule = rule
            continue
        sub = re.match(r"^(\d+)\s+([A-Z].*)$", text)
        if sub and last_rule is not None:
            last_rule["bullets"].append(clean(f"{sub.group(1)} {sub.group(2)}"))
            continue
        if current is None:
            continue
        rule = {"text": clean(text), "bullets": []}
        current["rules"].append(rule)
        last_rule = rule

    return [s for s in sections if s["rules"]], closing


def css(theme: str) -> str:
    if theme == "light":
        v = {
            "bg": "#eef2f8", "ink": "#0b1220", "muted": "#5b6b82",
            "card": "#ffffff", "line": "rgba(15,23,42,.12)", "chip": "#e4ebf5",
            "cover": "linear-gradient(135deg,#0b1b34,#17335a)", "coverink": "#ffffff",
            "covermuted": "#a7b9c6",
        }
    else:
        v = {
            "bg": "#06172d", "ink": "#eaf0f7", "muted": "#8ba0b0",
            "card": "#0b1e38", "line": "rgba(255,255,255,.1)", "chip": "rgba(255,255,255,.07)",
            "cover": "linear-gradient(135deg,#06172d,#102c4c)", "coverink": "#ffffff",
            "covermuted": "#a7b9c6",
        }
    return f"""
* {{ box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }}
html, body {{ margin: 0; padding: 0; }}
body {{ font-family: "Helvetica Neue", Arial, sans-serif; color: {v['ink']}; background: {v['bg']}; }}
@page {{ size: A4 portrait; margin: 0; }}
.sheet {{ width: 210mm; min-height: 297mm; padding: 20mm 18mm 22mm; position: relative; background: {v['bg']}; break-after: page; overflow: hidden; }}
.sheet:last-child {{ break-after: auto; }}
.runfoot {{ position: fixed; bottom: 7mm; left: 0; right: 0; text-align: center; font-size: 7.5pt; letter-spacing: .6px; color: {v['muted']}; }}
.runfoot b {{ color: #09c9d8; }}

/* Cover */
.cover {{ background: {v['cover']}; color: {v['coverink']}; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }}
.cover:before {{ content: ''; position: absolute; inset: 0; background: radial-gradient(circle at 20% 20%, rgba(9,201,216,.18), transparent 55%), radial-gradient(circle at 80% 80%, rgba(237,58,168,.18), transparent 55%); }}
.cover > * {{ position: relative; z-index: 2; }}
.cover .logo {{ width: 44mm; height: 44mm; object-fit: contain; margin-bottom: 10mm; filter: drop-shadow(0 12px 30px rgba(0,0,0,.45)); }}
.cover .eyebrow {{ font-size: 10pt; font-weight: 800; letter-spacing: 3px; color: #55e9ef; margin-bottom: 5mm; }}
.cover h1 {{ font-size: 42pt; font-weight: 900; font-style: italic; letter-spacing: -1px; margin: 0; line-height: .95; }}
.cover h1 span {{ display: block; background: linear-gradient(90deg,#ff7b1a,#ed3aa8,#873cff); -webkit-background-clip: text; background-clip: text; color: transparent; }}
.cover h2 {{ font-size: 16pt; font-weight: 700; letter-spacing: 1px; margin: 8mm 0 0; color: {v['coverink']}; }}
.cover .tagline {{ font-size: 10pt; color: {v['covermuted']}; margin-top: 3mm; letter-spacing: .5px; }}
.cover .meta {{ margin-top: 14mm; padding: 4mm 8mm; border: 1px solid rgba(255,255,255,.22); border-radius: 999px; font-size: 10pt; font-weight: 700; letter-spacing: .5px; color: #dff3f6; }}

/* Contents */
.contents h2, .section-head h2 {{ font-size: 22pt; font-weight: 900; font-style: italic; letter-spacing: -.4px; margin: 0 0 6mm; }}
.toc {{ list-style: none; margin: 0; padding: 0; }}
.toc li {{ display: flex; align-items: center; gap: 4mm; padding: 3.2mm 0; border-bottom: 1px solid {v['line']}; font-size: 11pt; font-weight: 700; }}
.toc .num {{ flex: 0 0 9mm; height: 9mm; display: flex; align-items: center; justify-content: center; border-radius: 2.4mm; background: {v['chip']}; color: #09c9d8; font-size: 10pt; font-weight: 900; }}
.toc .count {{ margin-left: auto; font-size: 8.5pt; font-weight: 700; color: {v['muted']}; }}

/* Section */
.section-head {{ display: flex; align-items: center; gap: 5mm; margin-bottom: 8mm; }}
.section-head .badge {{ flex: 0 0 14mm; height: 14mm; display: flex; align-items: center; justify-content: center; border-radius: 3.4mm; background: linear-gradient(135deg,#09c9d8,#2867ff); color: #04121f; font-size: 15pt; font-weight: 900; }}
.section-head .kicker {{ font-size: 8pt; font-weight: 800; letter-spacing: 2px; color: #09c9d8; text-transform: uppercase; }}
.rule {{ display: flex; gap: 4mm; padding: 3.4mm 0; break-inside: avoid; border-bottom: 1px solid {v['line']}; }}
.rule .rnum {{ flex: 0 0 12mm; font-size: 10pt; font-weight: 900; color: #ed3aa8; padding-top: .3mm; }}
.rule .rtext {{ font-size: 10.5pt; line-height: 1.5; }}
.rule ul {{ margin: 2mm 0 0; padding-left: 5mm; }}
.rule ul li {{ font-size: 10pt; line-height: 1.5; margin-bottom: 1mm; }}
.rule ul li::marker {{ color: #09c9d8; }}

/* Closing */
.closing {{ display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }}
.closing h2 {{ font-size: 26pt; font-weight: 900; font-style: italic; margin: 0 0 6mm; background: linear-gradient(90deg,#ff7b1a,#ed3aa8,#873cff); -webkit-background-clip: text; background-clip: text; color: transparent; }}
.closing p {{ font-size: 11pt; color: {v['muted']}; max-width: 120mm; line-height: 1.6; }}
.closing .sig {{ margin-top: 12mm; font-size: 9pt; letter-spacing: 1px; color: {v['muted']}; }}
"""


def cover_page() -> str:
    logo = f'<img class="logo" src="{data_uri(LOGO)}" alt="DPL">' if LOGO.exists() else ""
    return (
        '<section class="sheet cover">'
        f'{logo}'
        '<p class="eyebrow">DPL 2026 · OFFICIAL DOCUMENT</p>'
        f'<h1>{esc(TITLE)}<span>RULE BOOK</span></h1>'
        f'<h2>{esc(SUBTITLE)}</h2>'
        f'<p class="tagline">{esc(TAGLINE)}</p>'
        f'<div class="meta">{esc(META)}</div>'
        '</section>'
    )


def contents_page(sections: list[dict]) -> str:
    items = "".join(
        f'<li><span class="num">{i}</span><span>{esc(s["title"])}</span>'
        f'<span class="count">{len(s["rules"])} rule{"s" if len(s["rules"]) != 1 else ""}</span></li>'
        for i, s in enumerate(sections, start=1)
    )
    return f'<section class="sheet contents"><h2>Contents</h2><ul class="toc">{items}</ul></section>'


def section_page(index: int, section: dict) -> str:
    rules = ""
    for r, rule in enumerate(section["rules"], start=1):
        bullets = ""
        if rule["bullets"]:
            bullets = "<ul>" + "".join(f"<li>{esc(b)}</li>" for b in rule["bullets"]) + "</ul>"
        rules += (
            f'<div class="rule"><div class="rnum">{index}.{r}</div>'
            f'<div class="rtext">{esc(rule["text"])}{bullets}</div></div>'
        )
    return (
        '<section class="sheet">'
        '<div class="section-head">'
        f'<div class="badge">{index}</div>'
        f'<div><div class="kicker">Section {index}</div><h2>{esc(section["title"])}</h2></div>'
        '</div>'
        f'{rules}'
        '</section>'
    )


def closing_page(note: str) -> str:
    if not note:
        return ""
    return (
        '<section class="sheet closing">'
        f'<h2>{esc(note)}</h2>'
        '<p>Owners and captains are responsible for ensuring their teams understand and follow these rules. '
        'All teams acknowledge that they have read the rule book in advance.</p>'
        f'<div class="sig">{esc(TITLE)} · {esc(TAGLINE)}</div>'
        '</section>'
    )


def render_html(sections: list[dict], note: str, theme: str) -> str:
    pages = [cover_page(), contents_page(sections)]
    pages += [section_page(i, s) for i, s in enumerate(sections, start=1)]
    closing = closing_page(note)
    if closing:
        pages.append(closing)
    foot = '<div class="runfoot">DPL 2026 · OFFICIAL RULE BOOK · <b>D2P</b></div>'
    return (
        "<!doctype html><html><head><meta charset='utf-8'>"
        f"<title>DPL 2026 · Rule Book</title><style>{css(theme)}</style></head>"
        f"<body>{''.join(pages)}{foot}</body></html>"
    )


def render_pdf(html_path: Path, out_pdf: Path) -> None:
    subprocess.run(
        [CHROME, "--headless=new", "--disable-gpu", "--no-pdf-header-footer",
         f"--print-to-pdf={out_pdf}", html_path.as_uri()],
        check=True, capture_output=True)


def main() -> int:
    if not SOURCE.exists():
        print(f"missing source: {SOURCE}")
        return 1
    sections, note = parse_rules()
    if not sections:
        print("no sections parsed from rule source")
        return 1
    total = sum(len(s["rules"]) for s in sections)
    print(f"parsed {len(sections)} sections, {total} rules")

    theme = "both"
    if "--theme" in sys.argv:
        theme = sys.argv[sys.argv.index("--theme") + 1]
    themes = ["dark", "light"] if theme == "both" else [theme]
    for t in themes:
        out = OUT_PDF if t == "dark" else OUT_PDF_LIGHT
        html_path = OUT_HTML if t == "dark" else OUT_HTML_LIGHT
        html_path.write_text(render_html(sections, note, t), encoding="utf-8")
        render_pdf(html_path, out)
        print(f"  {t:5s} -> {out} ({out.stat().st_size / 1e6:.2f} MB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
