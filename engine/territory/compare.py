"""The baseline arm and the blind pack. The plain prompt writes three territories in one call (as Deck Maker's
stage c does today); ``blind_pack`` shuffles it with the pipeline's cards under neutral labels so Laurence
grades them without knowing which is which. The key goes in a separate file."""
from __future__ import annotations

import json
import random

from .llm import prompt


def baseline(task: dict, llm) -> list[dict]:
    obj, _ = llm("baseline", prompt("baseline"), json.dumps({"brief": task.get("fields") or {}, "prompt": task.get("prompt", ""),
                                                           "category": task.get("category"), "market": task.get("market")}, ensure_ascii=False))
    return (obj or {}).get("territories") or []


def _plain(t: dict) -> dict:
    """What a grader sees: a line, the thought and why. No tier, score, badge or id that gives the arm away."""
    return {"line": t.get("name") or t.get("line") or t.get("thought"), "thought": t.get("thought"), "why": t.get("why")}


def blind_pack(pipeline_cards: list[dict], baseline_terrs: list[dict], seed: int = 1) -> tuple[dict, dict]:
    """Returns (pack, key): the pack has two shuffled sets labelled Set A and Set B; the key says which is which."""
    rng = random.Random(seed)
    arms = [("pipeline", [_plain(c) for c in pipeline_cards]), ("plain_prompt", [_plain(t) for t in baseline_terrs])]
    rng.shuffle(arms)
    pack = {"Set A": arms[0][1], "Set B": arms[1][1]}
    key = {"Set A": arms[0][0], "Set B": arms[1][0]}
    return pack, key
