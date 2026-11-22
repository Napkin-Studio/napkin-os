"""production-spinoff, the Deck side: a Production project spun off into a Deck is carried whole under ``data.upstream.<id>``; the deck reads its
finals first, then Sai's rules for the empty slots; states rights as Production states them; fetches pictures by link at build (a fake relay
here: nothing opens a socket); and takes the brief the project carries when it has none of its own. The project is the invented Lumen Water one
fixtures/production_demo/make_bundle.py builds in code (no client material).
Run from engine/: ``PYTHONPATH=. python3 -m pytest deck/tests/test_production_spinoff.py``."""
from __future__ import annotations

import copy
import hashlib
import json
import shutil
import socket
import sys
import zipfile
from pathlib import Path

import pytest
import yaml

from deck import from_production as fp, images, inputs, prod_picker as pp, spec

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / "fixtures" / "production_demo"))
import make_bundle as mb   # noqa: E402

sys.path.remove(str(HERE / "fixtures" / "production_demo"))

MASTER_NEW, MASTER_OLD = f"{mb.FSET_NEW}#master", f"{mb.FSET_OLD}#master"
SOURCE_ID = "doc-lumen-production-0001"


@pytest.fixture(autouse=True)
def no_socket(monkeypatch):
    def refuse(*a, **k):
        raise AssertionError("production-spinoff opened a socket")
    monkeypatch.setattr(socket.socket, "connect", refuse)
    monkeypatch.setattr(socket.socket, "connect_ex", refuse)
    monkeypatch.setattr(socket, "getaddrinfo", refuse)


@pytest.fixture(scope="module")
def pics():
    return {k: mb.draw(*v) for k, v in mb.PICTURES.items()}


def final(n, kind, of, asset, **kw):
    return {"id": mb.uid("final", n), "v": 1, "field_v": {}, "of": {"kind": kind, "id": of}, "asset": asset, "at": f"2026-11-22T10:0{n}:00Z",
            "by": "human:demo-producer", **kw}


def carried_doc(pics, finals=(), mutate=None):
    """The Production project's contract-3 data as the Deck carries it. ``finals``: [(kind, of id, picture name, extra)]."""
    doc = mb.document(pics)
    doc["finals"] = {}
    for n, (kind, of, name, extra) in enumerate(finals, 1):
        f = final(n, kind, of, mb.sha(pics[name]), **extra)
        doc["finals"][f["id"]] = f
    if mutate:
        mutate(doc)
    return doc


class FakeRelay:
    """The relay's asset route as a transport: ``fetch(sha hex, w) -> bytes``, serving the fixture's drawn pictures; every call is recorded."""

    def __init__(self, pics, only=None):
        self.by_hex = {hashlib.sha256(b).hexdigest(): b for b in pics.values()}
        self.calls, self.only = [], only

    def __call__(self, hx, w):
        self.calls.append((hx, w))
        if hx not in self.by_hex or (self.only is not None and hx not in self.only):
            raise pp.RelayError("no such picture for this agency (404)")
        return self.by_hex[hx]


def deck():
    slides = {"s01": {"type": "title", "title": "Lumen Water"}, "s02": {"type": "idea", "title": "Every drop has a story."},
              "s03": {"type": "execution", "title": "Social stories"}, "s04": {"type": "execution", "title": "Outdoor"},
              "s05": {"type": "execution", "title": "TV film"}, "s06": {"type": "territory", "title": "Territory: The Tap Tells"}}
    return {"meta": {"client": "Lumen Water"}, "order": list(slides), "slides": slides}


def im(d, sid, slot="picture"):
    return ((d["slides"][sid].get("slots") or {}).get(slot) or {}).get("image")


def build(tmp_path, pics, finals=(), mutate=None, relay=True, choices=None, name="st"):
    d = deck()
    st = tmp_path / name
    fake = FakeRelay(pics) if relay is True else relay
    src = pp.CarriedSource(SOURCE_ID, carried_doc(pics, finals, mutate))
    res = pp.run(d, src, st, relay=pp.RelayAssets(fake, st / "relay_cache") if fake else None, choices=choices)
    return d, res, st, fake


# ---------------------------------------------------------------- reading the carried data

def test_the_carried_project_is_found_and_is_neither_brief_nor_research(pics):
    doc = carried_doc(pics)
    got = fp.carried({"upstream": {"doc-brief": {"insight": "x"}, SOURCE_ID: doc}})
    assert got[0] == SOURCE_ID and got[1]["project"]["id"] == mb.PROJECT
    brief = {"background": "Lumen Water sells bottled spring water.", "insight": "Water is a habit nobody sees."}
    inp = inputs.from_upstream({"upstream": {"doc-brief": brief, SOURCE_ID: doc}})
    assert inp.brief["background"]["value"].startswith("Lumen Water sells") and inp.coverage["brief_source"] == "brief-maker clan"
    assert inp.research_doc_id is None and not inp.findings   # the project was not taken for research
    assert fp.carried({"upstream": {"doc-brief": brief}}) is None


def test_a_carried_project_of_another_contract_is_refused(pics):
    with pytest.raises(fp.FromProductionError, match="contract '4'"):
        fp.carried({"upstream": {SOURCE_ID: {**carried_doc(pics), "contract_version": "4"}}})
    with pytest.raises(fp.FromProductionError, match="no project id"):
        pp.CarriedSource("x", {**carried_doc(pics), "project": {"id": "nope"}})


def test_the_deck_document_names_the_carried_project_for_the_runner(tmp_path, pics):
    p = tmp_path / "deck.clan"
    with zipfile.ZipFile(p, "w") as z:
        z.writestr("manifest.yaml", yaml.safe_dump({"format": "clan", "document_id": "doc-deck-1"}))
        z.writestr("shared/data.yaml", json.dumps({"inputs": {"prompt": {"text": "A pitch"}}, "upstream": {SOURCE_ID: carried_doc(pics)}}))
    inp, ctx = inputs.from_deck_document(p)
    assert ctx["production"][0] == SOURCE_ID and ctx["production"][1]["app"] == "production-tool"
    assert inp.coverage["brief_source"] == "production"   # no brief upstream: the project's own


# ---------------------------------------------------------------- the brief it carries

def test_a_deck_with_no_brief_takes_the_projects_and_marks_its_confidential_part(pics):
    inp = inputs.from_upstream({"upstream": {SOURCE_ID: carried_doc(pics)}})
    assert inp.coverage["brief_source"] == "production" and inp.coverage["brief_fields_filled"] == 2
    assert inp.brief["smp"]["value"] == "Every drop has a story." and inp.brief["insight"]["value"].startswith("SECRET-INSIGHT-LUMEN")
    assert [m["path"] for m in inp.marks] == ["insight"] and "SECRET-INSIGHT-LUMEN" in inp.marks[0]["text"]   # kept from picture models
    assert inp.has_brief()


def test_the_decks_own_brief_is_never_replaced_by_the_projects(pics):
    brief = {"insight": "Our own insight", "single_minded_proposition": "Our own proposition"}
    inp = inputs.from_upstream({"upstream": {"doc-brief": brief, SOURCE_ID: carried_doc(pics)}})
    assert inp.brief["insight"]["value"] == "Our own insight" and inp.coverage["brief_source"] == "brief-maker clan"
    again = inputs.load(None, prompt_text="x")   # the engine server's path: no brief at all, then the project's (apply_production_brief)
    assert not again.has_brief() and inputs.apply_production_brief(again, SOURCE_ID, carried_doc(pics))
    assert again.brief["smp"]["value"] == "Every drop has a story." and again.coverage["brief_source"] == "production"
    assert not inputs.apply_production_brief(inp, SOURCE_ID, carried_doc(pics))   # one that has a brief takes nothing
    assert not inputs.apply_production_brief(inputs.load(None, prompt_text="x"), SOURCE_ID, carried_doc(pics, mutate=lambda d: d["briefs"].clear()))


# ---------------------------------------------------------------- finals first

def test_without_finals_the_rules_pick_as_before(tmp_path, pics):
    d, res, st, _ = build(tmp_path, pics)
    assert im(d, "s01")["from"]["key"] == MASTER_NEW and im(d, "s03")["from"]["key"] == mb.S_STORY
    assert all(p["by"] == "rule" for p in res["picker"]["picks"])


def test_a_key_visual_marked_final_beats_the_rules_choice(tmp_path, pics):
    stated = lambda d: d["assets"][mb.sha(pics["upload_master"])].update(rights="licensed")   # noqa: E731
    d, res, st, _ = build(tmp_path, pics, [("picture", "pic_up_0002", "upload_master", {})], mutate=stated)
    assert im(d, "s01")["from"]["key"] == MASTER_OLD and im(d, "s02")["from"]["key"] == MASTER_OLD   # the older set's, not the newest set's
    assert im(d, "s01")["status"] == "made" and "final" in {p["by"] for p in res["picker"]["picks"]}
    prod = json.loads((st / "production.json").read_text())
    assert prod["items"][MASTER_OLD]["final"] is True and prod["items"][MASTER_OLD]["rights"] == "licensed"


def test_a_size_marked_final_fills_its_channels_slot_and_the_picture_marked_is_the_one_used(tmp_path, pics):
    stated = lambda d: d["assets"][mb.sha(pics["upload_master"])].update(rights="own")   # noqa: E731  (the size was made from that upload)
    d, res, st, _ = build(tmp_path, pics, [("size", mb.S_OLD_STORY, "old_story", {"set_id": mb.FSET_OLD})], mutate=stated)
    assert im(d, "s03")["from"]["key"] == mb.S_OLD_STORY   # the rules would take the key visual's own set (mb.S_STORY)
    prod = json.loads((st / "production.json").read_text())
    assert prod["items"][mb.S_OLD_STORY]["final"] is True and prod["items"][mb.S_OLD_STORY]["sha256"] == hashlib.sha256(pics["old_story"]).hexdigest()


def test_a_final_of_a_size_that_was_removed_still_stands_and_the_marked_picture_wins_over_a_remake(tmp_path, pics):
    def gone(d):
        del d["sizes"][mb.S_OLD_STORY]
        d["assets"][mb.sha(pics["old_story"])]["rights"] = "own"
    fin = ("size", mb.S_OLD_STORY, "old_story", {"set_id": mb.FSET_OLD, "format": {"pack_id": "social", "pack_version": "2026-10-13", "format_id": "meta-stories-9x16"}})
    d, res, st, _ = build(tmp_path, pics, [fin], mutate=gone)
    assert im(d, "s03")["from"]["key"] == mb.S_OLD_STORY and im(d, "s03")["status"] == "made"
    # remade since: the size now holds another picture, the final still names the one marked
    def remade(doc):
        doc["sizes"][mb.S_STORY]["asset"] = mb.sha(pics["six"])
    d2, _, st2, _ = build(tmp_path, pics, [("size", mb.S_STORY, "story", {"set_id": mb.FSET_NEW})], mutate=remade, name="st2")
    prod2 = json.loads((st2 / "production.json").read_text())
    assert prod2["items"][mb.S_STORY]["sha256"] == hashlib.sha256(pics["story"]).hexdigest() and prod2["items"][mb.S_STORY]["status"] == "ready"


def test_a_still_frame_marked_final_stands_in_for_the_pick_and_only_finals_reach_the_film_slide(tmp_path, pics):
    d, res, st, _ = build(tmp_path, pics, [("frame", mb.F1_OLD, "f1_old", {})])   # an alternate of shot 1, not the pick
    assert im(d, "s05")["from"]["key"] == mb.F1_OLD
    prod = json.loads((st / "production.json").read_text())
    assert [k for k, i in prod["items"].items() if i["role"] == "frame"] == [mb.F1_OLD]   # only the final was pulled
    d2, _, _, _ = build(tmp_path, pics, name="st2")
    assert im(d2, "s05")["from"]["key"] == mb.F1   # no final: today's pick


def test_a_canvas_picture_marked_final_that_no_format_set_holds_is_a_key_visual_of_its_own(tmp_path, pics):
    d, res, st, _ = build(tmp_path, pics, [("picture", "pic_solo_0001", "f2", {})])
    key = next(iter(k for k in json.loads((st / "production.json").read_text())["items"] if k.endswith("#master") and k.startswith("final_")))
    assert im(d, "s01")["from"]["key"] == key and im(d, "s02")["from"]["key"] == key
    prod = json.loads((st / "production.json").read_text())
    assert prod["format_sets"][key.split("#")[0]]["master"] == key and prod["items"][key]["role"] == "master"


def test_a_persons_swap_still_beats_a_final(tmp_path, pics):
    d, res, st, _ = build(tmp_path, pics, [("picture", "pic_up_0002", "upload_master", {})],
                          mutate=lambda doc: doc["assets"][mb.sha(pics["upload_master"])].update(rights="licensed"),
                          choices={"s01.picture": {"key": MASTER_NEW, "by": "a person (--production-pick)", "at": "t"}})
    assert im(d, "s01")["from"]["key"] == MASTER_NEW and im(d, "s02")["from"]["key"] == MASTER_OLD
    assert next(p for p in res["picker"]["picks"] if p["slot"] == "s01.picture")["by"] == "person"


# ---------------------------------------------------------------- rights

def test_a_final_whose_rights_are_unknown_waits_to_be_supplied_and_is_never_fetched(tmp_path, pics):
    unknown = lambda d: d["assets"][mb.sha(pics["upload_master"])].update(rights="unknown")   # noqa: E731
    d, res, st, relay = build(tmp_path, pics, [("picture", "pic_up_0002", "upload_master", {})], mutate=unknown)
    assert im(d, "s01")["status"] == "empty" and im(d, "s01")["reason"].startswith(spec.RIGHTS_TO_SUPPLY)
    assert "waiting for rights" in res["card"]
    assert hashlib.sha256(pics["upload_master"]).hexdigest() not in [c[0] for c in relay.calls]   # a held picture is never pulled


def test_stated_licensed_own_and_generated_are_placed(tmp_path, pics):
    for stated in ("licensed", "own", "generated"):
        d, res, st, _ = build(tmp_path, pics, [("picture", "pic_up_0002", "upload_master", {})], name=stated,
                              mutate=lambda doc, s=stated: doc["assets"][mb.sha(pics["upload_master"])].update(rights=s))
        assert im(d, "s01")["status"] == "made", stated


# ---------------------------------------------------------------- pictures by link

def test_pictures_are_fetched_by_hash_at_2400_wide_once_each_and_never_embedded(tmp_path, pics):
    d, res, st, relay = build(tmp_path, pics)
    assert relay.calls and {w for _, w in relay.calls} == {2400}
    hexes = [h for h, _ in relay.calls]
    assert len(hexes) == len(set(hexes))   # the key visual serves the cover and the idea: fetched once
    assert hashlib.sha256(pics["master"]).hexdigest() in hexes and hashlib.sha256(pics["upload_master"]).hexdigest() not in hexes   # only what the picks need
    assert {p["from"] for p in res["picker"]["picks"] if p["from"] not in ("rights", "not reachable")} == {"relay"}
    assert res["picker"]["relay"]["on"] is True and all(r["outcome"].startswith("ok") for r in res["picker"]["relay"]["log"])
    assert (st / "relay_cache").is_dir() and any(p.name.endswith(".w2400") for p in (st / "relay_cache").iterdir())


def test_a_second_build_is_served_from_the_cache_by_hash(tmp_path, pics):
    _, _, st, first = build(tmp_path, pics)
    again = FakeRelay(pics)
    d = deck()
    res = pp.run(d, pp.CarriedSource(SOURCE_ID, carried_doc(pics)), st, relay=pp.RelayAssets(again, st / "relay_cache"))
    assert again.calls == [] and im(d, "s01")["status"] == "made"
    assert {r["outcome"] for r in res["picker"]["relay"]["log"]} == {"cached"}


def test_the_original_size_copy_is_checked_against_its_sha256(tmp_path, pics):
    hx = hashlib.sha256(pics["master"]).hexdigest()
    ok = pp.RelayAssets(lambda h, w: pics["master"], tmp_path / "c1")
    p, why = ok.get(hx, tmp_path / "a.png", original=True)
    assert p and why is None and (tmp_path / "a.png").read_bytes() == pics["master"]
    bad = pp.RelayAssets(lambda h, w: pics["story"], tmp_path / "c2")   # another picture under this hash
    p, why = bad.get(hx, tmp_path / "b.png", original=True)
    assert p is None and "do not hash" in why and not (tmp_path / "c2").exists()   # nothing is kept
    seen = []
    wide = pp.RelayAssets(lambda h, w: seen.append(w) or pics["master"], tmp_path / "c3")
    assert wide.get(hx, tmp_path / "c.png")[1] is None and seen == [2400]   # a rendition is the relay's answer for the hash: not hash-checked
    assert pp.RelayAssets(lambda h, w: pics["master"], tmp_path / "c4").get("nope", tmp_path / "d.png")[0] is None


def test_a_picture_the_relay_does_not_hold_is_not_reachable_never_generated(tmp_path, pics):
    gone = FakeRelay(pics, only={hashlib.sha256(pics["master"]).hexdigest()})
    d, res, st, _ = build(tmp_path, pics, relay=gone)
    assert im(d, "s01")["status"] == "made"
    assert im(d, "s03")["status"] == "empty" and im(d, "s03")["reason"].startswith(pp.NOT_REACHABLE) and "404" in im(d, "s03")["reason"]
    assert res["picker"]["not_reachable"]


def test_with_no_way_to_the_relay_every_picture_says_so(tmp_path, pics):
    d, res, st, _ = build(tmp_path, pics, relay=False)
    assert im(d, "s01")["status"] == "empty" and "no way to the relay" in im(d, "s01")["reason"] and res["picker"]["relay"]["on"] is False
    assert pp.relay_for(tmp_path) is None   # nothing in this repo wires the signed transport yet


def test_only_the_relay_is_a_source_for_a_carried_project_not_its_https_locations(tmp_path, pics):
    d, res, st, relay = build(tmp_path, pics, relay=False)
    assert all("https" not in (n["reason"]) for n in res["picker"]["not_reachable"])   # the document's own https locations are never tried
    assert not (st / "relay_cache").exists()


def test_the_fetch_caps_hold(tmp_path, pics):
    r = pp.RelayAssets(lambda h, w: pics["master"], tmp_path / "c", files_max=1)
    assert r.get(hashlib.sha256(pics["master"]).hexdigest(), tmp_path / "a.png")[1] is None
    p, why = r.get(hashlib.sha256(pics["story"]).hexdigest(), tmp_path / "b.png")
    assert p is None and "fetch cap" in why
    big = pp.RelayAssets(lambda h, w: pics["master"], tmp_path / "c2", file_max=10)
    assert "over the" in big.get("a" * 64, tmp_path / "c.png")[1]


# ---------------------------------------------------------------- run_deck, offline

def test_run_deck_builds_from_the_carried_project_with_no_key_and_no_spend(tmp_path, monkeypatch, demo_stages, build_demo, pics):
    for k in ("ANTHROPIC_API_KEY", "OPENAI_API_KEY", "RUNWAY_API_KEY"):
        monkeypatch.delenv(k, raising=False)
    relay = FakeRelay(pics)
    monkeypatch.setattr(pp, "RELAY_FETCH", relay)
    st = tmp_path / "stages"
    shutil.copytree(demo_stages, st)
    up = tmp_path / "up.json"
    stated = lambda d: d["assets"][mb.sha(pics["upload_master"])].update(rights="licensed")   # noqa: E731
    up.write_text(json.dumps({"id": SOURCE_ID, "data": carried_doc(pics, [("picture", "pic_up_0002", "upload_master", {})], stated)}))
    run = build_demo(st, tmp_path / "out", "--production-upstream", str(up), "--no-layout-plan")
    rep = json.loads((run / "report.json").read_text())
    assert rep["production"]["usd"] == 0 and rep.get("usd_total", 0) == 0 and rep["production"]["picker"]["source"]["kind"] == "upstream"
    deck_ = json.loads((run / "deck.json").read_text())
    assert deck_["meta"]["production"]["how"] == "upstream"
    cover = next(i for _, _, i in images.image_slots(deck_) if (i.get("from") or {}).get("key") == MASTER_OLD)
    assert cover["status"] == "made" and {w for _, w in relay.calls} == {2400}
    # the engine holds the picked pictures as files the renderers draw, none of them from the document
    assert any((st / "assets").glob("*.*")) and "production" in {(i.get("from") or {}).get("kind") for _, _, i in images.image_slots(deck_)}


def test_an_explicit_production_file_beats_the_carried_project(tmp_path, demo_stages, build_demo, pics):
    st = tmp_path / "stages"
    shutil.copytree(demo_stages, st)
    c = tmp_path / "lumen.clan"
    mb.build_clan(c, embed=("master",))
    up = tmp_path / "up.json"
    up.write_text(json.dumps({"id": SOURCE_ID, "data": carried_doc(pics)}))
    run = build_demo(st, tmp_path / "out", "--production", str(c), "--production-upstream", str(up), "--no-layout-plan")
    assert json.loads((run / "deck.json").read_text())["meta"]["production"]["how"] == "clan"


def test_a_bad_carried_project_refuses_the_build_before_anything_runs(tmp_path, demo_stages, build_demo, pics):
    st = tmp_path / "stages"
    shutil.copytree(demo_stages, st)
    up = tmp_path / "up.json"
    up.write_text(json.dumps({"id": SOURCE_ID, "data": {**carried_doc(pics), "contract_version": "2"}}))
    with pytest.raises(SystemExit, match="Production project this deck carries"):
        build_demo(st, tmp_path / "out", "--production-upstream", str(up))
    up.write_text(json.dumps({"id": SOURCE_ID}))
    with pytest.raises(SystemExit, match="must be a JSON file"):
        build_demo(st, tmp_path / "out2", "--production-upstream", str(up))


# ---------------------------------------------------------------- the engine server

def _srv(tmp_path):
    from deck import server as srv
    cfg = srv.Settings({"NAPKIN_DECK_DATA": str(tmp_path / "runs"), "NAPKIN_DECK_PORT": "0", "NAPKIN_DECK_REPLAY": str(HERE / "fixtures" / "fernley" / "stages")})
    return srv, cfg, srv.Server(cfg)


def test_the_engine_server_runs_a_build_with_the_carried_project_unless_a_file_or_an_investor_deck(tmp_path, monkeypatch, pics):
    srv, cfg, s = _srv(tmp_path)
    d = srv.Doc(cfg.data / "doc", "doc")
    d.folder = cfg.data / "doc" / "k"
    seen = []
    monkeypatch.setattr(srv.run_deck, "main", lambda argv: seen.append(list(argv)) or {})
    base = {"prompt": {"text": "A pitch for Lumen Water", "client": "Lumen Water", "project": "P", "agency": ""}, "kind": "agency", "format": "pitch"}
    pu = {"id": SOURCE_ID, "data": carried_doc(pics)}
    req = srv.validate_request({"doc": "doc", "inputs": base, "mode": "replay", "render": True, "production_upstream": pu}, cfg)
    s.call_engine(d, req, None)
    argv = seen[0]
    sent = json.loads(Path(argv[argv.index("--production-upstream") + 1]).read_text())
    assert sent["id"] == SOURCE_ID and sent["data"]["project"]["id"] == mb.PROJECT and "--production" not in argv
    inv = srv.validate_request({"doc": "doc", "inputs": {**base, "kind": "investor"}, "mode": "replay", "render": True, "production_upstream": pu}, cfg)
    s.call_engine(d, inv, None)
    assert "--production-upstream" not in seen[1]
    plain = srv.validate_request({"doc": "doc", "inputs": base, "mode": "replay", "render": True}, cfg)
    s.call_engine(d, plain, None)
    assert "--production-upstream" not in seen[2]
    for bad in ({"id": "x"}, {"id": "", "data": {"app": "production-tool"}}, {"id": "x", "data": {"app": "brief-maker"}}, "nope"):
        with pytest.raises(srv.Refused) as e:
            srv.validate_request({"doc": "doc", "inputs": base, "mode": "replay", "render": True, "production_upstream": bad}, cfg)
        assert e.value.status == 400
