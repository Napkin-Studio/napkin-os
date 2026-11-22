"""Transport spike (feature deck-vision-critic): can an image reach Claude through the Claude Code CLI?

    python3 -m deck.bench.spike_image --print-command          the exact command, nothing run
    python3 -m deck.bench.spike_image --yes-cost               one call, capped at $0.01, on a tiny invented picture

It builds a 64 x 64 PNG that is red on the left and blue on the right, sends it as one image content block through
``claude -p --input-format stream-json --output-format stream-json --verbose`` (the logged-in account: the API key is
stripped from the environment, as the retired brief_llm._chat_claude_cli did), and checks that the reply names both colours. The
picture is invented: this spike never carries client material. Client slides use the Napkin API key, never the login.
Standalone: brief_llm is not edited in phase 1. Exit 0 = image input works, 1 = it ran and did not, 2 = refused or not run.
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import zlib

CAP_USD = 0.01
MODEL = "claude-sonnet-5-5"
SYSTEM = "You describe pictures. Answer in one short sentence."
QUESTION = "Name the two colours in this picture, left and right."


def tiny_png(w: int = 64, h: int = 64) -> bytes:
    """A red-left, blue-right PNG, written without Pillow."""
    row = b"\x00" + b"\xdc\x1e\x1e" * (w // 2) + b"\x1e\x3c\xdc" * (w - w // 2)
    raw = row * h

    def chunk(t: bytes, d: bytes) -> bytes:
        c = struct.pack(">I", len(d)) + t + d
        return c + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


def command(cap: float = CAP_USD) -> list:
    return ["claude", "-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--model", MODEL,
            "--system-prompt", SYSTEM, "--tools", "", "--max-turns", "1", "--effort", "low", "--no-session-persistence",
            "--setting-sources", "", "--strict-mcp-config", "--max-budget-usd", f"{cap:g}"]


def message(png: bytes) -> str:
    """The one stream-json user line: an image block then a text block."""
    return json.dumps({"type": "user", "message": {"role": "user", "content": [
        {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": base64.standard_b64encode(png).decode()}},
        {"type": "text", "text": QUESTION}]}}) + "\n"


def judge(stdout: str) -> dict:
    """Read the CLI's stream-json lines: the result event's text, usage and cost, and whether both colours are named."""
    result = {}
    for line in stdout.splitlines():
        try:
            ev = json.loads(line)
        except ValueError:
            continue
        if ev.get("type") == "result":
            result = ev
    text = str(result.get("result") or "")
    low = text.lower()
    return {"ok": "red" in low and "blue" in low and not result.get("is_error"), "reply": text[:200], "is_error": bool(result.get("is_error")),
            "usage": result.get("usage"), "total_cost_usd": result.get("total_cost_usd"), "num_turns": result.get("num_turns")}


def card() -> str:
    return (f"COST CARD (transport spike)\n  1 call, {MODEL}, a 64 x 64 invented picture + one sentence, through the Claude Code login\n"
            f"  expected: under $0.005; hard cap --max-budget-usd {CAP_USD}\n  no client material; the API key is stripped from the environment\n")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--print-command", action="store_true")
    ap.add_argument("--yes-cost", action="store_true", help="the cost card was shown and accepted")
    a = ap.parse_args(argv)
    print(card())
    if a.print_command or not a.yes_cost:
        print("run (from an empty folder):\n  " + " ".join(f"'{c}'" if (c == "" or " " in c) else c for c in command()) + "   < one stream-json line (see message())")
        print("or: python3 -m deck.bench.spike_image --yes-cost")
        return 2
    if not shutil.which("claude"):
        print("claude CLI not on PATH", file=sys.stderr)
        return 2
    env = {k: v for k, v in os.environ.items() if k != "ANTHROPIC_API_KEY"}
    with tempfile.TemporaryDirectory(prefix="napkin-spike-") as cwd:
        p = subprocess.run(command(), input=message(tiny_png()), capture_output=True, text=True, timeout=180, env=env, cwd=cwd)
    out = judge(p.stdout)
    out["exit"] = p.returncode
    if p.returncode and not out["reply"]:
        out["stderr"] = p.stderr[:300]
    print(json.dumps(out, indent=1))
    return 0 if out["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
