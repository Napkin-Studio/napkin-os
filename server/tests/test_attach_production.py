"""attach_production@1 and build_deck's Production file (deck-prod-picker): the app hands the engine a Production .clan or export zip once,
and every build passes it on with the person's opt-ins and swaps. The engine is a stub behind httpx.MockTransport; no file is fetched."""

import base64
import json

import httpx

from napkin import registry
from napkin.deck import engine
from napkin.handlers import attach_production

from test_brief import Host, post
from test_deck import SCHEMA, GATE1, FakeEngine, build, deck, deck_data, use, view  # noqa: F401  (deck is a fixture)

HEX = "ab" * 32


class StoreEngine:
    """POST /production answers what the engine stored; anything else is a test failure."""

    def __init__(self, status=200, body=None):
        self.posts, self.status = [], status
        self.body = body if body is not None else {"ok": True, "sha256": HEX, "name": "lumen.clan", "kind": "clan", "rows": 21, "eligible": 12}

    def __call__(self, request: httpx.Request) -> httpx.Response:
        assert request.method == "POST" and request.url.path == "/production", request.url
        self.posts.append(json.loads(request.content))
        return httpx.Response(self.status, json=self.body)


def attach(deck, inp):
    return post(deck, "attach_production", inp, Host(data=deck_data(), schema=SCHEMA).clan())


def test_the_task_is_registered_and_writes_nothing(deck, monkeypatch):
    mod, handler = registry.resolve("attach_production", {"pipeline": {"tasks": {"build_deck": {"handler": "build_deck@1"}}}})
    assert handler == "attach_production@1.0" and mod.KIND == "deck_file"
    fake = use(monkeypatch, StoreEngine())
    data = base64.b64encode(b"PK\x03\x04 a production clan").decode()
    st, body = attach(deck, {"name": "lumen.clan", "data_b64": data})
    assert st == 200, body
    assert body["change"] is None and body["job"]["state"] == "done"
    assert body["result"]["sha256"] == HEX and body["result"]["rows"] == 21 and "21 asset(s)" in body["result"]["summary"]
    assert fake.posts == [{"doc": fake.posts[0]["doc"], "name": "lumen.clan", "data_b64": data}]


def test_only_a_clan_or_zip_in_base64_under_the_cap_is_sent(deck, monkeypatch):
    fake = use(monkeypatch, StoreEngine())
    good = base64.b64encode(b"x").decode()
    for inp in ({"name": "brief.pdf", "data_b64": good}, {"name": "../x.clan", "data_b64": good}, {"name": "x.clan", "data_b64": "not base64!"},
                {"name": "x.zip"}, {"data_b64": good}):
        st, body = attach(deck, inp)
        assert st == 400, (inp, body)
    monkeypatch.setattr(attach_production, "MAX_BYTES", 3)
    st, body = attach(deck, {"name": "x.zip", "data_b64": base64.b64encode(b"0123456789").decode()})
    assert st == 413 and body["error"]["type"] == "too_large"
    assert fake.posts == []


def test_an_engine_refusal_is_the_tasks_error_never_a_success(deck, monkeypatch):
    use(monkeypatch, StoreEngine(status=400, body={"error": {"type": "bad_production", "message": "not a Production file the deck can read"}}))
    st, body = attach(deck, {"name": "x.clan", "data_b64": base64.b64encode(b"nope").decode()})
    assert st == 400 and body["error"]["type"] == "bad_production" and "not a Production file" in body["error"]["message"]


def test_every_build_passes_the_production_file_its_opt_ins_and_the_swaps(deck, monkeypatch):
    fake = use(monkeypatch, FakeEngine(view("gate", gate=GATE1)))
    data = deck_data()
    data["inputs"]["documents"] = [{"name": "lumen.clan"}]
    data["inputs"]["production"] = {"name": "lumen.clan", "sha256": HEX, "fetch": True, "look": False, "at": "t", "rows": 21, "eligible": 12}
    data["review"] = {"production": {"s11": {"picture": {"key": "size_01KB0000000000000000000002", "by": "You", "at": "t"}}}}
    build(deck, Host(data=data, schema=SCHEMA))
    sent = fake.posts[0]
    assert sent["inputs"]["production"] == {"sha256": HEX, "fetch": True, "look": False}
    assert sent["review"]["production"]["s11"]["picture"]["key"] == "size_01KB0000000000000000000002"
    fake2 = use(monkeypatch, FakeEngine(view("gate", gate=GATE1)))
    build(deck, Host(data=deck_data(), schema=SCHEMA))
    assert "production" not in fake2.posts[0]["inputs"]                                          # opt-in: no file, no flag


# ── fetch_deck_file@1 (deck-cloud): the app asks for a finished file of its deck by name ──

class FileEngine:
    def __init__(self, status=200, body=b"<html>deck</html>"):
        self.gets, self.status, self.body = [], status, body

    def __call__(self, request: httpx.Request) -> httpx.Response:
        assert request.method == "GET", request.url
        self.gets.append(request.url.path)
        return httpx.Response(self.status, content=self.body)


def test_fetch_deck_file_hands_the_app_a_file_and_writes_nothing(deck, monkeypatch):
    fake = use(monkeypatch, FileEngine())
    st, body = post(deck, "fetch_deck_file", {"name": "deck.html"}, Host(data=deck_data(), schema=SCHEMA).clan())
    assert st == 200, body
    assert body["change"] is None and body["job"]["state"] == "done"
    assert base64.b64decode(body["result"]["data_b64"]) == b"<html>deck</html>" and body["result"]["media_type"].startswith("text/html")
    assert len(fake.gets) == 1 and fake.gets[0].endswith("/deck.html")


def test_fetch_deck_file_names_only_the_decks_files_and_says_when_one_is_missing(deck, monkeypatch):
    fake = use(monkeypatch, FileEngine(status=404, body=b"{}"))
    clan = Host(data=deck_data(), schema=SCHEMA).clan()
    for bad_name in ("deck.pdf", "../etc/passwd", "report.json", None):
        st, _ = post(deck, "fetch_deck_file", {"name": bad_name}, clan)
        assert st == 400, bad_name
    assert fake.gets == []
    st, body = post(deck, "fetch_deck_file", {"name": "deck.pptx"}, clan)
    assert st == 404 and body["error"]["type"] == "no_file"
