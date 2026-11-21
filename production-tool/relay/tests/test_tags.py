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


def test_r5_a_tagless_model_reads_a_view_as_the_characters_name_said_once():
    """UAT round 5 (R5-F8): the Omni take's prompt read "The woman is maya front, also seen in maya full ... maya front
    grins ... maya front and maya full are views of one single character"."""
    from providers.tags import rewrite_tags, unsent_in_words

    names = ["maya_front", "maya_full", "in_1", "in_2"]
    prompt = ("The woman is @maya_front, also seen in @maya_full.\nShot 1 [0-1 s] Down the hall, a flatmate snores, follows image 3 (@in_1)\n"
              "Shot 2 [1-3 s] @maya_front grins and raises a steaming mug, follows image 4 (@in_2)\n"
              "@maya_front and @maya_full are views of one single character from different sides: show exactly one of it, never copies.")
    out = rewrite_tags(prompt, names, "none")
    assert "maya front" not in out and "maya full" not in out and "@" not in out
    assert out.startswith("The woman is Maya.\n")
    assert "Shot 2 [1-3 s] Maya grins" in out and "follows image 4\n" in out
    assert out.endswith("Show exactly one Maya, never copies.")
    # A tagged model keeps its tags; a name it is not sent is said as the character's name too.
    assert rewrite_tags("@maya_front grins", ["maya_front"], "at_tag") == "@maya_front grins"
    assert unsent_in_words("@maya_full waves at @kettle_blue", ["maya_front"]) == "Maya waves at Kettle"
