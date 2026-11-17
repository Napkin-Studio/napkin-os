"""Join or cut storyboard shots (features/join-or-cut-shots.clan): a joined run is one take_refs generation with
every shot's frame as a guide, and director.v11 ties each shot's timed line to the frame it follows ("Shot k
[a-b s] ..., follows image k (@tag)"). Offline only: the passthrough, hand-written replies replayed through the
v11 prompt's checks, and the eval's `ties` score. No live or paid eval."""

from __future__ import annotations

import json
from pathlib import Path

import connected
from eval.director_eval import Replay, answer, load, score, table

PROMPTS = Path(__file__).resolve().parent.parent / "prompts"
CONTRACTS = Path(__file__).resolve().parent.parent.parent / "contracts"
FRAMES = "take_refs_frames_follow_images"
WORDS = "take_refs_words_follow_no_image"
ANCHOR = "@mira_front, a woman in a red raincoat, on a rainy city street at dusk; soft grey light, wet cobbles, 35 mm."
LINES = [
    "Shot 1 [0-3 s] @mira_front steps off a green tram into the rain, follows image 1 (@in_1)",
    "Shot 2 [3-6 s] @mira_front opens a small yellow umbrella and smiles up at the sky, follows image 2 (@in_2)",
    "Shot 3 [6-9 s] @mira_front walks past a glowing bakery window, glancing in at the bread, follows image 3 (@in_3)",
]


def case(cid: str) -> dict:
    return next(c for c in load()["cases"] if c["id"] == cid)


def reply(c: dict, prompt: str) -> str:
    """Dex's answer for a case: the passthrough's job (its refs, length and shape) with `prompt`."""
    job = dict(answer(c, load(), "passthrough")["providerJob"])
    job["prompt"] = prompt
    return json.dumps({"op": "clip", "providerJob": job, "question": None, "rationale": "One take; each shot follows its frame.", "confidence": 0.8})


def test_v11_is_v10_with_the_take_tied_to_its_frames():
    v10 = (PROMPTS / "director.v10.md").read_text().splitlines()
    v11 = (PROMPTS / "director.v11.md").read_text().splitlines()
    changed = [b for a, b in zip(v10, v11) if a != b]
    assert len(v10) == len(v11) and len(changed) == 1
    assert changed[0].startswith("  - `take_refs`:") and "follows image k" in changed[0] and "No frame is pinned" in changed[0]


def test_the_configs_run_v12_and_the_check_allows_v11():
    """v12 is v11 plus frame-edit-or-redraw's lines; v11 stays allowed for a rollback."""
    for name in ("config.live.json", "config.testing.json", "config.pathway.runway.json"):
        assert json.loads((CONTRACTS / "examples" / name).read_text())["director"]["promptVersion"] == "director.v12", name
    assert '"director.v11"' in (CONTRACTS / "check.py").read_text()


def test_the_passthrough_ties_each_shot_to_its_frame_and_sends_no_first_frame():
    rows = table(load(), ["passthrough"])["passthrough"]
    for cid in (FRAMES, WORDS):
        assert all(rows[cid].values()), (cid, rows[cid])
    job = answer(case(FRAMES), load(), "passthrough")["providerJob"]
    assert job["prompt"].splitlines() == LINES
    assert "firstFrame" not in job
    assert [(r["name"], r["role"]) for r in job["refs"]] == [("mira_front", "character"), ("mira_side", "character"), ("in_1", "object"), ("in_2", "object"), ("in_3", "object")]
    # Text only: the words and the character, and no line follows an image.
    words = answer(case(WORDS), load(), "passthrough")["providerJob"]
    assert "follows image" not in words["prompt"] and [r["name"] for r in words["refs"]] == ["mira_front", "mira_side"]


def test_a_v11_reply_that_ties_every_shot_passes_and_one_that_does_not_fails():
    c = case(FRAMES)
    good = answer(c, load(), "director.v11", Replay(reply(c, "\n".join([ANCHOR, *LINES]))))
    assert "error" not in good and all(score(c, good).values()), score(c, good)
    untied = answer(c, load(), "director.v11", Replay(reply(c, "\n".join([ANCHOR, *(line.split(", follows")[0] for line in LINES)]))))
    assert "error" not in untied and score(c, untied)["ties"] is False
    # A line that follows the wrong image fails too.
    swapped = [LINES[0], LINES[1].replace("image 2 (@in_2)", "image 3 (@in_3)"), LINES[2]]
    assert score(c, answer(c, load(), "director.v11", Replay(reply(c, "\n".join([ANCHOR, *swapped])))))["ties"] is False


def test_a_shot_whose_frame_was_left_out_follows_no_image():
    """Past the model's pictures the web drops the last frames (characters first): their lines name none."""
    inp = {"refs": [{"role": "composition", "label": "Shot 1 frame", "tag": "in_1"}, {"role": "character", "label": "@mira", "tag": "mira_front"}]}
    assert connected.frame_tags(inp) == {1: "in_1"}
    assert connected.tie_lines(["Steps off the tram.", "Opens the umbrella."], connected.frame_tags(inp)) == [
        "Steps off the tram, follows image 1 (@in_1)", "Opens the umbrella."]
    ok = "Shot 1 [0-3 s] steps off, follows image 1 (@in_1)\nShot 2 [3-6 s] opens the umbrella"
    assert connected.ties_problem(ok, inp) is None
    assert connected.ties_problem(ok + ", follows image 2 (@in_2)", inp) == "Shot 2 names an image it does not have: image 2"
    assert connected.ties_problem("Shot 1 [0-3 s] steps off, follows image 1", inp) == "Shot 1 does not name its frame @in_1"
