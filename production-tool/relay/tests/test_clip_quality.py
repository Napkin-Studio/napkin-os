"""Clip quality: Draft, Standard and Final (features/clip-quality.clan).

Each level is a size the model makes, from the capability sheet (ops[op].quality). The same vectors as
the web (contracts/examples/quality-cases.json) hold the resolver; every model's body at every level is
checked against Runway's own request schema (tests/fixtures/schemas/runway); the reservation follows the
size; and Remake as Final reuses the draft's request, promoting a Seedance 2.5 draft by its task id.
Offline: a MockTransport stands in for Runway, and the harness's fake providers for the relay's."""

from __future__ import annotations

import json
import re

import httpx
import pytest

from conftest import Harness, asset, base_config, job_request, ref
from contracts_dir import contracts_dir, pricing
from director import new_id
from director.base import fit_duration
from director.director import provider_ratio
from provider_schemas import errors
from providers import AssetRef, CapabilityMissing, ProviderJob, Ref, load_sheet
from providers.runway import RunwayProvider
from providers.types import QUALITIES, effective_sheet, op_models, quality_choice

SHEET = load_sheet("runway")
CASES = json.loads((contracts_dir() / "examples" / "quality-cases.json").read_text())["cases"]
FRAME, CLIP, HAT = "sha256:" + "f" * 64, "sha256:" + "c" * 64, "sha256:" + "3" * 64
URL = {FRAME: "https://cdn.test/frame.png", CLIP: "https://cdn.test/clip.mp4", HAT: "https://cdn.test/hat.png"}
DRAFT_TASK = "4b1c9a2e-1111-4222-8333-444455556666"


def tiers(model: str) -> dict[str, str]:
    return {r["ratio"]: r.get("tier") for r in SHEET["models"][model].get("ratios") or []}


# ── the resolver ───────────────────────────────────────────────────────────
@pytest.mark.parametrize("case", CASES, ids=lambda c: f"{c['sheet']}-{c['op']}-{c['model']}-{c['level']}")
def test_the_quality_vectors(case):
    model, level, entry = quality_choice(load_sheet(case["sheet"]), case["op"], case["model"], case["level"])
    assert {"model": model, "level": level, "tier": (entry or {}).get("tier")} == case["want"]


def test_every_clip_model_makes_every_level_itself_or_in_its_family():
    for op in ("clip", "clip_edit"):
        for model in op_models(SHEET, op):
            for level in QUALITIES:
                run, got, entry = quality_choice(SHEET, op, model, level)
                if model == "aleph2":
                    assert (got, entry) == (None, None)
                    continue
                assert got == level, (op, model, level)
                assert run in op_models(SHEET, op)


def test_final_stops_at_1080p_and_standard_is_todays_size():
    for op in ("clip", "clip_edit"):
        for model in op_models(SHEET, op):
            _, _, final = quality_choice(SHEET, op, model, "final")
            _, _, standard = quality_choice(SHEET, op, model, None)
            if final:
                assert final["tier"] in ("1080p", "2k", "720p"), (model, final)  # 4K is not offered (the stitch caps at 1280 px)
                assert standard["tier"] in ("720p", "768p"), (model, standard)


# ── the bodies, at every level, against Runway's schema ───────────────────────
def resolve(sha):
    url = URL.get(sha, f"https://cdn.test/{sha[-8:]}.png")
    return AssetRef(sha, url, "video/mp4" if url.endswith(".mp4") else "image/png")


class Server:
    def __init__(self):
        self.requests: list[httpx.Request] = []

    def __call__(self, request):
        self.requests.append(request)
        return httpx.Response(200, json={"id": "task_1"})

    @property
    def body(self) -> dict:
        return json.loads(self.requests[-1].content)

    @property
    def path(self) -> str:
        return self.requests[-1].url.path


@pytest.fixture
def server():
    return Server()


@pytest.fixture
def runway(server):
    return RunwayProvider("key_test", resolve, client=httpx.Client(transport=httpx.MockTransport(server)))


def valid(server: Server) -> list[str]:
    return errors("runway", "POST " + server.path, server.body)


def sized(op: str, model: str, level: str) -> tuple[str, dict | None]:
    run, got, entry = quality_choice(SHEET, op, model, level)
    return run, ({"level": got, **entry} if entry else None)


def clip(model: str, level: str, first=FRAME, ratio="16:9", **kw) -> ProviderJob:
    run, quality = sized("clip", model, level)
    spec = effective_sheet(SHEET, "clip", run)["ops"]["clip"]
    return ProviderJob(op="clip", provider="runway", model=run, prompt="the baby claps", first_frame=first,
                       ratio=provider_ratio("runway", "clip", ratio, run), duration_s=fit_duration(6, spec),
                       audio=False, quality=quality, **kw)


LEVELS = [(m, lvl) for m in op_models(SHEET, "clip") for lvl in QUALITIES]


@pytest.mark.parametrize("model,level", LEVELS)
@pytest.mark.parametrize("first", [FRAME, None], ids=["frame", "words"])
def test_a_clip_at_each_level_is_a_valid_body_of_that_size(runway, server, model, level, first):
    job = clip(model, level, first=first)
    runway.submit(job)
    assert valid(server) == []
    body, want = server.body, job.quality["tier"]
    assert body["model"] == job.model
    if "resolution" in job.quality:  # Hailuo 3: the size is the resolution
        assert body["resolution"] == job.quality["resolution"]
    elif body["ratio"].startswith("auto_"):  # WAN 3 with its frame
        assert body["ratio"] == f"auto_{want}"
    else:
        assert tiers(job.model)[body["ratio"]] == want
        w, h = (int(x) for x in body["ratio"].split(":"))
        assert w > h  # the shot's shape is kept
    assert body.get("draft") is (True if job.quality.get("draft") else None)


def test_the_sizes_people_see():
    def size(model, level):
        job = clip(model, level)
        return job.model, RunwayProvider._in_tier(job.ratio, SHEET["models"][job.model], job.quality["tier"])
    assert size("gemini_omni_flash_1.1", "draft") == ("gemini_omni_flash_1.1", "640:360")
    assert size("veo3.1", "final") == ("veo3.1", "1920:1080")
    assert size("veo3.1_fast", "draft") == ("veo3.1_fast", "1280:720")
    assert size("klingO3_standard", "final") == ("klingO3_pro", "1920:1080")
    assert size("kling3.0_pro", "draft") == ("kling3.0_standard", "1280:720")
    assert size("wan3", "draft") == ("wan3", "832:480")
    assert size("seedance2_5", "draft") == ("seedance2_5", "854:480")
    assert size("seedance2_fast", "draft") == ("seedance2_fast", "864:496")


def test_a_portrait_shot_stays_portrait_at_final(runway, server):
    runway.submit(clip("gemini_omni_flash_1.1", "final", ratio="9:16"))
    assert server.body["ratio"] == "1080:1920" and valid(server) == []


def test_no_quality_is_todays_body(runway, server):
    job = clip("gemini_omni_flash_1.1", "standard")
    job.quality = None
    runway.submit(job)
    assert server.body["ratio"] == "1280:720" and "draft" not in server.body


def edit(model: str, level: str | None, ratio="16:9") -> ProviderJob:
    run, quality = sized("clip_edit", model, level) if level else (model, None)
    return ProviderJob(op="clip_edit", provider="runway", model=run, prompt="put @hat_front on her head",
                       refs=[Ref(CLIP, "current", "current"), Ref(HAT, "hat_front", "object")], audio=False,
                       ratio=ratio, quality=quality)


@pytest.mark.parametrize("level,want", [("draft", "640:360"), ("standard", "1280:720"), ("final", "1920:1080")])
def test_omni_flash_edits_at_the_quality_size_in_the_clips_shape(runway, server, level, want):
    runway.submit(edit("gemini_omni_flash_1.1", level))
    assert server.body["ratio"] == want and server.body["mode"] == "edit"
    assert valid(server) == []


@pytest.mark.parametrize("level,want", [("draft", "klingO3_standard"), ("standard", "klingO3_standard"), ("final", "klingO3_pro")])
def test_kling_o3_edits_pick_the_id_by_quality_and_take_no_size(runway, server, level, want):
    runway.submit(edit("klingO3_standard", level))
    assert server.body["model"] == want and "ratio" not in server.body
    assert valid(server) == []


def test_a_seedance_edit_keeps_the_clips_size(runway, server):
    # keepsSize: the relay attaches no quality to it (edit mode refuses a ratio); the body is unchanged.
    runway.submit(edit("seedance2_5", None))
    assert "ratio" not in server.body and "draft" not in server.body and valid(server) == []


# ── promotion: Seedance 2.5's draft made final by Runway ─────────────────────
def test_a_seedance_draft_is_made_final_by_its_task_id(runway, server):
    job = clip("seedance2_5", "final", draft_task=DRAFT_TASK)
    runway.submit(job)
    assert server.path == "/v1/text_to_video"
    assert server.body == {"model": "seedance2_5", "draftTaskId": DRAFT_TASK}
    assert valid(server) == []


def test_only_seedance_2_5_promotes_a_draft():
    promoting = [m for m, spec in SHEET["models"].items() if spec.get("draftPromote")]
    assert promoting == ["seedance2_5"]  # Hailuo 3 and the rest: the OpenAPI has no draftTaskId for them


def test_a_promotion_on_a_model_that_cannot_is_refused_before_runway(runway, server):
    with pytest.raises(CapabilityMissing):
        runway.submit(clip("hailuo3", "final", draft_task=DRAFT_TASK))
    assert server.requests == []


# ── the relay: what runs, what it records, what it reserves ──────────────────
def harness() -> Harness:
    cfg = base_config()
    cfg["flags"] = {**cfg["flags"], "feelEdit": True}
    return Harness(cfg)


def post(h: Harness, token: str, op="clip", pick=None, level=None, expect=200, **extra) -> dict:
    jid = new_id("job")
    inp = {"image": asset(3), "ratio": "16:9"} if op == "clip" else {"video": asset(5, "video/mp4"), "text": "make it dusk", "ratio": "16:9"}
    req = job_request(op, jid, **inp)
    if pick:
        req["modelChoice"] = {"provider": "runway", "model": pick}
    if level:
        req["quality"] = level
    req.update(extra)
    return h.call("POST", "/jobs", req, token, expect=expect)[1]


def usd(credits: float) -> float:
    return round(credits * SHEET["usdPerCredit"], 4)


@pytest.mark.parametrize("model,level,reserved", [
    ("gemini_omni_flash_1.1", "draft", usd(3.4 * 6 + 1)),     # 360p, plus the start frame
    ("gemini_omni_flash_1.1", None, usd(10 * 6 + 1)),         # standard, as before quality
    ("gemini_omni_flash_1.1", "final", usd(15 * 6 + 1)),
    ("wan3", "draft", usd(5 * 6)),
    ("wan3", "final", usd(20 * 6)),
    ("seedance2_5", "draft", usd(20 * 6)),
    ("seedance2_5", "final", usd(68 * 6)),
    ("hailuo3", "final", usd(15 * 6 + 2)),
    ("klingO3_standard", "final", usd(17 * 6)),               # Kling O3 Pro
    ("veo3.1", "final", usd(20 * 6)),                         # Veo's 1080p is the same price
])
def test_the_reservation_follows_the_size(model, level, reserved):
    h = harness()
    job = post(h, h.as_person(), pick=model, level=level)
    assert job["cost"]["reserved"] == reserved


def test_the_job_records_what_ran_and_the_provider_job_carries_the_size():
    h = harness()
    job = post(h, h.as_person(), pick="gemini_omni_flash_1.1", level="draft")
    assert job["quality"] == {"level": "draft", "size": "360p"}
    sent = h.providers["runway"].submits[0]
    assert sent["quality"] == {"level": "draft", "tier": "360p"}


def test_no_quality_runs_standard():
    h = harness()
    job = post(h, h.as_person())
    assert (job["model"], job["quality"]) == ("veo3.1", {"level": "standard", "size": "720p"})


def test_a_kling_family_runs_the_member_for_the_level():
    h = harness()
    job = post(h, h.as_person(), pick="klingO3_standard", level="final")
    assert (job["model"], job["quality"]) == ("klingO3_pro", {"level": "final", "size": "1080p"})
    assert h.providers["runway"].submits[0]["model"] == "klingO3_pro"


def test_hailuo_says_2K():
    h = harness()
    job = post(h, h.as_person(), pick="hailuo3", level="final")
    assert job["quality"] == {"level": "final", "size": "2K"}
    assert h.providers["runway"].submits[0]["quality"]["resolution"] == "2k"


def test_an_edit_that_takes_a_size_gets_the_clips_shape():
    h = harness()
    job = post(h, h.as_person(), op="clip_edit", pick="gemini_omni_flash_1.1", level="final")
    sent = h.providers["runway"].submits[0]
    assert sent["ratio"] == "16:9" and sent["quality"]["tier"] == "1080p"
    assert job["quality"] == {"level": "final", "size": "1080p"}


def test_an_edit_that_keeps_the_size_records_none_and_is_priced_at_the_sources_level():
    h = harness()
    job = post(h, h.as_person(), op="clip_edit", pick="seedance2_5", level="final")
    assert "quality" not in job and "quality" not in h.providers["runway"].submits[0]
    eff = effective_sheet(SHEET, "clip_edit", "seedance2_5")
    assert job["cost"]["reserved"] == pricing().op_usd(eff, "clip_edit", None, {"resolution": "1080p"})
    assert post(h, h.as_person(), op="clip_edit")["model"] == "aleph2"


def test_quality_on_another_op_is_refused():
    h = harness()
    req = job_request("generate", new_id("job"))
    req["quality"] = "final"
    out = h.call("POST", "/jobs", req, h.as_person(), expect=400)[1]
    assert out["error"]["code"] == "invalid_input"


# ── Remake as Final ─────────────────────────────────────────────────────────
def finished(h: Harness, token: str, job: dict) -> dict:
    h.clock.tick(6)
    h.providers[job["provider"]].succeed(job["requestId"], b"clip-bytes")
    h.clock.tick(6)
    done = h.poll(token, job["jobId"])
    assert done["state"] == "completed", done
    return done


def remake(h: Harness, token: str, draft: dict, level="final", expect=200) -> dict:
    jid = new_id("job")
    req = job_request(draft["op"], jid)
    req.update(input={}, quality=level, promoteFrom=draft["jobId"], parentIds=[draft["jobId"]])
    return h.call("POST", "/jobs", req, token, expect=expect)[1]


def test_a_seedance_draft_is_promoted_not_made_again():
    h = harness()
    token = h.as_person()
    draft = finished(h, token, post(h, token, pick="seedance2_5", level="draft"))
    assert h.providers["runway"].submits[0]["quality"]["draft"] is True
    final = remake(h, token, draft)
    sent = h.providers["runway"].submits[-1]
    assert sent["draftTask"] == draft["requestId"] and sent["model"] == "seedance2_5"
    assert final["quality"] == {"level": "final", "size": "1080p"}
    assert final["cost"]["reserved"] == usd(68 * 6)
    assert "Runway makes the draft itself" in final["director"]["rationale"]


def test_an_old_seedance_draft_is_made_again_at_final():
    h = harness()
    token = h.as_person()
    draft = finished(h, token, post(h, token, pick="seedance2_5", level="draft"))
    h.clock.tick(8 * 24 * 3600)
    remake(h, token, draft)
    assert "draftTask" not in h.providers["runway"].submits[-1]


def test_any_other_draft_is_made_again_from_its_own_request_at_final():
    h = harness()
    token = h.as_person()
    draft = finished(h, token, post(h, token, pick="klingO3_standard", level="draft"))
    first = h.providers["runway"].submits[0]
    final = remake(h, token, draft)
    sent = h.providers["runway"].submits[-1]
    assert sent["model"] == "klingO3_pro" and "draftTask" not in sent
    assert {k: v for k, v in sent.items() if k not in ("model", "quality")} == \
        {k: v for k, v in first.items() if k not in ("model", "quality")}  # the same words, pictures and length
    assert sent["quality"]["level"] == "final"
    assert (final["model"], final["quality"]) == ("klingO3_pro", {"level": "final", "size": "1080p"})
    assert re.match(r"Remade at Final from job_", final["director"]["rationale"])


def test_remake_as_final_is_refused_for_another_project_or_an_unfinished_take():
    h = harness()
    token = h.as_person()
    running = post(h, token, pick="wan3", level="draft")
    out = remake(h, token, running, expect=400)
    assert out["error"]["code"] == "invalid_input"
    done = finished(h, token, running)
    other = h.as_person("bob", "red")
    assert remake(h, other, done, expect=400)["error"]["code"] == "invalid_input"
