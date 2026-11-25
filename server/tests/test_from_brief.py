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


def test_a_client_name_with_digits_does_not_fail_identify(store):
    # UAT round 2 (2026-11-12): the workspace client "UAT 11120718" put an uncited point with
    # digits in identify's reasoning; make() refused it as a figure and the whole stage raised,
    # leaving the run with no categories and an empty report. The point now cites the client.
    host = Host(LABELLED, workspace={"id": "cli_7e1e7e11", "name": "7-Eleven 2025"}, categories=TONIC)
    job = start(store, host)
    run_until_settled(job, host)
    co = host.data["campaign"]["client_org"]
    assert co["origin"] == "proposed" and co["workspace_ref"] == "cli_7e1e7e11"
    idec = [d for d in host.chain if "Settled" in (d.get("reasoning") or {}).get("decided", "")]
    assert idec, "identify wrote its decision"
    pts = idec[-1]["reasoning"]["because"]
    assert any(p.get("cites") == ["cli_7e1e7e11"] and "7-Eleven 2025" in p["point"] for p in pts)


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


# Acceptance A1 (2026-11-24): a research started from Copperell's client page asked "Which brand is the
# client's?" and offered only the competitors the question named. The client it was started for is the brand.
COMPETITORS = "The brands in this brief: Smol Home and Method Spray. Who leads refill cleaning sprays in Ireland?"
COPPERELL = {"id": "cli_c0ffee11", "name": "Copperell Home Ltd"}


def test_a_research_from_the_client_page_takes_the_client_as_the_brand_not_a_competitor(store):
    host = Host(COMPETITORS, workspace=COPPERELL, categories=TONIC)
    job = start(store, host)
    v = run_until_settled(job, host)
    assert v["state"] != "needs_input", "no question: the client is known"
    assert not any("Which brand is the client" in (m.get("text") or "")
                   for m in host.data.get("intake", {}).get("messages", {}).values())
    b = host.data["campaign"]["brand"]
    assert b["value"] == {"ref": "brand/copperell-home", "name": "Copperell Home"}
    assert b["origin"] == "proposed" and b["workspace_ref"] == "cli_c0ffee11"
    _research_schema_validator().validate({"campaign": {"brand": b}})
    d = next(d for d in host.chain if "brand" in " ".join(d.get("fields_changed") or []))
    assert any(r["option"] == "Smol Home as the client's brand" for r in d["reasoning"]["rejected"])


def test_a_brand_named_like_the_client_is_the_clients(store):
    host = Host("The brands in this brief: Copperell Refill and Method Spray. Launch it in Ireland.",
                workspace=COPPERELL, categories=TONIC)
    job = start(store, host)
    run_until_settled(job, host)
    b = host.data["campaign"]["brand"]
    assert b["value"]["name"] == "Copperell Refill"
    assert b["origin"] == "proposed" and b["workspace_ref"] == "cli_c0ffee11" and b["source"]["material_id"]
    _research_schema_validator().validate({"campaign": {"brand": b}})


def test_without_a_client_page_two_named_brands_still_ask(store):
    host = Host(COMPETITORS, categories=TONIC)
    job = start(store, host)
    v = run_until_settled(job, host)
    assert v["state"] == "needs_input" and "brand" not in host.data["campaign"]


def test_the_clients_brand_name_and_its_house():
    from napkin.rules import identify as id_rules
    assert id_rules.client_brand_name("Copperell Home Ltd") == "Copperell Home"
    assert id_rules.client_brand_name("Acme Foods plc.") == "Acme Foods"
    assert id_rules.client_brand_name("Guinness") == "Guinness"
    assert id_rules.same_house("Copperell Refill", "Copperell Home Ltd")
    assert id_rules.same_house("Copperell", "Copperell Home")
    assert id_rules.same_house("Harbour", "Harbour Drinks")
    assert not id_rules.same_house("Smol", "Copperell Home")
    assert not id_rules.same_house("Method", "Methodist Press")
    assert not id_rules.same_house("BMW", "BM Wines"), "a short shared word is not a house"
