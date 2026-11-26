"""Skye's prompt review harness (features/script-editor.clan): 21 of our own fixture shots × 6
intents, every request valid against the contract, and the checks pass over the no-model writer.
The live recording is a person's step (`uv run python -m eval.skye_eval record`)."""

from __future__ import annotations

import importlib

from contracts import Contracts

skye_eval = importlib.import_module("eval.skye_eval")


def test_twenty_one_cases_by_six_intents_and_every_request_is_valid():
    data = skye_eval.load()
    assert len(data["cases"]) == 21 and len(data["intents"]) == 6
    c = Contracts()
    for case in data["length"]:
        req = skye_eval.request(case, case["intent"])
        assert c.errors("relay-api.schema.json#/$defs/WriteInput", req["input"]["write"]) == [], case["id"]
    for case in data["cases"]:
        for intent in data["intents"]:
            req = skye_eval.request(case, intent)
            assert c.errors("relay-api.schema.json#/$defs/WriteInput", req["input"]["write"]) == [], (case["id"], intent)


def test_the_checks_pass_over_the_passthrough_writer():
    data = skye_eval.load()
    table = skye_eval.run(lambda c, i: skye_eval.PassthroughWriter().write(skye_eval.request(c, i)), data)
    assert len(table) == 126 + len(data["proceed"]) + len(data["length"])
    failed = {k: [n for n, ok in row.items() if not ok] for k, row in table.items() if not all(row.values())}
    # The passthrough cuts to the first sentence: it may drop an @name, not shorten, or draft short of the
    # length; everything else holds.
    assert all(set(v) <= {"shorter", "keeps @names", "fits the length", "keeps the spoken lines"} for v in failed.values()), failed


def test_the_live_test_drafts_fail_the_length_check_and_a_fitted_one_passes():
    """Live test 2026-11-18 (skye.v6): the 7-beat scene was about 60 s on the band for a 15 s film; the
    length cases score it by the band's rule (writer.rough_seconds)."""
    data = skye_eval.load()
    fit = next(c for c in data["length"] if c["id"] == "hearth-oats-fit-15")
    req = skye_eval.request(fit, "fit_seconds")["input"]["write"]
    assert req["target"]["kind"] == "scene" and req["seconds"] == 15
    as_was = {"writes": [{"target": req["target"], "base_hash": req["base_hash"], "note": "I tightened it.", "duration_s": 15, "lines": fit["lines"]}]}
    assert skye_eval.score(fit, "fit_seconds", as_was)["fits the length"] is False
    fitted = [{"type": "action", "text": "Frost on the window. A tired DAD tips red-pack oats into a pot."},
              {"type": "action", "text": "His sleepy DAUGHTER shuffles in, one wellington boot on."},
              {"type": "action", "text": "Steam rises. He sets a warm bowl before her."},
              {"type": "action", "text": "He yawns. She yawns back."},
              {"type": "character", "text": "NARRATOR (V.O.)"},
              {"type": "dialogue", "text": "Hearth Oats. Slow down, warm up."}]
    ok = {"writes": [{**as_was["writes"][0], "lines": fitted}]}
    assert skye_eval.rough_seconds(fitted) <= 15
    assert skye_eval.score(fit, "fit_seconds", ok)["fits the length"] is True


def test_a_reply_with_a_price_or_a_lost_name_fails_its_checks():
    case = skye_eval.load()["cases"][0]
    req = skye_eval.request(case, "tighten")["input"]["write"]
    bad = {"writes": [{"target": req["target"], "base_hash": req["base_hash"], "lines": [{"type": "action", "text": "It rains."}, {"type": "direction", "text": "x"}],
                       "note": "That cost $0.02."}]}
    row = skye_eval.score(case, "tighten", bad)
    assert row["keeps @names"] is False and row["note"] is False


def test_a_draft_that_swaps_samurai_for_its_views_fails_and_settle_puts_it_back():
    """The owner's case (2026-10-15): the line said @samurai; the reply wrote one view per line."""
    case = next(c for c in skye_eval.load()["cases"] if c["id"] == "household-samurai")
    req = skye_eval.request(case, "draft")["input"]
    swapped = {"writes": [{"target": req["write"]["target"], "base_hash": req["write"]["base_hash"], "note": "I drafted it.",
                           "lines": [{"type": "action", "text": "@samurai_front sweeps the hall."},
                                     {"type": "action", "text": "@samurai_back looks out of the window."}]}],
               "rationale": "@samurai is not in the references, so I used the views."}
    assert skye_eval.score(case, "draft", swapped)["no swapped @name"] is False
    settled = skye_eval.settle(req, swapped)
    assert [x["text"] for x in settled["writes"][0]["lines"]] == ["@samurai sweeps the hall.", "@samurai looks out of the window."]
    row = skye_eval.score(case, "draft", settled)
    assert row["no swapped @name"] and row["keeps @names"]


def test_a_one_option_nudge_on_a_draft_fails_and_the_relay_drafts_through_it():
    """The owner's case (2026-10-15): skye.v2 asked "Draft the scene as written?" with one option."""
    case = next(c for c in skye_eval.load()["proceed"] if c["id"] == "empty-script-draft")
    req = skye_eval.request(case, "draft")
    assert req["input"]["write"]["lines"] == case["lines"]
    v2 = skye_eval.settle(req["input"], case["skye_v2_reply"])
    row = skye_eval.score(case, "draft", v2)
    assert row["no empty ask"] is False and row["drafts"] is False

    class Seq:
        def __init__(self, *replies):
            self.replies = list(replies)

        def call(self, *a, **kw):
            return self.replies.pop(0)

    draft = {"writes": [{"target": req["input"]["write"]["target"], "base_hash": req["input"]["write"]["base_hash"], "note": "I drafted it.",
                         "lines": [{"type": "action", "text": "@samurai sweeps the hall in one clean arc."}]}]}
    from contracts_dir import contracts_dir
    out = skye_eval.ModelWriter(Seq(case["skye_v2_reply"], draft), contracts_dir()).write(req)
    row = skye_eval.score(case, "draft", out)
    assert row["drafts"] and row["answers"] and "no empty ask" not in row


def test_a_shorter_version_that_cuts_the_asked_line_fails_and_one_that_keeps_it_passes():
    """UAT round 3 (R3-F7): "Make it 10 seconds" cut "Good boy.", the line the person had just asked for."""
    case = next(c for c in skye_eval.load()["length"] if c["id"] == "quietboil-fit-10-keeps-the-line")
    req = skye_eval.request(case, "fit_seconds")["input"]["write"]
    reply = lambda lines: {"writes": [{"target": req["target"], "base_hash": req["base_hash"], "note": "I cut it to 10 s.", "duration_s": 10, "lines": lines}]}
    as_was = [{"type": "action", "text": "1 a.m. A dark kitchen, lit only by the open fridge."},
              {"type": "action", "text": "A flatmate in a dressing gown flips the Quietboil's switch, wincing."},
              {"type": "action", "text": "The kettle glows blue and boils without a sound."},
              {"type": "action", "text": "Through the thin wall, the snoring carries on, undisturbed."},
              {"type": "character", "text": "NARRATOR (V.O.)"}, {"type": "dialogue", "text": "Quietboil. Let them sleep."}]
    assert skye_eval.score(case, "fit_seconds", reply(as_was))["keeps the spoken lines"] is False
    kept = [{"type": "action", "text": "1 a.m. A flatmate in a dressing gown flips the Quietboil on, wincing."},
            {"type": "action", "text": "It boils blue, without a sound."},
            {"type": "character", "text": "WOMAN"}, {"type": "parenthetical", "text": "whispering, to the kettle"},
            {"type": "dialogue", "text": "Good boy."},
            {"type": "action", "text": "Through the wall, the snoring carries on. She toasts it with her tea."},
            {"type": "character", "text": "NARRATOR (V.O.)"}, {"type": "dialogue", "text": "Quietboil. Let them sleep."}]
    row = skye_eval.score(case, "fit_seconds", reply(kept))
    assert row["keeps the spoken lines"] is True and row["fits the length"] is True
