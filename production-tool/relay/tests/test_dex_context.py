"""What Dex receives and sends (features/pt-dex-context.clan, UAT-loop Dex audit 2026-11-21): a joined take's
"follows image n" is the frame's place in the refs the provider job sends; the project's brand rules and linked
documents reach Dex as input.context, cut per op; the brief reaches generate and region_edit within small
budgets and view not at all; the dogfood record keeps neither; director.v15 is v14 plus those lines only.
No model or provider is called."""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest
from test_director import PROMPTS, fixture, make

import brief as briefs
import connected
import dogfood
import job_context

HERE = Path(__file__).parent
WEB = HERE.parents[1] / "web"

CHARACTERS = [{"name": "mira_front", "role": "character"}, {"name": "mira_side", "role": "character"}]
FRAMES_IN = {"refs": [
    {"role": "character", "tag": "mira_front"}, {"role": "character", "tag": "mira_side"},
    {"role": "composition", "label": "Shot 1 frame", "tag": "in_1"},
    {"role": "composition", "label": "Shot 2 frame", "tag": "in_2"},
    {"role": "composition", "label": "Shot 3 frame", "tag": "in_3"},
]}
SENT = [*CHARACTERS, {"name": "in_1", "role": "object"}, {"name": "in_2", "role": "object"}, {"name": "in_3", "role": "object"}]
PROMPT = ("Mira on a rainy street.\n"
          "Shot 1 [0-3 s] @mira_front steps off the tram, follows image 1 (@in_1)\n"
          "Shot 2 [3-6 s] @mira_front opens an umbrella, follows image 2 (@in_2)\n"
          "Shot 3 [6-9 s] @mira_front walks past the bakery, follows image 3 (@in_3)")


# ── 1. a joined take's images are their places in the refs ───────────────────

def test_with_the_characters_first_shot_ks_frame_is_image_k_plus_two():
    assert connected.frame_images(FRAMES_IN, SENT) == {1: (3, "in_1"), 2: (4, "in_2"), 3: (5, "in_3")}


def test_dex_numbers_by_shot_are_rewritten_to_the_frames_places():
    out = connected.renumber_ties(PROMPT, FRAMES_IN, SENT)
    assert "follows image 3 (@in_1)" in out and "follows image 4 (@in_2)" in out and "follows image 5 (@in_3)" in out
    assert connected.ties_problem(out, FRAMES_IN, SENT) is None
    assert connected.ties_problem(PROMPT, FRAMES_IN, SENT) == "Shot 1 follows image 1, but its frame is image 3"
    # Already right: the same prompt back.
    assert connected.renumber_ties(out, FRAMES_IN, SENT) == out


def test_a_reordered_or_capped_ref_list_moves_or_drops_the_tie():
    # Dex sent the frames first: their places are 1 to 3.
    frames_first = [*SENT[2:], *SENT[:2]]
    assert connected.frame_images(FRAMES_IN, frames_first) == {1: (1, "in_1"), 2: (2, "in_2"), 3: (3, "in_3")}
    # The cap left shot 3's frame out: its line follows no image; the others keep theirs.
    capped = SENT[:4]
    out = connected.renumber_ties(PROMPT, FRAMES_IN, capped)
    assert out.splitlines()[3] == "Shot 3 [6-9 s] @mira_front walks past the bakery"
    assert connected.ties_problem(out, FRAMES_IN, capped) is None


def test_a_line_that_names_another_shots_frame_follows_its_own():
    wrong = PROMPT.replace("follows image 2 (@in_2)", "follows image 9 (@in_3)")
    assert "Shot 2 [3-6 s] @mira_front opens an umbrella, follows image 4 (@in_2)" in connected.renumber_ties(wrong, FRAMES_IN, SENT)


def test_the_relay_adds_no_tie_dex_did_not_write_and_leaves_other_lines_alone():
    bare = "Anchor block, follows image 7 in spirit.\nShot 1 [0-3 s] steps off\nShot 2 [3-6 s] opens, follows image 2 (@in_2)"
    out = connected.renumber_ties(bare, FRAMES_IN, SENT)
    assert out.splitlines()[0] == bare.splitlines()[0] and out.splitlines()[1] == "Shot 1 [0-3 s] steps off"
    assert out.splitlines()[2] == "Shot 2 [3-6 s] opens, follows image 4 (@in_2)"


# ── 3. input.context, cut per op ─────────────────────────────────────────────

CONTEXT = [
    {"kind": "document", "title": "Tone of voice", "text": "We speak plainly. " * 20},
    {"kind": "palette", "title": "@brand_palette", "text": "Navy #0A1F44, Sand #E8DCC4, Coral #FF6F59"},
    {"kind": "typography", "title": "@brand_type", "text": "Inter Bold (headlines)"},
    {"kind": "brand_rule", "title": "@brand_rule", "text": "Don't: never show the logo on a busy background"},
]


def test_no_context_is_passed_on_untouched():
    inp = {"text": "a red coat", "refs": []}
    assert job_context.for_op("frame", inp) is inp


def test_each_op_reads_its_kinds_in_order_and_a_view_reads_none():
    inp = {"text": "x", "context": CONTEXT}
    def kinds(op):
        return [c["kind"] for c in job_context.for_op(op, inp).get("context", [])]
    assert kinds("frame") == ["brand_rule", "palette", "typography", "document"]
    assert kinds("region_edit") == ["brand_rule", "palette", "typography"]
    assert kinds("clip") == ["brand_rule", "palette"]
    assert kinds("clip_patch") == ["brand_rule"]
    assert kinds("shot_list") == ["brand_rule", "document"]
    for op in ("view", "upscale", "resize", "cutdown", "write"):
        assert "context" not in job_context.for_op(op, inp), op


@pytest.mark.parametrize("op", sorted(job_context.BUDGET))
def test_every_op_holds_its_budget_with_the_longest_context(op):
    longest = [{"kind": k, "title": "T" * 200, "text": "word " * 800} for k in ("brand_rule", "palette", "typography", "document")] * 4
    cut = job_context.for_op(op, {"context": longest}).get("context", [])
    assert sum(len(c.get("title", "")) + len(c["text"]) for c in cut) <= job_context.BUDGET[op][0]


def test_context_reaches_dex_cut_to_the_op():
    f = fixture("generate_runway")
    from names import to_wire
    d, wire = make(f["reply"])
    d.run("generate", {**to_wire("generate", f["input"]), "context": CONTEXT}, "runway")
    sent = json.loads(wire.calls[0]["turns"][0]["text"].split("<input>\n", 1)[1].rsplit("\n</input>", 1)[0])
    assert [c["kind"] for c in sent["input"]["context"]] == ["brand_rule", "palette", "typography", "document"]
    assert sum(len(c.get("title", "")) + len(c["text"]) for c in sent["input"]["context"]) <= job_context.BUDGET["generate"][0]


def test_a_view_never_shows_dex_the_context_or_the_brief():
    f = fixture("view_mock")
    from names import to_wire
    d, wire = make(f["reply"])
    d.run("view", {**to_wire("view", f["input"]), "context": CONTEXT,
                   "brief": {"title": "B", "spine": {"tone": "Warm", "donts": ["No gyms"]}}}, f["provider"])
    sent = json.loads(wire.calls[0]["turns"][0]["text"].split("<input>\n", 1)[1].rsplit("\n</input>", 1)[0])
    assert "context" not in sent["input"] and "brief" not in sent["input"]


# ── 4. the brief per op ──────────────────────────────────────────────────────

SPINE = {"proposition": "Lumen is what the day starts with.", "audience": "Adults 25 to 40.", "tone": "Quiet, warm",
         "feel": "Calm and ready", "mandatories": ["Lumen name first"], "donts": ["Don't show a gym"]}


def test_generate_reads_donts_tone_and_feel_and_region_edit_only_the_donts():
    gen = briefs.for_op("generate", {"brief": {"title": "B", "spine": SPINE}})["brief"]["spine"]
    assert list(gen) == ["donts", "tone", "feel"]
    edit = briefs.for_op("region_edit", {"brief": {"title": "B", "spine": SPINE}})["brief"]["spine"]
    assert edit == {"donts": ["Don't show a gym"]}
    assert "brief" not in briefs.for_op("view", {"brief": {"title": "B", "spine": SPINE}})


def test_the_web_and_the_relay_send_the_brief_on_the_same_ops():
    src = (WEB / "src" / "brief" / "model.ts").read_text()
    web = re.search(r"export const BRIEF_OPS: readonly Op\[\] = \[([^\]]*)\]", src).group(1)
    assert sorted(re.findall(r"'([a-z_]+)'", web)) == sorted(briefs.BRIEF_OPS) == sorted(briefs.BUDGET)


def test_the_web_sends_context_on_the_ops_the_relay_cuts():
    src = (WEB / "src" / "jobs" / "context.ts").read_text()
    web = re.search(r"export const CONTEXT_OPS: readonly Op\[\] = \[([^\]]*)\]", src).group(1)
    assert sorted(re.findall(r"'([a-z_]+)'", web)) == sorted(job_context.BUDGET)


# ── the record never keeps the client's words ────────────────────────────────

def test_the_dogfood_record_drops_the_context():
    raw = json.dumps({"op": "frame", "input": {"text": "x", "context": CONTEXT}}).encode()
    kept, had = dogfood.without_context(raw)
    assert had and "context" not in json.loads(kept)["input"] and b"plainly" not in kept
    assert dogfood.without_context(b"not json") == (b"not json", False)
    plain = json.dumps({"op": "frame", "input": {"text": "x"}}).encode()
    assert dogfood.without_context(plain) == (plain, False)


# ── director.v15 ─────────────────────────────────────────────────────────────

def test_v15_is_v14_with_three_lines_changed():
    v14 = (PROMPTS / "director.v14.md").read_text().splitlines()
    v15 = (PROMPTS / "director.v15.md").read_text().splitlines()
    changed = [b for a, b in zip(v14, v15) if a != b]
    assert len(v14) == len(v15) and len(changed) == 3
    roles, drawing, take = changed
    assert roles.startswith("- Provider roles:") and "An unnamed picture (role `other` and no `name`" in roles
    assert drawing.startswith("- A drawing with role `character`, or an unnamed drawing")
    assert take.startswith("  - `take_refs`:") and "its place among the refs you send" in take and "follows image 4 (@in_2)" in take
