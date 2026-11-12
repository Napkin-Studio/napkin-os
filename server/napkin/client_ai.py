"""The client AI switch seam: has this client's written yes to AI been recorded?

No record builds the switch yet, so the answer is always no. The Idea room, the Script editor,
Judge and any creative tool that sends a client's work to a model share this ONE function; when a
record builds the switch (a recorded, written yes per client) only this function changes.
Nothing real reaches a model while it says no.
"""

from __future__ import annotations


def written_yes_recorded(scope: dict, client_id: str | None = None) -> bool:
    return False
