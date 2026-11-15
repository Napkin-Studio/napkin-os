"""Every URL the relay fetches on a caller's word is one of its own blobs (features/production-platform-rules.clan,
review C: a free crop fetched whatever https URL the request named).

Three walls: a URL a request names is read with blobs.fetch_own, which refuses anything but the relay's own keys
before any request; a provider's output goes through blobs.http_fetch, which takes https to a public address only
(no private, loopback, link-local or metadata address, even behind a public name) and never follows a redirect;
and a walk over the relay's source fails when a new fetch site skips both.
"""

from __future__ import annotations

import ast
import socket
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

import blobs
from blobs import UnsafeUrl, http_fetch, own_key
from conftest import CDN, Harness, base_config
from test_campaign import png, size_input

RELAY = Path(__file__).resolve().parent.parent
FOREIGN = "https://internal.example/anything.png"


class Remote(dict):
    """Provider output URLs; a test fails if a request's URL is ever looked up here."""

    def __init__(self):
        super().__init__()
        self.fetched: list[str] = []

    def __getitem__(self, url):
        self.fetched.append(url)
        return png()


def harness():
    h = Harness(base_config())
    h.blobs.remote = Remote()
    return h


# ── a URL a request names ──────────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("method", ["crop", "layout"])
def test_a_free_size_does_not_fetch_a_url_that_is_not_ours(method):
    h = harness()
    token = h.as_person()
    inp = size_input(h, method)
    inp["image"] = {**inp["image"], "url": FOREIGN}
    _, job = h.post_job(token, op="resize", expect=200, **inp)
    job = h.poll(token, job["jobId"]) if job["state"] not in ("completed", "failed") else job
    assert job["state"] == "failed", job
    assert job["error"]["code"] == "invalid_input" and "not one of this tool's own files" in job["error"]["message"]
    assert h.blobs.remote.fetched == [], "the relay fetched a URL outside its own store"


def test_a_logo_layer_on_a_url_that_is_not_ours_is_not_fetched():
    h = harness()
    token = h.as_person()
    inp = size_input(h, "layout", layers=[{"kind": "logo", "box": {"x": 0.1, "y": 0.1, "w": 0.3, "h": 0.1},
                                           "image": {"url": FOREIGN}}])
    h.post_job(token, op="resize", expect=None, **inp)
    assert h.blobs.remote.fetched == []


@pytest.mark.parametrize("url", [
    FOREIGN,
    "http://169.254.169.254/latest/meta-data/",
    f"{CDN}.evil.example/in/x",                  # a host that starts like ours
    f"{CDN}/clan/p_someone/project.clan",          # a saved project is never read on a URL's word
    f"{CDN}/in/../clan/p_someone/project.clan",
    f"{CDN}/in/%2e%2e/clan/x",
    f"{CDN}//etc/passwd",
    "",
    None,
])
def test_own_key_refuses_before_any_request(url):
    with pytest.raises(UnsafeUrl):
        own_key(harness().blobs, url)


def test_own_key_takes_our_own_artifacts():
    b = harness().blobs
    assert own_key(b, f"{CDN}/in/sha256:{'a' * 64}") == f"in/sha256:{'a' * 64}"
    assert own_key(b, f"{CDN}/out/sha256:{'b' * 64}") == f"out/sha256:{'b' * 64}"


def test_local_and_s3_blobs_read_only_their_own_keys(tmp_path):
    local = blobs.LocalBlobs(tmp_path, "http://localhost:9999")
    local.put("in/x", b"ours", "image/png")
    assert local.fetch_own("http://localhost:9999/in/x") == b"ours"
    with pytest.raises(UnsafeUrl):
        local.fetch_own(FOREIGN)


# ── a provider's output over the network ───────────────────────────────────────────────────────────────

@pytest.fixture
def no_connect(monkeypatch):
    def refuse(*a, **k):
        raise AssertionError("a connection was opened")
    monkeypatch.setattr(socket, "create_connection", refuse)


@pytest.mark.parametrize("address", ["169.254.169.254", "10.0.0.5", "192.168.1.2", "127.0.0.1", "100.64.0.1",
                                     "0.0.0.0", "::1", "fe80::1", "fd00:ec2::254"])
def test_a_public_name_that_resolves_to_a_private_address_is_refused(monkeypatch, no_connect, address):
    fam = socket.AF_INET6 if ":" in address else socket.AF_INET
    monkeypatch.setattr(socket, "getaddrinfo", lambda *a, **k: [(fam, socket.SOCK_STREAM, 6, "", (address, 443))])
    with pytest.raises(UnsafeUrl):
        http_fetch("https://cdn.provider.example/out.png")


@pytest.mark.parametrize("url", ["http://cdn.provider.example/out.png", "ftp://x/y", "file:///etc/passwd",
                                 "https://user:pw@cdn.provider.example/x", "gopher://x/"])
def test_only_https_is_fetched(no_connect, url):
    with pytest.raises(UnsafeUrl):
        http_fetch(url)


def test_a_data_url_is_read_in_place(no_connect):
    assert http_fetch("data:text/plain;base64,aGk=") == b"hi"


def test_a_redirect_is_refused_and_not_followed(monkeypatch):
    seen = []

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            seen.append(self.path)
            self.send_response(302)
            self.send_header("Location", "http://169.254.169.254/latest/meta-data/")
            self.end_headers()

        def log_message(self, *a):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    monkeypatch.setattr(blobs, "_loopback_ok", True)   # local.py's own setting, for a server on this machine
    try:
        with pytest.raises(UnsafeUrl, match="redirect"):
            http_fetch(f"http://127.0.0.1:{server.server_address[1]}/out.png")
    finally:
        server.shutdown()
        server.server_close()
    assert seen == ["/out.png"], "only the first URL was requested"


def test_loopback_is_refused_unless_local_py_allows_it(no_connect):
    with pytest.raises(UnsafeUrl):
        http_fetch("http://127.0.0.1:1/x")


# ── the walk: a new fetch site cannot skip the check ───────────────────────────────────────────────────

# blobs.fetch (our key, else http_fetch) is for a provider's output only. Each site that reads it, by file and function.
PROVIDER_OUTPUT_SITES = {("service.py", "_fetch")}
# http_fetch is called only by the blobs and the mock's reader, which are the two walls above.
HTTP_FETCH_SITES = {("blobs.py", "fetch"), ("providers/_seam.py", "fetch")}
# Fetching by a library outside these two is refused outright. A sender (a provider or model call) goes through the
# spend walk in test_platform_rules.py instead.
FORBIDDEN = {"urlopen", "urlretrieve", "Request"}


def sources():
    for p in sorted(RELAY.rglob("*.py")):
        rel = p.relative_to(RELAY).as_posix()
        if rel.startswith(("tests/", "scripts/", "eval/", ".venv/")) or "/." in rel:
            continue
        yield rel, ast.parse(p.read_text(), rel)


def sites(tree):
    """(function, node) for each node, with the innermost enclosing function's name."""
    def walk(node, fn):
        for child in ast.iter_child_nodes(node):
            name = child.name if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)) else fn
            yield name, child
            yield from walk(child, name)
    yield from walk(tree, "<module>")


def test_every_blobs_fetch_is_a_provider_output_site():
    found = set()
    for rel, tree in sources():
        for fn, node in sites(tree):
            if isinstance(node, ast.Attribute) and node.attr == "fetch":
                owner = node.value
                owner = owner.attr if isinstance(owner, ast.Attribute) else getattr(owner, "id", "")
                if owner == "blobs":
                    found.add((rel, fn))
    assert found == PROVIDER_OUTPUT_SITES, (
        f"blobs.fetch at {sorted(found - PROVIDER_OUTPUT_SITES)}: a URL a request names is read with "
        "blobs.fetch_own (only our own keys); add a provider-output site here only with its reason")


def test_http_fetch_has_only_its_two_callers_and_nothing_else_fetches():
    calls, forbidden = set(), []
    for rel, tree in sources():
        for fn, node in sites(tree):
            if isinstance(node, ast.Call):
                f = node.func
                name = f.attr if isinstance(f, ast.Attribute) else getattr(f, "id", "")
                if name == "http_fetch":
                    calls.add((rel, fn))
                if name in FORBIDDEN and not (rel == "blobs.py"):
                    forbidden.append((rel, fn, name))
    assert calls == HTTP_FETCH_SITES, calls
    assert forbidden == [], forbidden
    assert "urllib.request" not in (RELAY / "blobs.py").read_text(), "urllib.request follows redirects"
