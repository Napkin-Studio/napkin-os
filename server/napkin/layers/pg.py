"""PgLayers: the `Layers` protocol in process, on the knowledge layers' Postgres.

The owner's decision (2026-09-30): the layers are an imported module behind
the port, not an HTTP service. This is the same protocol `HttpLayers` speaks
(`napkin.layers/1`, peripherals.md §4), implemented directly on the schema in
`layers-service/migrations/*.sql`:

  napkin_category          category-layer facts, shared by every agency; the
                           category tree; open and licensed sources
                           (NAPKIN_LAYERS_DSN)
  napkin_agency_<slug>     one per agency: brand-layer facts under forced RLS
                           on (org, brand), the brand names, client-confidential
                           sources (NAPKIN_LAYERS_AGENCY_DSN, `{agency}` = the
                           org's slug with '-' as '_'; or one
                           NAPKIN_LAYERS_AGENCY_DSN_<SLUG> per agency)

Scope comes from `open(scope)` only and is set per transaction with
`set_config('napkin.org' / 'napkin.brand', …, true)` (= SET LOCAL). Every
protocol call is one transaction in the database it writes: an append is the
fact, its decision, its evidence and the status flips (`layers.append_fact`);
a roster write is every roster fact, the decision and the brand's name.

How the protocol maps onto the schema (where they do not fit, the choice made
is the honest one, never an invented value):

  * A fact's `sources` + `quotes` become evidence: each quote is matched,
    verbatim, inside a stored excerpt of that source (the passage the
    research read); when no stored excerpt contains it, the quote itself is
    stored as an excerpt of the source's reading. A source cited without a
    quote is not evidence and is not linked; a `reviewer-verified` source (a
    person) attests the value itself, so its evidence is the value as text.
    A fact left with no evidence is refused (`no_evidence`).
  * `as_of` is the period [as_of, as_of], period_basis `inferred`;
    `append_fact` applies the owner's dating rules (a different value for an
    earlier period is kept as history, not contested; §4.4 differs).
  * No `market` is stored as UNKNOWN (basis unknown): the schema refuses
    "no market = everywhere". On read UNKNOWN and GLOBAL are `market: null`.
    A market filter uses `layers.applicable_markets` (IE sees IE, EU, GLOBAL).
  * Row status: the schema's history / undated / retracted are not current;
    the protocol has only active | contested | superseded, so they read as
    `superseded`.
  * Qualifiers. The protocol has none: what tells rows of one measure apart
    rides in the key, `<measure>.<qualifier>` (market.player_share.aldi). On
    append, a key whose first two segments are a listed measure that takes a
    qualifier is written as key = the measure, qualifier = the rest (in words,
    or the spelling a row of that measure already uses for it, so a seeded
    "Aldi" and a researched `aldi` are one identity). On read, a row with a
    qualifier comes back as key = `<measure>.<qualifier slug>` (and carries
    `qualifier` as stored), so the middleware's identity (entity, key, market)
    tells Aldi's share from Lidl's and never opens a contest between them.
    `key` reads match that joined key exactly; `key_prefix` reads match it or
    anything under it.
  * An unlisted measure on the category layer is refused (`unknown_measure`)
    and, as the schema intends, proposed in `layers.measure_proposals` with its
    evidence for a planner. `propose_measure` proposes one without trying to
    write it (the middleware's research does so for a fact outside the list).

Failures raise `LayersError` (as HttpLayers does) whose message carries the
refusal type; an unreachable database is retried once on a fresh connection.
"""

from __future__ import annotations

import datetime as _dt
import decimal
import hashlib
import json
import logging
import math
import os
import re
import threading
import time

import psycopg
from psycopg.conninfo import conninfo_to_dict, make_conninfo
from psycopg.pq import TransactionStatus
from psycopg.types.json import Jsonb

from ..util import slug
from . import origin_uri
from .http import LayersError, _canon, idem

log = logging.getLogger("napkin.layers.pg")

ENTITY_RE = re.compile(r"^(brand|org|category)/[a-z0-9][a-z0-9._-]*$")
BRAND_RE = re.compile(r"^brand/[a-z0-9][a-z0-9._-]*$")
ORG_RE = re.compile(r"^org/[a-z0-9][a-z0-9-]*$")
KEY_RE = re.compile(r"^[a-z0-9_]+(\.[a-z0-9_]+)*$")
LEAF_RE = re.compile(r"^[a-z0-9_]+\.[a-z0-9_]+$")
MARKET_RE = re.compile(r"^[A-Z]{2}$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
PIN_RE = re.compile(r"fact://(brand|category)/(.+)/([a-z0-9_]+(?:\.[a-z0-9_]+)*)@([1-9][0-9]*)")
TIERS = ("primary", "secondary", "tertiary", "reviewer-verified")
LICENCES = ("open", "licensed-internal", "client-confidential")
METHODS = ("observation", "report", "measurement", "synthesis")
FACT_FIELDS = {"layer", "entity", "key", "market", "value", "unit", "as_of", "retrieved_at", "sources", "quotes",
               "licence", "method", "status"}
FACT_REQUIRED = {"layer", "entity", "key", "value", "unit", "as_of", "retrieved_at", "sources", "licence"}
SOURCE_FIELDS = {"uri", "tier", "domain", "licence", "publisher", "title", "retrieved_at", "published_at"}
ROSTER_KEYS = ("roster.categories.primary", "roster.categories.secondary")
CURRENT = ("active", "contested")
NOT_A_PLACE = ("UNKNOWN", "GLOBAL")      # read back as market: null
REFUSALS = ("unknown_leaf", "unknown_measure", "invalid_input", "missing_scope", "idempotency_conflict",
            "unknown_fact", "no_evidence")
TREE_TTL = 300.0
EXCERPT_MAX = 1500


def qualifier_slug(text) -> str:
    """A qualifier as one key segment (research/measures use the same rule): "Top 3" -> top_3."""
    out = re.sub(r"[^a-z0-9]+", "_", str(text or "").lower()).strip("_")[:80]
    return out or "q_" + _h(text)[:8]


def _h(*parts) -> str:
    return hashlib.sha256("\x1f".join(str(p) for p in parts).encode()).hexdigest()


def source_id(uri: str) -> str:
    """The id a URI gets: the formula seed/store.py writes, so ids agree."""
    return "src_" + _h(uri)[:20]


def _refused(op: str, etype: str, message: str) -> LayersError:
    return LayersError(f"layers {op} refused: {etype}: {message}")


def _date(v, name: str, op: str, nullable: bool = False):
    if v is None and nullable:
        return None
    if not isinstance(v, str) or not DATE_RE.match(v):
        raise _refused(op, "invalid_input", f"{name} must be a YYYY-MM-DD date")
    try:
        _dt.date.fromisoformat(v)
    except ValueError:
        raise _refused(op, "invalid_input", f"{name} is not a real date") from None
    return v


def _check_decision(d, op: str) -> dict:
    if not isinstance(d, dict):
        raise _refused(op, "invalid_input", "decision must be an object")
    if not isinstance(d.get("id"), str) or not d["id"].startswith("d_") or len(d["id"]) > 128:
        raise _refused(op, "invalid_input", "decision.id is required (d_…)")
    if not isinstance(d.get("kind"), str) or not d["kind"]:
        raise _refused(op, "invalid_input", "decision.kind is required")
    for k in ("handler", "action", "rationale"):
        if d.get(k) is not None and not isinstance(d[k], str):
            raise _refused(op, "invalid_input", f"decision.{k} must be a string")
    if "cites" in d and not (isinstance(d["cites"], list) and all(isinstance(c, str) for c in d["cites"])):
        raise _refused(op, "invalid_input", "decision.cites must be a list of strings")
    return d


def _value_text(v) -> str:
    if isinstance(v, bool):
        return "true" if v else "false"
    return str(v)


def _value_of(r: dict):
    if r["value_type"] == "boolean":
        return bool(r["value_bool"])
    if r["value_type"] == "number":
        x = r["value_num"]
        if isinstance(x, decimal.Decimal):
            if x == x.to_integral_value() and abs(x) < 2**53:
                return int(x)
            return float(x)
        return x
    return r["value_text"]


def _day(v) -> str | None:
    if v is None:
        return None
    if isinstance(v, _dt.datetime):
        return v.astimezone(_dt.timezone.utc).date().isoformat()
    return v.isoformat()


def conninfo(value: str) -> str:
    """A libpq DSN or URI as given, or a Secrets Manager database secret
    ({host, port, dbname, username, password, sslmode, …}) as ECS injects it."""
    v = (value or "").strip()
    if v.startswith("{"):
        try:
            s = json.loads(v)
        except json.JSONDecodeError as e:
            raise ValueError(f"a layers database secret is not JSON: {e.msg}") from None
        kw = {"host": s.get("host"), "port": s.get("port"), "dbname": s.get("dbname"),
              "user": s.get("username") or s.get("user"), "password": s.get("password"),
              "sslmode": s.get("sslmode"), "sslrootcert": s.get("sslrootcert")}
        return make_conninfo(**{k: str(x) for k, x in kw.items() if x not in (None, "")})
    return v


def agency_slug(org: str) -> str:
    """org/<slug> -> the database suffix: napkin_agency_<slug>, '-' as '_'."""
    if not isinstance(org, str) or not ORG_RE.match(org):
        raise _refused("open", "invalid_input", "the scope's org must be org/<slug>")
    return org.split("/", 1)[1].replace("-", "_")


class _Pool:
    """A few idle connections per database, so a job's many calls do not each
    pay a TLS handshake. Connections are autocommit off; each use is one
    transaction. A broken connection is dropped, never returned. An idle one is
    closed after IDLE_S, and the server ends any session idle longer than that
    (idle_session_timeout), so an idle middleware never keeps a
    scale-to-zero Aurora awake."""

    IDLE_S = 60

    def __init__(self, info: str, timeout: float, size: int = 4):
        kw = conninfo_to_dict(info)
        kw["options"] = (kw.get("options", "") + f" -c idle_session_timeout={(self.IDLE_S + 30) * 1000}").strip()
        self.info, self.timeout, self.size = make_conninfo(**kw), timeout, size
        self._idle: list[tuple[psycopg.Connection, float]] = []
        self._lock = threading.Lock()

    def get(self) -> psycopg.Connection:
        stale = []
        try:
            with self._lock:
                while self._idle:
                    c, t = self._idle.pop()
                    if c.closed or c.broken or time.monotonic() - t > self.IDLE_S:
                        stale.append(c)
                        continue
                    return c
        finally:
            for c in stale:
                self.drop(c)
        return psycopg.connect(self.info, connect_timeout=max(1, int(self.timeout)))

    def put(self, c: psycopg.Connection):
        ok = not c.closed and not c.broken and c.info.transaction_status == TransactionStatus.IDLE
        with self._lock:
            if ok and len(self._idle) < self.size:
                self._idle.append((c, time.monotonic()))
                return
        self.drop(c)

    @staticmethod
    def drop(c: psycopg.Connection):
        try:
            c.close()
        except Exception:  # noqa: BLE001 - already gone
            pass

    def close(self):
        with self._lock:
            idle, self._idle = self._idle, []
        for c, _t in idle:
            self.drop(c)


class PgLayerStore:
    """`open(scope)` binds a scope and returns a `PgLayers`. Connections are
    made lazily: a paused Aurora is woken by the first call, not at startup."""

    def __init__(self, dsn: str, agency_dsn: str | None = None, agency_dsns: dict | None = None,
                 timeout: float = 30.0):
        if not dsn:
            raise ValueError("NAPKIN_LAYERS_DSN is required")
        self.category_info = conninfo(dsn)
        self.agency_template = agency_dsn or None
        if self.agency_template and "{agency}" not in self.agency_template:
            raise ValueError("NAPKIN_LAYERS_AGENCY_DSN must contain {agency} (the org's slug, '-' as '_')")
        self.agency_dsns = {k.lower(): v for k, v in (agency_dsns or {}).items() if v}
        self.timeout = float(timeout)
        self._pools: dict[str, _Pool] = {}
        self._lock = threading.Lock()
        self._tree = None
        self._tree_at = 0.0
        self._measures = None
        self._measures_at = 0.0

    def open(self, scope: dict, attribution: dict | None = None) -> "PgLayers":
        return PgLayers(self, {"org": scope["org"], "brand": scope.get("brand") or ""}, attribution)

    def close(self):
        with self._lock:
            pools, self._pools = list(self._pools.values()), {}
        for p in pools:
            p.close()

    # -- databases -----------------------------------------------------------
    def agency_info(self, org: str) -> str | None:
        s = agency_slug(org)
        if s in self.agency_dsns:
            return conninfo(self.agency_dsns[s])
        if self.agency_template:
            return conninfo(self.agency_template.replace("{agency}", s))
        return None

    def pool(self, db: str, org: str) -> _Pool:
        """db: 'category' or 'agency' (the org's own database)."""
        if db == "category":
            name, info = "category", self.category_info
        else:
            info = self.agency_info(org)
            if info is None:
                raise _refused("open", "no_agency_database",
                               f"no agency database is configured for {org} (NAPKIN_LAYERS_AGENCY_DSN)")
            name = "agency:" + org
        with self._lock:
            p = self._pools.get(name)
            if p is None:
                p = self._pools[name] = _Pool(info, self.timeout)
            return p

    def has_agency(self, org: str) -> bool:
        return self.agency_info(org) is not None


class PgLayers:
    """One scope's view of the layers. No method takes a scope."""

    def __init__(self, store: PgLayerStore, scope: dict, attribution: dict | None = None):
        self._s = store
        self._org, self._brand = scope["org"], scope["brand"]
        self._attr = attribution if attribution is not None else {"handler": "-", "job": "-"}

    # -- transactions --------------------------------------------------------
    def _run(self, db: str, op: str, work):
        """work(conn) inside one transaction, under this scope, in `db`.
        A connection lost before or during it is retried once on a fresh one
        (a write's idempotency record makes the retry safe)."""
        pool = self._s.pool(db, self._org)
        last = None
        for _attempt in (1, 2):
            try:
                conn = pool.get()
            except psycopg.OperationalError as e:
                last = e
                continue
            try:
                with conn.transaction():
                    conn.execute("SELECT set_config('napkin.org', %s, true), set_config('napkin.brand', %s, true), "
                                 "set_config('statement_timeout', %s, true), "
                                 "set_config('application_name', %s, true)",
                                 (self._org, self._brand, f"{int(self._s.timeout * 1000)}ms",
                                  f"napkin-mw {str(self._attr.get('handler') or '-')[:40]}"))
                    out = work(conn)
            except LayersError:
                pool.put(conn)
                raise
            except psycopg.OperationalError as e:
                if conn.broken or conn.closed:
                    pool.drop(conn)
                    pool.close()   # the idle ones went the same way (a restart, a pause): retry on a fresh one
                    last = e
                    continue
                pool.put(conn)
                raise self._mapped(op, e) from e
            except psycopg.Error as e:
                pool.put(conn)
                raise self._mapped(op, e) from e
            except BaseException:
                pool.drop(conn)
                raise
            pool.put(conn)
            return out
        raise LayersError(f"layers {op}: the {db} database is unreachable ({type(last).__name__})") from last

    @staticmethod
    def _mapped(op: str, e: psycopg.Error) -> LayersError:
        msg = ((e.diag.message_primary if e.diag else None) or str(e)).strip()
        etype = next((t for t in REFUSALS if msg.startswith(t)), None)
        if etype:
            msg = msg[len(etype):].lstrip(": ")
        elif isinstance(e, psycopg.errors.QueryCanceled):
            etype = "timeout"
        elif isinstance(e, (psycopg.IntegrityError, psycopg.DataError)):
            etype = "invalid_input"
        elif isinstance(e, psycopg.errors.InsufficientPrivilege):
            etype = "forbidden"
        else:
            etype = "internal"
        return _refused(op, etype, msg[:400])

    def _need_brand(self, op: str):
        if not self._brand:
            raise _refused(op, "missing_scope", "the brand layer needs a brand in the scope")

    # -- category tree -------------------------------------------------------
    def _tree(self) -> tuple[list[dict], list[dict]]:
        st = self._s
        with st._lock:
            if st._tree is not None and time.monotonic() - st._tree_at < TREE_TTL:
                return st._tree

        def read(c):
            leaves = c.execute("""SELECT c.code, c.name, c.vertical, v.name, c.aliases, c.regulated, c.provisional
                                    FROM layers.categories c JOIN layers.verticals v ON v.code = c.vertical
                                   ORDER BY c.ordinal, c.code""").fetchall()
            verts = c.execute("SELECT code, name, aliases FROM layers.verticals ORDER BY ordinal, code").fetchall()
            return ([{"code": r[0], "name": r[1], "vertical": r[2], "vertical_name": r[3], "aliases": list(r[4]),
                      "regulated": bool(r[5]), "provisional": bool(r[6])} for r in leaves],
                    [{"code": r[0], "name": r[1], "aliases": list(r[2])} for r in verts])
        tree = self._run("category", "categories", read)
        with st._lock:
            st._tree, st._tree_at = tree, time.monotonic()
        return tree

    def leaves(self) -> list[dict]:
        return [dict(x, aliases=list(x["aliases"])) for x in self._tree()[0]]

    # -- the measure list ----------------------------------------------------
    def _measure_list(self) -> dict[str, dict]:
        """layers.measures (the category database's), by key, cached like the tree."""
        st = self._s
        with st._lock:
            if st._measures is not None and time.monotonic() - st._measures_at < TREE_TTL:
                return st._measures

        def read(c):
            return {r[0]: {"lens": r[1], "qualifier": r[2], "units": list(r[3])} for r in c.execute(
                "SELECT key, lens, qualifier, units FROM layers.measures WHERE status <> 'retired'").fetchall()}
        got = self._run("category", "measures", read)
        with st._lock:
            st._measures, st._measures_at = got, time.monotonic()
        return got

    def _split(self, key: str) -> tuple[str, str | None]:
        """(the stored key, the qualifier slug or None): market.player_share.aldi -> (market.player_share, aldi)
        when market.player_share is a listed measure that takes a qualifier; any other key as it is."""
        parts = key.split(".")
        if len(parts) < 3:
            return key, None
        head = ".".join(parts[:2])
        m = self._measure_list().get(head)
        if not m or m["qualifier"] == "none":
            return key, None
        return head, "_".join(parts[2:])

    @staticmethod
    def _joined(key: str, qualifier: str | None) -> str:
        return key if qualifier is None else f"{key}.{qualifier_slug(qualifier)}"

    def vertical_of(self, leaf: str) -> dict | None:
        leaves, verts = self._tree()
        hit = next((l for l in leaves if l["code"] == leaf), None)
        if hit is None:
            return None
        v = next(v for v in verts if v["code"] == hit["vertical"])
        return {"code": v["code"], "name": v["name"], "aliases": list(v["aliases"]),
                "leaves": [l["code"] for l in leaves if l["vertical"] == v["code"]]}

    def find(self, text: str) -> list[str]:
        """Leaf codes, names and aliases as whole words first; else every leaf
        of a matching vertical (§4.3: the rule every layers implementation shares)."""
        t = " " + re.sub(r"[^a-z0-9.+]+", " ", (text or "").lower()) + " "
        if not t.strip():
            return []

        def hit(word: str) -> bool:
            w = re.sub(r"[^a-z0-9.+]+", " ", word.lower()).strip()
            return bool(w) and f" {w} " in t

        leaves, verts = self._tree()
        found = [l["code"] for l in leaves if hit(l["code"]) or hit(l["name"]) or any(hit(a) for a in l["aliases"])]
        if found:
            return found
        for v in verts:
            if hit(v["code"]) or hit(v["name"]) or any(hit(a) for a in v["aliases"]):
                found += [l["code"] for l in leaves if l["vertical"] == v["code"]]
        return list(dict.fromkeys(found))

    # -- rows ----------------------------------------------------------------
    _FACT_COLS = ("id", "layer", "entity", "key", "qualifier", "market", "value_type", "value_num", "value_text",
                  "value_bool", "unit", "period_start", "period_end", "date_basis", "status", "version",
                  "supersedes", "licence", "method", "decision_id", "created_at")
    _FACT_SELECT = "SELECT " + ", ".join("f." + c for c in _FACT_COLS) + " FROM layers.facts f "

    def _rows(self, conn, facts: list[tuple]) -> list[dict]:
        """Fact rows in the protocol's shape, evidence read in one query."""
        fs = [dict(zip(self._FACT_COLS, r)) for r in facts]
        if not fs:
            return []
        ev: dict[str, list[dict]] = {}
        for r in conn.execute(
                """SELECT e.fact_id, s.id, s.uri, s.publisher, s.tier, s.domain, s.licence, s.added_by_org,
                          c.title, c.retrieved_at, c.published_at, e.quote
                     FROM layers.evidence e
                     JOIN layers.excerpts x ON x.id = e.excerpt_id
                     JOIN layers.captures c ON c.id = x.capture_id
                     JOIN layers.sources s ON s.id = c.source_id
                    WHERE e.fact_id = ANY (%s)
                    ORDER BY e.fact_id, e.added_at, s.id, e.quote_start""", ([f["id"] for f in fs],)):
            ev.setdefault(r[0], []).append(dict(zip(("id", "uri", "publisher", "tier", "domain", "licence", "org",
                                                     "title", "retrieved_at", "published_at", "quote"), r[1:])))
        out = []
        for f in fs:
            recs: dict[str, dict] = {}
            pubs, reads = [], []
            for e in ev.get(f["id"], []):
                if e["licence"] == "client-confidential" and e["org"] != self._org:
                    continue
                reads.append(_day(e["retrieved_at"]))
                if e["published_at"]:
                    pubs.append(_day(e["published_at"]))
                if e["id"] not in recs:
                    recs[e["id"]] = {"id": e["id"], "uri": e["uri"], "publisher": e["publisher"], "title": e["title"],
                                     "tier": e["tier"], "domain": e["domain"], "licence": e["licence"],
                                     "retrieved_at": _day(e["retrieved_at"]), "published_at": _day(e["published_at"]),
                                     "quote": e["quote"]}
            created = _day(f["created_at"])
            # as_of: the period's end; an undated row (seeded research) says when it was
            # published, else when it was read: the middleware's own fallback.
            as_of = _day(f["period_end"]) or (min(pubs) if pubs else (min(reads) if reads else created))
            key = self._joined(f["key"], f["qualifier"])
            row = {"id": f["id"], "layer": f["layer"], "entity": f["entity"], "key": key,
                   "market": None if f["market"] in NOT_A_PLACE else f["market"], "value": _value_of(f),
                   "unit": f["unit"], "as_of": as_of, "retrieved_at": max(reads) if reads else created,
                   "status": f["status"] if f["status"] in ("active", "contested", "superseded") else "superseded",
                   "version": f["version"], "supersedes": f["supersedes"], "licence": f["licence"],
                   "method": f["method"], "decision": f["decision_id"],
                   "origin": origin_uri(f["layer"], f["entity"], key, f["version"]),
                   "sources": list(recs), "source_records": list(recs.values())}
            if f["qualifier"] is not None:
                row["qualifier"] = f["qualifier"]
            out.append(row)
        return out

    def _db(self, layer: str) -> str:
        return "agency" if layer == "brand" else "category"

    # -- facts ---------------------------------------------------------------
    def facts(self, layer: str, entity: str, key: str | None = None, market: str | None = None,
              key_prefix: str | None = None) -> list[dict]:
        op = "facts"
        if layer not in ("brand", "category"):
            raise _refused(op, "invalid_input", "layer must be brand or category")
        if not isinstance(entity, str) or not ENTITY_RE.match(entity):
            raise _refused(op, "invalid_input", "entity must be an entity ref")
        for name, v in (("key", key), ("key_prefix", key_prefix)):
            if v is not None and not KEY_RE.match(v):
                raise _refused(op, "invalid_input", f"{name} must be a dotted key")
        if market is not None and not MARKET_RE.match(market):
            raise _refused(op, "invalid_input", "market must be an ISO 3166-1 alpha-2 code (upper case)")
        if layer == "brand":
            self._need_brand(op)
        sql = self._FACT_SELECT + "WHERE f.layer = %s AND f.entity = %s AND f.status IN ('active', 'contested')"
        args: list = [layer, entity]
        if layer == "brand":  # forced RLS says the same; said here too
            sql += " AND f.org = %s AND f.brand = %s"
            args += [self._org, self._brand]
        # A key may carry a qualifier (market.player_share.aldi): the stored key is the measure, so the query
        # reads the measure and the rows are matched on the key they read back as.
        if key is not None:
            sql += " AND f.key = %s"
            args.append(self._split(key)[0])
        if key_prefix is not None:
            parts = key_prefix.split(".")
            heads = [".".join(parts[:i]) for i in range(2, len(parts))]
            sql += r" AND (f.key = %s OR f.key LIKE %s ESCAPE '\' OR f.key = ANY (%s))"
            args += [key_prefix, key_prefix.replace("\\", "\\\\").replace("_", r"\_").replace("%", r"\%") + ".%",
                     heads]
        if market is not None:
            sql += " AND f.market IN (SELECT code FROM layers.applicable_markets(%s))"
            args.append(market)
        sql += " ORDER BY f.key, f.market, f.version"
        if layer == "brand" and not self._s.has_agency(self._org):
            raise _refused(op, "no_agency_database", f"no agency database is configured for {self._org}")
        rows = self._run(self._db(layer), op, lambda c: self._rows(c, c.execute(sql, args).fetchall()))
        if key is not None:
            rows = [r for r in rows if r["key"] == key]
        if key_prefix is not None:
            rows = [r for r in rows if r["key"] == key_prefix or r["key"].startswith(key_prefix + ".")]
        return rows

    def resolve(self, pin_uri: str) -> dict | None:
        m = PIN_RE.fullmatch(pin_uri or "")
        if not m:
            return None
        layer, path, key, version = m.group(1), m.group(2), m.group(3), int(m.group(4))
        entity = path if re.match(r"^(brand|org|category)/", path) else f"{layer}/{path}"
        if layer == "brand":
            self._need_brand("resolve")
        sql = self._FACT_SELECT + "WHERE f.layer = %s AND f.entity = %s AND f.key = %s AND f.version = %s"
        args: list = [layer, entity, self._split(key)[0], version]
        if layer == "brand":
            sql += " AND f.org = %s AND f.brand = %s"
            args += [self._org, self._brand]

        def work(c):
            rows = [r for r in self._rows(c, c.execute(sql, args).fetchall()) if r["key"] == key]
            return rows[0] if rows else None
        return self._run(self._db(layer), "resolve", work)

    # -- append ----------------------------------------------------------------
    def _check_fact(self, fact, op: str) -> dict:
        if not isinstance(fact, dict):
            raise _refused(op, "invalid_input", "fact must be an object")
        fact = {k: v for k, v in fact.items() if v is not None or k == "market"}
        extra = sorted(set(fact) - FACT_FIELDS)
        if extra:
            raise _refused(op, "invalid_input", f"fact: unknown field(s) {', '.join(extra)}")
        missing = sorted(FACT_REQUIRED - set(fact))
        if missing:
            why = " (there is no default licence: a default would silently declassify)" if "licence" in missing else ""
            raise _refused(op, "invalid_input", f"fact: missing {', '.join(missing)}{why}")
        if fact["layer"] not in ("brand", "category"):
            raise _refused(op, "invalid_input", "fact.layer must be brand or category")
        if not isinstance(fact["entity"], str) or not ENTITY_RE.match(fact["entity"]):
            raise _refused(op, "invalid_input", "fact.entity must be an entity ref (brand|org|category)/<slug>")
        if not isinstance(fact["key"], str) or not KEY_RE.match(fact["key"]):
            raise _refused(op, "invalid_input", "fact.key must be a dotted key [a-z0-9_]+(.[a-z0-9_]+)*")
        m = fact.get("market")
        if m is not None and (not isinstance(m, str) or not MARKET_RE.match(m)):
            raise _refused(op, "invalid_input", "fact.market must be an ISO 3166-1 alpha-2 code (upper case) or absent")
        v = fact["value"]
        if isinstance(v, bool) or isinstance(v, str):
            if isinstance(v, str) and not v:
                raise _refused(op, "invalid_input", "fact.value must not be empty")
        elif isinstance(v, (int, float)):
            if not math.isfinite(v):
                raise _refused(op, "invalid_input", "fact.value must be a finite number")
        else:
            raise _refused(op, "invalid_input", "fact.value is a number, a string or a boolean — never an object, "
                                                "a list or null")
        if not isinstance(fact["unit"], str) or not fact["unit"]:
            raise _refused(op, "invalid_input", "fact.unit is required (a non-empty string)")
        _date(fact["as_of"], "fact.as_of", op)
        _date(fact["retrieved_at"], "fact.retrieved_at", op)
        if fact["licence"] not in LICENCES:
            raise _refused(op, "invalid_input", f"fact.licence must be one of {', '.join(LICENCES)}")
        if fact.get("method") is not None and fact["method"] not in METHODS:
            raise _refused(op, "invalid_input", f"fact.method must be one of {', '.join(METHODS)}")
        if "status" in fact and fact["status"] != "contested":
            raise _refused(op, "invalid_input", "fact.status, when sent, may only be contested")
        srcs = fact["sources"]
        if not isinstance(srcs, list) or not all(isinstance(i, str) and i.startswith("src_") for i in srcs):
            raise _refused(op, "invalid_input", "fact.sources must be a list of source ids (src_…)")
        quotes = fact.get("quotes")
        if quotes is not None:
            if not isinstance(quotes, dict) or not all(isinstance(q, str) for q in quotes.values()):
                raise _refused(op, "invalid_input", "fact.quotes must be an object of source id -> quote")
            if set(quotes) - set(srcs):
                raise _refused(op, "invalid_input", "fact.quotes keys must be among fact.sources")
            if any(len(q) > EXCERPT_MAX for q in quotes.values()):
                raise _refused(op, "invalid_input", f"a quote is at most {EXCERPT_MAX} characters")
        if fact["layer"] == "brand":
            self._need_brand(op)
        return fact

    def _sources_here(self, conn, db: str, ids: list[str], op: str) -> dict[str, dict]:
        """The cited sources, as rows of `db`. A brand-layer fact may cite a
        source the category database holds: it is copied, with its readings and
        passages (same ids), into the agency database inside this transaction,
        because evidence links only within one database."""
        ids = list(dict.fromkeys(ids))
        if not ids:
            return {}
        cols = ("id", "uri", "domain", "publisher", "tier", "licence", "added_by_org")
        q = f"SELECT {', '.join(cols)} FROM layers.sources WHERE id = ANY (%s)"
        have = {r[0]: dict(zip(cols, r)) for r in conn.execute(q, (ids,))}
        missing = [i for i in ids if i not in have]
        if missing and db == "agency":
            copied = self._run("category", op, lambda c: self._export_sources(c, missing))
            for s in copied:
                self._import_source(conn, s)
                have[s["source"]["id"]] = {k: s["source"][k] for k in cols}
            missing = [i for i in ids if i not in have]
        if missing:
            if db == "category" and self._s.has_agency(self._org):
                conf = self._run("agency", op, lambda c: [r[0] for r in c.execute(
                    "SELECT id FROM layers.sources WHERE id = ANY (%s)", (missing,))])
                if conf:
                    raise _refused(op, "invalid_input", "a client-confidential source cannot back a category-layer "
                                                        "fact (it stays in the agency's own database)")
            raise _refused(op, "invalid_input", "fact.sources: a source id is unknown to this org")
        for s in have.values():
            if s["licence"] == "client-confidential" and s["added_by_org"] != self._org:
                raise _refused(op, "invalid_input", "fact.sources: a source id is unknown to this org")
        return have

    @staticmethod
    def _export_sources(c, ids: list[str]) -> list[dict]:
        out = []
        scols = ("id", "uri", "domain", "publisher", "tier", "licence", "added_by_org", "added_at")
        ccols = ("id", "source_id", "retrieved_at", "published_at", "published_basis", "title", "content_sha256")
        xcols = ("id", "capture_id", "ordinal", "text")
        for r in c.execute(f"SELECT {', '.join(scols)} FROM layers.sources WHERE id = ANY (%s)", (ids,)).fetchall():
            caps = [dict(zip(ccols, x)) for x in c.execute(
                f"SELECT {', '.join(ccols)} FROM layers.captures WHERE source_id = %s ORDER BY retrieved_at, id",
                (r[0],)).fetchall()]
            exc = [dict(zip(xcols, x)) for x in c.execute(
                f"SELECT {', '.join('x.' + k for k in xcols)} FROM layers.excerpts x "
                "JOIN layers.captures c ON c.id = x.capture_id WHERE c.source_id = %s ORDER BY x.capture_id, x.ordinal",
                (r[0],)).fetchall()]
            out.append({"source": dict(zip(scols, r)), "captures": caps, "excerpts": exc})
        return out

    @staticmethod
    def _import_source(conn, s: dict):
        src = s["source"]
        conn.execute("""INSERT INTO layers.sources (id, uri, domain, publisher, tier, licence, added_by_org, added_at)
                        VALUES (%(id)s, %(uri)s, %(domain)s, %(publisher)s, %(tier)s, %(licence)s, %(added_by_org)s,
                                %(added_at)s) ON CONFLICT DO NOTHING""", src)
        for cap in s["captures"]:   # decision_id is the category database's (private there): not carried
            conn.execute("""INSERT INTO layers.captures (id, source_id, retrieved_at, published_at, published_basis,
                                                         title, content_sha256)
                            VALUES (%(id)s, %(source_id)s, %(retrieved_at)s, %(published_at)s, %(published_basis)s,
                                    %(title)s, %(content_sha256)s) ON CONFLICT DO NOTHING""", cap)
        for x in s["excerpts"]:
            conn.execute("""INSERT INTO layers.excerpts (id, capture_id, ordinal, text)
                            VALUES (%(id)s, %(capture_id)s, %(ordinal)s, %(text)s) ON CONFLICT DO NOTHING""", x)

    @staticmethod
    def _capture(conn, sid: str, day: str, published: str | None = None, title: str | None = None) -> str:
        """This source's reading on `day` (one per source and day), made if missing."""
        cid = "cap_" + _h(sid, day)[:24]
        if published is not None and published > day:
            log.warning("layers: %s published_at %s is after it was read (%s); stored as unknown", sid, published, day)
            published = None
        conn.execute("""INSERT INTO layers.captures (id, source_id, retrieved_at, published_at, published_basis, title)
                        VALUES (%s, %s, %s, %s, %s, %s) ON CONFLICT (id) DO NOTHING""",
                     (cid, sid, f"{day}T00:00:00Z", published, "search_api" if published else "unknown", title))
        return cid

    def _excerpt_for(self, conn, sid: str, quote: str, day: str, whole: bool = False) -> tuple[str, int]:
        """(excerpt id, start): a stored passage of this source that contains the
        quote verbatim (is exactly it, when `whole`); else the quote stored as a
        passage of the source's reading at or before `day` (made on `day` when
        the source has none)."""
        r = conn.execute("""SELECT x.id, strpos(x.text, %s) - 1
                              FROM layers.excerpts x JOIN layers.captures c ON c.id = x.capture_id
                             WHERE c.source_id = %s AND strpos(x.text, %s) > 0 AND (NOT %s OR x.text = %s)
                             ORDER BY c.retrieved_at DESC, x.capture_id, x.ordinal LIMIT 1""",
                         (quote, sid, quote, whole, quote)).fetchone()
        if r:
            return r[0], int(r[1])
        cap = conn.execute("""SELECT id FROM layers.captures WHERE source_id = %s
                               ORDER BY ((retrieved_at AT TIME ZONE 'UTC')::date <= %s::date) DESC,
                                        CASE WHEN (retrieved_at AT TIME ZONE 'UTC')::date <= %s::date
                                             THEN retrieved_at END DESC NULLS LAST,
                                        retrieved_at, id LIMIT 1""", (sid, day, day)).fetchone()
        cid = cap[0] if cap else self._capture(conn, sid, day)
        conn.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s, 7333))", (cid,))
        xid = "exc_" + _h(cid, quote)[:24]
        if not conn.execute("SELECT 1 FROM layers.excerpts WHERE id = %s", (xid,)).fetchone():
            n = conn.execute("SELECT coalesce(max(ordinal) + 1, 0) FROM layers.excerpts WHERE capture_id = %s",
                             (cid,)).fetchone()[0]
            conn.execute("INSERT INTO layers.excerpts (id, capture_id, ordinal, text) VALUES (%s, %s, %s, %s)",
                         (xid, cid, n, quote))
        return xid, 0

    def _evidence(self, conn, fact: dict, srcs: dict[str, dict]) -> list[dict]:
        quotes = fact.get("quotes") or {}
        ev, unquoted = [], []
        for sid in dict.fromkeys(fact["sources"]):
            q, whole = quotes.get(sid), False
            if not (isinstance(q, str) and q.strip()):
                if srcs[sid]["tier"] != "reviewer-verified":
                    unquoted.append(sid)
                    continue
                q, whole = _value_text(fact["value"])[:EXCERPT_MAX], True   # a person attests the value itself
            xid, start = self._excerpt_for(conn, sid, q, fact["retrieved_at"], whole)
            ev.append({"excerpt_id": xid, "quote": q, "quote_start": start})
        if unquoted:
            log.info("layers: %s cited without a quote; not linked as evidence", ", ".join(unquoted))
        return ev

    @staticmethod
    def _idem_get(conn, org: str, key: str, body_sha: str, op: str):
        conn.execute("DELETE FROM layers.idempotency WHERE org = %s AND created_at < now() - interval '24 hours'",
                     (org,))
        r = conn.execute("SELECT body_sha256, response FROM layers.idempotency WHERE org = %s AND key = %s",
                         (org, key)).fetchone()
        if r is None:
            return None
        if r[0] != body_sha:
            raise _refused(op, "idempotency_conflict", "this write was made before with another body")
        return r[1]

    @staticmethod
    def _idem_put(conn, org: str, key: str, body_sha: str, response: dict):
        conn.execute("""INSERT INTO layers.idempotency (org, key, body_sha256, status, response)
                        VALUES (%s, %s, %s, 200, %s) ON CONFLICT DO NOTHING""", (org, key, body_sha, Jsonb(response)))

    def _append_in(self, conn, db: str, fact: dict, decision: dict, op: str) -> tuple[str, str]:
        """One fact through layers.append_fact, in the caller's transaction:
        (the fact id now current for the write, outcome)."""
        srcs = self._sources_here(conn, db, fact["sources"], op)
        ev = self._evidence(conn, fact, srcs)
        if not ev:
            raise _refused(op, "no_evidence", "a fact needs at least one source with a verbatim quote "
                                              "(or a person's confirmation); none was given")
        market = fact.get("market")
        key, qual = self._split(fact["key"])
        if qual is not None:
            qual = self._qualifier_text(conn, fact["layer"], fact["entity"], key, qual)
        # A new row's id; unused when the fact corroborates. Replays are caught by
        # the idempotency record, not by the id.
        body = {"id": "f_" + os.urandom(12).hex(),
                "layer": fact["layer"], "entity": fact["entity"], "key": key, "qualifier": qual,
                "market": market or "UNKNOWN", "market_basis": "inferred" if market else "unknown",
                "value": fact["value"], "unit": fact["unit"], "licence": fact["licence"],
                "method": fact.get("method"),
                "period_start": fact["as_of"], "period_end": fact["as_of"], "period_basis": "inferred"}
        if fact.get("status") == "contested":
            body["contested"] = True
        body = {k: v for k, v in body.items() if v is not None}
        try:
            with conn.transaction():   # a savepoint: a refused measure keeps its proposal, not the fact
                out = conn.execute("SELECT layers.append_fact(%s, %s, %s)",
                                   (Jsonb(body), Jsonb(ev), Jsonb(decision))).fetchone()[0]
        except psycopg.Error as e:
            msg = (e.diag.message_primary or "") if e.diag else ""
            if msg.startswith("unknown_measure"):
                self._propose(conn, fact, market or "UNKNOWN", ev[0])
            raise
        return out["fact"], out["outcome"]

    @staticmethod
    def _qualifier_text(conn, layer: str, entity: str, key: str, qual: str) -> str:
        """The qualifier as stored: the spelling a row of this measure already uses for it (a seeded "Aldi"
        for `aldi`), else the slug in words ("top_3" -> "top 3")."""
        r = conn.execute("""SELECT qualifier FROM layers.facts
                             WHERE layer = %s AND entity = %s AND key = %s AND qualifier IS NOT NULL
                               AND btrim(regexp_replace(lower(qualifier), '[^a-z0-9]+', '_', 'g'), '_') = %s
                             ORDER BY created_at, id LIMIT 1""", (layer, entity, key, qual)).fetchone()
        return r[0] if r else qual.replace("_", " ")

    def _propose(self, conn, fact: dict, market: str, ev: dict) -> bool:
        """layers.measure_proposals: a measure the list lacks, with the passage
        that states it, for a planner to add to the list or refuse. The
        proposed key is <lens prefix>.<name> (a qualifier is not part of it)."""
        prefix = fact["key"].split(".")[0]
        proposed = ".".join(fact["key"].split(".")[:2])
        lens = next((m["lens"] for k, m in self._measure_list().items() if k.split(".")[0] == prefix), None)
        if lens is None and conn.execute("SELECT to_regclass('layers.lenses')").fetchone()[0]:
            r = conn.execute("SELECT code FROM layers.lenses WHERE key_prefix = %s", (prefix,)).fetchone()
            lens = r[0] if r else None
        if not lens or not re.fullmatch(r"[a-z_]+\.[a-z0-9_]+", proposed):
            return False
        pid = "mp_" + _h(fact["entity"], fact["key"], market, _canon(fact["value"]), ev["excerpt_id"])[:24]
        conn.execute("""INSERT INTO layers.measure_proposals (id, lens, proposed, entity, market, value, unit,
                                                              excerpt_id, quote, proposed_by_org)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, layers.scope_org()) ON CONFLICT (id) DO NOTHING""",
                     (pid, lens, proposed, fact["entity"], market, _value_text(fact["value"])[:500],
                      fact["unit"], ev["excerpt_id"], ev["quote"]))
        return True

    def propose_measure(self, fact: dict) -> bool:
        """A fact outside the measure list: never written as a fact; its measure
        is proposed in layers.measure_proposals (in the database its layer lives
        in) with the passage that states it. False when it has no quoted
        evidence or no lens owns its key's prefix."""
        op = "propose_measure"
        fact = self._check_fact(fact, op)
        db = self._db(fact["layer"])

        def work(c):
            ev = self._evidence(c, fact, self._sources_here(c, db, fact["sources"], op))
            return bool(ev) and self._propose(c, fact, fact.get("market") or "UNKNOWN", ev[0])
        return self._run(db, op, work)

    def append(self, fact: dict, decision: dict) -> dict:
        op = "append"
        fact = self._check_fact(fact, op)
        _check_decision(decision, op)
        db = self._db(fact["layer"])
        key = idem(decision.get("id"), fact["layer"] + fact["entity"] + fact["key"] + (fact.get("market") or ""),
                   _canon(fact["value"]))
        body_sha = hashlib.sha256(_canon({"fact": fact, "decision": decision, "brand": self._brand}).encode()).hexdigest()
        proposal = {}

        def work(c):
            prev = self._idem_get(c, self._org, key, body_sha, op)
            if prev is not None:
                return prev["fact"]
            try:
                fid, outcome = self._append_in(c, db, fact, decision, op)
            except psycopg.Error as e:
                msg = (e.diag.message_primary or "") if e.diag else ""
                if msg.startswith("unknown_measure"):   # commit the proposal, then refuse the fact
                    proposal["error"] = self._mapped(op, e)
                    return None
                raise
            row = self._rows(c, c.execute(self._FACT_SELECT + "WHERE f.id = %s", (fid,)).fetchall())[0]
            self._idem_put(c, self._org, key, body_sha, {"fact": row, "outcome": outcome})
            return row
        row = self._run(db, op, work)
        if "error" in proposal:
            raise proposal["error"]
        return row

    # -- sources -------------------------------------------------------------
    def _dbs(self) -> list[str]:
        return ["agency", "category"] if self._s.has_agency(self._org) else ["category"]

    def add_source(self, source: dict) -> str:
        op = "add_source"
        if not isinstance(source, dict):
            raise _refused(op, "invalid_input", "source must be an object")
        s = {k: v for k, v in source.items() if v is not None and k != "id"}
        extra = sorted(set(s) - SOURCE_FIELDS)
        if extra:
            raise _refused(op, "invalid_input", f"source: unknown field(s) {', '.join(extra)}")
        if not isinstance(s.get("uri"), str) or not s["uri"].strip():
            raise _refused(op, "invalid_input", "source.uri is required")
        if s.get("tier") not in TIERS:
            raise _refused(op, "invalid_input", f"source.tier must be one of {', '.join(TIERS)}")
        if not isinstance(s.get("domain"), str):
            raise _refused(op, "invalid_input", "source.domain is required (a string)")
        if "licence" not in s:
            raise _refused(op, "invalid_input", "source.licence is required: there is no default (a default "
                                                "would silently declassify)")
        if s["licence"] not in LICENCES:
            raise _refused(op, "invalid_input", f"source.licence must be one of {', '.join(LICENCES)}")
        for k in ("publisher", "title"):
            if s.get(k) is not None and not isinstance(s[k], str):
                raise _refused(op, "invalid_input", f"source.{k} must be a string or null")
        for k in ("retrieved_at", "published_at"):
            _date(s.get(k), f"source.{k}", op, nullable=True)
        conf = s["licence"] == "client-confidential"
        if conf and not self._s.has_agency(self._org):
            raise _refused(op, "no_agency_database", "a client-confidential source is kept in the agency's own "
                                                     f"database; none is configured for {self._org}")
        home = "agency" if conf else "category"

        def upsert(c, insert: bool):
            r = c.execute("SELECT id FROM layers.sources WHERE uri = %s", (s["uri"],)).fetchone()
            if r is None and not insert:
                return None
            if r is None:
                c.execute("""INSERT INTO layers.sources (id, uri, domain, publisher, tier, licence, added_by_org)
                             VALUES (%s, %s, %s, %s, %s, %s, %s) ON CONFLICT (uri) DO NOTHING""",
                          (source_id(s["uri"]), s["uri"], s["domain"], s.get("publisher"), s["tier"], s["licence"],
                           self._org))
                r = c.execute("SELECT id FROM layers.sources WHERE uri = %s", (s["uri"],)).fetchone()
            # One URI is one source, never changed; this reading of it is recorded.
            if s.get("retrieved_at"):
                self._capture(c, r[0], s["retrieved_at"], s.get("published_at"), s.get("title"))
            return r[0]
        # one row per URI across both databases: an existing one is returned, wherever it is
        for db in [d for d in self._dbs() if d != home]:
            sid = self._run(db, op, lambda c: upsert(c, False))
            if sid:
                return sid
        return self._run(home, op, lambda c: upsert(c, True))

    def sources(self, ids: list[str]) -> list[dict]:
        if not ids:
            return []
        want = [i for i in dict.fromkeys(ids) if isinstance(i, str)]

        def read(c):
            rows = c.execute("""SELECT s.id, s.uri, s.publisher, s.tier, s.domain, s.licence, s.added_by_org,
                       (SELECT title FROM layers.captures c WHERE c.source_id = s.id AND title IS NOT NULL
                         ORDER BY retrieved_at DESC, id DESC LIMIT 1),
                       (SELECT max(retrieved_at) FROM layers.captures c WHERE c.source_id = s.id),
                       (SELECT published_at FROM layers.captures c WHERE c.source_id = s.id
                           AND published_at IS NOT NULL ORDER BY retrieved_at DESC, id DESC LIMIT 1)
                  FROM layers.sources s WHERE s.id = ANY (%s)""", (want,)).fetchall()
            return {r[0]: {"id": r[0], "uri": r[1], "publisher": r[2], "title": r[7], "tier": r[3], "domain": r[4],
                           "licence": r[5], "retrieved_at": _day(r[8]), "published_at": _day(r[9]), "_org": r[6]}
                    for r in rows}
        found: dict[str, dict] = {}
        for db in self._dbs():
            for k, v in self._run(db, "sources", read).items():
                found.setdefault(k, v)
        out = []
        for i in want:
            r = found.get(i)
            if r is not None and (r["licence"] != "client-confidential" or r["_org"] == self._org):
                out.append({k: v for k, v in r.items() if k != "_org"})
        return out

    # -- the brand roster ----------------------------------------------------
    def roster(self, brand_ref: str) -> dict | None:
        if not isinstance(brand_ref, str) or not BRAND_RE.match(brand_ref):
            raise _refused("roster", "invalid_input", "the roster is keyed by a brand ref brand/<slug>")
        rows = [r for r in self.facts("brand", brand_ref, key_prefix="roster") if r["status"] == "active"]
        if not rows:
            return None
        by = {r["key"]: r for r in rows}
        name = self._run("agency", "roster", lambda c: c.execute(
            "SELECT name FROM layers.brands WHERE ref = %s", (brand_ref,)).fetchone())
        return {"ref": brand_ref, "name": name[0] if name else None,
                "categories": [by[k]["value"] for k in ROSTER_KEYS if k in by],
                "client_org": by["roster.client_org"]["value"] if "roster.client_org" in by else None,
                "facts": rows}

    def set_roster(self, brand_ref: str, name: str, categories: list[str], decision: dict, sources: list[str],
                   client_org: dict | str | None = None) -> list[dict]:
        op = "set_roster"
        self._need_brand(op)
        if not isinstance(brand_ref, str) or not BRAND_RE.match(brand_ref):
            raise _refused(op, "invalid_input", "the roster is keyed by a brand ref brand/<slug>")
        if not isinstance(name, str) or not name.strip():
            raise _refused(op, "invalid_input", "name must be a non-empty string")
        cats = list(categories or [])[:2]
        if not 1 <= len(cats) <= 2 or len(set(map(str, cats))) != len(cats):
            raise _refused(op, "invalid_input", "categories must be 1 or 2 distinct leaf codes")
        known = {l["code"] for l in self._tree()[0]}
        for c in cats:
            if not isinstance(c, str) or not LEAF_RE.match(c):
                raise _refused(op, "invalid_input", "categories must be leaf codes <vertical>.<leaf>")
            if c not in known:
                raise _refused(op, "unknown_leaf", f"{c} is a roster category the tree does not know")
        if isinstance(client_org, dict):
            client_org = client_org.get("ref")
        if client_org is not None and client_org != "" and (not isinstance(client_org, str)
                                                           or not ORG_RE.match(client_org)):
            raise _refused(op, "invalid_input", "client_org must be org/<slug>")
        _check_decision(decision, op)
        day = _dt.datetime.now(_dt.timezone.utc).date().isoformat()
        base = {"layer": "brand", "entity": brand_ref, "unit": "code", "as_of": day, "retrieved_at": day,
                "sources": list(sources or []), "licence": "client-confidential", "method": "report"}
        facts = [self._check_fact({**base, "key": k, "value": v}, op) for k, v in zip(ROSTER_KEYS, cats)]
        if client_org:
            facts.append(self._check_fact({**base, "key": "roster.client_org", "value": client_org}, op))
        key = idem(decision.get("id"), brand_ref)
        body_sha = hashlib.sha256(_canon({"ref": brand_ref, "name": name, "categories": cats, "sources": base["sources"],
                                          "client_org": client_org or None, "decision": decision,
                                          "brand": self._brand}).encode()).hexdigest()

        def work(c):
            prev = self._idem_get(c, self._org, key, body_sha, op)
            if prev is not None:
                return prev["facts"]
            ids = [self._append_in(c, "agency", f, decision, op)[0] for f in facts]
            self._note(c, brand_ref, name)
            got = {r["id"]: r for r in self._rows(c, c.execute(self._FACT_SELECT + "WHERE f.id = ANY (%s)",
                                                                (ids,)).fetchall())}
            rows = [got[i] for i in ids]
            self._idem_put(c, self._org, key, body_sha, {"facts": rows})
            return rows
        return self._run("agency", op, work)

    @staticmethod
    def _note(conn, ref: str, name: str):
        conn.execute("""INSERT INTO layers.brands (ref, name) VALUES (%s, %s)
                        ON CONFLICT (ref) DO UPDATE SET name = EXCLUDED.name, updated_at = now()""", (ref, name))

    def find_brands(self, text: str) -> list[tuple[str, str]]:
        t = slug(text)
        if len(t) < 2 or not self._s.has_agency(self._org):
            return []
        rows = self._run("agency", "find_brands",
                         lambda c: c.execute("SELECT ref, name FROM layers.brands ORDER BY name, ref").fetchall())
        return [(r[0], r[1]) for r in rows
                if slug(r[1]) == t or (len(t) >= 3 and (t in slug(r[1]) or slug(r[1]) in t))]

    def note_brand(self, brand_ref: str, name: str) -> None:
        if not name:
            return
        if not isinstance(brand_ref, str) or not BRAND_RE.match(brand_ref):
            raise _refused("note_brand", "invalid_input", "a brand ref is brand/<slug>")
        self._run("agency", "note_brand", lambda c: self._note(c, brand_ref, name))

