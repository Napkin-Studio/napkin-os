"""Brand detection: rules, then one Haiku call, then the question (mock a1)."""

import pytest

from brand_fixtures import BIBLE_PAGES, recorded
from napkin.brand.identify import identify, preselect, same_brand

BOOK = "\n".join(BIBLE_PAGES)
CLIENT = {"id": "tidewell", "name": "Tidewell"}
ORIGINAL = {"document_id": "d1", "path": "a/original.clan", "name": "Original", "default": True}
ZERO = {"document_id": "d2", "path": "a/zero.clan", "name": "Zero", "default": False}


class Model:
    """The Haiku call, answered from a recorded output; counts the calls."""

    def __init__(self, name="identify-yes.json", error=None):
        self.out, self.error, self.calls = recorded(name), error, []

    def structured(self, purpose, system, payload, schema, **kw):
        self.calls.append((purpose, payload, kw))
        if self.error:
            raise self.error
        return self.out


def test_a_brand_book_asks_once_with_one_haiku_call():
    m = Model()
    r = identify(m, "Tidewell-brand-book-2026.pdf", BOOK, 48, None, CLIENT, [])
    assert r["ask"] and r["model_called"] and len(m.calls) == 1 and m.calls[0][0] == "brand_identify"
    assert m.calls[0][2]["max_tokens"] == 200 and len(m.calls[0][1]["text"]) <= 6000
    assert r["matches_client"] is True and r["brand_name"] == "Tidewell"


def test_rules_that_say_no_cost_nothing():
    m = Model()
    r = identify(m, "call-notes.docx", "Kick-off call. Budget 250k.", 2, None, CLIENT, [ORIGINAL])
    assert not r["ask"] and not r["model_called"] and m.calls == [] and r["reason"] == "not_a_bible_by_rules"


def test_the_model_says_no_asks_nothing():
    r = identify(Model("identify-no.json"), "brand-guidelines.pdf", "", 20, None, CLIENT, [])
    assert not r["ask"] and r["reason"] == "not_a_bible"


def test_a_low_confidence_yes_asks_nothing():
    assert not identify(Model("identify-unsure.json"), "Tidewell-brand-book.pdf", BOOK, 20, None, CLIENT, [])["ask"]


def test_a_detection_that_fails_asks_nothing_and_does_not_raise():
    r = identify(Model(error=TimeoutError("slow")), "Tidewell-brand-book.pdf", BOOK, 20, None, CLIENT, [])
    assert not r["ask"] and r["reason"] == "detection_failed" and r["error"] == "TimeoutError"


def test_no_brand_clan_yet_offers_build_or_not():
    q = identify(Model(), "Tidewell-brand-book.pdf", BOOK, 20, None, CLIENT, [])["question"]
    assert (q["mode"], q["options"], q["update"]) == ("new", ["build", "not_bible"], None)


def test_some_brand_clans_offer_update_new_or_not_with_the_default_preselected():
    q = identify(Model(), "Tidewell-brand-book.pdf", BOOK, 20, None, CLIENT, [ORIGINAL, ZERO])["question"]
    assert q["mode"] == "choose" and q["options"] == ["update", "new", "not_bible"]
    assert q["update"] == {"document_id": "d1", "name": "Original"}


def test_a_file_name_pointing_at_another_brand_clan_preselects_it_but_still_asks():
    r = identify(Model(), "Tidewell-Zero-brand-book.pdf", BOOK, 20, None, CLIENT, [ORIGINAL, ZERO])
    assert r["ask"] and r["question"]["update"]["name"] == "Zero" and r["question"]["options"][0] == "update"


def test_preselect_rules():
    assert preselect("Tidewell-Zero-book.pdf", [ORIGINAL, ZERO], "Tidewell")["name"] == "Zero"
    assert preselect("book.pdf", [ORIGINAL, ZERO])["name"] == "Original"
    assert preselect("book.pdf", [{"name": "Only", "document_id": "x"}])["name"] == "Only"
    assert preselect("book.pdf", [{"name": "A"}, {"name": "B"}]) is None
    assert preselect("book.pdf", []) is None
    # a name that is the client's own is no pointer
    assert preselect("Zero-book.pdf", [ORIGINAL, {**ZERO, "name": "Tidewell"}], "Tidewell")["name"] == "Original"


def test_big_bibles_are_flagged_over_the_cap():
    q = identify(Model(), "Tidewell-brand-book.pdf", BOOK, 121, None, CLIENT, [])["question"]
    assert q["over_cap"] and q["page_cap"] == 120
    assert not identify(Model(), "Tidewell-brand-book.pdf", BOOK, 120, None, CLIENT, [])["question"]["over_cap"]


@pytest.mark.parametrize("a,b,want", [("Tidewell", "Tidewell Brewing", True), ("tidewell", "TIDEWELL", True), ("Acme", "Tidewell", False), (None, "Tidewell", None)])
def test_the_brand_name_is_matched_to_the_client_never_typed(a, b, want):
    assert same_brand(a, b) is want
