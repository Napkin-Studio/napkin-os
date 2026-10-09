"""Team name + name make a workspace (features/personal-workspaces.clan, 2026-10-09): unusual team
names, one spelling per team, and the one clash team names can't prevent: two people in one team
who pick the same name."""

from __future__ import annotations

import pytest

from conftest import Harness, base_config
from contracts import Contracts
from service import participant_id, same_text, team_problem


@pytest.fixture
def h():
    return Harness(base_config())


def session(h, team, handle="maya", device=None, expect=200):
    body = {"eventCode": "HACK", "team": team, "handle": handle}
    if device:
        body["device"] = device
    return h.call("POST", "/session", body, expect=expect)[1]


@pytest.mark.parametrize("team", [
    "Blue Herons",            # spaces
    "Équipe 7",               # accents
    "R&D",                    # punctuation
    "O'Brien's crew",         # apostrophes
    "チーム",                  # another script
    "Команда",                # Cyrillic
    "فريق",                   # right-to-left
    "🦩 Flamingos",           # emoji
    "👩‍💻 Coders",               # an emoji joined with a zero-width joiner
    "12",                     # digits only
    "x" * 40,                 # the longest
    "a.b_c-d",                # the name's own characters
])
def test_a_team_name_can_be_anything_a_person_might_call_their_team(h, team):
    out = session(h, team)
    assert out["team"] == team and out["participantId"] == participant_id(team, "maya")
    assert Contracts().errors("relay-api.schema.json#/$defs/SessionResponse", out) == []


@pytest.mark.parametrize("team, why", [
    ("a", "2 to 40"),                 # too short
    ("   a   ", "2 to 40"),           # short once trimmed
    ("x" * 41, "2 to 40"),            # too long
    ("blue/herons", "/"),             # the separator: 'a/b' + 'c' would be 'a' + 'b/c'
    ("blue​herons", "hidden"),   # a zero-width space
    ("blue‮herons", "hidden"),   # a right-to-left override
])
def test_a_team_name_without_room_for_mixups_is_refused(h, team, why):
    if "/" in team or len(team) > 80:  # the contract refuses these before the relay's own check
        session(h, team, expect=400)
        return
    out = session(h, team, expect=400)
    assert why in out["error"]["message"]


def test_one_team_however_it_is_spelled():
    spellings = ["Blue Herons", "blue herons", "BLUE  HERONS", "  Blue Herons ", "Ｂｌｕｅ Ｈｅｒｏｎｓ"]
    assert len({participant_id(t, "Maya") for t in spellings}) == 1
    assert len({participant_id("Blue Herons", n) for n in ("Maya", "maya", "MAYA")}) == 1
    assert same_text("Straße") == same_text("STRASSE")  # case folding, not just lower()


def test_the_separator_cannot_make_two_workspaces_one():
    assert team_problem("a/b") is not None  # so ('a/b', 'c') and ('a', 'b/c') can never both exist


def test_the_same_name_in_two_teams_is_two_people(h):
    a, b = session(h, "Blue Herons"), session(h, "Pixel Pals")
    assert a["participantId"] != b["participantId"] and a["workspace"] != b["workspace"]


def test_two_people_in_one_team_with_the_same_name_are_told_not_refused(h):
    h.clock.t = 1_000_000.0
    first = session(h, "Blue Herons", device="laptop-1111")
    assert "elsewhere" not in first
    h.clock.tick(180)
    second = session(h, "blue herons", "MAYA", device="desktop-2222")  # another browser, same team and name
    assert second["participantId"] == first["participantId"]  # one workspace: names are the only key
    assert "elsewhere" in second  # sign-in says so; the person picks another name if it isn't them


def test_the_same_browser_or_an_old_sign_in_raises_no_warning(h):
    h.clock.t = 1_000_000.0
    session(h, "Blue Herons", device="laptop-1111")
    assert "elsewhere" not in session(h, "Blue Herons", device="laptop-1111")  # signing in again here
    h.clock.tick(3 * 3600)
    assert "elsewhere" not in session(h, "Blue Herons", device="desktop-2222")  # the other was hours ago
    assert "elsewhere" not in session(h, "Blue Herons")  # no device id: neither noted nor warned


def test_a_block_names_one_person_or_a_name_everywhere(h):
    h.store.blocked.add("blue herons/mallory")
    session(h, "Blue Herons", "Mallory", expect=403)
    assert session(h, "Pixel Pals", "Mallory")["handle"] == "Mallory"  # another team's Mallory is someone else
    h.store.blocked.add("eve")
    session(h, "Blue Herons", "Eve", expect=403)
    session(h, "Pixel Pals", "Eve", expect=403)
