"""The library: solid keys published as immutable versions, in the agency's workspace.

Rewritten for features/os-sign-in.clan (2026-10-13): the agency is the tenant and its workspace, so a
library is shared by everyone in the agency, under tenants/<tenantId>/library/, and never seen by
another agency. (personal-workspaces.clan had one library per name.)
"""

from conftest import asset
from identity import tenant_id


def upload(h, n):
    a = asset(n)
    h.blobs.put(f"in/{a['sha256']}", b"png", "image/png")
    return a


def publish(h, token, key="maya", base=0, variants=("front", "side"), expect=200):
    refs = [{"variant": v, "asset": upload(h, i + 1)} for i, v in enumerate(variants)]
    return h.call("POST", f"/library/{key}", {"role": "character", "baseVer": base, "refs": refs}, token, expect=expect)[1]


def test_the_workspace_is_the_agency(h):
    ann = h.call("GET", "/me", token=h.as_person("ann"), expect=200)[1]
    assert ann["workspace"] == tenant_id("blue") == ann["tenant"]["id"]
    bob = h.call("GET", "/me", token=h.as_person("bob"), expect=200)[1]
    assert bob["workspace"] == ann["workspace"] and bob["participantId"] != ann["participantId"]
    eve = h.call("GET", "/me", token=h.as_person("eve", "red"), expect=200)[1]
    assert eve["workspace"] == tenant_id("red") != ann["workspace"]


def test_publish_list_and_read_back(h):
    ann = h.as_person("ann")
    entry = publish(h, ann)
    tid = tenant_id("blue")
    assert (entry["workspace"], entry["key"], entry["ver"], entry["by"]) == (tid, "maya", 1, "ann")
    assert f"tenants/{tid}/library/index.json" in h.blobs.objects
    assert f"tenants/{tid}/library/maya/1.json" in h.blobs.objects
    index = h.call("GET", "/library", token=ann, expect=200)[1]
    (row,) = index["keys"]
    assert row["variants"] == ["front", "side"] and row["cover"] == asset(1) and row["ver"] == 1
    assert h.call("GET", "/library/maya", token=ann, expect=200)[1] == entry
    assert h.call("GET", "/library/maya/1", token=ann, expect=200)[1] == entry


def test_the_same_name_from_another_browser_sees_it_and_publishes_the_next_version(h):
    publish(h, h.as_person("ann"))
    again = h.as_person("Ann")  # another browser, another case: the same person
    assert [k["key"] for k in h.call("GET", "/library", token=again, expect=200)[1]["keys"]] == ["maya"]
    assert publish(h, again, base=1, variants=("front", "laughing"))["ver"] == 2
    assert h.call("GET", "/library/maya/1", token=again, expect=200)[1]["by"] == "ann"  # old versions stay


def test_two_people_in_one_agency_share_the_library(h):
    publish(h, h.as_person("ann"))
    bob = h.as_person("bob")
    assert [k["key"] for k in h.call("GET", "/library", token=bob, expect=200)[1]["keys"]] == ["maya"]
    assert h.call("GET", "/library/maya", token=bob, expect=200)[1]["by"] == "ann"
    assert publish(h, bob, base=1)["ver"] == 2  # the next version of the agency's maya, for everyone


def test_another_agency_never_sees_the_library(h):
    publish(h, h.as_person("ann"))
    eve = h.as_person("eve", "red")
    out = h.call("GET", "/library", token=eve, expect=200)[1]
    assert out["keys"] == [] and out["workspace"] == tenant_id("red")
    _, out = h.call("GET", "/library/maya", token=eve, expect=404)
    assert out["error"]["code"] == "invalid_input"
    assert publish(h, eve)["ver"] == 1  # red's own maya, not the next version of blue's


def test_the_hackathon_library_is_not_listed(h):
    h.blobs.put("library/blue/index.json", b'{"workspace": "blue", "keys": [{"key": "old", "ver": 1}]}', "application/json")
    assert h.call("GET", "/library", token=h.as_person("ann"), expect=200)[1]["keys"] == []


def test_publishing_over_a_newer_version_is_a_conflict_not_an_overwrite(h):
    ann = h.as_person("ann")
    publish(h, ann)
    publish(h, ann, base=1)
    out = publish(h, ann, base=1, expect=409)
    assert out["error"]["code"] == "conflict" and "version 2" in out["error"]["message"]


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
    assert sorted(k["key"] for k in h.call("GET", "/library", token=ann, expect=200)[1]["keys"]) == ["lamp", "maya"]


def test_bad_publishes_are_refused(h):
    ann = h.as_person("ann")
    refs = [{"variant": "front", "asset": asset(77)}]  # never uploaded
    _, out = h.call("POST", "/library/maya", {"role": "character", "baseVer": 0, "refs": refs}, ann, expect=404)
    assert "has not been uploaded" in out["error"]["message"]
    twice = [{"variant": "front", "asset": upload(h, 1)}] * 2
    h.call("POST", "/library/maya", {"role": "character", "baseVer": 0, "refs": twice}, ann, expect=400)
    h.call("POST", "/library/Maya_1", {"role": "character", "baseVer": 0, "refs": twice[:1]}, ann, expect=400)
    h.call("GET", "/library", expect=401)
