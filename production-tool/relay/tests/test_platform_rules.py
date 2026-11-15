"""The platform rules on the Production line (features/production-platform-rules.clan): done_when 1, 2, 3, 5 and 6.

1. Every sender passes the spend guard first: a walk over providers/*.py and director/model.py.
2. Client text reaches a model only on an EU-pinned route: the relay's routes stop start-up otherwise.
3. Every request is scoped to the signed-in person's agency, read only from X-Napkin-Identity.
5. The per-client AI switch (client_ai.py's seam) stands in front of every op that sends client material.
6. Later records add behaviour in hooks/ (before_submit, after_complete), in file-name order.

No network, no key, no model: fake wires and the hand fakes in conftest.py.
"""

from __future__ import annotations

import ast
import hashlib
import json
import re
import time
from pathlib import Path

import pytest

import client_ai
import hooks as relay_hooks
import identity
from conftest import CDN, Harness, asset, base_config, envelope
from contracts_dir import contracts_dir
from director import new_id, spend
from director.claude import make as make_director, pinned_routes
from director.model import ModelError, ModelPort, Reply
from director.model_routes import RoutesError
from service import CLIENT_AI_OFF

RELAY = Path(__file__).resolve().parent.parent
SERVER = RELAY.parents[1] / "server" / "napkin"
FIXTURE_HOOKS = Path(__file__).resolve().parent / "fixtures" / "hooks"


# ── 1. every sender passes spend.check or guard_spend first ───────────────────────────────────────────

GUARDS = {"check", "guard_spend"}
# The one low-level transport: it forwards whatever its callers send, so each caller that pays is walked instead.
TRANSPORTS = {("providers/runway.py", "_call")}
# A request that is not paid: a poll, a cancel, the account's own facts.
FREE_METHODS = {"GET", "DELETE", "HEAD"}


def _senders(rel: str, tree: ast.AST):
    """(function, line, what) for each call in `rel` that sends a request a provider or a model bills."""
    out = []
    for fn in ast.walk(tree):
        if not isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for node in ast.walk(fn):
            if not isinstance(node, ast.Call):
                continue
            f = node.func
            name = f.attr if isinstance(f, ast.Attribute) else getattr(f, "id", "")
            first = node.args[0].value if node.args and isinstance(node.args[0], ast.Constant) else None
            if name in ("create", "post", "put", "patch", "stream") or (name == "request" and first not in FREE_METHODS) \
                    or (name == "_call" and first not in FREE_METHODS):
                out.append((fn, node.lineno, name))
    return out


def _guarded_before(fn, line: int) -> bool:
    for node in ast.walk(fn):
        if isinstance(node, ast.Call) and node.lineno <= line:
            f = node.func
            if (f.attr if isinstance(f, ast.Attribute) else getattr(f, "id", "")) in GUARDS:
                return True
    return False


def walked_files():
    return [*sorted((RELAY / "providers").glob("*.py")), RELAY / "director" / "model.py"]


def test_every_sender_in_providers_and_the_model_wires_calls_the_guard_first():
    found, unguarded = [], []
    for path in walked_files():
        rel = path.relative_to(RELAY).as_posix()
        for fn, line, what in _senders(rel, ast.parse(path.read_text(), rel)):
            if (rel, fn.name) in TRANSPORTS:
                continue
            found.append((rel, fn.name))
            if not _guarded_before(fn, line):
                unguarded.append(f"{rel}:{line} {fn.name}() sends ({what}) without spend.check or guard_spend first")
    assert not unguarded, unguarded
    # The walk sees the three senders this build has: Runway's submit and the two model wires.
    assert {("providers/runway.py", "submit"), ("director/model.py", "send")} <= set(found), found


def test_the_walker_catches_a_sender_with_no_guard():
    bad = ast.parse("def submit(self, job):\n    return self._call('POST', '/v1/x', json={})\n")
    good = ast.parse("def submit(self, job):\n    spend.check(1)\n    return self._call('POST', '/v1/x', json={})\n")
    [(fn, line, _)] = _senders("x.py", bad)
    assert not _guarded_before(fn, line)
    [(fn, line, _)] = _senders("x.py", good)
    assert _guarded_before(fn, line)


def test_with_cap_zero_the_model_wires_send_nothing(monkeypatch):
    from director.model import AnthropicWire

    class Never:
        def __getattr__(self, name):
            raise AssertionError("a model call left the relay")
    monkeypatch.setenv("NAPKIN_PAID_CALLS", "on")
    monkeypatch.setenv("NAPKIN_SPEND_CAP_EUR", "0")
    with pytest.raises(ModelError, match="today's limit"):
        AnthropicWire(Never()).send(model="eu.anthropic.claude-sonnet-5-5", system="s",
                                    turns=[{"role": "user", "text": "client words", "images": []}], schema={},
                                    purpose="director", max_tokens=100, effort=None, timeout=5)


# ── 2. the EU pin ─────────────────────────────────────────────────────────────────────────────────────

class Wire:
    """A model wire that records the model it is sent and answers with the director's minimal reply."""

    def __init__(self, api="bedrock"):
        self.api, self.models = api, []

    def send(self, **kw):
        self.models.append(kw["model"])
        raise ModelError("recorded; not answering", "server")


@pytest.fixture
def pin(monkeypatch):
    for v in ("NAPKIN_MODEL_PIN", "NAPKIN_MODEL_ROUTES"):
        monkeypatch.delenv(v, raising=False)
    return monkeypatch


@pytest.mark.parametrize("routes", [
    {"default": {"model": "global.anthropic.claude-opus-5"}},
    {"purposes": {"writer": {"model": "global.anthropic.claude-sonnet-5-5"}}},
    {"vision": {"model": "global.anthropic.claude-haiku-4-5-20251001-v1:0"}},
])
def test_start_up_stops_on_a_route_the_pin_cannot_vouch_for(pin, routes):
    pin.setenv("NAPKIN_MODEL_PIN", "eu")
    pin.setenv("NAPKIN_MODEL_ROUTES", json.dumps(routes))
    with pytest.raises(RoutesError, match="not EU-pinned"):
        make_director(wire=Wire())


@pytest.mark.parametrize("pinned", ["eu", None])
def test_start_up_stops_on_a_wire_the_pin_cannot_vouch_for_and_unset_is_pinned(pin, pinned):
    if pinned:
        pin.setenv("NAPKIN_MODEL_PIN", pinned)
    with pytest.raises(RoutesError, match="not EU-pinned"):
        make_director(wire=Wire(api="anthropic"))


def test_the_relay_itself_does_not_start_with_a_non_eu_route(pin, tmp_path):
    """Start the relay as local.py does, on the bedrock wire with the pin and a non-EU route: it stops."""
    import local
    pin.setenv("NAPKIN_MODEL_API", "bedrock")
    pin.setenv("NAPKIN_MODEL_REGION", "eu-west-1")
    pin.setenv("NAPKIN_MODEL_PIN", "eu")
    pin.setenv("NAPKIN_MODEL_ROUTES", json.dumps({"default": {"model": "global.anthropic.claude-opus-5"}}))
    pin.delenv("TOKEN_SECRET", raising=False)
    try:
        with pytest.raises(RoutesError):
            local.build(8799, tmp_path)
    finally:
        identity.use_local(None)


def test_director_skye_and_the_cutter_resolve_through_the_pinned_routes(pin):
    import cutdowns
    import writer as writers
    pin.setenv("NAPKIN_MODEL_PIN", "eu")
    wire = Wire()
    director = make_director(wire=wire)
    port = director.director.port
    assert port.routes.pin == "eu"
    skye, cutter = writers.make(director), cutdowns.make(director)
    assert isinstance(skye, writers.ModelWriter) and isinstance(cutter, cutdowns.ModelCutter)
    assert skye.port is port and cutter.port is port      # one port, one set of routes
    from test_write import write_input
    for run in (lambda: director.director.run("generate", {"text": "a bottle on a bar"}, "mock"),
                lambda: skye.write({"op": "write", "jobId": new_id("job"), "input": write_input()}),
                lambda: cutter.plan({"jobId": new_id("job"), "input": {"cutdown": {
                    "shots": [{"id": "s1", "inS": 0, "outS": 3}], "lengths": [6], "aspects": []}}})):
        try:
            run()
        except Exception:  # noqa: BLE001 - the wire records the model, then refuses to answer
            pass
    assert wire.models and all(m.startswith("eu.") for m in wire.models), wire.models


def test_a_model_a_caller_names_that_the_pin_cannot_vouch_for_is_not_sent(pin):
    wire = Wire()
    port = ModelPort(wire, "eu.anthropic.claude-sonnet-5-5", timeout=5, routes=pinned_routes("bedrock", {}))
    from director.model import Usage
    for model in ("claude-sonnet-5-5", "global.anthropic.claude-sonnet-5-5", "us.anthropic.claude-sonnet-5-5"):
        with pytest.raises(ModelError, match="not EU-pinned"):
            port.call("director", "s", {"x": 1}, {"type": "object"}, usage=Usage(), attribution="t", model=model)
    assert wire.models == []
    assert pinned_routes("bedrock", {}).model_id("sonnet-5.5") == "eu.anthropic.claude-sonnet-5-5"


def test_a_config_edit_cannot_move_the_director_off_the_pin(pin):
    director = make_director(wire=Wire())
    director.use_config({"perClickModel": "global.anthropic.claude-opus-5", "shotListModel": "eu.anthropic.claude-opus-5"})
    assert director.director.per_click_model == "eu.anthropic.claude-sonnet-5-5"
    assert director.director.shot_list_model == "eu.anthropic.claude-opus-5"


# ── 3. every request is scoped to the signed-in person's agency ───────────────────────────────────────

KEY = "s" * 40
PROJECT = "prj_01J9Z8Y7X6W5V4T3S2R1Q0P9N9"


def signed(method: str, path: str, body: bytes | None, agency: str, handle: str, **extra) -> dict:
    now = int(time.time())
    claims = {"u": f"{handle}@{agency}", "a": agency, "t": identity.tenant_id(agency), "aud": "relay", "iat": now,
              "exp": now + 60, "m": method, "p": path, "bh": hashlib.sha256(body or b"").hexdigest()}
    return {"X-Napkin-Identity": identity.sign(claims, KEY), **extra}


def routes_in_the_contract() -> set[str]:
    text = json.loads((contracts_dir() / "relay-api.schema.json").read_text())["description"]
    listed = text.split("Routes:", 1)[1].rstrip(".")
    out = set()
    for item in listed.split(", "):
        item = re.sub(r"\s*\(.*\)$", "", item.strip())
        methods, path = item.split(" ", 1)
        for m in methods.split("|"):
            out.add(f"{m} {path.replace('[/{ver}]', '')}")
            if "[/{ver}]" in path:
                out.add(f"{m} {path.replace('[/{ver}]', '/{ver}')}")
    return out


@pytest.fixture
def two_agencies(monkeypatch):
    """Bob in agency red saves a project, its canvas, a library key and a job; then the relay reads identity
    only from napkin-web's signed assertion, as on AWS."""
    from test_projects import clan, save
    h = Harness()
    bob = h.as_person("bob", "red")
    save(h, bob, PROJECT, clan("red's project"))
    h.call("PUT", f"/clan/{PROJECT}/canvas", {"elements": []}, bob)
    from test_library import publish
    publish(h, bob, key="maya")
    _, job = h.post_job(bob, expect=200)
    h.as_person("alice", "blue")
    monkeypatch.setenv("TOKEN_SECRET", KEY)
    identity.use_local(None)
    h.relay.who = identity.who
    return h, job["jobId"]


def ask(h, method, path, body=None, agency="blue", handle="alice", **headers):
    raw = json.dumps(body).encode() if isinstance(body, dict) else body
    path_only, _, query = path.partition("?")
    return h.relay.http(method, path_only, signed(method, path, raw, agency, handle, **headers), raw, query)


def test_agency_a_gets_404_for_agency_bs_ids_on_every_route_that_takes_one(two_agencies):
    h, job = two_agencies
    answer = {"contractVersion": "3", "questionId": "q", "optionId": "o"}
    by_route = {
        "GET /jobs/{jobId}": ("GET", f"/jobs/{job}", None),
        "DELETE /jobs/{jobId}": ("DELETE", f"/jobs/{job}", None),
        "POST /jobs/{jobId}/answer": ("POST", f"/jobs/{job}/answer", answer),
        "GET /clan/{projectId}": ("GET", f"/clan/{PROJECT}", None),
        "GET /clan/{projectId}/canvas": ("GET", f"/clan/{PROJECT}/canvas", None),
        "PUT /clan/{projectId}/canvas": ("PUT", f"/clan/{PROJECT}/canvas", {"elements": []}),
        "GET /library/{shelf}/{key}": ("GET", "/library/agency/maya", None),
        "GET /library/{shelf}/{key}/{ver}": ("GET", "/library/agency/maya/1", None),
    }
    for route, (method, path, body) in by_route.items():
        status, out, _ = ask(h, method, path, body)
        assert status == 404, (route, status, out)
    # Bob still has all of it, unchanged.
    status, out, _ = ask(h, "GET", f"/clan/{PROJECT}", agency="red", handle="bob")
    assert status == 200 and out.data.endswith(b"red's project")
    assert ask(h, "GET", f"/jobs/{job}", agency="red", handle="bob")[0] == 200


def test_routes_with_no_id_answer_only_for_the_callers_agency(two_agencies):
    from test_projects import clan
    h, job = two_agencies
    me = ask(h, "GET", "/me")[1]
    assert me["workspace"] == identity.tenant_id("blue")
    assert ask(h, "GET", "/projects")[1] == {"projects": []}
    assert "maya" not in json.dumps(ask(h, "GET", "/library/agency")[1])
    # POST /clan naming red's project id saves into blue's own workspace; red's bytes are untouched.
    status, _, _ = h.relay.http("POST", "/clan", signed("POST", "/clan", clan("blue's"), "blue", "alice",
                                **{"Content-Type": "application/vnd.clan+zip", "X-Clan-Reason": "manual",
                                   "X-Project-Id": PROJECT}), clan("blue's"))
    assert status == 200
    assert ask(h, "GET", f"/clan/{PROJECT}", agency="red", handle="bob")[1].data.endswith(b"red's project")
    assert ask(h, "GET", f"/clan/{PROJECT}")[1].data.endswith(b"blue's")


@pytest.mark.parametrize("smuggle", [
    {"query": "?tenant={red}"}, {"query": "?tenantId={red}&agency=red"},
    {"headers": {"X-Napkin-Tenant": "{red}"}}, {"headers": {"X-Tenant-Id": "{red}", "X-Agency": "red"}},
    {"headers": {"X-Project-Id": PROJECT}},
])
def test_no_query_or_header_the_browser_can_set_moves_the_tenant(two_agencies, smuggle):
    h, _ = two_agencies
    red = identity.tenant_id("red")
    query = smuggle.get("query", "").format(red=red)
    headers = {k: v.format(red=red) for k, v in (smuggle.get("headers") or {}).items()}
    status, me, _ = ask(h, "GET", f"/me{query}", **headers)
    assert status == 200 and me["workspace"] == identity.tenant_id("blue")
    status, lst, _ = ask(h, "GET", f"/projects{query}", **headers)
    assert lst == {"projects": []}


def test_a_tenant_in_the_job_body_is_not_read(two_agencies):
    h, _ = two_agencies
    body = {**envelope("generate", new_id("job")), "input": {"text": "a hero"}, "tenantId": identity.tenant_id("red")}
    status, out, _ = ask(h, "POST", "/jobs", body)
    if status == 200:          # taken: then it is blue's job
        assert out["tenantId"] == identity.tenant_id("blue")
    else:                      # refused: the contract has no tenant in a body
        assert status == 400


def test_the_scope_test_covers_every_route_in_the_contract():
    """A route added to relay-api.schema.json must be named here, with an id test above or as having no id."""
    no_id = {"GET /me", "POST /uploads", "POST /jobs", "POST /log", "POST /clan", "GET /projects",
             "GET /library/{shelf}", "POST /library/{shelf}/{key}", "POST /library/{shelf}/{key}/{ver}",
             "POST /dogfood/consent", "POST /dogfood/events", "GET /config"}
    with_id = {"GET /jobs/{jobId}", "DELETE /jobs/{jobId}", "POST /jobs/{jobId}/answer", "GET /clan/{projectId}",
               "GET /clan/{projectId}/canvas", "PUT /clan/{projectId}/canvas", "GET /library/{shelf}/{key}",
               "GET /library/{shelf}/{key}/{ver}"}
    assert routes_in_the_contract() == no_id | with_id


# ── 5. the per-client AI switch ───────────────────────────────────────────────────────────────────────

def test_the_relays_seam_is_the_middlewares_copy_and_says_no():
    header, _, body = (RELAY / "client_ai.py").read_text().partition("\n")
    assert header == "# Copied from server/napkin/client_ai.py; keep in step until the shared package (D8)"
    assert body == (SERVER / "client_ai.py").read_text()
    assert client_ai.written_yes_recorded({"tenant": "t"}, None) is False


def off(h):
    h.client_ai_on = False
    return h


@pytest.mark.parametrize("op,provider", [("generate", "runway"), ("view", "runway"), ("clip", "runway")])
def test_switch_off_refuses_an_op_that_reaches_a_provider_in_one_plain_line(op, provider):
    h = off(Harness())
    token = h.as_person()
    status, out = h.post_job(token, op=op)
    assert status == 403 and out["error"]["code"] == "flag_off" and out["error"]["message"] == CLIENT_AI_OFF
    assert h.providers["runway"].submits == [] and h.providers["mock"].submits == []
    assert h.store.counters("spend").get("usd", 0) == 0, "nothing reserved"
    assert h.ai_scopes[-1]["tenant"] == identity.tenant_id("blue")


def test_switch_off_refuses_the_model_director_skye_and_dexs_plan():
    from test_write import post_write
    h = off(Harness(base_config(routing={"generate": ["mock"], "shot_list": [], "stitch": [], "write": []})))
    h.relay.director = make_director(wire=Wire())
    import cutdowns
    import writer as writers
    h.relay.writer, h.relay.cutter = writers.make(h.relay.director), cutdowns.make(h.relay.director)
    token = h.as_person()
    h.limits("blue", allow={"claude": True, "makers": []})
    for status, out in (h.post_job(token, op="generate"), h.post_job(token, op="shot_list"), post_write(h, token, expect=None)):
        assert status == 403 and out["error"]["message"] == CLIENT_AI_OFF, out
    assert h.providers["mock"].submits == []


def test_switch_off_keeps_what_never_leaves_the_relay():
    """The mock with the passthrough, a crop and a stitch send nothing out: they still run."""
    from test_campaign import size_input
    h = off(Harness(base_config(routing={"generate": ["mock"], "shot_list": [], "stitch": []})))
    token = h.as_person()
    assert h.post_job(token, op="generate")[0] == 200
    assert h.post_job(token, op="resize", **size_input(h))[0] == 200
    assert h.post_job(token, op="stitch")[0] == 200


def test_with_the_seam_itself_every_op_that_sends_is_refused():
    h = Harness()
    h.relay.ai_switch = client_ai.written_yes_recorded   # no record builds the switch yet: always no
    status, out = h.post_job(h.as_person(), op="clip")
    assert status == 403 and out["error"]["message"] == CLIENT_AI_OFF


def test_a_refusal_holds_no_figure():
    assert not re.search(r"\d|euro|dollar|usd|credit|price|cost|€|\$", CLIENT_AI_OFF, re.I)


# ── 6. hooks ──────────────────────────────────────────────────────────────────────────────────────────

@pytest.fixture
def hooked():
    loaded = relay_hooks.load(FIXTURE_HOOKS)
    h = Harness(base_config(routing={"generate": ["mock"], "shot_list": [], "stitch": []}))
    h.relay.hooks = loaded
    loaded[0].SEEN.clear()
    loaded[2].DONE.clear()
    return h, loaded


def test_the_loader_takes_nn_name_files_in_file_name_order():
    loaded = relay_hooks.load(FIXTURE_HOOKS)
    assert [m.__name__.rsplit(".", 1)[-1] for m in loaded] == ["10_annotate", "20_refuse", "30_after"]
    assert relay_hooks.load(RELAY / "hooks") == []        # no record has added one yet


def test_before_submit_annotates_in_order_and_the_job_keeps_it(hooked):
    h, loaded = hooked
    token = h.as_person()
    _, job = h.post_job(token, op="generate", expect=200)
    stored = h.store.get_job(job["jobId"])
    assert stored["_hooks"] == ["10_annotate", "20_refuse"]
    [(_, ctx)] = loaded[0].SEEN
    assert set(ctx) == {"tenant", "person", "job_number", "project", "env"}
    assert ctx["tenant"] == identity.tenant_id("blue") and ctx["person"] == job["participantId"]


def test_a_hook_that_refuses_fails_the_job_with_its_line_and_sends_nothing(hooked):
    h, _ = hooked
    _, job = h.post_job(h.as_person(), op="generate", expect=200, text="refuse me, please", refs=[])
    assert job["state"] == "failed" and job["error"] == {"code": "not_allowed", "message": "A rule refused this job.",
                                                          "retryable": False}
    assert h.providers["mock"].submits == []
    assert h.store.counters("spend").get("usd", 0) == 0


def test_after_complete_hears_a_completed_job_and_its_error_is_not_the_jobs(hooked):
    h, loaded = hooked
    token = h.as_person()
    _, job = h.post_job(token, op="generate", expect=200)
    h.providers["mock"].succeed(job["requestId"])
    h.clock.tick(3)
    done = h.poll(token, job["jobId"])
    assert done["state"] == "completed", done
    assert loaded[2].DONE == [(job["jobId"], len(done["outputs"]), identity.tenant_id("blue"))]


def test_service_py_runs_the_hooks_only_through_the_loader():
    """The contract a later record reads: two hook points in service.py, both through hooks/."""
    src = (RELAY / "service.py").read_text()
    assert src.count("relay_hooks.before_submit(") == 1 and src.count("relay_hooks.after_complete(") == 1
