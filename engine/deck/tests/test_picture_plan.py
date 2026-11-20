"""The picture plan (spec.PICTURE_PLAN; Claude outputs/pipeline-test/picture-plan.md): the scene lint's deny-lists, the scene brief and cards,
3 to 5 pictures a deck, one re-ask of a refused card then no picture, the fit check with one retry then drop, and labels that never say
Flagged. Offline and with fakes only: no Runway, no Ollama, no Haiku, no Gemini. Every brand and brief is invented."""
from __future__ import annotations

import contextlib
import json
import types
from pathlib import Path

import pytest

from deck import imagegen, images, inputs, render_web, scene, spec
from visuals import fit, jobs, lint

ROUND3_WORDS = ["kraft", "kibble", "homewares", "teal", "pegboard", "pallet", "lightbulb", "floorboards", "jobseeker", "unhurried", "mid"]


@pytest.fixture
def plan_on(monkeypatch):
    monkeypatch.setattr(spec, "PICTURE_PLAN", True)


# ---------------------------------------------------------------------------------------------------------- the scene lint

@pytest.mark.parametrize("w", ROUND3_WORDS)
def test_round3_refused_words_now_pass(w):
    assert lint.lint_scene(f"a {w} detail on a shop shelf in bright light.") is None


def test_counts_of_visible_things_pass_and_statistics_do_not():
    assert lint.lint_scene("one hand holds two cups by a half open door.") is None
    assert lint.lint_scene("three in four shoppers walk past the shelf.") == "it holds a statistic"
    assert "number" in lint.lint_scene("a hundred bags on a shelf.")
    assert lint.lint_scene("a shelf with ten percent off.") == "it holds a statistic"


def test_names_brands_and_confidential_stay_fail_closed():
    names = lint.name_words(["Tabbel", "Purrline Foods", "Harbourside"])
    assert "brief" in lint.lint_scene("a bowl of tabbel food on a shelf.", names=names)
    assert "brief" in lint.lint_scene("a bag from purrline foods on a shelf.", names=names)
    assert "brand" in lint.lint_scene("a nike shoe on a floor.")
    assert "known word" in lint.lint_scene("a bowl of zorbix food.")   # an unknown word is a possible name
    deny = lint.deny_list([{"path": "background", "text": "Project Quillfeather launches in spring"}])
    assert lint.lint_scene("a quillfeather on a desk.", deny=deny) == "would draw on a Confidential part"
    assert lint.lint_scene("a bowl with a tag reading Tabbel.") is not None   # a capital in mid-sentence
    assert lint.lint_scene("a bowl at 3pm.") == "it holds a digit"


# ---------------------------------------------------------------------------------------------------------- the scene brief and cards

def _inp(**fields):
    inp = inputs.load(None, prompt_text="A cat food relaunch in Ireland, in-store, with shelf wobblers.")
    for k, v in fields.items():
        inp.brief[k]["value"] = v
    return inp


def test_the_scene_brief_locks_market_setting_and_the_not_list():
    st = {"d": {"idea": "Look at what is gone.", "executions": [{"channel": "in-store shelf wobbler"}]},
          "c": {"chosen": "t1", "territories": [{"id": "t1", "sketch": "an empty bowl on the shelf edge"}]}}
    sb = scene.scene_brief(_inp(audience="Cat owners in their forties"), st)
    assert sb["market"] == "ireland" and "traffic on the left" in sb["cues"]
    assert "shop" in sb["setting"] and "not a home" in sb["must_not"]
    assert "empty bowl" in sb["key_visual"] and "forties" in sb["audience"]


def test_a_card_is_assembled_literal_first():
    s = scene.subject_of({"key_visual": "an empty ceramic cat bowl on a shelf edge", "setting": "inside a large, bright shop",
                          "props": "plain unprinted bags", "person": "no person", "not": ["a home", "not a field"]}, {})
    assert s.startswith("An empty ceramic cat bowl on a shelf edge, inside a large, bright shop.")
    assert s.endswith("not a home, not a field.")


def test_three_to_five_pictures_cover_idea_hero_and_audience():
    deck = {"order": ["s1", "s2", "s3", "s4", "s5", "s6", "s7"], "slides": {
        "s1": {"type": "title"}, "s2": {"type": "real_question"}, "s3": {"type": "idea"}, "s4": {"type": "execution"},
        "s5": {"type": "execution"}, "s6": {"type": "audience"}, "s7": {"type": "appendix"}}}
    cands = [{"sid": s, "slot": "picture"} for s in deck["order"]]
    got = [c["sid"] for c in scene.slots_for(deck, cands)]
    assert got == ["s1", "s3", "s4"] or got == ["s1", "s3", "s4", "s6"]
    assert "s2" not in got and "s5" not in got and "s7" not in got
    assert scene.MIN_PICTURES <= len(got) <= scene.MAX_PICTURES


# ---------------------------------------------------------------------------------------------------------- one re-ask, then no picture

class _Ledger:
    def __init__(self):
        self.rows = []

    @contextlib.contextmanager
    def locked(self):
        yield

    def append(self, row):
        self.rows.append(row)


def _ctx():
    return types.SimpleNamespace(inp=types.SimpleNamespace(marks=[]), ledger=_Ledger(), names=["Tabbel"],
                                 deck={"meta": {"scene_names": ["Purrline"]}})


def test_a_refused_card_is_re_asked_once_then_has_no_picture(plan_on):
    req = {"scene": {"setting": "inside a large, bright shop", "must_not": ["not a home"]},
           "slots": [{"key": "k_cover"}, {"key": "k_idea"}, {"key": "k_exec"}]}
    calls = []

    def call(r):
        calls.append(r)
        if "redo" not in r:
            return {"cards": {"k_cover": {"key_visual": "an empty bowl on a shelf edge"},
                              "k_idea": {"key_visual": "a bowl of tabbel food"},          # a brief name: refused
                              "k_exec": {"key_visual": "a sign reading Sale 50"}}}, {"usd": 0.03}   # a digit and a capital: refused
        assert set(r["redo"]) == {"k_idea", "k_exec"} and [s["key"] for s in r["slots"]] == ["k_idea", "k_exec"]
        return {"cards": {"k_idea": {"key_visual": "a cat looking up at an empty bowl"},
                          "k_exec": {"key_visual": "a blank card on a flexible arm, Tabbel logo"}}}, {"usd": 0.01}
    subj, usage = imagegen._scene_subjects(_ctx(), req, *call(req), call, [], "g_x")
    assert len(calls) == 2   # the first call, and exactly one re-ask
    assert subj["k_cover"]["subject"].startswith("An empty bowl on a shelf edge") and subj["k_idea"]["subject"].startswith("A cat looking up")
    assert subj["k_exec"]["subject"] == "" and subj["k_exec"]["refused"]   # still refused: no picture, never a template
    assert usage["usd"] == pytest.approx(0.04)


# ---------------------------------------------------------------------------------------------------------- the fit check

CARD = {"key_visual": "an empty bowl on a shelf edge", "setting": "inside a large, bright shop", "must_not": ["not a home"]}


def test_fit_passes_only_on_idea_setting_and_no_wrong_cue():
    ok = json.dumps({"shows_idea": True, "setting_seen": "a supermarket aisle", "setting_fits": True, "wrong_cues": []})
    home = json.dumps({"shows_idea": True, "setting_seen": "a kitchen", "setting_fits": False, "wrong_cues": ["a home"]})
    assert fit.check(b"x", CARD, ollama=lambda j, q: ok)["pass"]
    v = fit.check(b"x", CARD, ollama=lambda j, q: home)
    assert not v["pass"] and "kitchen" in v["reason"] and v["route"] == "ollama"
    assert not fit.check(b"x", CARD, ollama=lambda j, q: "not json")["pass"]   # unreadable is a fail
    assert "this must be inside a large, bright shop" in fit.correction(CARD, v)


def test_fit_falls_back_to_haiku_and_never_another_route():
    seen = []
    got = fit.check(b"x", CARD, ollama=lambda j, q: None, haiku=lambda j, q: seen.append(q) or json.dumps(
        {"shows_idea": True, "setting_seen": "a shop", "setting_fits": True, "wrong_cues": []}))
    assert got["pass"] and got["route"] == "haiku" and "empty bowl on a shelf edge" in seen[0] and "not a home" in seen[0]
    none = fit.check(b"x", CARD, ollama=lambda j, q: None, haiku=lambda j, q: None)
    assert none == {**none, "checked": False, "pass": False}
    import visuals.fit as mod
    assert "gemini" not in Path(mod.__file__).read_text().lower().replace("never gemini", "")


def _fit_ctx(tmp_path, monkeypatch):
    cache = tmp_path / "cache"
    cache.mkdir()
    (cache / "a.png").write_bytes(b"first")
    manifest = {"jobs": {"j1": {"file": "a.png", "state": "saved"}}}
    monkeypatch.setattr(jobs, "state", lambda j, c: j.get("state"))
    monkeypatch.setattr(jobs, "save_manifest", lambda c, m: None)
    monkeypatch.setattr(imagegen, "style_text_for", lambda style, banned: "")
    monkeypatch.setattr(imagegen.vstyle, "sendable", lambda style: [])
    ctx = types.SimpleNamespace(manifest=manifest, cache=cache, style=None, deck={"slides": {"s1": {"type": "idea"}}})
    plan = {"banned_imagery": [], "slots": {"k": {"key": "k", "slide": "s1", "job": "j1", "attempt": 1, "subject": "An empty bowl.", "card": CARD,
                                                  "model": "m", "ratio": "16:9", "kind": "photo"}}}
    return ctx, plan, manifest, cache


def test_a_failed_picture_is_retried_once_then_dropped(tmp_path, monkeypatch, plan_on):
    ctx, plan, manifest, cache = _fit_ctx(tmp_path, monkeypatch)
    made = []

    def regen(todo):
        for t in todo:
            made.append(t)
            (cache / f"{t['key']}.png").write_bytes(b"second")
            manifest["jobs"][t["key"]] = {"file": f"{t['key']}.png", "state": "saved"}
    fail = {"checked": True, "pass": False, "reason": "the setting reads as a kitchen", "setting_seen": "a kitchen"}
    out = imagegen.fit_pass(ctx, plan, ["j1"], regen, check=lambda data, card: fail, log=lambda *a: None)
    assert len(made) == 1 and "The last frame showed a kitchen; this must be inside a large, bright shop." in made[0]["prompt"]
    assert out["retried"] == ["j1"] and out["dropped"] == [made[0]["key"]] and not out["passed"]


def test_a_retry_that_fits_is_kept(tmp_path, monkeypatch, plan_on):
    ctx, plan, manifest, cache = _fit_ctx(tmp_path, monkeypatch)

    def regen(todo):
        for t in todo:
            (cache / f"{t['key']}.png").write_bytes(b"second")
            manifest["jobs"][t["key"]] = {"file": f"{t['key']}.png", "state": "saved"}
    check = lambda data, card: {"checked": True, "pass": data == b"second", "reason": "", "setting_seen": "a shop"}   # noqa: E731
    out = imagegen.fit_pass(ctx, plan, ["j1"], regen, check=check, log=lambda *a: None)
    assert out["retried"] == ["j1"] and len(out["passed"]) == 1 and not out["dropped"]
    assert manifest["jobs"][out["passed"][0]]["fit"]["pass"]


# ---------------------------------------------------------------------------------------------------------- labels

def test_no_render_says_flagged_and_a_flagged_picture_is_not_drawn(plan_on):
    im = {"status": "flagged", "asset": "img_a"}
    assert "Flagged" not in render_web._mockup(im, "Illustrative")
    assert render_web._mockup(im, "Illustrative").count("mockup") >= 1 and "Illustrative" not in render_web._mockup(im, "Illustrative")
    deck = {"assets": {"img_a": {"rights": "generated"}}, "order": ["s1"],
            "slides": {"s1": {"type": "idea", "slots": {"picture": {"kind": "image", "image": im}}}}}
    assert images.drawn(deck, "review") == {}


def test_stage_g_and_the_plan_ask_about_the_same_slots(plan_on, monkeypatch):
    """The re-render found stage g asked about every empty slot while the plan kept 3 to 5, so the recorded request never matched and
    every slot waited for a card. Both now read plan_candidates."""
    every = [{"sid": f"s{i}", "slot": "picture"} for i in range(9)]
    monkeypatch.setattr(imagegen, "candidate_slots", lambda deck, terr, gen: list(every))
    monkeypatch.setattr(scene, "slots_for", lambda deck, cands: cands[:3])
    ctx = types.SimpleNamespace(deck={}, territories=[], generate="all")
    assert imagegen.plan_candidates(ctx) == every[:3]
    import inspect
    for fn in (imagegen.make_plan, imagegen.run_subjects):
        assert "plan_candidates(ctx)" in inspect.getsource(fn)


def test_possessives_contractions_and_typographic_marks_are_not_quotation_marks():
    """The six-deck re-render: stage g's cards were refused for an apostrophe ('the household's meter') or a typographic dash."""
    for t in ["A household's meter turns while the family doesn't notice, at three o'clock.", "the neighbours' gate stands open."]:
        assert lint.lint_scene(lint.plain(t)) is None, t
    assert lint.plain("The kitchen’s window — grey light.") == "The kitchen's window, grey light."
    assert lint.lint_scene(lint.plain("The kitchen’s window — grey light.")) is None
    assert lint.lint_scene("a sign saying 'open' hangs.") == "it holds a quotation mark"   # a real quotation still fails
