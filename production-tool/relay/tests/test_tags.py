import pytest

from providers.tags import UnknownTag, rewrite_tags

NAMES = ["hero", "sword"]
PROMPT = "@hero holds @sword, mail a@hero.com, @hero again"


@pytest.mark.parametrize("syntax,expected", [
    ("at_tag", "@hero holds @sword, mail a@hero.com, @hero again"),
    ("none", "hero holds sword, mail a@hero.com, hero again"),
])
def test_each_syntax(syntax, expected):
    assert rewrite_tags(PROMPT, NAMES, syntax) == expected


def test_unknown_tag_is_an_error_not_a_silent_pass():
    with pytest.raises(UnknownTag):
        rewrite_tags("@ghost walks", NAMES, "at_tag")


def test_unknown_syntax():
    with pytest.raises(ValueError):
        rewrite_tags("@hero", NAMES, "bogus")
