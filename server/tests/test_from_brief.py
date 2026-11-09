"""A research spun off a brief reads the brief, and one started from a
client's page knows its client (features/spinoff-and-links, research-new-ui).

The host sends `clan.upstream_ask` (the brief's ask) and
`clan.workspace_client` (the manifest's client). start_campaign's identify
proposes the brand and the client from them where the material names
neither: origin proposed, citing `<brief id>#<path>` (upstream_refs) or the
client id (workspace_ref). Never over the material, and always to confirm.
"""

from __future__ import annotations

import time

from napkin.pipeline import extract

from test_no_halt import LABELLED, TONIC, MiniHost, start
from test_pipeline import _research_schema_validator

BRIEF = "3f2a6b1c-1d2e-4f3a-8b4c-5d6e7f8a9b0c"
ASK = {"document_id": BRIEF, "direct": True, "fields": {
    "client": "Guinness (Diageo), for its alcohol-free stout",
    "audience": "18-24 year olds in Ireland and the UK.",
    "background": "Guinness wants a campaign for its alcohol-free product.",
}}
WORKSPACE = {"id": "cli_0b19a78d", "name": "Guinness"}
SHORT = "Research for the brief this started from, in Ireland."


class Host(MiniHost):
    def __init__(self, prompt, ask=None, workspace=None, **kw):
        super().__init__(prompt, **kw)
        self.ask, self.workspace = ask, workspace

    def clan(self):
        c = super().clan()
        if self.ask:
            c["upstream_ask"] = self.ask
        if self.workspace:
            c["workspace_client"] = self.workspace
        return c


def run_until_settled(job, host, timeout=30):
    """Poll as the view does until the job asks or ends."""
    t0 = time.monotonic()
    while time.monotonic() - t0 < timeout:
        host.apply(job.reply_change(host.clan()))
        v = job.view()
        if v["state"] in ("needs_input", "done", "failed"):
            for _ in range(3):
                host.apply(job.reply_change(host.clan()))
            return v
        time.sleep(0.005)
    raise AssertionError(f"the job did not settle: {job.view()}")


def test_brief_name_takes_the_workspace_client_or_the_first_proper_noun_phrase():
    assert extract.brief_name("Guinness (Diageo) — the 0.0 stout") == "Guinness"
    assert extract.brief_name("The client is Bank of Ireland, retail side.") == "Bank of Ireland"
    assert extract.brief_name("Orchard Hill Cider") == "Orchard Hill Cider"
    assert extract.brief_name("Diageo, for Guinness 0.0", WORKSPACE) == "Guinness"
    assert extract.brief_name("someone small") is None
    assert extract.brief_name("") is None


def test_a_research_spun_off_a_brief_proposes_the_brand_client_and_ask_from_it(store):
    host = Host(SHORT, ask=ASK, categories=["alcohol.beer_stout"])
    job = start(store, host)
    v = run_until_settled(job, host)
    camp = host.data["campaign"]
    # the brand and the client come from the brief's client paragraph, proposed
    assert camp["brand"]["value"] == {"ref": "brand/guinness", "name": "Guinness"}
    assert camp["brand"]["origin"] == "proposed"
    assert camp["brand"]["upstream_refs"] == [f"{BRIEF}#client"]
    assert camp["client_org"]["value"] == {"ref": "org/guinness", "name": "Guinness"}
    assert camp["client_org"]["origin"] == "proposed"
    assert camp["client_org"]["upstream_refs"] == [f"{BRIEF}#client"]
    # extract proposes the rest of the ask from it
    assert camp["audience_stated"]["value"] == "18-24 year olds in Ireland and the UK."
    assert camp["audience_stated"]["upstream_refs"] == [f"{BRIEF}#audience"]
    assert camp["problem"]["upstream_refs"] == [f"{BRIEF}#background"]
    # it went on past the brand: no "which brand" question
    assert not (v.get("question") or {}).get("address", "").endswith("#campaign.brand")
    ident = next(d for d in host.chain if d.get("action") == "identify" and f"{host.doc}#campaign.brand" in d["targets"])
    assert f"{BRIEF}#client" in ident["cites"]
    _research_schema_validator().validate({"campaign": {k: v for k, v in camp.items()}})


def test_the_material_s_brand_wins_over_the_brief(store):
    host = Host(LABELLED, ask=ASK, categories=TONIC)
    job = start(store, host)
    run_until_settled(job, host)
    brand = host.data["campaign"]["brand"]
    assert brand["value"]["name"] == "Harbour Tonic" and brand["origin"] == "extracted"
    assert "upstream_refs" not in brand


def test_a_stated_brand_is_never_replaced_by_the_brief(store):
    host = Host(SHORT, ask=ASK)
    host.data["campaign"]["brand"] = {"value": {"ref": "brand/guinness-0-0", "name": "Guinness 0.0"},
                                      "origin": "stated", "by": "human:u", "gate": "created",
                                      "decision": "d_TESTSTATED02"}
    job = start(store, host)
    run_until_settled(job, host)
    assert host.data["campaign"]["brand"]["origin"] == "stated"
    assert host.data["campaign"]["brand"]["value"]["name"] == "Guinness 0.0"


def test_a_research_from_the_client_page_proposes_the_workspace_client(store):
    host = Host(LABELLED, workspace={"id": "cli_0c19a78e", "name": "Harbour Drinks"}, categories=TONIC)
    job = start(store, host)
    run_until_settled(job, host)
    co = host.data["campaign"]["client_org"]
    assert co["value"] == {"ref": "org/harbour-drinks", "name": "Harbour Drinks"}
    assert co["origin"] == "proposed" and co["workspace_ref"] == "cli_0c19a78e"
    _research_schema_validator().validate({"campaign": {"client_org": co}})


def test_without_a_workspace_or_brief_the_client_stays_open(store):
    host = Host(LABELLED, categories=TONIC)
    job = start(store, host)
    run_until_settled(job, host)
    co = host.data["campaign"].get("client_org")
    assert co is None or co["origin"] != "proposed" or co.get("fact_ids")


def test_workspace_ref_is_only_for_client_org_in_the_schema():
    v = _research_schema_validator()
    env = {"value": {"ref": "org/guinness", "name": "Guinness"}, "origin": "proposed", "gate": "created",
           "decision": "d_TESTSTATED01", "workspace_ref": "cli_0b19a78d"}
    assert not list(v.iter_errors({"campaign": {"client_org": env}}))
    assert list(v.iter_errors({"campaign": {"problem": dict(env, value="x", gate="brief")}}))
