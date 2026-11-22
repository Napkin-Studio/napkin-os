"""Who may send what to the picture models: the one switch both picture tools read (the Territory frames and the Deck's pictures).

CLIENT_TO_RUNWAY decides whether a prompt derived from client material (a client brief, a run not marked invented or demo) may go to
Runway's Gemini image models.

    allow    sent, but only after the picture-prompt lint (common-word allow-list, brand words) and the Confidential deny-list
    refuse   never sent; only material a person marked invented or demo goes

Decision (Sai, 18 Nov 2026, later the same day): the default is REFUSE. Testers opt in for one run with the environment variable
``VISUALS_CLIENT_TO_RUNWAY=allow``; the setting below (the one place) stays "refuse". The variable, when set at all, must say ``allow`` or
``refuse``: any other value, the empty string included (``VISUALS_CLIENT_TO_RUNWAY=``), refuses (fail closed); only an unset variable
falls back to the setting below. Whatever the policy, the lint and the Confidential deny-list
always run, the brief's marks are always carried, and a part marked Confidential is never drawn. Every cost card and report says which
policy applied, so it is never silent.
"""
from __future__ import annotations

import os

#: refuse by default, Sai 2026-11-18 (it was allowed for testing earlier that day). VISUALS_CLIENT_TO_RUNWAY=allow overrides it for testers.
CLIENT_TO_RUNWAY = "refuse"
ENV = "VISUALS_CLIENT_TO_RUNWAY"
CHOICES = ("allow", "refuse")
DECIDED = "refuse by default, Sai 2026-11-18; VISUALS_CLIENT_TO_RUNWAY=allow for testing"


def client_to_runway(environ=None) -> str:
    """``allow`` or ``refuse``: the environment variable when set, else the setting above. A value that is neither refuses (fail closed),
    and so does an empty one: ``VISUALS_CLIENT_TO_RUNWAY=""`` is a set variable that names no policy, never a way back to the default."""
    raw = (os.environ if environ is None else environ).get(ENV)
    v = str(CLIENT_TO_RUNWAY if raw is None else raw).strip().lower()
    return v if v in CHOICES else "refuse"


def label(environ=None) -> str:
    """The line a card or report prints."""
    p = client_to_runway(environ)
    if p == "allow":
        return f"Client-derived prompts -> Runway: allowed (testing override: {ENV}=allow; the default is refuse); every prompt is linted and Confidential parts are refused"
    return "Client-derived prompts -> Runway: refused (policy); only material marked invented or demo is sent"


def allows(client_derived: bool, environ=None) -> bool:
    """May a prompt go to a picture provider at all? Material nobody derived from a client (marked invented or demo by a person) always
    may. Client-derived material may only under the testing override; the default refuses. The lint and the Confidential deny-list run
    either way, before anything is sent."""
    return (not client_derived) or client_to_runway(environ) == "allow"
