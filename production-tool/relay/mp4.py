"""An MP4's length from its header (moov/mvhd), read from the bytes the relay already holds: no ffprobe, no
stage. A provider's output carries no length (Runway reports none), so a take was recorded at the plan's length
(UAT 2026-11-21, F4: Veo made 4 s for a 3 s shot, the web kept 3 s, and the Out window cut the line off)."""

from __future__ import annotations

import struct
from typing import Optional

_CONTAINERS = {b"moov", b"trak", b"mdia"}


def _boxes(data: bytes, start: int, end: int):
    i = start
    while i + 8 <= end:
        size, kind = struct.unpack(">I4s", data[i:i + 8])
        head = 8
        if size == 1:
            if i + 16 > end:
                return
            size = struct.unpack(">Q", data[i + 8:i + 16])[0]
            head = 16
        elif size == 0:
            size = end - i
        if size < head or i + size > end:
            return
        yield kind, i + head, i + size
        i += size


def duration_s(data: bytes) -> Optional[float]:
    """The movie's length in seconds (mvhd duration / timescale), rounded to the millisecond; None when the bytes
    are not an MP4 or say no length."""
    try:
        for kind, a, b in _boxes(data, 0, len(data)):
            if kind != b"moov":
                continue
            for k, x, y in _boxes(data, a, b):
                if k != b"mvhd" or y - x < 20:
                    continue
                version = data[x]
                if version == 1:
                    timescale, duration = struct.unpack(">IQ", data[x + 20:x + 32])
                else:
                    timescale, duration = struct.unpack(">II", data[x + 12:x + 20])
                if timescale and duration and duration != 0xFFFFFFFF:
                    return round(duration / timescale, 3)
        return None
    except (struct.error, IndexError):
        return None
