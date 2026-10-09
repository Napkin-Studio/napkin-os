"""Character cards (features/character-cards.clan): one vision call per picture, ever, within a budget,
and never a failed job. No model is called: a fake wire under the real ModelPort, as test_director does."""

import base64
import io
import json
import threading
import time

from PIL import Image

import cards as cards_mod
from cards import Cards, card_key
from conftest import Harness, asset, ref
from director import PassthroughDirector
from director.model import ModelError, ModelPort, Reply
from names import to_wire

CARD = {"card": "A round blue robot with one eye\nFlat 2D, thick black outlines\nFront view, arms down", "kind": "character"}


class CardWire:
    """Stands in for the model endpoint: answers each picture with a card, after `delay` s, or raises."""
    api = "anthropic"

    def __init__(self, delay=0.0, fail=None, slow=None):
        self.delay, self.fail, self.slow = delay, fail, slow or {}
        self.calls = []
        self.lock = threading.Lock()

    def send(self, **kw):
        with self.lock:
            self.calls.append(kw)
            n = len(self.calls)
        time.sleep(self.slow.get(n, self.delay))
        if self.fail:
            raise ModelError("character_card: the model call failed (timeout)", self.fail)
        return Reply(json.dumps(CARD), "ok", (900, 40))


def png(n: int, alpha=False) -> bytes:
    im = Image.new("RGBA" if alpha else "RGB", (2000, 1000), (n * 40 % 255, 80, 200, 0) if alpha else (n * 40 % 255, 80, 200))
    out = io.BytesIO()
    im.save(out, "PNG")
    return out.getvalue()


def stored(blobs, *ns):
    """Pictures in our store (in/sha256:…), as uploads are."""
    for n in ns:
        a = asset(n)
        blobs.put(f"in/{a['sha256']}", png(n), "image/png")


def maker(blobs, wire, **kw):
    return Cards(ModelPort(wire, "claude-haiku-4-5", timeout=5), blobs, "claude-haiku-4-5", **kw)


# --- the card maker -----------------------------------------------------------

def test_a_card_is_made_once_per_picture_and_reused():
    h = Harness()
    stored(h.blobs, 1)
    wire = CardWire()
    c = maker(h.blobs, wire)
    first = c.attach([ref(1, "robo_front")], "job_a")
    assert first.refs[0]["card"] == CARD["card"] and first.made == 1 and first.cached == 0
    assert h.blobs.get_json(card_key(asset(1)["sha256"]))["kind"] == "character"
    # The same picture under another name, in another job: no second look.
    again = c.attach([ref(1, "robo_side"), ref(1)], "job_b")
    assert [r["card"] for r in again.refs] == [CARD["card"]] * 2 and again.cached == 1 and again.made == 0
    # A fresh relay (another Lambda) reads it from the store.
    fresh = maker(h.blobs, wire)
    assert fresh.attach([ref(1)], "job_c").refs[0]["card"] == CARD["card"]
    assert len(wire.calls) == 1


def test_the_vision_call_is_haiku_on_a_downscaled_picture():
    h = Harness()
    stored(h.blobs, 1)
    wire = CardWire()
    maker(h.blobs, wire).attach([ref(1)], "job_a")
    sent = wire.calls[0]
    assert sent["model"] == "claude-haiku-4-5" and sent["purpose"] == "character_card"
    assert sent["system"] == cards_mod.SYSTEM and sent["schema"]["required"] == ["card", "kind"]
    image = sent["turns"][0]["images"][0]
    assert image["media_type"] == "image/jpeg"
    assert max(Image.open(io.BytesIO(base64.b64decode(image["data"]))).size) == 768


def test_a_transparent_drawing_goes_on_white():
    mt, data = cards_mod.downscale(png(1, alpha=True))
    im = Image.open(io.BytesIO(base64.b64decode(data)))
    assert mt == "image/jpeg" and im.mode == "RGB" and im.getpixel((5, 5)) == (255, 255, 255)


def test_missing_cards_are_made_in_parallel_within_the_budget():
    h = Harness()
    stored(h.blobs, 1, 2, 3, 4)
    wire = CardWire(delay=0.4)
    t0 = time.monotonic()
    got = maker(h.blobs, wire, budget_s=3).attach([ref(n) for n in (1, 2, 3, 4)], "job_a")
    assert time.monotonic() - t0 < 1.2  # four 0.4 s calls side by side, not 1.6 s in a row
    assert got.made == 4 and all(r["card"] for r in got.refs)


def test_a_late_card_is_skipped_for_this_job_and_ready_for_the_next():
    h = Harness()
    stored(h.blobs, 1, 2)
    wire = CardWire(slow={1: 0.0, 2: 0.0})
    c = maker(h.blobs, wire, budget_s=0.3)
    wire.slow = {1: 0.0, 2: 0.9}  # the second picture's call takes longer than the budget
    t0 = time.monotonic()
    got = c.attach([ref(1), ref(2)], "job_a")
    assert time.monotonic() - t0 < 0.7
    assert got.late == 1 and sum("card" in r for r in got.refs) == 1
    time.sleep(1.0)  # the late call finishes (background: a long-lived relay)
    nxt = c.attach([ref(1), ref(2)], "job_b")
    assert all(r.get("card") for r in nxt.refs) and nxt.cached == 2 and len(wire.calls) == 2


def test_a_job_waits_on_a_card_another_job_is_already_making():
    h = Harness()
    stored(h.blobs, 1)
    wire = CardWire(delay=0.5)
    c = maker(h.blobs, wire, budget_s=0.1)
    assert c.attach([ref(1)], "job_a").late == 1
    assert c.attach([ref(1)], "job_b").late == 1  # still in flight: joins it, no second call
    c.budget_s = 2
    assert c.attach([ref(1)], "job_c").refs[0]["card"] and len(wire.calls) == 1


def test_a_vision_failure_or_timeout_leaves_no_card():
    h = Harness()
    stored(h.blobs, 1)
    for kind in ("timeout", "refusal", "server"):
        got = maker(h.blobs, CardWire(fail=kind)).attach([ref(1)], "job_a")
        assert got.failed == 1 and "card" not in got.refs[0]
    assert h.blobs.get_json(card_key(asset(1)["sha256"])) is None


def test_a_picture_that_is_not_ours_gets_no_card():
    h = Harness()
    wire = CardWire()
    r = ref(1)
    r["asset"] = {**r["asset"], "url": "https://elsewhere.test/x.png"}
    assert "card" not in maker(h.blobs, wire).attach([r], "job_a").refs[0] and not wire.calls


def test_no_model_means_no_card_maker():
    h = Harness()
    assert cards_mod.make(PassthroughDirector(), h.blobs, background=False) is None


def test_on_lambda_a_card_call_cannot_outlive_the_budget():
    from director.director import Director
    from director.claude import ClaudeDirector, PROMPTS
    from providers import load_sheet
    port = ModelPort(CardWire(), "claude-haiku-4-5", timeout=20)
    d = ClaudeDirector(Director(port, PROMPTS, {"runway": load_sheet("runway")}, per_click_model="claude-haiku-4-5"))
    lam = cards_mod.make(d, Harness().blobs, background=False)
    assert lam.port.timeout == cards_mod.BUDGET_S and not lam.background
    assert cards_mod.make(d, Harness().blobs, background=True).port.timeout == 20


def test_cards_are_short():
    assert cards_mod.tidy("- one\n\n* two\nthree\nfour\nfive\n" + "x" * 300) == "one\ntwo\nthree\nfour"


# --- in the relay -------------------------------------------------------------

class Recording(PassthroughDirector):
    def __init__(self):
        self.asked = []

    def direct(self, job_request, sheet):
        self.asked.append(job_request)
        return super().direct(job_request, sheet)


def test_the_director_gets_each_refs_card_and_the_block_logs_them():
    h = Harness()
    stored(h.blobs, 1, 2)
    h.relay.director = rec = Recording()
    h.relay.cards = maker(h.blobs, CardWire())
    tok = h.sign_in()
    _, job = h.post_job(tok, "generate", text="@robo_front waves", refs=[ref(1, "robo_front"), ref(2, kind="drawing")])
    refs = rec.asked[0]["input"]["refs"]
    assert [r["card"] for r in refs] == [CARD["card"]] * 2 and [r["tag"] for r in refs] == ["robo_front", "in_1"]
    assert job["director"]["cards"] == [
        {"tag": "robo_front", "sha256": asset(1)["sha256"], "kind": "character", "card": CARD["card"]},
        {"tag": "in_1", "sha256": asset(2)["sha256"], "kind": "character", "card": CARD["card"]},
    ]
    # The ledger keeps what the participant sent: no cards in the request.
    assert "card" not in h.store.get_job(job["jobId"])["_req"]["input"]["refs"][0]


def test_only_the_refs_that_go_get_cards():
    """names.fit_refs drops extra views first; no card is made for a picture the job does not send."""
    h = Harness()
    stored(h.blobs, *range(1, 9))
    wire = CardWire()
    h.relay.director = rec = Recording()
    h.relay.cards = maker(h.blobs, wire)
    views = ("front", "side", "back", "three-quarter")
    refs = [ref(i + 1, f"ana_{v}") for i, v in enumerate(views)] + [ref(i + 5, f"bo_{v}") for i, v in enumerate(views)]
    h.cfg["routing"]["generate"] = ["fal"]
    tok = h.sign_in()
    h.post_job(tok, "generate", text="@ana and @bo", refs=refs)
    sent = rec.asked[0]["input"]["refs"]
    assert len(wire.calls) == len(sent) and all(r.get("card") for r in sent)


def test_a_card_failure_never_fails_the_job():
    h = Harness()
    stored(h.blobs, 1)
    h.relay.director = rec = Recording()
    h.relay.cards = maker(h.blobs, CardWire(fail="timeout"))
    tok = h.sign_in()
    _, job = h.post_job(tok, "generate", refs=[ref(1, "robo_front")], text="@robo_front")
    assert job["state"] == "submitted" and "cards" not in job["director"]
    assert "card" not in rec.asked[0]["input"]["refs"][0]


def test_a_card_maker_that_breaks_never_fails_the_job():
    class Broken:
        def attach(self, refs, job_id):
            raise RuntimeError("boom")

    h = Harness()
    h.relay.cards = Broken()
    tok = h.sign_in()
    _, job = h.post_job(tok, "generate")
    assert job["state"] == "submitted"


def test_without_a_model_the_job_runs_as_before():
    h = Harness()  # the passthrough, no card maker
    tok = h.sign_in()
    _, job = h.post_job(tok, "generate")
    assert job["state"] == "submitted" and "cards" not in job["director"]


def test_shot_list_makes_no_cards():
    h = Harness()
    stored(h.blobs, 1)
    wire = CardWire()
    h.relay.cards = maker(h.blobs, wire)
    tok = h.sign_in()
    h.post_job(tok, "shot_list", script="A robot waves. It smiles.", targetS=10, refs=[ref(1, "robo_front")])
    assert not wire.calls


# --- the director's side -------------------------------------------------------

def test_names_keep_the_card_on_the_wire():
    r = {**ref(1, "maya_three-quarter"), "card": CARD["card"]}
    out = to_wire("generate", {"text": "@maya_three-quarter", "refs": [r]})
    assert out["refs"][0]["card"] == CARD["card"] and out["refs"][0]["tag"]


def test_the_passthrough_ignores_cards():
    from conftest import sheets
    sheet = sheets()["runway"]
    plain = to_wire("generate", {"text": "@robo_front waves", "refs": [ref(1, "robo_front")]})
    carded = {**plain, "refs": [{**plain["refs"][0], "card": CARD["card"]}]}
    req = {"jobId": "job_x", "op": "generate"}
    d = PassthroughDirector()
    assert d.direct({**req, "input": carded}, sheet) == d.direct({**req, "input": plain}, sheet)
