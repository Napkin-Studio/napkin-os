"""Personal workspaces (features/personal-workspaces.clan): sign in with the event code and a name,
and the name's saved projects follow it to any browser: listed, opened, and never silently
overwritten by a save from somewhere else."""

import hashlib
import json

import local
from service import Raw

A = "prj_01J9Z8Y7X6W5V4T3S2R1Q0P9N8"
B = "prj_01J9Z8Y7X6W5V4T3S2R1Q0P9N9"


def clan(text: str) -> bytes:
    return b"PK\x03\x04" + text.encode()


def save(h, token, project, data, *, if_match=None, name=None, reason="manual"):
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/vnd.clan+zip",
               "X-Clan-Reason": reason, "X-Project-Id": project}
    if if_match is not None:
        headers["If-Match"] = if_match
    if name is not None:
        headers["X-Project-Name"] = name
    status, out, _ = h.relay.http("POST", "/api/clan", headers, data)
    if status == 200:
        assert not h.contracts.errors("relay-api.schema.json#/$defs/ClanSaved", out), out
    else:
        assert not h.contracts.errors("relay-api.schema.json#/$defs/ErrorResponse", out), out
    return status, out


def open_clan(h, token, project):
    return h.relay.http("GET", f"/api/clan/{project}", {"Authorization": f"Bearer {token}"}, None)


def test_sign_in_with_the_event_code_in_any_case_and_a_name(h):
    for code in ("napkin-studio", "NAPKIN-STUDIO", " Napkin-Studio "):
        _, out = h.call("POST", "/session", {"eventCode": code, "team": "blue", "handle": "maya"}, expect=200)
        assert out["role"] == "participant" and out["workspace"] == out["participantId"]
    h.call("POST", "/session", {"eventCode": "napkin", "team": "blue", "handle": "maya"}, expect=401)


def test_a_save_is_listed_for_its_name_only_newest_first(h):
    maya, sam = h.sign_in("maya", "napkin-studio"), h.sign_in("sam", "napkin-studio")
    assert h.call("GET", "/projects", token=maya, expect=200)[1] == {"projects": []}
    status, out = save(h, maya, A, clan("one"), name="Maya%20finds%20the%20lamp")
    assert status == 200 and out["project"]["etag"] == hashlib.sha256(clan("one")).hexdigest()
    h.clock.tick(60)
    save(h, maya, B, clan("two"))
    rows = h.call("GET", "/projects", token=maya, expect=200)[1]["projects"]
    assert [r["id"] for r in rows] == [B, A]
    assert rows[1]["name"] == "Maya finds the lamp" and "name" not in rows[0]
    assert rows[1]["bytes"] == len(clan("one")) and rows[0]["savedAt"] > rows[1]["savedAt"]
    assert h.call("GET", "/projects", token=sam, expect=200)[1] == {"projects": []}
    # The same name from another browser (another sign-in) sees them too.
    again = h.sign_in("Maya", "NAPKIN-STUDIO")
    assert [r["id"] for r in h.call("GET", "/projects", token=again, expect=200)[1]["projects"]] == [B, A]


def test_sign_in_says_how_many_projects_the_name_has(h):
    assert h.call("POST", "/session", {"eventCode": "napkin-studio", "team": "blue", "handle": "maya"}, expect=200)[1]["projects"] == 0
    maya = h.sign_in("maya", "napkin-studio")
    save(h, maya, A, clan("one"))
    save(h, maya, A, clan("one again"))
    save(h, maya, B, clan("two"))
    assert h.call("POST", "/session", {"eventCode": "napkin-studio", "team": "blue", "handle": "MAYA"}, expect=200)[1]["projects"] == 2
    assert h.call("POST", "/session", {"eventCode": "napkin-studio", "team": "blue", "handle": "sam"}, expect=200)[1]["projects"] == 0


def test_open_answers_the_newest_bytes_with_their_etag(h):
    maya = h.sign_in("maya", "napkin-studio")
    save(h, maya, A, clan("one"))
    h.clock.tick(5)
    _, saved = save(h, maya, A, clan("two"))
    status, out, _ = open_clan(h, h.sign_in("maya", "HACK"), A)
    assert status == 200 and isinstance(out, Raw)
    assert out.data == clan("two") and out.mime == "application/vnd.clan+zip"
    assert out.headers["ETag"] == f'"{saved["project"]["etag"]}"' and out.headers["X-Saved-At"] == saved["project"]["savedAt"]


def test_open_is_only_for_the_owner(h):
    maya, sam = h.sign_in("maya", "napkin-studio"), h.sign_in("sam", "napkin-studio")
    save(h, maya, A, clan("one"))
    status, out, _ = open_clan(h, sam, A)
    assert status == 404 and out["error"]["code"] == "invalid_input"
    for bad in ("../x", "prj_short", f"{A}/latest.clan"):
        assert open_clan(h, maya, bad)[0] == 404
    assert h.relay.http("GET", f"/clan/{A}", {}, None)[0] == 401


def test_a_stale_save_is_a_conflict_and_nothing_is_overwritten(h):
    maya = h.sign_in("maya", "napkin-studio")
    _, first = save(h, maya, A, clan("from the laptop"))
    etag = first["project"]["etag"]
    h.clock.tick(5)
    # Another browser saved on top of what it opened: fine.
    _, second = save(h, h.sign_in("maya", "napkin-studio"), A, clan("from the desktop"), if_match=f'"{etag}"')
    # The laptop, still on the first ETag, is refused; the desktop's save stays the project.
    h.clock.tick(5)
    status, out = save(h, maya, A, clan("the laptop again"), if_match=etag)
    assert status == 409 and out["error"]["code"] == "conflict" and not out["error"]["retryable"]
    assert open_clan(h, maya, A)[1].data == clan("from the desktop")
    # Every save is kept, the refused one is not the project.
    copies = sorted(k for k in h.blobs.objects if k.startswith("clan/") and k.endswith("-manual.clan"))
    assert len(copies) == 3
    # Choosing "save this as a new version": the latest ETag, then it goes in.
    status, out = save(h, maya, A, clan("the laptop again"), if_match=second["project"]["etag"])
    assert status == 200 and open_clan(h, maya, A)[1].data == clan("the laptop again")


def test_a_save_without_if_match_is_taken_as_before(h):
    maya = h.sign_in("maya", "napkin-studio")
    save(h, maya, A, clan("one"))
    status, _ = save(h, maya, A, clan("two"))
    assert status == 200 and open_clan(h, maya, A)[1].data == clan("two")
    pid = h.call("POST", "/session", {"eventCode": "HACK", "team": "blue", "handle": "maya"}, expect=200)[1]["participantId"]
    assert h.blobs.objects[f"clan/{pid}/{A}/latest.clan"][0] == clan("two")  # the organisers' copy, as before


def test_if_match_on_a_project_never_saved_is_taken(h):
    # A project this server does not have (never saved here, or pruned): nothing to overwrite.
    maya = h.sign_in("maya", "napkin-studio")
    assert save(h, maya, A, clan("one"), if_match="0" * 64)[0] == 200


def test_a_rename_carries_and_a_missing_name_keeps_the_last(h):
    maya = h.sign_in("maya", "napkin-studio")
    save(h, maya, A, clan("one"), name="Caf%C3%A9%20ad")
    save(h, maya, A, clan("two"))
    assert h.call("GET", "/projects", token=maya, expect=200)[1]["projects"][0]["name"] == "Café ad"
    save(h, maya, A, clan("three"), name="%FF")  # not UTF-8: ignored
    assert h.call("GET", "/projects", token=maya, expect=200)[1]["projects"][0]["name"] == "Café ad"


def test_the_canvas_goes_with_the_saved_project(h):
    maya, sam = h.sign_in("maya", "napkin-studio"), h.sign_in("sam", "napkin-studio")
    els = [{"id": "e1", "type": "image", "fileId": "ab" * 20, "customData": {"kind": "pic"}}]
    # Not before the project is saved.
    h.call("PUT", f"/clan/{A}/canvas", {"elements": els}, maya, expect=404)
    save(h, maya, A, clan("one"))
    h.call("PUT", f"/clan/{A}/canvas", {"elements": els}, maya, expect=204)
    out = h.call("GET", f"/clan/{A}/canvas", None, maya, expect=200)[1]
    assert out["elements"] == els and out["savedAt"]
    h.call("GET", f"/clan/{A}/canvas", None, sam, expect=404)
    h.call("PUT", f"/clan/{A}/canvas", {"elements": "no"}, maya, expect=400)


def test_too_large_to_open_says_to_export(h, monkeypatch):
    import service

    maya = h.sign_in("maya", "napkin-studio")
    save(h, maya, A, clan("x" * 100))
    monkeypatch.setattr(service, "OPEN_MAX_BYTES", 50)
    status, out, _ = open_clan(h, maya, A)
    assert status == 413 and "Export" in out["error"]["message"]


def test_a_lost_index_race_reads_again(h):
    maya = h.sign_in("maya", "napkin-studio")
    save(h, maya, A, clan("one"))
    real, raced = h.blobs.put_json_if, []

    def racing(key, data, etag):
        if not raced:  # another project's save lands between our read and our write
            raced.append(1)
            h.blobs.put(key, h.blobs.objects[key][0] + b" ", "application/json")
            return False
        return real(key, data, etag)

    h.blobs.put_json_if = racing
    assert save(h, maya, B, clan("two"))[0] == 200
    assert {r["id"] for r in h.call("GET", "/projects", token=maya, expect=200)[1]["projects"]} == {A, B}


def test_local_server_lets_the_browser_send_if_match_and_read_the_etag():
    allowed = {x.strip().lower() for x in local.CORS_ALLOW_HEADERS.split(",")}
    assert {"if-match", "x-project-name"} <= allowed
    assert {"etag", "x-saved-at"} <= {x.strip().lower() for x in local.CORS_EXPOSE_HEADERS.split(",")}


def test_the_local_server_round_trip(tmp_path):
    relay, blobs = local.build(8799, tmp_path)
    status, sess, _ = relay.http("POST", "/session", {}, json.dumps({"eventCode": "local", "team": "blue", "handle": "maya"}).encode())
    assert status == 200
    auth = {"Authorization": f"Bearer {sess['token']}", "X-Project-Id": A}
    assert relay.http("POST", "/clan", auth, clan("one"))[0] == 200
    status, out, _ = relay.http("GET", f"/clan/{A}", auth, None)
    assert status == 200 and out.data == clan("one")
    assert (tmp_path / "clan" / sess["participantId"] / "projects.json").exists()
