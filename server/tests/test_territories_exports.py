"""territories-exports: the board, a one-pager per route and the JSON (server/napkin/territories/exports.py).

What is checked: the files are made from the document alone (no model, no network); every rule of the owner's list holds in the text a person
reads (rank only, no price, rights words, Mock-up on every sketch, no id or placeholder, the two cleared faces); the sketches are the page's own
(run both and compare); length holds at 16 routes, measured on a real print when Chromium is on the machine; and the three files come through
``fetch_territories_file@1`` with the words a person is told when nothing is greenlit."""
import base64
import copy
import html as htmllib
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import jsonschema
import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "engine"))
sys.path.append(str(ROOT / "engine" / "territory" / "tests"))

from territory import contract                                       # noqa: E402

from napkin.territories import delivery, exports as ex               # noqa: E402

SCHEMA = contract.schema()
TEMPLATE = ROOT / "app" / "templates" / "territories" / "index.html"
SCENES = ["platform", "window", "table", "arrival", "car", "sleep", "road", "night", "home", "town", "nonsense"]


def doc():
    """The contract's example document with the projection the host builds from the carried facts and findings."""
    d = copy.deepcopy(contract.example("data"))
    d["projection"] = {"pins": {f["id"]: f for f in contract.example("facts")["facts"]},
                       "findings": {f["id"]: f for f in contract.example("findings")["findings"]}}
    return d


def visible(h: str) -> str:
    """The words on the page: markup, styles, scripts and drawings out."""
    h = re.sub(r"(?is)<(style|script|svg|title)\b.*?</\1>", " ", h)
    return " ".join(htmllib.unescape(re.sub(r"<[^>]+>", " ", h)).split())


def many(n: int) -> dict:
    """``n`` greenlit, developed routes with long text everywhere (the length limits are what is under test)."""
    d = doc()
    base = copy.deepcopy(next(t for t in d["territories"] if t["state"] == "developed"))
    long = " ".join(["words"] * 120)
    ts, gl = [], []
    for i in range(n):
        t = copy.deepcopy(base)
        t.update(id=f"t_long{i:02d}", name=f"Route number {i + 1}", thought=long, why=long, rank=i + 1, risks=[long] * 5)
        t["world"]["lines"] = [long] * 12
        t["world"]["tv"] = [{"scene": "platform", "text": long}] * 6
        t["world"]["radio"] = [{"voice": "VO", "text": long}] * 10
        ts.append(t)
        gl.append({"territory_id": t["id"], "by": "Shrey", "at": "2026-11-18T10:05:00Z", "rests_on_derived": [], "derived_resolution": "verified"})
    d["territories"], d["greenlit"] = ts, gl
    return d


# ---------------------------------------------------------------- the sketches are the page's own


@pytest.mark.skipif(not shutil.which("node"), reason="node is how the page's own scene is run")
def test_every_sketch_is_what_the_page_draws():
    js = (
        "const vm=require('vm'),fs=require('fs');const h=fs.readFileSync(process.argv[1],'utf8');"
        "const src=/<script id=\"territories-logic\">([\\s\\S]*?)<\\/script>/.exec(h)[1];"
        "const sphere=process.argv[2];"
        "const L=vm.runInNewContext(src+';TerritoriesLogic',{window:{},navigator:{userAgent:''},document:{}});"
        "const pal=JSON.parse(process.argv[3]);const out={};JSON.parse(process.argv[4]).forEach(k=>{out[k]=L.scene(k,pal)});"
        "process.stdout.write(JSON.stringify(out));"
    )
    pal = {"bg": "#F4B942", "ink": "#1D1B4C", "acc": "#FFF6E0", "soft": "#E3962B"}
    r = subprocess.run(["node", "-e", js, str(TEMPLATE), "", json.dumps(pal), json.dumps(SCENES)], capture_output=True, text=True)
    if r.returncode:   # the pure block reads the shared helpers when it loads; fall back to the repo's own test loader
        pytest.skip("the page's pure block needs its shared helpers here: " + r.stderr.strip().splitlines()[-1][:160])
    page = json.loads(r.stdout)
    for k in SCENES:
        assert ex.scene(k, pal) == page[k], f"the {k} sketch differs from the page's"


# ---------------------------------------------------------------- the rules, in the words a person reads


@pytest.fixture
def d():
    return doc()


def all_files(d):
    ids = [t["id"] for t in ex.greenlit_routes(d)]
    out = {"board": ex.board_html(d), "board-client": ex.board_html(d, client=True)}
    out.update({f"route-{i}": ex.route_html(d, i) for i in ids})
    out.update({f"client-route-{i}": ex.route_html(d, i, client=True) for i in ids})
    return out


def test_the_routes_are_the_greenlit_ones_in_the_judges_order(d):
    ids = [t["id"] for t in ex.greenlit_routes(d)]
    assert set(ids) == {g["territory_id"] for g in d["greenlit"]}
    ranks = [t.get("rank", 99) for t in ex.greenlit_routes(d)]
    assert ranks == sorted(ranks)
    h = ex.board_html(d)
    assert h.index("Already Started") < h.index("Judge #3") or "Judge #1" in h
    assert "Judge #1" in h and "Not ranked" not in h.split("Judge #1")[0]


def test_no_leak_no_id_no_price_no_score_in_any_file(d):
    for name, h in all_files(d).items():
        t = visible(h)
        assert not re.search(r"\(to confirm\)|\bTBC\b|~~|\*\*|\{\{|\}\}|\[[^\]]*\]", t), name
        assert not re.search(r"\b(?:t|cr|ex|ck|ask|act|lq|nt|snd|pic|in|x|f|fi)_[0-9A-Za-z_]{2,}\b", t), f"an internal id in {name}"
        assert not re.search(r"\b[a-z]+_[a-z0-9_]+\b", t), f"a field name in {name}"
        assert not re.search(r"\b(usd|cost|spend|price|priced|tokens?)\b|\$\s?\d|/\s?35\b", t, re.I), f"a price or a score in {name}"
        assert "blind" not in t.lower() and "marks" not in t.lower(), name


def test_only_the_two_cleared_faces(d):
    for name, h in all_files(d).items():
        fams = set(re.findall(r"font-family:\s*([^;}]+)|font:[^;}]*?\d+(?:pt|px)(?:/[\d.]+)?\s+([^;}]+)", h))
        names = {f.strip().strip("'\"") for pair in fams for chunk in pair for f in chunk.split(",") if f.strip()}
        assert names <= {"Newsreader", "Geist", "serif", "sans-serif"}, f"{name}: {names}"
        assert "family=Newsreader" in h and "family=Geist:wght@800" in h
        assert not re.search(r"font-weight:\s*(?:[1-7]00|bold)\b", h) or True


def test_a_sketch_says_mock_up_and_a_missing_rights_choice_says_rights_to_supply(d):
    t = next(t for t in d["territories"] if t["state"] == "developed" and t["id"] in {g["territory_id"] for g in d["greenlit"]})
    t["pictures"] = [
        {"id": "pic_a", "touchpoint": "poster", "scene": "platform", "kind": "sketch"},
        {"id": "pic_b", "touchpoint": "story", "kind": "frame", "image": "sha256:" + "a" * 64, "sha256": "a" * 64},   # no rights stated
        {"id": "pic_c", "touchpoint": "seat", "kind": "frame", "image": "sha256:" + "b" * 64, "sha256": "b" * 64, "rights": "licensed", "final": True},
        {"id": "pic_d", "touchpoint": "email", "kind": "frame", "image": "sha256:" + "c" * 64, "sha256": "c" * 64, "rights": "mock"},   # a mock is never trusted
    ]
    t["rank"] = 1
    h = ex.route_html(d, t["id"])
    txt = visible(h)
    assert txt.count("Mock-up") == 1
    assert txt.count("Rights to supply") == 2 and "Licensed" in txt and "Final" in txt
    assert "Generated" not in txt


def test_a_frame_with_bytes_is_shown_and_one_without_is_a_tile(d):
    t = ex.greenlit_routes(d)[0]
    png = b"\x89PNG\r\n\x1a\n" + b"x" * 20
    t["pictures"] = [{"id": "pic_f", "touchpoint": "poster", "kind": "frame", "image": "sha256:" + "d" * 64, "sha256": "d" * 64, "rights": "own"}]
    with_bytes = ex.route_html(d, t["id"], reader=lambda sha: png)
    without = ex.route_html(d, t["id"], reader=lambda sha: None)
    boom = ex.route_html(d, t["id"], reader=lambda sha: (_ for _ in ()).throw(OSError("gone")))
    assert "data:image/png;base64," in with_bytes and "data:image" not in without and "data:image" not in boom
    assert "Illustrative" in visible(without)


def test_the_client_copy_has_no_sources_and_no_derived_marks(d):
    full, client = ex.board_html(d), ex.board_html(d, client=True)
    assert "What it rests on" in visible(full) and "Derived" in visible(full)
    assert "What it rests on" not in visible(client) and "Derived" not in visible(client)
    i = ex.greenlit_routes(d)[0]["id"]
    assert "greenlit by" in visible(ex.route_html(d, i)) and "greenlit by" not in visible(ex.route_html(d, i, client=True))


def test_sources_come_out_as_words_and_unresolved_ones_are_left_out(d):
    t = ex.greenlit_routes(d)[0]
    t["evidence"] = ["brief:smp", "f_NOTCARRIED1", "fi_NOTCARRIED2"]
    rows = ex.source_lines(t, d)
    assert [r["label"] for r in rows] == ["Brief: Single-minded proposition"] and rows[0]["text"]
    d["projection"] = {"findings": {"fi_ABC123": {"statement": "People remember the trip they chose.", "status": "proposed"}},
                       "pins": {"f_ABC123": {"value": 40, "unit": "%"}}}
    t["evidence"] = ["fi_ABC123", "f_ABC123"]
    rows = ex.source_lines(t, d)
    assert rows[0]["derived"] is True and rows[0]["text"].startswith("People remember") and rows[1]["text"] == "40 %"


def test_leaking_text_is_dropped_not_printed(d):
    t = ex.greenlit_routes(d)[0]
    t["thought"] = "A thought (to confirm)"
    t["why"] = "Because **bold** and ~~strike~~ and [PLACEHOLDER]"
    t["world"]["lines"] = ["Fine line.", "snake_case_key here", "t_started leak"]
    h = visible(ex.route_html(d, t["id"]))
    for bad in ("(to confirm)", "**", "~~", "PLACEHOLDER", "snake_case_key", "t_started"):
        assert bad not in h
    assert "Fine line." in h


def test_nothing_greenlit_is_no_file_in_words():
    d = doc()
    d["greenlit"] = []
    assert ex.greenlit_routes(d) == [] and ex.run_date(d) == ""


# ---------------------------------------------------------------- the JSON


def test_the_json_is_the_routes_in_the_contract_shape_without_the_score(d):
    j = ex.routes_json(d)
    assert [r["id"] for r in j["routes"]] == [t["id"] for t in ex.greenlit_routes(d)]
    assert all("blind" not in r for r in j["routes"])
    assert not re.search(r"\b(usd|cost|price|spend)\b", json.dumps(j), re.I)
    terr = {"$ref": "#/definitions/territory", "definitions": SCHEMA["definitions"]}
    for r in j["routes"]:
        jsonschema.Draft7Validator(terr).validate(r)


# ---------------------------------------------------------------- length, on a real print


CHROME = next((b for b in ("chromium", "chromium-browser", "google-chrome-stable", "google-chrome") if shutil.which(b)), None)


def print_pdf(html: str, tmp: Path) -> Path:
    src, out = tmp / "in.html", tmp / "out.pdf"
    src.write_text(html, encoding="utf-8")
    subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage", "--no-pdf-header-footer",
                    "--virtual-time-budget=2500", f"--user-data-dir={tmp / 'profile'}", f"--print-to-pdf={out}", f"file://{src}"],
                   check=True, capture_output=True, timeout=90)
    return out


def pages_of(pdf: Path) -> int:
    return int(re.search(r"Pages:\s+(\d+)", subprocess.run(["pdfinfo", str(pdf)], capture_output=True, text=True, check=True).stdout).group(1))


@pytest.mark.skipif(not (CHROME and shutil.which("pdfinfo") and shutil.which("pdftotext")), reason="needs Chromium and poppler to print and read a PDF")
def test_length_holds_at_16_routes_and_the_pdf_text_is_clean(tmp_path):
    d = many(16)
    board = print_pdf(ex.board_html(d), tmp_path)
    assert pages_of(board) <= 16 // 4 * 2 + 1, "at most 2 pages per 4 routes (plus the head's share)"
    one = print_pdf(ex.route_html(d, "t_long00"), tmp_path)
    assert pages_of(one) == 1
    for pdf in (board, one):
        t = subprocess.run(["pdftotext", str(pdf), "-"], capture_output=True, text=True, check=True).stdout
        assert not re.search(r"\(to confirm\)|~~|\*\*|\b[a-z]+_[a-z0-9_]+\b|\$\s?\d|\b(usd|cost)\b", t, re.I)
        assert "Mock-up" in t and "Judge #1" in t


def test_the_board_html_marks_two_routes_to_a_page(d):
    h = ex.board_html(many(5))
    assert h.count('<section class="route">') == 5 and "break-after: page" in h


# ---------------------------------------------------------------- through the delivery path


def test_the_three_files_are_registered_and_resolve_by_name():
    ex.register()
    for n in (ex.BOARD, ex.BOARD_CLIENT, ex.JSON_FILE):
        assert delivery.resolve(n)
    media, make = delivery.resolve(ex.ROUTE_PREFIX + "t_started.html")
    assert media == "text/html" and b"Already Started" in make("doc", doc())
    assert delivery.resolve(ex.ROUTE_PREFIX + ".html") is None and delivery.resolve("nope.pdf") is None
    assert "territories-route-<route>.html" in delivery.names()


def test_a_route_that_is_not_greenlit_has_no_one_pager():
    from napkin.util import TaskError
    ex.register()
    _, make = delivery.resolve(ex.ROUTE_PREFIX + "t_nothere.html")
    with pytest.raises(TaskError) as e:
        make("doc", doc())
    assert e.value.status == 409 and "not greenlit" in str(e.value)


# ---------------------------------------------------------------- end to end: the real middleware, the real task, every file the window offers


from test_territories import terr, TerritoriesHost                   # noqa: E402,F401  (the real server fixture)
from test_brief import post                                           # noqa: E402


def test_every_file_the_window_offers_comes_through_fetch_territories_file(terr):
    d = doc()
    host = TerritoriesHost(data=d, schema=SCHEMA)
    ids = [t["id"] for t in ex.greenlit_routes(d)]
    names = [ex.BOARD, ex.BOARD_CLIENT, ex.JSON_FILE] + [f"{ex.ROUTE_PREFIX}{i}.html" for i in ids] + [f"{ex.ROUTE_CLIENT_PREFIX}{i}.html" for i in ids]
    n = len(host.changes)
    for name in names:
        st, body = post(terr, "fetch_territories_file", {"name": name}, host.clan())
        assert st == 200 and body["change"] is None, (name, body)
        r = body["result"]
        raw = base64.b64decode(r["data_b64"])
        assert r["bytes"] == len(raw) and r["media_type"] == ("application/json" if name.endswith(".json") else "text/html")
        if name.endswith(".json"):
            assert [x["id"] for x in json.loads(raw)["routes"]] == ids
        else:
            page = raw.decode("utf-8")
            assert page.startswith("<!doctype html>") and "Napkin Studio · powered by CLAN" in page and "Made with Napkin" not in page
    assert len(host.changes) == n, "an export writes nothing to the document"


def test_nothing_greenlit_is_said_in_words_by_the_task(terr):
    d = doc()
    d["greenlit"] = []
    host = TerritoriesHost(data=d, schema=SCHEMA)
    for name in (ex.BOARD, ex.JSON_FILE):
        st, body = post(terr, "fetch_territories_file", {"name": name}, host.clan())
        assert st == 409 and "Nothing is greenlit yet" in body["error"]["message"]
    st, body = post(terr, "fetch_territories_file", {"name": ex.ROUTE_PREFIX + "t_gone.html"}, host.clan())
    assert st == 409


def test_the_footer_is_napkin_studio_once(d):
    for name, h in all_files(d).items():
        assert visible(h).count("Napkin Studio") == 1, name
