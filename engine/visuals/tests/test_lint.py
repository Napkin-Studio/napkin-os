"""The fail-closed allow-list lint (deck-image-gen)."""
from pathlib import Path

import pytest

from visuals import lint

OK = "A kitchen tap at dawn, a glass filling under it, steam from a kettle behind."


def test_a_plain_subject_passes():
    assert lint.lint_text(OK) is None


@pytest.mark.parametrize("bad,why", [("A bottle of Guinness on a table.", "Guinness"), ("Twenty glasses on a table.", "twenty"),
                                     ("A mural in the style of Banksy.", "style"), ("A table with 3 glasses.", "digit"),
                                     ('A sign saying "hello".', "quotation"), ("A glass of quenelle foam.", "allowed"),
                                     ("A table. Then Sunday light.", "Sunday")])
def test_each_is_refused(bad, why):
    r = lint.lint_text(bad)
    assert r and why.lower() in r.lower()


def test_banned_imagery_is_refused():
    assert "banned" in lint.lint_text("A glass beside a bridge.", banned=["bridge"])


def test_the_assembled_default_style_block_passes():
    from visuals import style
    assert lint.lint_text(style.style_block(style.load(None)), banned=[]) is None


def test_the_lint_has_no_confidential_deny_list():
    """Owner, 26 Nov 2026: Confidential keeps a part out of Napkin's own knowledge only, so the picture lint judges content, not marks."""
    assert not hasattr(lint, "deny_list") and not hasattr(lint, "confidential_hit")
    assert "deny" not in lint.lint_text.__code__.co_varnames
    assert lint.lint_text("A blue kettle beside a window.") is None


# ---- the common-word allow-list (subjects Claude wrote for the live demo were all refused by a 400-word list)
def test_every_live_demo_stage_g_subject_passes_the_lint():
    import json
    g = json.loads((Path(__file__).parent / "fixtures" / "live_demo_g_image_subjects.json").read_text())
    assert len(g["subjects"]) == 5
    for key, v in g["subjects"].items():
        assert lint.lint_text(v["subject"], banned=[]) is None, (key, lint.lint_text(v["subject"]))


@pytest.mark.parametrize("text", ["Nike shoe on a table", "a nike shoe on a table", "a coca cola can on a table", "a 30% discount", "Banksy style mural",
                                  "a mural in the style of Banksy", "東京"])
def test_brands_numbers_styles_and_non_ascii_are_still_refused(text):
    assert lint.lint_text(text, banned=[]) is not None

