"""Did a picture come back the same as the one sent? (features/frame-edit-or-redraw.clan)

An edit with nothing to work on can come back unchanged and still be charged: on 2026-11-17 Ideogram 4.5,
given the whole frame with no mask, returned it pixel for pixel ($0.25), and it was offered for Apply as
v2. Both pictures are brought to one small size and compared colour by colour; the result is the same
when almost no pixel moved strongly.

Tuned on that day's pictures at 96 x 54: the Ideogram no-op moved no pixel (largest difference 1 of 255);
real changes moved 3.8 % (a redraw that kept the framing) to 19 % of pixels, and a painted patch covering
0.4 % of the frame still moved more than the limit, so a small real edit is never called the same.
"""

from __future__ import annotations

import io

SIZE = (96, 54)
STRONG = 24  # of 255, on the colour channel that moved most
LIMIT = 0.0005  # the share of pixels that may move strongly in a picture that came back the same


def moved_share(a: bytes, b: bytes) -> float:
    """The share of pixels whose largest colour difference is over STRONG, at SIZE."""
    from PIL import Image, ImageChops

    def small(data: bytes):
        im = Image.open(io.BytesIO(data))
        im.seek(0)
        return im.convert("RGB").resize(SIZE, Image.BILINEAR)

    diff = ImageChops.difference(small(a), small(b))
    channels = diff.split()
    most = ImageChops.lighter(ImageChops.lighter(channels[0], channels[1]), channels[2])
    hist = most.histogram()
    return sum(hist[STRONG + 1:]) / (SIZE[0] * SIZE[1])


def same_picture(a: bytes, b: bytes) -> bool:
    return moved_share(a, b) < LIMIT
