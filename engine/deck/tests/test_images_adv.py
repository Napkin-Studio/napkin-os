"""The adversarial check's findings on deck-image-gen (1 blocker, 4 majors, 5 minors), each with a test. Hermetic: see test_images_gen."""
from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent / "fixtures" / "images"))
from make_brief_marked import build  # noqa: E402,F401

from deck import imagegen, images, inputs, run_deck  # noqa: E402
from test_images_gen import (FakeRunway, KEY, card_id, clean_guard, fake_subjects, go, made, stages, wire, with_subjects, hermetic)  # noqa: E402,F401
from visuals import jobs, lint, runway  # noqa: E402


# ---------------------------------------------------------------------------------------------- 1. non-ASCII

@pytest.mark.parametrize("bad", ["A glass of ＮＥＳＬＥ on a table.", "A sign saying 東京 ネスレ.", "A glass​ of water.",
                                 "A glass \U0001F600 of water.", "A glass of ②."])
def test_the_lint_refuses_anything_outside_printable_ascii(bad):
    why = lint.lint_text(bad)
    assert why and "ascii" in why.lower()


def test_marked_non_latin_text_is_denied_as_a_whole():
    d = lint.deny_list([{"text": "東京 ネスレの新製品"}])
    assert lint.lint_text("A quiet street with soft light.", deny=d) == "would draw on a Confidential part"
    d2 = lint.deny_list([{"text": "ＮＥＳＬＥ launch"}])
    assert lint.lint_text("A quiet street with soft light.", deny=d2) == "would draw on a Confidential part"


# ---------------------------------------------------------------------------------------------- 2. every send counts

class Fail:
    def __init__(self, mode):
        self.mode = mode
        self.n = 0

    def __call__(self, method, url, headers, body, timeout=0):
        if method == "POST":
            if self.mode == "timeout":
                raise TimeoutError("lost")
            self.n += 1
            return 200, json.dumps({"id": f"t{self.n}", "estimatedCost": {"credits": 7}}).encode()
        if "/tasks/" in url:
            return 200, json.dumps({"status": "SUCCEEDED", "output": ["https://cdn.example/x.png"]}).encode()
        import io
        from PIL import Image
        b = io.BytesIO()
        Image.new("RGB", (8, 8)).save(b, "PNG")
        return 200, b.getvalue()


def _job(i=1):
    p = f"A kitchen tap, picture {i}."
    return {"key": runway.request_key(runway.TIER_MODEL["draft"], "1344:768", p, [], "r1", 1), "tier": "draft", "ratio": "1344:768", "prompt": p, "slots": [f"s{i}"], "ref_shas": []}


def _gen(cache, ledger, js, transport, **kw):
    m = jobs.load_manifest(cache)
    r = jobs.generate(runway.Client(KEY, transport), js, cache, m, jobs.Ledger(ledger, "d1"), kw.pop("cap", 2.5), lambda j: [], sleep=lambda s: None, log=lambda *a: None, **kw)
    return m, r


def test_an_unknown_job_retried_is_charged_twice_and_counted_twice(tmp_path):
    j = _job()
    _gen(tmp_path / "c", tmp_path / "l.jsonl", [j], Fail("timeout"))
    m, r = _gen(tmp_path / "c", tmp_path / "l.jsonl", [j], Fail("ok"), retry_unknown=True)
    assert r["created"] == 1
    led = jobs.Ledger(tmp_path / "l.jsonl", "d1")
    assert jobs.spent_usd(m, led) == pytest.approx(0.14)
    import shutil as sh
    sh.rmtree(tmp_path / "c")
    assert jobs.spent_usd(jobs.load_manifest(tmp_path / "c"), led) == pytest.approx(0.14)     # the ledger alone says two sends


def test_a_stage_g_call_that_raised_counts_each_attempt(tmp_path):
    led = jobs.Ledger(tmp_path / "l.jsonl", "d1")
    for _ in range(2):
        with led.locked():
            led.append({"key": "g_abc", "tier": "subjects", "kind": "subjects", "estimate_usd": 0.05, "state": "creating"})
    assert jobs.spent_usd({"jobs": {}}, led) == pytest.approx(0.10)


def test_a_yes_cannot_be_replayed_after_a_send(monkeypatch, stages, tmp_path):
    with_subjects(monkeypatch, stages, tmp_path)
    wire(monkeypatch, fake=FakeRunway(fail="timeout"))
    d, text = go(stages, tmp_path / "o", "--images", "plan")
    go(stages, tmp_path / "o", "--images", "live", "--yes-cost", card_id(text))            # first send: unknown
    d, t2 = go(stages, tmp_path / "o", "--images", "plan", "--retry-unknown")
    a = card_id(t2)
    go(stages, tmp_path / "o", "--images", "live", "--retry-unknown", "--yes-cost", a)    # second send: unknown again
    d, t3 = go(stages, tmp_path / "o", "--images", "plan", "--retry-unknown")
    assert card_id(t3) != a
    with pytest.raises(SystemExit):
        go(stages, tmp_path / "o", "--images", "live", "--retry-unknown", "--yes-cost", a)


# ---------------------------------------------------------------------------------------------- 3. cap lifetime and the CLI

def _argv(stages, out, *extra, brief=None):
    return ["--stages", str(stages), "--brief", str(brief or Path(stages) / "brief_object.json"), "--client", "Lumen Water", "--project", "National awareness campaign",
            "--out", str(out), "--no-qa", "--density", "detailed", *extra]


def _run(argv):
    import contextlib, io
    saved = (run_deck.subprocess.run, run_deck._soffice)
    run_deck.subprocess.run = lambda *a, **k: None
    run_deck._soffice = lambda: "soffice"
    buf = io.StringIO()
    try:
        with contextlib.redirect_stdout(buf):
            run_deck.main(argv)
    finally:
        run_deck.subprocess.run, run_deck._soffice = saved
    return buf.getvalue()


def test_a_cap_above_two_fifty_is_refused(stages, tmp_path):
    (tmp_path / "m.json").write_text("[]")
    with pytest.raises(SystemExit):
        _run(_argv(stages, tmp_path / "o", "--images", "plan", "--marks", str(tmp_path / "m.json"), "--cap-usd", "10"))


def test_the_deck_id_and_ledger_flags_need_dev(stages, tmp_path):
    (tmp_path / "m.json").write_text("[]")
    with pytest.raises(SystemExit):
        _run(_argv(stages, tmp_path / "o", "--images", "plan", "--marks", str(tmp_path / "m.json"), "--deck-id", "x"))
    with pytest.raises(SystemExit):
        _run(_argv(stages, tmp_path / "o", "--images", "plan", "--marks", str(tmp_path / "m.json"), "--ledger", str(tmp_path / "l")))


def test_a_copied_stages_folder_shares_the_cap(monkeypatch, stages, tmp_path):
    monkeypatch.setenv("NAPKIN_DECK_LEDGER", str(tmp_path / "ledger.jsonl"))
    (tmp_path / "m.json").write_text("[]")
    rec = []
    wire(monkeypatch, subjects=fake_subjects(rec))
    t = _run(_argv(stages, tmp_path / "o", "--images", "subjects", "--marks", str(tmp_path / "m.json")))
    _run(_argv(stages, tmp_path / "o", "--images", "subjects", "--marks", str(tmp_path / "m.json"), "--yes-cost", card_id(t)))
    copy = tmp_path / "copy" / "stages"
    shutil.copytree(stages, copy)
    shutil.rmtree(copy / "images")
    (copy / imagegen.STAGE_G_FILE).unlink()
    t2 = _run(_argv(copy, tmp_path / "o2", "--images", "subjects", "--marks", str(tmp_path / "m.json")))
    assert "spent $0.05" in t2


# ---------------------------------------------------------------------------------------------- 4. marks

def test_marks_given_on_the_command_line_only_add_and_are_type_checked(monkeypatch, stages, tmp_path):
    wire(monkeypatch)
    clan = tmp_path / "b.clan"
    import zipfile, yaml
    with zipfile.ZipFile(clan, "w") as z:
        z.writestr("manifest.yaml", yaml.safe_dump({"document_id": "docB", "app": {"app_id": "x"}}))
        z.writestr("shared/data.yaml", yaml.safe_dump({"background": "A water brand.", "tone_and_world": "A quiet kitchen at Nightjar dawn.", "confidential_fields": ["tone_and_world"]}))
    rec = []
    monkeypatch.setattr(imagegen, "SUBJECTS_CALL", fake_subjects(rec))
    (tmp_path / "m.json").write_text("[]")
    argv = _argv(stages, tmp_path / "o", "--images", "subjects", "--marks", str(tmp_path / "m.json"), "--dev", "--ledger", str(tmp_path / "l.jsonl"), "--deck-id", "d1", brief=clan)
    t = _run(argv)
    _run([*argv, "--yes-cost", card_id(t)])
    assert rec and "Nightjar" not in json.dumps(rec[0])            # [] did not wipe the mark the document carried
    for bad in ('["a"]', '{"x": 1}', '[{"path": "p", "text": ""}]'):
        (tmp_path / "bad.json").write_text(bad)
        with pytest.raises(SystemExit):
            _run(_argv(stages, tmp_path / "o", "--images", "plan", "--marks", str(tmp_path / "bad.json"), "--dev", "--ledger", str(tmp_path / "l.jsonl"), "--deck-id", "d1"))


def test_a_marked_path_that_resolves_to_nothing_is_refused_not_skipped():
    with pytest.raises(ValueError):
        inputs.marks_from_data({"confidential_fields": ["typo_field"], "background": "x"})
    with pytest.raises(ValueError):
        inputs.marks_from_data({"confidential_fields": ["background"], "background": "  "})


# ---------------------------------------------------------------------------------------------- 5. stale generated.json

def test_pictures_made_for_other_words_are_not_bound(monkeypatch, stages, tmp_path):
    f, d = made(monkeypatch, stages, tmp_path)
    assert any((im.get("from") or {}).get("kind") == "generated" for _, _, im in images.image_slots(d))
    dj = json.loads((stages / "d_idea.json").read_text())
    dj["campaign_line"] = "Today. " + dj["campaign_line"]   # another line, not the brief's line grown (a grown line is put back: assemble.keep_stated_line)
    (stages / "d_idea.json").write_text(json.dumps(dj))
    d2, _ = go(stages, tmp_path / "o", "--pictures", "creative_cover")
    assert not any((im.get("from") or {}).get("kind") == "generated" for _, _, im in images.image_slots(d2))
    val = json.loads((tmp_path / "o" / "validation.json").read_text())
    assert any("other words" in (x.get("message") or "") for x in val)


# ---------------------------------------------------------------------------------------------- minors

def test_download_is_https_only():
    with pytest.raises(runway.RunwayError):
        runway.Client(KEY, Fail("ok")).download("http://cdn.example/x.png")
    with pytest.raises(runway.RunwayError):
        runway.Client(KEY, Fail("ok")).download("file:///etc/passwd")


class Raising:
    def __init__(self, exc):
        self.exc = exc

    def create(self, *a, **k):
        raise self.exc

    def task(self, *a):
        raise AssertionError


def test_a_create_error_with_no_status_is_unknown_unless_provably_before_the_send(tmp_path):
    j = _job()
    m = jobs.load_manifest(tmp_path / "c")
    r = jobs.generate(Raising(runway.RunwayError("odd")), [j], tmp_path / "c", m, jobs.Ledger(tmp_path / "l", "d"), 2.5, lambda x: [], sleep=lambda s: None, log=lambda *a: None)
    assert r["unknown"] == [j["key"]] and not r["failed"]
    e = runway.RunwayError("17 reference images")
    e.pre_send = True
    m = jobs.load_manifest(tmp_path / "c2")
    r = jobs.generate(Raising(e), [_job(2)], tmp_path / "c2", m, jobs.Ledger(tmp_path / "l2", "d"), 2.5, lambda x: [], sleep=lambda s: None, log=lambda *a: None)
    assert r["failed"] and not r["unknown"]
    with pytest.raises(runway.RunwayError) as ex:
        runway.Client(KEY, Fail("ok")).create("m", "p", [{"uri": "u"}] * 15)
    assert getattr(ex.value, "pre_send", False)


def test_the_cap_check_uses_the_larger_of_table_and_runways_estimate(tmp_path):
    class Est(Fail):
        def __call__(self, method, url, headers, body, timeout=0):
            if method == "POST":
                self.n += 1
                return 200, json.dumps({"id": f"t{self.n}", "estimatedCost": {"credits": 15}}).encode()
            return super().__call__(method, url, headers, body, timeout)
    m, r = _gen(tmp_path / "c", tmp_path / "l.jsonl", [_job(1), _job(2)], Est("ok"), cap=0.25)
    assert r["created"] == 1 and "cap reached" in (r["stopped"] or "")


def test_card_ids_are_sixteen_hex_characters(monkeypatch, stages, tmp_path):
    wire(monkeypatch)
    d, text = go(stages, tmp_path / "o", "--images", "plan")
    assert len(card_id(text)) == 18


def test_the_server_asks_for_the_hero_card_on_a_plain_run_too(tmp_path):
    from deck import server as srv
    s = srv.Server(srv.Settings({"NAPKIN_DECK_DATA": str(tmp_path / "runs"), "NAPKIN_DECK_IMAGES": "1"}))
    d = srv.Doc(tmp_path / "runs" / "doc1", "doc1")
    (d.root / "images").mkdir(parents=True)
    (d.root / "images" / "plan.json").write_text(json.dumps({"cards": {"heroes": {"id": "c_" + "a" * 16, "jobs": ["j"]}}, "heroes": {"s01.picture": {"ask": "s01.picture"}}}))
    plain = s.image_args(d, {"marks": [], "approvals": {}}, None)
    assert "--hero" in plain and "s01.picture" in plain
    yes = s.image_args(d, {"marks": [], "approvals": {"images": {"card": "c_" + "a" * 16}}}, None)
    assert "--yes-cost" in yes and "live" in yes
