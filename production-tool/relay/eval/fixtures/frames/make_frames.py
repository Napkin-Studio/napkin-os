"""The eval's storyboard stills for Change this frame (features/frame-change-edit.clan), drawn here
from plain shapes so no client material, photo or third-party picture is ever involved.

  uv run python eval/fixtures/frames/make_frames.py      # rewrites the PNGs next to this file

The PNGs are committed; this script is how they were made (SOURCES.md). Same code, same pixels.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
W, H = 1344, 756

SKY, SEA, SAND = (247, 196, 140), (64, 120, 168), (226, 200, 150)
SKIN, HAIR, DRESS, SCARF = (214, 160, 120), (60, 40, 30), (240, 240, 235), (40, 90, 200)
WALL, TABLE, GLASS, LABEL = (236, 228, 214), (150, 100, 60), (70, 140, 90), (250, 250, 250)


def person(d: ImageDraw.ImageDraw, cx: int, base: int, scale: float, scarf: bool = True) -> None:
    """A standing figure, medium shot: head, hair, dress, a scarf at the neck, arms."""
    s = scale
    head = int(70 * s)
    d.ellipse((cx - head // 2, base - int(420 * s), cx + head // 2, base - int(420 * s) + head), fill=SKIN)
    d.pieslice((cx - head // 2 - 6, base - int(428 * s), cx + head // 2 + 6, base - int(428 * s) + head), 180, 360, fill=HAIR)
    d.polygon([(cx - int(70 * s), base), (cx + int(70 * s), base), (cx + int(45 * s), base - int(340 * s)),
               (cx - int(45 * s), base - int(340 * s))], fill=DRESS)
    d.line((cx - int(45 * s), base - int(320 * s), cx - int(95 * s), base - int(170 * s)), fill=SKIN, width=int(16 * s))
    d.line((cx + int(45 * s), base - int(320 * s), cx + int(95 * s), base - int(170 * s)), fill=SKIN, width=int(16 * s))
    if scarf:
        d.rectangle((cx - int(48 * s), base - int(352 * s), cx + int(48 * s), base - int(326 * s)), fill=SCARF)
        d.rectangle((cx + int(10 * s), base - int(330 * s), cx + int(34 * s), base - int(250 * s)), fill=SCARF)


def beach() -> Image.Image:
    im = Image.new("RGB", (W, H), SKY)
    d = ImageDraw.Draw(im)
    d.ellipse((980, 90, 1110, 220), fill=(255, 226, 150))
    d.rectangle((0, 360, W, 470), fill=SEA)
    d.rectangle((0, 470, W, H), fill=SAND)
    person(d, 640, 760, 1.25)
    return im


def kitchen() -> Image.Image:
    im = Image.new("RGB", (W, H), WALL)
    d = ImageDraw.Draw(im)
    d.rectangle((900, 80, 1180, 330), fill=(180, 210, 230), outline=(120, 110, 100), width=10)
    d.rectangle((0, 520, W, H), fill=TABLE)
    d.rectangle((630, 300, 700, 520), fill=GLASS)
    d.rectangle((648, 240, 682, 300), fill=GLASS)
    d.rectangle((630, 380, 700, 440), fill=LABEL)
    d.ellipse((380, 470, 520, 520), fill=(240, 240, 240))
    return im


def street() -> Image.Image:
    im = Image.new("RGB", (W, H), (200, 210, 220))
    d = ImageDraw.Draw(im)
    for i, x in enumerate(range(0, W, 220)):
        d.rectangle((x, 140 + (i % 3) * 40, x + 200, 560), fill=(150 + i * 8 % 60, 120, 110))
        for wy in range(190 + (i % 3) * 40, 520, 70):
            d.rectangle((x + 30, wy, x + 80, wy + 40), fill=(240, 220, 160))
    d.rectangle((0, 560, W, H), fill=(80, 80, 85))
    person(d, 420, 740, 0.9)
    return im


FRAMES = {"beach_medium.png": beach, "kitchen_bottle.png": kitchen, "street_wide.png": street}


def main() -> None:
    for name, draw in FRAMES.items():
        draw().save(HERE / name, "PNG", optimize=True)
        print(name)


if __name__ == "__main__":
    main()
