"""redraft-provenance: the history records a rewrite loop as it happened, and each draft says
what steered it. The draft Jude sent back stays in the chain, superseded; his note is the
verdict it was; the rewrite cites it. A redraft on a planned brief names the person's ask."""

from napkin.brief.fields import LABELS, last_writer

from conftest import Server
from test_brief import DOC, Host, check_change_rules, retrieval, run
from test_fix_parts import fix_model
from test_planned_brief import THIN, planned_model

K = "objectives.commercial"
ADDR = f"{DOC}#{K}"


def whole(tmp_path, model):
    s = Server(tmp_path, model=model, retrieval=retrieval(),
               settings_kw={"brief_flow": "planned", "brief_research_max": 2})
    host = Host()
    try:
        run(s, host, inp={"prompt": THIN, "attachments": []})
    finally:
        s.stop()
    return host


def test_the_loop_is_recorded_as_it_happened(tmp_path):
    host = whole(tmp_path, planned_model({}))
    drafts = [d for d in host.chain if d.get("action") == "draft" and ADDR in d["targets"]]
    first = next(d for d in drafts if d.get("superseded_by"))
    final = next(d for d in drafts if not d.get("superseded_by"))
    sent = next(d for d in host.chain if d["kind"] == "verdict" and first["id"] in d["cites"])
    # the chain is newest first: the first draft, then Jude's note on it, then the rewrite
    at = [d["id"] for d in host.chain].index
    assert at(final["id"]) < at(sent["id"]) < at(first["id"])
    assert first["superseded_by"] == final["id"]
    assert first["reasoning"]["decided"] == f"Wrote the {LABELS[K]}."
    assert sent["polarity"] == "bad" and sent["reason_code"] == "brief_review"
    assert sent["rationale"].startswith("The objectives need a measure and a date.")
    assert sent["reasoning"]["because"][0] == {"point": "add a measure", "cites": [first["id"]]}
    assert final["reasoning"]["decided"] == f"Rewrote the {LABELS[K]} on Jude's note."
    assert sent["id"] in final["cites"]
    assert {"point": "Jude's note: add a measure", "cites": [sent["id"]]} in final["reasoning"]["because"]
    # the rewrite is what the brief holds and what wrote the part; the first draft is history
    assert host.data["objectives"]["commercial"].startswith("Grow under-30 visits")
    assert last_writer(DOC, host.chain, K) == final["id"]
    # Jude still notes the objectives in his second review, so no pass is recorded on the part
    assert not any(d["kind"] == "verdict" and d["polarity"] == "good" and ADDR in d["targets"] for d in host.chain)
    check_change_rules(host)


def test_a_rewrite_jude_passes_is_marked_answered(tmp_path):
    m = planned_model({})
    again = m.overrides["review_brief_again"]

    def passes(p):
        rv = again(p)
        return {**rv, "notes": [n for n in rv["notes"] if n["severity"] != "fix"]}

    m.overrides["review_brief_again"] = passes
    host = whole(tmp_path, m)
    final = next(d for d in host.chain
                 if d.get("action") == "draft" and ADDR in d["targets"] and not d.get("superseded_by"))
    ok = next(d for d in host.chain if d["kind"] == "verdict" and d["polarity"] == "good" and ADDR in d["targets"])
    assert ok["cites"] == [final["id"]]
    assert ok["reasoning"]["decided"] == f"Checked the new {LABELS[K]}: it answers the note."
    check_change_rules(host)


def redraft(tmp_path, field, guidance, held=False):
    seen = {}
    s = Server(tmp_path, model=fix_model(seen), retrieval=retrieval(),
               settings_kw={"brief_flow": "planned", "brief_research_max": 2})
    host = Host()
    try:
        run(s, host, inp={"prompt": THIN, "attachments": []})
        was = last_writer(DOC, host.chain, field)
        if held:
            host.chain.insert(0, {"id": "d_person_edit", "kind": "edit", "action": "edit", "actor": "human:local",
                                  "targets": [f"{DOC}#{field}"], "rationale": "Worded differently for the demo"})
            was = "d_person_edit"
        s.model.overrides["review_brief"] = s.model.overrides["review_brief_again"]  # Jude passes the redraft
        replies = run(s, host, task="regenerate_field", inp={"field": field, "guidance": guidance})
    finally:
        s.stop()
    return seen, host, replies[-1], was


def test_a_redraft_on_a_planned_brief_says_on_your_ask(tmp_path):
    seen, host, last, was = redraft(tmp_path, "insight", "punchier, less health")
    assert last["job"]["state"] == "done" and last["result"]["fields"]["insight"]["state"] == "done"
    d = next(d for d in host.chain if d.get("handler", "").startswith("regenerate_field@1")
             and d["kind"] == "edit" and f"{DOC}#insight" in d["targets"])
    assert d["action"] == "draft" and not d.get("superseded_by")
    assert d["reasoning"]["decided"] == f"Rewrote the {LABELS['insight']} on your ask."
    assert {"point": "Your ask: “punchier, less health”", "cites": [was]} in d["reasoning"]["because"]
    assert seen["fix"]["planner_guidance"] == "punchier, less health"
    check_change_rules(host)


def test_a_redraft_on_a_held_part_proposes_on_your_ask(tmp_path):
    seen, host, last, was = redraft(tmp_path, "insight", "punchier", held=True)
    assert last["result"]["fields"]["insight"]["state"] == "proposed"
    d = next(d for d in host.chain if d.get("action") == "propose" and f"{DOC}#insight" in d["targets"])
    assert last["result"]["proposals"][0]["decision"] == d["id"]
    assert d["reasoning"]["decided"] == f"Rewrote the {LABELS['insight']} on your ask."
    assert {"point": "Your ask: “punchier”", "cites": ["d_person_edit"]} in d["reasoning"]["because"]
    # the person still holds the part: the proposal wrote nothing
    assert last_writer(DOC, host.chain, "insight") == "d_person_edit"
    check_change_rules(host)
