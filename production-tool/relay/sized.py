"""A picture at most w pixels wide, for GET /assets/{sha256}?w= (features/prod-assets-route.clan).

The Deck Maker shows Production's pictures on slides (about 2400 px) and as picker tiles: it asks for one
of WIDTHS and the relay keeps the copy at out/w<w>/<sha>, beside the original, so it is made once. A
picture already that narrow is re-encoded at its own size, never enlarged. JPEG at quality 85, or PNG
when it has transparency (a cutout stays a cutout). Pillow only: no ffmpeg in the relay Lambda.
"""

from __future__ import annotations

import io

WIDTHS = (480, 1200, 2400)
JPEG_QUALITY = 85


def derived_key(sha: str, w: int) -> str:
    return f"out/w{w}/{sha}"


def sized(data: bytes, w: int) -> tuple[bytes, str] | None:
    """(bytes, mime) of the picture at most w wide, or None when Pillow cannot read it (the caller then
    serves the original). Pillow's decompression-bomb limit stays on: a bomb is None, not a hang."""
    from PIL import Image, ImageOps

    try:
        with Image.open(io.BytesIO(data)) as im:
            im = ImageOps.exif_transpose(im)
            if im.width > w:
                im = im.resize((w, max(1, round(im.height * w / im.width))), Image.LANCZOS)
            alpha = im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info)
            out = io.BytesIO()
            if alpha:
                im.convert("RGBA").save(out, "PNG", optimize=True)
                return out.getvalue(), "image/png"
            im.convert("RGB").save(out, "JPEG", quality=JPEG_QUALITY, optimize=True, progressive=True)
            return out.getvalue(), "image/jpeg"
    except (OSError, ValueError, Image.DecompressionBombError):
        return None
