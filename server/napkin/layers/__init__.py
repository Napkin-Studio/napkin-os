"""The layers port: the knowledge layers behind a Python protocol.

`LayerStore.open(scope)` binds a scope (from auth, never from a request) and
returns a `Layers` whose methods take no scope argument: category facts are
shared, brand facts are read and written under the bound (org, brand).

The layers are a peripheral (peripherals.md §4, `napkin.layers/1`) with two
implementations: `HttpLayers` (`layers/http.py`), a client of a layers
service (NAPKIN_LAYERS_URL), and `PgLayers` (`layers/pg.py`), the same
protocol in process on the layers' Postgres databases (NAPKIN_LAYERS_DSN).
Values cross the boundary as plain dicts.

Fact rows (the fact envelope, Contract 3 §4, as the layer holds it):
  {id, layer, entity, key, market|None, value, unit, as_of, retrieved_at,
   status: active|contested|superseded, version, supersedes, licence, method,
   decision, sources: [src ids], source_records: [{id, uri, tier, domain, licence, ...}]}

A fact's key is `<lens>.<measure>` from the measure list
(layers-service/data/measures.json), and `<lens>.<measure>.<qualifier>` when
the measure takes a qualifier (market.player_share.aldi): one key per thing
measured, so entity + key + market tells Aldi's share from Lidl's.
"""

from __future__ import annotations

from typing import Protocol

from .. import origin as _origin


class Layers(Protocol):
    # category tree
    def leaves(self) -> list[dict]: ...
    def vertical_of(self, leaf: str) -> dict | None: ...
    def find(self, text: str) -> list[str]: ...

    # facts (append-only; supersession inserts and flips status)
    def facts(self, layer: str, entity: str, key: str | None = None, market: str | None = None,
              key_prefix: str | None = None) -> list[dict]: ...
    def append(self, fact: dict, decision: dict) -> dict: ...
    def resolve(self, pin_uri: str) -> dict | None: ...
    # a fact outside the measure list: never a fact; its measure is proposed, with
    # the fact (as `append` takes it) for evidence, for a planner. True when the
    # proposal was recorded; False when these layers take no proposals.
    def propose_measure(self, fact: dict) -> bool: ...

    # sources
    def add_source(self, source: dict) -> str: ...
    def sources(self, ids: list[str]) -> list[dict]: ...

    # the brand roster
    def roster(self, brand_ref: str) -> dict | None: ...
    def set_roster(self, brand_ref: str, name: str, categories: list[str], decision: dict,
                   sources: list[str], client_org: dict | None = None) -> list[dict]: ...
    def find_brands(self, text: str) -> list[tuple[str, str]]: ...
    def note_brand(self, brand_ref: str, name: str) -> None: ...


class LayerStore(Protocol):
    def open(self, scope: dict, attribution: dict | None = None) -> Layers: ...


def origin_uri(layer: str, entity: str, key: str, version: int) -> str:
    """fact://<layer>/<entity path>/<key>@<version>; the entity's type segment
    is dropped when it equals the layer (Contract 3 §4)."""
    typ, _, rest = entity.partition("/")
    path = rest if typ == layer else entity
    return f"fact://{layer}/{path}/{key}@{version}"


# The fields of a document source record (shared/sources.yaml) a layer row's
# source record fills, in the order the host's projection copies them.
SOURCE_FIELDS = ("uri", "title", "publisher", "published_at", "retrieved_at", "tier", "domain", "licence")


def layer_source_record(r: dict) -> dict | None:
    """The document's source record for one of a layer row's `source_records`,
    as the row carried it: every path that pins a layer row (a roster row, a
    reused research row, an answer's search) cites its sources with this.

    A record is kept with whatever it has: a person's confirmation
    (`human:<who>`, "confirmed in the chat") has no publisher or date, and is
    still a record. One with no address at all is given `layer:<id>`, since
    the host refuses a source with no uri. None when the id is not a `src_` id."""
    sid = r.get("id") if isinstance(r, dict) else None
    if not (isinstance(sid, str) and sid.startswith("src_") and len(sid) > 4):
        return None
    rec = {"id": sid}
    for k in SOURCE_FIELDS:
        v = r.get(k)
        if v is None or (isinstance(v, str) and not v.strip()):
            continue
        rec[k] = v
    rec.setdefault("uri", f"layer:{sid}")
    rec[_origin.KEY] = _origin.LAYER
    return rec


def row_source_records(rows, cited=None) -> list[dict]:
    """The source records of layer rows (each row's `source_records`), one per
    id in first-seen order; only the ids in `cited` when it is given."""
    want = None if cited is None else set(cited)
    out, seen = [], set()
    for row in rows or []:
        for r in (row or {}).get("source_records") or []:
            rec = layer_source_record(r)
            if rec and rec["id"] not in seen and (want is None or rec["id"] in want):
                seen.add(rec["id"])
                out.append(rec)
    return out
