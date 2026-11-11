"""The J001 brief's retrieval trace, built by the engine's own mix path over stand-in rows.

No index, no model, no network and no corpus text: the store is replaced by rows made up here
(a few from allowed sources and several tagged `cannes`, all with placeholder text), and the
embedder by a constant. What is real is the engine: its default `source nin [cannes]` filter,
its egress check and the trace it writes. The store below honours filters only if asked, so the
test can also prove the engine's own check catches a store that ignores the filter.

Run (from engine/rag):  python retrievalTrace.py <brief.json> [--ignore-filter]
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


def row(doc_id: str, source: str, score: float) -> dict:
    md = {"doc_id": doc_id, "source": source, "category": "fmcg", "bucket": "exemplars", "level": "parent",
          "scope": "global", "tenant": "house", "status": "active"}
    return {"id": doc_id, "source": source, "section": "s", "text": f"stand-in text for {doc_id}", "header": "h",
            "metadata": md, "_score": score}


def main() -> None:
    brief = json.loads(Path(sys.argv[1]).read_text())
    honour = "--ignore-filter" not in sys.argv
    rows = [row(f"ipa_{i}", "ipa", 0.9 - i * 0.01) for i in range(3)] + [row(f"cannes_{i}", "cannes", 0.95) for i in range(4)]

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
