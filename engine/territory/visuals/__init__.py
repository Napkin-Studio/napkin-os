"""Frames per territory (features/territory-tool.clan, decision of 2026-11-17).

Starts from a SAVED run and never re-runs the text pipeline: the territory text, tiers and scores stay byte-for-byte
as the run file has them. The only input that changes the pictures is the style pack (engine/visuals/style.py). The Runway client,
the guard and the safe-messaging gate moved to engine/visuals (deck-image-gen) and are shared with the Deck. Modules here:

    plan.py    4 shot descriptions per territory, one model call per run, saved and reused
    board.py   cards with frames, and a simple HTML board
    cli.py     ``python -m territory.visuals --from-run <run.json>``
"""
