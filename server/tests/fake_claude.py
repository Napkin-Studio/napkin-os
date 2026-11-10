#!/usr/bin/env python3
"""A stand-in for the `claude` CLI for the harness's integration test: reads the call as the harness makes it (argv, the
system prompt from the pipe, the prompt on stdin) and answers with schema-valid junk and a fixed cost. No model.

Scripted behaviour, by environment variable:
  FAKE_MODE        is_error  an envelope with is_error true (an overload) and its own cost figure
                   crash     no output at all, exit 1 (no envelope)
                   hang      sleeps past any timeout
                   truncate  reports more output tokens than max_tokens allows (the harness cuts the text)
  FAKE_BAD_FIRST   the first answer to each call fails the schema
  FAKE_JUDE_FAIL   Jude (explain_flags) fails the proposition with an instruction (the real path then rewrites it)
  FAKE_RANK_FULL   a ranking names every candidate, best last-listed first; otherwise it names only [0]
  FAKE_MODEL_USAGE a model id to report in modelUsage instead of the one asked for
  FAKE_NO_MODEL_USAGE  leave modelUsage out
"""
import itertools
import json
import os
import re
import sys
import time

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


mode = os.environ.get("FAKE_MODE")
if mode == "crash":
    sys.exit(1)
if mode == "hang":
    time.sleep(60)
asked = args[args.index("--model") + 1] if "--model" in args else "unknown"
if mode == "is_error":
    os.write(1, json.dumps({"type": "result", "subtype": "success", "is_error": True, "result": "API Error: 529 overloaded_error",
                            "total_cost_usd": 0.0, "num_turns": 1, "usage": {"input_tokens": 0, "output_tokens": 0}}).encode())
    sys.exit(0)

bad_first = os.environ.get("FAKE_BAD_FIRST") and "That output does not validate" not in prompt
m = re.search(r"validates against this JSON Schema:\n(\{.*\})\s*$", system, re.S)
if m and bad_first:
    text = json.dumps({"unexpected": 1})
elif m:
    obj = gen(json.loads(m.group(1)))
    if os.environ.get("FAKE_RANK_FULL") and "ranking" in obj:
        obj["ranking"] = list(reversed(range(len(json.loads(re.search(r"<input>(.*)</input>", prompt, re.S).group(1))["candidates"]))))
    if os.environ.get("FAKE_JUDE_FAIL") and "Task: explain_flags" in prompt:       # also on the retry, whose prompt is a conversation
        obj["tests"] = {"single_minded_proposition": {"pass": False, "failed_test": "single_minded", "instruction": "Say it plainly."},
                        "insight": {"pass": True, "failed_test": "", "instruction": ""}}
        if "must_be_true" in system:                                                # J1's two extra answers
            obj["tests"]["single_minded_proposition"].update(must_be_true="It must be true.", counter_argument="A counter.")
    text = json.dumps(obj)
elif "Put together" in prompt:
    text = json.dumps({"groups": [[1, 2]]})
else:
    text = json.dumps({"better": "X", "reason": "fake"})
env = {"result": text, "total_cost_usd": 0.01, "is_error": False, "num_turns": 1,
       "usage": {"input_tokens": 10, "output_tokens": 5}}
if not os.environ.get("FAKE_NO_MODEL_USAGE"):
    env["modelUsage"] = {os.environ.get("FAKE_MODEL_USAGE") or asked: {"inputTokens": 10, "outputTokens": 5}}
if mode == "truncate":
    env["usage"]["output_tokens"] = 10 ** 6
    env["result"] = text * 3
os.write(1, json.dumps(env).encode())
