"""What leaves the Territories document: the files a person downloads and the hand-offs to other tools (feature territories-handlers).

Two small registries, filled by the features that own the content, so this one can ship first and they plug in without touching a handler:

    register_file(name, media_type, make)          territories-exports: ``make(doc_id, data) -> bytes`` (a board PDF, a one-pager, ...)
    register_destination(name, deliver)            territories-spinoff-out-deck / -production: ``deliver(doc_id, data, send) -> {"status": "sent"}``

``fetch_territories_file@1`` reads the first; ``send_routes`` reads the second. A destination nobody registered is NOT built: the send is
written ``not_built`` and says so in words, never ``sent`` (LESSONS 17).
"""
from __future__ import annotations

from typing import Callable

class Refused(Exception):
    """A destination that will not take this send, with the reason in words for the person. Nothing is written."""


#: name -> (media type, make(doc_id, data) -> bytes)
FILES: dict[str, tuple[str, Callable[[str, dict], bytes]]] = {}
#: file-name prefix -> (suffix, media type, for_name(name) -> make): files named by what they are of (a one-pager is ``territories-route-<route id>.html``)
FAMILIES: dict[str, tuple[str, str, Callable[[str], Callable[[str, dict], bytes]]]] = {}
#: destination id (``deck-maker``, ``production-tool``) -> deliver(doc_id, data, send) -> {"status": "sent" | "asked"}
DESTINATIONS: dict[str, Callable[[str, dict, dict], dict]] = {}

#: make(doc_id, data) -> reader(sha256 hex) -> bytes | None: where the bytes of a document's pictures come from (the source's signed assets pass).
#: Registered by the feature that owns the pass; with none, a picture not already on the store is named missing.
ASSET_READER: Callable[[str, dict], Callable[[str], bytes | None]] | None = None

#: the largest file handed back in one reply (it travels base64 inside the JSON envelope)
MAX_FILE_BYTES = 24 * 1024 * 1024


def register_file(name: str, media_type: str, make: Callable[[str, dict], bytes]) -> None:
    FILES[name] = (media_type, make)


def register_family(prefix: str, suffix: str, media_type: str, for_name: Callable[[str], Callable[[str, dict], bytes]]) -> None:
    FAMILIES[prefix] = (suffix, media_type, for_name)


def resolve(name: str) -> tuple[str, Callable[[str, dict], bytes]] | None:
    """(media type, make) of a file by its name: a registered file, else the family whose prefix and suffix it carries (with something between)."""
    if name in FILES:
        return FILES[name]
    for prefix, (suffix, media, for_name) in FAMILIES.items():
        if name.startswith(prefix) and name.endswith(suffix) and len(name) > len(prefix) + len(suffix):
            return media, for_name(name)
    return None


def names() -> list[str]:
    """What can be asked for, in words for an error: the files, and each family as ``<prefix>…<suffix>``."""
    return sorted(FILES) + [f"{p}<route>{v[0]}" for p, v in sorted(FAMILIES.items())]


def register_destination(name: str, deliver: Callable[[str, dict, dict], dict]) -> None:
    DESTINATIONS[name] = deliver


def register_asset_reader(make: Callable[[str, dict], Callable[[str], bytes | None]]) -> None:
    global ASSET_READER
    ASSET_READER = make
