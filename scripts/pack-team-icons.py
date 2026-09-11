#!/usr/bin/env python3
"""Build a shareable DPL 2026 team icon pack (zip) from the site assets.

Normalises each logo onto a square transparent canvas (trimmed, 1024 + 512),
copies the team headers, writes a mapping README, and zips everything to
exports/DPL-2026-Team-Icons.zip.

Usage:
    python3 scripts/pack-team-icons.py
"""

from __future__ import annotations

import shutil
import zipfile
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"
OUT_DIR = ROOT / "exports" / "DPL-2026-Team-Icons"
ZIP_PATH = ROOT / "exports" / "DPL-2026-Team-Icons.zip"

# code -> (team name, logo file in public/teams, header file in public/team-headers)
TEAMS = {
    "DSK": ("Digi Super Kings", "dsk.png", "digi-super-kings.png"),
    "SM": ("Sahyadriche Mavale", "mavale.png", "sahyadriche-mavale.png"),
    "DMM": ("Digi Mitra Mandal", "mitra.png", "digi-mitra-mandal.png"),
    "BB": ("Bhakarwadi Blasters", "blaster.png", "bhakarwadi-blasters.png"),
    "DD": ("Digi Dhadakebaaz", "dhada.png", "digi-dhadakebaaz.png"),
    "CW": ("Cricket Wala", "wala.png", "cricket-wala.png"),
    "DT": ("Digi Titans", "titans.png", "digi-titans.png"),
    "DY": ("Digi Yodhas", "yodhas.png", "digi-yodhas.png"),
    "GM": ("Gallit Maramari", "gallit.png", "gallit-maramari.png"),
    "DDH": ("Digi Dhurandhars", "dhurandhars.png", "digi-dhurandhars.png"),
}

SIZES = (1024, 512)
PAD = 0.08  # fraction of the canvas kept as breathing room around the logo


def slug(code: str, name: str) -> str:
    return f"{code}-{name.replace(' ', '-')}"


def square_logo(src: Path, size: int) -> Image.Image:
    img = Image.open(src).convert("RGBA")
    bbox = img.getbbox()
    if bbox:
        img = img.crop(bbox)
    inner = round(size * (1 - 2 * PAD))
    w, h = img.size
    scale = inner / max(w, h)
    resized = img.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.alpha_composite(resized, ((size - resized.width) // 2, (size - resized.height) // 2))
    return canvas


def main() -> int:
    if OUT_DIR.exists():
        shutil.rmtree(OUT_DIR)
    (OUT_DIR / "logos-1024").mkdir(parents=True)
    (OUT_DIR / "logos-512").mkdir(parents=True)
    (OUT_DIR / "headers").mkdir(parents=True)

    rows = []
    for code, (name, logo_file, header_file) in TEAMS.items():
        base = slug(code, name)
        src = PUBLIC / "teams" / logo_file
        for size in SIZES:
            square_logo(src, size).save(OUT_DIR / f"logos-{size}" / f"{base}.png")
        shutil.copy2(PUBLIC / "team-headers" / header_file, OUT_DIR / "headers" / f"{base}.png")
        rows.append(f"{code:<4} {name:<22} logos-1024/{base}.png   headers/{base}.png")

    readme = (
        "DPL 2026 — Team Icon Pack\n"
        "=========================\n\n"
        "logos-1024/  square transparent PNG, 1024x1024 (primary use)\n"
        "logos-512/   square transparent PNG, 512x512 (web/app avatars)\n"
        "headers/     wide team banners (1055x520), original size\n\n"
        "Team mapping:\n"
        + "\n".join(rows)
        + "\n\nUsage: logos are transparent PNGs centred on a square canvas, so they can be\n"
        "dropped onto any colour without clipping. Use headers for social/card banners.\n"
    )
    (OUT_DIR / "README.txt").write_text(readme, encoding="utf-8")

    with zipfile.ZipFile(ZIP_PATH, "w", zipfile.ZIP_DEFLATED) as zf:
        for path in sorted(OUT_DIR.rglob("*")):
            if path.is_file():
                zf.write(path, path.relative_to(OUT_DIR.parent))

    print(f"pack : {OUT_DIR}")
    print(f"zip  : {ZIP_PATH} ({ZIP_PATH.stat().st_size / 1e6:.1f} MB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
