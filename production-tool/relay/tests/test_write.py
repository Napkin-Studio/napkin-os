"""Skye's `write` op (features/script-editor.clan): internal, no spend, the text quota, crew skye,
unknown @names reach her as written, the tenant's text-model hook, a question as needs_input
that an answer resumes, base_hash echoed, and the prompt's contract with a fake model."""

from __future__ import annotations

import json
from pathlib import Path

from conftest import envelope
from contracts_dir import contracts_dir
from director import new_id
from writer import ModelWriter, PassthroughWriter, output_schema, rough_seconds, settle

BASE = "sha256:" + "d" * 64


def write_input(intent="tighten", text="@maya_front walks the waterline. The light is low and gold.", **extra) -> dict:
    return {"write": {
        "intent": intent,
        "target": {"kind": "shot", "id": new_id("shot")},
        "base_hash": BASE,
        "lines": [{"type": "action", "text": text}, {"type": "direction", "text": "Unhurried."}],
        "context": {"script_title": "First Light", "target_s": 15, "neighbours": "Shot 2: The sea.",
                    "refs": [{"name": "maya_front", "role": "character"}]},
        **extra,
    }}


def post_write(h, token, expect=200, **kw):
    req = {**envelope("write", new_id("job")), "node": {"kind": "script", "id": new_id("script")}, "input": write_input(**kw)}
    return h.call("POST", "/jobs", req, token, expect=expect)


def test_write_is_skyes_internal_job_on_the_text_quota_with_no_spend(h):
    token = h.as_person()
    _, job = post_write(h, token)
    assert job["state"] == "completed"
    assert (job["crew"], job["quotaClass"], job["op"]) == ("skye", "text", "write")
    assert "provider" not in job
    assert job["cost"]["estimate"] == 0 and job["cost"]["reserved"] == 0
    assert h.store.counters("spend").get("usd", 0) == 0
    for p in h.providers.values():
        assert p.submits == []
    [draft] = job["writes"]
    assert draft["base_hash"] == BASE  # echoed: a draft lands after a reload, and goes stale on Keep if the text moved
    assert draft["lines"][0]["text"] == "@maya_front walks the waterline."
    assert draft["note"] == "I tightened it."
    assert job["director"]["promptVersion"] == "skye.v6"


def test_a_draft_writes_from_the_instruction_not_the_items_words(h):
    # Owner's named bug (2026-11-03): a draft's brief is the instruction, never the item's prose, so
    # the prompt is never diffed as the writer's own words. The draft is a short screenplay from it.
    token = h.as_person()
    _, job = post_write(h, token, intent="draft", text="", instruction="A runner drinks Lumen water at dawn.")
    assert job["state"] == "completed"
    draft = job["writes"][0]
    assert draft["mode"] == "draft"
    # A slugline first, then the brief turned into scene action — more than one line, not an echo.
    assert draft["lines"][0]["text"] == "INT. DAWN - DAY"
    assert len(draft["lines"]) >= 2
    assert "runner drinks Lumen water" in " ".join(l["text"] for l in draft["lines"])


def test_the_mode_is_echoed_on_every_draft(h):
    token = h.as_person()
    _, revise = post_write(h, token, intent="tighten")
    assert revise["writes"][0]["mode"] == "revise"  # the default for a non-draft intent
    _, drafted_job = post_write(h, token, intent="draft", instruction="An idea.")
    assert drafted_job["writes"][0]["mode"] == "draft"


def test_fit_seconds_sets_the_length_and_add_beat_keeps_beats_inside_it(h):
    token = h.as_person()
    _, fit = post_write(h, token, intent="fit_seconds", seconds=1.6)
    assert fit["writes"][0]["duration_s"] == 1.6
    assert fit["writes"][0]["note"] == "I tightened it to fit 1.6 s."
    _, beat = post_write(h, token, intent="add_beat", seconds=0.5)
    assert beat["writes"][0]["new_beats"][0] == {"kind": "moment", "at_s": 0.5, "text": "A beat to breathe."}


def test_an_unknown_name_reaches_skye_as_written(h):
    token = h.as_person()
    _, job = post_write(h, token, intent="cut_name", text="A @jogger runs past far behind @maya_front.", name="jogger")
    assert job["state"] == "completed"
    assert job["writes"][0]["lines"][0]["text"] == "A runs past far behind @maya_front."


def test_an_agency_that_turned_claude_off_is_refused_before_quota(h):
    # tenant-limits' allow.claude is the agency's say on script text reaching the text model.
    token = h.as_person(team="red")
    tid = h.people[token]["tenant"]["id"]
    h.store.put_tenant({"tenantId": tid, "agency": "red", "enabled": True,
                        "allow": {"claude": False, "makers": ["runway", "google"]}})
    h.relay._tenants.pop(tid, None)
    _, out = post_write(h, token, expect=403)
    assert out["error"]["code"] == "not_allowed"
    assert out["error"]["message"] == "Skye writes with Claude, which your agency has turned off."


def test_a_write_without_its_input_is_invalid(h):
    token = h.as_person()
    req = {**envelope("write", new_id("job")), "input": {"text": "x"}}
    _, out = h.call("POST", "/jobs", req, token, expect=400)
    assert out["error"]["code"] == "invalid_input"


def test_a_question_waits_in_needs_input_and_the_answer_resumes_it(h):
    token = h.as_person()
    _, job = post_write(h, token, intent="draft", text="[ask] a jogger")
    assert job["state"] == "needs_input"
    q = job["question"]
    assert q["id"].startswith("q_") and job["cost"]["reserved"] == 0
    body = {"contractVersion": "3", "questionId": q["id"], "optionId": "maya"}
    _, done = h.call("POST", f"/jobs/{job['jobId']}/answer", body, token, expect=200)
    assert done["state"] == "completed"
    assert done["writes"][0]["base_hash"] == BASE


# ── the prompt's contract, with a fake model ────────────────────────────────

class FakePort:
    """The model port's call(): records what it was asked, answers with a fixture (a list: one per call)."""

    def __init__(self, answer: dict | list[dict]):
        self.answers, self.asked = (answer if isinstance(answer, list) else [answer]), []

    def call(self, purpose, system, payload, schema, *, usage, attribution, model=None, max_tokens=None, **_):
        self.asked.append({"purpose": purpose, "system": system, "payload": payload, "schema": schema, "model": model})
        return json.loads(json.dumps(self.answers[min(len(self.asked), len(self.answers)) - 1]))


def test_the_model_writer_asks_sonnet_with_skye_v3_and_the_relay_owns_target_and_hash():
    target = {"kind": "shot", "id": new_id("shot")}
    other = {"kind": "shot", "id": new_id("shot")}
    port = FakePort({"writes": [
        {"target": target, "base_hash": "sha256:" + "0" * 64, "lines": [{"type": "action", "text": "She stops."}], "note": "I tightened it." * 30},
        {"target": other, "base_hash": BASE, "lines": [{"type": "action", "text": "Not mine."}], "note": "x"},
    ], "rationale": "Shorter verbs."})
    w = ModelWriter(port, contracts_dir())
    inp = write_input()
    inp["write"]["target"] = target
    out = w.write({"op": "write", "jobId": new_id("job"), "input": inp})
    [asked] = port.asked
    assert asked["purpose"] == "writer" and asked["model"] == "claude-sonnet-5-5"
    assert asked["system"].startswith("# Skye · scripts (skye.v6)")
    assert asked["payload"]["input"]["write"]["context"]["refs"] == [{"name": "maya_front", "role": "character"}]
    assert [d["target"] for d in out["writes"]] == [target]
    assert out["writes"][0]["base_hash"] == BASE
    assert len(out["writes"][0]["note"]) == 200
    assert "price" not in asked["system"].lower().replace("no prices", "")


def test_the_output_schema_takes_writes_or_a_question_and_nothing_else():
    from jsonschema import Draft202012Validator

    v = Draft202012Validator(output_schema(contracts_dir()))
    ok = {"writes": [{"target": {"kind": "beat", "id": new_id("beat")}, "base_hash": BASE, "lines": [{"type": "dialogue", "text": "Hi."}], "note": "I said it another way."}]}
    assert not list(v.iter_errors(ok))
    assert list(v.iter_errors({"writes": [], "chat": "hello"}))
    assert list(v.iter_errors({"writes": [{**ok["writes"][0], "new_beats": [{"kind": "moment", "at_s": 0.3, "text": "x"}]}]}))


def test_every_passthrough_intent_validates_against_the_contract():
    from contracts import Contracts
    from writer import check

    c = Contracts()
    for intent in ("draft", "tighten", "fit_seconds", "add_beat", "write_vo", "rephrase", "cut_name", "instruct"):
        out = PassthroughWriter().write({"input": write_input(intent, seconds=2, name="maya_front")})
        assert out["writes"], intent
        assert check(c, out) == [], (intent, check(c, out))


def test_a_free_instruct_lands_as_a_revise_with_its_note(h):
    # The 'Tell Skye' field: a free instruction on a selection, a revise (word-diff). The passthrough
    # cannot follow it, so it returns the words unchanged; the mode is echoed for the landing code.
    token = h.as_person()
    _, job = post_write(h, token, intent="instruct", mode="revise", instruction="make her sound colder")
    assert job["state"] == "completed"
    draft = job["writes"][0]
    assert draft["mode"] == "revise"
    assert draft["note"] == "I did what you asked."


def test_v6_is_v5_plus_one_length_rule_with_the_band_and_v5_still_loads():
    """Live test 2026-11-18: a 15 s film drafted at about 60 s on the band. skye.v6 sizes a page by the band's
    rule (web script/compose.ts roughSeconds = writer.rough_seconds); skye.v5 stays loadable for a rollback."""
    root = Path(__file__).parent.parent / "prompts"
    v6 = (root / "skye.v6.md").read_text()
    assert "10. Length." in v6 and "2.5 words a second" in v6 and "1 s for every 6 words" in v6
    assert "input.write.too_long" in v6 and "input.brief" in v6
    old = ModelWriter(FakePort({"writes": []}), contracts_dir(), prompt_version="skye.v5")
    assert old.system.startswith("# Skye · scripts (skye.v5)")


def test_rough_seconds_is_the_bands_rule():
    # The same lines as web compose.test.ts ('a slugline is no speaker…'): 14/6 + 14/6 + 6/2.5 + 2 = 9.1.
    lines = [{"type": "action", "text": "INT. FARMHOUSE KITCHEN - DAWN"},
             {"type": "action", "text": "Pale blue light. Frost on the window. A tired DAD stands at the stove."},
             {"type": "action", "text": "He tears open a red Hearth Oats pack and tips oats into a pot."},
             {"type": "character", "text": "NARRATOR (V.O.)"}, {"type": "parenthetical", "text": "warmly"},
             {"type": "dialogue", "text": "Hearth Oats. Slow down, warm up."}, {"type": "action", "text": "She yawns back."}]
    assert rough_seconds(lines) == 9.1


def test_a_page_draft_far_over_its_length_is_asked_once_to_fit():
    """A draft for a 15 s scene that runs about 30 s goes back once with too_long; the second answer stands."""
    long = [{"type": "action", "text": f"Beat {i}: the dad does one more slow thing at the stove while the frost melts."} for i in range(8)]
    short = [{"type": "action", "text": "Frost on the window."}, {"type": "action", "text": "Dad stirs the oats."},
             {"type": "action", "text": "She yawns. He yawns."}, {"type": "action", "text": "The red pack in the sun."}]
    port = FakePort([{"writes": [{"lines": long, "note": "n"}], "rationale": "r1"}, {"writes": [{"lines": short, "note": "n2"}], "rationale": "r2"}])
    inp = write_input()
    inp["write"] = {**inp["write"], "intent": "draft", "mode": "draft", "target": {"kind": "scene", "id": inp["write"]["target"]["id"]},
                    "lines": [], "instruction": "a dad makes oats", "context": {**inp["write"]["context"], "target_s": 15}}
    out = ModelWriter(port, contracts_dir()).write({"op": "write", "jobId": new_id("job"), "input": inp})
    assert len(port.asked) == 2
    assert port.asked[1]["payload"]["input"]["write"]["too_long"] == {"about_s": rough_seconds(long), "target_s": 15}
    assert [x["text"] for x in out["writes"][0]["lines"]] == [x["text"] for x in short]
    assert out["rationale"].startswith("relay: the first draft ran about")
    # One that fits is never asked again.
    port2 = FakePort({"writes": [{"lines": short, "note": "n"}], "rationale": "r"})
    ModelWriter(port2, contracts_dir()).write({"op": "write", "jobId": new_id("job"), "input": inp})
    assert len(port2.asked) == 1


def test_settle_keeps_new_beats_inside_the_length():
    inp = write_input(seconds=1.6)
    out = settle(inp, {"writes": [{"lines": [], "note": "n", "duration_s": 1.6, "new_beats": [{"kind": "moment", "at_s": 3.0, "text": "late"}]}]})
    assert out["writes"][0]["new_beats"][0]["at_s"] == 1.5


def test_the_prompt_file_is_versioned_and_says_no_chat():
    for v in ("skye.v1", "skye.v2", "skye.v3", "skye.v4", "skye.v5", "skye.v6"):
        text = (Path(__file__).parent.parent / "prompts" / f"{v}.md").read_text()
        assert "You never chat" in text and "No prices, no costs" in text


def test_v2_keeps_a_bare_key_and_v1_still_loads():
    """Owner 2026-10-15: @samurai stays @samurai. skye.v1 stays loadable for a rollback."""
    v2 = (Path(__file__).parent.parent / "prompts" / "skye.v2.md").read_text()
    assert "stays `@samurai`" in v2 and "never turn it into one of its views" in v2
    old = ModelWriter(FakePort({"writes": []}), contracts_dir(), prompt_version="skye.v1")
    assert old.prompt_version == "skye.v1" and old.system.startswith("# Skye · scripts (skye.v1)")


def test_settle_puts_a_swapped_view_back_to_the_bare_key_the_words_name():
    inp = write_input()
    inp["write"]["lines"] = [{"type": "action", "text": "@samurai cleans the house. @maya_front watches."}]
    out = settle(inp, {"writes": [{"note": "n", "lines": [
        {"type": "action", "text": "@samurai_front sweeps; @samurai_back folds. @maya_side nods."}],
        "new_beats": [{"kind": "moment", "at_s": 0.5, "text": "@samurai_side bows."}]}]})
    w = out["writes"][0]
    # A view of the bare key goes back to @samurai; @maya_side is another picture of a key the words name
    # by one view, which only the prompt asks Skye to keep (no single bare name to go back to).
    assert w["lines"][0]["text"] == "@samurai sweeps; @samurai folds. @maya_side nods."
    assert w["new_beats"][0]["text"] == "@samurai bows."


def test_make_finds_the_model_port_inside_the_claude_director():
    # ClaudeDirector keeps the port on its inner Director; Skye fell back to the passthrough
    # whenever a model was configured until make() looked there.
    import writer
    from director.claude import ClaudeDirector

    class Inner:
        per_click_model, prompt_version = "m", "v"
        port = FakePort({"writes": []})

    assert isinstance(writer.make(ClaudeDirector(Inner())), ModelWriter)
    assert isinstance(writer.make(object()), PassthroughWriter)


# ── a question that offers no choice (owner 2026-10-15) ─────────────────────

# What Skye (skye.v2) answered to a draft from an empty script's one line: one option, restating the press.
DRAFT_IT = {"question": {"id": "q_00000000000000000000000000", "kind": "nudge", "text": "Draft the scene as written?",
                         "options": [{"id": "draft", "label": "Draft it", "value": "draft"}], "allow_text": True},
            "rationale": "Confirming before drafting."}


def drafted(target: dict) -> dict:
    return {"writes": [{"target": target, "base_hash": BASE, "lines": [{"type": "action", "text": "A samurai sweeps the hall."}],
                        "note": "I drafted the scene from your line."}], "rationale": "From the line."}


def test_a_one_option_nudge_goes_ahead_and_skye_drafts():
    inp = write_input("draft", text="A samurai cleans the house for you.")
    port = FakePort([DRAFT_IT, drafted(inp["write"]["target"])])
    out = ModelWriter(port, contracts_dir()).write({"op": "write", "jobId": new_id("job"), "input": inp})
    assert "question" not in out and [d["lines"][0]["text"] for d in out["writes"]] == ["A samurai sweeps the hall."]
    # Asked again once, with the one option as the person's answer.
    assert len(port.asked) == 2
    assert port.asked[1]["payload"]["input"]["answer"] == {"questionId": "q_00000000000000000000000000", "optionId": "draft", "label": "Draft it"}
    assert out["rationale"].startswith("relay: went ahead on a one-option nudge (Draft the scene as written?)")


def test_a_one_option_nudge_asked_again_is_dropped_and_never_reaches_the_person():
    inp = write_input("draft", text="A samurai cleans the house for you.")
    out = ModelWriter(FakePort([DRAFT_IT, DRAFT_IT]), contracts_dir()).write({"op": "write", "jobId": new_id("job"), "input": inp})
    assert out["writes"] == [] and "question" not in out


def test_a_real_choice_or_a_missing_fact_still_reaches_the_person():
    choice = {"question": {"kind": "nudge", "text": "Whose house is it?", "allow_text": True,
                           "options": [{"id": "his", "label": "His own", "value": "own"}, {"id": "client", "label": "A client's", "value": "client"}]}}
    fact = {"question": {"kind": "block", "text": "What is the brand called?", "options": [], "allow_text": True}}
    for answer in (choice, fact):
        port = FakePort(answer)
        out = ModelWriter(port, contracts_dir()).write({"op": "write", "jobId": new_id("job"), "input": write_input("draft")})
        assert out["question"]["text"] == answer["question"]["text"] and len(port.asked) == 1


def test_an_answered_question_is_never_answered_again_by_the_relay():
    inp = {**write_input("draft"), "answer": {"contractVersion": "3", "questionId": "q_00000000000000000000000000", "optionId": "draft"}}
    port = FakePort(DRAFT_IT)
    out = ModelWriter(port, contracts_dir()).write({"op": "write", "jobId": new_id("job"), "input": inp})
    assert out["question"]["text"] == "Draft the scene as written?" and len(port.asked) == 1


def test_v3_says_never_ask_to_do_what_was_pressed_and_v2_still_loads():
    v3 = (Path(__file__).parent.parent / "prompts" / "skye.v3.md").read_text()
    assert "no question with one option" in v3 and "one line is enough to draft from" in v3
    old = ModelWriter(FakePort({"writes": []}), contracts_dir(), prompt_version="skye.v2")
    assert old.system.startswith("# Skye · scripts (skye.v2)")


def test_v4_teaches_the_instruction_field_and_a_real_short_draft_and_v3_still_loads():
    v4 = (Path(__file__).parent.parent / "prompts" / "skye.v4.md").read_text()
    # The real draft reads the brief (instruction), never echoes it, and writes a slugline + action.
    assert "input.write.instruction" in v4 and "never copy it back verbatim" in v4
    assert "slugline" in v4 and "real short screenplay" in v4
    old = ModelWriter(FakePort({"writes": []}), contracts_dir(), prompt_version="skye.v3")
    assert old.system.startswith("# Skye · scripts (skye.v3)")


def test_the_passthrough_draft_is_a_short_screenplay_from_the_brief_not_an_echo(h):
    # The deterministic draft: a slugline from the brief, then action — never a single echoed line.
    token = h.as_person()
    _, job = post_write(h, token, intent="draft", text="", instruction="a man putting in work at the gym")
    assert job["state"] == "completed"
    lines = job["writes"][0]["lines"]
    assert lines[0]["text"] == "INT. GYM - DAY"
    assert len(lines) >= 2 and lines[1]["text"] != "a man putting in work at the gym"  # not a verbatim echo


def test_the_relay_drafts_through_a_one_option_nudge_with_no_needs_input(h):
    """Through the relay: the job completes with Skye's draft; it never waits on a question that offers no choice."""
    class Writer(ModelWriter):
        def write(self, req):
            self.port = FakePort([DRAFT_IT, drafted(req["input"]["write"]["target"])])
            return super().write(req)

    h.relay.writer = Writer(FakePort({}), contracts_dir())
    token = h.as_person()
    _, job = post_write(h, token, intent="draft", text="A samurai cleans the house for you.")
    assert job["state"] == "completed" and job.get("question") is None
    assert job["writes"][0]["lines"][0]["text"] == "A samurai sweeps the hall."


def test_v5_is_v4_plus_the_brief_and_reads_it_cut_to_the_write_budget():
    """features/brief-node.clan: Skye drafts for the linked brief's audience and tone, keeps its mandatories
    and never writes what a don't rules out; she reads its spine cut to the write op's budget."""
    root = Path(__file__).parent.parent / "prompts"
    v4, v5 = (root / "skye.v4.md").read_text(), (root / "skye.v5.md").read_text()
    assert v5.replace("(skye.v5)", "(skye.v4)", 1).startswith(v4.split("Answer with the JSON only:")[0].split("- `input.answer`")[0])
    assert "input.brief" in v5 and "never write what a don't rules out" in v5
    port = FakePort({"writes": [{"lines": [{"kind": "action", "text": "x"}], "note": "n"}], "rationale": "r"})
    inp = write_input()
    inp["brief"] = {"title": "First Light brief", "spine": {"proposition": "P" * 150, "audience": "A" * 380, "tone": "T" * 290,
                                                             "feel": "F" * 190, "insight": "I" * 390, "mandatories": ["M" * 110] * 6}}
    ModelWriter(port, contracts_dir()).write({"op": "write", "jobId": new_id("job"), "input": inp})
    [asked] = port.asked
    spine = asked["payload"]["input"]["brief"]["spine"]
    assert list(spine)[:4] == ["proposition", "audience", "tone", "feel"]
    assert sum(len(v) if isinstance(v, str) else sum(map(len, v)) for v in spine.values()) <= 900
    # No brief: the input goes to Skye as it came.
    port2 = FakePort({"writes": [{"lines": [{"kind": "action", "text": "x"}], "note": "n"}], "rationale": "r"})
    plain = write_input()
    ModelWriter(port2, contracts_dir()).write({"op": "write", "jobId": new_id("job"), "input": plain})
    assert port2.asked[0]["payload"]["input"] == plain
