"""The baseline arm and the blind pack. The plain prompt writes three territories in one call (as Deck Maker's
stage c does today); ``blind_pack`` shuffles it with the pipeline's cards under neutral labels so Laurence
grades them without knowing which is which. The key goes in a separate file."""
from __future__ import annotations

import json
import random
import zlib

from .llm import prompt


def baseline(task: dict, llm) -> list[dict]:
    obj, _ = llm("baseline", prompt("baseline"), json.dumps({"brief": task.get("fields") or {}, "prompt": task.get("prompt", ""),
                                                           "category": task.get("category"), "market": task.get("market")}, ensure_ascii=False))
    return (obj or {}).get("territories") or []


def _plain(t: dict) -> dict:
    """What a grader sees: a line, the thought and why. No tier, score, badge or id that gives the arm away."""
    return {"line": t.get("name") or t.get("line") or t.get("thought"), "thought": t.get("thought"), "why": t.get("why")}


def pack_seed(*parts) -> int:
    """A shuffle seed that differs per brief, so the plain prompt is not Set A in every pack (a grader would learn it)."""
    return zlib.crc32(json.dumps(parts, sort_keys=True, ensure_ascii=False, default=str).encode())


def blind_pack(pipeline_cards: list[dict], baseline_terrs: list[dict], seed: int = 1) -> tuple[dict, dict]:
    """Returns (pack, key): the pack has two shuffled sets labelled Set A and Set B; the key says which is which.

    Both sets hold the same number of territories: the pipeline keeps its best by advisory score, as many as the plain
    prompt wrote (three), because five against three tells the grader which set is which."""
    rng = random.Random(seed)
    n = min(len(pipeline_cards), len(baseline_terrs)) or max(len(pipeline_cards), len(baseline_terrs))
    best = sorted(pipeline_cards, key=lambda c: -((c.get("score") or {}).get("total") or 0))[:n]
    arms = [("pipeline", [_plain(c) for c in best]), ("plain_prompt", [_plain(t) for t in baseline_terrs[:n]])]
    rng.shuffle(arms)
    pack = {"Set A": arms[0][1], "Set B": arms[1][1]}
    key = {"Set A": arms[0][0], "Set B": arms[1][0]}
    return pack, key
