"""Local development only: the director and character cards on Claude Code's `claude -p`, under
the developer's own login, with no API key (owner, 2026-10-09: "use claude -p for the smart layer
for the demo"). Chosen by NAPKIN_MODEL_API=claude-cli in director/claude.py; never on Lambda.
Kept out of model.py, which is a copy of server/napkin/model.py and must not drift."""

from __future__ import annotations

import base64
import json

from director.model import ModelError, Reply


def cli_schema(schema):
    """The schema as the CLI's validator takes it: without the draft marker ($schema) and ids,
    which it tries to resolve and refuses. The port still validates the answer against the full one."""
    if isinstance(schema, dict):
        return {k: cli_schema(v) for k, v in schema.items() if k not in ("$schema", "$id")}
    if isinstance(schema, list):
        return [cli_schema(v) for v in schema]
    return schema


class ClaudeCliWire:
    """Local development only: Claude Code's `claude -p` under the developer's own login, for
    the director and character cards without an API key (owner, 2026-10-09: "use claude -p for
    the smart layer for the demo"). Never on Lambda: there is no CLI and no login there.

    One call is one `claude -p` run: the system prompt, the turns flattened into one message, the
    output schema (`--json-schema`), no tools but Read, and only for this call's pictures, written
    to a temporary folder (`--add-dir`). The port validates and retries as for any wire."""

    ALIASES = (("haiku", "haiku"), ("sonnet", "sonnet"), ("opus", "opus"))
    api = "claude-cli"  # model routes fall back to the anthropic ids, which map to the CLI's aliases

    def __init__(self, command: str = "claude", run=None):
        import subprocess
        self.command = command
        self.run = run or subprocess.run

    @classmethod
    def model_alias(cls, model: str) -> str:
        """`eu.anthropic.claude-haiku-4-5-…` -> `haiku`: the CLI picks the current model of that size."""
        low = (model or "").lower()
        return next((alias for key, alias in cls.ALIASES if key in low), model)

    def send(self, *, model, system, turns, schema, purpose, max_tokens, effort, timeout, headers=None,
             schema_mode="enforced") -> Reply:
        import subprocess
        import tempfile
        with tempfile.TemporaryDirectory(prefix="napkin-cli-") as tmp:
            parts, paths = [], []
            for t in turns:
                for i, im in enumerate(t.get("images") or []):
                    ext = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif"}.get(im["media_type"], "bin")
                    path = f"{tmp}/picture-{len(paths) + 1}.{ext}"
                    with open(path, "wb") as f:
                        f.write(base64.b64decode(im["data"]))
                    paths.append(path)
                parts.append(t["text"] if len(turns) == 1 else f"[{t['role']}]\n{t['text']}")
            message = "\n\n".join(parts)
            if paths:
                message = "Look at these pictures with the Read tool first: " + ", ".join(paths) + "\n\n" + message
            cmd = [self.command, "-p", "--no-session-persistence", "--output-format", "json",
                   "--model", self.model_alias(model), "--system-prompt", system,
                   "--json-schema", json.dumps({"type": "object", "properties": {"answer": cli_schema(schema)},
                                                "required": ["answer"], "additionalProperties": False})]
            cmd += ["--tools", "Read", "--allowedTools", "Read", "--add-dir", tmp] if paths else ["--tools", ""]
            try:
                done = self.run(cmd, input=message, capture_output=True, text=True, timeout=timeout)
            except subprocess.TimeoutExpired as e:
                raise ModelError(f"{purpose}: claude -p took longer than {timeout} s", "timeout") from e
            except OSError as e:
                raise ModelError(f"{purpose}: claude -p could not start ({e})", "server") from e
        try:
            out = json.loads(done.stdout or "")
        except ValueError as e:
            raise ModelError(f"{purpose}: claude -p said {(done.stderr or done.stdout or '')[:300]!r}", "server") from e
        if out.get("is_error"):
            said = str(out.get("result") or "")[:300]
            kind = "auth" if "log" in said.lower() and "in" in said.lower() else "server"
            raise ModelError(f"{purpose}: claude -p failed ({said})", kind)
        u = out.get("usage") or {}
        fresh, cw, cr = (int(u.get(k) or 0) for k in ("input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"))
        usage = (fresh + cw + cr, int(u.get("output_tokens") or 0)) if u else None
        # The schema went wrapped (the CLI makes it a tool, whose input may not be oneOf at the top).
        structured = out.get("structured_output")
        if isinstance(structured, dict) and "answer" in structured:
            structured = structured["answer"]
        text = json.dumps(structured) if structured is not None else out.get("result")
        return Reply(text, "ok", usage, breakdown={"fresh": fresh, "cache_write": cw, "cache_read": cr} if u else None)
