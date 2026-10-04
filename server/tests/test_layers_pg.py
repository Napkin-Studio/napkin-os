"""PgLayers: the `Layers` protocol in process on the layers' Postgres schema
(layers-service/migrations), checked the way layers_contract.py (peripherals.md
§8.4) checks a layers service, against a real PostgreSQL.

The databases are made the way provision-databases.sh makes Aurora's: per
database an owner role that owns it and an app role that owns nothing, so the
forced row-level security applies to what PgLayers does. Postgres comes from
NAPKIN_TEST_PG_ADMIN (a superuser URI on a disposable server, trust auth),
else pgserver when installed (a PostgreSQL 16, Aurora's major:
`uv run --with pgserver python -m pytest`), else initdb/pg_ctl on PATH. With
none of them the module is skipped.

Where the schema is stricter than the HTTP mock (evidence needs a verbatim
quote, the category layer speaks only the measure list, an earlier period is
history not a contest) the test says so by name.
"""

from __future__ import annotations

import itertools
import os
import re
import secrets
import shutil
import socket
import subprocess
import sys
import tempfile
from pathlib import Path

import psycopg
import pytest
from psycopg import sql
from psycopg.conninfo import conninfo_to_dict, make_conninfo

from napkin.layers import origin_uri
from napkin.layers.http import LayersError
from napkin.layers.pg import PgLayerStore, conninfo, source_id

LAYERS_SERVICE = Path(__file__).resolve().parents[2] / "layers-service"
ORIGIN_RE = r"^fact://(brand|category)/.+/[a-z0-9_]+(\.[a-z0-9_]+)*@[1-9][0-9]*$"
ROW_KEYS = {"id", "layer", "entity", "key", "market", "value", "unit", "as_of", "retrieved_at", "status", "version",
            "supersedes", "licence", "method", "decision", "origin", "sources", "source_records"}
LEAF_KEYS = {"code", "name", "vertical", "vertical_name", "aliases", "regulated", "provisional"}
A, B = "org/test-agency", "org/other"
X, Y = "brand/x", "brand/y"


# ---------------------------------------------------------------------------- a real Postgres

def _free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


def _postgres():
    """(superuser conninfo, stop()) or skip."""
    admin = os.environ.get("NAPKIN_TEST_PG_ADMIN")
    if admin:
        return admin, lambda: None
    try:
        import pgserver  # noqa: PLC0415
        srv = pgserver.get_server(tempfile.mkdtemp(prefix="napkin-pglayers-"), cleanup_mode="stop")
        return srv.get_uri("postgres"), lambda: None
    except ImportError:
        pass
    initdb, pg_ctl = shutil.which("initdb"), shutil.which("pg_ctl")
    if not (initdb and pg_ctl):
        pytest.skip("no PostgreSQL for the PgLayers tests: set NAPKIN_TEST_PG_ADMIN, install pgserver, "
                    "or put initdb/pg_ctl on PATH")
    d = Path(tempfile.mkdtemp(prefix="napkin-pglayers-"))
    try:
        subprocess.run([initdb, "-D", str(d / "data"), "-U", "postgres", "--auth=trust", "-E", "UTF8"],
                       check=True, capture_output=True)
        port = _free_port()
        subprocess.run([pg_ctl, "-D", str(d / "data"), "-l", str(d / "log"), "-w", "-o",
                        f"-k {d} -p {port} -c listen_addresses=''", "start"], check=True, capture_output=True)
    except (subprocess.CalledProcessError, OSError) as e:
        pytest.skip(f"could not start a local PostgreSQL: {e}")
    stop = lambda: subprocess.run([pg_ctl, "-D", str(d / "data"), "-m", "immediate", "stop"],  # noqa: E731
                                  capture_output=True)
    return make_conninfo(host=str(d), port=str(port), user="postgres", dbname="postgres"), stop


def _as(base: str, db: str, user: str) -> str:
    kw = conninfo_to_dict(base)
    kw.pop("password", None)
    kw.update(dbname=db, user=user)
    return make_conninfo(**kw)


@pytest.fixture(scope="session")
def pg():
    sys.path.insert(0, str(LAYERS_SERVICE))
    try:
        from napkin_layers.migrate import migrate  # noqa: PLC0415
    finally:
        sys.path.remove(str(LAYERS_SERVICE))
    base, stop = _postgres()
    run = "t" + secrets.token_hex(3)
    dbs = {f"{run}_category": ("category", None), f"{run}_agency_test_agency": ("agency", A),
           f"{run}_agency_other": ("agency", B)}
    with psycopg.connect(base, autocommit=True) as su:
        for db in dbs:
            su.execute(sql.SQL("CREATE ROLE {} NOLOGIN").format(sql.Identifier(f"{db}_owner")))
            su.execute(sql.SQL("CREATE ROLE {} LOGIN").format(sql.Identifier(f"{db}_app")))
            su.execute(sql.SQL("CREATE DATABASE {} OWNER {}").format(sql.Identifier(db), sql.Identifier(f"{db}_owner")))
            su.execute(sql.SQL("REVOKE ALL ON DATABASE {} FROM PUBLIC").format(sql.Identifier(db)))
            su.execute(sql.SQL("GRANT CONNECT, TEMPORARY ON DATABASE {} TO {}").format(
                sql.Identifier(db), sql.Identifier(f"{db}_app")))
    su_user = conninfo_to_dict(base).get("user") or "postgres"
    for db, (kind, agency) in dbs.items():
        with psycopg.connect(_as(base, db, su_user), autocommit=True) as c:
            migrate(c, kind, f"{db}_owner", f"{db}_app", agency)
    yield {"base": base, "run": run, "su": su_user,
           "category": _as(base, f"{run}_category", f"{run}_category_app"),
           "agency": _as(base, f"{run}_agency_{{agency}}", f"{run}_agency_{{agency}}_app")}
    stop()


@pytest.fixture(scope="session")
def store(pg):
    st = PgLayerStore(pg["category"], pg["agency"], timeout=30)
    yield st
    st.close()


@pytest.fixture
def layers(store):
    return store.open({"org": A, "brand": X})


# Fact ids come back as documents carry them (upper-case hex); the database keeps
# lower case (pg._doc_id), so a direct query lower-cases them.
def owner_rows(pg, db: str, query: str, params=()):
    """Read as the superuser (no RLS): for checking what was or was not written."""
    with psycopg.connect(_as(pg["base"], f"{pg['run']}_{db}", pg["su"]), autocommit=True) as c:
        return c.execute(query, params).fetchall()


_n = itertools.count(1)


def dec(**kw) -> dict:
    d = {"id": f"d_PG{next(_n):06d}", "kind": "pin", "handler": "t@1.0", "action": "t", "rationale": "r",
         "cites": [], "reasoning": {"decided": "a test", "because": []}}
    d.update(kw)
    return d


def src(uri, tier="primary", licence="open", **kw):
    return {"uri": uri, "tier": tier, "domain": uri.split("/")[2] if "//" in uri else "", "licence": licence,
            "retrieved_at": "2026-09-20", **kw}


def fact(value, entity="category/automotive.ev_charging", key="market.value_growth_yoy", as_of="2025-12-31",
         **kw):
    f = {"layer": "category", "entity": entity, "key": key, "market": "IE", "value": value, "unit": "proportion",
         "as_of": as_of, "retrieved_at": "2026-09-20", "sources": [], "licence": "open", "method": "report"}
    f.update(kw)
    return f


# ---------------------------------------------------------------------------- the tree

def test_categories(layers):
    leaves = layers.leaves()
    assert leaves and all(set(l) == LEAF_KEYS for l in leaves)
    assert len({l["code"] for l in leaves}) == len(leaves)
    assert any(l["code"] == "alcohol.cider" for l in leaves)
    v = layers.vertical_of("automotive.hybrid")
    assert v["name"] == "Automotive" and "automotive.hybrid" in v["leaves"]
    assert layers.vertical_of("nosuch.leaf") is None
    assert layers.find("cider") == ["alcohol.cider"]


# ---------------------------------------------------------------------------- sources

def test_sources_one_row_per_uri_and_confidential_ones_stay_with_their_org(store, pg):
    L, Lb = store.open({"org": A, "brand": X}), store.open({"org": B, "brand": X})
    s1 = L.add_source(src("https://example.org/pg/one", title="One", publisher="Ex", published_at="2026-03-01"))
    assert s1 == source_id("https://example.org/pg/one")
    assert L.add_source(src("https://example.org/pg/one", tier="secondary", title="Again")) == s1
    with pytest.raises(LayersError, match="invalid_input"):
        L.add_source({k: v for k, v in src("https://example.org/pg/nolicence").items() if k != "licence"})
    cid = L.add_source({"uri": "human:pg-alice", "tier": "reviewer-verified", "domain": "",
                        "licence": "client-confidential", "title": "confirmed in the chat"})
    got = L.sources([s1, cid, "src_nosuchsource"])
    assert [s["id"] for s in got] == [s1, cid]
    assert got[0]["title"] == "One" and got[0]["published_at"] == "2026-03-01" and got[0]["retrieved_at"] == "2026-09-20"
    assert [s["id"] for s in Lb.sources([cid, s1])] == [s1]
    # where they live: the open one in the shared database, the confidential one in A's own
    assert owner_rows(pg, "category", "SELECT licence FROM layers.sources WHERE id = %s", (s1,)) == [("open",)]
    assert owner_rows(pg, "category", "SELECT 1 FROM layers.sources WHERE id = %s", (cid,)) == []
    assert owner_rows(pg, "agency_test_agency", "SELECT licence FROM layers.sources WHERE id = %s",
                      (cid,)) == [("client-confidential",)]


# ---------------------------------------------------------------------------- append

def test_the_append_outcomes_on_one_identity(store, pg):
    L, Lb = store.open({"org": A, "brand": X}), store.open({"org": B, "brand": Y})
    ent = "category/automotive.hybrid"
    s1 = L.add_source(src("https://example.org/pg/a1"))
    s2 = L.add_source(src("https://example.org/pg/a2", retrieved_at="2026-09-22"))
    d1 = dec()
    r1 = L.append(fact(0.2, entity=ent, sources=[s1], quotes={s1: "BEV share rose to 20 per cent"}), d1)
    assert set(r1) == ROW_KEYS
    # ids as a document's schema takes them (campaign-research: ^f_[0-9A-Z]{6,}$), seeded rows' too
    assert re.fullmatch(r"f_[0-9A-Z]{6,}", r1["id"]) and re.fullmatch(r"d_[0-9A-Z]{6,}", r1["decision"] or "d_X" * 3)
    assert r1["version"] == 1 and r1["status"] == "active" and r1["decision"] == d1["id"]
    assert r1["sources"] == [s1] and r1["source_records"][0]["quote"] == "BEV share rose to 20 per cent"
    assert r1["origin"] == origin_uri("category", ent, "market.value_growth_yoy", 1)
    assert re.match(ORIGIN_RE, r1["origin"])
    assert r1["market"] == "IE" and r1["as_of"] == "2025-12-31" and r1["retrieved_at"] == "2026-09-20"
    # a category fact written under A is visible under B
    assert [f["id"] for f in Lb.facts("category", ent, key="market.value_growth_yoy")] == [r1["id"]]
    # corroborated: the same row, the second source linked with its quote
    r2 = L.append(fact(0.2, entity=ent, sources=[s2], quotes={s2: "20 per cent of new cars"}), dec())
    assert r2["id"] == r1["id"] and r2["sources"] == [s1, s2] and r2["retrieved_at"] == "2026-09-22"
    # superseded by a later as_of
    r3 = L.append(fact(0.25, entity=ent, as_of="2026-06-30", sources=[s1], quotes={s1: "now 25 per cent"}), dec())
    assert r3["version"] == 2 and r3["supersedes"] == r1["id"] and r3["status"] == "active"
    assert [f["id"] for f in L.facts("category", ent, key="market.value_growth_yoy")] == [r3["id"]]
    assert L.resolve(r1["origin"])["status"] == "superseded"
    # the same period, another value: contested, both rows
    r4 = L.append(fact(0.3, entity=ent, as_of="2026-06-30", sources=[s2], quotes={s2: "30 per cent"}), dec())
    assert r4["version"] == 3 and r4["status"] == "contested"
    cur = L.facts("category", ent, key="market.value_growth_yoy")
    assert {f["id"] for f in cur} == {r3["id"], r4["id"]} and {f["status"] for f in cur} == {"contested"}
    # schema, not §4.4: another value for an EARLIER period is history (kept, never current), not a contest
    r5 = L.append(fact(0.1, entity=ent, as_of="2024-12-31", sources=[s1], quotes={s1: "10 per cent in 2024"}),
                  dec())
    assert r5["version"] == 4 and r5["status"] == "superseded"   # history reads as not current
    assert owner_rows(pg, "category", "SELECT status FROM layers.facts WHERE id = %s", (r5["id"].lower(),)) == [("history",)]
    assert r5["id"] not in {f["id"] for f in L.facts("category", ent, key="market.value_growth_yoy")}
    # versions count per entity + key across markets; the market filter sees the market and what applies to it
    r6 = L.append(fact(0.4, entity=ent, market="GB", sources=[s1], quotes={s1: "40 per cent in the UK"}), dec())
    assert r6["version"] == 5
    assert [f["market"] for f in L.facts("category", ent, key="market.value_growth_yoy", market="GB")] == ["GB"]
    r7 = L.append(fact(0.5, entity=ent, market="EU", sources=[s2], quotes={s2: "half across the EU"}), dec())
    ie = L.facts("category", ent, key="market.value_growth_yoy", market="IE")
    assert r7["id"] in {f["id"] for f in ie} and "GB" not in {f["market"] for f in ie}
    # one transaction: the decision is in the category database, private to the org that wrote it
    assert owner_rows(pg, "category", "SELECT org FROM layers.decisions WHERE id = %s", (d1["id"],)) == [(A,)]


def test_the_quote_is_found_in_the_stored_passage_when_there_is_one(layers, pg):
    """Seeded research keeps the page's passages; a quote inside one links to that span."""
    sid = layers.add_source(src("https://example.org/pg/seeded"))
    passage = "In 2025 the category grew by 12 per cent, the fastest in a decade."
    owner_rows(pg, "category", "INSERT INTO layers.excerpts (id, capture_id, ordinal, text) VALUES (%s, %s, 0, %s) "
                               "RETURNING id", ("exc_pgseeded", "cap_" + __import__("hashlib").sha256(
                                   f"{sid}\x1f2026-09-20".encode()).hexdigest()[:24], passage))
    row = layers.append(fact(0.12, entity="category/alcohol.cider", sources=[sid],
                             quotes={sid: "grew by 12 per cent"}), dec())
    ev = owner_rows(pg, "category", "SELECT excerpt_id, quote_start FROM layers.evidence WHERE fact_id = %s",
                    (row["id"].lower(),))
    assert ev == [("exc_pgseeded", passage.index("grew by 12 per cent"))]


def test_validation_and_atomicity(layers, store, pg):
    """Each refused append leaves no decision, no fact and no evidence behind."""
    s1 = layers.add_source(src("https://example.org/pg/v1"))
    other = store.open({"org": B, "brand": X})
    cid = other.add_source({"uri": "human:pg-bob", "tier": "reviewer-verified", "domain": "",
                            "licence": "client-confidential"})
    q = {s1: "a quote"}
    cases = {
        "missing licence": ({k: v for k, v in fact(0.5, sources=[s1], quotes=q).items() if k != "licence"},
                            "invalid_input"),
        "object value": (fact({"a": 1}, sources=[s1], quotes=q), "invalid_input"),
        "null value": (fact(None, sources=[s1], quotes=q), "invalid_input"),
        "bad entity": (fact(0.5, entity="Category/EV", sources=[s1], quotes=q), "invalid_input"),
        "bad key": (fact(0.5, key="Bad Key", sources=[s1], quotes=q), "invalid_input"),
        "bad market": (fact(0.5, market="Ireland", sources=[s1], quotes=q), "invalid_input"),
        "status other than contested": (fact(0.5, status="active", sources=[s1], quotes=q), "invalid_input"),
        "quote for a source not cited": (fact(0.5, quotes=q), "invalid_input"),
        "unknown source id": (fact(0.5, sources=["src_nosuchsource"]), "invalid_input"),
        "another org's confidential source": (fact(0.5, sources=[cid]), "invalid_input"),
        "unknown leaf": (fact(0.5, entity="category/automotive.nosuch", sources=[s1], quotes=q), "unknown_leaf"),
        # schema, not the mock: no quoted evidence, no fact
        "no evidence": (fact(0.5, sources=[s1]), "no_evidence"),
        "no sources": (fact(0.5), "no_evidence"),
        # schema, not the mock: the category layer speaks only the measure list
        "unlisted measure": (fact(0.5, key="market.bev_share", sources=[s1], quotes=q), "unknown_measure"),
        "unit outside the measure": (fact(0.5, unit="eur", sources=[s1], quotes=q), "invalid_input"),
        "measure needing a qualifier": (fact(0.5, key="market.player_share", sources=[s1], quotes=q),
                                        "invalid_input"),
    }
    for name, (f, want) in cases.items():
        d = dec()
        with pytest.raises(LayersError, match=want):
            layers.append(f, d)
        assert owner_rows(pg, "category", "SELECT 1 FROM layers.decisions WHERE id = %s", (d["id"],)) == [], name
        assert owner_rows(pg, "category", "SELECT 1 FROM layers.facts WHERE decision_id = %s", (d["id"],)) == [], name
        assert owner_rows(pg, "category", "SELECT 1 FROM layers.evidence WHERE decision_id = %s",
                          (d["id"],)) == [], name
    # the unlisted measure was proposed, with the passage, for a planner (the schema's own path)
    assert owner_rows(pg, "category", "SELECT proposed, quote, proposed_by_org FROM layers.measure_proposals "
                                      "WHERE proposed = 'market.bev_share'") == [("market.bev_share", "a quote", A)]


def test_a_source_cited_without_a_quote_is_not_linked(layers):
    s1 = layers.add_source(src("https://example.org/pg/q1"))
    s2 = layers.add_source(src("https://example.org/pg/q2"))
    row = layers.append(fact(0.07, entity="category/alcohol.wine", sources=[s1, s2], quotes={s1: "7 per cent"}),
                        dec())
    assert row["sources"] == [s1]


def test_idempotency(layers):
    s1 = layers.add_source(src("https://example.org/pg/i1"))
    d = dec()
    body = fact(0.6, entity="category/alcohol.low_no", as_of="2026-09-01", sources=[s1], quotes={s1: "60 per cent"})
    first = layers.append(body, d)
    assert layers.append(body, d) == first
    assert [f["version"] for f in layers.facts("category", "category/alcohol.low_no")] == [1]
    with pytest.raises(LayersError, match="idempotency_conflict"):
        layers.append({**body, "as_of": "2026-09-02"}, d)    # same key (decision + identity + value), another body


# ---------------------------------------------------------------------------- the brand layer

def test_scope_isolation_and_pins(store, pg):
    L = store.open({"org": A, "brand": X})
    s = L.add_source(src("https://example.org/pg/brand"))
    bf = {**fact("hello", sources=[s], quotes={s: "hello"}), "layer": "brand", "entity": X,
          "key": "positioning.tagline", "market": None, "unit": "text", "licence": "client-confidential"}
    row = L.append(bf, dec())
    assert row["market"] is None and row["layer"] == "brand" and row["sources"] == [s]
    assert [f["id"] for f in L.facts("brand", X, key="positioning.tagline")] == [row["id"]]
    assert store.open({"org": A, "brand": Y}).facts("brand", X, key="positioning.tagline") == []
    assert store.open({"org": B, "brand": X}).facts("brand", X, key="positioning.tagline") == []
    assert L.resolve(row["origin"])["id"] == row["id"]
    assert store.open({"org": B, "brand": X}).resolve(row["origin"]) is None
    assert L.resolve("fact://category/automotive.ev_charging/market.nosuch@1") is None
    # the brand fact lives in A's database, its open source copied there with the same id
    assert owner_rows(pg, "agency_test_agency", "SELECT market, org, brand FROM layers.facts WHERE id = %s",
                      (row["id"].lower(),)) == [("UNKNOWN", A, X)]
    assert owner_rows(pg, "agency_test_agency", "SELECT id FROM layers.sources WHERE id = %s", (s,)) == [(s,)]
    assert owner_rows(pg, "category", "SELECT 1 FROM layers.facts WHERE id = %s", (row["id"].lower(),)) == []


def test_a_confidential_source_backs_a_brand_fact_never_a_category_one(layers):
    m = layers.add_source({"uri": "material:pgsha", "tier": "primary", "domain": "material-pg",
                           "licence": "client-confidential", "title": "Brief.pdf", "retrieved_at": "2026-09-20"})
    q = {m: "Our share is 14 per cent"}
    row = layers.append({**fact(0.14, sources=[m], quotes=q), "layer": "brand", "licence": "client-confidential"},
                        dec())
    assert row["source_records"][0]["licence"] == "client-confidential"
    with pytest.raises(LayersError, match="invalid_input"):
        layers.append(fact(0.14, sources=[m], quotes=q, licence="client-confidential"), dec())


def test_a_person_attests_the_value(layers, pg):
    """verify_finding / correct_fact: a reviewer-verified source with no quote;
    the evidence is the value the person confirmed."""
    who = layers.add_source({"uri": "human:pg-carol", "tier": "reviewer-verified", "domain": "human:pg-carol",
                             "licence": "open", "title": "verified in the document"})
    row = layers.append({"layer": "brand", "entity": X, "key": "synthesis.f_pg1", "market": None,
                         "value": "Hybrids lead in Dublin", "unit": "text", "as_of": "2026-09-01",
                         "retrieved_at": "2026-10-04", "sources": [who], "quotes": {}, "licence": "open",
                         "method": "synthesis"}, dec(kind="verify"))
    assert row["sources"] == [who] and row["source_records"][0]["quote"] == "Hybrids lead in Dublin"
    assert row["retrieved_at"] == "2026-10-04"


def test_roster(store, pg):
    L = store.open({"org": A, "brand": X})
    who = L.add_source({"uri": "human:pg-dave", "tier": "reviewer-verified", "domain": "human:pg-dave",
                        "licence": "client-confidential", "title": "confirmed in the chat"})
    rd = dec(kind="roster")
    rows = L.set_roster("brand/pg-bmw", "PG BMW", ["automotive.ev_charging", "automotive.hybrid"], rd, [who],
                        client_org={"ref": "org/pg-client"})
    assert len(rows) == 3 and all(r["decision"] == rd["id"] for r in rows)
    ro = L.roster("brand/pg-bmw")
    assert ro["categories"] == ["automotive.ev_charging", "automotive.hybrid"] and ro["name"] == "PG BMW"
    assert ro["client_org"] == "org/pg-client" and ro["ref"] == "brand/pg-bmw"
    assert all(f["key"].startswith("roster.") and f["decision"] == rd["id"] for f in ro["facts"])
    assert L.set_roster("brand/pg-bmw", "PG BMW", ["automotive.ev_charging", "automotive.hybrid"], rd, [who],
                        client_org="org/pg-client") == rows          # a replay
    assert store.open({"org": A, "brand": Y}).roster("brand/pg-bmw") is None
    assert L.roster("brand/pg-nobody") is None
    rd2 = dec(kind="roster")
    with pytest.raises(LayersError, match="unknown_leaf"):
        L.set_roster("brand/pg-bad", "Bad", ["automotive.nosuch"], rd2, [who])
    assert owner_rows(pg, "agency_test_agency", "SELECT 1 FROM layers.decisions WHERE id = %s", (rd2["id"],)) == []
    # a roster resting on a web source with no quote has no evidence: refused whole, nothing written
    web = L.add_source(src("https://example.org/pg/roster"))
    rd3 = dec(kind="roster")
    with pytest.raises(LayersError, match="no_evidence"):
        L.set_roster("brand/pg-web", "Web", ["alcohol.cider"], rd3, [web])
    assert owner_rows(pg, "agency_test_agency", "SELECT 1 FROM layers.decisions WHERE id = %s", (rd3["id"],)) == []
    assert owner_rows(pg, "agency_test_agency", "SELECT 1 FROM layers.brands WHERE ref = 'brand/pg-web'") == []
    assert L.find_brands("pg bmw") == [("brand/pg-bmw", "PG BMW")]
    assert store.open({"org": B, "brand": X}).find_brands("pg bmw") == []
    L.note_brand("brand/pg-lunasa", "PG Lunasa")
    L.note_brand("brand/pg-lunasa", "PG Lúnasa")
    assert L.find_brands("pg lunasa") == [("brand/pg-lunasa", "PG Lúnasa")]


# ---------------------------------------------------------------------------- configuration

def test_store_configuration(pg):
    with pytest.raises(ValueError):
        PgLayerStore("")
    with pytest.raises(ValueError):
        PgLayerStore(pg["category"], "postgresql://x@h/napkin_agency")   # no {agency}
    secret = ('{"engine": "postgres", "host": "h.example", "port": 5432, "dbname": "napkin_category", '
              '"username": "napkin_category_app", "password": "pw", "sslmode": "verify-full"}')
    info = conninfo_to_dict(conninfo(secret))
    assert info == {"host": "h.example", "port": "5432", "dbname": "napkin_category", "user": "napkin_category_app",
                    "password": "pw", "sslmode": "verify-full"}
    # no agency database configured: the category layer works, the brand layer says why it cannot
    L = PgLayerStore(pg["category"]).open({"org": A, "brand": X})
    assert L.leaves()
    assert L.find_brands("anything") == []
    with pytest.raises(LayersError, match="no_agency_database"):
        L.facts("brand", X)
    # one agency named on its own wins over the template
    st = PgLayerStore(pg["category"], "postgresql://nobody@nowhere.invalid/napkin_agency_{agency}",
                      {"test_agency": pg["agency"].replace("{agency}", "test_agency")})
    assert isinstance(st.open({"org": A, "brand": X}).facts("brand", X, key="positioning.tagline"), list)


def test_the_middleware_serves_on_a_dsn_alone(pg, monkeypatch):
    from napkin.app import Middleware
    from napkin.config import Settings
    from fakes import FakeModel
    monkeypatch.setenv("NAPKIN_LAYERS_DSN", pg["category"])
    monkeypatch.setenv("NAPKIN_LAYERS_AGENCY_DSN", pg["agency"])
    monkeypatch.setenv("NAPKIN_LAYERS_AGENCY_DSN_OTHER", "postgresql://x@y/z")
    monkeypatch.delenv("NAPKIN_LAYERS_URL", raising=False)
    s = Settings.from_env()
    assert s.layers_dsn == pg["category"] and s.layers_agency_dsns == {"other": "postgresql://x@y/z"}
    mw = Middleware(s, model_client=FakeModel())
    assert isinstance(mw.layer_store, PgLayerStore)
    assert mw.caps("t@1.0").layers.find("cider") == ["alcohol.cider"]
    with pytest.raises(SystemExit, match="NAPKIN_LAYERS_URL or NAPKIN_LAYERS_DSN"):
        Middleware(Settings(pipelines=s.pipelines), model_client=FakeModel())


# ---------------------------------------------------------------------------- what seeding wrote; the wire

def test_a_seeded_row_reads_in_the_protocol_shape(layers, pg):
    """seed/store.py writes undated, qualified, market-less facts straight through
    layers.append_fact; they read back as protocol rows."""
    sid = layers.add_source(src("https://example.org/pg/seed", published_at="2026-02-01"))
    cap = "cap_" + __import__("hashlib").sha256(f"{sid}\x1f2026-09-20".encode()).hexdigest()[:24]
    text = "Aldi holds 12 per cent of the market."
    with psycopg.connect(_as(pg["base"], f"{pg['run']}_category", f"{pg['run']}_category_app")) as c:
        c.execute("SELECT set_config('napkin.org', %s, true)", (A,))
        c.execute("INSERT INTO layers.excerpts (id, capture_id, ordinal, text) VALUES ('exc_pgseed', %s, 5, %s)",
                  (cap, text))
        out = c.execute("SELECT layers.append_fact(%s, %s, %s)", (
            psycopg.types.json.Jsonb({"id": "f_pgseed1", "layer": "category", "entity": "category/food.dairy",
                                      "key": "market.player_share", "qualifier": "Aldi", "market": "UNKNOWN",
                                      "market_basis": "unknown", "value": 0.12, "unit": "proportion",
                                      "licence": "open", "method": "report"}),
            psycopg.types.json.Jsonb([{"excerpt_id": "exc_pgseed", "quote": "12 per cent", "quote_start": text.index("12")}]),
            psycopg.types.json.Jsonb({"id": "d_PGSEED01", "kind": "pin"}))).fetchone()[0]
        assert out["outcome"] == "created"
    rows = layers.facts("category", "category/food.dairy", key_prefix="market")
    assert len(rows) == 1
    r = rows[0]
    assert r["qualifier"] == "Aldi" and r["market"] is None and r["value"] == 0.12
    assert r["as_of"] == "2026-02-01" and r["retrieved_at"] == "2026-09-20"     # undated: published, read
    assert r["source_records"][0]["quote"] == "12 per cent"
    assert layers.facts("category", "category/food.dairy", market="IE") == []   # UNKNOWN applies to nothing


def test_a_lost_connection_is_retried_once(store, pg):
    L = store.open({"org": A, "brand": X})
    assert L.leaves()
    s = L.add_source(src("https://example.org/pg/retry"))
    pids = owner_rows(pg, "category", "SELECT pid FROM pg_stat_activity WHERE datname = %s AND pid <> "
                                      "pg_backend_pid()", (f"{pg['run']}_category",))
    assert pids
    for (pid,) in pids:
        owner_rows(pg, "category", "SELECT pg_terminate_backend(%s)", (pid,))
    assert [x["id"] for x in L.sources([s])] == [s]   # the pooled connection was dead; a fresh one answered
    # an idle session ends on the server too, so an idle middleware lets Aurora pause
    assert L._run("category", "t", lambda c: c.execute("SHOW idle_session_timeout").fetchone()[0]) == "90s"


def test_concurrent_appends_to_one_identity(store):
    import threading
    L = store.open({"org": A, "brand": X})
    srcs = [L.add_source(src(f"https://example.org/pg/c{i}")) for i in range(6)]
    out, errs = [], []

    def go(i):
        try:
            out.append(store.open({"org": A, "brand": X}).append(
                fact(0.33, entity="category/food.snacks_confectionery", sources=[srcs[i]],
                     quotes={srcs[i]: f"a third, says source {i}"}), dec()))
        except Exception as e:  # noqa: BLE001
            errs.append(e)
    ts = [threading.Thread(target=go, args=(i,)) for i in range(6)]
    for t in ts:
        t.start()
    for t in ts:
        t.join()
    assert not errs
    assert len({r["id"] for r in out}) == 1               # one row, every other write corroborated it
    row = L.facts("category", "category/food.snacks_confectionery")[0]
    assert sorted(row["sources"]) == sorted(srcs) and row["version"] == 1


# ---------------------------------------------------------------------------- qualifiers and the measure list

def test_a_qualifier_rides_in_the_key_and_tells_rows_of_one_measure_apart(store, pg):
    """market.player_share.aldi is stored as key market.player_share, qualifier "aldi", and read back as
    market.player_share.aldi: Aldi's share and Lidl's are two identities, never a contest."""
    L = store.open({"org": A, "brand": X})
    ent = "category/food.snacks_confectionery"
    s = L.add_source(src("https://example.org/pg/shares"))
    q = {s: "Aldi held 21 per cent and Lidl 18 per cent"}
    aldi = L.append(fact(0.21, entity=ent, key="market.player_share.aldi", sources=[s], quotes=q), dec())
    lidl = L.append(fact(0.18, entity=ent, key="market.player_share.lidl", sources=[s], quotes=q), dec())
    assert aldi["key"] == "market.player_share.aldi" and aldi["qualifier"] == "aldi"
    assert lidl["key"] == "market.player_share.lidl" and {aldi["status"], lidl["status"]} == {"active"}
    assert aldi["origin"] == origin_uri("category", ent, "market.player_share.aldi", aldi["version"])
    assert owner_rows(pg, "category", "SELECT key, qualifier FROM layers.facts WHERE id = ANY (%s) ORDER BY qualifier",
                      ([aldi["id"].lower(), lidl["id"].lower()],)) == [("market.player_share", "aldi"), ("market.player_share", "lidl")]
    # a key read matches the joined key exactly; a prefix read the measure and everything under it
    assert [r["id"] for r in L.facts("category", ent, key="market.player_share.aldi")] == [aldi["id"]]
    assert L.facts("category", ent, key="market.player_share") == []
    assert {r["id"] for r in L.facts("category", ent, key_prefix="market.player_share")} == {aldi["id"], lidl["id"]}
    assert {aldi["id"], lidl["id"]} <= {r["id"] for r in L.facts("category", ent, key_prefix="market")}
    assert [r["id"] for r in L.facts("category", ent, key_prefix="market.player_share.lidl")] == [lidl["id"]]
    assert L.resolve(aldi["origin"])["id"] == aldi["id"]
    assert L.resolve(origin_uri("category", ent, "market.player_share.tesco", aldi["version"])) is None
    # another value for Aldi in the same period contests Aldi's row only
    again = L.append(fact(0.25, entity=ent, key="market.player_share.aldi", sources=[s],
                          quotes={s: "Aldi held 25 per cent"}), dec())
    assert again["status"] == "contested" and L.resolve(lidl["origin"])["status"] == "active"
    # words in a qualifier: stored as words, read back as one key segment
    top = L.append(fact(0.6, entity=ent, key="market.top_n_share.top_3", sources=[s],
                        quotes={s: "the top three hold 60 per cent"}), dec())
    assert top["key"] == "market.top_n_share.top_3" and top["qualifier"] == "top 3"


def test_a_qualifier_takes_the_spelling_a_seeded_row_already_uses(store, pg):
    from psycopg.types.json import Jsonb
    L = store.open({"org": A, "brand": X})
    ent = "category/alcohol.cider"
    s = L.add_source(src("https://example.org/pg/seeded-share"))
    f = fact(0.3, entity=ent, key="market.player_share", sources=[s], quotes={s: "Diageo has 30 per cent"})

    def seed(c):   # a row the seed runner wrote, its qualifier as the page spells it
        ev = L._evidence(c, f, L._sources_here(c, "category", [s], "t"))
        body = {"id": "f_pgseeded01", "layer": "category", "entity": ent, "key": "market.player_share",
                "qualifier": "Diageo Ireland", "market": "IE", "market_basis": "inferred", "value": 0.3,
                "unit": "proportion", "licence": "open", "method": "report", "period_start": "2025-12-31",
                "period_end": "2025-12-31", "period_basis": "inferred"}
        return c.execute("SELECT layers.append_fact(%s, %s, %s)", (Jsonb(body), Jsonb(ev), Jsonb(dec()))).fetchone()[0]
    L._run("category", "t", seed)
    row = L.append(fact(0.3, entity=ent, key="market.player_share.diageo_ireland", sources=[s],
                        quotes={s: "Diageo has 30 per cent"}), dec())
    assert row["id"] == "f_pgseeded01" and row["key"] == "market.player_share.diageo_ireland"   # corroborated
    assert row["qualifier"] == "Diageo Ireland"


def test_a_measure_is_proposed_without_a_fact(store, pg):
    L = store.open({"org": A, "brand": X})
    s = L.add_source(src("https://example.org/pg/propose"))
    f = fact(0.4, key="market.x_share_of_volume", sources=[s], quotes={s: "40 per cent of litres"})
    assert L.propose_measure(f) is True
    assert owner_rows(pg, "category", "SELECT lens, proposed, unit, quote, proposed_by_org FROM "
                                      "layers.measure_proposals WHERE proposed = 'market.x_share_of_volume'") == \
        [("market_structure", "market.x_share_of_volume", "proportion", "40 per cent of litres", A)]
    assert owner_rows(pg, "category", "SELECT 1 FROM layers.facts WHERE key = 'market.x_share_of_volume'") == []
    # a listed measure in a unit it does not take: proposed under the measure, its qualifier aside
    assert L.propose_measure(fact(12, key="market.player_share.aldi", unit="count", sources=[s],
                                  quotes={s: "40 per cent of litres"})) is True
    assert owner_rows(pg, "category", "SELECT unit FROM layers.measure_proposals WHERE proposed = "
                                      "'market.player_share'") == [("count",)]
    # the client's fact: proposed in the agency's own database, never the shared one
    m = L.add_source({"uri": "material:pgpropose", "tier": "primary", "domain": "material-pgp",
                      "licence": "client-confidential", "title": "Deck.pdf", "retrieved_at": "2026-09-20"})
    bf = {**fact("six models", key="positioning.x_model_range", unit="text", sources=[m],
                 quotes={m: "six models"}), "layer": "brand", "entity": X, "licence": "client-confidential"}
    assert L.propose_measure(bf) is True
    assert owner_rows(pg, "agency_test_agency", "SELECT lens FROM layers.measure_proposals WHERE proposed = "
                                                "'positioning.x_model_range'") == [("brands_positioning",)]
    assert owner_rows(pg, "category", "SELECT 1 FROM layers.measure_proposals WHERE proposed = "
                                      "'positioning.x_model_range'") == []
    # no quoted evidence, nothing to propose
    assert L.propose_measure(fact(0.4, key="market.x_unquoted", sources=[s])) is False


def test_a_verified_finding_the_category_layer_refuses_is_kept_in_the_brand_layer(store, pg):
    """A finding is not a measure: the category layer refuses synthesis.* (unknown_measure), so
    verify_finding writes it to the agency's own brand layer and still answers with a pin."""
    import threading
    from types import SimpleNamespace
    from napkin.capabilities import Capabilities
    from napkin.handlers import verify_finding
    caps = Capabilities(handler="verify_finding@1.0", scope={"org": A, "brand": X}, model_port=None,
                        research_port=None, layer_store=store, research_semaphore=threading.Semaphore(1))
    pin = {"id": "f_pgcited01", "entity": "category/automotive.hybrid", "key": "market.value_growth_yoy",
           "market": "IE", "value": 0.2, "unit": "proportion", "as_of": "2025-12-31", "licence": "open",
           "layer": "category", "sources": []}
    fi = {"id": "fi_pg00001", "status": "proposed", "statement": "Hybrids grow fastest in Ireland.",
          "cites": [pin["id"]], "confidence": "medium"}
    req = SimpleNamespace(doc="11111111-2222-4333-8444-555555555555", base="3",
                          clan={"facts": [pin], "findings": [fi]}, handler="verify_finding@1.0",
                          inp={"finding": fi["id"], "by": "human:pg-erin", "decision_id": "d_01PGVERIFY01"})
    result, change, _ = verify_finding.run(req, caps)
    assert change is None and result["pin"]["layer"] == "brand" and "brand layer" in result["summary"]
    row = caps.layers.resolve(result["pin"]["origin"])
    assert row and row["value"] == fi["statement"]
    assert owner_rows(pg, "category", "SELECT 1 FROM layers.facts WHERE key LIKE 'synthesis.%%'") == []


def test_the_values_of_a_many_measure_are_rows_of_one_key_read_back_apart(store, pg):
    """codes.dominant_code holds several conventions. The middleware names each value's identity
    after the value (rules/merge.split_lists: codes.dominant_code.<slug>_<hash>); the layers store
    the measure's own key, and read each row back under its value's name, so two codes never contest."""
    from napkin.rules.merge import _slug
    L = store.open({"org": A, "brand": X})
    ent = "category/automotive.ev_charging"
    s = L.add_source(src("https://example.org/pg/codes"))
    a_txt, b_txt = "Range shown as a hero number", "Charging at home at night"
    q = {s: "ads lead with range shown as a hero number, and charging at home at night"}
    a = L.append(fact(a_txt, entity=ent, key=f"codes.dominant_code.{_slug(a_txt)}", unit="text", sources=[s],
                      quotes=q), dec())
    b = L.append(fact(b_txt, entity=ent, key=f"codes.dominant_code.{_slug(b_txt)}", unit="text", sources=[s],
                      quotes=q), dec())
    assert a["key"] == f"codes.dominant_code.{_slug(a_txt)}" and b["key"] == f"codes.dominant_code.{_slug(b_txt)}"
    assert {a["status"], b["status"]} == {"active"}
    assert owner_rows(pg, "category", "SELECT DISTINCT key FROM layers.facts WHERE id = ANY (%s)",
                      ([a["id"].lower(), b["id"].lower()],)) == [("codes.dominant_code",)]
    assert [r["id"] for r in L.facts("category", ent, key=a["key"])] == [a["id"]]
    assert {r["id"] for r in L.facts("category", ent, key_prefix="codes.dominant_code")} == {a["id"], b["id"]}
    assert L.resolve(a["origin"])["id"] == a["id"]
    # one value with no name of its own is stored the same way and read back named
    c_txt = "Silent cars in city streets"
    c = L.append(fact(c_txt, entity=ent, key="codes.dominant_code", unit="text", sources=[s],
                      quotes={s: "silent cars in city streets"}), dec())
    assert c["key"] == f"codes.dominant_code.{_slug(c_txt)}"
    # a last part that is not this value's name is not stripped: unlisted, refused
    with pytest.raises(LayersError):
        L.append(fact(c_txt, entity=ent, key="codes.dominant_code.something_else_abcdef", unit="text",
                      sources=[s], quotes={s: "silent cars in city streets"}), dec())
