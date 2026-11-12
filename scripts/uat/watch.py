"""Watch middleware jobs on a deployed stack: working, waiting on a person, slow, hung, done or failed.

    scripts/uat-watch                      every job today, one line each
    scripts/uat-watch --job job_ed21...    one job, stage by stage
    scripts/uat-watch --latest --follow    the newest job, re-read every few seconds until it ends
    scripts/uat-watch --user plu@pluto     only that person's jobs

It reads the same run log the middleware writes (server/napkin/runlog.py) through
GET /api/dogfood/runlog, signed in as one of Napkin's own mock accounts, and the job
list from GET /api/dogfood/export. No bodies are printed: client material stays put.

Verdicts (features/uat-loop.clan):
  done      job_end state done, no stage raised
  failed    job_end with a failed state, or done although a stage raised
  waiting   the last thing the job did was ask a person a question
  working   an event in the last --hang seconds
  hung      no event for longer than --hang seconds and no job_end
  slow      (flag) a stage whose wall time exceeds its model + search time by more than --slack seconds
"""
from __future__ import annotations

import argparse
import datetime as dt
import http.cookiejar
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ENVS = {"uat": "http://napkin-uat-web-126391466.eu-west-1.elb.amazonaws.com"}
# Only these may be used: mock rows from infra/scripts/accounts.uat.tsv, Napkin agency (the reader rule).
READERS = ("ann@napkin", "mock@napkin", "hello@napkin")
CACHE = Path(os.environ.get("XDG_CACHE_HOME", Path.home() / ".cache")) / "napkin-uat"


# ── Pure classification (tested in scripts/uat/test_watch.py) ─────────────────────────────

def parse_ts(s: str) -> dt.datetime:
    return dt.datetime.fromisoformat(s.replace("Z", "+00:00"))


def summarise(events: list[dict], now: dt.datetime, hang: float = 120.0, slack: float = 15.0) -> dict:
    """What a job is doing, from its run-log events (in order)."""
    if not events:
        return {"verdict": "unknown", "why": "no run log"}
    start, last = events[0], events[-1]
    stages, slow, raised = [], [], []
    for e in events:
        if e.get("ev") == "stage_end":
            other = e.get("secs", 0) - e.get("model_s", 0) - e.get("search_s", 0)
            row = {"stage": e.get("stage"), "secs": e.get("secs"), "model_s": round(e.get("model_s", 0), 1),
                   "search_s": round(e.get("search_s", 0), 1), "other_s": round(other, 1),
                   "cost": round(e.get("model_cost", 0) + e.get("search_cost", 0) + e.get("jev_cost", 0), 4)}
            stages.append(row)
            # Parallel calls can make model_s exceed wall time; only time nobody accounts for is "other".
            if other > slack:
                slow.append(row)
        if e.get("ev") == "gap" and e.get("reason") == "raised":
            raised.append({"stage": e.get("stage"), "detail": e.get("detail")})
        if e.get("ev") == "error":
            raised.append({"stage": e.get("stage"), "detail": e.get("detail") or e.get("error")})
    out = {"job": start.get("job"), "task": start.get("task"), "started": start.get("t"),
           "stages": stages, "slow": slow, "raised": raised, "last_ev": last.get("ev"),
           "last_stage": last.get("stage"), "events": len(events)}
    end = next((e for e in reversed(events) if e.get("ev") == "job_end"), None)
    if end:
        out["secs"] = end.get("secs")
        out["cost"] = round(sum(s["cost"] for s in stages), 4)
        state = end.get("state")
        if state != "done":
            out.update(verdict="failed", why=f"job_end state {state}: {end.get('summary') or end.get('error') or ''}".strip())
        elif raised:
            out.update(verdict="failed", why=f"ended done but {len(raised)} stage(s) raised: {raised[0]['detail']}")
        else:
            out.update(verdict="done", why=f"{end.get('secs')} s")
        return out
    idle = (now - parse_ts(last["t"])).total_seconds()
    out["idle_s"] = round(idle, 1)
    if last.get("ev") == "question":
        out.update(verdict="waiting", why=f"asked a person: {last.get('text')!r} {idle:.0f} s ago")
    elif idle > hang:
        out.update(verdict="hung", why=f"no event for {idle:.0f} s in stage {last.get('stage')} (last: {last.get('ev')})")
    else:
        out.update(verdict="working", why=f"stage {last.get('stage')}, last event {last.get('ev')} {idle:.0f} s ago")
    return out


def jobs_in_export(text: str, user: str | None = None) -> list[dict]:
    """Every job id the export mentions, newest last, with who started it and the doc."""
    seen: dict[str, dict] = {}
    for line in text.splitlines():
        try:
            e = json.loads(line)
        except ValueError:
            continue
        job = e.get("data", {}).get("job") if isinstance(e.get("data"), dict) else None
        job = job or e.get("job")
        if not job or (user and e.get("account") != user):
            continue
        row = seen.setdefault(job, {"job": job, "account": e.get("account"), "doc": e.get("doc"),
                                    "app": e.get("app"), "first": e.get("ts")})
        row["last"] = e.get("ts")
    return sorted(seen.values(), key=lambda r: r["first"] or "")


# ── HTTP ─────────────────────────────────────────────────────────────────────────────────

class Client:
    def __init__(self, base: str, account: str):
        if account not in READERS:
            raise SystemExit(f"refusing {account}: only Napkin's mock accounts {READERS} may read run logs")
        self.base, self.account = base.rstrip("/"), account
        CACHE.mkdir(parents=True, exist_ok=True)
        self.jar = http.cookiejar.MozillaCookieJar(str(CACHE / f"{account.replace('@', '_')}.jar"))
        if Path(self.jar.filename).exists():
            self.jar.load(ignore_discard=True)
        self.op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))

    def _get(self, path: str) -> tuple[int, str]:
        try:
            with self.op.open(self.base + path, timeout=30) as r:
                return r.status, r.read().decode()
        except urllib.error.HTTPError as e:
            return e.code, e.read().decode(errors="replace")

    def sign_in(self) -> None:
        body = json.dumps({"username": self.account}).encode()
        req = urllib.request.Request(self.base + "/api/auth/sign-in", body, {"content-type": "application/json"})
        with self.op.open(req, timeout=30) as r:
            if r.status != 200:
                raise SystemExit(f"sign-in as {self.account} failed: {r.status}")
        self.jar.save(ignore_discard=True)

    def get(self, path: str) -> str:
        code, text = self._get(path)
        if code == 401:
            self.sign_in()
            code, text = self._get(path)
        if code == 404:
            return ""
        if code != 200:
            raise SystemExit(f"GET {path}: {code} {text[:200]}")
        return text

    def runlog(self, job: str) -> list[dict]:
        text = self.get("/api/dogfood/runlog?" + urllib.parse.urlencode({"job": job}))
        return [json.loads(l) for l in text.splitlines() if l.strip()]

    def jobs(self, date: str, user: str | None) -> list[dict]:
        return jobs_in_export(self.get("/api/dogfood/export?" + urllib.parse.urlencode({"date": date})), user)


# ── Printing ─────────────────────────────────────────────────────────────────────────────

def line(s: dict, who: dict | None = None) -> str:
    flag = f" SLOW:{','.join(r['stage'] + '+' + str(r['other_s']) + 's' for r in s.get('slow', []))}" if s.get("slow") else ""
    acct = f" {who['account']}" if who else ""
    return f"{s.get('verdict', '?'):8} {s.get('job')} {s.get('task') or '':16}{acct} {s.get('why', '')}{flag}"


def detail(s: dict) -> str:
    rows = [line(s)]
    rows.append(f"  {'stage':12} {'wall':>7} {'model':>7} {'search':>7} {'other':>7} {'cost':>8}")
    for r in s.get("stages", []):
        mark = "  <- slow" if r in s.get("slow", []) else ""
        rows.append(f"  {r['stage']:12} {r['secs']:7.1f} {r['model_s']:7.1f} {r['search_s']:7.1f} {r['other_s']:7.1f} {r['cost']:8.4f}{mark}")
    for g in s.get("raised", []):
        rows.append(f"  raised in {g['stage']}: {g['detail']}")
    if "cost" in s:
        rows.append(f"  total cost {s['cost']} USD (estimate)")
    return "\n".join(rows)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="uat-watch", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--env", default="uat", choices=sorted(ENVS))
    ap.add_argument("--as", dest="account", default="ann@napkin")
    ap.add_argument("--job")
    ap.add_argument("--latest", action="store_true")
    ap.add_argument("--user", help="only jobs this account started")
    ap.add_argument("--date", default=dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d"))
    ap.add_argument("--follow", action="store_true", help="re-read until the job ends")
    ap.add_argument("--every", type=float, default=5.0)
    ap.add_argument("--hang", type=float, default=120.0, help="seconds without an event before a job is hung")
    ap.add_argument("--slack", type=float, default=15.0, help="unaccounted seconds per stage before it is slow")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)
    c = Client(os.environ.get("UAT_URL", ENVS[a.env]), a.account)

    if not a.job and not a.latest:
        rc = 0
        for j in c.jobs(a.date, a.user):
            s = summarise(c.runlog(j["job"]), dt.datetime.now(dt.timezone.utc), a.hang, a.slack)
            print(json.dumps({**j, **s}) if a.json else line(s, j))
            rc |= s.get("verdict") in ("hung", "failed")
        return 1 if rc else 0

    job = a.job
    if a.latest:
        js = c.jobs(a.date, a.user)
        if not js:
            print("no jobs today"); return 0
        job = js[-1]["job"]
    while True:
        s = summarise(c.runlog(job), dt.datetime.now(dt.timezone.utc), a.hang, a.slack)
        print(json.dumps(s) if a.json else detail(s), flush=True)
        if not a.follow or s.get("verdict") in ("done", "failed", "hung"):
            return 1 if s.get("verdict") in ("hung", "failed") else 0
        time.sleep(a.every)
        print()


if __name__ == "__main__":
    sys.exit(main())
