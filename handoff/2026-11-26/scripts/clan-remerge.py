#!/usr/bin/env python3
"""Resolve a merge conflict on a .clan feature record: take the incoming (develop) copy and
re-apply this branch's own build_log entries, decisions and last_check with the clan CLI.
Usage (inside a worktree mid-merge): clan-remerge.py features/<slug>.clan [incoming-ref]"""
import io, json, subprocess, sys, zipfile
import yaml

f = sys.argv[1]
incoming = sys.argv[2] if len(sys.argv) > 2 else "origin/develop"


def sh(*a, inp=None):
    return subprocess.run(a, input=inp, capture_output=True, check=True)


def load(ref):
    raw = sh("git", "show", f"{ref}:{f}").stdout
    z = zipfile.ZipFile(io.BytesIO(raw))
    data = yaml.safe_load(z.read("shared/data.yaml"))
    dc = yaml.safe_load(z.read("agent/decision-chain.yaml")) or []
    if isinstance(dc, dict):
        dc = next((v for v in dc.values() if isinstance(v, list)), [])
    return data, [d for d in dc if isinstance(d, dict)]


base_ref = sh("git", "merge-base", "HEAD", incoming).stdout.decode().strip()
b_data, b_dc = load(base_ref)
o_data, o_dc = load("HEAD")
t_data, t_dc = load(incoming)   # what the incoming side already holds is never added twice (a squash merge carries the branch's entries)
sh("git", "checkout", "--theirs", f)

key = lambda e: (str(e.get("commit")), e.get("summary"))
b_logs = {key(e) for e in b_data.get("build_log", [])} | {key(e) for e in t_data.get("build_log", [])}
new_logs = [e for e in o_data.get("build_log", []) if key(e) not in b_logs]
dkey = lambda d: (d.get("action"), d.get("rationale"), str(d.get("timestamp")))
b_dec = {dkey(d) for d in b_dc}
t_dec = {(d.get("action"), d.get("rationale")) for d in t_dc}
new_dec = [d for d in o_dc if dkey(d) not in b_dec and (d.get("action"), d.get("rationale")) not in t_dec and d.get("action") not in ("build step",)
           and not str(d.get("action", "")).startswith("checks ")]

# chronological order: decisions by timestamp interleaved with logs is not recoverable exactly;
# logs first in their order, then manual decisions oldest first
for e in new_logs:
    e = {"date": str(e["date"]), "commit": str(e["commit"]), "summary": e["summary"]}
    sh("clan", "patch-data", f, "-", "--append", "build_log", "--agent", "claude", "--action", "build step",
       "--rationale", e["summary"], "--quiet", inp=json.dumps({"build_log": [e]}).encode())
    print("logged", e["commit"])
for d in sorted(new_dec, key=lambda d: str(d.get("timestamp"))):
    sh("clan", "patch-decision", f, "--agent", d.get("agent", "claude"), "--action", d["action"],
       "--rationale", d["rationale"], "--quiet")
    print("decision", d["action"])
# every other top-level field this branch changed (open_questions, next_step, design, status, ...):
# 3-way per field. Unchanged on develop -> take the branch's value; both changed and a list ->
# develop's list plus the branch's additions; both changed otherwise -> the branch's value (logged).
t_data = yaml.safe_load(zipfile.ZipFile(f).read("shared/data.yaml"))
SKIP = {"build_log", "last_check", "$schema"}
for k, ov in o_data.items():
    if k in SKIP or ov == b_data.get(k):
        continue
    bv, tv = b_data.get(k), t_data.get(k)
    if tv == bv:
        nv = ov
    elif isinstance(ov, list) and isinstance(tv, list):
        bl = bv if isinstance(bv, list) else []
        nv = tv + [x for x in ov if x not in bl and x not in tv]
    else:
        nv = ov
        print("both changed, branch wins:", k)
    if nv == tv:
        continue
    sh("clan", "patch-data", f, "-", "--agent", "claude", "--action", f"re-apply {k} after merging develop",
       "--rationale", "the branch's change to this field, kept through the merge", "--quiet",
       inp=json.dumps({k: nv}, default=str).encode())
    print("field", k)
if o_data.get("last_check") != b_data.get("last_check") and o_data.get("last_check"):
    lc = o_data["last_check"]
    lc = {k: (str(v) if k in ("date", "commit") else v) for k, v in lc.items()}
    sh("clan", "patch-data", f, "-", "--agent", "claude", "--action", f"checks {lc.get('result')}",
       "--rationale", "re-applied after merging develop", "--quiet", inp=json.dumps({"last_check": lc}).encode())
    print("last_check", lc.get("commit"))
print(sh("clan", "validate", f).stdout.decode().splitlines()[0])
