"""A project name is a short name: the caveat is never part of the document's title."""
from napkin.brief.fields import clean, short_name

LONG = ("Proper Crunch (working name, taken from the founder's preferred line; "
        "needs a trademark check against Propercorn and Proper)")


def test_a_caveat_is_cut_from_the_name():
    assert short_name(LONG) == "Proper Crunch"
    assert clean("project_name", LONG) == "Proper Crunch"


def test_short_names_pass_and_long_ones_are_capped():
    assert short_name("Moving People") == "Moving People"
    assert short_name("Glenmore 12 relaunch - phase two") == "Glenmore 12 relaunch"
    assert short_name("(Draft) Foo bar") == "Draft Foo bar"
    assert len(short_name("word " * 30)) <= 40
    assert clean("project_name", "   ") is None


def test_other_parts_are_untouched():
    assert clean("background", "Long text (with brackets); and more") == "Long text (with brackets); and more"
