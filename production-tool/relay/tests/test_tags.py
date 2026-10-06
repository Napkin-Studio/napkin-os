import pytest

from providers.tags import UnknownTag, rewrite_tags

NAMES = ["hero", "sword"]
PROMPT = "@hero holds @sword, mail a@hero.com, @hero again"


@pytest.mark.parametrize("syntax,expected", [
    ("at_tag", "@hero holds @sword, mail a@hero.com, @hero again"),
    ("at_image_n", "@Image1 holds @Image2, mail a@hero.com, @Image1 again"),
    ("picture_n", "<Picture 1> holds <Picture 2>, mail a@hero.com, <Picture 1> again"),
    ("figure_n", "Figure 1 holds Figure 2, mail a@hero.com, Figure 1 again"),
    ("image_n", "image 1 holds image 2, mail a@hero.com, image 1 again"),
    ("none", "hero holds sword, mail a@hero.com, hero again"),
])
def test_each_syntax(syntax, expected):
    assert rewrite_tags(PROMPT, NAMES, syntax) == expected


def test_position_follows_the_order_refs_are_sent():
    assert rewrite_tags("@hero @sword", ["sword", "hero"], "picture_n") == "<Picture 2> <Picture 1>"


def test_unknown_tag_is_an_error_not_a_silent_pass():
    with pytest.raises(UnknownTag):
        rewrite_tags("@ghost walks", NAMES, "at_tag")


def test_provider_dialect_prompt_is_untouched():
    assert rewrite_tags("<Picture 1> waves", NAMES, "picture_n") == "<Picture 1> waves"


def test_unknown_syntax():
    with pytest.raises(ValueError):
        rewrite_tags("@hero", NAMES, "bogus")
