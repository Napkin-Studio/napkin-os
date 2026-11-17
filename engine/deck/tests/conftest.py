"""Shared test setup for the deck suite.

BRIEF_TESTS_OFFLINE=1 (the CI engine job and scripts/check.sh set it): every outbound
socket connection raises, so a test that quietly reaches a hosted endpoint fails instead
of passing on the network. This is a deliberate copy of the block in engine/rag/conftest.py;
keep the two in step.
"""
from __future__ import annotations
import os


def pytest_configure(config):
    if os.environ.get("BRIEF_TESTS_OFFLINE", "").strip() not in ("1", "true", "yes"):
        return
    import socket

    def refuse(self, *a, **k):
        """Fail fast: this suite must not touch the network."""
        raise OSError("network disabled: BRIEF_TESTS_OFFLINE=1")
    socket.socket.connect = refuse          # type: ignore[assignment]
    socket.socket.connect_ex = refuse       # type: ignore[assignment]
