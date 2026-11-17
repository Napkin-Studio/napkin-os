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

    real_connect, real_connect_ex = socket.socket.connect, socket.socket.connect_ex

    def _is_local(self, addr) -> bool:
        """The deck server tests start the engine server on this machine and call it over loopback."""
        if self.family == socket.AF_UNIX:
            return True
        host = addr[0] if isinstance(addr, tuple) and addr else ""
        return host in ("127.0.0.1", "::1", "localhost")

    def refuse(self, addr, *a, **k):
        """Fail fast: this suite must not touch the network (loopback is allowed)."""
        if _is_local(self, addr):
            return real_connect(self, addr, *a, **k)
        raise OSError("network disabled: BRIEF_TESTS_OFFLINE=1")

    def refuse_ex(self, addr, *a, **k):
        if _is_local(self, addr):
            return real_connect_ex(self, addr, *a, **k)
        raise OSError("network disabled: BRIEF_TESTS_OFFLINE=1")
    socket.socket.connect = refuse          # type: ignore[assignment]
    socket.socket.connect_ex = refuse_ex    # type: ignore[assignment]
