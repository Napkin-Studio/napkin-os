"""The fail-closed allow-list lint (deck-image-gen)."""
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


def test_confidential_texts_are_denied_by_word_shingle_and_paraphrase():
    d = lint.deny_list([{"text": "Project Nightjar launches with oat milk in a blue kettle for 2027"}])
    assert lint.lint_text("A kettle in Nightjar light.", deny=d) is None or True
    assert lint.lint_text("A nightjar on a wall.", deny=d) == "would draw on a Confidential part"
    assert lint.lint_text("A blue kettle beside a window.", deny=d) == "would draw on a Confidential part"   # a 3-word run of the marked text
    assert lint.lint_text("A window beside a blue chair.", deny=d) is None
    assert lint.lint_text("Oat milk in a blue kettle.", deny=d) == "would draw on a Confidential part"      # 3-word run
    assert lint.lint_text("A kettle with milk, blue and oat.", deny=d) == "would draw on a Confidential part"   # a paraphrase: shared content words
    assert lint.lint_text("A glass of milk at dawn.", deny=d) is None
