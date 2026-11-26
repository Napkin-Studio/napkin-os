"""Acceptance final step (the deck from the Production project, read only): A32, the cover and the open items said '[Client]' although the
carried brief names the client, in a sentence ("Copperell Home Ltd is launching Copperell Refill: a ribbed amber glass…"). Invented words only.
Run from ``engine/``: ``PYTHONPATH=. python3 -m pytest -q deck/tests/test_deck_final_step.py``."""
from __future__ import annotations

import pytest

from deck import server as srv


@pytest.mark.parametrize("field, name", [
    ("Copperell Home Ltd is launching Copperell Refill: a ribbed amber glass spray bottle with a copper cap, made to keep for life.", "Copperell Home Ltd"),
    ("To confirm: Lumen Water (the utility), Dublin", "Lumen Water"),
    ("Fernley Drinks Ltd: a Cork-based drinks company", "Fernley Drinks Ltd"),
    ("Harrowgate Council wants more people to recycle", "Harrowgate Council"),
    ("Brightside Bakery - family bakers since 1952", "Brightside Bakery"),
    ("Copperell Home Ltd", "Copperell Home Ltd"),
    ("", ""),
    ("x" * 90, ""),
])
def test_the_client_is_the_name_before_the_sentence_that_describes_the_work(field, name):
    assert srv.client_name(field) == name
