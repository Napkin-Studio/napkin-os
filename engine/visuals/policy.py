"""Who may send what to the picture models: the one switch both picture tools read (the Territory frames and the Deck's pictures).

CLIENT_TO_RUNWAY decides whether a prompt derived from client material (a client brief, a run not marked invented or demo) may go to
Runway's Gemini image models.

    allow    sent, but only after the picture-prompt lint (common-word allow-list, brand words) and the Confidential deny-list
    refuse   never sent; only material a person marked invented or demo goes

Decision (Sai, 18 Nov 2026): ALLOWED FOR TESTING; it may change. To stop it, change ``CLIENT_TO_RUNWAY`` below to "refuse" (the one place),
or set the environment variable ``VISUALS_CLIENT_TO_RUNWAY=refuse`` for one run. The variable, when set at all, must say ``allow`` or
``refuse``: any other value, the empty string included (``VISUALS_CLIENT_TO_RUNWAY=``), refuses (fail closed); only an unset variable
falls back to the setting below. Whatever the policy, the lint and the Confidential deny-list
always run, the brief's marks are always carried, and a part marked Confidential is never drawn. Every cost card and report says which
policy applied, so it is never silent.
"""
from __future__ import annotations

import os

#: allowed for testing, Sai 2026-11-18; may change. Flip to "refuse" to keep every client-derived prompt away from Runway.
CLIENT_TO_RUNWAY = "allow"
ENV = "VISUALS_CLIENT_TO_RUNWAY"
CHOICES = ("allow", "refuse")
DECIDED = "allowed for testing, Sai 2026-11-18; may change"


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
        return f"Client-derived prompts -> Runway: allowed (testing policy: {DECIDED}); every prompt is linted and Confidential parts are refused"
    return "Client-derived prompts -> Runway: refused (policy); only material marked invented or demo is sent"
