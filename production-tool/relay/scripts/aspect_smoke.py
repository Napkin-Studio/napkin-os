#!/usr/bin/env python3
"""Frame-aspect smoke test (features/frame-aspect.clan): real Runway images at the snapped size, cropped by
the relay's own code to the true shape.

For each shape (16:9 and 9:16 by default) it asks Gemini 3 Pro for provider_ratio's size, measures what
comes back, and centre-crops it with aspect.crop_png, as the relay's _fetch does. It passes when Runway
returned the size asked for and the crop is exactly the shape (16:9 on Pro: 1344x768 in, 1344x756 out).

A DRY RUN by default: it prints the plan and the estimated cost, and sends nothing. Pass --live to spend
money (about $0.20 a shape on Gemini 3 Pro); --max-usd (default 1) is a hard cap. The key is read only
from RUNWAYML_API_SECRET:

    set -a; source .env; set +a
    uv run --python 3.12 python scripts/aspect_smoke.py --live

--save DIR keeps each original and its crop. Exit status is non-zero if any shape failed.
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from pathlib import Path
from typing import Callable, Optional

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from runway_common import (  # noqa: E402
    KEY_ENV, KEY_HELP, Assets, Budget, Runner, Tap, default_factory, estimate_usd, fetch_bytes, key_status, make_job,
)

from aspect import crop_png, measure, parse_ratio, same_shape  # noqa: E402
from director.director import provider_ratio  # noqa: E402
from providers import load_sheet  # noqa: E402

MODEL = "gemini_image3_pro"
PROMPT = "A jogger crossing a park path at golden hour, wide shot, photo."


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--live", action="store_true", help="spend money: really call Runway")
    p.add_argument("--shapes", default="16:9,9:16", help="comma-separated W:H shapes (default %(default)s)")
    p.add_argument("--max-usd", type=float, default=1.0, help="hard cap on spend (default %(default)s)")
    p.add_argument("--save", type=Path, help="a folder for each original and its crop")
    return p


def check_one(shape: tuple[int, int], data: bytes, asked: tuple[int, int]) -> tuple[bool, str, Optional[bytes]]:
    """Did Runway return the size asked for, and does the relay's crop give exactly the shape?"""
    got = measure(data)
    if got is None:
        return False, "the output is not a picture Pillow can read", None
    cropped = crop_png(data, shape)
    out = cropped[1] if cropped else got
    ok = got == asked and same_shape(out, shape)
    where = f"runway {got[0]}x{got[1]} (asked {asked[0]}x{asked[1]}) -> {out[0]}x{out[1]}"
    return ok, where + (f", cropped from {cropped[2][0]}x{cropped[2][1]}" if cropped else ", no crop"), cropped[0] if cropped else None


def main(argv: Optional[list[str]] = None, env: Optional[dict] = None, out: Callable[[str], None] = print,
         factory=default_factory, fetch: Callable[[str], bytes] = fetch_bytes, **runtime) -> int:
    args = parser().parse_args(argv)
    env = os.environ if env is None else env
    shapes = []
    for s in args.shapes.split(","):
        parsed = parse_ratio(s.strip())
        if not parsed:
            out(f"not a W:H shape: {s!r}")
            return 2
        shapes.append((s.strip(), parsed))
    sheet = load_sheet("runway")
    est = estimate_usd(sheet, "generate")
    out(f"{KEY_ENV}: {key_status(env)}")
    out("plan:")
    for name, _ in shapes:
        out(f"  generate {name:<8} {MODEL} at {provider_ratio('runway', 'generate', name, MODEL)}   ~${est:.2f}")
    out(f"estimated cost: ${est * len(shapes):.2f}   cap: ${args.max_usd:.2f}")
    if not args.live:
        out("dry run: nothing was sent. Add --live to spend.")
        return 0
    key = env.get(KEY_ENV)
    if not key:
        out(f"refusing to go live: {KEY_ENV} is missing. {KEY_HELP}")
        return 2

    assets, tap = Assets(), Tap(runtime.get("clock", time.monotonic))
    runner = Runner(factory(key, assets, tap), Budget(args.max_usd), tap=tap, **runtime)
    failed = 0
    for name, shape in shapes:
        size = provider_ratio("runway", "generate", name, MODEL)
        asked = parse_ratio(size)
        rec = runner.run(name, make_job(sheet, "generate", PROMPT, ratio=size))
        if rec["state"] != "done" or not rec.get("outputs"):
            failed += 1
            out(f"  {name:<6} {rec['state']}  {rec.get('error') or rec.get('reason') or 'no output'}")
            continue
        data = fetch(rec["outputs"][0])
        ok, said, cropped = check_one(shape, data, asked)
        failed += not ok
        out(f"  {name:<6} {'ok  ' if ok else 'FAIL'}  {said}")
        if args.save:
            args.save.mkdir(parents=True, exist_ok=True)
            tag = name.replace(":", "x")
            (args.save / f"{tag}-original.png").write_bytes(data)
            if cropped:
                (args.save / f"{tag}-cropped.png").write_bytes(cropped)
    out(f"spent about ${runner.budget.spent:.2f}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
