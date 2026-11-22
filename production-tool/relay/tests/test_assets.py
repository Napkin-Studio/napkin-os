"""GET /assets/{sha256} (features/prod-assets-route.clan): how the Deck Maker reads Production's pictures.
Only an agency that holds the bytes is sent to them; every other ask is the same 404, so no agency learns
that another's picture exists. ?w= serves a copy at most that wide, made once."""

import hashlib
import io
import json

from PIL import Image

import identity
import local
import sized
from conftest import CDN


def png(w=3000, h=2000, alpha=False) -> bytes:
    out = io.BytesIO()
    Image.new("RGBA" if alpha else "RGB", (w, h), (200, 60, 30, 128) if alpha else (200, 60, 30)).save(out, "PNG")
    return out.getvalue()


def sha_of(data: bytes) -> str:
    return "sha256:" + hashlib.sha256(data).hexdigest()


def uploaded(h, token, data: bytes, mime="image/png") -> str:
    """The browser's upload: POST /uploads (the agency now holds the hash), then its PUT."""
    sha = sha_of(data)
    h.call("POST", "/uploads", {"sha256": sha, "mime": mime, "bytes": len(data)}, token, expect=200)
    h.blobs.put(f"in/{sha}", data, mime)
    return sha


def get(h, token, path):
    status, out = h.call("GET", path, None, token)
    return status, out


def test_a_held_picture_redirects_to_its_url(h):
    token = h.as_person()
    sha = uploaded(h, token, png(40, 30))
    status, out = get(h, token, f"/assets/{sha}")
    assert status == 302 and out.headers["Location"] == f"{CDN}/in/{sha}" and out.data == b""
    # The bare hex and an encoded colon name the same picture; /api/ as CloudFront and napkin-web send it.
    assert get(h, token, f"/api/assets/{sha.removeprefix('sha256:')}")[1].headers["Location"] == f"{CDN}/in/{sha}"
    assert get(h, token, f"/assets/{sha.replace(':', '%3A')}")[0] == 302


def test_a_picture_the_relay_made_for_the_agency_redirects_to_out(h):
    token = h.as_person()
    data = png(40, 30)
    sha = sha_of(data)
    h.store.hold(identity.tenant_id("blue"), sha)  # a job's output, copied and held (service.py)
    h.blobs.put(f"out/{sha}", data, "image/png")
    status, out = get(h, token, f"/assets/{sha}")
    assert status == 302 and out.headers["Location"] == f"{CDN}/out/{sha}"


def test_another_agency_and_an_unknown_hash_get_the_same_404(h):
    alice = h.as_person()
    sha = uploaded(h, alice, png(40, 30))
    eve = h.as_person("eve", "red")
    status, other = get(h, eve, f"/assets/{sha}")
    status2, unknown = get(h, eve, "/assets/sha256:" + "e" * 64)
    assert status == status2 == 404 and other == unknown
    assert other["error"] == {"code": "invalid_input", "message": "No such picture.", "retryable": False}
    # Held, but the bytes are gone (the PUT never came): the same answer.
    gone = "sha256:" + "f" * 64
    h.store.hold(identity.tenant_id("blue"), gone)
    assert get(h, alice, f"/assets/{gone}") == (404, other)
    assert get(h, alice, "/assets/not-a-hash") == (404, other)


def test_no_person_no_picture(h):
    status, out = h.call("GET", "/assets/sha256:" + "a" * 64)
    assert status == 401 and out["error"]["code"] == "unauthorised"


def test_w_makes_one_deck_size_jpeg_and_keeps_it(h):
    token = h.as_person()
    sha = uploaded(h, token, png(3000, 2000))
    status, out = get(h, token, f"/assets/{sha}?w=2400")
    key = f"out/w2400/{sha}"
    assert status == 302 and out.headers["Location"] == f"{CDN}/{key}"
    data, mime = h.blobs.objects[key]
    assert mime == "image/jpeg"
    with Image.open(io.BytesIO(data)) as im:
        assert im.size == (2400, 1600)
    h.blobs.objects[key] = (b"kept", "image/jpeg")  # asked again: the kept copy, not made again
    assert get(h, token, f"/assets/{sha}?w=2400")[1].headers["Location"] == f"{CDN}/{key}"
    assert h.blobs.objects[key][0] == b"kept"


def test_w_keeps_transparency_and_never_enlarges(h):
    token = h.as_person()
    sha = uploaded(h, token, png(300, 200, alpha=True))
    assert get(h, token, f"/assets/{sha}?w=1200")[0] == 302
    data, mime = h.blobs.objects[f"out/w1200/{sha}"]
    with Image.open(io.BytesIO(data)) as im:
        assert mime == "image/png" and im.size == (300, 200) and im.mode == "RGBA"


def test_w_is_one_of_three_widths(h):
    token = h.as_person()
    sha = uploaded(h, token, png(40, 30))
    for w in ("1000", "x", "-1"):
        status, out = get(h, token, f"/assets/{sha}?w={w}")
        assert status == 400 and "480, 1200, 2400" in out["error"]["message"]
    assert sized.WIDTHS == (480, 1200, 2400)


def test_w_on_a_film_or_a_broken_file_serves_the_original(h):
    token = h.as_person()
    film = uploaded(h, token, b"\x00\x00\x00\x18ftypmp42 a film", "video/mp4")
    assert get(h, token, f"/assets/{film}?w=480")[1].headers["Location"] == f"{CDN}/in/{film}"
    broken = uploaded(h, token, b"\x89PNG\r\n\x1a\n not really")
    assert get(h, token, f"/assets/{broken}?w=480")[1].headers["Location"] == f"{CDN}/in/{broken}"
    assert f"out/w480/{broken}" not in h.blobs.objects


def test_the_local_relay_serves_its_own_files(tmp_path, monkeypatch):
    """relay/local.py: the same check, and the Location is the dev server's own /in/ (or /out/) path."""
    monkeypatch.setenv("NAPKIN_LOCAL_USER", "shrey@acme")
    monkeypatch.delenv("TOKEN_SECRET", raising=False)
    monkeypatch.delenv("NAPKIN_LOCAL_TENANTS", raising=False)
    data = png(3000, 2000)
    sha = sha_of(data)
    ask = json.dumps({"sha256": sha, "mime": "image/png", "bytes": len(data)}).encode()
    try:
        relay, blobs = local.build(8795, tmp_path)
        assert relay.http("GET", f"/assets/{sha}", {}, None)[0] == 404  # not uploaded yet: not held
        relay.http("POST", "/uploads", {"Content-Type": "application/json"}, ask)
        blobs.put(f"in/{sha}", data, "image/png")  # the browser's PUT
        status, out, _ = relay.http("GET", f"/assets/{sha}", {}, None)
        sized_status, small, _ = relay.http("GET", f"/api/assets/{sha}", {}, None, "w=480")
    finally:
        identity.use_local(None)
    assert status == 302 and out.headers["Location"] == f"http://localhost:8795/in/{sha}"
    assert sized_status == 302 and small.headers["Location"] == f"http://localhost:8795/out/w480/{sha}"
    assert blobs.mime(f"out/w480/{sha}") == "image/jpeg"
    with Image.open(blobs.path(f"out/w480/{sha}")) as im:
        assert im.size == (480, 320)


# -- the assets pass (docs/contracts/production-tool-identity.md): napkin-web's read-only audience for a deck build --

def pass_for(agency, now, life=1800):
    from identity import sign
    key = "k" * 40
    c = {"u": "ann@" + agency, "a": agency, "t": identity.tenant_id(agency), "aud": "assets", "iat": int(now),
         "exp": int(now) + life, "m": "GET", "p": "/api/assets/*", "bh": hashlib.sha256(b"").hexdigest()}
    return sign(c, key)


def with_passes(h, monkeypatch):
    """The relay under the real identity seam (assertions under a key), as the Function URL runs it."""
    monkeypatch.setattr(identity, "_local", None)
    monkeypatch.setattr(identity, "_refresh", None)
    monkeypatch.setenv("TOKEN_SECRET", "k" * 40)
    h.relay.who = lambda m, p, hd, b: identity.who(m, p, hd, b, now=h.clock())


def pass_call(h, token, method, path, body=None):
    path, _, query = path.partition("?")
    status, out, _ = h.relay.http(method, path, {"X-Napkin-Identity": token}, body, query)
    return status, out


def test_the_assets_pass_reads_pictures_its_agency_holds_and_nothing_else(h, monkeypatch):
    key = h.as_person()
    sha = uploaded(h, key, png(40, 30))
    with_passes(h, monkeypatch)
    token = pass_for("blue", h.clock())
    assert pass_call(h, token, "GET", f"/api/assets/{sha}?w=2400")[0] == 302
    assert pass_call(h, token, "GET", f"/api/assets/{sha}")[0] == 302
    # every other route and method refuses the pass (401, as with no identity)
    for method, path, body in [("GET", "/api/me", None), ("GET", "/api/projects", None), ("GET", "/api/clan/p1", None),
                               ("GET", "/api/library", None), ("GET", "/api/jobs/job_1", None),
                               ("POST", "/api/clan", b"x"), ("POST", "/api/uploads", b"{}"), ("POST", "/api/jobs", b"{}"),
                               ("DELETE", f"/api/assets/{sha}", None), ("POST", f"/api/assets/{sha}", None)]:
        assert pass_call(h, token, method, path, body)[0] == 401, (method, path)


def test_an_expired_assets_pass_is_refused(h, monkeypatch):
    key = h.as_person()
    sha = uploaded(h, key, png(40, 30))
    with_passes(h, monkeypatch)
    token = pass_for("blue", h.clock())
    assert pass_call(h, token, "GET", f"/api/assets/{sha}")[0] == 302
    h.clock.tick(1800 + 31)
    assert pass_call(h, token, "GET", f"/api/assets/{sha}")[0] == 401


def test_another_agencys_pass_still_gets_the_404(h, monkeypatch):
    key = h.as_person()
    sha = uploaded(h, key, png(40, 30))
    h.tenant("green")
    with_passes(h, monkeypatch)
    status, out = pass_call(h, pass_for("green", h.clock()), "GET", f"/api/assets/{sha}")
    status2, unknown = pass_call(h, pass_for("green", h.clock()), "GET", "/api/assets/sha256:" + "e" * 64)
    assert status == 404 and (status2, unknown) == (404, out)
