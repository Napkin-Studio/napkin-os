"""Territories to the Production tool: the destination ``production-tool`` of ``send_routes`` (feature territories-spinoff-out-production).

Production is a library app like Brief Maker (features/production-in-library.clan), so this is the same hand-off as to Deck Maker and no
other: the middleware cannot make a document, only the host can (``spinoff_document``, the Continue in a person sees in the bar). The send
checks that every route named is a live, developed, greenlit route of THIS document and writes the send into it (``sends[]``). The host's spin-off
then carries the whole document, that record included and pictures as links (never bytes), frozen, under the project's ``data.upstream``;
the Production page reads the routes from there (``production-tool/web/src/brief/routes.ts``). The page asks the shell to make that spin-off
as soon as the send is written (``clan:continue-in``), so a person presses Send once.

A send with no greenlit route, or of a route that is gone, was killed, or is only a find, is refused in words: nothing is written (LESSONS 7).
"""
from __future__ import annotations

from . import delivery, to_deck

DESTINATION = "production-tool"
#: the app the page asks the shell to continue in (crates/clan-sdk/examples/make_production.rs)
PRODUCTION_APP = "ie.napkin.production"


def deliver(doc_id: str, data: dict, send: dict) -> dict:
    ids = [i for i in send.get("territory_ids") or [] if isinstance(i, str)]
    green = {g.get("territory_id") for g in (data or {}).get("greenlit") or [] if isinstance(g, dict)}
    if not ids or not set(ids) <= green:
        raise delivery.Refused("No greenlit route to send. Greenlight a route, then send it to the Production tool.")
    to_deck.check_routes(data, send, "the Production tool")
    return {"status": "sent"}


delivery.register_destination(DESTINATION, deliver)
