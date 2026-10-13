"""Team name + name make a workspace (features/personal-workspaces.clan, 2026-10-09): unusual team
names and one spelling per team. The identity seam names the person (features/drop-hackathon-extras.clan);
the relay turns their team and name into one workspace."""

from __future__ import annotations

import pytest

from conftest import Harness, base_config
from contracts import Contracts
from service import participant_id, same_text


@pytest.fixture
def h():
    return Harness(base_config())


def me(h, team, handle="maya", expect=200):
    return h.call("GET", "/me", None, h.as_person(handle, team), expect=expect)[1]


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
    "a.b_c-d",                # the name's own characters
])
def test_a_team_name_can_be_anything_a_person_might_call_their_team(h, team):
    out = me(h, team)
    assert out["team"] == team and out["participantId"] == participant_id(team, "maya")
    assert Contracts().errors("relay-api.schema.json#/$defs/Me", out) == []


def test_one_team_however_it_is_spelled():
    spellings = ["Blue Herons", "blue herons", "BLUE  HERONS", "  Blue Herons ", "Ｂｌｕｅ Ｈｅｒｏｎｓ"]
    assert len({participant_id(t, "Maya") for t in spellings}) == 1
    assert len({participant_id("Blue Herons", n) for n in ("Maya", "maya", "MAYA")}) == 1
    assert same_text("Straße") == same_text("STRASSE")  # case folding, not just lower()


def test_the_same_name_in_two_teams_is_two_people(h):
    a, b = me(h, "Blue Herons"), me(h, "Pixel Pals")
    assert a["participantId"] != b["participantId"] and a["workspace"] != b["workspace"]


def test_a_block_names_one_person_or_a_name_everywhere(h):
    h.store.blocked.add("blue herons/mallory")
    assert h.post_job(h.as_person("Mallory", "Blue Herons"), expect=403)[1]["error"]["code"] == "blocked"
    h.post_job(h.as_person("Mallory", "Pixel Pals"), expect=200)  # another team's Mallory is someone else
    h.store.blocked.add("eve")
    h.post_job(h.as_person("Eve", "Blue Herons"), expect=403)
    h.post_job(h.as_person("Eve", "Pixel Pals"), expect=403)
