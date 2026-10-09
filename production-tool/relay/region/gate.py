"""The shipping gate: region edit ships only if enough test edits stay inside the box."""

from __future__ import annotations

from typing import Optional, Union

from .image_ops import inside_box_ok


def evaluate_gate(results: list[Union[bool, dict]], need: int = 7, of: int = 10,
                  thresholds: Optional[dict] = None) -> dict:
    """Each result is a pass/fail or the metrics from pixel_diff. Passes at `need` of `of`."""
    oks = [r if isinstance(r, bool) else inside_box_ok(r, thresholds) for r in results]
    count = sum(oks)
    return {"passed": len(oks) >= of and count >= need, "count": count, "need": need, "of": of}
