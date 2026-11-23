"""Territories to Deck Maker: the destination ``deck-maker`` of ``send_routes`` (feature territories-spinoff-out-deck).

What a send to Deck Maker is. The middleware cannot make a document: only the host can (``spinoff_document``, the Continue in a person sees in the
bar). So the send does the part that is the document's: it checks that every route named is a live route of THIS document and writes the send into
it (``sends[]``: the routes sent, the ones not chosen, who, when). The host's spin-off then carries the whole document, that record included, frozen,
under the Deck's ``data.upstream``; the Deck reads the routes from the send (``engine/deck/from_territory.py sent_ids``). The page asks the shell to
make that spin-off as soon as the send is written (``clan:continue-in``, app/templates/territories/index.html), so a person presses Send once.

A route that is not there, was killed, or is only a find (not developed) is refused in words: nothing is written (LESSONS 7: what is sent is what
the Deck will read).
"""
from __future__ import annotations

from . import delivery

DESTINATION = "deck-maker"
#: the app the page asks the shell to continue in (the Deck template's id, crates/clan-sdk/examples/make_deck_maker.rs)
DECK_APP = "ie.napkin.deck-maker"


def check_routes(data: dict, send: dict, where: str) -> None:
    """Refuse (``delivery.Refused``, in words) a send of a route that is gone, was killed, or is only a find. ``where`` names the tool in the words."""
    by_id = {t.get("id"): t for t in (data or {}).get("territories") or [] if isinstance(t, dict)}
    for tid in send.get("territory_ids") or []:
        t = by_id.get(tid)
        if t is None:
            raise delivery.Refused("One of those routes is not in this document any more. Look again, then send.")
        if t.get("status") == "killed":
            raise delivery.Refused(f"{t.get('name') or tid} was taken off the list. Greenlight a route that is still on it.")
        if t.get("state") != "developed":
            raise delivery.Refused(f"{t.get('name') or tid} is only a find so far: develop it before it goes to {where}.")


def deliver(doc_id: str, data: dict, send: dict) -> dict:
    check_routes(data, send, "Deck Maker")
    return {"status": "sent"}


delivery.register_destination(DESTINATION, deliver)
