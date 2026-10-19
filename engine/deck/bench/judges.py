"""Judges: a protocol, a recorded replay for tests, a Claude adapter (live only) and a non-Claude hook (off by default)."""
from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Callable, Protocol

ENV_NON_CLAUDE = "DECK_BENCH_ALLOW_NON_CLAUDE"
CLAUDE_FAMILY = "claude"


class BenchError(Exception):
    """A bench rule refused: a judge not allowed, a run labelled trusted without its controls, bad input."""


class Judge(Protocol):
    """What the bench asks of a judge. ``family`` and ``name`` are recorded on every judgment.

    score(packet, rubric) -> ``{criterion_id: {"score": 1-5, "slide": n, "evidence": "quoted passage", "rationale": "..."}}``
    rank(packets, rubric, order) -> labels best first, for the packets as presented in ``order`` (``forward`` or ``reverse``)."""

    family: str
    name: str

    def score(self, packet: dict, rubric: dict) -> dict:
        """Score one blind packet on every criterion, quoting evidence."""

    def rank(self, packets: list, rubric: dict, order: str) -> list:
        """Rank the packets best first."""


def norm_family(family) -> str:
    """A judge family as compared everywhere: stripped and lower-cased (so ``Claude`` is ``claude``)."""
    return str(family or "").strip().lower()


def _squash(t: str) -> str:
    """Text with quotes, ellipses and runs of whitespace flattened, lower-cased, for matching evidence to a packet."""
    t = t.replace("\u2019", "'").replace("\u2018", "'").replace("\u201c", '"').replace("\u201d", '"')
    return " ".join(t.lower().split())


def _quoted_in(evidence: str, text: str) -> bool:
    """True when every fragment of ``evidence`` (split at ``...`` or an ellipsis, outer quotes dropped) is in ``text``."""
    hay = _squash(text)
    frags = [f.strip(" \t\n\"'") for f in re.split(r"\.\.\.|\u2026", evidence)]
    frags = [_squash(f) for f in frags if f.strip(" \t\n\"'")]
    return bool(frags) and all(f in hay for f in frags)


def check_judgment(j: dict, rubric: dict, packet: dict | None = None) -> dict:
    """Validate one packet's judgment: every criterion present, an integer 1-5, and a quoted evidence string.
    With the ``packet`` the judgment is about, the evidence must also appear in the packet's text and ``slide`` must be
    a slide number in it (RUBRIC step 5: a quote, not a paraphrase). Returns it unchanged or raises BenchError."""
    ids = [c["id"] for c in rubric["criteria"]]
    for cid in ids:
        e = j.get(cid)
        if not isinstance(e, dict) or not isinstance(e.get("score"), int) or isinstance(e.get("score"), bool) or not 1 <= e["score"] <= 5:
            raise BenchError(f"judgment for {cid!r} needs an integer score 1-5")
        if not str(e.get("evidence") or "").strip():
            raise BenchError(f"judgment for {cid!r} needs quoted evidence before the score (RUBRIC step 5)")
        if packet is not None and packet.get("text") is not None:
            if not _quoted_in(str(e["evidence"]), packet["text"]):
                raise BenchError(f"judgment for {cid!r}: the evidence is not quoted from the deck text (RUBRIC step 5)")
            sl = e.get("slide")
            if not isinstance(sl, int) or isinstance(sl, bool) or not 1 <= sl <= int(packet.get("slides") or 0):
                raise BenchError(f"judgment for {cid!r}: slide must be a slide number in the deck (1-{packet.get('slides')})")
    return j


class RecordedJudge:
    """Replays a saved judgment file (no model): ``{"judge", "family", "scores": {label: {criterion: {...}}},
    "rankings": {"forward": [labels], "reverse": [labels]}}``. Used by the tests and for re-scoring saved runs."""

    def __init__(self, data: dict):
        """Hold the recorded data; ``name`` and ``family`` come from it (family defaults to claude)."""
        self.data = data
        self.name = data.get("judge", "recorded")
        self.family = norm_family(data.get("family", CLAUDE_FAMILY)) or CLAUDE_FAMILY
        if self.family != CLAUDE_FAMILY and os.environ.get(ENV_NON_CLAUDE) != "1":
            raise BenchError(f"recorded judgments from a non-Claude family are off (ADR 0006): set {ENV_NON_CLAUDE}=1 to replay them")

    @classmethod
    def load(cls, path) -> "RecordedJudge":
        """A RecordedJudge from a JSON file."""
        return cls(json.loads(Path(path).read_text(encoding="utf-8")))

    def score(self, packet: dict, rubric: dict) -> dict:
        """The recorded scores for the packet's label; BenchError when none were recorded."""
        try:
            raw = self.data["scores"][packet["label"]]
        except KeyError:
            raise BenchError(f"{self.name}: no recorded scores for {packet['label']}") from None
        return check_judgment(raw, rubric, packet)

    def rank(self, packets: list, rubric: dict, order: str) -> list:
        """The recorded ranking for this order; BenchError when absent."""
        try:
            got = list(self.data["rankings"][order])
        except KeyError:
            raise BenchError(f"{self.name}: no recorded {order} ranking") from None
        if sorted(got) != sorted(p["label"] for p in packets):
            raise BenchError(f"{self.name}: recorded {order} ranking does not cover the packets")
        return got


def judge_prompt(packet: dict, rubric: dict) -> str:
    """The text a model judge reads for one packet: the anchors first, then the deck, asking for quotes before scores."""
    crit = "\n".join(f"- {c['id']} ({c['name']}): 1 = {c['anchors']['one']} | 3 = {c['anchors']['three']} | 5 = {c['anchors']['five']}" for c in rubric["criteria"])
    return ("You are scoring one pitch deck. Read the anchors, then for each criterion quote a short passage with its slide number, "
            "then give an integer score 1-5 (1, 3 and 5 are anchored) and a one-line rationale. Judge only the text below.\n"
            f"<criteria>\n{crit}\n</criteria>\n<deck>\n{packet['text']}\n</deck>\n"
            'Reply as JSON: {"<criterion id>": {"slide": n, "evidence": "...", "score": n, "rationale": "..."}, ...}')


class ClaudeJudge:
    """Calls Claude through the engine's model transport (brief_llm._json_call, as stages._call does).

    Refused unless BOTH ``live`` and ``confirmed`` are true (the CLI's ``--live --claude-judge``); tests never build one."""

    family = CLAUDE_FAMILY

    def __init__(self, live: bool, confirmed: bool, model: str = "claude-sonnet-5-5"):
        """Refuse unless live and confirmed; ``model`` should not be the writer's model (RUBRIC step 4)."""
        if not (live and confirmed):
            raise BenchError("the Claude judge makes paid model calls: it needs --live and --claude-judge")
        self.model = model
        self.name = f"claude:{model}"

    def _ask(self, user: str) -> dict:
        """One JSON call on the judge's own model; BenchError when there is no usable reply."""
        import brief_llm as L
        obj = L._json_call(user, system="You are a strict, evidence-quoting pitch judge.", model=self.model, only_model=True, whole=True, max_tokens=8000, retries=2)
        if obj is None:
            raise BenchError(f"no usable reply from {self.model}")
        return obj

    def score(self, packet: dict, rubric: dict) -> dict:
        """Score one packet with one call."""
        return check_judgment(self._ask(judge_prompt(packet, rubric)), rubric, packet)

    def rank(self, packets: list, rubric: dict, order: str) -> list:
        """Rank the packets (already in presentation order) with one call; the reply lists labels best first."""
        body = "\n\n".join(f"<deck label=\"{p['label']}\">\n{p['text']}\n</deck>" for p in packets)
        obj = self._ask("Rank these decks best to worst for a buyer choosing a winner. Judge the text only.\n" + body + '\nReply as JSON: {"ranking": ["<label>", ...]}')
        got = list(obj.get("ranking") or [])
        if sorted(got) != sorted(p["label"] for p in packets):
            raise BenchError("the ranking does not cover every deck once")
        return got


class NonClaudeJudge:
    """A hook for a judge from another model family, OFF unless DECK_BENCH_ALLOW_NON_CLAUDE=1 (ADR 0006).

    ``score_fn(packet, rubric)`` and ``rank_fn(packets, rubric, order)`` are supplied by the caller; the bench ships no client."""

    def __init__(self, family: str, score_fn: Callable, rank_fn: Callable, name: str | None = None):
        """Refuse unless the env var is '1'; the family must not be claude."""
        if os.environ.get(ENV_NON_CLAUDE) != "1":
            raise BenchError(f"a non-Claude judge is off: the engine's judges are Claude-only (ADR 0006); set {ENV_NON_CLAUDE}=1 to allow it in the offline bench")
        family = norm_family(family)
        if not family or family == CLAUDE_FAMILY:
            raise BenchError("a non-Claude judge needs its own family name")
        self.family, self.name = family, name or family
        self._s, self._r = score_fn, rank_fn

    def score(self, packet: dict, rubric: dict) -> dict:
        """Delegate to the supplied scorer and validate the result."""
        return check_judgment(self._s(packet, rubric), rubric, packet)

    def rank(self, packets: list, rubric: dict, order: str) -> list:
        """Delegate to the supplied ranker."""
        return list(self._r(packets, rubric, order))
