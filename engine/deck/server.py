#!/usr/bin/env python3
"""The Deck Maker engine server: run_deck behind a small HTTP port, one segment at a time, stopping at each gate.

    python3 -m deck.server                      # from engine/; listens on 127.0.0.1:8793

The middleware's ``build_deck`` task calls it (features/deck-maker-server.clan); nothing else does. It holds no document: the
caller sends the inputs and the person's approvals, and the server decides how far to run. The stage outputs are kept in a
folder per document and inputs (a cache: a missing cache never invents output, it runs again or refuses), so a run resumes
where the last segment stopped and recorded stages replay for free.

Routes (JSON; failures are non-2xx with ``{"error": {"type", "message"}}``, never a 200 with an error in it)::

    GET  /status                 what is on and what is busy
    POST /run                    {doc, inputs, approvals, mode, render?}: start the next segment of this document's run
    GET  /run/<doc>              the run so far: state, the run object the screens read, and once built the payload
    GET  /file/<doc>/<name>      a finished file (deck.html, deck.pptx, deck.pdf, report.json)

Env (all optional)::

    NAPKIN_DECK_PORT       listen port (default 8793; 8787 is the agent-server, 8788 the live relay, 8795 the middleware)
    NAPKIN_DECK_DATA       where the per-document folders go (default ./deck-runs)
    NAPKIN_DECK_REPLAY     a folder of recorded stage files: with it, mode "replay" replays them, paced by nothing, free
    NAPKIN_DECK_LIVE       1 to allow mode "live": paid model calls (about 0.65 to 1.25 USD a deck). Off by default
    NAPKIN_DECK_MAX_USD    the most one run may spend live (default 2.00); the run stops, with its message, at the cap

The gates: storyline (after stage b), territories (after c), idea (after d); an investor deck has the storyline only (after i).
A gate is held until the request carries the person's approval of it AND that gate's stage output already existed when the request
arrived, so an approval of an earlier run never skips a gate of a new one. After the last gate the engine goes on by itself.
"""
from __future__ import annotations

import contextlib
import hashlib
import io
import json
import os
import shutil
import sys
import threading
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

from . import inputs as inputs_mod
from . import run_deck, run_state as rs

#: The stage files each gate's stage writes, and what a replay copies in for each step. Order is the pipeline's.
STAGE_FILES = {"a0": ("a0_intake.json",), "a": ("a_requirements.json",), "b": ("b_storyline.json", "insight_judge.json"),
               "c": ("c_territories.json",), "d": ("d_idea.json",), "i": ("i_investor.json",), "final": ("fit.json", "e_copy.json", "red_team.json")}
ORDER = {"agency": ["a0", "a", "b", "c", "d", "final"], "investor": ["a0", "i", "final"]}
#: The gate after each stage, per deck kind.
PLAN = {"agency": [("b", "storyline"), ("c", "territories"), ("d", "idea")], "investor": [("i", "storyline")]}
KINDS = tuple(PLAN)
SERVED = ("deck.html", "deck.pptx", "deck.pdf", "report.json")
CONTENT = {".html": "text/html; charset=utf-8", ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
           ".pdf": "application/pdf", ".json": "application/json"}


class Refused(Exception):
    """A request the server will not run: carries the HTTP status and an error type for the caller."""

    def __init__(self, status: int, kind: str, message: str):
        super().__init__(message)
        self.status, self.kind, self.message = status, kind, message


class Cap:
    """The per-run cost cap: the paid calls of one live run add up here, and the next call is refused once they pass the cap."""

    def __init__(self, max_usd: float, already: float = 0.0):
        self.max_usd, self.spent = float(max_usd), float(already)

    def check(self) -> None:
        if self.spent >= self.max_usd:
            raise Refused(402, "cost_cap", f"The run stopped at its cost cap of {self.max_usd:.2f} USD (spent {self.spent:.2f}). "
                                           "Raise NAPKIN_DECK_MAX_USD to go on; what was written stays.")

    def add(self, usd) -> None:
        try:
            self.spent += float(usd or 0)
        except (TypeError, ValueError):
            pass


class Settings:
    def __init__(self, env=None):
        e = os.environ if env is None else env
        self.port = int(e.get("NAPKIN_DECK_PORT") or 8793)
        self.data = Path(e.get("NAPKIN_DECK_DATA") or "deck-runs")
        self.replay = Path(e["NAPKIN_DECK_REPLAY"]) if e.get("NAPKIN_DECK_REPLAY") else None
        self.live = (e.get("NAPKIN_DECK_LIVE") or "").strip() == "1"
        self.max_usd = float(e.get("NAPKIN_DECK_MAX_USD") or 2.0)


def safe_name(doc) -> str:
    """A document id as a folder name: word characters, dots and dashes only, and not hidden."""
    d = str(doc or "")
    if not d or d.startswith(".") or not all(c.isalnum() or c in "-_." for c in d):
        raise Refused(400, "bad_doc", "doc must be an id of letters, digits, dots, dashes and underscores")
    return d


def inputs_key(inp: dict) -> str:
    """What a run's cache is keyed by: the inputs that decide its stage outputs. Change one and the run starts again."""
    p = inp.get("prompt") or {}
    blob = json.dumps({"p": [p.get("text", ""), p.get("client", ""), p.get("project", ""), p.get("agency", "")],
                       "k": inp.get("kind", "agency"), "f": inp.get("format", "pitch")}, sort_keys=True)
    return hashlib.sha256(blob.encode()).hexdigest()[:16]


def validate_request(body: dict, settings: Settings) -> dict:
    """The request, checked: raises Refused (400, 403, 409) for what the server will not run."""
    if not isinstance(body, dict):
        raise Refused(400, "bad_request", "the body must be a JSON object")
    doc = safe_name(body.get("doc"))
    inp = body.get("inputs") or {}
    prompt = inp.get("prompt") or {}
    kind = inp.get("kind") or "agency"
    if kind not in KINDS:
        raise Refused(400, "unsupported_kind", f"deck kind {kind!r} is not run by this server yet (it runs {', '.join(KINDS)})")
    if inp.get("format", "pitch") not in ("pitch", "full"):
        raise Refused(400, "bad_request", "format must be pitch or full")
    if not str(prompt.get("text") or "").strip():
        raise Refused(400, "no_inputs", "give the deck something to build from: the prompt text is empty")
    mode = body.get("mode") or ("live" if settings.live and not settings.replay else "replay")
    if mode not in ("replay", "live"):
        raise Refused(400, "bad_request", "mode must be replay or live")
    if mode == "live" and not settings.live:
        raise Refused(403, "live_off", "live runs spend money and are off: set NAPKIN_DECK_LIVE=1 to allow them")
    if mode == "replay" and not (settings.replay and settings.replay.is_dir()):
        raise Refused(409, "no_recording", "there is no recording to replay and live is not asked for: set NAPKIN_DECK_REPLAY to a folder of recorded stages")
    approvals = body.get("approvals") or {}
    for gate, a in approvals.items():
        d = (a or {}).get("decision", "approve")
        if d != "approve":
            raise Refused(400, "not_supported", f"a '{d}' decision at the {gate} gate is recorded but the engine cannot act on it yet: only approve goes on")
    return {"doc": doc, "inputs": inp, "prompt": prompt, "kind": kind, "format": inp.get("format", "pitch"), "mode": mode,
            "approvals": approvals, "render": body.get("render", True) is not False}


def plan_segment(kind: str, present: set[str], approvals: dict) -> tuple[str | None, str | None]:
    """How far to run: (until, held). ``until`` is the stage to stop after (None: the last segment); ``held`` a gate already waiting.
    A gate goes on only when the person approved it AND its stage output existed already, so an old approval never skips a new gate."""
    for stage, gate in PLAN[kind]:
        fn = STAGE_FILES[stage][0]
        if fn not in present:
            return stage, None
        a = approvals.get(gate)
        if not a or a.get("decision", "approve") != "approve":
            return None, gate
    return None, None


class Doc:
    """One document's run: its folder, what is running, and what the last segment said."""

    def __init__(self, root: Path, name: str):
        self.name, self.root = name, root
        self.thread: threading.Thread | None = None
        self.state, self.held, self.error, self.current, self.started = "draft", None, None, None, 0.0
        self.notices: list[str] = []
        self.req: dict | None = None
        self.folder: Path | None = None
        self.summary: dict | None = None
        self.pay: dict | None = None
        self.cost = 0.0

    @property
    def stages(self) -> Path:
        return (self.folder or self.root) / "stages"

    @property
    def out(self) -> Path:
        return (self.folder or self.root) / "out"


class Server:
    def __init__(self, settings: Settings):
        self.s = settings
        self.lock = threading.RLock()
        self.docs: dict[str, Doc] = {}
        self.busy: str | None = None   # one segment at a time: run_deck keeps process-wide state (BRIEF_CLI_EFFORT, the model ledger)

    # -- routes --
    def status(self) -> dict:
        return {"ok": True, "live": self.s.live, "replay": bool(self.s.replay and self.s.replay.is_dir()), "max_usd": self.s.max_usd, "busy": self.busy}

    def run(self, body: dict) -> dict:
        req = validate_request(body, self.s)
        with self.lock:
            if self.busy:
                raise Refused(409, "job_state", f"a run is already going ({self.busy}): the engine runs one segment at a time")
            d = self.docs.setdefault(req["doc"], Doc(self.s.data / req["doc"], req["doc"]))
            d.folder = self.s.data / req["doc"] / inputs_key(req["inputs"])
            d.stages.mkdir(parents=True, exist_ok=True)
            d.req, d.notices, d.error, d.pay = req, [], None, None
            present = {p.name for p in d.stages.glob("*.json")}
            until, held = plan_segment(req["kind"], present, req["approvals"])
            self.apply_pick(d, req, present)
            if held:
                d.state, d.held, d.current = "gate", held, None
                d.cost = rs.spent(d.stages)
                self.write_status(d)
                return self.view(d)
            if req["mode"] == "live":
                Cap(self.s.max_usd, rs.spent(d.stages)).check()
            if until is None and req["render"] and not (shutil.which("soffice") and shutil.which("pdftoppm")):
                raise Refused(409, "no_renderer", "the last step builds the PowerPoint, the web deck and the PDF and needs LibreOffice (soffice) and "
                                                  "poppler (pdftoppm) on this machine; ask for render false to stop at the deck without the files")
            d.state, d.held, d.current, d.started = "building", None, None, time.time()
            self.busy = d.name
            self.write_status(d)
            d.thread = threading.Thread(target=self.segment, args=(d, req, until), daemon=True, name=f"deck-{d.name}")
            d.thread.start()
            return self.view(d)

    def get(self, doc: str) -> dict:
        d = self.docs.get(safe_name(doc))
        if d is None:
            raise Refused(404, "no_run", "no run for this document on this server")
        return self.view(d)

    def file(self, doc: str, name: str) -> tuple[bytes, str]:
        d = self.docs.get(safe_name(doc))
        if d is None or name not in SERVED:
            raise Refused(404, "no_file", "no such file")
        p = d.out / name
        if not p.is_file():
            raise Refused(404, "no_file", f"{name} has not been written")
        return p.read_bytes(), CONTENT.get(p.suffix, "application/octet-stream")

    # -- the view the caller reads --
    def view(self, d: Doc) -> dict:
        with self.lock:   # one snapshot: the segment's thread changes the state under this lock, and a view must not mix two states
            return self._view(d)

    def _view(self, d: Doc) -> dict:
        live = bool(d.req and d.req["mode"] == "live")
        elapsed = time.time() - d.started if d.state == "building" else 0.0
        cur = d.current or self.guess_step(d)
        run = rs.run_object(state=d.state, stages=d.stages, summary=d.summary, current=cur, held=d.held, cost=(rs.spent(d.stages) if live else None),
                            error=d.error, validation=(d.pay or {}).get("validation"), slow=rs.is_slow(cur, elapsed),
                            written=[f"{k}" for k in (d.pay or {}).get("exports", {})], done=(d.pay or {}).get("done"))
        out = {"doc": d.name, "state": d.state, "run": run, "notices": list(d.notices), "mode": d.req["mode"] if d.req else None}
        if d.state == "done" and d.pay:
            out["payload"] = d.pay
        if d.error:
            out["error"] = d.error
        return out

    def guess_step(self, d: Doc) -> str | None:
        """The step under way, from which stage files exist: the first one a segment up to its stop has still to write."""
        if d.state != "building" or not d.req:
            return None
        present = {p.name for p in d.stages.glob("*.json")}
        for key in ORDER[d.req["kind"]]:
            if key == "final":
                break
            if key == "a0" and "a0_intake.json" not in present and not (d.summary or {}).get("needs_intake", False):
                continue
            if STAGE_FILES[key][0] not in present:
                return key
            if key == "b" and "insight_judge.json" not in present and (d.summary or {}).get("candidates"):
                return "insight_judge"
        for key in ("fit", "e", "red_team"):
            if {"fit": "fit.json", "e": "e_copy.json", "red_team": "red_team.json"}[key] not in present:
                return key
        return "validate" if not (d.out / "deck.json").exists() else "render_pptx"

    # -- one segment, in a thread --
    def segment(self, d: Doc, req: dict, until: str | None) -> None:
        try:
            self.seed(d, req, until)
            inp = self.load_inputs(d, req)
            d.summary = {**rs.inputs_summary(inp), "needs_intake": run_deck._needs_intake(inp)}
            rep = self.call_engine(d, req, until)
            with self.lock:
                if until:
                    d.state, d.held = "gate", next(g for s, g in PLAN[req["kind"]] if s == until)
                else:
                    d.pay = rs.payload(d.out, rep, inp, live=req["mode"] == "live")
                    d.state, d.held = "done", None
                d.error, d.cost = None, rs.spent(d.stages)
        except Refused as e:
            self.fail(d, e.message, retryable=e.kind != "cost_cap")
        except BaseException as e:   # noqa: BLE001 - a failing engine ends the job as failed with its message, never a mock success
            traceback.print_exc()
            self.fail(d, f"{type(e).__name__}: {e}"[:600] if not isinstance(e, SystemExit) else f"the engine refused the run: {e.code}"[:600], retryable=True)
        finally:
            with self.lock:
                self.busy = None
                self.write_status(d)

    def load_inputs(self, d: Doc, req: dict):
        """The engine's own reading of the inputs (no model): what the rows under 'Read the inputs' say, and what the evidence resolves against."""
        answers, verified = run_deck._read_answers(None)
        return inputs_mod.load(None, None, d.stages / "doc_facts.json", [], prompt_text=str(req["prompt"].get("text") or "").strip(),
                               answers=answers, verified=verified)

    def seed(self, d: Doc, req: dict, until: str | None) -> None:
        """Replay only: copy the recorded stage files for the stages up to the stop into the cache, as a live run would write them."""
        if req["mode"] != "replay":
            return
        order = ORDER[req["kind"]]
        stop = order.index(until) if until in order else len(order) - 1
        for key in order[: stop + 1]:
            for fn in STAGE_FILES[key]:
                src = self.s.replay / fn
                if src.exists() and not (d.stages / fn).exists():
                    shutil.copyfile(src, d.stages / fn)

    def apply_pick(self, d: Doc, req: dict, present: set[str]) -> None:
        """A territory picked at gate 2 goes into stage c before stage d runs. A replay cannot rewrite stage d: it says so."""
        pick = ((req["approvals"].get("territories") or {}).get("picked"))
        c = rs.stage_file(d.stages, "c_territories.json")
        if not pick or not c or "c_territories.json" not in present or "d_idea.json" in present:
            return
        if not any(t.get("id") == pick for t in c.get("territories") or []) or pick == c.get("chosen"):
            return
        if req["mode"] == "live":
            c["chosen"], c["chosen_by"] = pick, "picked by the person at gate 2"
            (d.stages / "c_territories.json").write_text(json.dumps(c, indent=1, ensure_ascii=False))
        else:
            name = lambda i: next((t.get("name") for t in c.get("territories") or [] if t.get("id") == i), i)  # noqa: E731
            d.notices.append(f"Replay: you picked '{name(pick)}'. The recorded idea was written from '{name(c.get('chosen'))}', so the next steps show that recording.")

    def call_engine(self, d: Doc, req: dict, until: str | None) -> dict:
        p = req["prompt"]
        argv = ["--prompt-text", str(p.get("text") or ""), "--stages", str(d.stages), "--client", str(p.get("client") or "[Client]"),
                "--project", str(p.get("project") or "[Project]"), "--out", str(d.out), "--kind", req["kind"], "--format", req["format"], "--no-qa"]
        if p.get("agency"):
            argv += ["--agency", str(p["agency"])]
        if until:
            argv += ["--until", until]
        elif not req["render"]:
            argv += ["--until", "deck"]
        if req["mode"] == "live":
            argv.append("--live")
        err = io.StringIO()
        restore = self.guard_live(d, req) if req["mode"] == "live" else None
        try:
            with contextlib.redirect_stderr(err), contextlib.redirect_stdout(io.StringIO()):
                return run_deck.main(argv)
        except SystemExit as e:
            raise Refused(400, "engine_refused", (err.getvalue().strip().splitlines() or [str(e.code)])[-1]) from e
        finally:
            if restore:
                restore()

    def guard_live(self, d: Doc, req: dict):
        """Live only: every paid model call first asks the cap, and adds what it cost, so a run stops at NAPKIN_DECK_MAX_USD."""
        from . import stages
        cap = Cap(self.s.max_usd, rs.spent(d.stages))
        orig = stages._call

        def call(stage, user, system):
            cap.check()
            obj, usage = orig(stage, user, system)
            cap.add((usage or {}).get("usd"))
            return obj, usage
        stages._call = call
        return lambda: setattr(stages, "_call", orig)

    def fail(self, d: Doc, message: str, retryable: bool) -> None:
        with self.lock:
            cur = d.current or self.guess_step(d) or "load"
            row = rs.STEP_ROW.get(cur, "inputs")
            d.state, d.held, d.pay = "failed", None, None
            d.error = {"stage": row, "message": message, "retryable": retryable}

    def write_status(self, d: Doc) -> None:
        try:
            (d.folder or d.root).mkdir(parents=True, exist_ok=True)
            (d.folder / "status.json").write_text(json.dumps({"state": d.state, "held": d.held, "error": d.error, "notices": d.notices}, indent=1))
        except OSError:
            pass


def make_handler(server: Server):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, fmt, *args):
            sys.stderr.write("deck-server: " + (fmt % args) + "\n")

        def send(self, status: int, body: bytes, ctype: str = "application/json") -> None:
            self.send_response(status)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def json(self, status: int, obj) -> None:
            self.send(status, json.dumps(obj, ensure_ascii=False, default=str).encode())

        def handle_any(self, fn) -> None:
            try:
                fn()
            except Refused as e:
                self.json(e.status, {"error": {"type": e.kind, "message": e.message}})
            except Exception as e:   # noqa: BLE001
                traceback.print_exc()
                self.json(500, {"error": {"type": "server_error", "message": f"{type(e).__name__}: {e}"}})

        def do_GET(self):
            path = [unquote(x) for x in urlparse(self.path).path.strip("/").split("/")]

            def go():
                if path == ["status"]:
                    return self.json(200, server.status())
                if len(path) == 2 and path[0] == "run":
                    return self.json(200, server.get(path[1]))
                if len(path) == 3 and path[0] == "file":
                    data, ctype = server.file(path[1], path[2])
                    return self.send(200, data, ctype)
                raise Refused(404, "not_found", "no such route")
            self.handle_any(go)

        def do_POST(self):
            def go():
                if urlparse(self.path).path.strip("/") != "run":
                    raise Refused(404, "not_found", "no such route")
                n = int(self.headers.get("Content-Length") or 0)
                try:
                    body = json.loads(self.rfile.read(n) or b"{}")
                except ValueError as e:
                    raise Refused(400, "bad_request", "the body is not JSON") from e
                self.json(202, server.run(body))
            self.handle_any(go)
    return Handler


def serve(settings: Settings | None = None) -> ThreadingHTTPServer:
    """Build the HTTP server (not started): tests and ``main`` both use it."""
    s = settings or Settings()
    return ThreadingHTTPServer(("127.0.0.1", s.port), make_handler(Server(s)))


def main() -> int:
    s = Settings()
    httpd = serve(s)
    mode = "live runs allowed" if s.live else "live off"
    sys.stderr.write(f"Deck Maker engine server on http://127.0.0.1:{s.port} ({mode}; replay {'from ' + str(s.replay) if s.replay else 'off'}; cap {s.max_usd:.2f} USD)\n")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
