"""Character cards: what each reference picture shows, in a few words (features/character-cards.clan).

The director never sees the pictures, only their names, roles and kinds. A card is 2-4 short factual
lines about one picture (who or what, shape, colours, clothing or markings, style, pose or view),
written by one vision call (Haiku 4.5, the picture downscaled to about 768 px) the first time a job
sends that picture as a ref. It is cached for good under `cards/<hex>.json` in the relay's blob store
(the hex of the picture's sha256), and in memory, so a picture is looked at once, ever.

`Cards.attach(refs)` gives the refs a job sends (after names.fit_refs) their `card`:

- cached cards at once; missing ones made in parallel, all within one budget (6 s);
- a card not ready in time is skipped for this job. Where the relay lives on (the local dev server,
  `background=True`) the call carries on and the next job finds it. On Lambda (`background=False`)
  the call's own timeout is the budget, so nothing outlives the response by more than a moment, and
  the card is simply made on the next job;
- no model, a picture that is not ours, a vision error or a timeout: no card. A card never fails a job.

Cost and latency go through the model port's usage and metrics (purpose `character_card`), plus one
`cards` line per job.
"""

from __future__ import annotations

import base64
import io
import json
import logging
import threading
import time
from concurrent.futures import Future, ThreadPoolExecutor, wait
from dataclasses import dataclass, field

from director.metrics import emit
from director.model import ModelError, Usage

log = logging.getLogger("relay.cards")

PURPOSE = "character_card"
KINDS = ("character", "object", "setting", "style", "other")
BUDGET_S = 6.0
MAX_PER_JOB = 14          # the ref limit (relay-api JobInput.refs maxItems)
SIDE_PX = 768
MAX_LINES = 4
MAX_LINE = 160
MEMO_MAX = 4096
# Haiku 4.5 on the Anthropic API, per token: an estimate for the log, not a bill (Bedrock prices differ).
USD_IN, USD_OUT = 1.0 / 1_000_000, 5.0 / 1_000_000

SYSTEM = """You write a character card: a short, factual description of one picture, for a director who cannot see it.

Write 2 to 4 short lines, each one plain fact about what is visible:
- who or what it is (a character, an object, a place, a style sample, a texture);
- shape and proportions;
- colours;
- clothing, markings or surface;
- the drawing or rendering style (rough pencil sketch, flat 2D, photo, 3D render);
- the pose or view (front, side, three-quarter, back) when it has one.

Describe only what is in the picture. No names, no story, no guesses about intent, no praise. Do not repeat any text written in the picture except to say that it has writing.

`kind` is what the picture mainly is: character (a person, animal or creature), object (a thing or prop), setting (a place or scene), style (a sample of a look or rendering), other (a texture, pattern, palette or anything else)."""

SCHEMA = {
    "type": "object",
    "properties": {
        "card": {"type": "string", "minLength": 1, "maxLength": 800,
                 "description": "2-4 short factual lines, one per line."},
        "kind": {"enum": list(KINDS)},
    },
    "required": ["card", "kind"],
    "additionalProperties": False,
}


def card_key(sha256: str) -> str:
    return f"cards/{sha256.removeprefix('sha256:')}.json"


def tidy(text: str) -> str:
    """At most 4 lines of at most 160 characters, no blank lines, no bullets."""
    lines = [ln.strip().lstrip("-•* ").strip() for ln in (text or "").splitlines()]
    lines = [ln[:MAX_LINE].rstrip() for ln in lines if ln][:MAX_LINES]
    return "\n".join(lines)


def downscale(data: bytes, side: int = SIDE_PX) -> tuple[str, str]:
    """The picture as a JPEG whose longer side is at most `side` px, base64: (media_type, data).
    Transparency goes on white (a drawing's empty canvas). Raises on bytes that are not a picture."""
    from PIL import Image

    im = Image.open(io.BytesIO(data))
    im.seek(0)
    im.thumbnail((side, side))
    if im.mode in ("RGBA", "LA", "P"):
        im = im.convert("RGBA")
        bg = Image.new("RGB", im.size, (255, 255, 255))
        bg.paste(im, mask=im.getchannel("A"))
        im = bg
    elif im.mode != "RGB":
        im = im.convert("RGB")
    out = io.BytesIO()
    im.save(out, "JPEG", quality=85)
    return "image/jpeg", base64.b64encode(out.getvalue()).decode()


@dataclass
class Attached:
    """What attach() did for one job."""
    refs: list[dict]
    cards: list[dict] = field(default_factory=list)   # [{sha256, card, kind}] in ref order, one per picture
    cached: int = 0
    made: int = 0
    late: int = 0
    failed: int = 0
    ms: int = 0


class Cards:
    def __init__(self, port, blobs, model, *, budget_s: float = BUDGET_S, background: bool = True):
        """`port`: a ModelPort (director/model.py). `model`: the model id, or a callable giving it
        (the director's per-click model, which config.json may change). `background`: a late card
        may finish after the job goes on (a long-lived process); False on Lambda."""
        self.port, self.blobs, self.budget_s, self.background = port, blobs, budget_s, background
        self._model = model if callable(model) else (lambda: model)
        self._memo: dict[str, dict] = {}
        self._inflight: dict[str, Future] = {}
        self._lock = threading.Lock()
        self._pool = ThreadPoolExecutor(max_workers=MAX_PER_JOB, thread_name_prefix="card")

    # ── one picture ────────────────────────────────────────────────────────
    def cached(self, sha256: str) -> dict | None:
        with self._lock:
            hit = self._memo.get(sha256)
        if hit:
            return hit
        try:
            got = self.blobs.get_json(card_key(sha256))
        except Exception:
            log.exception("reading the card for %s failed", sha256)
            return None
        if got and got.get("card"):
            self._remember(sha256, got)
            return got
        return None

    def _remember(self, sha256: str, card: dict) -> None:
        with self._lock:
            if len(self._memo) >= MEMO_MAX:
                self._memo.pop(next(iter(self._memo)))
            self._memo[sha256] = card

    def _make(self, sha256: str, url: str, job_id: str, usage: Usage) -> tuple[dict | None, bool]:
        """(card, made by this call): the store's card, else one vision call. (None, False) when
        the picture is not ours."""
        hit = self.cached(sha256)
        if hit:
            return hit, False
        if self.blobs.key_for_url(url) is None:
            return None, False  # only pictures in our own store: never an outside fetch on a job's clock
        media_type, data = downscale(self.blobs.fetch(url))
        model = self._model()
        out = self.port.call(PURPOSE, SYSTEM, {"picture": "the attached image"}, SCHEMA, usage=usage,
                             attribution=job_id or PURPOSE, images=[{"media_type": media_type, "data": data}],
                             vision=True, model=model, max_tokens=400,
                             headers={"X-Napkin-Handler": PURPOSE, "X-Napkin-Job": job_id or "-"})
        text = tidy(out["card"])
        if not text:
            raise ModelError("the card came back empty", "invalid_output")
        card = {"sha256": sha256, "card": text, "kind": out["kind"], "model": model}
        self.blobs.put(card_key(sha256), json.dumps(card).encode(), "application/json")
        self._remember(sha256, card)
        return card, True

    def _start(self, sha256: str, url: str, job_id: str, usage: Usage) -> tuple[Future, bool]:
        """The future for this picture's card, and whether this job started it."""
        with self._lock:
            f = self._inflight.get(sha256)
            if f is not None:
                return f, False  # another job is already looking at this picture
            f = self._pool.submit(self._make, sha256, url, job_id, usage)
            self._inflight[sha256] = f
        f.add_done_callback(lambda _f, s=sha256: self._done(s))
        return f, True

    def _done(self, sha256: str) -> None:
        with self._lock:
            self._inflight.pop(sha256, None)

    # ── one job ────────────────────────────────────────────────────────────
    def attach(self, refs: list[dict], job_id: str = "") -> Attached:
        """A copy of `refs` with `card` on each ref whose card is ready within the budget."""
        t0 = time.monotonic()
        usage = Usage()
        pictures: dict[str, str] = {}
        for r in refs[:MAX_PER_JOB]:
            a = r.get("asset") or {}
            if isinstance(a.get("sha256"), str) and isinstance(a.get("url"), str):
                pictures.setdefault(a["sha256"], a["url"])
        ready: dict[str, dict] = {}
        futures: dict[str, Future] = {}
        mine: set[str] = set()
        res = Attached(refs=refs)
        for sha, url in pictures.items():
            with self._lock:
                hit = self._memo.get(sha)
            if hit:
                ready[sha] = hit
                res.cached += 1
            else:
                futures[sha], started = self._start(sha, url, job_id, usage)
                if started:
                    mine.add(sha)
        if futures:
            done, _ = wait(futures.values(), timeout=self.budget_s)
            for sha, f in futures.items():
                if f not in done:
                    res.late += 1
                    continue
                try:
                    card, made = f.result()
                except Exception as e:
                    res.failed += 1
                    log.warning("job %s: no card for %s (%s: %s)", job_id, sha, getattr(e, "kind", type(e).__name__), e)
                    continue
                if card is None:
                    res.failed += 1
                    continue
                ready[sha] = card
                if made and sha in mine:  # this job paid for it
                    res.made += 1
                else:
                    res.cached += 1
        out = []
        for r in refs:
            sha = (r.get("asset") or {}).get("sha256")
            card = ready.get(sha)
            out.append({**r, "card": card["card"]} if card else dict(r))
        seen: set[str] = set()
        for sha in pictures:
            if sha in ready and sha not in seen:
                seen.add(sha)
                res.cards.append({"sha256": sha, "card": ready[sha]["card"], "kind": ready[sha]["kind"]})
        res.refs = out
        res.ms = int((time.monotonic() - t0) * 1000)
        if pictures:
            usd = usage.input_tokens * USD_IN + usage.output_tokens * USD_OUT
            log.info("cards %s: %d pictures, %d cached, %d made, %d late, %d failed in %d ms; "
                     "tokens %d in / %d out (~$%.4f, %s)", job_id, len(pictures), res.cached, res.made, res.late,
                     res.failed, res.ms, usage.input_tokens, usage.output_tokens, usd, self._model())
            emit("cards", job=job_id, pictures=len(pictures), cached=res.cached, made=res.made, late=res.late,
                 failed=res.failed, ms=res.ms, input_tokens=usage.input_tokens, output_tokens=usage.output_tokens,
                 usd_estimate=round(usd, 5), model=self._model())
        if res.late and not self.background:
            log.info("cards %s: %d late, made on a later job", job_id, res.late)
        return res


def make(director, blobs, *, background: bool) -> Cards | None:
    """Cards over the director's model port, or None when there is no model (the passthrough)."""
    inner = getattr(director, "director", None)   # ClaudeDirector wraps the harness lane's Director
    port = getattr(inner, "port", None)
    if port is None:
        return None
    from director.model import ModelPort
    # Its own port over the same wire: on Lambda a card call may not outlive the job's budget.
    timeout = BUDGET_S if not background else port.timeout
    card_port = ModelPort(port.wire, port.model, timeout=timeout, routes=port.routes)
    return Cards(card_port, blobs, lambda: inner.per_click_model, background=background)
