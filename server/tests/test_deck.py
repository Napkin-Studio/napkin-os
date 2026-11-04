"""build_deck@1 (middleware-api.md §12): one segment of a Deck Maker run through the engine's port. The engine is a scripted stub behind
httpx.MockTransport; the host is the Brief tests' host (it applies a change as the real one does: once per decision id) and every state
of the document is checked against the Deck Maker app's own schema. No model, no engine process."""

import copy
import json
import threading
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
    assert host.data["run"]["cost_usd"] == 0.3 and "agent" not in host.data["run"], "the agent circle is gone while a gate waits"
    assert fake.posts == [{"doc": "doc-1" if False else fake.posts[0]["doc"], "inputs": {"prompt": {"text": PROMPT, "client": "Fernley", "project": "Tea 2027", "agency": ""},
                                                                                   "kind": "agency", "format": "pitch"}, "approvals": {}, "render": True}]


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


def test_after_the_last_gate_the_document_gets_the_deck_validation_evidence_report_and_export_names(deck, monkeypatch):
    use(monkeypatch, FakeEngine(view("building", stage="check"), view("done", stage="review", payload=PAYLOAD, cost=0)))
    host = Host(data=deck_data(), schema=SCHEMA)
    host.data["run"].update(state="gate", gate=GATE2)
    build(deck, host)
    d = host.data
    assert d["run"]["state"] == "done" and "gate" not in d["run"] and d["deck"]["order"] == ["s1"]
    assert d["validation"]["warnings"] == 1 and d["evidence"]["prompt:1"] and d["report"]["mode"] == "replay"
    assert d["exports"] == {"web": {"file": "deck.html", "bytes": 10}}, "names and sizes only"


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


# ── the carried brief and research (features/deck-maker-spinoff-inputs.clan) ──
CARRIED = {"data": {"upstream": {"brief-1": {"background": "Lumen Water serves a region."}}}, "members": {"facts": [], "findings": [], "sources": [], "decisions": []}}


def carrying(extra=None):
    h = Host(data=deck_data(), schema=SCHEMA)
    base = h.clan
    h.clan = lambda: {**base(), "deck_inputs": CARRIED, **(extra or {})}
    return h


def test_the_hosts_deck_inputs_go_to_the_engine_and_a_deck_that_carries_them_needs_no_prompt(deck, monkeypatch):
    fake = use(monkeypatch, FakeEngine(view("gate", gate=GATE1)))
    host = carrying()
    host.data["inputs"]["prompt"]["text"] = ""
    replies = build(deck, host)
    assert replies[-1]["job"]["state"] == "done"
    assert fake.posts[0]["deck_inputs"] == CARRIED and fake.posts[0]["inputs"]["prompt"]["text"] == ""


def test_what_the_host_left_out_is_named_in_the_result_and_never_a_value(deck, monkeypatch):
    use(monkeypatch, FakeEngine(view("gate", gate=GATE1)))
    host = carrying({"deck_inputs_skipped": [{"what": "brief-1#audience", "why": "marked not for agents"}]})
    replies = build(deck, host)
    assert replies[-1]["result"]["left_out"] == [{"what": "brief-1#audience", "why": "marked not for agents"}]


def test_a_deck_that_carries_nothing_sends_no_deck_inputs(deck, monkeypatch):
    fake = use(monkeypatch, FakeEngine(view("gate", gate=GATE1)))
    build(deck, Host(data=deck_data(), schema=SCHEMA))
    assert "deck_inputs" not in fake.posts[0]
