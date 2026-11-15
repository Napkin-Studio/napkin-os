"""Every URL the relay fetches on a caller's word is one of its own blobs (features/production-platform-rules.clan,
review C: a free crop fetched whatever https URL the request named).

Three walls: a URL a request names is read with blobs.fetch_own, which refuses anything but the relay's own keys
before any request; a provider's output goes through blobs.http_fetch, which takes https to a public address only
(no private, loopback, link-local or metadata address, even behind a public name) and never follows a redirect;
and a walk over the relay's source fails when a new fetch site skips both.
"""

from __future__ import annotations

import ast
import re
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
    status, out = h.post_job(token, op="resize", **inp)   # refused at the door now (the review of 25e7c870)
    assert status == 400 and out["error"]["code"] == "invalid_input" and "not one of ours" in out["error"]["message"]
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
    key = "in/sha256:" + "a" * 64
    local.put(key, b"ours", "image/png")
    assert local.fetch_own(f"http://localhost:9999/{key}") == b"ours"
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


# ── the security review of 25e7c870 (findings 1, 2 and 12) ────────────────────────────────────────────

import json  # noqa: E402

import httpx  # noqa: E402

import identity  # noqa: E402
from conftest import asset, envelope  # noqa: E402
from director import new_id  # noqa: E402
from providers import Registry  # noqa: E402
from providers._seam import Adapted, Resolver  # noqa: E402
from providers.runway import RunwayProvider  # noqa: E402

PROJECT = "prj_01J9Z8Y7X6W5V4T3S2R1Q0P9N9"


@pytest.mark.parametrize("key", [
    "tenants/{red}/projects/" + PROJECT + "/latest.clan",
    "tenants/{red}/projects/index.json",
    "tenants/{red}/projects/" + PROJECT + "/canvas.json",
    "tenants/{red}/library/agency/index.json",
    "dogfood/consent/p_0000000000.json",
    "library/p_0000000000/x.json",
    "cards/abc.json",
    "in/not-a-hash",
    "out/sha256:" + "a" * 63,
])
def test_own_key_refuses_another_agencys_private_objects(key):
    h = Harness()
    red = identity.tenant_id("red")
    for tenant in (None, identity.tenant_id("blue")):
        with pytest.raises(UnsafeUrl):
            own_key(h.blobs, f"{CDN}/" + key.format(red=red), tenant)


def test_own_key_takes_the_callers_own_tenant_space_only():
    b = harness().blobs
    blue = identity.tenant_id("blue")
    assert own_key(b, f"{CDN}/tenants/{blue}/library/agency/x.png", blue) == f"tenants/{blue}/library/agency/x.png"
    with pytest.raises(UnsafeUrl):
        own_key(b, f"{CDN}/tenants/{blue}/library/agency/x.png", identity.tenant_id("red"))
    with pytest.raises(UnsafeUrl):
        own_key(b, f"{CDN}/tenants/{blue}/library/agency/x.png", None)


def test_a_crop_naming_another_agencys_saved_project_is_refused_unread_and_is_no_oracle():
    """blue names red's saved project (tenant id = uuid5 of the agency name) as input.image.url of a free crop."""
    from test_projects import clan, save
    h = Harness()
    bob = h.as_person("bob", "red")
    save(h, bob, PROJECT, clan("red's project"))
    alice = h.as_person("alice", "blue")
    red = identity.tenant_id("red")
    read = []
    real = h.blobs.fetch_own
    h.blobs.fetch_own = lambda url, tenant=None: (read.append(url), real(url, tenant))[1]
    answers = {}
    for name, project in (("exists", PROJECT), ("missing", "prj_01J9Z8Y7X6W5V4T3S2R1Q0P9ZZ")):
        inp = size_input(h, "crop")
        inp["image"] = {**inp["image"], "url": f"{CDN}/tenants/{red}/projects/{project}/latest.clan"}
        answers[name] = h.post_job(alice, op="resize", **inp)
    assert answers["exists"] == answers["missing"], f"existence oracle across agencies: {answers}"
    status, out = answers["exists"]
    assert status == 400 and out["error"]["code"] == "invalid_input", out
    assert read == [], "nothing was read"


def test_the_runway_adapter_does_not_get_a_url_the_request_names():
    """region_edit on Gemini (Ideogram off): the adapter read the `current` picture itself with
    self._client.get(url), the request's assetRef url (review finding 1)."""
    seen = []

    def transport(request: httpx.Request) -> httpx.Response:
        seen.append((request.method, str(request.url)))
        if request.method == "POST":
            return httpx.Response(200, json={"id": "task_1"})
        return httpx.Response(200, content=png(), headers={"content-type": "image/png"})

    h = Harness(base_config(), providers=())
    reg = Registry()
    reg.register(Adapted(RunwayProvider("rw_test_key", Resolver(), client=httpx.Client(transport=httpx.MockTransport(transport)))))
    h.relay.registry = reg
    h.cfg["flags"] = {**h.cfg["flags"], "regionEditCanvas": True, "regionEditFrames": True}
    token = h.as_person()
    h.limits("blue", allow={"claude": True, "makers": ["runway", "google"]})
    inner = "https://10.0.0.5/admin/secret.png"
    inp = {"image": {**asset(6), "url": inner}, "region": {"x": 0.2, "y": 0.2, "w": 0.3, "h": 0.3},
           "text": "make the hat red", "ratio": "16:9"}
    status, job = h.call("POST", "/jobs", {**envelope("region_edit", new_id("job")), "input": inp}, token)
    assert ("GET", inner) not in seen, f"the relay itself requested the caller's URL: {seen}"
    assert not [s for s in seen if s[0] == "POST"], f"a caller's URL went on to Runway: {seen}"
    assert status == 400 and job["error"]["code"] == "invalid_input", job


def test_the_mock_does_not_request_a_caller_named_host(monkeypatch):
    from providers import mock as mock_mod
    fetched = []
    monkeypatch.setattr(blobs, "http_fetch", lambda url: (fetched.append(url), b"")[1])
    h = Harness(base_config(routing={"generate": ["mock"], "shot_list": [], "stitch": []}), providers=())
    reg = Registry()
    real = mock_mod.make()
    real.inner._delay = 0.0
    reg.register(real)
    h.relay.registry = reg
    token = h.as_person()
    ref = {"id": new_id("node"), "role": "character", "kind": "drawing",
           "asset": {**asset(1), "url": "https://attacker.example/collect?x=1"}}
    status, job = h.post_job(token, op="generate", text="a hero", refs=[ref])
    assert fetched == [], f"a request went to a caller-named host: {fetched}"
    assert status == 400 and job["error"]["code"] == "invalid_input"


@pytest.mark.parametrize("address", ["64:ff9b::a00:5", "64:ff9b:1::a00:5", "::10.0.0.5", "::ffff:10.0.0.5",
                                     "fec0::1", "2002:a00:5::1", "2001::a00:5"])
def test_ipv6_forms_that_reach_a_private_address_are_refused(monkeypatch, no_connect, address):
    monkeypatch.setattr(socket, "getaddrinfo", lambda *a, **k: [(socket.AF_INET6, socket.SOCK_STREAM, 6, "", (address, 443))])
    with pytest.raises(UnsafeUrl):
        http_fetch("https://cdn.provider.example/out.png")


# Every HTTP client a relay module may use, and the sites allowed to: a new site fails until it is named here with why.
# blobs.py is the wall itself (fetch_own, http_fetch), tested above.
HTTP_SITES = {
    ("providers/runway.py", "_call"): "Runway's own API: BASE_URL + a path the adapter builds",
    ("providers/runway.py", "__init__"): "the adapter's httpx.Client, constructed",
    ("director/model.py", "send"): "the model wire's own endpoint (OpenAIWire.url, the SDK client)",
    ("director/model.py", "__init__"): "the OpenAI wire's httpx.Client, constructed",
    ("handler.py", "_build"): "boto3 clients for the Lambda and SSM named by the environment, not a request",
    ("runtime.py", "refresh"): "boto3 Secrets Manager, the ARNs in SECRET_ARNS, not a request",
}
CLIENT_CALL = re.compile(r"^(httpx|requests|aiohttp|urllib[.\w]*|http\.client|socket|boto3)\.|"
                         r"(^|\.)(_?client|session|_session)\.(get|post|put|patch|delete|request|stream|send|head|"
                         r"get_object|download_file|download_fileobj)$|^(urlopen|HTTPConnection|HTTPSConnection|ClientSession)$")


def test_every_http_client_site_in_the_relay_is_named():
    """Finding 1: the walk missed httpx. Any call to an HTTP client (httpx, requests, aiohttp, urllib, http.client,
    a socket, boto3, a `client.get`) outside blobs.py is one of the named sites; everything else reads a URL
    through the walls (fetch_own, http_fetch)."""
    found = {}
    for rel, tree in sources():
        if rel == "blobs.py" or rel.startswith("store.py"):
            continue
        text = (RELAY / rel).read_text()
        for fn, node in sites(tree):
            if isinstance(node, ast.Call):
                callee = ast.get_source_segment(text, node.func) or ""
                if CLIENT_CALL.search(callee):
                    found.setdefault((rel, fn), callee)
    unknown = {k: v for k, v in found.items() if k not in HTTP_SITES}
    assert not unknown, f"an HTTP client used outside the named sites: {unknown}"


def test_the_client_walk_sees_a_new_site():
    assert CLIENT_CALL.search("self._client.get") and CLIENT_CALL.search("httpx.get") and CLIENT_CALL.search("requests.post")
    assert CLIENT_CALL.search("urllib.request.urlopen") and CLIENT_CALL.search("boto3.client")
    assert not CLIENT_CALL.search("self.requests.append") and not CLIENT_CALL.search("cfg.get")


def test_no_relay_module_imports_another_http_library():
    for rel, tree in sources():
        for node in ast.walk(tree):
            names = [a.name for a in node.names] if isinstance(node, (ast.Import, ast.ImportFrom)) else []
            mod = getattr(node, "module", None) or ""
            for n in [mod, *names]:
                assert not re.match(r"^(requests|aiohttp|urllib3|urllib\.request|pycurl)\b", n or ""), (rel, n)
