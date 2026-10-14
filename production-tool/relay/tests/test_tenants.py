"""The agency is the tenant (features/os-sign-in.clan): only agencies Napkin turned on may use the
tool, every job carries its tenant, and projects and the library are the agency's, shared within it.
Tenant items live in the private tenants table, never in config.json."""

import json

import pytest

from conftest import job_request
from contracts_dir import contracts_dir
from director import new_id
from identity import tenant_id
from scripts import tenants as tenants_script

A = "prj_01J9Z8Y7X6W5V4T3S2R1Q0P9N8"
NOT_ON = "The Production Tool is not on for your agency yet."

ROUTES = [
    ("GET", "/me", None),
    ("POST", "/jobs", "job"),
    ("GET", "/jobs/job_x", None),
    ("GET", "/projects", None),
    ("POST", "/clan", "clan"),
    ("GET", f"/clan/{A}", None),
    ("GET", "/library", None),
    ("POST", "/library/maya", {"role": "character", "baseVer": 0, "refs": []}),
    ("POST", "/uploads", {"sha256": "sha256:" + "a" * 64, "mime": "image/png", "bytes": 1}),
]


def send(h, token, method, path, body):
    if body == "clan":
        return h.relay.http(method, path, {"Authorization": f"Bearer {token}", "X-Project-Id": A}, b"PK\x03\x04x")[:2]
    if body == "job":
        body = job_request("generate", new_id("job"))
    return h.call(method, path, body, token)


@pytest.mark.parametrize("enabled", [None, False])
def test_an_agency_that_is_not_on_gets_flag_off_everywhere_but_health_and_config(h, enabled):
    token = h.as_person("ann", "acme", enable=False)
    if enabled is False:
        h.tenant("acme", enabled=False)
    for method, path, body in ROUTES:
        status, out = send(h, token, method, path, body)
        assert status == 403 and out["error"] == {"code": "flag_off", "message": NOT_ON, "retryable": False}, path
    assert not h.store.all_jobs() and not h.blobs.objects
    h.call("GET", "/health", expect=200)
    h.call("GET", "/config", expect=200)


def test_turning_an_agency_off_takes_effect_within_30_s(h):
    token = h.as_person("ann")
    h.call("GET", "/me", None, token, expect=200)
    h.store.put_tenant({"tenantId": tenant_id("blue"), "agency": "blue", "enabled": False})
    h.call("GET", "/me", None, token, expect=200)  # cached
    h.clock.tick(31)
    h.call("GET", "/me", None, token, expect=403)


def test_jobs_carry_their_tenant_and_logs_name_it(h):
    token = h.as_person("ann")
    job_id = new_id("job")
    status, out, ctx = h.relay.http("POST", "/jobs", {"Authorization": f"Bearer {token}"},
                                    json.dumps(job_request("generate", job_id)).encode())
    assert status == 200 and "_tenant" not in out  # internal: public() strips it
    assert h.store.get_job(job_id)["_tenant"] == tenant_id("blue")
    assert ctx["tenant"] == tenant_id("blue")


def test_two_people_in_one_agency_share_projects_and_a_stale_save_is_refused(h):
    ann, bob = h.as_person("ann"), h.as_person("bob")
    head = {"X-Project-Id": A, "Content-Type": "application/vnd.clan+zip"}
    status, saved, _ = h.relay.http("POST", "/clan", {**head, "Authorization": f"Bearer {ann}"}, b"PK\x03\x04one")
    assert status == 200
    assert [p["id"] for p in h.call("GET", "/projects", None, bob, expect=200)[1]["projects"]] == [A]
    etag = saved["project"]["etag"]
    assert h.relay.http("POST", "/clan", {**head, "Authorization": f"Bearer {bob}", "If-Match": etag},
                        b"PK\x03\x04bob")[0] == 200
    status, out, _ = h.relay.http("POST", "/clan", {**head, "Authorization": f"Bearer {ann}", "If-Match": etag},
                                  b"PK\x03\x04ann")
    assert status == 409 and out["error"]["code"] == "conflict"
    tid = tenant_id("blue")
    assert all(k.startswith(f"tenants/{tid}/projects/") for k in h.blobs.objects)


def test_old_per_person_saves_are_not_listed(h):
    ann = h.as_person("ann")
    pid = h.call("GET", "/me", None, ann, expect=200)[1]["participantId"]
    h.blobs.put(f"clan/{pid}/projects.json", json.dumps({"projects": [{"id": A}]}).encode(), "application/json")
    assert h.call("GET", "/projects", None, ann, expect=200)[1] == {"projects": []}


def test_config_has_no_tenant_data(h):
    h.as_person("ann")
    _, cfg = h.call("GET", "/config", expect=200)
    assert "tenants" not in cfg and "blue" not in json.dumps(cfg)
    for f in (contracts_dir() / "examples").glob("config.*.json"):
        assert "tenants" not in json.loads(f.read_text()), f.name


def test_the_tenants_script_puts_shows_and_lists(h, capsys):
    assert tenants_script.main(["show", "napkin"], store=h.store) == 1
    assert tenants_script.main(["put", "napkin", "--enabled", "--by", "shrey"], store=h.store) == 0
    item = h.store.tenant(tenant_id("napkin"))
    assert (item["agency"], item["enabled"], item["by"]) == ("napkin", True, "shrey")
    # put keeps what tenant-limits will add to the same item
    h.store.put_tenant({**item, "capUsdMonthly": 500})
    tenants_script.main(["put", "napkin", "--disabled", "--by", "shrey"], store=h.store)
    item = h.store.tenant(tenant_id("napkin"))
    assert item["enabled"] is False and item["capUsdMonthly"] == 500
    capsys.readouterr()
    tenants_script.main(["list"], store=h.store)
    assert "napkin" in capsys.readouterr().out
    with pytest.raises(SystemExit):
        tenants_script.main(["put", "napkin"], store=h.store)  # on or off must be said


def test_the_tenants_script_sets_an_agencys_limits_and_allowlist(h, capsys):
    """Each agency's cap, daily quotas and allowlist, set by staff on the agency's request
    (features/tenant-limits.clan); put changes only what it is given."""
    tid = tenant_id("napkin")
    assert tenants_script.main(["put", "napkin", "--enabled", "--by", "shrey"], store=h.store) == 0
    tenants_script.main(["put", "napkin", "--cap", "400", "--daily-quotas", "on", "--by", "shrey"], store=h.store)
    tenants_script.main(["put", "napkin", "--makers", "runway", "--claude", "off", "--by", "shrey"], store=h.store)
    item = h.store.tenant(tid)
    assert (item["enabled"], item["capUsdMonthly"], item["dailyQuotas"]) == (True, 400.0, True)
    assert item["allow"] == {"claude": False, "makers": ["runway"]}
    h.relay._tenants.pop(tid, None)
    assert h.relay._policy(tid) == {"cap": 400.0, "dailyQuotas": True, "allow": {"claude": False, "makers": ["runway"]}}
    tenants_script.main(["put", "napkin", "--cap", "off", "--by", "shrey"], store=h.store)
    assert h.store.tenant(tid)["capUsdMonthly"] is None
    capsys.readouterr()
    tenants_script.main(["show", "napkin"], store=h.store)
    shown = json.loads(capsys.readouterr().out)
    assert shown["applies"]["capUsdMonthly"] is None and shown["applies"]["allow"]["makers"] == ["runway"]
    tenants_script.main(["put", "napkin", "--defaults", "--by", "shrey"], store=h.store)
    item = h.store.tenant(tid)
    assert not {"capUsdMonthly", "dailyQuotas", "allow"} & set(item) and item["enabled"] is True
    with pytest.raises(SystemExit):
        tenants_script.main(["put", "napkin", "--makers", "runway,acme"], store=h.store)  # not in the notice
    with pytest.raises(SystemExit):
        tenants_script.main(["put", "napkin", "--cap", "lots"], store=h.store)
    with pytest.raises(SystemExit):
        tenants_script.main(["put", "newco", "--cap", "10"], store=h.store)  # a new item says on or off first
