#!/usr/bin/env python3
"""Vendor the Deck Maker's icon allow-list (deck-graphics slice 1, features/deck-graphics.clan design.icons).

    python3 scripts/vendor_icons.py PATH/TO/lucide-static-1.75.0.tgz

Reads the npm tarball of lucide-static 1.75.0 (checked against the npm integrity hash below before anything is read), takes ONLY
the ids of engine/deck/policy/icons.yaml (72), converts each SVG once into absolute path commands (M, L, C, Z; arcs become cubic
Beziers, circles and ellipses four arcs, rects with rx rounded corners, lines and polylines straight segments) and writes:

    engine/deck/vendor/icons/icons.json         {id: {"paths": [[["M", x, y], ["L", x, y], ["C", x1, y1, x2, y2, x, y], ["Z"]], ...], "feather": bool}}
    engine/deck/vendor/icons/LICENSE            the package's own LICENSE text, verbatim (ISC, and MIT for the Feather-derived icons)
    engine/deck/vendor/icons/icons.source.json  package, version, tarball sha512 integrity, licence, ids, date

No SVG is parsed at run time: the engine reads icons.json only. Any id on graphics.ICON_DENY (brands, platforms, awards) or
graphics.ICON_CLAIMS (a direction, a verdict, an approval) is refused.
Stdlib only (plus PyYAML for the policy file); the tarball is read in place, never extracted.
"""
from __future__ import annotations

import base64
import datetime as _dt
import hashlib
import json
import math
import re
import sys
import tarfile
import xml.etree.ElementTree as ET
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
DECK = ROOT / "engine" / "deck"
OUT = DECK / "vendor" / "icons"
PACKAGE, VERSION = "lucide-static", "1.75.0"
INTEGRITY = "sha512-vtAnJzxoH8jp0++Ydf22CPAAL3WfQQjmDG+OuRlG+CXouLCrlfTz7zWuDvHkTtj61czkhJAISChHDXkxLLqKRw=="
TARBALL_URL = "https://registry.npmjs.org/lucide-static/-/lucide-static-1.75.0.tgz"
ND = 3   # decimals kept (0.001 of a 24-unit grid)


def _deny() -> tuple:
    sys.path.insert(0, str(ROOT / "engine"))
    from deck import graphics   # noqa: PLC0415
    return graphics.ICON_DENY, graphics.ICON_CLAIMS


# ---------------------------------------------------------------- SVG geometry -> absolute M / L / C / Z

_TOK = re.compile(r"[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?")


def _arc_to_beziers(x1, y1, rx, ry, phi, fa, fs, x2, y2) -> list:
    """SVG elliptical arc (endpoint form, SVG 1.1 F.6.5) as cubic Bezier segments of at most 90 degrees each: [(c1x, c1y, c2x, c2y, x, y)]."""
    if (x1, y1) == (x2, y2):
        return []
    rx, ry = abs(rx), abs(ry)
    if rx == 0 or ry == 0:
        return [(x1, y1, x2, y2, x2, y2)]
    cp, sp = math.cos(math.radians(phi)), math.sin(math.radians(phi))
    dx, dy = (x1 - x2) / 2, (y1 - y2) / 2
    x1p, y1p = cp * dx + sp * dy, -sp * dx + cp * dy
    lam = (x1p ** 2) / (rx ** 2) + (y1p ** 2) / (ry ** 2)
    if lam > 1:
        rx, ry = rx * math.sqrt(lam), ry * math.sqrt(lam)
    num = rx ** 2 * ry ** 2 - rx ** 2 * y1p ** 2 - ry ** 2 * x1p ** 2
    den = rx ** 2 * y1p ** 2 + ry ** 2 * x1p ** 2
    co = math.sqrt(max(0.0, num / den)) if den else 0.0
    if fa == fs:
        co = -co
    cxp, cyp = co * rx * y1p / ry, -co * ry * x1p / rx
    cx, cy = cp * cxp - sp * cyp + (x1 + x2) / 2, sp * cxp + cp * cyp + (y1 + y2) / 2

    def ang(ux, uy, vx, vy):
        a = math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)
        return a

    t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry)
    dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry)
    if not fs and dt > 0:
        dt -= 2 * math.pi
    elif fs and dt < 0:
        dt += 2 * math.pi
    n = max(1, math.ceil(abs(dt) / (math.pi / 2) - 1e-9))
    seg = dt / n
    k = 4 / 3 * math.tan(seg / 4)
    out = []

    def pt(t):
        x, y = rx * math.cos(t), ry * math.sin(t)
        return cp * x - sp * y + cx, sp * x + cp * y + cy

    def dpt(t):
        x, y = -rx * math.sin(t), ry * math.cos(t)
        return cp * x - sp * y, sp * x + cp * y

    t = t1
    for i in range(n):
        ta, tb = t, t + seg
        (ax, ay), (bx, by) = pt(ta), pt(tb)
        (dax, day), (dbx, dby) = dpt(ta), dpt(tb)
        out.append((ax + k * dax, ay + k * day, bx - k * dbx, by - k * dby, bx, by))
        t = tb
    ex, ey = out[-1][4], out[-1][5]
    if abs(ex - x2) > 1e-6 or abs(ey - y2) > 1e-6:   # land exactly on the stated end point
        c = out[-1]
        out[-1] = (c[0], c[1], c[2], c[3], x2, y2)
    return out


def parse_path(d: str) -> list:
    """An SVG path's ``d`` as absolute sub-paths: [[["M", x, y], ["L", x, y], ["C", ...], ["Z"]], ...]."""
    toks = _TOK.findall(d)
    i, cmd = 0, None
    subs, cur = [], None
    x = y = sx = sy = 0.0
    last_c2 = last_q = None

    def num():
        nonlocal i
        v = float(toks[i])
        i += 1
        return v

    def flag():   # an arc flag may be written run together with the next number ('a2 2 0 1 1 4 0' or 'a2 2 0 114 0')
        nonlocal i
        t = toks[i]
        if t in ("0", "1"):
            i += 1
            return int(t)
        v, rest = t[0], t[1:]
        toks[i] = rest
        return int(v)

    while i < len(toks):
        t = toks[i]
        if re.fullmatch(r"[A-Za-z]", t):
            cmd = t
            i += 1
            if cmd in "Zz":
                if cur is not None:
                    cur.append(["Z"])
                x, y = sx, sy
                last_c2 = last_q = None
                cur = None
                continue
        elif cmd is None:
            raise ValueError(f"path data starts with a number: {d[:40]!r}")
        rel = cmd.islower()
        C = cmd.upper()
        ox, oy = (x, y) if rel else (0.0, 0.0)
        if C == "M":
            x, y = ox + num(), oy + num()
            sx, sy = x, y
            cur = [["M", x, y]]
            subs.append(cur)
            cmd = "l" if rel else "L"   # further pairs are line-tos
            last_c2 = last_q = None
            continue
        if cur is None:   # a drawing command after Z starts a new sub-path at the current point
            cur = [["M", x, y]]
            subs.append(cur)
        if C == "L":
            x, y = ox + num(), oy + num()
            cur.append(["L", x, y])
            last_c2 = last_q = None
        elif C == "H":
            x = ox + num()
            cur.append(["L", x, y])
            last_c2 = last_q = None
        elif C == "V":
            y = (y if rel else 0.0) + num()
            cur.append(["L", x, y])
            last_c2 = last_q = None
        elif C == "C":
            c1x, c1y, c2x, c2y, ex, ey = ox + num(), oy + num(), ox + num(), oy + num(), ox + num(), oy + num()
            cur.append(["C", c1x, c1y, c2x, c2y, ex, ey])
            x, y, last_c2, last_q = ex, ey, (c2x, c2y), None
        elif C == "S":
            c1x, c1y = (2 * x - last_c2[0], 2 * y - last_c2[1]) if last_c2 else (x, y)
            c2x, c2y, ex, ey = ox + num(), oy + num(), ox + num(), oy + num()
            cur.append(["C", c1x, c1y, c2x, c2y, ex, ey])
            x, y, last_c2, last_q = ex, ey, (c2x, c2y), None
        elif C in ("Q", "T"):
            if C == "Q":
                qx, qy = ox + num(), oy + num()
            else:
                qx, qy = (2 * x - last_q[0], 2 * y - last_q[1]) if last_q else (x, y)
            ex, ey = ox + num(), oy + num()
            cur.append(["C", x + 2 / 3 * (qx - x), y + 2 / 3 * (qy - y), ex + 2 / 3 * (qx - ex), ey + 2 / 3 * (qy - ey), ex, ey])
            x, y, last_q, last_c2 = ex, ey, (qx, qy), None
        elif C == "A":
            rx, ry, phi = num(), num(), num()
            fa, fs = flag(), flag()
            ex, ey = ox + num(), oy + num()
            for c in _arc_to_beziers(x, y, rx, ry, phi, fa, fs, ex, ey):
                cur.append(["C", *c])
            x, y = ex, ey
            last_c2 = last_q = None
        else:
            raise ValueError(f"unsupported path command {cmd!r}")
    return subs


def _ellipse(cx, cy, rx, ry) -> list:
    d = f"M{cx + rx} {cy}A{rx} {ry} 0 0 1 {cx} {cy + ry}A{rx} {ry} 0 0 1 {cx - rx} {cy}A{rx} {ry} 0 0 1 {cx} {cy - ry}A{rx} {ry} 0 0 1 {cx + rx} {cy}Z"
    return parse_path(d)


def _rect(x, y, w, h, rx, ry) -> list:
    if rx is None and ry is None:
        rx = ry = 0.0
    rx = ry if rx is None else rx
    ry = rx if ry is None else ry
    rx, ry = min(rx, w / 2), min(ry, h / 2)
    if not rx or not ry:
        return parse_path(f"M{x} {y}H{x + w}V{y + h}H{x}Z")
    return parse_path(f"M{x + rx} {y}H{x + w - rx}A{rx} {ry} 0 0 1 {x + w} {y + ry}V{y + h - ry}A{rx} {ry} 0 0 1 {x + w - rx} {y + h}"
                      f"H{x + rx}A{rx} {ry} 0 0 1 {x} {y + h - ry}V{y + ry}A{rx} {ry} 0 0 1 {x + rx} {y}Z")


def _points(s: str) -> list:
    v = [float(n) for n in re.findall(r"[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?", s)]
    return list(zip(v[0::2], v[1::2]))


def svg_paths(svg: str) -> list:
    """Every drawn element of one Lucide SVG as absolute sub-paths, in document order."""
    root = ET.fromstring(re.sub(r"<!--.*?-->", "", svg, flags=re.S))
    out = []
    for el in root.iter():
        tag = el.tag.split("}")[-1]
        a = el.attrib
        f = lambda k, d=0.0: float(a[k]) if k in a else d   # noqa: E731
        if tag == "path":
            out += parse_path(a["d"])
        elif tag == "circle":
            out += _ellipse(f("cx"), f("cy"), f("r"), f("r"))
        elif tag == "ellipse":
            out += _ellipse(f("cx"), f("cy"), f("rx"), f("ry"))
        elif tag == "rect":
            out += _rect(f("x"), f("y"), f("width"), f("height"), float(a["rx"]) if "rx" in a else None, float(a["ry"]) if "ry" in a else None)
        elif tag == "line":
            out.append([["M", f("x1"), f("y1")], ["L", f("x2"), f("y2")]])
        elif tag in ("polyline", "polygon"):
            pts = _points(a["points"])
            sub = [["M", *pts[0]]] + [["L", *p] for p in pts[1:]]
            out.append(sub + ([["Z"]] if tag == "polygon" else []))
        elif tag not in ("svg", "title", "desc", "g"):
            raise ValueError(f"unsupported SVG element <{tag}>")
    return [[[c[0]] + [round(v, ND) + 0.0 for v in c[1:]] for c in sub] for sub in out]


# ---------------------------------------------------------------- the vendoring

def feather_ids(license_text: str) -> set:
    """The Feather-derived ids the package's LICENSE names (the list after 'derived from the Feather project:')."""
    m = re.search(r"derived from the Feather project:\s*(.+?)\n\s*\n", license_text, re.S)
    return {x.strip() for x in m.group(1).replace("\n", " ").split(",")} if m else set()


def vendor(tgz: Path) -> dict:
    data = tgz.read_bytes()
    got = "sha512-" + base64.b64encode(hashlib.sha512(data).digest()).decode()
    if got != INTEGRITY:
        raise SystemExit(f"refused: {tgz} is not {PACKAGE} {VERSION} (integrity {got[:30]}..., expected {INTEGRITY[:30]}...)")
    policy = yaml.safe_load((DECK / "policy" / "icons.yaml").read_text())["icons"]
    ids = list(policy)
    deny, claims = _deny()
    bad = [i for i in ids if any(i == d or i.startswith(d + "-") for d in deny) or i in claims]
    if bad:
        raise SystemExit(f"refused: denied or claim-making ids in policy/icons.yaml: {bad}")
    with tarfile.open(fileobj=__import__("io").BytesIO(data), mode="r:gz") as tf:
        def read(name):
            return tf.extractfile(f"package/{name}").read().decode("utf-8")
        pkg = json.loads(read("package.json"))
        if pkg.get("name") != PACKAGE or pkg.get("version") != VERSION:
            raise SystemExit(f"refused: package.json says {pkg.get('name')} {pkg.get('version')}")
        lic = read("LICENSE")
        fe = feather_ids(lic)
        icons = {}
        for i in ids:
            paths = svg_paths(read(f"icons/{i}.svg"))
            icons[i] = {"paths": paths, "feather": i in fe}
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "icons.json").write_text(json.dumps(icons, separators=(",", ":"), sort_keys=True) + "\n")
    (OUT / "LICENSE").write_text(lic)
    src = {"what": "A 72-icon subset of Lucide as path data (absolute M, L, C, Z on a 24 x 24 grid), converted once by scripts/vendor_icons.py. "
                   "Update by running the script on a new tarball and changing the version and integrity there; never edit icons.json by hand.",
           "package": PACKAGE, "version": VERSION, "tarball": TARBALL_URL, "integrity": INTEGRITY,
           "license": pkg.get("license"), "license_note": "ISC (Lucide Icons and Contributors); icons derived from Feather are MIT (Cole Bemis). Both texts: LICENSE.",
           "homepage": pkg.get("homepage"), "ids": ids, "feather_derived": sorted(i for i in ids if i in fe),
           "icons_json_sha256": hashlib.sha256((OUT / "icons.json").read_bytes()).hexdigest(),
           "vendored": _dt.date.today().isoformat()}
    (OUT / "icons.source.json").write_text(json.dumps(src, indent=1) + "\n")
    return src


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    s = vendor(Path(sys.argv[1]))
    print(f"{len(s['ids'])} icons vendored ({len(s['feather_derived'])} Feather-derived) -> {OUT.relative_to(ROOT)}")
