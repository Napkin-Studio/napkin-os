"""The workspace library: solid keys published as immutable versions, shared within a workspace."""

from conftest import asset


def upload(h, n):
    a = asset(n)
    h.blobs.put(f"in/{a['sha256']}", b"png", "image/png")
    return a


def publish(h, token, key="maya", base=0, variants=("front", "side"), expect=200):
    refs = [{"variant": v, "asset": upload(h, i + 1)} for i, v in enumerate(variants)]
    return h.call("POST", f"/library/{key}", {"role": "character", "baseVer": base, "refs": refs}, token, expect=expect)[1]


def test_session_names_the_workspace_of_its_event_code(h):
    assert h.call("POST", "/session", {"eventCode": "acme", "handle": "ann"}, expect=200)[1]["workspace"] == "acme"
    assert h.call("POST", "/session", {"eventCode": "HACK", "handle": "bob"}, expect=200)[1]["workspace"] == "event"


def test_publish_list_and_read_back(h):
    ann = h.sign_in("ann", "ACME")
    entry = publish(h, ann)
    assert (entry["workspace"], entry["key"], entry["ver"], entry["by"]) == ("acme", "maya", 1, "ann")
    index = h.call("GET", "/library", token=ann, expect=200)[1]
    (row,) = index["keys"]
    assert row["variants"] == ["front", "side"] and row["cover"] == asset(1) and row["ver"] == 1
    assert h.call("GET", "/library/maya", token=ann, expect=200)[1] == entry
    assert h.call("GET", "/library/maya/1", token=ann, expect=200)[1] == entry


def test_a_teammate_on_another_code_of_the_workspace_sees_it_and_publishes_the_next_version(h):
    publish(h, h.sign_in("ann", "ACME"))
    cat = h.sign_in("cat", "ACME2")
    assert [k["key"] for k in h.call("GET", "/library", token=cat, expect=200)[1]["keys"]] == ["maya"]
    assert publish(h, cat, base=1, variants=("front", "laughing"))["ver"] == 2
    assert h.call("GET", "/library/maya/1", token=cat, expect=200)[1]["by"] == "ann"  # old versions stay


def test_another_workspace_sees_nothing(h):
    publish(h, h.sign_in("ann", "ACME"))
    bob = h.sign_in("bob", "HACK")
    assert h.call("GET", "/library", token=bob, expect=200)[1] == {"workspace": "event", "keys": []}
    _, out = h.call("GET", "/library/maya", token=bob, expect=404)
    assert out["error"]["code"] == "invalid_input"


def test_publishing_over_a_newer_version_is_a_conflict_not_an_overwrite(h):
    ann = h.sign_in("ann", "ACME")
    publish(h, ann)
    publish(h, ann, base=1)
    out = publish(h, ann, base=1, expect=409)
    assert out["error"]["code"] == "conflict" and "version 2" in out["error"]["message"]


def test_a_lost_index_race_reads_again_and_takes_the_next_version(h):
    ann = h.sign_in("ann", "ACME")
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
    ann = h.sign_in("ann", "ACME")
    refs = [{"variant": "front", "asset": asset(77)}]  # never uploaded
    _, out = h.call("POST", "/library/maya", {"role": "character", "baseVer": 0, "refs": refs}, ann, expect=404)
    assert "has not been uploaded" in out["error"]["message"]
    twice = [{"variant": "front", "asset": upload(h, 1)}] * 2
    h.call("POST", "/library/maya", {"role": "character", "baseVer": 0, "refs": twice}, ann, expect=400)
    h.call("POST", "/library/Maya_1", {"role": "character", "baseVer": 0, "refs": twice[:1]}, ann, expect=400)
    h.call("GET", "/library", expect=401)
