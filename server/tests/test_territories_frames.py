"""territories-pictures-frames through the real middleware: the ``frames`` steps of run_territories (the cost ask, the paid step, the held frames, the
declaration of the material). Runway, the guard and the models are STUBBED: nothing here is paid and no provider is called."""
import copy
import json
import os
import re
import sys
from pathlib import Path

import jsonschema
import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "engine"))
sys.path.append(str(ROOT / "engine" / "territory" / "tests"))

pytest.importorskip("jsonschema")
from territory import contract, pictures                              # noqa: E402
from territory.llm import FakeLLM                                      # noqa: E402
from test_frames import plan_for                                       # noqa: E402
from test_visuals import FakeRunway, KEY, clean_ollama                 # noqa: E402

from napkin.handlers import run_territories as rt                      # noqa: E402
from napkin.territories import job as tjob                             # noqa: E402

from conftest import Server                                            # noqa: E402
from test_brief import post                                            # noqa: E402
from test_territories import SCHEMA, TerritoriesHost, step             # noqa: E402

PRICE = re.compile(r"(€|\$|£)\s?\d|\b(USD|EUR|GBP)\b", re.I)


@pytest.fixture
def fr(tmp_path, monkeypatch):
    monkeypatch.setenv("NAPKIN_TERRITORY_DATA", str(tmp_path / "territory"))
    monkeypatch.setenv("RUNWAYML_API_SECRET", KEY)
    monkeypatch.delenv("VISUALS_CLIENT_TO_RUNWAY", raising=False)
    monkeypatch.delenv("NAPKIN_TERRITORY_IMAGES_MAX_USD", raising=False)
    s = Server(tmp_path)
    s.rw, s.llm = FakeRunway(), FakeLLM({"frames_plan": plan_for})
    s.guard = clean_ollama
    monkeypatch.setattr(rt, "make_transport", lambda: s.rw)
    monkeypatch.setattr(rt, "make_guard_post", lambda: s.guard)
    monkeypatch.setattr(tjob, "make_llm", lambda: s.llm)
    yield s
    s.stop()


def host():
    return TerritoriesHost(data=copy.deepcopy(contract.example("data")), schema=SCHEMA)


def valid(h):
    jsonschema.Draft7Validator(SCHEMA).validate(h.data)
    assert contract.problems(h.data) == [] and contract.lint(h.data) == []


def history(h):
    return [d for d in h.chain if d["agent"].endswith("/ledger")]


def test_the_status_read_with_the_switch_off_is_not_a_failed_job(fr):
    """The page asks frames_status every time it opens: with pictures off that is an empty answer, not a refusal that lands on the desk as Failed."""
    h = host()
    r = step(fr, h, "frames_status")
    assert r[-1]["job"]["state"] == "done" and fr.rw.posts == []
    # and it says pictures are off, so the page shows Make pictures off with why before anyone presses it (live test T6)
    assert r[-1]["result"]["info"]["frames"]["pictures"] == "off"


def test_the_switch_is_off_by_default_and_says_so(fr):
    h = host()
    r = step(fr, h, "frames", ids=["t_started"], by="Shrey")
    assert r[-1]["job"]["state"] == "failed" and "not switched on" in r[-1]["job"]["error"]["message"] and fr.rw.posts == []


def test_client_material_is_refused_until_a_named_person_says_otherwise(fr, monkeypatch):
    monkeypatch.setenv("NAPKIN_TERRITORY_IMAGES", "1")
    h = host()
    r = step(fr, h, "frames", ids=["t_started"], by="Shrey")
    assert r[-1]["job"]["state"] == "failed" and "client-derived" in r[-1]["job"]["error"]["message"] and fr.rw.posts == []
    r = step(fr, h, "frames_material", origin="invented", by="")
    assert r[-1]["job"]["state"] == "failed" and "named person" in r[-1]["job"]["error"]["message"]
    r = step(fr, h, "frames_material", origin="invented", by="Shrey")
    assert r[-1]["job"]["state"] == "done"
    r = step(fr, h, "frames", ids=["t_started"], by="Shrey")
    assert r[-1]["job"]["state"] == "done" and r[-1]["result"]["info"]["card"]["frames"] == 4


def test_ask_then_yes_makes_the_frames_and_the_price_is_only_in_the_history(fr, monkeypatch):
    monkeypatch.setenv("NAPKIN_TERRITORY_IMAGES", "1")
    h = host()
    step(fr, h, "frames_material", origin="invented", by="Shrey")
    r = step(fr, h, "frames", ids=["t_started", "t_sunday"], by="Shrey")
    card = r[-1]["result"]["info"]["card"]
    assert card["frames"] == 8 and card["plan_call"] is True and {n["touchpoint"] for n in card["not_offered"]} == {"story", "seat"}
    assert not PRICE.search(json.dumps(card)) and fr.rw.posts == [] and fr.llm.calls == [], "the card first: no call, no price"
    asks = [d for d in history(h) if d["action"] == "ask"]
    assert len(asks) == 1 and "Pictures were costed before the first one was made" in asks[0]["rationale"] and "$" in asks[0]["rationale"]
    r = step(fr, h, "frames", ids=["t_started", "t_sunday"], card_id=card["id"], by="Shrey")
    assert r[-1]["job"]["state"] == "done", r[-1]
    assert len(fr.rw.posts) == 8 and fr.llm.calls == ["frames_plan"]
    assert r[-1]["result"]["info"]["frames"]["placed"] == 8
    for tid in ("t_started", "t_sunday"):
        got = [s for s in next(t for t in h.data["territories"] if t["id"] == tid)["pictures"] if s["kind"] == "frame"]
        assert len(got) == 4 and all(s["rights"] == "generated" and s["image"] == "sha256:" + s["sha256"] for s in got)
        assert all(pictures.DirStore(os.environ["NAPKIN_TERRITORY_DATA"]).has(s["sha256"]) for s in got), "on the workspace blob store, by hash"
    valid(h)
    assert not PRICE.search(json.dumps(h.data)), "no price in the document"
    spends = [d for d in history(h) if d["action"] == "spend" and "picture provider" in d["rationale"]]
    assert len(spends) == 8 and all("$0.07" in d["rationale"] for d in spends)
    assert any(d["action"] == "outcome" and "placed 8" in d["rationale"] for d in history(h))


def test_a_yes_for_another_card_or_with_no_ask_is_refused_and_nothing_is_sent(fr, monkeypatch):
    monkeypatch.setenv("NAPKIN_TERRITORY_IMAGES", "1")
    h = host()
    step(fr, h, "frames_material", origin="invented", by="Shrey")
    r = step(fr, h, "frames", ids=["t_started"], card_id="c_0000000000000000", by="Shrey")
    assert r[-1]["job"]["state"] == "failed" and "not the card you were shown" in r[-1]["job"]["error"]["message"]
    assert fr.rw.posts == [] and fr.llm.calls == []
    r = step(fr, h, "frames", ids=["t_sitdown"], by="Shrey")
    assert r[-1]["job"]["state"] == "failed" and "not greenlit" in r[-1]["job"]["error"]["message"]


def test_no_is_not_made_and_bad_input_is_a_400(fr, monkeypatch):
    monkeypatch.setenv("NAPKIN_TERRITORY_IMAGES", "1")
    h = host()
    step(fr, h, "frames_material", origin="invented", by="Shrey")
    card = step(fr, h, "frames", ids=["t_started"], by="Shrey")[-1]["result"]["info"]["card"]
    r = step(fr, h, "frames", ids=["t_started"], card_id=card["id"], ok=False, by="Shrey")
    assert r[-1]["job"]["state"] == "done" and fr.rw.posts == []
    for inp in ({"step": "frames", "ids": "t_started"}, {"step": "frames", "ids": [1]}, {"step": "frames", "ok": "yes"}, {"step": "frames", "retry_flagged": "x"},
                {"step": "frames", "retry_unknown": "no"}, {"step": "frames_approve"}, {"step": "frames_approve", "keys": []}):
        st, body = post(fr, "run_territories", inp, host().clan())
        assert st == 400, (inp, body)


def test_held_frames_are_not_placed_and_a_named_person_accepts_them(fr, monkeypatch):
    monkeypatch.setenv("NAPKIN_TERRITORY_IMAGES", "1")
    fr.guard = lambda url, body: (_ for _ in ()).throw(OSError("guard unreachable"))
    h = host()
    step(fr, h, "frames_material", origin="invented", by="Shrey")
    card = step(fr, h, "frames", ids=["t_started"], by="Shrey")[-1]["result"]["info"]["card"]
    r = step(fr, h, "frames", ids=["t_started"], card_id=card["id"], by="Shrey")
    assert r[-1]["result"]["info"]["frames"] == {"made": 4, "placed": 0, "held": 4, "still_running": 0, "unknown": 0, "stopped": None}
    assert all(s["kind"] != "frame" for t in h.data["territories"] for s in t.get("pictures", []))
    st = step(fr, h, "frames_status", by="Shrey")[-1]["result"]["info"]["frames"]["frames"]
    assert len(st) == 4 and all(x["held"] and "Nobody could check" in x["why"] for x in st)
    r = step(fr, h, "frames_approve", keys=[x["key"] for x in st], by="")
    assert r[-1]["job"]["state"] == "failed" and "named person" in r[-1]["job"]["error"]["message"]
    r = step(fr, h, "frames_approve", keys=[x["key"] for x in st], by="Shrey")
    assert r[-1]["job"]["state"] == "done" and len([s for s in next(t for t in h.data["territories"] if t["id"] == "t_started")["pictures"] if s["kind"] == "frame"]) == 4
    valid(h)


def test_the_guard_is_the_cloud_check_in_bedrock_and_the_local_one_otherwise(monkeypatch):
    from territory import cloud_guard
    monkeypatch.delenv("NAPKIN_TERRITORY_GUARD", raising=False)
    monkeypatch.delenv("NAPKIN_MODEL_API", raising=False)
    assert rt.make_guard_post() is None
    monkeypatch.setenv("NAPKIN_MODEL_API", "bedrock")
    assert isinstance(rt.make_guard_post(), cloud_guard.CloudGuard)
    monkeypatch.setenv("NAPKIN_TERRITORY_GUARD", "local")
    assert rt.make_guard_post() is None


def test_leaving_a_held_frame_out_needs_a_named_person_and_sticks(fr, monkeypatch):
    monkeypatch.setenv("NAPKIN_TERRITORY_IMAGES", "1")
    fr.guard = lambda url, body: (_ for _ in ()).throw(OSError("guard unreachable"))
    h = host()
    step(fr, h, "frames_material", origin="invented", by="Shrey")
    card = step(fr, h, "frames", ids=["t_started"], by="Shrey")[-1]["result"]["info"]["card"]
    step(fr, h, "frames", ids=["t_started"], card_id=card["id"], by="Shrey")
    st = step(fr, h, "frames_status", by="Shrey")[-1]["result"]["info"]["frames"]["frames"]
    keys = [x["key"] for x in st]
    assert all(x["place"] for x in st), "each held frame says its place"
    for inp in ({"step": "frames_leave"}, {"step": "frames_leave", "keys": []}):
        status, body = post(fr, "run_territories", inp, host().clan())
        assert status == 400, (inp, body)
    r = step(fr, h, "frames_leave", keys=keys[:1], by="")
    assert r[-1]["job"]["state"] == "failed" and "named person" in r[-1]["job"]["error"]["message"]
    r = step(fr, h, "frames_leave", keys=keys[:1], by="Shrey")
    assert r[-1]["job"]["state"] == "done"
    left = step(fr, h, "frames_status", by="Shrey")[-1]["result"]["info"]["frames"]["frames"]
    assert [x["key"] for x in left] == keys[1:], "gone from the status, and it stays gone"
    valid(h)


def test_the_frames_look_is_the_brand_clan_the_host_sends(fr, monkeypatch):
    """Brand Clan phase 2 (d): the host sends the document's Brand Clan as ``clan.brand_clan``; the cost card names it, and without one the card
    says the built-in look."""
    from test_frames import BRAND
    monkeypatch.setenv("NAPKIN_TERRITORY_IMAGES", "1")
    h = host()
    step(fr, h, "frames_material", origin="invented", by="Shrey")
    r = step(fr, h, "frames", ids=["t_started"], by="Shrey")
    assert r[-1]["result"]["info"]["card"]["look"] == {"from": "default"}

    class WithBrand(TerritoriesHost):
        def clan(self):
            return {**super().clan(), "brand_clan": copy.deepcopy(BRAND)}
    hb = WithBrand(data=copy.deepcopy(h.data), schema=SCHEMA)
    hb.chain = h.chain
    r = step(fr, hb, "frames", ids=["t_started"], by="Shrey")
    look = r[-1]["result"]["info"]["card"]["look"]
    assert look["from"] == "brand_clan" and look["name"] == "Original" and look["version"] == 2, look
    assert fr.rw.posts == [], "an ask sends nothing"
