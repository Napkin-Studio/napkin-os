"""Frames per territory (features/territory-tool.clan, decision of 2026-11-17).

Starts from a SAVED run and never re-runs the text pipeline: the territory text, tiers and scores stay byte-for-byte
as the run file has them. The only input that changes the pictures is the style pack (``style.py``). Modules:

    plan.py    4 shot descriptions per territory, one model call per run, saved and reused
    style.py   the style pack (style.yaml + up to 14 reference images), its hash and the prompt block
    runway.py  the Runway client: key from the environment only, cost card, manifest, idempotent
    guard.py   optional local vision check (Ollama) for readable text, logos and brand names
    safety.py  the safe-messaging gate (suicide / self-harm briefs get no frames until a person reviews)
    board.py   cards with frames, and a simple HTML board
    cli.py     ``python -m territory.visuals --from-run <run.json>``
"""
