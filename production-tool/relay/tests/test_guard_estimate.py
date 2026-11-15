"""The spend guard's estimate never below the sheet's price (features/production-platform-rules.clan, review B).

The euro guard (director/spend.py) is the only meter model calls and the line's paid ops pass before they are sent,
so it must count at least what the ledger counts: the same price function (contracts/pricing.py) with every setting
the price turns on (model, tier, scale, duration, outputs, audio, refs, input length). The walk below covers every
op and every model in capabilities/runway.json across the settings a job can carry, and the relay passes the
ledger's own reservation to the adapter so the guard never asks for less. No network and no key.
"""

from __future__ import annotations

import itertools
import json

import httpx
import pytest

from contracts_dir import contracts_dir, pricing
from director import spend
from providers import AssetRef, ProviderError, ProviderJob, Ref
from providers.runway import RunwayProvider
from providers.types import effective_sheet, load_sheet

SHA = "sha256:" + "c" * 64
VARS = ("NAPKIN_ENV", "NAPKIN_PAID_CALLS", "NAPKIN_SPEND_CAP_EUR", "NAPKIN_SPEND_RUN_CAP_EUR")
SHEET = json.loads((contracts_dir() / "capabilities" / "runway.json").read_text())
EVERY_OP_MODEL = [(op, m) for op, spec in SHEET["ops"].items()
                  for m in dict.fromkeys([spec["model"], *([spec["regionModel"]] if spec.get("regionModel") else []),
                                          *(a["model"] for a in spec.get("alternates") or [])])]


@pytest.fixture(autouse=True)
def clean(monkeypatch):
    for v in VARS:
        monkeypatch.delenv(v, raising=False)
    spend.reset()
    spend.set_run("-")
    yield
    spend.reset()


def runway(seen=None):
    def record(request):
        (seen if seen is not None else []).append(request)
        return httpx.Response(200, json={"id": "task_1"})
    return RunwayProvider("key_test", lambda sha: AssetRef(sha, "https://cdn.test/a", "image/png"),
                          client=httpx.Client(transport=httpx.MockTransport(record)))


def sheet_price(op, model, settings):
    return pricing().op_usd(effective_sheet(load_sheet("runway"), op, model), op, None, settings)


def cases(op, model):
    """(provider job, the settings the ledger prices it at) for each setting a job of `op` on `model` can carry."""
    eff = effective_sheet(SHEET, op, model)
    spec = eff["ops"][op]
    m = SHEET["models"][spec["model"]]
    price = m.get("pricing") or {}
    durations = sorted({*(spec.get("durations") or []), 2, 5, 8, 10})
    tiers = [None, *(price.get("byResolution") or {})]
    ratios = [None, *[r["ratio"] for r in m.get("ratios") or []][:4]]
    reads_clip = op in ("clip_edit", "clip_patch", "cutdown")
    for d, tier, ratio, outputs, audio, scale, px, refs in itertools.product(
            durations, tiers, ratios, (1, 2, 4), (False, True), (2, 4), (1000, 1344, 2048, 4096), (0, 1, 3)):
        if op != "upscale" and (scale, px) != (2, 1344):
            continue
        settings = {"durationS": d, "ratio": ratio, "outputs": outputs, "audio": audio, "refs": refs or None,
                    "resolution": tier, "scaleFactor": scale, "inputPx": px, "inputS": d if reads_clip else None}
        job = ProviderJob(op=op, provider="runway", model=model, prompt="a shot", ratio=ratio, duration_s=float(d),
                          outputs=outputs, audio=audio, scale=scale,
                          refs=[Ref(SHA, f"r{i}", "character") for i in range(refs)],
                          quality={"level": "final", "tier": tier} if tier else None)
        yield job, settings


@pytest.mark.parametrize("op,model", EVERY_OP_MODEL)
def test_the_guard_never_estimates_below_the_sheet_price(op, model):
    """Every op and model in the capabilities file, at every setting the price turns on: guard >= sheet price."""
    rw, low = runway(), []
    for job, settings in cases(op, model):
        price = sheet_price(op, model, settings)
        if price is None:
            continue
        guard = rw._guard_estimate(job)
        if guard < price:
            low.append((settings, guard, price))
    assert not low, f"{op} on {model}: the guard asked for less than the sheet, e.g. {low[:3]}"


@pytest.mark.parametrize("job,price", [
    (ProviderJob(op="upscale", provider="runway", model="magnific_precision_upscaler_v2", prompt="",
                 refs=[Ref(SHA, "current", "current")], scale=4), 1.50),
    (ProviderJob(op="clip_edit", provider="runway", model="aleph2", prompt="make it dusk",
                 refs=[Ref(SHA, "current", "current")], ratio="1280:720", duration_s=10.0), 2.80),
    (ProviderJob(op="cutdown", provider="runway", model="aleph2", prompt="continue",
                 refs=[Ref(SHA, "current", "current")], ratio="1:1", duration_s=8.0), 2.24),
    (ProviderJob(op="clip", provider="runway", model="seedance2_5", prompt="a shot", first_frame=SHA,
                 ratio="1280:720", duration_s=6.0, quality={"level": "final", "tier": "1080p"}), 4.08),
], ids=["upscale-4x", "clip_edit-10s", "cutdown-8s", "seedance-final-6s"])
def test_the_reviews_measured_cases_reach_the_sheet_price(job, price):
    """The review measured 0.25, 1.40, 0.84 and 1.80 against these sheet prices."""
    assert runway()._guard_estimate(job) >= price


def test_a_four_times_upscale_is_not_sent_under_a_one_euro_cap(monkeypatch):
    monkeypatch.setenv("NAPKIN_ENV", "napkin-staging")
    monkeypatch.setenv("NAPKIN_PAID_CALLS", "on")
    monkeypatch.setenv("NAPKIN_SPEND_CAP_EUR", "1")
    seen = []
    up4 = ProviderJob(op="upscale", provider="runway", model="magnific_precision_upscaler_v2", prompt="",
                      refs=[Ref(SHA, "current", "current")], scale=4)
    with pytest.raises(ProviderError) as e:
        runway(seen).submit(up4)  # 150 credits (1.50 USD) by the sheet
    assert e.value.code == "spend_stop" and seen == []


def test_the_guard_never_asks_less_than_the_ledger_reserved():
    """The relay passes its reservation (priceUsd): a price the adapter cannot see is still counted."""
    job = ProviderJob.from_director("generate", {"provider": "runway", "model": "gemini_image3_pro", "prompt": "a bottle",
                                                 "refs": [], "priceUsd": 7.5})
    assert job.price_usd == 7.5 and runway()._guard_estimate(job) >= 7.5


def test_through_the_relay_the_guard_counts_at_least_the_jobs_reservation(monkeypatch):
    """A whole job through the relay: what the guard is asked for is at least what the ledger reserved."""
    from providers._seam import Adapted, Resolver
    from test_frame_edit import CAMERA, FakeRunwayHttp, dex, edit_input, harness, post

    monkeypatch.setenv("NAPKIN_PAID_CALLS", "on")
    monkeypatch.setenv("NAPKIN_SPEND_CAP_EUR", "1000")
    asked = []
    real = spend.check
    monkeypatch.setattr(spend, "check", lambda amount, *a, **k: (asked.append(amount), real(amount, *a, **k))[1])
    h = harness(providers=("runway",))
    http = FakeRunwayHttp()
    h.relay.registry.register(Adapted(RunwayProvider("rw-key", Resolver(), client=httpx.Client(transport=httpx.MockTransport(http)))),
                              h.providers["runway"].sheet)
    dex(h, CAMERA)
    job = post(h, h.as_person(), edit_input())
    assert job["state"] == "submitted", job
    assert asked and asked[-1] >= job["cost"]["reserved"] > 0
