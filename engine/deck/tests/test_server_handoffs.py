"""deck-handoffs over the engine server's HTTP port, on the Fernley recording (fictional): an edit at a gate is applied, marked human and
re-held; a retry in a replay is refused in words; your own route becomes the pick; the tissue kit stops at the territories and the client's
reactions pick the recommendation; the production brief is written once the deck is built; the frozen brief reaches the run. No model and no
renderer. Run from ``engine/``: ``PYTHONPATH=. python3 -m pytest -q deck/tests/test_server_handoffs.py``."""
from __future__ import annotations

import json
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

import pytest

from deck import server as srv

FERN = Path(__file__).parent / "fixtures" / "fernley"
PROMPT = (FERN / "prompt.txt").read_text().strip()
INPUTS = {"prompt": {"text": PROMPT, "client": "Fernley Drinks Ltd (FICTIONAL)", "project": "Fernley Tea 2027", "agency": ""}, "kind": "agency", "format": "pitch"}
T0, T1, T2 = "2026-11-20T10:00:00Z", "2026-11-20T10:05:00Z", "2026-11-20T10:10:00Z"


@pytest.fixture
def engine(tmp_path):
    cfg = srv.Settings({"NAPKIN_DECK_DATA": str(tmp_path / "runs"), "NAPKIN_DECK_REPLAY": str(FERN / "stages"), "NAPKIN_DECK_PORT": "0"})
    httpd = srv.serve(cfg)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    yield type("E", (), {"base": f"http://127.0.0.1:{httpd.server_address[1]}", "dir": tmp_path / "runs"})
    httpd.shutdown()


def call(base, path, body=None):
    r = urllib.request.Request(base + path, data=None if body is None else json.dumps(body).encode(), method="GET" if body is None else "POST",
                               headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(r, timeout=20) as resp:
            raw = resp.read()
            return resp.status, json.loads(raw) if "json" in (resp.headers.get("Content-Type") or "") else raw
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def wait(base, doc="doc1"):
    end = time.time() + 20
    while time.time() < end:
        _, v = call(base, f"/run/{doc}")
        if v["state"] in ("gate", "done", "failed"):
            return v
        time.sleep(0.05)
    raise AssertionError("the run did not settle")


def go(e, approvals=None, inputs=INPUTS, doc="doc1", **kw):
    st, v = call(e.base, "/run", {"doc": doc, "inputs": inputs, "approvals": approvals or {}, "mode": "replay", "render": False, **kw})
    assert st == 202, v
    return wait(e.base, doc)


def stage(e, name, doc="doc1"):
    return json.loads(next((e.dir / doc).glob(f"*/stages/{name}")).read_text())


APPROVE = lambda at=None, **kw: {"decision": "approve", **({"at": at} if at else {}), **kw}   # noqa: E731


def test_an_edit_at_the_storyline_gate_is_applied_marked_human_and_the_gate_holds_again(engine):
    go(engine)
    r = {"id": "rq1", "gate": "storyline", "kind": "edit", "by": "human:sai", "at": T0, "edits": {"proposition": "Tea, out of the kitchen."}}
    v = go(engine, requests=[r])
    assert v["state"] == "gate" and v["run"]["gate"]["id"] == "storyline" and v["run"]["gate"]["human"] == ["proposition"]
    h = v["run"]["human"]
    assert h["requests"]["rq1"]["status"] == "done" and h["edits"][0]["after"] == "Tea, out of the kitchen." and h["edits"][0]["by"] == "human:sai"
    assert stage(engine, "b_storyline.json")["proposition"]["line"] == "Tea, out of the kitchen."
    v = go(engine, approvals={"storyline": APPROVE(T1)}, requests=[r])   # sent again: acted on once
    assert v["run"]["gate"]["id"] == "territories" and len(v["run"]["human"]["edits"]) == 1


def test_a_retry_in_a_replay_is_refused_in_words_and_nothing_changes(engine):
    go(engine)
    v = go(engine, requests=[{"id": "rq1", "gate": "storyline", "kind": "retry", "by": "human:sai", "at": T0, "note": "sharper"}])
    assert v["run"]["human"]["requests"]["rq1"]["status"] == "refused" and "live run" in v["run"]["human"]["requests"]["rq1"]["message"]
    assert any("live run" in n for n in v["notices"])


def test_your_own_route_is_added_and_picked_and_the_idea_grows_from_it(engine):
    go(engine)
    go(engine, approvals={"storyline": APPROVE(T0)})
    own = {"id": "rq2", "gate": "territories", "kind": "own", "by": "human:ana", "at": T1, "own": {"name": "Kettle Off", "thought": "Summer starts when the kettle goes off."}}
    v = go(engine, approvals={"storyline": APPROVE(T0)}, requests=[own])
    g = v["run"]["gate"]
    assert g["id"] == "territories" and g["picked"] == "t_own_1" and g["picked_by"].startswith("brought by human:ana")
    assert [t for t in g["territories"] if t["id"] == "t_own_1"][0]["origin"] == "human"
    v = go(engine, approvals={"storyline": APPROVE(T0), "territories": APPROVE(T2, picked="t_own_1")}, requests=[own])
    assert v["run"]["gate"]["id"] == "idea"


def test_a_bad_request_is_a_400_before_anything_runs(engine):
    st, v = call(engine.base, "/run", {"doc": "d", "inputs": INPUTS, "mode": "replay", "requests": [{"id": "x", "gate": "idea", "kind": "edit", "edits": {"nope": "y"}}]})
    assert st == 400 and v["error"]["type"] == "bad_request" and "you can change" in v["error"]["message"]
    st, v = call(engine.base, "/run", {"doc": "d", "inputs": INPUTS, "mode": "replay", "reactions": {"routes": {"T1": {"verdict": "meh"}}}})
    assert st == 400 and "love, like or not_for_us" in v["error"]["message"]


def test_the_tissue_kit_stops_at_the_territories_and_the_reactions_pick_the_recommendation(engine):
    tis = {**INPUTS, "format": "tissue"}
    go(engine, inputs=tis)
    v = go(engine, inputs=tis, approvals={"storyline": APPROVE(T0)})
    assert v["state"] == "gate" and v["run"]["gate"]["id"] == "territories" and v["run"]["gate"]["tissue"] is True
    assert [r["id"] for r in v["run"]["tissue"]["routes"]] == ["T1", "T2", "T3"]
    st, page = call(engine.base, "/file/doc1/tissue.html")
    assert st == 200 and b"Reactions sheet" in page
    v = go(engine, inputs=tis, approvals={"storyline": APPROVE(T0), "territories": APPROVE(T1)})
    assert v["run"]["gate"]["id"] == "territories", "a tissue session never runs past the territories"
    reactions = {"by": "client", "at": T1, "routes": {"T2": {"verdict": "love", "comments": "warmer"}, "T1": {"verdict": "like"}}}
    v = go(engine, approvals={"storyline": APPROVE(T0)}, reactions=reactions)   # the pitch after the session: same stages
    assert v["run"]["gate"]["picked"] == "T2" and v["run"]["gate"]["picked_by"].startswith("the client at the tissue session")
    assert any("client's reactions picked" in n for n in v["notices"])
    assert stage(engine, "c_territories.json")["tissue_reactions"]["routes"]["T2"]["comments"] == "warmer"


def test_the_production_brief_is_written_once_the_deck_is_built(engine):
    done = {"storyline": APPROVE(), "territories": APPROVE(), "idea": APPROVE()}
    go(engine)
    go(engine, approvals={"storyline": done["storyline"]})
    go(engine, approvals={k: done[k] for k in ("storyline", "territories")})
    v = go(engine, approvals=done)
    assert v["state"] == "done" and v["run"]["handoffs"]["production_brief"]["files"] == ["production_brief.md", "production_brief.json"]
    st, raw = call(engine.base, "/file/doc1/production_brief.json")
    assert st == 200 and raw["kind"] == "napkin.production_brief" and raw["deliverables"]
    assert set(v["payload"]) == {"deck", "validation", "evidence", "report", "exports", "done"}


def test_the_frozen_brief_reaches_the_run_and_changes_its_cache_key(engine):
    brief = {"title": "Fernley brief (fictional)", "campaign": {"objective": {"value": "Grow trial"}}, "audience": "18 to 34 year olds in Ireland"}
    with_up = {**INPUTS, "upstream": {"doc-brief-1": brief}}
    assert srv.inputs_key(with_up) != srv.inputs_key(INPUTS) and srv.inputs_key({**INPUTS, "format": "tissue"}) == srv.inputs_key(INPUTS)
    v = go(engine, inputs=with_up, doc="up1", members={"facts": [], "findings": []}, look={"size": {"canvas": "4:3"}})
    assert v["state"] == "gate" and v["run"]["gate"]["id"] == "storyline"
    snap = next((engine.dir / "up1").glob("*/upstream.clan"))
    import zipfile

    import yaml
    data = yaml.safe_load(zipfile.ZipFile(snap).read("shared/data.yaml"))
    assert data["upstream"] == {"doc-brief-1": brief} and data["look"] == {"size": {"canvas": "4:3"}}
    st, v = call(engine.base, "/run", {"doc": "d", "inputs": {**INPUTS, "upstream": ["no"]}, "mode": "replay"})
    assert st == 400 and "inputs.upstream" in v["error"]["message"]
