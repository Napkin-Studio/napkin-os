"""Offline tests for frames of the greenlit routes (territory/frames.py, feature territories-pictures-frames). A fake Runway, a fake guard and a
FakeLLM stand in for every paid or local service: nothing here calls a provider. Every brand and route is invented (the example document's Linea).
Run from ``engine/``: ``python -m pytest -q territory/tests/test_frames.py``."""
from __future__ import annotations

import base64
import copy
import json
import re
import urllib.error

import pytest

from territory import cloud_guard, contract, frames, pictures, runner, spend as sp
from territory.llm import FakeLLM
from visuals import jobs as vjobs, runway
from test_visuals import FakeRunway, KEY, PNG, clean_ollama, ollama_down

PLACES = {1: "kitchen", 2: "garden", 3: "street", 4: "market"}
PRICE = re.compile(r"(€|\$|£)\s?\d|\b(USD|EUR|GBP)\b", re.I)
ENV = {runway.KEY_ENV: KEY}


def plan_for(user: str) -> dict:
    ids = [t["id"] for t in json.loads(user)["territories"]]
    return {"territories": [{"id": tid, "shots": [{"shot": f"f{i}", "framing": f"A wide view of a {PLACES[i]} with a jar", "camera": "eye level",
                                                   "action": f"A person opens a cupboard in the {PLACES[i]}", "on_screen_line": f"line {i}"} for i in range(1, 5)]}
                            for tid in ids]}


class Rig:
    """One document, one store folder, the fakes; ``make()`` builds a fresh Frames over the same folder, as each request does."""

    def __init__(self, tmp_path, monkeypatch, *, doc=None, marks=None, rw=None, guard=clean_ollama, llm=None, environ=None):
        monkeypatch.delenv(sp.ENV_IMAGES_CAP, raising=False)
        self.doc = doc or copy.deepcopy(contract.example("data"))
        self.store = runner.Store(tmp_path / "doc1")
        self.blobs = pictures.DirStore(tmp_path / "blobs")
        self.rw, self.guard, self.marks = rw or FakeRunway(), guard, [] if marks is None else marks
        self.llm = llm or FakeLLM({"frames_plan": plan_for})
        self.environ = environ if environ is not None else dict(ENV)

    def make(self, **kw):
        a = dict(doc_id="doc1", marks=self.marks, llm=self.llm, transport=self.rw, guard_post=self.guard, environ=self.environ, sleep=lambda s: None, poll_every=0)
        a.update(kw)
        return frames.Frames(self.doc, self.store, self.blobs, **a)

    def declare(self, origin="invented"):
        self.make().declare(origin, "Shrey")

    def card(self, ids=None, **kw):
        return self.make().ask(ids, **kw)[3]["card"]

    def run(self, ids=None, **kw):
        card = self.card(ids, **kw)
        out = self.make().make(ids, card["id"], **kw)
        self.doc = out[0]
        return out


@pytest.fixture
def rig(tmp_path, monkeypatch):
    r = Rig(tmp_path, monkeypatch)
    r.declare()
    return r


TWO = ["t_started", "t_sunday"]


def slots(doc, tid):
    return next(t for t in doc["territories"] if t["id"] == tid)["pictures"]


def test_only_greenlit_routes_and_the_words_when_not(rig):
    with pytest.raises(frames.Refuse, match="not greenlit"):
        rig.make().ask(["t_sitdown"])
    with pytest.raises(frames.Refuse, match="not a developed, live route"):
        d = copy.deepcopy(rig.doc)
        d["greenlit"].append({"territory_id": "t_breakfast", "by": "Shrey", "at": "2026-11-18T10:05:00Z", "rests_on_derived": [], "derived_resolution": "verified"})
        rig.doc = d
        rig.make().ask(["t_breakfast"])
    d = copy.deepcopy(rig.doc)
    d["greenlit"] = []
    rig.doc = d
    with pytest.raises(frames.Refuse, match="Greenlight a route first"):
        rig.make().ask(None)
    assert rig.rw.posts == []


def test_client_material_is_refused_by_default_and_a_named_declaration_opens_it(tmp_path, monkeypatch):
    r = Rig(tmp_path, monkeypatch)
    with pytest.raises(frames.Refuse, match="client-derived"):
        r.make().ask(TWO)
    with pytest.raises(frames.Refuse, match="named person"):
        r.make().declare("invented", " ")
    r.declare("client")
    with pytest.raises(frames.Refuse, match="client-derived"):
        r.make().ask(TWO)
    r.declare("invented")
    assert r.card(TWO)["frames"] == 8
    r.marks = [{"path": "brief.mandatories", "text": "weekend return fare", "kind": "confidential_field"}]     # a Confidential part: client-derived again
    with pytest.raises(frames.Refuse, match="client-derived"):
        r.make().ask(TWO)
    assert r.rw.posts == []


def test_a_document_never_checked_for_marks_draws_nothing(tmp_path, monkeypatch):
    r = Rig(tmp_path, monkeypatch)
    r.declare()
    r.make(marks=None)
    with pytest.raises(frames.Refuse, match="not checked for parts marked Confidential"):
        frames.Frames(r.doc, r.store, r.blobs, doc_id="doc1", marks=None, environ=r.environ).ask(TWO)


def test_the_card_shows_no_price_and_the_history_carries_it(rig):
    out = rig.make().ask(TWO)
    card, decisions = out[3]["card"], out[4]
    assert not PRICE.search(json.dumps(card)) and "usd" not in json.dumps(card).lower()
    assert card["frames"] == 8 and card["routes"] == 2 and card["plan_call"] is True
    tps = {n["touchpoint"] for n in card["not_offered"]}
    assert tps == {"story", "seat"} and all("cut off" in n["why"] for n in card["not_offered"])      # format feasibility, with the reason
    ask = [d for d in decisions if d["kind"] == "ask"]
    assert len(ask) == 1 and ask[0]["what"] == "frames" and ask[0]["estimate_usd"] > 0 and ask[0]["cap_usd"]["pictures"] == 2.0 and ask[0]["card_id"] == card["id"]
    assert len([d for d in rig.make().ask(TWO)[4] if d["kind"] == "ask"]) == 1, "the same card is asked once"
    assert rig.rw.posts == [] and rig.llm.calls == []


def test_a_yes_needs_the_card_and_an_ask_before_it(rig):
    f = rig.make()
    with pytest.raises(frames.Refuse, match="not the card you were shown"):
        f.make(TWO, "c_0000000000000000")
    with pytest.raises(frames.Refuse, match="not put to a person first"):      # the right id, but nobody asked: no ask in the record
        f.make(TWO, f._card(f._prepare(TWO))["id"])
    assert rig.rw.posts == [] and rig.llm.calls == []


def test_make_runs_the_plan_once_places_frames_by_hash_and_keeps_the_contract(rig):
    out = rig.run(TWO)
    doc, note, info, decisions = out[0], out[2], out[3], out[4]
    assert rig.llm.calls == ["frames_plan"], "one plan call for both routes"
    assert len(rig.rw.posts) == 8 and info["frames"]["placed"] == 8 and info["frames"]["held"] == 0 and "8 pictures placed" in note
    for tid in TWO:
        fr = [s for s in slots(doc, tid) if s["kind"] == "frame"]
        assert [s["touchpoint"] for s in fr] == ["tv"] * 4 and len({s["sha256"] for s in fr}) == 4
        for s in fr:
            contract.validate_shape("picture", s)
            assert s["image"] == "sha256:" + s["sha256"] and s["rights"] == "generated" and pictures.label_of(s) == "Illustrative" and rig.blobs.has(s["sha256"])
            assert pictures.hash_of(rig.blobs.get(s["sha256"])) == s["sha256"]
        assert all(s["kind"] != "frame" for s in slots(doc, tid) if s["touchpoint"] != "tv"), "nothing is offered to the places a wide frame cannot hold"
    assert slots(doc, "t_passenger") == next(t for t in contract.example("data")["territories"] if t["id"] == "t_passenger")["pictures"], "a greenlit route not asked for is untouched"
    m = runway.load_manifest(next((rig.store.dir / "frames").glob("v-*")))
    placed = {s["sha256"] for tid in TWO for s in slots(doc, tid) if s["kind"] == "frame"}
    assert placed == {e["sha256"] for e in m["frames"].values()}, "the manifest's hashes are the document's"
    pytest.importorskip("jsonschema")
    assert contract.problems(doc) == [] and contract.lint(doc) == []
    spends = [d for d in decisions if d["kind"] == "spend"]
    assert {d["provider"] for d in spends} == {sp.PICTURES, sp.CLAUDE} and sum(d["usd"] for d in spends if d["provider"] == sp.PICTURES) == pytest.approx(0.56)
    assert [d for d in decisions if d["kind"] == "outcome"][-1]["counts"] == {"made": 8, "placed": 8, "held": 0}


def test_a_second_run_pays_nothing_again_and_a_new_route_gets_its_own_plan_call(rig):
    rig.run(TWO)
    posts = len(rig.rw.posts)
    with pytest.raises(frames.Refuse, match="Nothing new"):
        rig.card(TWO)
    out = rig.run(TWO + ["t_passenger"])
    assert len(rig.rw.posts) == posts + 4 and rig.llm.calls == ["frames_plan", "frames_plan"]
    plan = json.loads((rig.store.dir / "frames" / "plan.json").read_text())
    assert set(plan["territories"]) == {"t_started", "t_sunday", "t_passenger"}
    assert out[3]["frames"]["placed"] == 4


def test_a_route_whose_words_changed_is_asked_for_again(rig):
    rig.run(["t_started"])
    d = copy.deepcopy(rig.doc)
    next(t for t in d["territories"] if t["id"] == "t_started")["thought"] = "A different thought entirely."
    rig.doc = d
    c = rig.card(["t_started"])
    assert c["frames"] == 4 and c["plan_call"] is True


def test_flagged_and_unchecked_frames_are_held_never_placed_until_a_person_accepts(tmp_path, monkeypatch):
    def guard(url, body):
        png = base64.b64decode(body["messages"][0]["images"][0])
        if b"task-1" in png and b"task-1" + b"0" not in png:                 # the first picture shows a brand
            return {"message": {"content": json.dumps({"readable_text": [], "logos_or_brands": ["ACMELOGO"], "banned_imagery": []})}}
        if b"task-2" in png:                                                  # the second shows words that are not the planned line
            return {"message": {"content": json.dumps({"readable_text": ["PREMIUM JAM"], "logos_or_brands": [], "banned_imagery": []})}}
        return {"message": {"content": json.dumps({"readable_text": [], "logos_or_brands": [], "banned_imagery": []})}}
    r = Rig(tmp_path, monkeypatch, guard=guard)
    r.declare()
    out = r.run(["t_started"])
    assert out[3]["frames"]["placed"] == 2 and out[3]["frames"]["held"] == 2 and "2 held" in out[2]
    assert len([s for s in slots(out[0], "t_started") if s["kind"] == "frame"]) == 2
    st = r.make().status()[3]["frames"]["frames"]
    held = {x["key"]: x for x in st if x["held"]}
    assert len(held) == 2 and any("ACMELOGO" in x["why"] for x in held.values())
    words = [x["why"] for x in held.values() if "PREMIUM JAM" in x["why"]][0]
    assert "line 2" in words, "the exact words are said beside what the picture shows"
    with pytest.raises(frames.Refuse, match="named person"):
        r.make().approve(list(held), "")
    doc, _ref, note, *_ = r.make().approve(list(held), "Shrey")
    assert "2 accepted by Shrey" in note and len([s for s in slots(doc, "t_started") if s["kind"] == "frame"]) == 4


def test_a_guard_that_is_down_fails_closed(tmp_path, monkeypatch):
    r = Rig(tmp_path, monkeypatch, guard=ollama_down)
    r.declare()
    out = r.run(["t_started"])
    assert out[3]["frames"]["placed"] == 0 and out[3]["frames"]["held"] == 4
    assert all(s["kind"] != "frame" for s in slots(out[0], "t_started"))
    assert all("Nobody could check" in x["why"] for x in r.make().status()[3]["frames"]["frames"])


def test_a_create_with_no_answer_is_never_paid_twice(tmp_path, monkeypatch):
    class DropsTheFirst(FakeRunway):
        def __call__(self, method, url, headers, body):
            if method == "POST" and url.endswith("/text_to_image") and not self.posts:
                self.posts.append(json.loads(body))
                raise TimeoutError("no answer")
            return super().__call__(method, url, headers, body)
    rw = DropsTheFirst()
    r = Rig(tmp_path, monkeypatch, rw=rw)
    r.declare()
    out = r.run(["t_started"])
    assert len(rw.posts) == 1 and out[3]["frames"]["unknown"] == 1 and out[3]["frames"]["placed"] == 0 and "may already be billed" in out[2]
    c = r.card(["t_started"])
    assert c["unknown"] == 1 and c["frames"] == 3, "the card shows the unknown job and does not count it as new"
    out = r.make().make(["t_started"], c["id"])
    assert len(rw.posts) == 4 and out[3]["frames"]["placed"] == 3 and out[3]["frames"]["unknown"] == 1
    r.doc = out[0]
    assert len({p["promptText"] for p in rw.posts}) == 4, "the unknown job was not created again by itself"
    c2 = r.card(["t_started"], retry_unknown=True)
    assert c2["frames"] == 1 and c2["unknown"] == 0, "re-creating the unknown job is its own card, which shows it"
    with pytest.raises(frames.Refuse, match="not the card you were shown"):
        r.make().make(["t_started"], c["id"], retry_unknown=True)
    out = r.make().make(["t_started"], c2["id"], retry_unknown=True)
    assert len(rw.posts) == 5 and out[3]["frames"]["placed"] == 1
    assert vjobs.spent_usd({"jobs": {}}, r.make().ledger) == pytest.approx(0.35), "the dropped send still counts"


def test_the_pictures_cap_is_its_own_and_stops_before_any_send(tmp_path, monkeypatch):
    r = Rig(tmp_path, monkeypatch)
    r.declare()
    monkeypatch.setenv(sp.ENV_IMAGES_CAP, "0.20")
    with pytest.raises(frames.Refuse, match="limit"):
        r.make().ask(TWO)                                       # 8 pictures do not fit 0.20
    assert r.rw.posts == [] and r.llm.calls == []
    monkeypatch.setenv(sp.ENV_IMAGES_CAP, "99")
    assert r.make().cap == runway.LIFETIME_CAP_USD, "no setting lifts the cap above the lifetime maximum"
    monkeypatch.setenv(sp.ENV_IMAGES_CAP, "0.30")
    out = r.run(["t_started"])                                   # 4 pictures = 0.28: fits
    assert out[3]["frames"]["placed"] == 4
    with pytest.raises(frames.Refuse, match="limit"):
        r.card(["t_sunday"])                                    # the lifetime ledger already holds 0.28 of 0.30
    assert len(r.rw.posts) == 4


def test_provider_and_claude_spend_are_separate_lines(rig):
    out = rig.run(TWO)
    spend = sp.Spend(doc="doc1", store=rig.store.spend_path)
    assert spend.total(sp.PICTURES) == pytest.approx(0.56) and spend.total(sp.CLAUDE) == 0.0   # FakeLLM reports no spend; none leaks into the pictures line
    assert vjobs.spent_usd({"jobs": {}}, rig.make().ledger) == pytest.approx(0.56)
    assert not PRICE.search(json.dumps(out[0])), "no price in the document"


def test_a_sensitive_category_waits_for_a_named_review(rig):
    d = copy.deepcopy(rig.doc)
    d["review"] = {"sensitive": {"required": True, "status": "open"}}
    rig.doc = d
    with pytest.raises(frames.Refuse, match="sensitive"):
        rig.make().ask(TWO)
    assert rig.rw.posts == []


def test_a_shot_that_draws_on_a_confidential_part_is_refused_not_sent(tmp_path, monkeypatch):
    def plan(user):
        out = plan_for(user)
        for t in out["territories"]:
            t["shots"][0].update(framing="A wide view of a kitchen with a jar", action="A person opens a cupboard in the garden")
        return out
    marks = [{"path": "brief.mandatories", "text": "kitchen cupboard garden", "kind": "confidential_field"}]
    r = Rig(tmp_path, monkeypatch, llm=FakeLLM({"frames_plan": plan}), marks=marks, environ={**ENV, "VISUALS_CLIENT_TO_RUNWAY": "allow"})
    r.declare("invented")
    out = r.run(["t_started"])
    assert len(r.rw.posts) == 3 and out[3]["frames"]["placed"] == 3, "the shot that would draw on the marked part is refused, the other three go"
    refused = [x for x in r.make().status()[3]["frames"]["frames"] if x["status"] == "REFUSED"]
    assert len(refused) == 1 and "cannot go to a picture model" in refused[0]["why"] and "Confidential" in refused[0]["why"]


def test_no_key_means_nothing_is_made(tmp_path, monkeypatch):
    r = Rig(tmp_path, monkeypatch, environ={})
    r.declare()
    c = r.card(["t_started"])
    with pytest.raises(frames.Refuse, match="not connected"):
        r.make().make(["t_started"], c["id"])
    assert r.rw.posts == []


def test_the_switch_is_off_unless_set():
    assert frames.enabled({}) is False and frames.enabled({frames.ENV_ENABLE: "1"}) is True and frames.enabled({frames.ENV_ENABLE: "0"}) is False


def test_retrying_a_flagged_frame_costs_a_new_card_and_keeps_its_history(tmp_path, monkeypatch):
    calls = {"n": 0}

    def guard(url, body):
        calls["n"] += 1
        found = ["ACMELOGO"] if calls["n"] == 1 else []
        return {"message": {"content": json.dumps({"readable_text": [], "logos_or_brands": found, "banned_imagery": []})}}
    r = Rig(tmp_path, monkeypatch, guard=guard)
    r.declare()
    r.run(["t_started"])
    st = r.make().status()[3]["frames"]["frames"]
    key = next(x["key"] for x in st if x["held"])
    c = r.card(["t_started"], retry_flagged=[key])
    assert c["frames"] == 1
    out = r.make().make(["t_started"], c["id"], retry_flagged=[key])
    assert len(r.rw.posts) == 5 and out[3]["frames"]["placed"] == 1
    e = runway.load_manifest(next((r.store.dir / "frames").glob("v-*")))["frames"][key]
    assert len(e["history"]) == 1 and e["attempts"] == 2
    assert vjobs.spent_usd({"jobs": {}}, r.make().ledger) == pytest.approx(0.35), "both attempts count"


# ---------------------------------------------------------------- the cloud check (Claude Haiku in Bedrock), rights, and the client's style


class FakeBedrock:
    """The Bedrock client the middleware uses, with no network: ``messages.create`` answers from ``reply(kw)`` and counts calls."""

    def __init__(self, reply=None, boom=None):
        self.calls, self.boom = [], boom
        self.reply = reply or (lambda kw: {"readable_text": [], "logos_or_brands": [], "banned_imagery": []})
        outer = self

        class _M:
            def create(self, **kw):
                outer.calls.append(kw)
                if outer.boom:
                    raise outer.boom
                from types import SimpleNamespace as N
                return N(content=[N(type="text", text=json.dumps(outer.reply(kw)))], usage=N(input_tokens=1500, output_tokens=60))
        self.messages = _M()


def test_the_cloud_check_is_one_haiku_call_per_frame_recorded_under_the_claude_cap(tmp_path, monkeypatch):
    fb = FakeBedrock()
    r = Rig(tmp_path, monkeypatch, guard=cloud_guard.CloudGuard(client=fb))
    r.declare()
    out = r.run(["t_started"])
    assert out[3]["frames"]["placed"] == 4 and out[3]["frames"]["held"] == 0
    assert len(fb.calls) == 4, "one call per frame"
    kw = fb.calls[0]
    assert kw["model"] == "claude-haiku-4-5" and kw["messages"][0]["content"][0]["type"] == "image" and "readable text" in kw["messages"][0]["content"][1]["text"]
    s = r.make().spend
    lines = [l for l in s.lines if l["stage"] == "frame_check"]
    assert len(lines) == 4 and all(l["provider"] == sp.CLAUDE and l["model"] == "claude-haiku-4-5" and l["usd"] > 0 for l in lines)
    assert s.total(sp.CLAUDE) >= sum(l["usd"] for l in lines) and s.total(sp.PICTURES) > 0, "Claude and picture spend stay separate lines"


def test_the_cloud_check_reads_text_brands_and_banned_imagery_like_the_local_one(tmp_path, monkeypatch):
    n = {"i": 0}

    def reply(kw):
        n["i"] += 1
        return [{"readable_text": [], "logos_or_brands": ["ACMELOGO"], "banned_imagery": []},
                {"readable_text": ["PREMIUM JAM"], "logos_or_brands": [], "banned_imagery": []},
                {"readable_text": ["line 3"], "logos_or_brands": [], "banned_imagery": []},
                {"readable_text": [], "logos_or_brands": [], "banned_imagery": []}][(n["i"] - 1) % 4]
    r = Rig(tmp_path, monkeypatch, guard=cloud_guard.CloudGuard(client=FakeBedrock(reply)))
    r.declare()
    out = r.run(["t_started"])
    assert out[3]["frames"]["held"] == 3 and out[3]["frames"]["placed"] == 1
    why = " ".join(x["why"] for x in r.make().status()[3]["frames"]["frames"] if x["held"])
    assert "ACMELOGO" in why and "PREMIUM JAM" in why and "line 2" in why, "the exact words, beside what the picture shows"


def test_a_failed_or_capped_cloud_check_holds_the_frame(tmp_path, monkeypatch):
    r = Rig(tmp_path, monkeypatch, guard=cloud_guard.CloudGuard(client=FakeBedrock(boom=RuntimeError("throttled"))))
    r.declare()
    out = r.run(["t_started"])
    assert out[3]["frames"]["placed"] == 0 and out[3]["frames"]["held"] == 4
    assert all("Nobody could check" in x["why"] and "failed" in x["why"] for x in r.make().status()[3]["frames"]["frames"])
    # a call the Claude cap refuses is not made, and the frame is held with the cap's own words
    from visuals import guard as guard_mod
    fb = FakeBedrock()
    tiny = sp.Spend(cap_usd=0.0001, images_cap_usd=1.0)
    g = guard_mod.check_image(PNG, [], post=cloud_guard.CloudGuard(client=fb).bind(tiny), name="x")
    assert g["checked"] is False and "limit" in g["reason"] and fb.calls == []


def test_a_cloud_check_of_the_same_picture_is_never_paid_twice():
    from visuals import guard as guard_mod
    fb, s = FakeBedrock(), sp.Spend(cap_usd=1.0, images_cap_usd=1.0)
    post = cloud_guard.CloudGuard(client=fb).bind(s)
    a, b = guard_mod.check_image(PNG, ["x"], post=post), guard_mod.check_image(PNG, ["x"], post=post)
    assert a == b and a["checked"] and len(fb.calls) == 1 and s.count(sp.CLAUDE) == 1


def test_the_guard_is_picked_by_config():
    assert cloud_guard.choose({}) is None and cloud_guard.choose({"NAPKIN_TERRITORY_GUARD": "local", "NAPKIN_MODEL_API": "bedrock"}) is None
    assert isinstance(cloud_guard.choose({"NAPKIN_MODEL_API": "bedrock"}), cloud_guard.CloudGuard)
    assert isinstance(cloud_guard.choose({"NAPKIN_TERRITORY_GUARD": "bedrock"}), cloud_guard.CloudGuard)
    with pytest.raises(ValueError):
        cloud_guard.choose({"NAPKIN_TERRITORY_GUARD": "other"})


def test_the_cloud_check_without_bedrock_configured_fails_closed(monkeypatch):
    from visuals import guard as guard_mod
    monkeypatch.delenv("NAPKIN_MODEL_API", raising=False)
    g = guard_mod.check_image(PNG, [], post=cloud_guard.CloudGuard().bind(sp.Spend(cap_usd=1.0, images_cap_usd=1.0)), name="x")
    assert g["checked"] is False and "Bedrock" in g["reason"]


def test_frames_start_as_generated(rig):
    out = rig.run(["t_started"])
    got = [s for s in slots(out[0], "t_started") if s["kind"] == "frame"]
    assert got and all(s["rights"] == "generated" and pictures.rights_word(s["rights"]) == "Generated" for s in got)


def test_each_client_has_its_own_style_and_never_the_agency(tmp_path, monkeypatch):
    r = Rig(tmp_path, monkeypatch)
    r.declare()
    assert frames.client_of(r.doc) == "Linea"
    base = r.make()._prepare(None)["sty"]
    assert base.source.startswith("default")
    sd = r.store.dir / "frames" / "style"

    def pack(name, look):
        (sd / name).mkdir(parents=True)
        (sd / name / "style.yaml").write_text(f"look: [{look}]\nfinish: rough\n")
    pack("linea", "chalk and soft paper")
    pack("napkin-studio", "agency look that must never be used")        # an agency-keyed folder is never read
    mine = r.make()._prepare(None)["sty"]
    assert mine.look == ["chalk and soft paper"] and mine.hash != base.hash
    other = copy.deepcopy(r.doc)
    other["title"] = "Orchard Co: summer"
    other["upstream"] = {}
    assert frames.client_of(other) == "Orchard Co"
    r2 = Rig(tmp_path, monkeypatch, doc=other)
    r2.declare()
    assert r2.make()._prepare(None)["sty"].hash == base.hash, "a client with no pack gets the built-in default, not another client's"
    assert frames.client_slug("../Évil/Co") == "evil-co" and frames.style_folder(sd, "") is None


def test_a_left_out_frame_is_never_placed_is_gone_from_status_and_a_new_ask_may_fill_its_place_again(tmp_path, monkeypatch):
    def guard(url, body):
        png = base64.b64decode(body["messages"][0]["images"][0])
        if b"task-1" in png and b"task-1" + b"0" not in png:
            return {"message": {"content": json.dumps({"readable_text": [], "logos_or_brands": ["ACMELOGO"], "banned_imagery": []})}}
        return {"message": {"content": json.dumps({"readable_text": [], "logos_or_brands": [], "banned_imagery": []})}}
    r = Rig(tmp_path, monkeypatch, guard=guard)
    r.declare()
    out = r.run(["t_started"])
    assert out[3]["frames"]["placed"] == 3 and out[3]["frames"]["held"] == 1
    held = [x for x in r.make().status()[3]["frames"]["frames"] if x["held"]]
    assert len(held) == 1
    with pytest.raises(frames.Refuse, match="named person"):
        r.make().leave([held[0]["key"]], "")
    with pytest.raises(frames.Refuse, match="waiting for a person"):
        r.make().leave(["no-such-key"], "Shrey")
    doc, _ref, note, _info, decisions = r.make().leave([held[0]["key"]], "Shrey")
    assert "1 left out by Shrey" in note
    assert any(d.get("what") == "frames_left_out" and d["counts"]["by"] == "Shrey" for d in decisions), "who did it is in the history"
    assert not [x for x in r.make().status()[3]["frames"]["frames"] if x["held"]], "gone from the status"
    with pytest.raises(frames.Refuse, match="waiting for a person"):
        r.make().leave([held[0]["key"]], "Shrey")
    assert len([s for s in slots(doc, "t_started") if s["kind"] == "frame"]) == 3, "its place stays a sketch"
    assert r.make().ask(["t_started"])[3]["card"]["frames"] == 1, "a later ask counts it as new"


def test_status_says_the_place_each_frame_was_made_for_and_placing_keeps_to_it(tmp_path, monkeypatch):
    def guard(url, body):
        png = base64.b64decode(body["messages"][0]["images"][0])
        if b"task-3" in png and b"task-3" + b"0" not in png:                  # the third shot is held
            return {"message": {"content": json.dumps({"readable_text": [], "logos_or_brands": ["ACMELOGO"], "banned_imagery": []})}}
        return {"message": {"content": json.dumps({"readable_text": [], "logos_or_brands": [], "banned_imagery": []})}}
    r = Rig(tmp_path, monkeypatch, guard=guard)
    r.declare()
    out = r.run(["t_started"])
    t = next(x for x in out[0]["territories"] if x["id"] == "t_started")
    tv = [s for s in t["pictures"] if s["touchpoint"] == "tv"]
    st = {x["shot"]: x for x in r.make().status()[3]["frames"]["frames"]}
    assert st["f3"]["held"] and st["f3"]["place"] == tv[2]["id"] and tv[2]["kind"] != "frame", "the held one keeps its own place open"
    assert [s["kind"] for s in tv] == ["frame", "frame", "sketch", "frame"]
    assert st["f1"]["place"] == tv[0]["id"]


def test_the_pictures_made_go_back_with_the_move_for_the_host_to_save(rig):
    """Owner 2026-11-26: the host stores a frame's bytes as the document's linked asset. The move hands back every picture it made (placed or
    held) as {name: frames/<sha256>.png, sha256, data}; the status names each held one's asset, which is where the page draws it."""
    out = rig.run(["t_started"])
    info = out[3]
    assets = info["assets"]
    assert assets and all(re.fullmatch(r"frames/[0-9a-f]{64}\.png", a["name"]) for a in assets)
    assert all(a["name"] == f"frames/{a['sha256']}.png" and pictures.hash_of(a["data"]) == a["sha256"] for a in assets)
    placed = {s["sha256"] for s in slots(out[0], "t_started") if s["kind"] == "frame"}
    assert placed and placed <= {a["sha256"] for a in assets}, "every placed frame's bytes go back"
    status = rig.make().status()[3]["frames"]["frames"]
    assert status and all(e["asset"] == f"frames/{e['sha256']}.png" for e in status if e.get("sha256"))
    assert frames.asset_name("ab" * 32, b"\xff\xd8\xff\xe0") == "frames/" + "ab" * 32 + ".jpg"
