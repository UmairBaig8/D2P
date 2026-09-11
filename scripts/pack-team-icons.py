#!/usr/bin/env python3
"""Build a shareable DPL 2026 team logo zip from the site assets.

Normalises each logo onto a square transparent canvas (trimmed, 1024 + 512),
writes a mapping README, and zips everything. The zip is also copied into
public/ so it can be downloaded from the site.

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
OUT_DIR = ROOT / "exports" / "DPL-2026-Team-Logos"
ZIP_NAME = "DPL-2026-Team-Logos.zip"
ZIP_PATH = ROOT / "exports" / ZIP_NAME
PUBLIC_ZIP = PUBLIC / ZIP_NAME

# code -> (team name, logo file in public/teams)
TEAMS = {
    "DSK": ("Digi Super Kings", "dsk.png"),
    "SM": ("Sahyadriche Mavale", "mavale.png"),
    "DMM": ("Digi Mitra Mandal", "mitra.png"),
    "BB": ("Bhakarwadi Blasters", "blaster.png"),
    "DD": ("Digi Dhadakebaaz", "dhada.png"),
    "CW": ("Cricket Wala", "wala.png"),
    "DT": ("Digi Titans", "titans.png"),
    "DY": ("Digi Yodhas", "yodhas.png"),
    "GM": ("Gallit Maramari", "gallit.png"),
    "DDH": ("Digi Dhurandhars", "dhurandhars.png"),
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
    for size in SIZES:
        (OUT_DIR / f"logos-{size}").mkdir(parents=True)

    rows = []
    for code, (name, logo_file) in TEAMS.items():
        base = slug(code, name)
        src = PUBLIC / "teams" / logo_file
        for size in SIZES:
            square_logo(src, size).save(OUT_DIR / f"logos-{size}" / f"{base}.png", optimize=True)
        rows.append(f"{code:<4} {name:<22} logos-1024/{base}.png   logos-512/{base}.png")

    readme = (
        "DPL 2026 — Team Logos\n"
        "=====================\n\n"
        "logos-1024/  square transparent PNG, 1024x1024 (primary use)\n"
        "logos-512/   square transparent PNG, 512x512 (web/app avatars)\n\n"
        "Team mapping:\n"
        + "\n".join(rows)
        + "\n\nLogos are transparent PNGs centred on a square canvas, so they can be\n"
        "dropped onto any colour without clipping.\n"
    )
    (OUT_DIR / "README.txt").write_text(readme, encoding="utf-8")

    with zipfile.ZipFile(ZIP_PATH, "w", zipfile.ZIP_DEFLATED) as zf:
        for path in sorted(OUT_DIR.rglob("*")):
            if path.is_file() and not path.name.startswith("."):
                zf.write(path, path.relative_to(OUT_DIR.parent))
    shutil.copy2(ZIP_PATH, PUBLIC_ZIP)

    print(f"pack : {OUT_DIR}")
    print(f"zip  : {ZIP_PATH} ({ZIP_PATH.stat().st_size / 1e6:.1f} MB)")
    print(f"site : {PUBLIC_ZIP}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
