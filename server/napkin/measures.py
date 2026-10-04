"""The measure list, loaded once: the one list the knowledge layers enforce.

The list is `layers-service/data/measures.json` (the owner's decision of
2026-10-04: one list, Aurora's). Migration 0007 loads it into `layers.measures`
and `layers.append_fact` refuses a category fact whose key is not on it, whose
unit it does not allow, or which lacks the qualifier the measure needs. The
middleware reads the same file so research asks for, and names its facts by,
exactly what the database will accept.

A stage module may not read files (it gets everything through the capability
object), so the data is loaded here and the stage imports the result. The path
is `NAPKIN_MEASURES` when set (the image sets it), else the file in this
repository. The list is a draft no planner has signed off (see its `status`).

  MEASURES  lens -> [{name, key, definition, units, qualifier, cardinality}]:
            `name` is the key without the lens namespace (`player_share` for
            `market.player_share`); `qualifier` is the kind of qualifier the
            measure takes (none, player, channel, segment, ...)
  BY_NAME   (lens, name) -> that measure
  SYNONYM   (lens, other name) -> (name, fixed qualifier or None): a name the
            model or the older middleware list used, rewritten before a fact
            merges; a fixed qualifier comes with the name
            (tv_share_of_spend -> channel_share for "tv")
  UNITS     every unit some measure allows
"""

from __future__ import annotations

import json
import os
from pathlib import Path

DEFAULT_PATH = Path(__file__).resolve().parents[2] / "layers-service" / "data" / "measures.json"


def path() -> Path:
    return Path(os.environ.get("NAPKIN_MEASURES") or DEFAULT_PATH)


def load(p: Path | None = None) -> tuple[dict, dict, dict, list]:
    """(MEASURES, BY_NAME, SYNONYM, UNITS) from the file at `p`."""
    doc = json.loads((p or path()).read_text())
    measures: dict[str, list[dict]] = {}
    synonyms: dict[tuple[str, str], tuple[str, str | None]] = {}
    for lens, spec in doc["lenses"].items():
        rows = measures.setdefault(lens, [])
        for m in spec["measures"]:
            name = m["key"].split(".", 1)[1]
            rows.append({"name": name, "key": m["key"], "definition": m["definition"], "units": list(m["units"]),
                         "qualifier": m["qualifier"], "cardinality": m["cardinality"]})
            for s in m.get("synonyms") or []:
                syn, fixed = (s, None) if isinstance(s, str) else (s["name"], s.get("qualifier") or None)
                synonyms[(lens, syn)] = (name, fixed)
    by_name = {(lens, m["name"]): m for lens, ms in measures.items() for m in ms}
    # a listed name is never rewritten
    synonyms = {k: v for k, v in synonyms.items() if k not in by_name}
    units = sorted({u for ms in measures.values() for m in ms for u in m["units"]})
    return measures, by_name, synonyms, units


MEASURES, BY_NAME, SYNONYM, UNITS = load()
