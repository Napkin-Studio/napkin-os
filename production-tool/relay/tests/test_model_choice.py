"""A model the person picks when regenerating (features/model-choice.clan): the relay runs it on
its provider, falls back to Runway's default (the floor, features/runway-fallback.clan) when that
provider cannot take it, and refuses a pick the routing or the sheet does not allow before any spend.
The provider in front of Runway is the harness's fake on the mock sheet (conftest.front_sheet)."""

import copy
import importlib

import pytest

from conftest import Harness, base_config, job_request, sheets
from director import new_id
from providers import load_sheet
from providers.base import ProviderError
from providers.types import effective_sheet, op_models

HQ = {"provider": "mock", "model": "mock-hq"}


def config(**over):
    cfg = base_config(**over)
    cfg["routing"]["clip"] = ["mock", "runway"]
    cfg["routing"]["frame"] = ["mock", "runway"]
    return cfg


def harness(**over):
    return Harness(config(**over))


def post(h, token, pick=None, op="clip", job_id=None, expect=200):
    req = job_request(op, job_id or new_id("job"))
    if pick:
        req["modelChoice"] = pick
    return h.call("POST", "/jobs", req, token, expect=expect)[1]


# ── the relay ───────────────────────────────────────────────────────────────
def test_a_pick_runs_on_its_provider_and_model_at_its_price():
    h = harness()
    job = post(h, h.as_person(), HQ)
    assert (job["provider"], job["model"]) == ("mock", "mock-hq")
    assert job["cost"]["reserved"] == 1.8
    assert "fallbackFrom" not in job
    assert h.providers["mock"].submits[0]["model"] == "mock-hq"


def test_no_pick_routes_as_before():
    h = harness()
    job = post(h, h.as_person())
    assert (job["provider"], job["model"]) == ("mock", "mock")
    assert job["cost"]["reserved"] == 0.9


def test_a_pick_its_provider_cannot_take_falls_back_to_runway_default():
    h = harness()
    h.providers["mock"].submit_effect = ProviderError("provider_unavailable", "503 from mock")
    job = post(h, h.as_person(), HQ)
    assert (job["provider"], job["model"]) == ("runway", "veo3.1")
    assert job["fallbackFrom"] == HQ
    assert job["cost"]["reserved"] == 1.2  # settled at the provider that ran (Veo 3.1 on Runway)


def test_a_failed_pick_where_runway_is_not_routed_fails_and_tries_nothing_else():
    # 2026-10-09: fallbackOnly is no longer read; the floor is Runway when the op routes to it (here it does not).
    h = harness()
    h.cfg["routing"]["clip"] = ["mock"]
    h.providers["mock"].submit_effect = ProviderError("provider_unavailable", "503 from mock")
    job = post(h, h.as_person(), HQ)
    assert job["state"] == "failed" and job["error"]["code"] == "provider_unavailable"
    assert h.providers["runway"].submits == []


def test_runway_models_are_always_pickable():
    # 2026-10-09 (features/runway-fallback.clan): Runway is no longer fallback-only.
    h = harness()
    job = post(h, h.as_person(), {"provider": "runway", "model": "veo3.1_fast"})
    assert (job["provider"], job["model"]) == ("runway", "veo3.1_fast") and "fallbackFrom" not in job


@pytest.mark.parametrize("pick", [
    {"provider": "mock", "model": "seedance-2.0"},          # not on the sheet
    {"provider": "runway", "model": "gemini_image3_pro"},   # a frame model, not a clip one
])
def test_a_pick_the_routing_or_sheet_does_not_allow_is_refused_before_spend(pick):
    h = harness()
    jid = new_id("job")
    out = post(h, h.as_person(), pick, job_id=jid, expect=400)
    assert out["error"]["code"] == "invalid_input"
    assert h.store.get_job(jid) is None
    assert h.store.counters("spend").get("usd", 0) == 0
    assert all(not p.submits for p in h.providers.values())


def test_a_pick_on_a_provider_the_op_does_not_route_is_refused():
    h = harness()
    h.cfg["routing"]["generate"] = ["runway"]
    out = post(h, h.as_person(), {"provider": "mock", "model": "mock"}, op="generate", expect=400)
    assert out["error"]["code"] == "invalid_input"


# ── the effective sheet ─────────────────────────────────────────────────────
def test_effective_sheet_puts_the_alternate_over_the_op_and_the_sheet():
    runway = load_sheet("runway")
    fast = effective_sheet(runway, "clip", "veo3.1_fast")
    assert fast["ops"]["clip"]["model"] == "veo3.1_fast" and fast["ops"]["clip"]["estimateUsd"] == 0.6
    assert fast["ops"]["clip"]["durationsS"] == [4, 6, 8] and "alternates" not in fast["ops"]["clip"]
    assert runway["ops"]["clip"]["model"] == "veo3.1"  # the sheet itself is untouched
    # An alternate's own sheet-level settings and lengths replace the sheet's and the op's.
    sheet = copy.deepcopy(runway)
    sheet["ops"]["clip"]["alternates"].append({"model": "wide", "endpoint": "POST /v1/x", "estimateUsd": 2,
                                               "minS": 3, "maxS": 15, "tagSyntax": "none",
                                               "refs": {"max": 0, "maxCharacter": 0}})
    wide = effective_sheet(sheet, "clip", "wide")
    assert wide["tagSyntax"] == "none" and wide["refs"]["max"] == 0
    assert (wide["ops"]["clip"]["minS"], wide["ops"]["clip"]["maxS"]) == (3, 15)
    assert "durationsS" not in wide["ops"]["clip"]  # its durations replace the op's
    assert sheet["tagSyntax"] == "at_tag" and sheet["refs"]["max"] == 14
    # The op's own model carries its own settings where it sets any (features/default-models.clan).
    sheet["ops"]["frame"]["tagSyntax"] = "none"
    assert effective_sheet(sheet, "frame", None)["tagSyntax"] == "none"
    assert effective_sheet(runway, "clip", None) is runway  # an op whose model sets nothing of its own


def test_every_alternate_on_a_sheet_is_one_its_adapter_builds():
    for provider, sheet in sheets().items():
        built = importlib.import_module(f"providers.{provider}").ALTERNATES
        for op in sheet["ops"]:
            alternates = set(op_models(sheet, op)[1:])
            assert alternates <= built.get(op, set()), (provider, op, alternates)
