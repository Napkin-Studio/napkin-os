"""The retrieval trace of a Territories run, built by the engine's own mix path over stand-in rows.

Territories is a design only (features/territory-tool.clan), so this stands in for its retrieval the way
retrievalTrace.py stands in for the brief's: no index, no model, no network, no corpus text. The store is
replaced by placeholder rows from an allowed source (ipa) and from the three the owner keeps out of every
retrieval, tagged cannes, effie and warc (Laurence, 10 Nov 2026); the embedder by a constant. What is real
is the engine: its source filter, its egress check and the trace it writes.

  --territories   the exclusion list a Territories run must carry: cannes, effie and warc
  --ignore-filter the store ignores the filter, so only the engine's own egress check can stop a hit

Run (from engine/rag):  python territoryTrace.py <brief.json> [--territories] [--ignore-filter]
Prints the trace as JSON on stdout.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path.cwd()))
import brief_context as bc  # noqa: E402
import filters  # noqa: E402
import judge  # noqa: E402
import rag  # noqa: E402
import retrieve  # noqa: E402

KEPT_OUT = ("cannes", "effie", "warc")


def row(doc_id: str, source: str, score: float) -> dict:
    md = {"doc_id": doc_id, "source": source, "category": "fmcg", "bucket": "exemplars", "level": "parent",
          "scope": "global", "tenant": "house", "status": "active"}
    return {"id": doc_id, "source": source, "section": "s", "text": f"stand-in text for {doc_id}", "header": "h",
            "metadata": md, "_score": score}


def main() -> None:
    brief = json.loads(Path(sys.argv[1]).read_text())
    honour = "--ignore-filter" not in sys.argv
    if "--territories" in sys.argv:
        # A Territories run excludes all three. The mix path reads the list where it builds its filter and
        # where it checks what came back, so both are set.
        retrieve.EXCLUDED_SOURCES = KEPT_OUT
        bc.EXCLUDED_SOURCES = KEPT_OUT
    rows = [row(f"ipa_{i}", "ipa", 0.9 - i * 0.01) for i in range(3)]
    rows += [row(f"{s}_{i}", s, 0.95) for s in KEPT_OUT for i in range(2)]

    def search_vec(s, qvec, q, k=5, where=None, mode=None):
        got = [r for r in rows if not honour or filters.matches(r["metadata"], where)]
        return [(r["_score"], r) for r in sorted(got, key=lambda r: -r["_score"])][:k]

    rag.open_store = lambda *a, **k: None
    rag.embed = lambda texts, t="passage": ([[1.0]] * len(texts), "nim:x")
    rag.search_vec = search_vec
    bc._collapse = lambda rows, store: rows
    bc._counts_cache.clear()
    mc = bc.build_multi({"category": "fmcg", "problem": brief["insight"]},
                        {"insight": brief["insight"], "proof": " ".join(brief["reasons_to_believe"])},
                        chain=judge.Chain([]))
    print(json.dumps(mc.trace))


main()
