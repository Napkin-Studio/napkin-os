"""build_deck@1 (middleware-api.md §12): one segment of a Deck Maker run through the engine's port. The engine is a scripted stub behind
httpx.MockTransport; the host is the Brief tests' host (it applies a change as the real one does: once per decision id) and every state
of the document is checked against the Deck Maker app's own schema. No model, no engine process."""

import copy
import json
import threading
import time
from pathlib import Path

import httpx
import jsonschema
import pytest

from napkin import registry
from napkin.deck import engine, job as deck_job
from napkin.reasoning import problems

from conftest import Server
from test_brief import Host, post, run

SCHEMA = json.loads((Path(__file__).resolve().parents[2] / "app" / "templates" / "deck-maker" / "schema.json").read_text())
PROMPT = "Fernley Drinks, a Cork sparkling iced tea brand, wants an agency pitch for a spring-to-summer 2027 campaign."
ROWS = [("inputs", "Read the inputs"), ("scans", "Read image-only pages"), ("storyline", "Storyline"), ("territories", "Territories"),
        ("idea", "One idea and its work"), ("copy", "Slide copy"), ("check", "Check"), ("review", "You review the deck")]


def rows(active, held=False, done=False):
    out, hit = [], False
    for rid, name in ROWS:
        if rid == active:
            hit, st = True, ("now")
        else:
            st = "next" if hit else "done"
        out.append({"id": rid, "name": name, "sub": "Needs you · you approve it" if held and rid == active else "Writing", "status": st})
    return out


def view(state, stage="storyline", gate=None, error=None, payload=None, notices=(), cost=None):
    run = {"state": state, "stage": stage, "stages": rows(stage, held=state == "gate"), "gate": gate}
    if state == "building":
        run["agent"] = {"key": "strategy", "activity": "write", "step_index": 2, "step_total": 7}
    if error:
        run["error"] = error
    if cost is not None:
        run["cost_usd"] = cost
    out = {"doc": "x", "state": state, "run": run, "notices": list(notices), "mode": "replay"}
    if payload:
        out["payload"] = payload
    if error:
        out["error"] = error
    return out


GATE1 = {"id": "storyline", "n": 1, "of": 3, "agent": "strategy", "beats": [{"n": "01", "title": "Win spring", "src": "Cites your prompt · 1 ref", "basis": "brief"}]}
GATE2 = {"id": "territories", "n": 2, "of": 3, "agent": "strategy", "first_pick": "t1",
         "territories": [{"id": "t1", "n": 1, "name": "One", "thought": "a", "why": "b"}]}
PAYLOAD = {"deck": {"order": ["s1"], "appendix_ids": [], "appendix_count": 0, "slides": {"s1": {"type": "cover", "title": "Fernley"}}, "meta": {}},
           "validation": {"errors": 0, "warnings": 1, "findings": {}}, "evidence": {"prompt:1": {"kind": "your prompt", "text": PROMPT}},
           "report": {"seconds": 1.0, "tokens": 0, "cost_usd": 0, "mode": "replay"}, "exports": {"web": {"file": "deck.html", "bytes": 10}},
           "done": {"summary": "1 pitch slide.", "slides": 1, "appendix": 0, "to_supply": 0}}


class FakeEngine:
    """The deck engine's HTTP port, scripted: POST /run answers the first view, each poll the next (the last repeats)."""

    def __init__(self, *views, post_status=202, post_body=None, hold=None):
        self.views, self.posts, self.polls = list(views), [], 0
        self.post_status, self.post_body, self.hold = post_status, post_body, hold

    def __call__(self, request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            self.posts.append(json.loads(request.content))
            if self.hold:
                self.hold.wait(10)
            return httpx.Response(self.post_status, json=self.post_body if self.post_body is not None else self.views[0])
        self.polls += 1
        return httpx.Response(200, json=self.views[min(self.polls, len(self.views) - 1)])


def deck_data(approvals=None):
    d = {"inputs": {"prompt": {"client": "Fernley", "project": "Tea 2027", "agency": "", "text": PROMPT}, "documents": [], "kind": "agency",
                    "format": "pitch", "library": {"enabled": False}}, "run": {"state": "draft", "stages": [], "gate": None}}
    if approvals:
        d["run"]["approvals"] = approvals
    return d


@pytest.fixture
def deck(tmp_path, monkeypatch):
    monkeypatch.setattr(deck_job, "POLL", 0)
    s = Server(tmp_path, settings_kw={"deck_engine_url": "http://deck.test"})
    yield s
    s.stop()


def use(monkeypatch, fake):
    monkeypatch.setattr(engine, "TRANSPORT", httpx.MockTransport(fake))
    return fake


def valid(host):
    jsonschema.Draft7Validator(SCHEMA).validate(host.data)


def build(deck, host, **kw):
    replies = run(deck, host, task="build_deck", inp={}, **kw)
    valid(host)
    return replies


def test_a_segment_runs_to_the_storyline_gate_and_the_document_holds_it(deck, monkeypatch):
    fake = use(monkeypatch, FakeEngine(view("building"), view("building", cost=0.1), view("gate", gate=GATE1, cost=0.3)))
    host = Host(data=deck_data(), schema=SCHEMA)
    replies = build(deck, host)
    assert replies[-1]["job"]["state"] == "done" and "storyline gate" in replies[-1]["result"]["summary"]
    assert host.data["run"]["state"] == "gate" and host.data["run"]["gate"]["id"] == "storyline" and host.data["run"]["gate"]["beats"]
    assert "cost_usd" not in host.data["run"], "costs are for the team only: the engine's figure never reaches the document"
    assert "agent" not in host.data["run"], "the agent circle is gone while a gate waits"
    assert fake.posts == [{"doc": "doc-1" if False else fake.posts[0]["doc"], "inputs": {"prompt": {"text": PROMPT, "client": "Fernley", "project": "Tea 2027", "agency": ""},
                                                                                   "kind": "agency", "format": "pitch"}, "approvals": {}, "render": True, "marks": []}]


def test_the_job_writes_the_engines_keys_and_never_the_apps(deck, monkeypatch):
    use(monkeypatch, FakeEngine(view("building"), view("gate", gate=GATE1)))
    person = {"storyline": {"by": "Sai", "at": "2026-11-04T10:00:00Z", "decision": "approve"}}
    host = Host(data=deck_data(approvals=person), schema=SCHEMA)
    host.data["run"]["decisions"] = [{"gate": "storyline", "kind": "approve", "by": "Sai", "at": "t"}]
    host.data["run"]["gate_requests"] = []
    build(deck, host)
    for ch in host.changes:
        patch = ch["data_patch"].get("run", {})
        assert not set(patch) & {"approvals", "decisions", "gate_requests"}
        assert all(p.startswith("run.") or p in deck_job.PAYLOAD for p in ch["read"]), "the read-set never names the whole run: the person writes beside it"
    assert host.data["run"]["approvals"] == person and host.data["run"]["decisions"][0]["by"] == "Sai"


def test_the_approvals_in_the_document_go_to_the_engine(deck, monkeypatch):
    fake = use(monkeypatch, FakeEngine(view("gate", stage="territories", gate=GATE2)))
    approvals = {"storyline": {"by": "Sai", "at": "t", "decision": "approve"}}
    build(deck, Host(data=deck_data(approvals=approvals), schema=SCHEMA))
    assert fake.posts[0]["approvals"] == approvals


def test_the_persons_storyline_goes_to_the_engine_beside_the_approvals(deck, monkeypatch):
    """deck-beat-editor: run.storyline_edit (the app's, like the approvals) reaches the engine as written; the middleware never writes it."""
    fake = use(monkeypatch, FakeEngine(view("gate", stage="territories", gate=GATE2)))
    edit = {"base": "a" * 64, "by": "You", "at": "t", "beats": [{"key": "audience", "title": "Ours first", "words": "yours"}, {"key": None, "title": "Mine", "words": "yours"}]}
    host = Host(data=deck_data(approvals={"storyline": {"by": "Sai", "at": "t", "decision": "approve"}}), schema=SCHEMA)
    host.data["run"]["storyline_edit"] = edit
    build(deck, host)
    assert fake.posts[0]["storyline_edit"] == {k: edit[k] for k in ("base", "beats", "by", "at")}
    assert host.data["run"]["storyline_edit"] == edit
    assert "storyline_edit" not in deck_job.RUN_OWNED
    plain = use(monkeypatch, FakeEngine(view("gate", stage="territories", gate=GATE2)))
    build(deck, Host(data=deck_data(), schema=SCHEMA))
    assert "storyline_edit" not in plain.posts[0]


def test_after_the_last_gate_the_document_gets_the_deck_validation_evidence_report_and_export_names(deck, monkeypatch):
    use(monkeypatch, FakeEngine(view("building", stage="check"), view("done", stage="review", payload=PAYLOAD, cost=0)))
    host = Host(data=deck_data(), schema=SCHEMA)
    host.data["run"].update(state="gate", gate=GATE2)
    build(deck, host)
    d = host.data
    assert d["run"]["state"] == "done" and "gate" not in d["run"] and d["deck"]["order"] == ["s1"]
    assert d["validation"]["warnings"] == 1 and d["evidence"]["prompt:1"] and d["report"]["mode"] == "replay"
    assert d["exports"] == {"web": {"file": "deck.html", "bytes": 10}}, "names and sizes only"
    assert not {"cost_usd", "engine_usd_total", "usd_basis"} & set(d["report"]), "the report reaches the document without its cost"


def test_no_cost_reaches_the_document_and_an_older_documents_cost_is_removed(deck, monkeypatch):
    """Costs are for the Napkin team only, never in the product (Sai, 19 Nov 2026). The engine's run.cost_usd and its report's
    cost figures are dropped at this edge, and a document that still carries run.cost_usd from before loses it."""
    import json
    use(monkeypatch, FakeEngine(view("building", cost=0.4), view("done", stage="review", payload=PAYLOAD, cost=0.9)))
    host = Host(data=deck_data(), schema=SCHEMA)
    host.data["run"]["cost_usd"] = 1.14
    host.data["report"] = {"seconds": 0, "tokens": 0, "cost_usd": 1.14}
    replies = build(deck, host)
    assert "cost_usd" not in host.data["run"]
    assert not {"cost_usd", "engine_usd_total", "usd_basis"} & set(host.data["report"])
    assert "cost_usd" not in json.dumps(host.data) and "usd_basis" not in json.dumps(host.data)
    assert "cost_usd" not in json.dumps(replies[-1].get("result") or {})


def test_every_change_names_what_it_writes_and_carries_its_reasoning(deck, monkeypatch):
    use(monkeypatch, FakeEngine(view("building"), view("building", cost=0.2), view("gate", gate=GATE1)))
    host = Host(data=deck_data(), schema=SCHEMA)
    build(deck, host)
    assert host.changes
    ids = set()
    for ch in host.changes:
        for d in ch["decisions"]:
            assert d["id"] not in ids and not problems(d["reasoning"]) and d["handler"] == "build_deck@1.0" and d["kind"] == "edit"
            ids.add(d["id"])
        # a reply may carry several staged changes at once: the paths it writes are named across its decisions
        named = {t.split("#", 1)[1] for d in ch["decisions"] for t in d["targets"]}
        assert set(ch["read"]) <= named, "every path the patch writes is a target of a decision"
        assert ch["base_version"] and ch["doc"]


def test_a_repeated_poll_of_a_finished_job_changes_nothing(deck, monkeypatch):
    use(monkeypatch, FakeEngine(view("gate", gate=GATE1)))
    host = Host(data=deck_data(), schema=SCHEMA)
    replies = build(deck, host)
    jid = replies[0]["job"]["id"]
    before = copy.deepcopy(host.data)
    n = len(host.changes)
    st, again = post(deck, "job_status", {"job_id": jid}, host.clan())
    assert st == 200 and again["job"]["state"] == "done"
    host.apply(again["change"])
    assert host.data == before and len(host.changes) == n


@pytest.mark.parametrize("fake_kw,message", [
    ({"post_status": 500, "post_body": {"error": {"type": "model_down", "message": "the model said no"}}}, "the model said no"),
    ({"post_status": 409, "post_body": {"error": {"type": "job_state", "message": "a run is already going (other)"}}}, "a run is already going"),
    ({"post_status": 200, "post_body": {"hello": "world"}}, "not a run"),
])
def test_an_engine_that_fails_ends_the_job_failed_with_its_message_and_the_run_failed_too(deck, monkeypatch, fake_kw, message):
    use(monkeypatch, FakeEngine(view("building"), **fake_kw))
    host = Host(data=deck_data(), schema=SCHEMA)
    replies = build(deck, host)
    last = replies[-1]
    assert last["job"]["state"] == "failed" and message in last["job"]["error"]["message"]
    assert host.data["run"]["state"] == "failed" and message in host.data["run"]["error"]["message"] and host.data["run"]["error"]["retryable"] is True
    assert host.data["run"]["agent"]["activity"] == "error" and "deck" not in host.data


def test_an_engine_that_does_not_answer_or_answers_garbage_is_a_failed_job(deck, monkeypatch):
    def timeout(request):
        raise httpx.ConnectTimeout("slow", request=request)
    monkeypatch.setattr(engine, "TRANSPORT", httpx.MockTransport(timeout))
    host = Host(data=deck_data(), schema=SCHEMA)
    assert build(deck, host)[-1]["job"]["error"]["message"] == "the deck engine did not answer in time"
    monkeypatch.setattr(engine, "TRANSPORT", httpx.MockTransport(lambda r: httpx.Response(200, text="<html>nope</html>")))
    host = Host(data=deck_data(), schema=SCHEMA)
    assert "not JSON" in build(deck, host)[-1]["job"]["error"]["message"]


def test_a_failure_after_a_stage_keeps_the_rows_and_marks_the_running_one_failed(deck, monkeypatch):
    err = {"stage": "territories", "message": "The engine stopped: no territories came back", "retryable": True}
    use(monkeypatch, FakeEngine(view("building", stage="territories"), view("failed", stage="territories", error=err)))
    host = Host(data=deck_data(), schema=SCHEMA)
    last = build(deck, host)[-1]
    assert last["job"]["state"] == "failed" and last["job"]["error"]["message"] == err["message"]
    assert host.data["run"]["error"] == err and host.data["run"]["state"] == "failed"


def test_a_failure_the_middleware_writes_names_the_agent_of_the_row_that_failed(deck, monkeypatch):
    """Acceptance A45: after gate 2 the idea stage failed, and the row read "Brief agent · Writes the brief" (the fallback was 'brief')."""
    use(monkeypatch, FakeEngine(view("building", stage="idea"), post_status=500, post_body={"error": {"type": "model_down", "message": "NoClaudeAvailable"}}))
    host = Host(data=deck_data(), schema=SCHEMA)
    host.data["run"].update(state="building", stage="idea", stages=[{"id": "idea", "name": "One idea and its work", "sub": "Writing", "status": "now"}])
    build(deck, host)
    assert host.data["run"]["state"] == "failed" and host.data["run"]["agent"] == {"key": "idea", "activity": "error"}


def test_the_middlewares_row_agents_are_the_engines():
    """The middleware cannot import the engine (its own image and dependencies): the engine's ROW_AGENT literal is read from its source."""
    import ast
    src = (Path(__file__).resolve().parents[2] / "engine" / "deck" / "run_state.py").read_text()
    node = next(n for n in ast.parse(src).body if isinstance(n, ast.Assign) and any(getattr(t, "id", "") == "ROW_AGENT" for t in n.targets))
    assert deck_job.ROW_AGENT == ast.literal_eval(node.value)


def test_a_second_build_on_one_document_is_refused_while_one_runs(deck, monkeypatch):
    hold = threading.Event()
    use(monkeypatch, FakeEngine(view("gate", gate=GATE1), hold=hold))
    host = Host(data=deck_data(), schema=SCHEMA)
    st, first = post(deck, "build_deck", {}, host.clan())
    assert st == 200 and first["job"]["state"] == "queued"
    st, err = post(deck, "build_deck", {}, host.clan())
    assert st == 409 and err["error"]["type"] == "job_state"
    hold.set()


def test_the_task_says_plainly_when_there_is_no_prompt_or_no_engine(deck, tmp_path, monkeypatch):
    host = Host(data=deck_data(), schema=SCHEMA)
    host.data["inputs"]["prompt"]["text"] = "   "
    st, err = post(deck, "build_deck", {}, host.clan())
    assert st == 400 and err["error"]["type"] == "invalid_input" and "something to build from" in err["error"]["message"]
    bare = Server(tmp_path / "bare")
    try:
        st, err = post(bare, "build_deck", {}, Host(data=deck_data(), schema=SCHEMA).clan())
        assert st == 503 and err["error"]["type"] == "engine_unavailable" and "NAPKIN_DECK_ENGINE_URL" in err["error"]["message"]
    finally:
        bare.stop()


def test_a_cancelled_job_stops_and_says_what_stays(deck, monkeypatch):
    hold = threading.Event()
    use(monkeypatch, FakeEngine(view("building"), view("building"), hold=hold))
    host = Host(data=deck_data(), schema=SCHEMA)
    st, first = post(deck, "build_deck", {}, host.clan())
    jid = first["job"]["id"]
    st, c = post(deck, "cancel_job", {"job_id": jid}, host.clan())
    hold.set()
    assert st == 200 and c["job"]["state"] == "cancelled" and "cache" in c["result"]["summary"]


def test_a_document_whose_pipeline_names_the_task_with_no_handler_still_finds_it():
    clan = {"pipeline": {"tasks": {"build_deck": {"sends": {"inputs": "object"}}, "approve_gate": {}}}}
    mod, handler = registry.resolve("build_deck", clan)
    assert handler == "build_deck@1.0" and mod.KIND == "deck"
    mod, handler = registry.resolve("build_deck", {"pipeline": {"tasks": {"build_deck": {"handler": "build_deck@1"}}}})
    assert handler == "build_deck@1.0"


def test_the_existing_tasks_resolve_as_before():
    for task, handler in (("draft_brief", "draft_brief@1.0"), ("start_campaign", "start_campaign@1.0"), ("reconsider", "reconsider@2.0")):
        assert registry.resolve(task, {})[1] == handler


def test_every_build_sends_the_marks_the_document_holds_and_an_empty_list_when_none(deck, monkeypatch):
    fake = use(monkeypatch, FakeEngine(view("gate", gate=GATE1)))
    host = Host(data=deck_data(), schema=SCHEMA)
    host.data["confidential_fields"] = ["inputs.prompt.project"]
    host.data["upstream"] = {"brief-1": {"budget_and_scope": "Project Nightjar, a secret launch.", "confidential_fields": ["budget_and_scope"]}}
    host.chain = [{"id": "d_1", "kind": "classify", "targets": ["doc#upstream.brief-1.single_minded_proposition"], "licence": {"model": False, "corpus": False}}]
    build(deck, host)
    marks = {m["path"]: m for m in fake.posts[0]["marks"]}
    assert "upstream.brief-1.budget_and_scope" in marks and "Nightjar" in marks["upstream.brief-1.budget_and_scope"]["text"]
    assert "inputs.prompt.project" in marks
    fake2 = use(monkeypatch, FakeEngine(view("gate", gate=GATE1)))
    build(deck, Host(data=deck_data(), schema=SCHEMA))
    assert fake2.posts[0]["marks"] == []


def test_the_engines_run_images_reach_the_document_and_the_job_writes_nothing_of_the_apps(deck, monkeypatch):
    v = view("gate", gate=GATE1)
    v["run"]["images"] = {"state": "card", "cards": {"subjects": {"id": "c_12345678", "usd": 0.05}}, "spent_usd": 0, "cap_usd": 2.5}
    use(monkeypatch, FakeEngine(v))
    host = Host(data=deck_data(), schema=SCHEMA)
    build(deck, host)
    assert host.data["run"]["images"]["cards"]["subjects"]["id"] == "c_12345678"
    assert "approvals" not in host.data["run"] or "images" not in host.data["run"]["approvals"]


QA = {"deck_sha": "abc123", "current": True, "summary": {"blocker": 0, "major": 1, "minor": 0, "slides_checked": 1},
      "issues": {"i_0000000a": {"id": "i_0000000a", "round": 0, "slide": "s01", "source": "qa_render", "check": "margin", "level": "warn", "severity": "major", "message": "m", "status": "open"}}}
REPAIR = {"rounds": [{"n": 1, "kept": True, "why": "", "fixed": 1, "open": 1, "usd": 0.0, "seconds": 1.2, "before": {"blocker": 1, "major": 1, "minor": 0}, "after": {"blocker": 0, "major": 1, "minor": 0}}],
          "left_for_person": 1, "stopped": "clean", "skipped": 0}


def test_the_document_gets_qa_and_repair_and_the_request_carries_the_text_mode_and_the_pins(deck, monkeypatch):
    fake = FakeEngine(view("building", stage="check"), view("done", stage="review", payload={**PAYLOAD, "qa": QA, "repair": REPAIR}, cost=0))
    use(monkeypatch, fake)
    host = Host(data=deck_data(), schema=SCHEMA)
    host.data["run"].update(state="gate", gate=GATE2)
    host.data["inputs"]["text_mode"] = "condense"
    host.data["review"] = {"pinned": {"s03": {"by": "human:sai", "at": "t"}}}
    build(deck, host)
    assert host.data["qa"]["summary"]["major"] == 1 and host.data["repair"]["rounds"][0]["kept"] is True and host.data["repair"]["stopped"] == "clean"
    assert fake.posts[0]["inputs"]["text_mode"] == "condense" and fake.posts[0]["inputs"]["review"] == {"pinned": {"s03": {"by": "human:sai", "at": "t"}}}
    assert {"qa", "repair"} <= set(deck_job.PAYLOAD)


def test_the_picked_deck_type_and_its_confirmation_go_to_the_engine(deck, monkeypatch):
    """deck-types: a tender picked on the type picker (inputs.deck_type) reaches the engine, so it builds a tender response, not the agency kind's
    default; the person's yes to new writing on the Change sheet goes with it. Without a pick the body is as before (no deck_type key)."""
    fake = use(monkeypatch, FakeEngine(view("gate", gate=GATE1)))
    data = deck_data()
    data["inputs"]["deck_type"] = {"id": "tender_response", "by": "person", "at": "2026-11-18T10:00:00Z", "confirmed_stages": ["c", "d"]}
    build(deck, Host(data=data, schema=SCHEMA))
    assert fake.posts[0]["inputs"]["deck_type"] == {"id": "tender_response", "confirmed_stages": ["c", "d"]}
    assert fake.posts[0]["inputs"]["kind"] == "agency"   # the engine derives the assembler (and its gates) from the pick
    fake2 = use(monkeypatch, FakeEngine(view("gate", gate=GATE1)))
    plain = deck_data()
    plain["inputs"]["deck_type"] = None   # 'Not sure': no pick
    build(deck, Host(data=plain, schema=SCHEMA))
    assert "deck_type" not in fake2.posts[0]["inputs"]


def test_the_engines_type_offers_land_in_the_run(deck, monkeypatch):
    """deck-types: the engine says which types it offers (run.types); the picker hides one that needs the recipes while they are off."""
    v = view("gate", gate=GATE1)
    v["run"]["types"] = {"recipes": False, "offered": ["agency_pitch", "tender_response", "investor_seed", "credentials"]}
    use(monkeypatch, FakeEngine(v))
    host = Host(data=deck_data(), schema=SCHEMA)
    build(deck, host)
    assert host.data["run"]["types"] == v["run"]["types"]


def test_the_slide_size_goes_to_the_engine(deck, monkeypatch):
    """deck-slide-size: look.size.canvas (Start, Review), else the intake card's answer, reaches the engine as body.look.size.canvas."""
    from napkin.handlers import build_deck as bd
    assert bd.size_of({"look": {"size": {"canvas": "a4", "by": "person"}}}) == "a4"
    assert bd.size_of({"intake": {"answers": {"q_pref_size": {"option_id": "4:3"}}}}) == "4:3"
    assert bd.size_of({"intake": {"answers": {"q_pref_size": {"option_id": "4:3", "skipped": True}}}}) is None
    assert bd.size_of({"look": {"size": {"canvas": "a5"}}}) is None and bd.size_of({}) is None
    assert bd.size_of({"look": {"size": {"canvas": "16:9"}}, "intake": {"answers": {"q_pref_size": {"option_id": "a4"}}}}) == "16:9"   # the later choice wins
    fake = FakeEngine(view("building", stage="check"), view("done", stage="review", payload={**PAYLOAD, "qa": QA, "repair": REPAIR}, cost=0))
    use(monkeypatch, fake)
    host = Host(data=deck_data(), schema=SCHEMA)
    host.data["run"].update(state="gate", gate=GATE2)
    host.data["look"] = {"size": {"canvas": "4:3", "by": "person", "at": "t", "via": "start"}}
    build(deck, host)
    assert fake.posts[0]["look"] == {"size": {"canvas": "4:3"}}
    fake2 = FakeEngine(view("building", stage="check"), view("done", stage="review", payload={**PAYLOAD, "qa": QA, "repair": REPAIR}, cost=0))
    use(monkeypatch, fake2)
    host2 = Host(data=deck_data(), schema=SCHEMA)
    host2.data["run"].update(state="gate", gate=GATE2)
    build(deck, host2)
    assert "look" not in fake2.posts[0]   # no size chosen: the engine's own default (the recipe's, else 16:9)


def test_a_deck_spun_off_from_production_sends_the_carried_project_and_its_confidential_brief_parts(deck, monkeypatch):
    fake = use(monkeypatch, FakeEngine(view("gate", gate=GATE1)))
    host = Host(data=deck_data(), schema=SCHEMA)
    prod = {"app": "production-tool", "contract_version": "3", "project": {"id": "proj_01KB0000000000000000000001", "title": "Lumen Water launch"},
            "finals": {"final_01KB0000000000000000000001": {"of": {"kind": "picture", "id": "pic_kv_0001"}, "asset": "sha256:" + "ab" * 32}},
            "briefs": {"brief_01KB0000000000000000000001": {"title": "Lumen", "spine": {"insight": "People never link water to their own tap", "proposition": "Every drop has a story."},
                                                           "confidential": ["insight"]}}}
    host.data["upstream"] = {"doc-brief-1": {"insight": "x"}, "doc-prod-1": prod}
    build(deck, host)
    sent = fake.posts[0]
    assert sent["production_upstream"] == {"id": "doc-prod-1", "data": prod}   # carried whole: the pictures are not in it
    marks = {m["path"]: m for m in sent["marks"]}
    assert "People never link water" in marks["upstream.doc-prod-1.briefs.brief_01KB0000000000000000000001.spine.insight"]["text"]
    assert not [m for m in sent["marks"] if "proposition" in m["path"]]
    fake2 = use(monkeypatch, FakeEngine(view("gate", gate=GATE1)))
    build(deck, Host(data=deck_data(), schema=SCHEMA))
    assert "production_upstream" not in fake2.posts[0]


def test_a_deck_spun_off_a_brief_sends_the_brief_to_the_engine(deck, monkeypatch):
    """UAT round 4 L2: a brief-only deck built from an empty brief, because the brief it carries was never sent."""
    fake = use(monkeypatch, FakeEngine(view("gate", gate=GATE1)))
    host = Host(data=deck_data(), schema=SCHEMA)
    brief = {"objectives": "Sell the starter bottle", "single_minded_proposition": "Cleans as well as your usual spray.", "mandatories": ["Logo top right"]}
    kit = {"kit": {"version": 2}, "objectives": "a kit is never the brief"}
    prod = {"app": "production-tool", "contract_version": "3", "project": {"id": "proj_x", "title": "P"}, "finals": {}, "briefs": {}}
    host.data["upstream"] = {"doc-kit": kit, "doc-prod-1": prod, "doc-brief-1": brief}
    build(deck, host)
    sent = fake.posts[0]
    assert sent["brief_upstream"] == {"id": "doc-brief-1", "data": brief}   # carried whole, as the engine reads it
    assert sent["production_upstream"]["id"] == "doc-prod-1"
    fake2 = use(monkeypatch, FakeEngine(view("gate", gate=GATE1)))
    build(deck, Host(data=deck_data(), schema=SCHEMA))
    assert "brief_upstream" not in fake2.posts[0]


class IndexHost(Host):
    """The host as napkin-host sends a Deck (read.rs clan_context_for_agent): ``data.upstream`` as an INDEX (middleware-api.md §1), a
    Production project whole as ``production_upstream`` and, with ``carry``, the Deck's brief whole as ``brief_upstream``."""

    def __init__(self, *a, carry=True, **k):
        super().__init__(*a, **k)
        self.carry = carry

    def clan(self):
        c = super().clan()
        up = c["data"].get("upstream") or {}
        c["data"]["upstream"] = {k: {"direct": True, "keys": sorted(v)} for k, v in up.items()}
        prod = next(((k, v) for k, v in up.items() if v.get("app") == "production-tool"), None)
        if prod:
            c["production_upstream"] = {"id": prod[0], "data": prod[1]}
        brief = next(((k, v) for k, v in up.items() if v.get("app") != "production-tool" and "objectives" in v), None)
        if brief and self.carry:
            c["brief_upstream"] = {"id": brief[0], "data": brief[1]}
        return c


def test_through_the_hosts_index_a_deck_from_a_brief_still_sends_the_brief(deck, monkeypatch):
    """UAT round 4 L2, the real cause: the host sends data.upstream as an index, so the brief must travel beside it (clan.brief_upstream);
    #312's test fed whole upstream data and never saw this."""
    research = {"campaign": {"name": "Copperell research"}, "report": {}, "selection": {}}
    brief = {"objectives": "Sell the starter bottle", "single_minded_proposition": "Cleans as well as your usual spray.",
             "mandatories": ["End line: 'Refill. Not landfill.' (word for word)"], "project_name": "Copperell Refill"}
    fake = use(monkeypatch, FakeEngine(view("gate", gate=GATE1)))
    host = IndexHost(data=deck_data(), schema=SCHEMA)
    host.data["upstream"] = {"doc-research": research, "doc-brief": brief}
    build(deck, host)
    assert fake.posts[0]["brief_upstream"] == {"id": "doc-brief", "data": brief}
    fake2 = use(monkeypatch, FakeEngine(view("gate", gate=GATE1)))
    old = IndexHost(data=deck_data(), schema=SCHEMA, carry=False)   # a host without the carrier: the bug, as it was
    old.data["upstream"] = {"doc-research": research, "doc-brief": brief}
    build(deck, old)
    assert "brief_upstream" not in fake2.posts[0]


PASS = "v1." + "e30" + "." + "c2ln"


def post_assets(deck, host, assets, task="build_deck"):
    """build_deck as napkin-web sends it: payload.production_assets set beside task and input."""
    st, body = post_raw(deck, {"task": task, "input": {}, "production_assets": assets}, host.clan())
    assert st == 200, body
    return body


def post_raw(deck, payload, clan):
    r = httpx.post(deck.url + "/v1/tasks", json={"request_kind": "middleware", "payload": payload, "clan": clan}, timeout=30)
    return r.status_code, r.json()


def prod_host():
    host = Host(data=deck_data(), schema=SCHEMA)
    host.data["upstream"] = {"doc-prod-1": {"app": "production-tool", "contract_version": "3", "project": {"id": "proj_1", "title": "T"}}}
    return host


def test_the_assets_pass_goes_to_the_engine_for_a_carried_production_project_and_nowhere_else(deck, monkeypatch, caplog):
    fake = use(monkeypatch, FakeEngine(view("gate", gate=GATE1)))
    host = prod_host()
    caplog.set_level("DEBUG")
    body = post_assets(deck, host, {"base": "https://relay.example/api/", "pass": PASS})
    waited = 0
    while not fake.posts and waited < 5:
        time.sleep(0.05)
        waited += 0.05
    assert fake.posts[0]["production_assets"] == {"base": "https://relay.example/api", "pass": PASS}
    assert PASS not in json.dumps(body) and PASS not in caplog.text, "a bearer token: not in a reply, not in a log"
    # the document is untouched by it
    assert PASS not in json.dumps(host.data)


def test_no_pass_forwarded_without_a_production_upstream_or_with_a_bad_shape(deck, monkeypatch):
    fake = use(monkeypatch, FakeEngine(view("gate", gate=GATE1)))
    post_assets(deck, Host(data=deck_data(), schema=SCHEMA), {"base": "https://relay.example/api", "pass": PASS})
    time.sleep(0.3)
    assert "production_assets" not in fake.posts[0], "a deck with no Production project never receives one"
    for bad in ({"base": "http://relay.example/api", "pass": PASS}, {"base": "https://r.example/api", "pass": "nope"},
                {"base": "https://r.example/api"}, "x", []):
        fake2 = use(monkeypatch, FakeEngine(view("gate", gate=GATE1)))
        post_assets(deck, prod_host(), bad)
        time.sleep(0.3)
        assert "production_assets" not in fake2.posts[0], bad


def test_http_pass_base_is_forwarded_only_with_the_dev_opt_in():
    from napkin.handlers import build_deck as bd
    v = {"base": "http://127.0.0.1:18788/api/", "pass": PASS}
    assert bd.assets_of(v) is None and bd.assets_of(v, False) is None
    assert bd.assets_of(v, True) == {"base": "http://127.0.0.1:18788/api", "pass": PASS}
    assert bd.assets_of({"base": "ftp://x/api", "pass": PASS}, True) is None


def test_marks_cover_the_full_brief_a_carried_production_project_carries():
    from napkin.handlers.build_deck import marks_of
    data = {"upstream": {"prod-1": {"app": "production-tool", "upstream": {"brief-1": {"insight": "SECRET-FULL", "confidential_fields": ["insight"]}}}}}
    marks = {m["path"]: m for m in marks_of(data, [])}
    assert "SECRET-FULL" in marks["upstream.prod-1.upstream.brief-1.insight"]["text"]


def test_marks_cover_the_research_a_carried_brief_carries():
    """5-tool run 2026-11-26: the host sends the brief's research under the brief's own upstream (read.rs brief_upstream); its marked parts
    (a classify on the research, its own confidential_fields, client-confidential materials) reach the engine's picture step as marks."""
    from napkin.handlers.build_deck import marks_of, with_brief
    brief = {"objectives": "Win shelf space.", "upstream": {"res-1": {"report": {"summary": "SECRET-MARGIN"}, "confidential_fields": ["report.summary"],
                                                                     "materials": {"m1": {"name": "Retailer deck", "text": "SECRET-DECK",
                                                                                          "licence": "client-confidential"}}}}}
    data = with_brief({"upstream": {"brief-1": {"title": "index entry"}, "res-1": {"title": "index entry"}}}, {"id": "brief-1", "data": brief})
    chain = [{"kind": "classify", "targets": ["res-1#report.summary"], "licence": {"model": False}}]
    marks = {(m["path"], m["kind"]): m["text"] for m in marks_of(data, chain)}
    assert marks[("upstream.brief-1.upstream.res-1.report.summary", "confidential_field")] == "SECRET-MARGIN"
    assert marks[("upstream.brief-1.upstream.res-1.report.summary", "classify")] == "SECRET-MARGIN"
    assert "SECRET-DECK" in marks[("upstream.brief-1.upstream.res-1.materials[m1]", "licence")]


def test_the_research_a_deck_carries_goes_to_the_engine_as_its_evidence(deck, monkeypatch):
    """The first UAT deck said 'Built from: prompt' and 'No research brought in': the engine was sent the prompt and nothing else of what the deck carries."""
    from napkin.handlers import build_deck as bd
    clan = {"facts": [{"id": "f_1", "entity": "market", "key": "value", "value": 7.6}], "findings": [{"id": "fi_1", "statement": "Cider lost share.", "status": "verified"}],
            "sources": [], "decision_chain": {"decisions": [{"id": "d_1", "kind": "verify"}]}}
    assert bd.members_of(clan) == {"facts": clan["facts"], "findings": clan["findings"], "decisions": clan["decision_chain"]["decisions"]}
    assert bd.members_of({}) is None and bd.members_of({"facts": [], "findings": []}) is None and bd.members_of(None) is None
    fake = use(monkeypatch, FakeEngine(view("gate", gate=GATE1)))
    host = Host(data=deck_data(), schema=SCHEMA)
    st, body = post_raw(deck, {"task": "build_deck", "input": {}}, {**host.clan(), **clan})
    assert st == 200, body
    waited = 0
    while not fake.posts and waited < 5:
        time.sleep(0.05)
        waited += 0.05
    assert fake.posts[0]["members"]["facts"] == clan["facts"] and fake.posts[0]["members"]["findings"] == clan["findings"]
    fake2 = use(monkeypatch, FakeEngine(view("gate", gate=GATE1)))
    build(deck, Host(data=deck_data(), schema=SCHEMA))
    assert "members" not in fake2.posts[0]
