"""Who is asking: the one seam every route takes its person from (features/drop-hackathon-extras.clan).

    who(headers) -> {"pid", "h", "t"} | None

pid is participant_id(team, handle), h the handle, t the team (the person's agency). None is no
identity: the relay answers 401 on every route but GET /health and GET /config. It fails closed:
with no source set, nobody is anyone.

The one source today is the local person: relay/local.py calls use_local(local_person()), and the
test harness hands the Relay its own who. Napkin OS sign-in plugs in here (the signed session
cookie that names the person) without touching the routes.
"""

from __future__ import annotations

import os

DEFAULT_LOCAL = ("local", "napkin")

_local: dict | None = None


def person(handle: str, team: str) -> dict:
    from service import participant_id  # service imports this module

    return {"pid": participant_id(team, handle), "h": handle, "t": team}


def local_person(spec: str | None = None) -> dict:
    """The person local.py runs as: NAPKIN_LOCAL_USER ("handle@agency"), else local@napkin."""
    spec = (os.environ.get("NAPKIN_LOCAL_USER", "") if spec is None else spec).strip()
    handle, _, team = spec.partition("@")
    handle, team = handle.strip(), " ".join(team.split())
    if not handle or not team:
        handle, team = DEFAULT_LOCAL
    return person(handle, team)


def use_local(who: dict | None) -> None:
    """Every request is this person (local.py only; None turns it off)."""
    global _local
    _local = dict(who) if who else None


def who(headers: dict) -> dict | None:
    return dict(_local) if _local else None
