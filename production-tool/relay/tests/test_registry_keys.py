"""A provider with no key (local dev without RUNWAY_API_KEY) is left out with one warning line,
not a traceback at every start."""

import logging

from providers import load_registry


def test_a_missing_key_is_one_line(monkeypatch, caplog):
    monkeypatch.delenv("RUNWAY_API_KEY", raising=False)
    with caplog.at_level(logging.WARNING, logger="providers"):
        reg = load_registry()
    assert reg.get("runway") is None
    lines = [r for r in caplog.records if "runway" in r.getMessage()]
    assert [r.getMessage() for r in lines] == ["provider runway is off: RUNWAY_API_KEY is not set"]
    assert all(r.levelno == logging.WARNING and r.exc_info is None for r in lines)
