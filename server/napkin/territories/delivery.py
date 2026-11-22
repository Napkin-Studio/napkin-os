"""What leaves the Territories document: the files a person downloads and the hand-offs to other tools (feature territories-handlers).

Two small registries, filled by the features that own the content, so this one can ship first and they plug in without touching a handler:

    register_file(name, media_type, make)          territories-exports: ``make(doc_id, data) -> bytes`` (a board PDF, a one-pager, ...)
    register_destination(name, deliver)            territories-spinoff-out-deck / -production: ``deliver(doc_id, data, send) -> {"status": "sent"}``

``fetch_territories_file@1`` reads the first; ``send_routes`` reads the second. A destination nobody registered is NOT built: the send is
written ``not_built`` and says so in words, never ``sent`` (LESSONS 17).
"""
from __future__ import annotations

from typing import Callable

#: name -> (media type, make(doc_id, data) -> bytes)
FILES: dict[str, tuple[str, Callable[[str, dict], bytes]]] = {}
#: destination id (``deck-maker``, ``production-tool``) -> deliver(doc_id, data, send) -> {"status": "sent" | "asked"}
DESTINATIONS: dict[str, Callable[[str, dict, dict], dict]] = {}

#: the largest file handed back in one reply (it travels base64 inside the JSON envelope)
MAX_FILE_BYTES = 24 * 1024 * 1024


def register_file(name: str, media_type: str, make: Callable[[str, dict], bytes]) -> None:
    FILES[name] = (media_type, make)


def register_destination(name: str, deliver: Callable[[str, dict, dict], dict]) -> None:
    DESTINATIONS[name] = deliver
