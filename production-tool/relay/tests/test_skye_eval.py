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
    for case in data["cases"]:
        for intent in data["intents"]:
            req = skye_eval.request(case, intent)
            assert c.errors("relay-api.schema.json#/$defs/WriteInput", req["input"]["write"]) == [], (case["id"], intent)


def test_the_checks_pass_over_the_passthrough_writer():
    data = skye_eval.load()
    table = skye_eval.run(lambda c, i: skye_eval.PassthroughWriter().write(skye_eval.request(c, i)), data)
    assert len(table) == 126
    failed = {k: [n for n, ok in row.items() if not ok] for k, row in table.items() if not all(row.values())}
    # The passthrough cuts to the first sentence: it may drop an @name or not shorten; everything else holds.
    assert all(set(v) <= {"shorter", "keeps @names"} for v in failed.values()), failed


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
