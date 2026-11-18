#!/usr/bin/env python3
"""One command, one backend, knowledge included:

    python3 serve.py                 # then: cd app && npm install && npx tauri dev
    python3 serve.py --claude-code   # the full engine, every Claude call on your Claude Code login
    python3 serve.py --api           # the full engine on the API key (fails if the key has no credit)
    python3 serve.py --mock-agent    # the old lightweight mock agent, on your Claude Code login

With no flag it picks the backend for you (engine/.env is read first, never overriding the
shell), always the full engine pipeline (Loops 1-7, golden fill):
  * ANTHROPIC_API_KEY set -> the API.
  * no Anthropic key but the `claude` CLI installed and logged in -> your Claude Code login,
    as --claude-code.
  * another chat key only -> the engine, which stops with a clear error (the chain is
    Claude-only unless BRIEF_ALLOW_NONCLAUDE=1).
  * nothing -> tells you the ways to fix that, and exits.
Until 2026-09-29 the no-key case started the mock-agent, a second backend with its own
prompt and no checks (audit C7), and only the shell was checked, so keys kept in
engine/.env were missed (N10). --mock-agent still starts it on request.

"Your Claude Code login" is the one local model backend (features/model-mock.clan):
`scripts/model-local` starts mock-backend on 127.0.0.1:8797 (MODEL_LOCAL_PORT for another
port) unless it is up, and the backend gets that environment (ANTHROPIC_BASE_URL,
ANTHROPIC_API_KEY=local, ...), so the engine and the mock agent call the Messages API as they
do in production and `claude -p` answers. Until 2026-10-15 each had its own `claude -p`
wrapper (BRIEF_CLAUDE_TRANSPORT=cli/auto, ADR 0005, superseded).

NAPKIN_BACKEND overrides all of this for a deployment: `engine` starts the engine, `api`
the mock agent on the Messages API with the key it is given (it refuses to start without one).

The knowledge needs no setup in any case: paraphrased pack digests are
committed at engine/packs_dist/ and load automatically. (Vector retrieval via
Qdrant is a maintainer-side upgrade; nothing here requires it.)
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CHAT_KEYS = ("GROQ_API_KEY", "CEREBRAS_API_KEY", "NVIDIA_API_KEY",
             "GEMINI_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY")
ENGINE_SERVER = ROOT / "engine" / "agent-server" / "server.py"
MOCK_SERVER = ROOT / "mock-agent" / "server.py"
MODEL_LOCAL = ROOT / "scripts" / "model-local"


def _local_model_env() -> dict:
    """Start the one local model backend unless it is up, and return the environment that
    points a service at it (scripts/model-local env --json)."""
    subprocess.run([str(MODEL_LOCAL), "start"], check=True)
    out = subprocess.run([str(MODEL_LOCAL), "env", "--json"], check=True, capture_output=True, text=True)
    return json.loads(out.stdout)


def _engine_env(mode: "str | None") -> dict:
    """The environment for the engine server: digest grounding on by default, and, for
    mode `local`, the local model backend's variables (Claude on the Claude Code login)."""
    env = {**os.environ}
    env.setdefault("BRIEF_LOOPS37", "1")   # digest grounding on by default
    env.setdefault("BRIEF_GOLDEN", "1")
    if mode == "local":
        env.update(_local_model_env())
    return env


def _run_engine(mode: "str | None", why: str) -> int:
    """Start the full engine pipeline server on :8787, on the API or the local model backend."""
    shown = {"local": "your Claude Code login (scripts/model-local)", "api": "the API key"}.get(mode, "as configured")
    print(f"[serve] {why} -> engine pipeline (digest-grounded) on :8787, Claude via {shown}")
    return subprocess.call([sys.executable, str(ENGINE_SERVER)], env=_engine_env(mode))


def _run_mock() -> int:
    """Start the lightweight mock agent on :8787, drafting through the local model backend
    (your Claude Code login): it exists to use the login, so a key in the shell is not used."""
    print("[serve] mock-agent (digest-grounded) on :8787, Claude via your Claude Code login (scripts/model-local)")
    env = {**os.environ, **_local_model_env()}
    return subprocess.call([sys.executable, str(MOCK_SERVER)], env=env)


def choose(env: dict, has_claude: bool) -> "tuple[str, str | None, str]":
    """What a run with no flag starts: ("engine", mode, why) with mode `api`, `local` (the
    local model backend on the Claude Code login) or None, or ("none", None, "") when there is
    no way to reach a model. Pure, so the choice is testable."""
    if env.get("ANTHROPIC_API_KEY"):
        return "engine", "api", "ANTHROPIC_API_KEY found"
    if has_claude:
        return "engine", "local", "no Anthropic key, Claude Code installed"
    key = next((k for k in CHAT_KEYS if env.get(k)), None)
    if key:
        # The engine's chain is Claude-only by default (2026-09-25): this stops with a clear
        # error instead of a brief written by another model, unless BRIEF_ALLOW_NONCLAUDE=1.
        return "engine", None, f"{key} found"
    return "none", None, ""


def _load_engine_env() -> None:
    """Read engine/.env into this process (never overriding the shell), as the engine does,
    so the choice below sees the same keys the engine will."""
    sys.path.insert(0, str(ROOT / "engine"))
    try:
        import engine_env
        engine_env.load()
    except Exception as e:  # noqa: BLE001 — a missing or odd .env never blocks start-up
        print(f"[serve] engine/.env not read: {e}", file=sys.stderr)


def main(argv=None) -> int:
    """Pick the backend from the flag, or automatically when no flag is given."""
    ap = argparse.ArgumentParser(description="Start the Napkin Studio backend on :8787.")
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--claude-code", action="store_true",
                   help="full engine; every Claude call on your Claude Code login, through the local model "
                        "backend (scripts/model-local)")
    g.add_argument("--api", action="store_true", help="full engine; Claude calls use ANTHROPIC_API_KEY")
    g.add_argument("--mock-agent", action="store_true",
                   help="the lightweight mock agent instead of the engine, on your Claude Code login")
    a = ap.parse_args(argv)

    # What a deployment sets; no guessing, and a misconfigured host fails loudly.
    backend = os.environ.get("NAPKIN_BACKEND", "").strip().lower()
    if backend == "engine":
        return _run_engine(None, "NAPKIN_BACKEND=engine")
    if backend == "api":
        print("[serve] NAPKIN_BACKEND=api -> mock agent, Messages API only, on :8787")
        return subprocess.call([sys.executable, str(MOCK_SERVER)], env={**os.environ})

    if a.mock_agent:
        if not shutil.which("claude"):
            sys.exit("[serve] --mock-agent needs the `claude` CLI installed and logged in.")
        return _run_mock()
    if a.claude_code:
        if not shutil.which("claude"):
            sys.exit("[serve] --claude-code needs the `claude` CLI installed and logged in.")
        return _run_engine("local", "--claude-code")
    if a.api:
        return _run_engine("api", "--api")

    _load_engine_env()
    kind, transport, why = choose(dict(os.environ), bool(shutil.which("claude")))
    if kind == "engine":
        return _run_engine(transport, why)
    sys.exit("[serve] no backend available. Either:\n"
             "  1. install Claude Code and log in  (https://claude.ai/code), then run with --claude-code, or\n"
             "  2. export any one chat key: " + " / ".join(CHAT_KEYS))


if __name__ == "__main__":
    raise SystemExit(main())
