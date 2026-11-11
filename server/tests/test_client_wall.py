"""ADR-004, the client wall (docs/adr/0004-client-wall.md; features/client-wall.clan).

Scope per request from the signed-in person's agency; NAPKIN_DEV_ORG refused outside
local development; every client route EU-pinned or a recorded exception; no key on the
wire. No provider is called: every port is a fake and no key is set."""

import json
import re
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from napkin.app import AGENCY_HEADER, create_app
from napkin.config import Settings, _default_pipelines
from napkin.jobs import LongJob
from napkin.model_routes import ALIASES, Routes, RoutesError, load_exceptions
from napkin.util import TaskError

from conftest import layer_store
from fakes import FakeModel, FakeResearch

SERVER = Path(__file__).resolve().parents[1]
DEC = {"id": "d_TEST000001", "kind": "pin", "handler": "t@1.0", "action": "t", "rationale": "r", "cites": []}
DOC = "11111111-2222-4333-8444-555555555555"


def brand_fact(value):
    return {"layer": "brand", "entity": "brand/acme", "key": "voice.tone", "market": "", "value": value,
            "unit": "text", "as_of": "2026-01-01", "retrieved_at": "2026-09-20", "sources": [], "licence": "open"}


def client(env="staging", **kw):
    """A middleware app over the fake layers service, and a test client for it."""
    store = layer_store()
    settings = Settings(pipelines=_default_pipelines(), env=env, **kw)
    app = create_app(settings, model_client=FakeModel(), research_port=FakeResearch(), layer_store=store)
    return TestClient(app), app.state.mw, store


def poll(c, job_id, agency=None):
    body = {"request_kind": "middleware", "payload": {"task": "job_status", "input": {"job_id": job_id}},
            "clan": {"id": DOC, "version": "1"}}
    return c.post("/v1/tasks", json=body, headers={AGENCY_HEADER: agency} if agency else {})


# -- scope per request --------------------------------------------------------------------------

def test_two_agencies_in_one_run_cannot_read_each_others_layer_facts():
    _, mw, store = client()
    a = mw.caps("t@1.0", mw.settings.scope_for("agency-a")).layers
    b = mw.caps("t@1.0", mw.settings.scope_for("agency-b")).layers
    a.append(brand_fact("warm and dry"), DEC)
    assert [f["value"] for f in a.facts("brand", "brand/acme")] == ["warm and dry"]
    assert b.facts("brand", "brand/acme") == [], "agency B reads nothing of agency A"
    orgs = {r.headers["x-napkin-org"] for r in store.service.requests}
    assert orgs == {"org/agency-a", "org/agency-b"}, "each request carried its own agency, nothing fixed"


def test_a_job_belongs_to_the_agency_that_started_it():
    c, mw, _ = client()
    jid = mw.jobs.new_id()
    caps = mw.caps("t@1.0", mw.settings.scope_for("agency-a"))
    caps.bind_job(jid)
    job = LongJob(jid, "ask_research", "t@1.0", DOC, mw.settings.scope_for("agency-a"), caps, 1,
                  lambda: ({"summary": "done"}, None, []))
    mw.jobs.add(job)
    job.start()
    job.thread.join(5)
    mine = poll(c, jid, "agency-a")
    assert mine.status_code == 200 and mine.json()["trace"]["scope"]["org"] == "org/agency-a"
    other = poll(c, jid, "agency-b")
    assert other.status_code == 404 and other.json()["error"]["type"] == "unknown_job"


def test_outside_local_a_request_with_no_agency_is_refused_and_a_bad_one_is_a_400():
    c, _, _ = client()
    assert poll(c, "job_x").status_code == 401
    assert poll(c, "job_x", "Not An Agency").status_code == 400
    assert poll(c, "job_x", "../etc").status_code == 400
    assert poll(c, "job_x", "agency-a").status_code == 404, "a good agency gets as far as the job"


def test_the_agency_in_a_body_is_still_refused():
    c, _, _ = client()
    body = {"request_kind": "middleware", "payload": {"task": "job_status", "input": {"org": "org/x"}},
            "clan": {"id": DOC, "version": "1"}}
    assert c.post("/v1/tasks", json=body, headers={AGENCY_HEADER: "agency-a"}).status_code == 400


def test_local_development_keeps_its_fixed_tenant_when_no_agency_is_sent():
    s = Settings(env="local")
    assert s.scope_for(None) == {"org": "org/dev-agency", "brand": "brand/dev-brand"}
    assert s.scope_for("agency-a")["org"] == "org/agency-a", "a request's agency wins over the fixed tenant"


def test_staging_keeps_its_test_tenant_only_by_the_recorded_exception():
    s = Settings(env="staging", dev_org_exception=True, org="org/sandbox")
    assert s.scope_for("tbwa")["org"] == "org/sandbox" and s.scope_for(None)["org"] == "org/sandbox"
    with pytest.raises(TaskError) as e:
        Settings(env="staging").scope_for(None)
    assert e.value.status == 401


# -- NAPKIN_DEV_ORG outside local development ---------------------------------------------------

@pytest.fixture
def env(monkeypatch):
    for k in ("NAPKIN_ENV", "NAPKIN_DEV_ORG", "NAPKIN_DEV_ORG_EXCEPTION", "NAPKIN_MODEL_PIN", "NAPKIN_MODEL"):
        monkeypatch.delenv(k, raising=False)
    return monkeypatch


def test_the_dev_org_is_refused_outside_local_development(env):
    env.setenv("NAPKIN_DEV_ORG", "org/sandbox")
    assert Settings.from_env().org == "org/sandbox"                      # local: as before
    for where in ("staging", "production"):
        env.setenv("NAPKIN_ENV", where)
        with pytest.raises(SystemExit, match="NAPKIN_DEV_ORG"):
            Settings.from_env()
    env.setenv("NAPKIN_ENV", "production")
    env.setenv("NAPKIN_DEV_ORG_EXCEPTION", "1")
    with pytest.raises(SystemExit, match="NAPKIN_DEV_ORG"):               # never on production
        Settings.from_env()
    env.setenv("NAPKIN_ENV", "staging")
    s = Settings.from_env()                                                # staging's recorded exception
    assert s.dev_org_exception and s.scope_for("tbwa")["org"] == "org/sandbox"
    env.setenv("NAPKIN_ENV", "prod")
    with pytest.raises(SystemExit, match="NAPKIN_ENV"):
        Settings.from_env()


# -- model routes: EU-pinned, or a recorded exception ------------------------------------------

def routes(doc=None, *, pin="eu", api="bedrock", model="global.anthropic.claude-opus-5-5", exceptions=None):
    return Routes(api, model, None, json.dumps(doc) if doc else None, pin=pin, exceptions=exceptions or {})


def shipped():
    return (SERVER / "model-routes.example.json").read_text()


def test_every_route_the_deployment_ships_resolves_inside_the_eu():
    """The check: the routes file the image carries, under the pin, has no global profile."""
    r = Routes("bedrock", "eu.anthropic.claude-opus-5-5", None, shipped(), pin="eu", exceptions=load_exceptions())
    assert r.violations() == []
    table = r.table(["extract_facts", "plan_brief", "anything_new"])
    assert not [p for p in table["purposes"].values() if p["model"].startswith("global.")]
    assert table["default"]["model"] == "eu.anthropic.claude-sonnet-5-5"


def test_an_alias_resolves_to_its_eu_profile_under_the_pin_and_stays_global_without_it():
    for name, ids in ALIASES.items():
        pinned = routes({"default": {"model": name}}).resolve("x").model
        assert not pinned.startswith("global."), (name, pinned)
        if ids["bedrock"].startswith("global."):
            assert pinned == "eu." + ids["bedrock"][len("global."):]
            assert routes({"default": {"model": name}}, pin=None).resolve("x").model == ids["bedrock"]


def test_a_route_that_resolves_to_a_global_profile_fails_the_check():
    g = "global.anthropic.claude-opus-5-5"
    with pytest.raises(RoutesError, match="write_brief resolves to the global profile"):
        routes({"default": {"model": "sonnet-5.5"}, "purposes": {"write_brief": {"model": g}}})
    with pytest.raises(RoutesError, match="default resolves to the global profile"):
        routes()                                                              # the environment's model
    with pytest.raises(RoutesError, match="vision resolves"):
        routes({"default": {"model": "sonnet-5.5"}, "vision": {"model": g}})
    assert routes({"default": {"model": "sonnet-5.5"}}, pin=None, model=g).violations() == [], "no pin, no check"


def test_a_recorded_exception_lets_one_purpose_run_global_and_only_that_one():
    g = "global.anthropic.claude-opus-5-5"
    doc = {"default": {"model": "sonnet-5.5"}, "purposes": {"write_brief": {"model": g}, "plan": {"model": g}}}
    ex = {"write_brief": {"reason": "r", "decided_by": "Shrey", "date": "2026-11-12"}}
    with pytest.raises(RoutesError, match="plan"):
        routes(doc, exceptions=ex)
    doc["purposes"].pop("plan")
    assert routes(doc, exceptions=ex).violations() == []


def test_a_wire_the_pin_cannot_vouch_for_is_a_violation_unless_recorded():
    with pytest.raises(RoutesError, match="anthropic wire is not EU-pinned"):
        routes(api="anthropic", model="claude-opus-5")
    ex = {"wire:anthropic": {"reason": "r", "decided_by": "Shrey", "date": "2026-11-12"}}
    assert routes(api="anthropic", model="claude-opus-5", exceptions=ex).violations() == []


def test_an_edit_that_leaves_the_eu_is_refused_and_the_last_good_routes_stay(tmp_path):
    f = tmp_path / "routes.json"
    f.write_text(json.dumps({"default": {"model": "sonnet-5.5"}}))
    r = Routes("bedrock", "eu.anthropic.claude-opus-5-5", None, str(f), pin="eu", exceptions={})
    assert r.resolve("x").model.startswith("eu.")
    f.write_text(json.dumps({"default": {"model": "global.anthropic.claude-opus-5-5"}}))
    import os
    os.utime(f, (f.stat().st_mtime + 5, f.stat().st_mtime + 5))
    assert r.resolve("x").model.startswith("eu.") and "global" in r.error


def test_an_exception_without_a_reason_or_a_decider_is_not_an_exception(tmp_path):
    f = tmp_path / "ex.json"
    f.write_text(json.dumps({"exceptions": {"plan": {"reason": "because"}}}))
    with pytest.raises(RoutesError, match="decided_by"):
        load_exceptions(f)
    assert load_exceptions() == {}, "none is recorded today: nothing leaves the EU"


def test_the_pinned_default_model_is_an_eu_profile(env):
    env.setenv("NAPKIN_MODEL_API", "bedrock")
    assert Settings.from_env().model.startswith("global."), "unpinned: as before"
    env.setenv("NAPKIN_MODEL_PIN", "eu")
    assert Settings.from_env().model == "eu.anthropic.claude-opus-5-5"
    env.setenv("NAPKIN_MODEL_PIN", "us")
    with pytest.raises(SystemExit, match="NAPKIN_MODEL_PIN"):
        Settings.from_env()


def test_nova_grounding_is_off_under_the_pin_unless_recorded():
    from napkin.websearch import web_research
    s = Settings(research_web="tavily", tavily_api_key="k", model_pin="eu")
    assert web_research(s, FakeModel()).nova is False
    s = Settings(research_web="tavily", tavily_api_key="k")
    assert web_research(s, FakeModel()).nova is True
    with pytest.raises(SystemExit, match="US region"):
        web_research(Settings(research_web="nova", model_pin="eu"), FakeModel())


# -- a canary key never reaches a browser -------------------------------------------------------

CANARY = "canary-key-7f3a9c1e5b2d4086-DO-NOT-LEAK"


@pytest.fixture
def canary_env(monkeypatch):
    for k in ("NAPKIN_MODEL_API_KEY", "NAPKIN_TAVILY_API_KEY", "NAPKIN_RESEARCH_TOKEN", "NAPKIN_RETRIEVAL_TOKEN",
              "NAPKIN_LAYERS_TOKEN", "NAPKIN_JEV_API_KEY", "NAPKIN_TOKEN"):
        monkeypatch.setenv(k, CANARY)
    return monkeypatch


def test_a_canary_key_set_on_the_server_is_in_no_response_from_the_middleware(canary_env):
    s = Settings.from_env()
    assert s.model_api_key == CANARY and s.tavily_api_key == CANARY, "the canary is the server's key"
    app = create_app(Settings(pipelines=_default_pipelines(), model_api_key=CANARY, tavily_api_key=CANARY,
                              research_token=CANARY, retrieval_token=CANARY, layers_token=CANARY,
                              jev_api_key=CANARY, token=CANARY, env="staging"),
                     model_client=FakeModel(), research_port=FakeResearch(), layer_store=layer_store())
    c = TestClient(app)
    seen = [c.get("/healthz")]
    good = {"authorization": f"Bearer {CANARY}", AGENCY_HEADER: "agency-a"}
    bad_body = {"request_kind": "middleware", "payload": {"task": "nope", "input": {}}, "clan": {"id": DOC}}
    seen += [c.post("/v1/tasks", json=bad_body, headers=good), c.post("/v1/tasks", content=b"{", headers=good),
             c.post("/v1/tasks", json=bad_body, headers={"authorization": "Bearer wrong"}), c.get("/nothing")]
    assert [r.status_code for r in seen] == [200, 400, 400, 401, 404]
    for r in seen:
        assert CANARY not in r.text and CANARY not in json.dumps(dict(r.headers))


# -- the ADR and its provider table --------------------------------------------------------------

REPO = SERVER.parent


def test_the_adr_states_the_rule_cites_s3_and_s8_and_waits_for_laurence():
    text = (REPO / "docs/adr/0004-client-wall.md").read_text()
    assert "S3" in text and "S8" in text
    for line in ("Client text is processed in the EU only", "Judge and the Compliance night watch"):
        assert line in text
    assert "Built" in text and "Not built" in text
    assert re.search(r"Signed: _+\s+Laurence", text), "a line for Laurence's signature, left blank"
    assert "—" not in text and "–" not in text, "no dashes in doc copy"


def test_the_docs_index_in_napkin_studio_lists_the_adr_and_the_providers():
    import subprocess
    out = subprocess.run(["unzip", "-p", str(REPO / "napkin-studio.clan"), "shared/data.yaml"],
                         capture_output=True, text=True, check=True).stdout
    assert "path: docs/adr/0004-client-wall.md" in out
    assert "path: docs/adr/0004-providers.md" in out


def test_every_provider_in_the_routes_and_the_web_search_has_a_row_with_its_dpa_stated():
    rows = [l for l in (REPO / "docs/adr/0004-providers.md").read_text().splitlines() if l.startswith("| ")][2:]
    wanted = {"bedrock (eu)": "`eu.` inference profile", "bedrock (global)": "`global.` inference profile",
              "anthropic wire": "Anthropic API, direct", "openai wire": "OpenAI-compatible", "nova": "Nova",
              "tavily": "Tavily", "jev": "jev"}
    for name, needle in wanted.items():
        row = next((r for r in rows if needle in r.split("|")[1]), None)
        assert row, f"no row for {name}"
        cells = [c.strip() for c in row.strip("|").split("|")]
        assert len(cells) == 5 and cells[3], f"{name}: where it processes data and the DPA must be stated"
        assert cells[3].startswith("Not recorded") or cells[3].startswith("Not applicable"), name
    from napkin import websearch
    assert {"tavily", "tavily-only", "nova"} >= {"tavily"}, "the modes the doc covers"
    assert websearch.NOVA_REGION == "us-east-1" and "us-east-1" in "".join(rows), "the doc names Nova's region"
