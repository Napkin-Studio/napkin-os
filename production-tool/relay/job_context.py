"""The context block (features/pt-dex-context.clan): what Dex reads of JobInput.context, cut to each op.

The web fills input.context from what the project holds besides pictures and the person's words: the Brand
board's rules (a `palette`'s swatches, a `typography` ref's font, a `brand_rule`'s do, don't or tone) and the
`document`s linked into the node, by their excerpt (web/src/jobs/context.ts). Linked notes are already the
person's words (input.text) and the brief is input.brief (brief.py), so neither comes here.

Before Dex sees it, the relay keeps only the kinds each op reads, in that op's order, within its character
budget (a title and its text both count): a frame or a Generate reads the brand and the documents; an edit
reads the brand's look only; a clip reads the rules and the palette (a video model draws no type); a view
(a turnaround of the same character on a plain background) reads none. Whatever Dex writes from it still
counts towards the op's add budget (director ADD_BUDGET). A job with no context is passed on as it came.
"""

from __future__ import annotations

from brief import _cut

LOOK = ("brand_rule", "palette", "typography")
# Per op: the characters of context it reads in all, and the kinds it keeps, in the order they are kept.
BUDGET: dict[str, tuple[int, tuple[str, ...]]] = {
    "generate": (600, (*LOOK, "document")),
    "frame": (600, (*LOOK, "document")),
    "frame_edit": (300, LOOK),
    "region_edit": (300, LOOK),
    "clip": (300, ("brand_rule", "palette")),
    "clip_edit": (240, ("brand_rule", "palette")),
    "clip_patch": (160, ("brand_rule",)),
    "shot_list": (900, ("brand_rule", "document")),
}
MIN_CUT = 40  # a text is cut at a word only when at least this much room is left


def for_op(op: str, payload: dict) -> dict:
    """The job input as Dex reads it: input.context cut to this op, or left out on an op that reads none.
    No context: the same dict, untouched."""
    items = payload.get("context")
    if not items:
        return payload
    rest = {k: v for k, v in payload.items() if k != "context"}
    if op not in BUDGET:
        return rest
    room, kinds = BUDGET[op]
    kept: list[dict] = []
    for kind in kinds:
        for item in items:
            if item.get("kind") != kind or room <= 0:
                continue
            title = item.get("title") or ""
            text = item.get("text") or ""
            need = len(title) + len(text)
            if need <= room:
                kept.append(item)
                room -= need
            elif room - len(title) >= MIN_CUT:
                cut = _cut(text, room - len(title))
                kept.append({**item, "text": cut})
                room -= len(title) + len(cut)
    return {**rest, "context": kept} if kept else rest
