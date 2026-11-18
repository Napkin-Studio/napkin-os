"""deck-prod-picker (deck-graphics part 5, P1-P5): deck.prod_picker reads a Production .clan directly, lists every asset from metadata, picks
by rule, pulls only the picked pictures (embedded -> https behind a flag -> the export zip) and can flag them. Offline: the .clan is the
invented Lumen Water project fixtures/production_demo/make_bundle.py builds in code; every https fetch is a stub and no socket is opened.
Run from engine/: ``PYTHONPATH=. python3 -m pytest deck/tests/test_prod_picker.py``."""
from __future__ import annotations

import copy
import hashlib
import io
import json
import os
import shutil
import socket
import subprocess
import sys
from pathlib import Path

import pytest

from deck import from_production as fp, imagegen, images, prod_picker as pp, spec

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / "fixtures" / "production_demo"))
import make_bundle as mb   # noqa: E402

sys.path.remove(str(HERE / "fixtures" / "production_demo"))

HOST = "example.invalid"
PUBLIC = ["93.184.216.34"]
MASTER = f"{mb.FSET_NEW}#master"


@pytest.fixture(autouse=True)
def no_socket(monkeypatch):
    """Any connection or name lookup raises: the picker reaches nothing; every fetch here goes through an injected stub."""
    def refuse(*a, **k):
        raise AssertionError("deck-prod-picker opened a socket")
    monkeypatch.setattr(socket.socket, "connect", refuse)
    monkeypatch.setattr(socket.socket, "connect_ex", refuse)
    monkeypatch.setattr(socket, "getaddrinfo", refuse)


@pytest.fixture(scope="module")
def pics():
    return {k: mb.draw(*v) for k, v in mb.PICTURES.items()}


def clan(tmp_path, name="lumen.clan", **kw) -> Path:
    p = tmp_path / name
    mb.build_clan(p, **kw)
    return p


def _deck():
    slides = {"s1": {"type": "title", "title": "Lumen Water"}, "s2": {"type": "idea", "title": "Every drop has a story."},
              "s3": {"type": "execution", "title": "Social stories"}, "s4": {"type": "execution", "title": "Outdoor"},
              "s5": {"type": "execution", "title": "TV film"}, "s6": {"type": "territory", "title": "Territory: The Tap Tells"},
              "s7": {"type": "execution", "title": "Radio"}}
    return {"meta": {"client": "Lumen Water"}, "order": list(slides), "slides": slides}


def _im(deck, sid, slot="picture"):
    return ((deck["slides"][sid].get("slots") or {}).get(slot) or {}).get("image")


class Resp:
    """A stub HTTP response: status, headers, a body read in chunks."""

    def __init__(self, status=200, body=b"", headers=None):
        self.status, self._b = status, io.BytesIO(body)
        self.h = {k.lower(): v for k, v in (headers or {}).items()}

    def getheader(self, k, d=None):
        return self.h.get(k.lower(), d)

    def read(self, n=-1):
        return self._b.read(n)

    def close(self):
        pass


def png_server(pics, overrides=None):
    """An opener serving each fixture picture at its document path, as Production's provider would; ``overrides(path) -> Resp|Exception``."""
    by_path = {f"/out/sha256:{hashlib.sha256(b).hexdigest()}": b for b in pics.values()}
    calls = []

    def opener(host, ip, path, timeout):
        calls.append((host, ip, path))
        if overrides:
            r = overrides(path)
            if isinstance(r, BaseException):
                raise r
            if r is not None:
                return r
        b = by_path.get(path)
        if b is None:
            return Resp(404)
        return Resp(200, b, {"Content-Type": "image/png", "Content-Length": str(len(b))})
    opener.calls = calls
    return opener


def fetcher(opener, hosts=(HOST,), resolver=lambda h: PUBLIC, **kw):
    return pp.Fetcher(hosts, "production_fetch.yaml", opener=opener, resolver=resolver, **kw)


# ---------------------------------------------------------------- P1 inventory

def test_inventory_lists_every_asset_with_its_reach_and_opens_no_socket(tmp_path):
    src = pp.Source(clan(tmp_path, embed=("master",)))
    inv = pp.Plan(src).inventory("2026-11-18T10:00:00+00:00")
    doc_assets = {h.removeprefix("sha256:") for h in src.doc["assets"]}
    assert {r["sha256"] for r in inv["rows"] if r.get("sha256")} == doc_assets             # every asset, once at least
    rows = {r["key"]: r for r in inv["rows"]}
    m = rows[MASTER]
    assert m["role"] == "key_visual" and m["reach"] == "embedded" and m["sources"] == ["embedded", "https"] and m["hosts"] == [HOST]
    s = rows[mb.S_STORY]
    assert (s["role"], s["channel"], s["aspect"], s["format"]["format_id"], s["origin"], s["rights"], s["version"], s["status"]) == \
        ("size", "social", "9:16", "meta-stories-9x16", "generated", "generated", 2, "ready")
    assert s["reach"] == "https" and s["eligible"] is True and s["label"] == "meta-stories-9x16 · 9:16"
    assert rows[f"{mb.FSET_OLD}#master"]["brief"] == {"document_id": mb.BRIEF_DOC, "data_sha256": "sha256:" + "ab" * 32}   # the brief link
    assert rows[mb.F1]["role"] == "storyboard_frame" and rows[mb.F1]["label"] == "The Tap Tells film · shot 1"
    assert rows[mb.F4]["eligible"] is False and "mock" in rows[mb.F4]["reason"]
    others = [r for r in inv["rows"] if not r["eligible"]]
    assert any(r["role"] == "render" for r in others) and any("alternate frame" in r.get("reason", "") for r in others)
    assert inv["counts"]["eligible"] == 12 and inv["fixture"] is True and inv["source"]["kind"] == "clan"
    text = json.dumps(inv)
    assert "/out/" not in text and "THUMBDATA" not in text and "SECRET-INSIGHT" not in text   # hosts only: never a location's path, a thumb or the spine


def test_reach_says_idb_only_and_s3_only(tmp_path):
    story = "sha256:" + hashlib.sha256(mb.draw(*mb.PICTURES["story"])).hexdigest()
    six = "sha256:" + hashlib.sha256(mb.draw(*mb.PICTURES["six"])).hexdigest()

    def mut(d):
        d["assets"][story]["locations"] = [f"idb://sha256/{story[7:]}"]
        d["assets"][six]["locations"] = [f"idb://sha256/{six[7:]}", f"s3://bucket/assets/{six[7:]}"]
    rows = {r["key"]: r for r in pp.Plan(pp.Source(clan(tmp_path, mutate=mut))).rows}
    assert rows[mb.S_STORY]["reach"] == "idb_only" and "export from Production" in rows[mb.S_STORY]["note"]
    assert rows[mb.S_SIX]["reach"] == "s3_only"


def test_labels_are_capped_and_control_stripped():
    assert pp.clean("a\x00b\nc‮ d" + "x" * 200) == ("a b c d" + "x" * 200)[:pp.LABEL_MAX]


def test_the_cli_writes_the_inventory_only(tmp_path):
    st = tmp_path / "st"
    assert pp.main([str(clan(tmp_path)), "--stages", str(st)]) == 0
    assert (st / "production_inventory.json").is_file() and not (st / "production.json").exists() and not (st / "assets").exists()
    (tmp_path / "x.txt").write_text("no")
    assert pp.main([str(tmp_path / "x.txt"), "--stages", str(st)]) == 2


@pytest.mark.parametrize("mut,match", [(lambda d: d.update(contract_version="4"), "contract '4'"), (lambda d: d.update(app="brief-maker"), "production-tool")])
def test_a_clan_of_another_contract_or_app_is_refused(tmp_path, mut, match):
    with pytest.raises(fp.FromProductionError, match=match):
        pp.Source(clan(tmp_path, mutate=mut))


# ---------------------------------------------------------------- P2 the rule pick

def test_the_rule_pick_equals_bind_production(tmp_path):
    bundle = tmp_path / "b.zip"
    mb.build(bundle)
    full = fp.build(bundle)[0]
    want = _deck()
    images.bind_production(want, full, "creative_cover")
    got = _deck()
    src = pp.Source(clan(tmp_path))
    res = pp.run(got, src, tmp_path / "st")
    for sid in got["order"]:
        a, b = _im(want, sid), _im(got, sid)
        assert ((a or {}).get("from") or {}).get("key") == ((b or {}).get("from") or {}).get("key"), sid
    assert res["master"]["set"] == mb.FSET_NEW and res["picker"]["ties"] == []


def test_ties_are_reported_and_the_newest_wins(tmp_path):
    twin = mb.uid("size", 9)

    def mut(d):
        d["sizes"][twin] = {**copy.deepcopy(d["sizes"][mb.S_STORY]), "id": twin}
    d = _deck()
    res = pp.run(d, pp.Source(clan(tmp_path, mutate=mut, embed=("story",))), tmp_path / "st")
    assert _im(d, "s3")["from"]["key"] == twin                                              # ULIDs sort by time: the newer
    tie = res["picker"]["ties"][0]
    assert tie["by"] == "rule" and set(tie["eligible"]) == {twin, mb.S_STORY} and tie["slots"] == ["s3.picture"]


# ---------------------------------------------------------------- P4 the tie-break

def _tie_clan(tmp_path):
    twin = mb.uid("size", 9)

    def mut(d):
        d["sizes"][twin] = {**copy.deepcopy(d["sizes"][mb.S_STORY]), "id": twin}
    return pp.Source(clan(tmp_path, mutate=mut, embed=("story", "master"))), twin


def test_the_tie_break_answer_outside_the_eligible_ids_is_discarded(tmp_path):
    src, twin = _tie_clan(tmp_path)
    seen = []

    def call(user, system):
        seen.append(json.loads(user))
        return {"choice": mb.S_SIX}, {"model": "claude-sonnet-5-5", "prompt_tokens": 900, "completion_tokens": 20, "calls": 1}
    d = _deck()
    res = pp.run(d, src, tmp_path / "st", agent=True, tie_call=call)
    tie = res["picker"]["ties"][0]
    assert tie["by"] == "rule" and "discarded" in tie["note"] and _im(d, "s3")["from"]["key"] == twin
    sent = json.dumps(seen)
    assert "/out/" not in sent and "SECRET-INSIGHT" not in sent and "sha256" not in sent    # metadata rows only
    assert {r["key"] for r in seen[0]["eligible"]} == {twin, mb.S_STORY}


def test_the_tie_break_may_choose_among_equals_and_its_cost_is_a_stage(tmp_path):
    src, twin = _tie_clan(tmp_path)
    d = _deck()
    res = pp.run(d, src, tmp_path / "st", agent=True,
                 tie_call=lambda u, s: ({"choice": mb.S_STORY, "why": "earlier"}, {"model": "claude-sonnet-5-5", "prompt_tokens": 1000, "completion_tokens": 30, "calls": 1}))
    assert res["picker"]["ties"][0]["by"] == "claude" and _im(d, "s3")["from"]["key"] == mb.S_STORY and _im(d, "s3")["status"] == "made"
    assert res["usage"]["agent"]["prompt_tokens"] == 1000 and res["usage"]["agent"]["model"] == "claude-sonnet-5-5"


def test_without_the_flag_no_call_and_a_failed_call_keeps_the_rule(tmp_path):
    src, twin = _tie_clan(tmp_path)
    boom = lambda u, s: (_ for _ in ()).throw(AssertionError("called"))   # noqa: E731
    d = _deck()
    pp.run(d, src, tmp_path / "a", tie_call=boom)
    assert _im(d, "s3")["from"]["key"] == twin
    d2 = _deck()
    res = pp.run(d2, src, tmp_path / "b", agent=True, tie_call=lambda u, s: (_ for _ in ()).throw(RuntimeError("no claude")))
    assert res["picker"]["ties"][0]["by"] == "rule" and "unavailable" in res["picker"]["ties"][0]["note"]


def test_the_tie_break_goes_through_brief_llm_to_claude_sonnet_never_gemini(tmp_path, monkeypatch):
    """The default call (no tie_call) is the deck's own Claude route: brief_llm's pinned link, provider anthropic, model Sonnet."""
    import brief_llm
    src, twin = _tie_clan(tmp_path)
    links = []

    def link(provider, model, user, system=None, **kw):
        links.append((provider, model, system))
        assert "/out/" not in user and "sha256" not in user   # metadata rows only
        return json.dumps({"choice": mb.S_STORY, "why": "earlier version"})
    monkeypatch.setattr(brief_llm, "_call_link", link)
    monkeypatch.setenv("BRIEF_CLI_EFFORT", "low")   # stages._call sets it for the stage: restored after the test
    d = _deck()
    res = pp.run(d, src, tmp_path / "st", agent=True)
    assert [(p, m) for p, m, _ in links] == [("anthropic", "claude-sonnet-5-5")] and links[0][2] == pp.TIE_SYSTEM
    assert res["picker"]["ties"][0]["by"] == "claude" and _im(d, "s3")["from"]["key"] == mb.S_STORY
    assert res["usage"]["agent"]["model"] == "claude-sonnet-5-5"


# ---------------------------------------------------------------- P3 the guarded fetch

def test_fetch_refuses_while_the_allow_list_is_empty_and_says_where_to_add_hosts(tmp_path, pics):
    assert pp.fetch_policy()["hosts"] == []                                                 # the shipped policy is empty (Q12)
    op = png_server(pics)
    d = _deck()
    res = pp.run(d, pp.Source(clan(tmp_path)), tmp_path / "st", fetch=True, fetcher=fetcher(op, hosts=()))
    assert op.calls == []
    refused = res["picker"]["fetch"]["refused"]
    assert "allow-list" in refused and "production_fetch.yaml" in refused and "Q12" in refused
    assert _im(d, "s1")["status"] == "empty" and _im(d, "s1")["reason"].startswith(spec.PRODUCTION_NOT_REACHABLE)
    assert {n["slot"] for n in res["picker"]["not_reachable"]} == {"s1.picture", "s2.picture", "s3.picture", "s4.picture", "s5.picture"}
    assert res["card"].startswith("Production: 4 picked, 4 not reachable")


def test_fetch_pulls_only_the_picked_and_verifies_them(tmp_path, pics):
    op = png_server(pics)
    d = _deck()
    st = tmp_path / "st"
    res = pp.run(d, pp.Source(clan(tmp_path)), st, fetch=True, fetcher=fetcher(op))
    assert len(op.calls) == 4 and all(c[:2] == (HOST, PUBLIC[0]) for c in op.calls)   # the four picks, nothing else, at the checked address
    prod = json.loads((st / "production.json").read_text())
    assert set(prod["items"]) == {MASTER, mb.S_STORY, mb.S_SIX, mb.F1} and all(it["source"] == "https" for it in prod["items"].values())
    for it in prod["items"].values():
        assert hashlib.sha256((st / it["file"]).read_bytes()).hexdigest() == it["sha256"]
    assert res["placed"] == 5 and res["picker"]["not_reachable"] == [] and _im(d, "s4")["status"] == "made"


CASES = {
    "404": (lambda p: Resp(404), "expired or gone (HTTP 404)"),
    "410": (lambda p: Resp(410), "expired or gone (HTTP 410)"),
    "timeout": (lambda p: socket.timeout("slow"), "timed out"),
    "wrong type": (lambda p: Resp(200, b"<html>", {"Content-Type": "text/html"}), "not a picture"),
    "wrong sha": (lambda p: Resp(200, mb.draw(10, 10, 1), {"Content-Type": "image/png"}), "do not hash"),
    "oversize header": (lambda p: Resp(200, b"x", {"Content-Type": "image/png", "Content-Length": str(30_000_000)}), "over the 25 MB cap"),
    "redirect off host": (lambda p: Resp(302, b"", {"Location": "https://elsewhere.invalid/x.png"}), "redirected to another host"),
    "redirect to http": (lambda p: Resp(301, b"", {"Location": f"http://{HOST}/x.png"}), "redirected to another host or scheme"),
}


@pytest.mark.parametrize("case", sorted(CASES))
def test_each_fetch_failure_is_not_reachable_with_its_reason_and_no_placement(tmp_path, pics, case):
    over, why = CASES[case]
    f = fetcher(png_server(pics, over))
    d = _deck()
    res = pp.run(d, pp.Source(clan(tmp_path)), tmp_path / "st", fetch=True, fetcher=f)
    im = _im(d, "s3")
    assert im["status"] == "empty" and "asset" not in im and spec.PRODUCTION_NOT_REACHABLE in im["reason"] and why in im["reason"]
    assert (im["from"] or {}).get("kind") == "production"                                    # the image plan leaves it alone: never generated
    assert not (tmp_path / "st" / "assets").exists() or not list((tmp_path / "st" / "assets").iterdir())
    assert res["placed"] == 0 and len(res["picker"]["not_reachable"]) == 5
    logs = json.dumps([f.log, res["picker"], json.loads((tmp_path / "st" / "production.json").read_text())])
    assert "/out/" not in logs                                                               # the host only, never a location's path


def test_streamed_bytes_past_the_cap_are_refused(tmp_path, pics):
    big = Resp(200, b"\x89PNG" + b"0" * 5000, {"Content-Type": "image/png"})   # no Content-Length: counted while streamed
    f = fetcher(png_server(pics, lambda p: big), file_max=1000)
    path, why = f.get(f"https://{HOST}/out/a.png", "0" * 64, tmp_path / "a.png", [HOST])
    assert path is None and "over the 0 MB cap" in why and not (tmp_path / "a.png").exists() and not (tmp_path / "a.png.part").exists()


def test_a_same_host_redirect_is_followed(tmp_path, pics):
    story = pics["story"]
    hx = hashlib.sha256(story).hexdigest()

    def over(p):
        if p == "/moved":
            return Resp(307, b"", {"Location": f"https://{HOST}/out/sha256:{hx}"})
        return None
    f = fetcher(png_server(pics, over))
    path, why = f.get(f"https://{HOST}/moved", hx, tmp_path / "s.png", [HOST])
    assert why is None and path.read_bytes() == story


@pytest.mark.parametrize("ip", ["10.0.0.5", "127.0.0.1", "169.254.169.254", "192.168.1.2", "::1", "100.64.0.1", "::ffff:10.0.0.1"])
def test_a_host_dripping_bytes_is_cut_off_at_the_total_deadline(tmp_path):
    """A host sending one byte every 19 s never trips a per-read timeout; the fetch's own deadline (20 s, all reads together) does. The
    socket's timeout is set before each read to the time left, and only what has arrived is read (read1)."""
    now = [0.0]
    timeouts, reads = [], []

    class Drip(Resp):
        def read1(self, n=-1):
            reads.append(n)
            now[0] += 19.0   # each byte takes 19 s to come
            return b"\x89"

        def read(self, n=-1):
            raise AssertionError("read() waits for a whole chunk: the stream must use read1()")

        def settimeout(self, t):
            timeouts.append(round(t, 3))
    f = fetcher(lambda h, ip, path, timeout: Drip(200, b"", {"Content-Type": "image/png"}), clock=lambda: now[0])
    path, why = f.get(f"https://{HOST}/out/a.png", "0" * 64, tmp_path / "a.png", [HOST])
    assert path is None and why.endswith("timed out") and len(reads) == 2 and now[0] <= 40.0
    assert timeouts == [20.0, 1.0] and not (tmp_path / "a.png.part").exists()


def test_an_attempt_counts_toward_the_file_cap_even_when_it_fails(tmp_path, pics):
    f = fetcher(png_server(pics, lambda p: Resp(404)), files_max=2)
    for _ in range(2):
        assert "expired or gone" in f.get(f"https://{HOST}/out/x.png", "0" * 64, tmp_path / "x.png", [HOST])[1]
    assert "file fetch cap" in f.get(f"https://{HOST}/out/x.png", "0" * 64, tmp_path / "x.png", [HOST])[1]


@pytest.mark.parametrize("ip", ["64:ff9b::a00:1", "64:ff9b::5db8:d822", "64:ff9b:1::1", "::a00:1", "::5db8:d822", "::", "2002:a00:1::1"])
def test_nat64_ipv4_compatible_and_6to4_private_forms_are_refused(ip):
    assert pp.is_public(ip) is False


def test_public_addresses_still_pass():
    assert pp.is_public("93.184.216.34") and pp.is_public("2606:2800:220:1:248:1893:25c8:1946") and pp.is_public("2002:5db8:d822::1")


def test_a_private_address_is_refused(tmp_path, pics, ip):
    op = png_server(pics)
    f = fetcher(op, resolver=lambda h: [ip])
    path, why = f.get(f"https://{HOST}/out/x.png", "0" * 64, tmp_path / "x.png", [HOST])
    assert path is None and "private or reserved" in why and op.calls == []


def test_hosts_off_the_allow_list_or_the_document_and_other_schemes_are_refused(tmp_path, pics):
    op = png_server(pics)
    f = fetcher(op)
    assert "not on the fetch allow-list" in f.get("https://other.invalid/x.png", "0" * 64, tmp_path / "x", ["other.invalid"])[1]
    assert "not among the document's own locations" in f.get(f"https://{HOST}/x.png", "0" * 64, tmp_path / "x", ["other.invalid"])[1]
    assert "not an https" in f.get(f"http://{HOST}/x.png", "0" * 64, tmp_path / "x", [HOST])[1]
    assert "port" in f.get(f"https://{HOST}:8443/x.png", "0" * 64, tmp_path / "x", [HOST])[1]
    assert op.calls == []


def test_the_run_file_cap(tmp_path, pics):
    f = fetcher(png_server(pics), files_max=1)
    d = _deck()
    res = pp.run(d, pp.Source(clan(tmp_path)), tmp_path / "st", fetch=True, fetcher=f)
    assert res["placed"] == 2 and any("file fetch cap" in n["reason"] for n in res["picker"]["not_reachable"])


# ---------------------------------------------------------------- source order and the importer's checks

def test_embedded_first_then_https_then_the_zip(tmp_path, pics):
    op = png_server(pics)
    d = _deck()
    res = pp.run(d, pp.Source(clan(tmp_path, embed=("master", "story"))), tmp_path / "a", fetch=True, fetcher=fetcher(op))
    src_of = {p["key"]: p["from"] for p in res["picker"]["picks"]}
    assert src_of[MASTER] == "embedded" and src_of[mb.S_STORY] == "embedded" and src_of[mb.S_SIX] == "https"
    assert {c[2] for c in op.calls} == {f"/out/sha256:{hashlib.sha256(pics[n]).hexdigest()}" for n in ("six", "f1")}
    # a damaged embedded copy falls through to the next source, with the reason kept only if nothing else yields it
    d2 = _deck()
    res2 = pp.run(d2, pp.Source(clan(tmp_path, name="flip.clan", embed=("master",), flip="master")), tmp_path / "b", fetch=True, fetcher=fetcher(png_server(pics)))
    assert {p["key"]: p["from"] for p in res2["picker"]["picks"]}[MASTER] == "https"
    # the export zip: its inner .clan, then (no fetch) its assets/
    bundle = tmp_path / "b.zip"
    mb.build(bundle)
    d3 = _deck()
    res3 = pp.run(d3, pp.Source(bundle), tmp_path / "c")
    assert {p["from"] for p in res3["picker"]["picks"]} == {"zip"} and res3["placed"] == 5


def test_mock_refused_forged_rights_ignored_rights_to_supply_never_placed(tmp_path):
    master = "sha256:" + hashlib.sha256(mb.draw(*mb.PICTURES["master"])).hexdigest()

    def forge(d):
        for a in d["assets"].values():
            if a.get("origin") == "uploaded":
                a["rights"] = "licensed"
        d["assets"][master].update(origin="mock", rights="generated")
    d = _deck()
    st = tmp_path / "st"
    res = pp.run(d, pp.Source(clan(tmp_path, mutate=forge, embed=("master", "upload_master", "story", "old_story"))), st)
    prod = json.loads((st / "production.json").read_text())
    assert MASTER not in prod["items"] and any("mock" in r["reason"] for r in prod["refused"]) and prod["warnings"]
    im = _im(d, "s1")   # the upload-made set's key visual: picked, waits for its rights, never placed, never pulled
    assert im["status"] == "empty" and im["reason"].startswith(spec.RIGHTS_TO_SUPPLY) and f"{mb.FSET_OLD}#master" not in prod["items"]
    assert "waiting for rights" in res["card"]


def test_images_only_and_the_aspect_tolerance_hold(tmp_path):
    def wide(d):   # every OOH and print size made 8:1: none may land in the 4:5 poster slot
        for s in d["sizes"].values():
            if s["format"]["pack_id"] in ("ooh-uk-ie", "lumen-own"):
                s["aspect"] = {"w": 8, "h": 1}
    d = _deck()
    res = pp.run(d, pp.Source(clan(tmp_path, mutate=wide)), tmp_path / "st")
    assert _im(d, "s4")["status"] == "empty" and "No Production size fits" in _im(d, "s4")["reason"]
    assert all(p["key"] != mb.S_FILM for p in res["picker"]["picks"])                        # the video size is never picked


# ---------------------------------------------------------------- P5 the optional look

def test_the_look_only_flags_and_exempts_a_sizes_own_branding(tmp_path):
    answers = {"brand": {"subject_fits": True, "subject": "a tap", "logos_or_brands": ["Acme"], "readable_text": []}}
    asked = []

    def ollama(jpeg, q):
        asked.append(q)
        return answers["brand"]
    d = _deck()
    res = pp.run(d, pp.Source(clan(tmp_path, embed=("master", "story", "six", "f1"))), tmp_path / "st", look=True,
                 look_fns={"ollama": ollama, "haiku": lambda j, q: (_ for _ in ()).throw(AssertionError("haiku")), "zone": lambda p, focal=None: {"zone": "tl"}})
    assert len(asked) == 4
    assert _im(d, "s1")["status"] == "flagged" and "a brand may show: Acme" in _im(d, "s1")["reason"]   # key visual: flagged, still placed
    assert _im(d, "s5")["status"] == "flagged"                                                       # storyboard frame
    assert _im(d, "s3")["status"] == "made"                                                          # a typed size's branding is expected
    assert res["placed"] == 5 and res["usage"]["look"] is None                                       # local: free


def test_the_look_falls_back_to_haiku_and_flags_no_calm_zone(tmp_path):
    calls = []

    def haiku(jpeg, q):
        calls.append(q)
        return {"subject_fits": False, "subject": "a car", "logos_or_brands": [], "readable_text": []}, {"model": "claude-haiku-4-5-20251001", "prompt_tokens": 800, "completion_tokens": 40, "calls": 1}
    d = _deck()
    res = pp.run(d, pp.Source(clan(tmp_path, embed=("master",))), tmp_path / "st", look=True,
                 look_fns={"ollama": lambda j, q: None, "haiku": haiku, "zone": lambda p, focal=None: {"none": True}})
    assert len(calls) == 1 and res["usage"]["look"]["calls"] == 1
    r = _im(d, "s1")["reason"]
    assert "may not suit the slide" in r and "no calm zone" in r and _im(d, "s1")["asset"]                # flagged, never removed


def test_the_look_is_capped(tmp_path, monkeypatch):
    monkeypatch.setattr(pp, "LOOK_MAX", 1)
    d = _deck()
    res = pp.run(d, pp.Source(clan(tmp_path, embed=("master", "story"))), tmp_path / "st", look=True,
                 look_fns={"ollama": lambda j, q: None, "haiku": lambda j, q: (None, None), "zone": lambda p, focal=None: {}})
    rows = res["picker"]["look"]["rows"]
    assert rows[0]["by"] == "not checked" and "cap" in rows[-1]["note"]


# ---------------------------------------------------------------- the card and run_deck

def test_the_card_line_is_printed_and_costs_nothing():
    card = {"kind": "drafts", "id": "c_0", "rows": [], "usd": 0, "spent_usd": 0, "cap_usd": 2.5, "left_usd": 2.5, "production": "Production: 3 picked, 1 not reachable"}
    assert "Production: 3 picked, 1 not reachable (no cost)" in imagegen.render_card(card)


@pytest.fixture()
def clan_stages(tmp_path, demo_stages):
    st = tmp_path / "stages"
    shutil.copytree(demo_stages, st)
    return st


def test_run_deck_takes_a_clan_spends_nothing_and_reports_the_picker(tmp_path, clan_stages, build_demo):
    c = clan(tmp_path, embed=("master",))
    run = build_demo(clan_stages, tmp_path / "a", "--production", str(c), "--no-layout-plan")
    rep = json.loads((run / "report.json").read_text())
    pr = rep["production"]
    assert pr["usd"] == 0 and rep.get("usd_total", 0) == 0 and pr["card"].startswith("Production: ")
    assert pr["picker"]["source"]["kind"] == "clan" and pr["picker"]["fetch"]["on"] is False
    deck = json.loads((run / "deck.json").read_text())
    assert deck["meta"]["production"]["how"] == "clan"
    assert (clan_stages / "production_inventory.json").is_file() and (clan_stages / "production.json").is_file()
    kinds = {(im.get("from") or {}).get("kind") for _, _, im in images.image_slots(deck)}
    assert "production" in kinds


def test_run_deck_refuses_fetch_flags_without_a_file_and_a_bad_file(tmp_path, clan_stages, build_demo):
    with pytest.raises(SystemExit):
        build_demo(clan_stages, tmp_path / "a", "--production", "--production-fetch")
    (tmp_path / "bad.clan").write_bytes(b"not a zip")
    with pytest.raises(SystemExit, match="not a CLAN file"):
        build_demo(clan_stages, tmp_path / "b", "--production", str(tmp_path / "bad.clan"))


def test_importing_the_picker_loads_no_provider_module():
    path = [str(HERE.parents[1])] + [p for p in sys.path if p and os.path.isdir(p)]
    code = (f"import sys; sys.path[:0] = {path!r}; import deck.prod_picker; "
            "bad = [m for m in sys.modules if m.split('.')[0] in ('anthropic', 'openai', 'requests', 'httpx', 'urllib3', 'brief_llm') "
            "or m.endswith(('runway', 'guard', 'ollama')) or m.startswith('visuals') or m in ('deck.imagegen', 'deck.stages')]; assert not bad, bad")
    r = subprocess.run([sys.executable, "-I", "-c", code], cwd=HERE.parents[1], capture_output=True, text=True, env={"PATH": "/usr/bin:/bin"})
    assert r.returncode == 0, r.stderr


# ---------------------------------------------------------------- P6 a person's swap, and what the app reads

def _deck6():
    """_deck with the engine's own slide ids (s01 ...): a swap and the app's schema name slides sNN."""
    d = _deck()
    ren = {sid: f"s{int(sid[1:]):02d}" for sid in d["order"]}
    return {"meta": d["meta"], "order": [ren[x] for x in d["order"]], "slides": {ren[k]: v for k, v in d["slides"].items()}}


def test_a_persons_swap_wins_among_the_slots_candidates_and_is_recorded_in_the_stages(tmp_path):
    twin = mb.uid("size", 9)   # a second 9:16 social size, flagged in Production: a candidate, never the rule's pick

    def mut(d):
        d["sizes"][twin] = {**copy.deepcopy(d["sizes"][mb.S_STORY]), "id": twin, "status": "look"}
    src = pp.Source(clan(tmp_path, mutate=mut, embed=("story", "master")))
    st = tmp_path / "st"
    d = _deck6()
    res = pp.run(d, src, st, choices={"s03.picture": {"key": twin, "by": "You", "at": "2026-11-18T10:00:00Z"}})
    pk = {p["slot"]: p for p in res["picker"]["picks"]}
    assert pk["s03.picture"]["key"] == twin and pk["s03.picture"]["by"] == "person" and _im(d, "s03")["from"]["key"] == twin
    assert _im(d, "s03")["status"] == "flagged"                                                     # Production's own flag still shows
    assert {t["key"] for t in pk["s03.picture"]["eligible"]} >= {mb.S_STORY, twin}                  # the rule's pick and the other fits
    assert all({"key", "label", "reach", "rights", "status"} <= set(t) for t in pk["s03.picture"]["eligible"])
    rec = json.loads((st / pp.CHOICES_FILE).read_text())
    assert rec["choices"]["s03.picture"]["key"] == twin
    d2 = _deck6()   # a later build with no new swap keeps the recorded one
    res2 = pp.run(d2, src, st)
    assert {p["slot"]: p["by"] for p in res2["picker"]["picks"]}["s03.picture"] == "person" and _im(d2, "s03")["from"]["key"] == twin


def test_swaps_are_cleared_when_the_production_file_changes_and_stale_ones_are_not_kept(tmp_path):
    twin = mb.uid("size", 9)

    def mut(d):
        d["sizes"][twin] = {**copy.deepcopy(d["sizes"][mb.S_STORY]), "id": twin, "status": "look"}
    st = tmp_path / "st"
    a = pp.Source(clan(tmp_path, name="a.clan", mutate=mut, embed=("story",)))
    pp.run(_deck6(), a, st, choices={"s03.picture": {"key": twin, "by": "You", "at": "t"}, "s01.picture": {"key": mb.F2, "by": "You", "at": "t"}})
    rec = json.loads((st / pp.CHOICES_FILE).read_text())
    assert set(rec["choices"]) == {"s03.picture"} and rec["clan_sha256"] == a.clan_sha256   # a frame is no candidate for the cover: dropped

    def mut_b(d):
        mut(d)
        d["project"]["title"] = "Lumen Water relaunch (invented)"   # another Production file
    b = pp.Source(clan(tmp_path, name="b.clan", mutate=mut_b, embed=("story",)))
    d = _deck6()
    res = pp.run(d, b, st)
    assert {p["slot"]: p["by"] for p in res["picker"]["picks"]}["s03.picture"] == "rule" and _im(d, "s03")["from"]["key"] == mb.S_STORY
    assert json.loads((st / pp.CHOICES_FILE).read_text()) == {"stage": "production_choices", "produced_by": "a person's swaps in the Production picker (P6)",
                                                               "clan_sha256": b.clan_sha256, "choices": {}}


def test_a_swap_to_a_key_that_is_not_a_candidate_is_ignored_with_a_note(tmp_path):
    d = _deck6()
    res = pp.run(d, pp.Source(clan(tmp_path, embed=("story",))), tmp_path / "st", choices={"s03.picture": {"key": mb.F2, "by": "You", "at": "t"}})
    pk = {p["slot"]: p for p in res["picker"]["picks"]}["s03.picture"]
    assert pk["key"] == mb.S_STORY and pk["by"] == "rule" and "does not fit this slot" in pk["note"]


def test_a_swap_to_a_picture_waiting_for_its_rights_is_held_never_placed(tmp_path):
    old = f"{mb.FSET_OLD}#master"
    d = _deck6()
    res = pp.run(d, pp.Source(clan(tmp_path, embed=("master", "upload_master"))), tmp_path / "st",
                 choices={"s01.picture": {"key": old, "by": "You", "at": "t"}})
    assert _im(d, "s01")["status"] == "empty" and _im(d, "s01")["reason"].startswith(spec.RIGHTS_TO_SUPPLY) and _im(d, "s02")["status"] == "made"
    assert {p["slot"]: p["from"] for p in res["picker"]["picks"]}["s01.picture"] == "rights" and "waiting for rights" in res["card"]


def test_the_apps_review_production_reads_as_choices():
    rv = {"production": {"s11": {"picture": {"key": mb.S_SIX, "by": "You", "at": "t"}}, "bad": {"picture": {"key": mb.S_SIX}}, "s12": {"x": {"key": "no"}}}}
    assert pp.choices_from_review(rv) == {"s11.picture": {"key": mb.S_SIX, "by": "You", "at": "t"}}
    assert pp.choices_from_review({"production": "junk"}) == {} and pp.choices_from_review(None) == {}


def test_the_payload_gives_the_app_the_picker_without_a_location(tmp_path):
    from deck import run_state
    d = _deck6()
    res = pp.run(d, pp.Source(clan(tmp_path, embed=("master",))), tmp_path / "st")
    pv = run_state.production_payload({"production": {"picker": res["picker"], "card": res["card"]}})
    assert pv["card"] == res["card"] and pv["fetch"] == {"on": False, "allow_list_empty": True} and pv["look"] == {"on": False}
    assert {p["slot"] for p in pv["picks"]} == {"s01.picture", "s02.picture", "s03.picture", "s04.picture", "s05.picture"}
    assert "/out/" not in json.dumps(pv) and "log" not in json.dumps(pv["fetch"])
    assert run_state.production_payload({}) is None
    schema = json.loads((HERE.parents[2] / "app" / "templates" / "deck-maker" / "schema.json").read_text())
    jsonschema = pytest.importorskip("jsonschema")
    jsonschema.validate({"production": pv}, schema)


def test_run_deck_takes_a_production_pick(tmp_path, clan_stages, build_demo):
    c = clan(tmp_path, embed=("master",))
    with pytest.raises(SystemExit):
        build_demo(clan_stages, tmp_path / "x", "--production", str(c), "--production-pick", "nope")
    run = build_demo(clan_stages, tmp_path / "a", "--production", str(c), "--production-pick", f"s99.picture={mb.S_SIX}", "--no-layout-plan")
    rec = json.loads((clan_stages / pp.CHOICES_FILE).read_text())
    assert rec["clan_sha256"] == hashlib.sha256(c.read_bytes()).hexdigest() and "s99.picture" not in rec["choices"]   # no such slot: not kept
    assert json.loads((run / "report.json").read_text())["production"]["picker"]


# ---------------------------------------------------------------- the runner keeps the deck's Production file and passes it on every build

def _srv(tmp_path):
    from deck import server as srv
    cfg = srv.Settings({"NAPKIN_DECK_DATA": str(tmp_path / "runs"), "NAPKIN_DECK_PORT": "0", "NAPKIN_DECK_REPLAY": str(HERE / "fixtures" / "fernley" / "stages")})
    return srv, cfg, srv.Server(cfg)


def test_the_engine_server_keeps_a_production_file_by_its_hash(tmp_path):
    import base64
    srv, cfg, s = _srv(tmp_path)
    c = clan(tmp_path, embed=("master",))
    raw = c.read_bytes()
    got = s.production({"doc": "doc1", "name": "lumen.clan", "data_b64": base64.b64encode(raw).decode()})
    hx = hashlib.sha256(raw).hexdigest()
    assert got["sha256"] == hx and got["kind"] == "clan" and got["rows"] >= 12 and got["eligible"] == 12
    assert (cfg.data / "doc1" / "production" / f"{hx}.clan").read_bytes() == raw
    assert not [p for p in (cfg.data / "doc1" / "production").iterdir() if p.name.startswith(".")]   # no part file left
    bundle = tmp_path / "b.zip"
    mb.build(bundle)
    assert s.production({"doc": "doc1", "name": "export.zip", "data_b64": base64.b64encode(bundle.read_bytes()).decode()})["kind"] == "zip"


@pytest.mark.parametrize("body,kind", [
    ({"doc": "doc1", "name": "brief.pdf", "data_b64": "eA=="}, "bad_production"),
    ({"doc": "doc1", "name": "a/b.clan", "data_b64": "eA=="}, "bad_production"),
    ({"doc": "doc1", "name": "x.clan", "data_b64": "not base64!"}, "bad_production"),
    ({"doc": "doc1", "name": "x.clan", "data_b64": "eA=="}, "bad_production"),          # one byte: not a CLAN file
    ({"doc": "../up", "name": "x.clan", "data_b64": "eA=="}, "bad_doc"),
])
def test_the_engine_server_refuses_anything_but_a_readable_production_file(tmp_path, body, kind):
    srv, cfg, s = _srv(tmp_path)
    with pytest.raises(srv.Refused) as e:
        s.production(body)
    assert e.value.kind == kind
    assert not list((cfg.data / "doc1" / "production").glob("*")) if (cfg.data / "doc1" / "production").exists() else True


def test_a_malformed_document_is_a_clear_refusal_and_leaves_no_file(tmp_path):
    import base64
    import io
    import zipfile
    srv, cfg, s = _srv(tmp_path)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("shared/data.yaml", "contract_version: '3'\napp: production-tool\nproject: {id: [unclosed\n")
    with pytest.raises(srv.Refused) as e:
        s.production({"doc": "doc1", "name": "bad.clan", "data_b64": base64.b64encode(buf.getvalue()).decode()})
    assert e.value.status == 400 and e.value.kind == "bad_production" and "could not be read" in e.value.message
    assert list((cfg.data / "doc1" / "production").iterdir()) == []


def test_each_document_keeps_at_most_its_newest_production_files(tmp_path, monkeypatch):
    import base64
    import os
    srv, cfg, s = _srv(tmp_path)
    monkeypatch.setattr(srv, "PRODUCTION_KEEP_FILES", 2)
    shas = []
    for i in range(3):
        c = clan(tmp_path, name=f"v{i}.clan", mutate=lambda d, i=i: d["project"].update(title=f"Lumen v{i} (invented)"))
        shas.append(s.production({"doc": "doc1", "name": c.name, "data_b64": base64.b64encode(c.read_bytes()).decode()})["sha256"])
        p = cfg.data / "doc1" / "production" / f"{shas[-1]}.clan"
        os.utime(p, (1_000_000 + i, 1_000_000 + i))   # distinct times: the order the files came in
    kept = {p.stem for p in (cfg.data / "doc1" / "production").iterdir()}
    assert kept == set(shas[1:])                                                           # the oldest went
    monkeypatch.setattr(srv, "PRODUCTION_KEEP_FILES", 5)
    monkeypatch.setattr(srv, "PRODUCTION_KEEP_BYTES", 1)                                   # bytes: only the newest stays
    c = clan(tmp_path, name="v9.clan", mutate=lambda d: d["project"].update(title="Lumen v9 (invented)"))
    last = s.production({"doc": "doc1", "name": c.name, "data_b64": base64.b64encode(c.read_bytes()).decode()})["sha256"]
    assert {p.stem for p in (cfg.data / "doc1" / "production").iterdir()} == {last}


def test_the_engine_server_refuses_a_file_over_the_cap(tmp_path, monkeypatch):
    import base64
    srv, cfg, s = _srv(tmp_path)
    monkeypatch.setattr(srv, "PRODUCTION_MAX", 10)
    with pytest.raises(srv.Refused) as e:
        s.production({"doc": "doc1", "name": "x.clan", "data_b64": base64.b64encode(b"x" * 11).decode()})
    assert e.value.status == 413


def test_every_build_runs_with_the_production_file_its_opt_ins_and_the_swaps(tmp_path, monkeypatch):
    import base64
    srv, cfg, s = _srv(tmp_path)
    c = clan(tmp_path, embed=("master",))
    hx = s.production({"doc": "doc", "name": "lumen.clan", "data_b64": base64.b64encode(c.read_bytes()).decode()})["sha256"]
    d = srv.Doc(cfg.data / "doc", "doc")
    d.folder = cfg.data / "doc" / "k"
    seen = []
    monkeypatch.setattr(srv.run_deck, "main", lambda argv: seen.append(list(argv)) or {})
    base = {"prompt": {"text": "A pitch for Lumen Water", "client": "Lumen Water", "project": "P", "agency": ""}, "kind": "agency", "format": "pitch"}
    swaps = {"s11": {"picture": {"key": mb.S_SIX, "by": "You", "at": "t"}}}
    req = srv.validate_request({"doc": "doc", "inputs": {**base, "production": {"sha256": hx, "fetch": True, "look": False}}, "mode": "replay",
                                "render": True, "review": {"production": swaps}}, cfg)
    s.call_engine(d, req, None)
    argv = seen[0]
    assert Path(argv[argv.index("--production") + 1]).read_bytes() == c.read_bytes()
    assert "--production-fetch" in argv and "--production-look" not in argv
    assert json.loads(Path(argv[argv.index("--review") + 1]).read_text()) == {"production": swaps}
    plain = srv.validate_request({"doc": "doc", "inputs": base, "mode": "replay", "render": True}, cfg)
    s.call_engine(d, plain, None)
    assert not {"--production", "--production-fetch", "--production-look", "--review"} & set(seen[1])   # opt-in: nothing without a file
    inv = srv.validate_request({"doc": "doc", "inputs": {**base, "kind": "investor", "production": {"sha256": hx}}, "mode": "replay", "render": True}, cfg)
    s.call_engine(d, inv, None)
    assert "--production" not in seen[2]                                                       # an investor deck has no campaign pictures
    gone = srv.validate_request({"doc": "doc", "inputs": {**base, "production": {"sha256": "cd" * 32}}, "mode": "replay", "render": True}, cfg)
    with pytest.raises(srv.Refused) as e:
        s.call_engine(d, gone, None)
    assert e.value.kind == "production_missing" and len(seen) == 3
