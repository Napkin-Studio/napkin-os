Fernley Drinks, a **fictional** Cork sparkling iced tea brand: a real live engine run recorded in 2026-10 (cost 0.83 USD,
an estimate from tokens, including one insight retry). `stages/` are the recorded stage outputs (a0 intake, a requirements,
b storyline, insight judge, c territories, d idea, fit, e copy, red team) and `prompt.txt` the only input. It is the free
replay fixture for the Deck Maker server (features/deck-maker-server.clan): no model is called to replay it.

`golden/` is what the engine wrote from it when this fixture was added (`deck.json` without `meta.built_at`, `validation.json`,
and `report.json` without its timings), checked equal before and after `run_deck --until` was added. Regenerate it only
for an intended change to the engine's output: `DECK_WRITE_GOLDEN=1 PYTHONPATH=. python3 -m pytest -q deck/tests/test_fernley_replay.py`
from `engine/`, then read the diff.

Source: Sai's live-demo recording (napkin-deck-handoff live2/agency/A), handed over on 2026-11-04.
