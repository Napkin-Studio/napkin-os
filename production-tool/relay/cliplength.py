"""How long a stored clip is, read from its own bytes (features/production-platform-rules.clan; the review of 25e7c870,
finding 4): an edit is billed by the clip the provider reads, so its price never comes from a length the request
declares. An MP4's movie header (moov/mvhd) holds its duration and timescale; None when the bytes hold neither."""

from __future__ import annotations

import struct

CONTAINERS = {b"moov"}


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


def mp4_seconds(data: bytes) -> float | None:
    """The clip's length in seconds from its mvhd, or None when it cannot be read."""
    for kind, a, b in _boxes(data, 0, len(data)):
        if kind != b"moov":
            continue
        for inner, c, d in _boxes(data, a, b):
            if inner != b"mvhd" or d - c < 20:
                continue
            version = data[c]
            if version == 1 and d - c >= 32:
                timescale, duration = struct.unpack(">IQ", data[c + 20:c + 32])
            else:
                timescale, duration = struct.unpack(">II", data[c + 12:c + 20])
            if timescale and 0 < duration < 2**63:
                return duration / timescale
    return None
