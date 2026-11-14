"""The library: items published as immutable versions on shelves, in the agency's workspace.

Rewritten for features/os-sign-in.clan (2026-10-13): the agency is the tenant and its workspace, so a
library is shared by everyone in the agency and never seen by another agency. Contract 3
(features/contract-v3.clan): one shelf per client, 'agency' for what no client owns, at
tenants/<tenantId>/library/<shelf>/…, and three kinds of item: key, brand_kit, format_pack.
"""

import pytest

from conftest import asset
from identity import tenant_id


def upload(h, n):
    a = asset(n)
    h.blobs.put(f"in/{a['sha256']}", b"png", "image/png")
    return a


def publish(h, token, key="maya", base=0, variants=("front", "side"), expect=200, shelf="agency"):
    refs = [{"variant": v, "asset": upload(h, i + 1)} for i, v in enumerate(variants)]
    body = {"kind": "key", "role": "character", "baseVer": base, "refs": refs}
    return h.call("POST", f"/library/{shelf}/{key}", body, token, expect=expect)[1]


def test_the_workspace_is_the_agency(h):
    ann = h.call("GET", "/me", token=h.as_person("ann"), expect=200)[1]
    assert ann["workspace"] == tenant_id("blue") == ann["tenant"]["id"]
    bob = h.call("GET", "/me", token=h.as_person("bob"), expect=200)[1]
    assert bob["workspace"] == ann["workspace"] and bob["participantId"] != ann["participantId"]
    eve = h.call("GET", "/me", token=h.as_person("eve", "red"), expect=200)[1]
    assert eve["workspace"] == tenant_id("red") != ann["workspace"]


def test_publish_list_and_read_back_on_the_agency_shelf(h):
    ann = h.as_person("ann")
    entry = publish(h, ann)
    tid = tenant_id("blue")
    assert (entry["workspace"], entry["shelf"], entry["kind"], entry["key"], entry["ver"], entry["by"]) == (tid, "agency", "key", "maya", 1, "ann")
    assert f"tenants/{tid}/library/agency/index.json" in h.blobs.objects
    assert f"tenants/{tid}/library/agency/maya/1.json" in h.blobs.objects
    index = h.call("GET", "/library/agency", token=ann, expect=200)[1]
    (row,) = index["keys"]
    assert index["shelf"] == "agency" and row["kind"] == "key"
    assert row["variants"] == ["front", "side"] and row["cover"] == asset(1) and row["ver"] == 1
    assert h.call("GET", "/library/agency/maya", token=ann, expect=200)[1] == entry
    assert h.call("GET", "/library/agency/maya/1", token=ann, expect=200)[1] == entry


def test_shelves_are_separate(h):
    ann = h.as_person("ann")
    publish(h, ann, shelf="lumen")
    assert h.call("GET", "/library/agency", token=ann, expect=200)[1]["keys"] == []
    assert [k["key"] for k in h.call("GET", "/library/lumen", token=ann, expect=200)[1]["keys"]] == ["maya"]
    assert publish(h, ann, shelf="agency")["ver"] == 1  # the agency's own maya, not lumen's next version


@pytest.mark.parametrize("kind, payload", [
    ("brand_kit", lambda h: {"logo": [{"variant": "logo", "asset": upload(h, 5)}], "palette": [{"hex": "#0B5FFF"}],
                             "fonts": [{"family": "Lumen Sans"}], "rules": [{"kind": "do", "text": "Clear space."}]}),
    ("format_pack", lambda h: {"id": "lumen-social", "name": "Lumen social", "formats": []}),
])
def test_each_kind_round_trips_under_a_shelf(h, kind, payload):
    ann = h.as_person("ann")
    tid = tenant_id("blue")
    body = {"kind": kind, "baseVer": 0, "payload": payload(h)}
    entry = h.call("POST", "/library/lumen/brandkit", body, ann, expect=200)[1]
    assert (entry["shelf"], entry["kind"], entry["ver"], entry["payload"]) == ("lumen", kind, 1, body["payload"])
    assert f"tenants/{tid}/library/lumen/brandkit/1.json" in h.blobs.objects
    (row,) = h.call("GET", "/library/lumen", token=ann, expect=200)[1]["keys"]
    assert row["kind"] == kind and "cover" not in row
    assert h.call("GET", "/library/lumen/brandkit", token=ann, expect=200)[1] == entry
    # The next version names the one it replaces; a key of another kind is refused.
    assert h.call("POST", "/library/lumen/brandkit", {**body, "baseVer": 1}, ann, expect=200)[1]["ver"] == 2
    refs = [{"variant": "front", "asset": upload(h, 1)}]
    h.call("POST", "/library/lumen/brandkit", {"kind": "key", "role": "logo", "baseVer": 2, "refs": refs}, ann, expect=400)


def test_a_brand_kit_whose_file_is_not_uploaded_is_refused(h):
    ann = h.as_person("ann")
    body = {"kind": "brand_kit", "baseVer": 0, "payload": {"logo": [{"variant": "logo", "asset": asset(99)}]}}
    _, out = h.call("POST", "/library/agency/brandkit", body, ann, expect=404)
    assert "has not been uploaded" in out["error"]["message"]


def test_the_same_name_from_another_browser_sees_it_and_publishes_the_next_version(h):
    publish(h, h.as_person("ann"))
    again = h.as_person("Ann")  # another browser, another case: the same person
    assert [k["key"] for k in h.call("GET", "/library/agency", token=again, expect=200)[1]["keys"]] == ["maya"]
    assert publish(h, again, base=1, variants=("front", "laughing"))["ver"] == 2
    assert h.call("GET", "/library/agency/maya/1", token=again, expect=200)[1]["by"] == "ann"  # old versions stay


def test_two_people_in_one_agency_share_the_library(h):
    publish(h, h.as_person("ann"))
    bob = h.as_person("bob")
    assert [k["key"] for k in h.call("GET", "/library/agency", token=bob, expect=200)[1]["keys"]] == ["maya"]
    assert h.call("GET", "/library/agency/maya", token=bob, expect=200)[1]["by"] == "ann"
    assert publish(h, bob, base=1)["ver"] == 2  # the next version of the agency's maya, for everyone


def test_another_agency_never_sees_the_library(h):
    publish(h, h.as_person("ann"))
    eve = h.as_person("eve", "red")
    out = h.call("GET", "/library/agency", token=eve, expect=200)[1]
    assert out["keys"] == [] and out["workspace"] == tenant_id("red")
    _, out = h.call("GET", "/library/agency/maya", token=eve, expect=404)
    assert out["error"]["code"] == "invalid_input"
    assert publish(h, eve)["ver"] == 1  # red's own maya, not the next version of blue's


def test_older_layouts_are_not_listed(h):
    tid = tenant_id("blue")
    h.blobs.put("library/blue/index.json", b'{"workspace": "blue", "keys": [{"key": "old", "ver": 1}]}', "application/json")
    h.blobs.put(f"tenants/{tid}/library/index.json", b'{"workspace": "x", "keys": [{"key": "old", "ver": 1}]}', "application/json")
    assert h.call("GET", "/library/agency", token=h.as_person("ann"), expect=200)[1]["keys"] == []


def test_publishing_over_a_newer_version_is_a_conflict_not_an_overwrite(h):
    ann = h.as_person("ann")
    publish(h, ann)
    publish(h, h.as_person("maya"), base=1)
    out = publish(h, ann, base=1, expect=409)
    assert out["error"]["code"] == "conflict"
    assert "maya published version 2 a moment ago" in out["error"]["message"] and "version 3" in out["error"]["message"]


def test_a_lost_index_race_reads_again_and_takes_the_next_version(h):
    ann = h.as_person("ann")
    publish(h, ann, key="lamp")
    real = h.blobs.put_json_if
    raced = []

    def racing(key, data, etag):
        if not raced:  # someone publishes another key between our read and our write
            raced.append(1)
            real(key, {**h.blobs.get_json(key), "keys": h.blobs.get_json(key)["keys"]}, etag)
            h.blobs.put(key, h.blobs.objects[key][0] + b" ", "application/json")
            return False
        return real(key, data, etag)

    h.blobs.put_json_if = racing
    assert publish(h, ann)["ver"] == 1
    assert sorted(k["key"] for k in h.call("GET", "/library/agency", token=ann, expect=200)[1]["keys"]) == ["lamp", "maya"]


def test_bad_publishes_are_refused(h):
    ann = h.as_person("ann")
    refs = [{"variant": "front", "asset": asset(77)}]  # never uploaded
    _, out = h.call("POST", "/library/agency/maya", {"kind": "key", "role": "character", "baseVer": 0, "refs": refs}, ann, expect=404)
    assert "has not been uploaded" in out["error"]["message"]
    twice = [{"variant": "front", "asset": upload(h, 1)}] * 2
    h.call("POST", "/library/agency/maya", {"kind": "key", "role": "character", "baseVer": 0, "refs": twice}, ann, expect=400)
    h.call("POST", "/library/agency/Maya_1", {"kind": "key", "role": "character", "baseVer": 0, "refs": twice[:1]}, ann, expect=400)
    h.call("POST", "/library/Agency/maya", {"kind": "key", "role": "character", "baseVer": 0, "refs": twice[:1]}, ann, expect=400)
    h.call("POST", "/library/agency/maya", {"kind": "key", "baseVer": 0, "refs": twice[:1]}, ann, expect=400)  # a key needs a role
    h.call("GET", "/library", token=ann, expect=404)  # a shelf is always named
    h.call("GET", "/library/agency", expect=401)
