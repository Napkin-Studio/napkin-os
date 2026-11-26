"""Brand detection step 1: free rules over the file name and text."""

from brand_fixtures import BIBLE_PAGES
from napkin.brand.signals import read


def test_a_brand_book_is_yes():
    s = read("Tidewell-brand-book-2026.pdf", "\n".join(BIBLE_PAGES), 48)
    assert s.verdict == "yes" and "file name" in s.found and "clear space" in s.found and "hex codes" in s.found


def test_a_brief_is_no_and_costs_no_model_call():
    s = read("Zero-launch-call-notes.docx", "Kick-off call. Tidewell wants a summer campaign. Budget 250k. TV is a must.", 3)
    assert s.verdict == "no"


def test_the_name_alone_is_unsure_not_yes():
    s = read("brand-guidelines.pdf", "", 4)
    assert s.verdict == "unsure"


def test_text_without_the_name_can_still_ask():
    s = read("Tidewell 2026.pdf", "\n".join(BIBLE_PAGES), 12)
    assert s.verdict in ("unsure", "yes") and s.score >= 4


def test_a_zip_of_logos_and_fonts_counts():
    assert read("assets.zip", None, None, ["logos/mark.svg", "fonts/Serif.otf"]).verdict == "unsure"


def test_page_count_alone_is_not_enough():
    assert read("report.pdf", "Quarterly numbers.", 40).verdict == "no"
