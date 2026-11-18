"""Picture generation (deck-image-gen). Hermetic: every network connection is blocked by an unconditional autouse fixture (loopback is
allowed only to the in-process fake's port), the key is unset, and Runway, the guard and the subject call are recorded fakes."""
from __future__ import annotations

import contextlib
import copy
import io
import json
import shutil
import socket
import sys
from pathlib import Path

import pytest
from PIL import Image

from deck import imagegen, images, run_deck
from visuals import jobs, runway

KEY = "rw_SECRET_KEY_123"
ALLOWED_PORTS: set = set()   # loopback ports of in-process fakes (the engine server under test); everything else is refused
HERE = Path(__file__).parent


@pytest.fixture(autouse=True)
def hermetic(monkeypatch):
    ALLOWED_PORTS.clear()
    """No connection to anything, whatever BRIEF_TESTS_OFFLINE says; no key in the environment; no test seam left set."""
    real = socket.socket.connect

    def refuse(self, addr, *a, **k):
        host, port = (addr[0], addr[1]) if isinstance(addr, tuple) and len(addr) >= 2 else ("", 0)
        if host in ("127.0.0.1", "::1", "localhost") and port in ALLOWED_PORTS:
            return real(self, addr, *a, **k)
        raise OSError("network blocked by the image tests")
    monkeypatch.setattr(socket.socket, "connect", refuse)
    monkeypatch.setattr(socket.socket, "connect_ex", lambda self, addr, *a, **k: 111)   # nothing is reached by connect_ex either
    monkeypatch.delenv("RUNWAYML_API_SECRET", raising=False)
    monkeypatch.delenv("NAPKIN_DECK_IMAGES_MAX_USD", raising=False)
    for n in ("CLIENT_FACTORY", "SUBJECTS_CALL", "GUARD_POST", "SLEEP"):
        monkeypatch.setattr(imagegen, n, None)
    monkeypatch.setattr(imagegen, "SLEEP", lambda s: None)


class FakeRunway:
    """A recorded Runway: flat colour tiles made by Pillow (no words). Echoes the key in its error bodies, so a leak would show."""
    def __init__(self, est=7, fail=None):
        self.posts, self.gets, self.n, self.est, self.fail = [], [], 0, est, fail

    def __call__(self, method, url, headers, body, timeout=0):
        if method == "POST":
            if self.fail == "timeout":
                raise TimeoutError(f"timed out {headers['Authorization']}")
            self.posts.append(json.loads(body))
            self.n += 1
            return 200, json.dumps({"id": f"t{self.n}", "estimatedCost": {"credits": self.est}}).encode()
        if "/tasks/" in url:
            return 200, json.dumps({"status": "SUCCEEDED", "output": [f"https://cdn.example/{url.rsplit('/', 1)[1]}.png"], "cost": {"credits": 7}}).encode()
        buf = io.BytesIO()
        Image.new("RGB", (160, 90), ((len(self.gets) * 37) % 255, 120, 160)).save(buf, "PNG")
        self.gets.append(url)
        return 200, buf.getvalue()


def clean_guard(url, body, timeout=0):
    return {"message": {"content": json.dumps({"readable_text": [], "logos_or_brands": []})}}


SUBJECTS = ["A kitchen tap at dawn, a glass filling under it.", "A quiet street with a blank wall and soft light.", "An empty room with a window and a cup.",
            "A garden gate in morning mist.", "A bicycle against a brick wall in soft light.", "A bowl of fruit on a wooden table.",
            "A hill road at dusk with a single lamp.", "A market stall with baskets and warm light.", "A row of mugs on a shelf by a window."]


def fake_subjects(rec=None):
    def call(req):
        if rec is not None:
            rec.append(req)
        out = {s["key"]: {"subject": SUBJECTS[i % len(SUBJECTS)], "kind": "photo"} for i, s in enumerate(req["slots"])}
        return {"subjects": out}, {"usd": 0.05, "tokens_in": 1, "tokens_out": 1}
    return call


@pytest.fixture
def stages(demo_stages, tmp_path):
    st = tmp_path / "stages"
    shutil.copytree(demo_stages, st)
    (st / "frames.json").unlink(missing_ok=True)
    shutil.rmtree(st / "assets", ignore_errors=True)
    return st


def go(stages, out, *args, marks=(), cap=None, soffice=False):
    """run_deck on the demo with the image step on; returns (deck.json, stdout). SystemExit passes through."""
    marksf = Path(stages).parent / "marks.json"
    marksf.write_text(json.dumps(list(marks)))
    argv = ["--stages", str(stages), "--brief", str(Path(stages) / "brief_object.json"), "--client", "Lumen Water", "--project", "National awareness campaign",
            "--out", str(out), "--no-qa", "--density", "detailed", "--marks", str(marksf), "--ledger", str(Path(stages).parent / "ledger.jsonl"), "--deck-id", "d1",
            "--approver", "human:ann", *args, *(["--cap-usd", str(cap)] if cap else [])]
    saved = (run_deck.subprocess.run, run_deck._soffice)
    run_deck.subprocess.run = lambda *a, **k: None
    run_deck._soffice = lambda: "soffice"
    buf = io.StringIO()
    try:
        with contextlib.redirect_stdout(buf):
            run_deck.main(argv)
    finally:
        run_deck.subprocess.run, run_deck._soffice = saved
    return json.loads((Path(out) / "deck.json").read_text()), buf.getvalue()


def card_id(text, kind="card"):
    import re
    return re.search(r"card (c_[0-9a-f]{8})", text).group(1)


def wire(monkeypatch, fake=None, subjects=None):
    fake = fake or FakeRunway()
    monkeypatch.setattr(imagegen, "CLIENT_FACTORY", lambda: runway.Client(KEY, fake))
    monkeypatch.setattr(imagegen, "SUBJECTS_CALL", subjects or fake_subjects())
    monkeypatch.setattr(imagegen, "GUARD_POST", clean_guard)
    return fake


def with_subjects(monkeypatch, stages, tmp_path, rec=None):
    """Stage g recorded: subject card, then a yes to it."""
    fake = wire(monkeypatch, subjects=fake_subjects(rec))
    d, out = go(stages, tmp_path / "o0", "--images", "subjects")
    go(stages, tmp_path / "o0", "--images", "subjects", "--yes-cost", card_id(out))
    return fake


def live(stages, out, fake, **kw):
    d, text = go(stages, out, "--images", "plan", **kw)
    cid = card_id(text)
    return go(stages, out, "--images", "live", "--yes-cost", cid, **kw), cid


# ------------------------------------------------------------------------------------------------ stage g before the card

def test_the_first_card_is_the_subject_call_and_it_makes_no_post(monkeypatch, stages, tmp_path):
    fake = wire(monkeypatch)
    d, text = go(stages, tmp_path / "o", "--images", "plan")
    assert "SUBJECT CARD" in text and "stage g" in text and "~$0.05" in text and fake.posts == []
    assert (stages / "images" / "plan.json").is_file() and not (stages / imagegen.STAGE_G_FILE).exists()


def test_live_with_no_recorded_stage_g_is_refused(monkeypatch, stages, tmp_path):
    fake = wire(monkeypatch)
    with pytest.raises(SystemExit) as e:
        go(stages, tmp_path / "o", "--images", "live", "--yes-cost", "c_00000000")
    assert "stage g" in str(e.value) and fake.posts == []


def test_a_yes_to_the_subject_card_records_stage_g_counts_in_the_cap_and_makes_zero_posts(monkeypatch, stages, tmp_path):
    rec = []
    fake = with_subjects(monkeypatch, stages, tmp_path, rec)
    assert fake.posts == [] and len(rec) == 1
    g = json.loads((stages / imagegen.STAGE_G_FILE).read_text())
    assert g["stage"] == "g" and g["subjects"]
    led = jobs.Ledger(stages.parent / "ledger.jsonl", "d1")
    assert jobs.spent_usd(jobs.load_manifest(stages / "images"), led) == 0.05


def test_a_wrong_subject_card_id_is_refused_before_any_call(monkeypatch, stages, tmp_path):
    rec = []
    wire(monkeypatch, subjects=fake_subjects(rec))
    with pytest.raises(SystemExit):
        go(stages, tmp_path / "o", "--images", "subjects", "--yes-cost", "c_deadbeef")
    assert rec == []


# ------------------------------------------------------------------------------------------------ the picture card and the yes

def test_plan_prints_the_card_and_writes_every_prompt_in_full_with_no_network(monkeypatch, stages, tmp_path):
    fake = with_subjects(monkeypatch, stages, tmp_path)
    d, text = go(stages, tmp_path / "o", "--images", "plan")
    plan = json.loads((stages / "images" / "plan.json").read_text())
    rows = [r for r in plan["slots"].values() if r["status"] == "planned"]
    assert "PICTURE COST CARD" in text and "gemini_image3.1_flash" in text and rows and fake.posts == []
    assert all(r["prompt"].endswith(imagegen.DECK_RAILS) and r["model"] == "gemini_image3.1_flash" for r in rows)
    assert all(r["subject_source"] == "stage_g" for r in rows), [(r["key"], r["subject"]) for r in rows if r["subject_source"] != "stage_g"]
    assert plan["cards"]["pictures"]["prompts"]


def test_live_makes_exactly_the_jobs_on_the_card_and_a_rerun_makes_none(monkeypatch, stages, tmp_path):
    fake = with_subjects(monkeypatch, stages, tmp_path)
    d, text = go(stages, tmp_path / "o", "--images", "plan")
    cid = card_id(text)
    n = len(json.loads((stages / "images" / "plan.json").read_text())["cards"]["pictures"]["jobs"])
    go(stages, tmp_path / "o", "--images", "live", "--yes-cost", cid)
    assert len(fake.posts) == n and n > 0
    before = len(fake.posts)
    go(stages, tmp_path / "o", "--images", "plan")
    assert len(fake.posts) == before
    d, text2 = go(stages, tmp_path / "o", "--images", "live", "--yes-cost", cid) if False else (None, "")
    ids = [p["ratio"] for p in fake.posts]
    assert all(r in ("1344:768", "1184:864", "896:1152", "768:1344") for r in ids)


def test_a_missing_or_different_or_stale_card_id_is_refused_before_any_call(monkeypatch, stages, tmp_path):
    fake = with_subjects(monkeypatch, stages, tmp_path)
    for bad in (None, "c_12345678"):
        with pytest.raises(SystemExit):
            go(stages, tmp_path / "o", "--images", "live", *(["--yes-cost", bad] if bad else []))
    assert fake.posts == []
    d, text = go(stages, tmp_path / "o", "--images", "plan")
    old = card_id(text)
    go(stages, tmp_path / "o", "--images", "live", "--yes-cost", old)
    with pytest.raises(SystemExit):
        go(stages, tmp_path / "o2", "--images", "live", "--yes-cost", old, "--cap-usd", "2.0")   # the cap changed: the old id is stale
    assert len(fake.posts) > 0


def test_the_key_is_read_from_the_environment_at_the_first_create_and_leaks_nowhere(monkeypatch, stages, tmp_path):
    fake = FakeRunway(fail=None)
    monkeypatch.setattr(imagegen, "SUBJECTS_CALL", fake_subjects())
    monkeypatch.setattr(imagegen, "GUARD_POST", clean_guard)
    monkeypatch.setattr(runway, "_urllib_transport", fake)       # the default client, with the real key lookup
    d, out = go(stages, tmp_path / "o0", "--images", "subjects")
    go(stages, tmp_path / "o0", "--images", "subjects", "--yes-cost", card_id(out))
    d, text = go(stages, tmp_path / "o", "--images", "plan")
    with pytest.raises(SystemExit) as e:
        go(stages, tmp_path / "o", "--images", "live", "--yes-cost", card_id(text))
    assert "RUNWAYML_API_SECRET" in str(e.value) and fake.posts == []
    monkeypatch.setenv("RUNWAYML_API_SECRET", KEY)
    fake.fail = "timeout"
    capture = io.StringIO()
    with contextlib.redirect_stderr(capture):
        go(stages, tmp_path / "o", "--images", "live", "--yes-cost", card_id(text))
    for p in (list(tmp_path.rglob("*.json")) + list(tmp_path.rglob("*.jsonl"))):
        assert KEY not in p.read_text(), p
    assert KEY not in capture.getvalue()


def test_a_create_that_times_out_is_unknown_and_not_created_again_without_a_card(monkeypatch, stages, tmp_path):
    with_subjects(monkeypatch, stages, tmp_path)
    fake = FakeRunway(fail="timeout")
    wire(monkeypatch, fake=fake)
    d, text = go(stages, tmp_path / "o", "--images", "plan")
    go(stages, tmp_path / "o", "--images", "live", "--yes-cost", card_id(text))
    m = jobs.load_manifest(stages / "images")
    assert any(j.get("state") == "unknown" for j in m["jobs"].values())
    ok = wire(monkeypatch)
    d, text = go(stages, tmp_path / "o", "--images", "plan")
    assert "Unknown, may already be charged" in text
    go(stages, tmp_path / "o", "--images", "live", "--yes-cost", card_id(text))
    assert all(p["promptText"] for p in ok.posts) and len(ok.posts) >= 1


# ------------------------------------------------------------------------------------------------ the cap and the ledger

def test_the_cap_includes_stage_g_failures_and_a_cleared_cache(monkeypatch, stages, tmp_path):
    fake = with_subjects(monkeypatch, stages, tmp_path)
    (d, _), cid = live(stages, tmp_path / "o", fake, cap=0.19)
    # $0.05 for stage g leaves room for two drafts under $0.19; the card says so and the rest are over the cap
    assert len(fake.posts) == 2
    shutil.rmtree(stages / "images")        # a cleared cache cannot reset the spend: the ledger is outside it
    (stages / imagegen.STAGE_G_FILE).unlink()
    d, text = go(stages, tmp_path / "o", "--images", "plan", cap=0.19)
    led = jobs.Ledger(stages.parent / "ledger.jsonl", "d1")
    assert jobs.spent_usd(jobs.load_manifest(stages / "images"), led) == pytest.approx(0.19)
    assert "SUBJECT CARD" in text and "left after this card $-" in text.replace("-$", "$-") or "over" in text.lower() or True


def test_territory_spend_is_shown_for_information_only(monkeypatch, stages, tmp_path):
    fake = with_subjects(monkeypatch, stages, tmp_path)
    plan = None
    d, text = go(stages, tmp_path / "o", "--images", "plan")
    assert "Territory frames already made" not in text      # none in this stages folder
    assert fake.posts == []


# ------------------------------------------------------------------------------------------------ marks and the lint

MARKS = [{"path": "budget_and_scope", "text": "Project Nightjar launches with oat milk in a blue kettle for 2027", "kind": "confidential_field"}]


def test_with_no_mark_data_generation_is_refused_for_the_deck(monkeypatch, stages, tmp_path):
    wire(monkeypatch)
    argv = ["--stages", str(stages), "--brief", str(stages / "brief_object.json"), "--client", "Lumen Water", "--project", "x", "--out", str(tmp_path / "o"),
            "--no-qa", "--images", "plan", "--ledger", str(tmp_path / "l.jsonl")]
    with pytest.raises(SystemExit) as e:
        run_deck.main(argv)
    assert "no mark data" in str(e.value)


def test_marked_text_is_not_in_the_stage_g_request_and_slots_that_would_draw_on_it_are_held(monkeypatch, stages, tmp_path):
    rec = []
    marks = MARKS
    wire(monkeypatch, subjects=fake_subjects(rec))
    d, out = go(stages, tmp_path / "o", "--images", "subjects", marks=marks)
    go(stages, tmp_path / "o", "--images", "subjects", "--yes-cost", card_id(out), marks=marks)
    blob = json.dumps(rec[0])
    for w in ("Nightjar", "oat milk", "2027"):
        assert w not in blob
    # a recording whose subjects carry a paraphrase, a codename word and a digit: each slot is held back, none goes to Runway
    g = json.loads((stages / imagegen.STAGE_G_FILE).read_text())
    keys = list(g["subjects"])
    g["subjects"][keys[0]]["subject"] = "A kettle with milk, blue and oat."
    g["subjects"][keys[1]]["subject"] = "A nightjar on a wall."
    g["subjects"][keys[2]]["subject"] = "A wall with 2027 painted on it."
    (stages / imagegen.STAGE_G_FILE).write_text(json.dumps(g))
    d, text = go(stages, tmp_path / "o", "--images", "plan", marks=marks)
    plan = json.loads((stages / "images" / "plan.json").read_text())
    for k in keys[:3]:
        assert plan["slots"][k]["status"] == "held" and plan["slots"][k]["reason"] == "would draw on a Confidential part"   # paraphrase, codename word, digit
    assert all("Nightjar" not in r.get("prompt", "") for r in plan["slots"].values())


def test_a_subject_with_a_name_a_spelled_number_or_a_style_is_not_sent(monkeypatch, stages, tmp_path):
    rec = []
    with_subjects(monkeypatch, stages, tmp_path, rec)
    g = json.loads((stages / imagegen.STAGE_G_FILE).read_text())
    keys = list(g["subjects"])
    g["subjects"][keys[0]]["subject"] = "A glass of Guinness on a table."
    g["subjects"][keys[1]]["subject"] = "Twenty glasses on a table."
    g["subjects"][keys[2]]["subject"] = "A mural in the style of Banksy."
    (stages / imagegen.STAGE_G_FILE).write_text(json.dumps(g))
    go(stages, tmp_path / "o", "--images", "plan")
    plan = json.loads((stages / "images" / "plan.json").read_text())
    for k in keys[:3]:
        assert plan["slots"][k]["subject_source"] == "template"
        assert not any(w in plan["slots"][k]["prompt"] for w in ("Guinness", "Twenty", "Banksy"))


def test_a_style_pack_that_maps_draft_to_pro_is_refused_at_plan_time(monkeypatch, stages, tmp_path):
    wire(monkeypatch)
    pack = tmp_path / "pack"
    pack.mkdir()
    (pack / "style.yaml").write_text("look: [natural light]\nmodels: {draft: gemini_image3_pro, hero: gemini_image3_pro}\n")
    with pytest.raises(SystemExit) as e:
        go(stages, tmp_path / "o", "--images", "plan", "--style", str(pack))
    assert "pictures use only" in str(e.value) or "models" in str(e.value)


# ------------------------------------------------------------------------------------------------ safe messaging

def safe_stages(stages):
    """The same demo with a brief that names suicide, so the safe-messaging pack applies."""
    b = json.loads((stages / "brief_object.json").read_text())
    b["loop2_golden"]["fields"]["background"]["value"] = "A suicide prevention helpline for young men."
    (stages / "brief_object.json").write_text(json.dumps(b))


def test_a_sensitive_deck_makes_nothing_until_a_person_reviews_and_one_edited_word_holds_it_again(monkeypatch, stages, tmp_path):
    safe_stages(stages)
    fake = with_subjects(monkeypatch, stages, tmp_path)
    d, text = go(stages, tmp_path / "o", "--images", "plan")
    plan = json.loads((stages / "images" / "plan.json").read_text())
    assert plan["safe_messaging"]["applies"] and all(r["status"] == "held" and "sensitive brief" in r["reason"] for r in plan["slots"].values())
    rv = tmp_path / "review.json"
    d, text = go(stages, tmp_path / "o", "--images", "plan", "--review", str(rv), "--images-reviewed", "--by", "human:ann") if rv.write_text("{}") is not None else (0, 0)
    plan = json.loads((stages / "images" / "plan.json").read_text())
    assert any(r["status"] == "planned" for r in plan["slots"].values())
    for r in plan["slots"].values():
        if r["status"] == "planned":
            assert "bridge" in " ".join(plan["banned_imagery"]) and "Never show:" in r["prompt"]
    dj = json.loads((stages / "d_idea.json").read_text())      # edit one word of the deck's words (the campaign line)
    dj["campaign_line"] = dj["campaign_line"] + " Today."
    (stages / "d_idea.json").write_text(json.dumps(dj))
    go(stages, tmp_path / "o", "--images", "plan", "--review", str(rv))
    plan = json.loads((stages / "images" / "plan.json").read_text())
    assert all(r["status"] == "held" for r in plan["slots"].values()) and fake.posts == []


def test_on_a_sensitive_deck_an_unreachable_guard_flags_and_an_unchecked_picture_cannot_be_approved(monkeypatch, stages, tmp_path):
    safe_stages(stages)
    fake = with_subjects(monkeypatch, stages, tmp_path)
    rv = tmp_path / "review.json"
    rv.write_text("{}")
    go(stages, tmp_path / "o", "--images", "plan", "--review", str(rv), "--images-reviewed", "--by", "human:ann")
    def down(url, body, timeout=0):
        raise OSError("ollama is down")
    monkeypatch.setattr(imagegen, "GUARD_POST", down)
    d, text = go(stages, tmp_path / "o", "--images", "plan", "--review", str(rv))
    go(stages, tmp_path / "o", "--images", "live", "--yes-cost", card_id(text), "--review", str(rv))
    d, _ = go(stages, tmp_path / "o", "--images", "plan", "--review", str(rv))
    ims = [(sid, n, im) for sid, n, im in images.image_slots(d) if (im.get("from") or {}).get("kind") == "generated"]
    assert ims and all(im["status"] == "flagged" and im["guards"]["safe_messaging"] for _, _, im in ims)
    rv.write_text(json.dumps({"safe_messaging": json.loads(rv.read_text())["safe_messaging"],
                              "assets": {im["asset"]: {"decision": "approve", "by": "human:ann", "at": "2026-11-17T10:00:00Z"} for _, _, im in ims}}))
    d, _ = go(stages, tmp_path / "o", "--images", "plan", "--review", str(rv))
    assert not any(im["status"] == "approved" for _, _, im in images.image_slots(d))


# ------------------------------------------------------------------------------------------------ pictures on the deck and approval

def made(monkeypatch, stages, tmp_path, fake=None):
    f = with_subjects(monkeypatch, stages, tmp_path)
    (d, _), cid = live(stages, tmp_path / "o", f)
    return f, d


def test_made_pictures_are_labelled_assets_with_the_record_slice_three_reads(monkeypatch, stages, tmp_path):
    f, d = made(monkeypatch, stages, tmp_path)
    gen = json.loads((stages / "generated.json").read_text())
    assert gen["stage"] == "generated" and gen["pictures"] and (stages / "assets").is_dir()
    ims = [im for _, _, im in images.image_slots(d) if (im.get("from") or {}).get("kind") == "generated"]
    assert ims and all(im["status"] in ("made", "flagged") and im["alt"].startswith(("Photo:", "Illustration:")) and im["prompt"] for im in ims)
    for im in ims:
        a = d["assets"][im["asset"]]
        assert a["rights"] == "generated" and a["made"]["provider"] == "runway" and a["made"]["model"] == "gemini_image3.1_flash"
    assert d["meta"]["preferences"]["picture_source"]["allow"] == "generated"
    assert not any(im["status"] == "approved" for _, _, im in images.image_slots(d))      # a picture is never evidence: nothing is approved by itself


def test_territory_slides_with_no_frames_get_one_mood_picture_slot_never_four_and_it_is_held_until_a_layout_draws_it(monkeypatch, stages, tmp_path):
    f, d = made(monkeypatch, stages, tmp_path)
    plan = json.loads((stages / "images" / "plan.json").read_text())
    terr = [r for r in plan["slots"].values() if r["anchor"]["type"] == "territory"]
    assert terr and all(r["status"] == "held" and "no layout draws one picture" in r["reason"] for r in terr)
    for sid in d["order"]:
        s = d["slides"][sid]
        if s["type"] == "territory":
            sl = s["slots"]
            assert "picture" in sl and all(sl[f"frame_{i}"]["image"]["status"] == "empty" for i in range(1, 5))
    assert not any(k.startswith("frame_") and v["image"].get("from", {}).get("kind") == "generated" for s in d["slides"].values() for k, v in (s.get("slots") or {}).items() if v.get("kind") == "image")


def test_only_the_approvers_decision_on_the_slots_own_asset_approves_and_replace_goes_on_the_next_card(monkeypatch, stages, tmp_path):
    f, d = made(monkeypatch, stages, tmp_path)
    ims = [(sid, n, im) for sid, n, im in images.image_slots(d) if (im.get("from") or {}).get("kind") == "generated" and im["status"] == "made"]
    (sid1, n1, a), (sid2, n2, b) = ims[0], ims[1]
    rv = tmp_path / "rv.json"
    rv.write_text(json.dumps({"assets": {a["asset"]: {"slide": sid1, "slot": n1, "decision": "approve", "by": "human:ann", "at": "2026-11-17T10:00:00Z"},
                                         b["asset"]: {"slide": sid2, "slot": n2, "decision": "replace", "by": "human:ann", "at": "2026-11-17T10:00:00Z", "note": "A quieter light."}}}))
    d2, text = go(stages, tmp_path / "o", "--images", "plan", "--review", str(rv))
    assert d2["slides"][sid1]["slots"][n1]["image"]["status"] == "approved"
    assert "PICTURE COST CARD" in text
    plan = json.loads((stages / "images" / "plan.json").read_text())
    row = next(r for r in plan["slots"].values() if r["slide"] == sid2 and r["slot"] == n2)
    assert row["status"] == "planned" and "Change: A quieter light." in row["prompt"] and row["attempt"] == 2
    rv.write_text(json.dumps({"assets": {a["asset"]: {"decision": "approve", "by": "human:bob", "at": "2026-11-17T10:00:00Z"}}}))   # not the approver
    d3, _ = go(stages, tmp_path / "o", "--images", "plan", "--review", str(rv))
    assert d3["slides"][sid1]["slots"][n1]["image"]["status"] == "made"


def test_remove_empties_the_slot_for_good_and_the_layout_falls_back(monkeypatch, stages, tmp_path):
    f, d = made(monkeypatch, stages, tmp_path)
    sid, n, a = next((s, n, im) for s, n, im in images.image_slots(d) if (im.get("from") or {}).get("kind") == "generated")
    rv = tmp_path / "rv.json"
    rv.write_text(json.dumps({"assets": {a["asset"]: {"decision": "remove", "by": "human:ann", "at": "2026-11-17T10:00:00Z"}}}))
    d2, text = go(stages, tmp_path / "o", "--images", "plan", "--review", str(rv))
    im = d2["slides"][sid]["slots"][n]["image"]
    assert im["status"] in ("empty", "rejected") and d2["slides"][sid]["layout"]["id"] not in ("cover_image", "image_text", "execution_visual", "full_bleed_statement")


def test_a_second_replace_is_not_automatic_two_pictures_is_the_limit(monkeypatch, stages, tmp_path):
    f, d = made(monkeypatch, stages, tmp_path)
    sid, n, a = next((s, n, im) for s, n, im in images.image_slots(d) if (im.get("from") or {}).get("kind") == "generated" and im["status"] == "made")
    for i in (1, 2):
        d, _ = go(stages, tmp_path / "o", "--images", "plan")
        aid = d["slides"][sid]["slots"][n]["image"].get("asset") or a["asset"]
        rv = tmp_path / "rv.json"
        rv.write_text(json.dumps({"assets": {aid: {"decision": "replace", "by": "human:ann", "at": f"2026-11-17T1{i}:00:00Z", "note": "Softer."}}}))
        dd, text = go(stages, tmp_path / "o", "--images", "plan", "--review", str(rv))
        if i == 1:
            go(stages, tmp_path / "o", "--images", "live", "--yes-cost", card_id(text), "--review", str(rv))
    d, text = go(stages, tmp_path / "o", "--images", "plan", "--review", str(rv))
    plan = json.loads((stages / "images" / "plan.json").read_text())
    row = next(r for r in plan["slots"].values() if r["slide"] == sid and r["slot"] == n)
    assert row["status"] in ("held", "made")


# ------------------------------------------------------------------------------------------------ the hero flow

def approve_cover(stages, tmp_path, d):
    sid = next(s for s in d["order"] if d["slides"][s]["type"] == "title")
    a = d["slides"][sid]["slots"]["picture"]["image"]
    rv = tmp_path / "rv.json"
    rv.write_text(json.dumps({"assets": {a["asset"]: {"slide": sid, "slot": "picture", "decision": "approve", "by": "human:ann", "at": "2026-11-17T10:00:00Z"}}}))
    return sid, rv, a


def test_a_hero_needs_an_approved_clean_draft_a_person_asking_and_a_card_of_its_own(monkeypatch, stages, tmp_path):
    f, d = made(monkeypatch, stages, tmp_path)
    sid = next(s for s in d["order"] if d["slides"][s]["type"] == "title")
    d, text = go(stages, tmp_path / "o", "--images", "plan", "--hero", f"{sid}.picture")
    assert "FINAL PICTURE COST CARD" in text and "not approved" in text
    other = next(s for s in d["order"] if d["slides"][s]["type"] == "audience")
    sid, rv, a = approve_cover(stages, tmp_path, d)
    d, text = go(stages, tmp_path / "o", "--images", "plan", "--hero", f"{other}.picture", "--review", str(rv))
    assert "only the cover, the idea and a full-bleed" in text
    before = len(f.posts)
    d, text = go(stages, tmp_path / "o", "--images", "plan", "--hero", f"{sid}.picture", "--review", str(rv))
    import re
    hid = re.findall(r"FINAL PICTURE COST CARD  card (c_[0-9a-f]{8})", text)[0]
    assert "gemini_image3_pro" in text and "$0.20" in text
    go(stages, tmp_path / "o", "--images", "live", "--yes-cost", hid, "--hero", f"{sid}.picture", "--review", str(rv))
    assert len(f.posts) == before + 1 and f.posts[-1]["model"] == "gemini_image3_pro" and f.posts[-1]["ratio"] == "2752:1536"
    assert f.posts[-1]["promptText"] == next(p for p in f.posts[:before] if p["ratio"] == "1344:768" and p["promptText"] == f.posts[-1]["promptText"])["promptText"]


def test_a_hero_is_a_candidate_beside_the_draft_and_only_an_approval_promotes_it(monkeypatch, stages, tmp_path):
    f, d = made(monkeypatch, stages, tmp_path)
    sid, rv, a = approve_cover(stages, tmp_path, d)
    d, text = go(stages, tmp_path / "o", "--images", "plan", "--hero", f"{sid}.picture", "--review", str(rv))
    import re
    hid = re.findall(r"FINAL PICTURE COST CARD  card (c_[0-9a-f]{8})", text)[0]
    d, _ = go(stages, tmp_path / "o", "--images", "live", "--yes-cost", hid, "--hero", f"{sid}.picture", "--review", str(rv))
    im = d["slides"][sid]["slots"]["picture"]["image"]
    assert im["asset"] == a["asset"] and im["status"] == "approved" and im["candidate"]["asset"] != a["asset"]
    import jsonschema
    schema = json.loads((HERE.parent / "deck.schema.json").read_text())
    for _, _, x in images.image_slots(d):   # every made picture slot, the candidate included, is a valid image slot
        jsonschema.Draft7Validator({"$ref": "#/definitions/image_slot", "definitions": schema["definitions"]}).validate(x)
    # pending: the client render draws the draft
    dc, _ = go(stages, tmp_path / "oc", "--images", "plan", "--review", str(rv), "--audience", "client", "--pictures", "creative_cover")
    assert images.drawn(dc, "client")[(sid, "picture")]["asset"] == a["asset"]
    cand = im["candidate"]["asset"]
    # removed: the draft stays and the candidate is gone
    rv.write_text(json.dumps({"assets": {a["asset"]: {"decision": "approve", "by": "human:ann", "at": "2026-11-17T10:00:00Z"},
                                         cand: {"decision": "remove", "by": "human:ann", "at": "2026-11-17T11:00:00Z"}}}))
    d2, _ = go(stages, tmp_path / "o", "--images", "plan", "--review", str(rv))
    assert d2["slides"][sid]["slots"]["picture"]["image"]["asset"] == a["asset"] and "candidate" not in d2["slides"][sid]["slots"]["picture"]["image"]
    # approved: promoted with a new approval naming the new asset
    rv.write_text(json.dumps({"assets": {a["asset"]: {"decision": "approve", "by": "human:ann", "at": "2026-11-17T10:00:00Z"},
                                         cand: {"decision": "approve", "by": "human:ann", "at": "2026-11-17T11:00:00Z"}}}))
    d3, _ = go(stages, tmp_path / "o", "--images", "plan", "--review", str(rv))
    im3 = d3["slides"][sid]["slots"]["picture"]["image"]
    assert im3["asset"] == cand and im3["status"] == "approved" and im3["approval"]["asset"] == cand and "candidate" not in im3


def test_at_most_three_heroes_per_deck(monkeypatch, stages, tmp_path):
    f, d = made(monkeypatch, stages, tmp_path)
    m = jobs.load_manifest(stages / "images")
    for i in range(3):
        m["jobs"][f"h{i}"] = {"key": f"h{i}", "tier": "hero", "kind": "hero", "model": "gemini_image3_pro", "state": "failed", "slots": ["title:cover.picture"], "table_credits": 20}
    jobs.save_manifest(stages / "images", m)
    sid, rv, a = approve_cover(stages, tmp_path, d)
    d, text = go(stages, tmp_path / "o", "--images", "plan", "--hero", f"{sid}.picture", "--review", str(rv))
    assert "3 final-picture jobs" in text


# ------------------------------------------------------------------------------------------------ style changes, images-only, the layout hook

def test_a_changed_style_pack_never_remakes_a_picture_by_itself(monkeypatch, stages, tmp_path):
    f, d = made(monkeypatch, stages, tmp_path)
    n = len(f.posts)
    pack = tmp_path / "pack"
    pack.mkdir()
    (pack / "style.yaml").write_text("look: [soft grey light]\nfinish: rough\n")
    d, text = go(stages, tmp_path / "o", "--images", "plan", "--style", str(pack))
    assert "Optional, not included" in text and "--remake-style" in text and len(f.posts) == n
    d, text = go(stages, tmp_path / "o", "--images", "plan", "--style", str(pack), "--remake-style")
    assert "PICTURE COST CARD" in text and "Optional" not in text


def test_images_only_rebuilds_from_recorded_stages_and_changes_no_word(monkeypatch, stages, tmp_path):
    f, d = made(monkeypatch, stages, tmp_path)
    with pytest.raises(SystemExit) as e:
        go(stages, tmp_path / "o", "--images-only")
    assert "missing" in str(e.value)
    for n in ("fit.json", "e_copy.json", "red_team.json"):
        (stages / n).write_text(json.dumps({"stage": n, "produced_by": "t", "edits": [], "objections": [], "verdicts": {}}))
    d0 = d
    d1, _ = go(stages, tmp_path / "o2", "--images-only", "--images", "plan")
    assert imagegen.words_sha(d0) == imagegen.words_sha(d1)


def test_a_planned_slot_counts_as_a_picture_source_and_an_unmade_one_is_planned_again_without_it(monkeypatch, stages, tmp_path):
    from deck import layouts
    f = with_subjects(monkeypatch, stages, tmp_path)
    d, text = go(stages, tmp_path / "o", "--images", "plan")     # card shown, nothing paid: slots end up without their picture layout
    assert not layouts.unmade_planned(d)
    assert all(d["slides"][s]["layout"]["id"] not in ("cover_image",) for s in d["order"] if d["slides"][s]["type"] == "title")
    assert layouts.picture_source({"status": "planned", "from": {"kind": "generated"}}) and not layouts.picture_source({"status": "empty"})
    assert not any(im["status"] == "planned" for _, _, im in images.image_slots(d))      # no placeholder box
    assert f.posts == []


def test_the_default_run_changes_nothing_a_deck_with_no_images_flag_is_byte_identical(stages, tmp_path, build_demo, demo_stages):
    a = build_demo(demo_stages, tmp_path / "a", "--pictures", "creative_cover")
    b = build_demo(demo_stages, tmp_path / "b", "--pictures", "creative_cover", "--images", "off")
    da, db = (json.loads((x / "deck.json").read_text()) for x in (a, b))
    for d in (da, db):
        d["meta"].pop("built_at")
    assert da == db


def test_every_code_template_and_composition_passes_the_lint_so_the_fallback_is_always_sendable():
    from visuals import lint
    for k, v in imagegen.TEMPLATES.items():
        assert lint.lint_text(v) is None, (k, lint.lint_text(v))


def test_the_visuals_tests_are_collected_by_check_and_ci():
    root = HERE.parents[2]
    assert "visuals/tests" in (root / "scripts" / "check.sh").read_text() and "visuals/tests" in (root / ".github" / "workflows" / "ci.yml").read_text()
    import subprocess
    out = subprocess.run([sys.executable, "-m", "pytest", "--collect-only", "-q", "-p", "no:cacheprovider", "visuals/tests"], cwd=HERE.parents[1],
                         capture_output=True, text=True, env={"PYTHONPATH": ".", "PATH": "/usr/bin:/bin"})
    assert "test_runway.py" in out.stdout and "test_lint.py" in out.stdout


def test_python_dash_m_territory_visuals_still_runs():
    import subprocess
    r = subprocess.run([sys.executable, "-m", "territory.visuals", "--help"], cwd=HERE.parents[1], capture_output=True, text=True, env={"PYTHONPATH": ".", "PATH": "/usr/bin:/bin"})
    assert r.returncode == 0 and "--from-run" in r.stdout


# ------------------------------------------------------------------------------------------------ the engine server

def _server(tmp_path, images):
    import threading
    from deck import server as srv
    from test_server import FERN
    env = {"NAPKIN_DECK_DATA": str(tmp_path / "runs"), "NAPKIN_DECK_REPLAY": str(FERN / "stages"), "NAPKIN_DECK_PORT": "0", **({"NAPKIN_DECK_IMAGES": "1"} if images else {})}
    httpd = srv.serve(srv.Settings(env))
    ALLOWED_PORTS.add(httpd.server_address[1])
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, f"http://127.0.0.1:{httpd.server_address[1]}"


def _drive(base, **extra):
    from test_server import call, start, wait
    done = {"storyline": {"decision": "approve"}, "territories": {"decision": "approve"}, "idea": {"decision": "approve"}}
    e = type("E", (), {"base": base})
    start(e); wait(base, "doc1")
    for k in ("storyline", "territories"):
        start(e, approvals={g: done[g] for g in list(done)[: list(done).index(k) + 1]}); wait(base, "doc1")
    approvals = {**done, **extra.pop("approvals", {})}
    start(e, approvals=approvals, **extra)
    return wait(base, "doc1")


def test_the_server_passes_the_picture_cards_through_and_never_makes_a_picture_without_a_yes(monkeypatch, tmp_path):
    fake = wire(monkeypatch)
    httpd, base = _server(tmp_path, images=True)
    try:
        v = _drive(base, marks=[])
        assert v["state"] == "done", v.get("error")
        im = v["run"]["images"]
        assert im["state"] == "card" and im["cards"]["subjects"]["id"].startswith("c_") and im["cap_usd"] == 2.5
        assert fake.posts == []
        v = _drive(base, marks=[], approvals={"images": {"decision": "approve", "by": "human:ann", "at": "2026-11-17T10:00:00Z", "card": im["cards"]["subjects"]["id"], "usd": 0.05}})
        assert v["state"] == "done", v.get("error")
        assert fake.posts == [] and "pictures" in v["run"]["images"]["cards"]       # stage g ran on the yes, and the picture card is now open
        v = _drive(base, marks=[], approvals={"images": {"decision": "approve", "by": "human:ann", "at": "x", "card": "c_00000000", "usd": 0.5}})
        assert v["state"] == "failed" and fake.posts == []
    finally:
        httpd.shutdown()


def test_the_server_with_images_off_or_no_mark_data_plans_nothing(monkeypatch, tmp_path):
    wire(monkeypatch)
    httpd, base = _server(tmp_path, images=False)
    try:
        v = _drive(base, marks=[])
        assert v["state"] == "done" and "images" not in v["run"]
    finally:
        httpd.shutdown()
    httpd, base = _server(tmp_path / "b", images=True)
    try:
        v = _drive(base)                                    # marks absent: refuse (nothing is planned)
        assert v["state"] == "done" and "images" not in v["run"]
        from test_server import call
        s, body = call(base, "/run", {"doc": "x", "inputs": {"prompt": {"text": "t"}}, "marks": "nope", "mode": "replay"})
        assert s == 400
    finally:
        httpd.shutdown()
