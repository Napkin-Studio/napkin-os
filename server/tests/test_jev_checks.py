"""Laurence's checks run whichever judge reads the brief (feature brief-jev-checks, ADR 0035 addendum)."""

import hashlib

from napkin.brief import checks
from napkin.brief.planned import REVIEW_SYSTEM


def test_the_review_prompt_is_byte_identical_to_what_it_was_before_the_guide_moved():  # T12
    assert len(REVIEW_SYSTEM) == 3384
    assert hashlib.sha256(REVIEW_SYSTEM.encode()).hexdigest() == \
        "bfe84c9b6faa045f9ad27f4c6220f1e370fdb28c9bf1e5a47ad1b222971a1231"


def test_the_review_prompt_takes_its_test_rules_from_checks():  # T13, review half
    tests, anti = checks.guide_parts()
    assert tests in REVIEW_SYSTEM and anti in REVIEW_SYSTEM
    assert checks.tests_guide() == tests + "\n" + anti
