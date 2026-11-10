#!/usr/bin/env python3
"""A stand-in for the `claude` CLI for the harness's integration test: reads the call as the harness makes it (argv, the
system prompt from the pipe, the prompt on stdin) and answers with schema-valid junk and a fixed cost. No model."""
import itertools
import json
import os
import re
import sys

args = sys.argv[1:]
system = ""
if "--system-prompt-file" in args:
    with open(args[args.index("--system-prompt-file") + 1]) as f:
        system = f.read()
prompt = sys.stdin.read()
n = itertools.count(1)
seed = abs(hash(prompt)) % 1000


def gen(sch, name=""):
    if "anyOf" in sch:
        return gen(next(b for b in sch["anyOf"] if b.get("type") != "null"), name)
    if "enum" in sch:
        return sch["enum"][0]
    t = sch.get("type")
    if t == "object":
        return {k: gen(v, k) for k, v in (sch.get("properties") or {}).items() if k in sch.get("required", [])}
    if t == "array":
        k = min(sch.get("maxItems", 3), max(sch.get("minItems", 0), 3))
        if name in ("ranking",):
            return [0]
        if name in ("cites", "losers", "parts", "dimensions", "questions"):
            return []
        return [gen(sch["items"], name) for _ in range(k)]
    if t == "boolean":
        return name == "pass"
    if t in ("integer", "number"):
        return 0
    return f"Fake text {seed}-{next(n)} for {name}"


bad_first = os.environ.get("FAKE_BAD_FIRST") and "That output does not validate" not in prompt
m = re.search(r"validates against this JSON Schema:\n(\{.*\})\s*$", system, re.S)
if m and bad_first:
    text = json.dumps({"unexpected": 1})
elif m:
    text = json.dumps(gen(json.loads(m.group(1))))
elif "Put together" in prompt:
    text = json.dumps({"groups": [[1, 2]]})
else:
    text = json.dumps({"better": "X", "reason": "fake"})
os.write(1, json.dumps({"result": text, "total_cost_usd": 0.01, "is_error": False, "num_turns": 1,
                        "usage": {"input_tokens": 10, "output_tokens": 5}}).encode())
