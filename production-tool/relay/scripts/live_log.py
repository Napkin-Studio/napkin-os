"""Follow the hackathon deploy as it happens: the relay's and the stitch's request and job lines from
CloudWatch, and the beta's record for a person, one readable line each, failures marked.

  AWS_PROFILE=napkin uv run --frozen --python 3.12 python scripts/live_log.py --name "Blue Herons/Maya"
  AWS_PROFILE=napkin uv run --frozen --python 3.12 python scripts/live_log.py --all --errors
  AWS_PROFILE=napkin uv run --frozen --python 3.12 python scripts/live_log.py --name "Blue Herons/Maya" --since 30m --no-follow

Only the hackathon deploy (infra/envs/hackathon): its two Lambda log groups and its bucket's dogfood/
record. It reads; it never writes. Keys and tokens are never in these lines (relay/service.py logs
none; dogfood.py records none).
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

ENV = os.environ.get("NAPKIN_ENV", "hackathon")
GROUPS = [f"/aws/lambda/napkin-{ENV}-relay", f"/aws/lambda/napkin-{ENV}-stitch"]
FAILED = {"failed", "cancelled", "uncertain"}
RED, YELLOW, DIM, RESET = "\033[31m", "\033[33m", "\033[2m", "\033[0m"


def since_ms(spec: str, now: float) -> int:
    """'30m', '2h', '45s', '1d' before now, in epoch milliseconds."""
    m = re.fullmatch(r"(\d+)([smhd])", spec.strip())
    if not m:
        raise SystemExit(f"--since takes 45s, 30m, 2h or 1d, not {spec!r}")
    secs = int(m.group(1)) * {"s": 1, "m": 60, "h": 3600, "d": 86400}[m.group(2)]
    return int((now - secs) * 1000)


def who(args) -> str | None:
    """The participant to follow: --participant, or --name 'Team/Name' (the workspace id), or None for all."""
    if args.participant:
        return args.participant
    if args.name:
        if "/" not in args.name:
            raise SystemExit("--name takes Team/Name, the team name and the name as people sign in with them")
        from service import participant_id
        return participant_id(*args.name.split("/", 1))
    return None


def parse(message: str) -> dict | None:
    """A relay JSON line, or None for a free-text line (a traceback, a provider's INFO line)."""
    s = message.strip()
    if not s.startswith("{"):
        return None
    try:
        return json.loads(s)
    except ValueError:
        return None


def is_failure(line: dict | None, text: str) -> bool:
    if line is None:
        return "Traceback" in text or text.startswith(("ERROR", "CRITICAL")) or "Exception" in text
    return int(line.get("status") or 200) >= 500 or line.get("state") in FAILED or bool(line.get("error")) and line.get("error") != "queue_full"


def fmt(ts_ms: int, group: str, line: dict | None, text: str, color: bool = True) -> str:
    when = datetime.fromtimestamp(ts_ms / 1000, timezone.utc).strftime("%H:%M:%S")
    src = "stitch" if group.endswith("-stitch") else "relay"
    if line is None:
        body = text.strip().splitlines()[0][:220]
    else:
        parts = [line.get("method", ""), line.get("route", ""), line.get("op", ""), line.get("state", ""),
                 f"{line.get('provider', '')}/{line.get('model', '')}" if line.get("provider") else "",
                 f"status {line['status']}" if "status" in line else "",
                 f"error {line['error']}" if line.get("error") else "",
                 f"{line['latencyMs']} ms" if "latencyMs" in line else "",
                 f"${line['costUsd']}" if line.get("costUsd") else "",
                 line.get("jobId", ""), line.get("participant", "")]
        body = "  ".join(p for p in parts if p)
    out = f"{when} {src:6} {body}"
    if not color:
        return out
    if is_failure(line, text):
        return f"{RED}{out}{RESET}"
    if line is not None and line.get("error") == "queue_full":
        return f"{YELLOW}{out}{RESET}"
    return out


def keep(line: dict | None, text: str, pid: str | None, errors_only: bool) -> bool:
    if errors_only and not is_failure(line, text):
        return False
    if pid is None:
        return True
    # A person's own lines; free-text failures have no participant, so they show whenever --errors is on.
    return (line is not None and line.get("participant") == pid) or (line is None and errors_only)


def dogfood_lines(s3, bucket: str, pid: str, day: str, seen: set) -> list[tuple[int, str]]:
    """New beta events for the person today, as (epoch ms, readable line)."""
    from dogfood import EVENTS
    out = []
    pages = s3.get_paginator("list_objects_v2").paginate(Bucket=bucket, Prefix=f"{EVENTS}{day}/{pid}/")
    for page in pages:
        for obj in page.get("Contents", []):
            if obj["Key"] in seen:
                continue
            seen.add(obj["Key"])
            body = s3.get_object(Bucket=bucket, Key=obj["Key"])["Body"].read().decode()
            for raw in body.splitlines():
                try:
                    e = json.loads(raw)
                except ValueError:
                    continue
                ts = e.get("ts") or ""
                try:
                    ms = int(datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp() * 1000)
                except ValueError:
                    ms = 0
                data = e.get("data") or {}
                extra = data.get("note") or data.get("message") or data.get("thumb") or ""
                out.append((ms, f"beta   {e.get('kind', '')} {e.get('name', '')} {extra}".rstrip()))
    return sorted(out)


def run(args, logs=None, s3=None, now=time.time, sleep=time.sleep, out=print) -> None:
    import boto3
    logs = logs or boto3.client("logs")
    pid = who(args)
    start = since_ms(args.since, now())
    seen: set[str] = set()
    seen_objects: set[str] = set()
    bucket = args.bucket or os.environ.get("BUCKET")
    if pid and bucket and s3 is None and not args.no_beta:
        s3 = boto3.client("s3")
    out(f"following {', '.join(GROUPS)}" + (f" for {args.name or pid} ({pid})" if pid else " for everyone")
        + (" — failures only" if args.errors else "") + ("" if args.follow else " (once)"))
    while True:
        lines = []
        for group in GROUPS:
            kw = {"logGroupName": group, "startTime": start}
            if pid and not args.errors:
                kw["filterPattern"] = f'{{ $.participant = "{pid}" }}'
            try:
                for page in logs.get_paginator("filter_log_events").paginate(**kw):
                    for ev in page.get("events", []):
                        if ev["eventId"] in seen:
                            continue
                        seen.add(ev["eventId"])
                        line = parse(ev["message"])
                        if keep(line, ev["message"], pid, args.errors):
                            lines.append((ev["timestamp"], fmt(ev["timestamp"], group, line, ev["message"], color=not args.plain)))
            except Exception as e:  # a log group not made yet (no stitch run): skip it, say anything else
                if type(e).__name__ != "ResourceNotFoundException":
                    raise
        if pid and s3 is not None and bucket:
            day = datetime.fromtimestamp(now(), timezone.utc).strftime("%Y-%m-%d")
            lines += [(ms, f"{datetime.fromtimestamp(ms / 1000, timezone.utc):%H:%M:%S} {text}") for ms, text in
                      dogfood_lines(s3, bucket, pid, day, seen_objects) if ms >= start]
        for _, text in sorted(lines):
            out(text)
        if not args.follow:
            return
        start = max(start, int(now() * 1000) - 60_000)  # overlap a minute: CloudWatch lines can land late
        sleep(args.every)


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    who_ = ap.add_mutually_exclusive_group(required=True)
    who_.add_argument("--name", help="Team/Name, as the person signed in (any case)")
    who_.add_argument("--participant", help="a participant id (p_…)")
    who_.add_argument("--all", action="store_true", help="everyone")
    ap.add_argument("--since", default="10m", help="start this far back: 45s, 30m, 2h, 1d (default 10m)")
    ap.add_argument("--errors", action="store_true", help="only failures: 5xx, failed or uncertain jobs, error codes, tracebacks")
    ap.add_argument("--no-follow", dest="follow", action="store_false", help="print what is there and stop")
    ap.add_argument("--every", type=float, default=3.0, help="seconds between checks when following (default 3)")
    ap.add_argument("--bucket", help="the deploy's bucket, for the beta record (default $BUCKET)")
    ap.add_argument("--no-beta", action="store_true", help="leave out the beta record")
    ap.add_argument("--plain", action="store_true", help="no colours")
    args = ap.parse_args(argv)
    try:
        run(args)
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
