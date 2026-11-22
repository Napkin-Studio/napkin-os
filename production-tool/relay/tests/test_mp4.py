"""An MP4's length from its header (relay/mp4.py; UAT 2026-11-21, F4: Veo made 4 s for a 3 s shot and the take
was recorded at 3 s)."""
import struct

import mp4


def box(kind: bytes, body: bytes) -> bytes:
    return struct.pack(">I4s", 8 + len(body), kind) + body


def mvhd(timescale: int, duration: int, version: int = 0) -> bytes:
    if version == 1:
        body = bytes([1, 0, 0, 0]) + struct.pack(">QQIQ", 0, 0, timescale, duration) + b"\0" * 80
    else:
        body = bytes([0, 0, 0, 0]) + struct.pack(">IIII", 0, 0, timescale, duration) + b"\0" * 80
    return box(b"mvhd", body)


def test_reads_the_movie_length_after_mdat():
    data = box(b"ftyp", b"isom\0\0\0\0") + box(b"mdat", b"\0" * 500) + box(b"moov", mvhd(1000, 4042))
    assert mp4.duration_s(data) == 4.042


def test_version_1_header():
    assert mp4.duration_s(box(b"moov", mvhd(90000, 360000, version=1))) == 4.0


def test_not_an_mp4():
    assert mp4.duration_s(b"\x89PNG\r\n\x1a\n" + b"\0" * 40) is None
    assert mp4.duration_s(b"") is None
