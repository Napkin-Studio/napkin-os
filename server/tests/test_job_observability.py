"""Every job is traceable from stdout (CloudWatch) with its real error, and no body reaches it
(features/job-observability.clan).

UAT 2026-11-11: from AWS nobody could tell a working job from a dead one. The run log went only to
a file; a Research job whose every stage raised said nothing but "done"; 23 s of Aurora waking, a
90 s intake wait and an 11 s wait for a poll showed as silence."""

import json
import logging
import threading
import time
from types import SimpleNamespace

import psycopg
import pytest

from napkin import runlog
from napkin.app import Middleware, log_thread_errors
from napkin.capabilities import Capabilities
from napkin.jobs import JobStore
from napkin.layers import pg
from napkin.layers.http import LayersError
from napkin.model import ModelPort
from napkin.pipeline import campaign

from fakes import FakeModel, FakeResearch
from test_no_halt import LABELLED, TONIC, MiniHost, Model, drive, settings
from napkin.handlers import start_campaign

SCOPE = {"org": "org/test-agency", "brand": "brand/test"}


def stdout_events(caplog) -> list[dict]:
    out = []
    for r in caplog.records:
        if r.name == "napkin.runlog" and r.getMessage().startswith("runlog "):
            out.append(json.loads(r.getMessage()[len("runlog "):]))
    return out


@pytest.fixture
def bodies_on(tmp_path):
    runlog.configure(str(tmp_path / "runs"), bodies=True)
    yield tmp_path / "runs"
    runlog.configure(None)


def file_events(d) -> list[dict]:
    return [json.loads(x) for p in sorted(d.rglob("*.jsonl")) for x in p.read_text().splitlines() if x.strip()]


# -- A: stdout ----------------------------------------------------------------------------

def test_stdout_carries_every_event_and_no_body_even_with_bodies_on(bodies_on, caplog):
    caplog.set_level(logging.INFO, logger="napkin.runlog")
    secret = "CLIENT-SECRET-WORDS"
    rl = runlog.open_log("job_0bs1", "start_campaign@1.0", "org/test-agency")
    rl.start("start_campaign", "doc-1", ["extract"], model="claude-x")
    with rl.stage("extract"):
        rl.model(purpose="extract", model="claude-sonnet-5-5", secs=1.0, tin=10, tout=5, attempts=1, ok=True,
                 payload={"system": secret, "payload": {"brief": secret}}, reply={"out": secret},
                 payload_chars=100, reply_chars=50)
        rl.research(lens="market_structure", market="IE", query=secret, secs=2.0, sources=1, urls=["https://x.ie"],
                    queries=[secret], results=[{"url": "https://x.ie", "title": secret, "text": secret}])
        rl.retrieval(purpose="plan", k=4, secs=0.5, found=2, query=secret)
        rl.decisions([{"id": "d_1", "agent": "a", "kind": "edit", "action": "extract", "targets": [],
                       "reasoning": {"decided": secret, "certainty": {"level": "high", "why": secret},
                                     "because": [{"point": secret}], "attention": secret}}])
        rl.question("extract", secret, [secret])
        rl.answer("extract", secret)
        rl.note("plan", strategy=secret, brand=secret, competitors=[secret], rests_on={"x": ["y"]})
    rl.end("done", summary="ok")

    lines = stdout_events(caplog)
    on_file = file_events(bodies_on)
    assert len(lines) == len(on_file) and [x["ev"] for x in lines] == [x["ev"] for x in on_file]
    assert any(secret in json.dumps(x) for x in on_file)  # the file keeps the bodies (staging's policy)
    for x in lines:
        assert secret not in json.dumps(x), x
        assert not set(x) & runlog.STDOUT_DROPS, x
        assert x["job"] == "job_0bs1" and x["task"] == "start_campaign" and x["org"] == "org/test-agency"
    model = next(x for x in lines if x["ev"] == "model")
    assert model["secs"] == 1.0 and model["in_tokens"] == 10 and model["cost"] is not None


def test_stdout_lines_are_written_without_a_run_log_dir(caplog):
    caplog.set_level(logging.INFO, logger="napkin.runlog")
    runlog.configure(None)
    rl = runlog.open_log("job_0bs2", "draft_brief@1.0", "org/x")
    rl.start("draft_brief", "doc-1", ["extract"])
    rl.end("done")
    assert [x["ev"] for x in stdout_events(caplog)] == ["job_start", "job_end"]
    runlog.NULL.note("nothing")  # a request no job is bound to writes nothing
    assert len(stdout_events(caplog)) == 2


# -- C (what is built of it): the real error, and a done job whose stages failed says so -----

class _Raising:
    """The layers, but every category-tree read fails as UAT's did (no layers schema in the database)."""

    def __init__(self, inner):
        self._inner = inner

    def leaves(self):
        try:
            raise psycopg.errors.UndefinedTable('relation "layers.categories" does not exist')
        except psycopg.Error as e:
            raise LayersError('layers categories refused: internal: relation "layers.categories" does not '
                              'exist') from e

    def __getattr__(self, name):
        return getattr(self._inner, name)


class _RaisingStore:
    def __init__(self, store):
        self._store = store

    def open(self, scope, attribution=None):
        return _Raising(self._store.open(scope, attribution))


def _start(store, host, model=None, **kw):
    caps = Capabilities(handler="start_campaign@1.0", scope=SCOPE,
                        model_port=ModelPort(model or FakeModel(), "claude-opus-5", 30),
                        research_port=FakeResearch(), layer_store=store, research_semaphore=threading.Semaphore(4))
    caps.bind_job("job_test0bs3")
    req = SimpleNamespace(doc=host.doc, clan=host.clan(), inp=host.inp, handler="start_campaign@1.0")
    job = start_campaign.start(req, caps, settings(**kw), "job_test0bs3")
    job.start()
    return job


def test_every_stage_failing_is_on_stdout_with_its_type_message_and_cause(store, caplog):
    caplog.set_level(logging.INFO, logger="napkin.runlog")
    host = MiniHost(LABELLED)
    job = _start(_RaisingStore(store), host)
    v = drive(job, host)
    job.thread.join(5)
    # UAT's case: nothing came of the run, so it ends failed with the layers' own error (job-end-states)
    assert v["state"] == "failed" and v["stage"] == "extract" and v["error"]["type"] == "stages_failed"
    assert v["error"]["message"] == ('extract failed: LayersError: layers categories refused: internal: relation '
                                     '"layers.categories" does not exist')
    lines = stdout_events(caplog)
    ends = {x["stage"]: x for x in lines if x["ev"] == "stage_end"}
    for stage in ("extract", "identify", "select"):
        e = ends[stage]
        assert e["error_type"] == "napkin.layers.http.LayersError", e
        assert 'relation "layers.categories" does not exist' in e["error"]
        assert any("UndefinedTable" in c for c in e["cause"])
    layer_calls = [x for x in lines if x["ev"] == "layers" and x["op"] == "leaves"]
    assert layer_calls and all("LayersError" in x["error"] for x in layer_calls)
    end = next(x for x in lines if x["ev"] == "job_end")
    assert end["stages_failed"][:3] == ["extract", "identify", "select"]
    assert end["first_error"].startswith("extract: napkin.layers.http.LayersError: layers categories refused")
    rec = next(r for r in caplog.records if r.name == "napkin.runlog" and '"ev": "job_end"' in r.getMessage())
    assert rec.levelno == logging.WARNING


# -- D: heartbeats, and a stage out of time says what it waited on ---------------------------

class _Stuck(Model):
    """The model, but the synthesise call never answers until released."""

    def __init__(self, release):
        super().__init__()
        self.release = release

    def create(self, **kw):
        user = kw["messages"][0]["content"]
        if isinstance(user, str) and user.startswith("Task: synthesise"):
            self.release.wait(10)
        return super().create(**kw)


def test_a_stalled_stage_beats_and_its_timeout_names_what_it_waited_on(store, caplog, monkeypatch):
    caplog.set_level(logging.INFO, logger="napkin.runlog")
    monkeypatch.setattr(runlog, "HEARTBEAT_S", 0.1)
    release = threading.Event()
    host = MiniHost(LABELLED, categories=TONIC)
    try:
        job = _start(store, host, model=_Stuck(release), stage_timeout=0.6)
        v = drive(job, host)
    finally:
        release.set()
    assert {"stage": "synthesise", "reason": "timeout"} in job.gaps and v["state"] in ("done", "failed")
    job.thread.join(5)
    lines = stdout_events(caplog)
    beats = [x for x in lines if x["ev"] == "heartbeat" and x["stage"] == "synthesise"]
    assert beats and any({"kind": "model", "what": "synthesise"} == {k: b[k] for k in ("kind", "what")}
                         for x in beats for b in x["busy"])
    end = next(x for x in lines if x["ev"] == "stage_end" and x["stage"] == "synthesise")
    assert end["error_type"] == "timeout" and "model synthesise" in end["waiting_on"]
    assert end["error"].startswith("timed out in synthesise after ")
    # the heartbeat stops with its stage
    i = lines.index(end)
    assert not [x for x in lines[i:] if x["ev"] == "heartbeat" and x["stage"] == "synthesise"]


def test_a_report_waiting_for_a_poll_says_so(store, caplog):
    caplog.set_level(logging.INFO, logger="napkin.runlog")
    host = MiniHost(LABELLED, categories=TONIC)
    job = _start(store, host, report_wait=0.2)
    drive(job, host, poll=False)
    waits = [x for x in stdout_events(caplog) if x["ev"] == "waiting" and x["stage"] == "report"]
    assert waits[0]["what"].startswith("a poll bringing") and waits[0]["budget_s"] == 0.2
    assert waits[-1]["ended"] == "gave_up"


# -- B: the knowledge layers waking ---------------------------------------------------------

def test_a_slow_layers_connect_is_a_waiting_event_and_a_timed_connect(caplog, monkeypatch):
    caplog.set_level(logging.INFO, logger="napkin.runlog")
    monkeypatch.setattr(pg, "WAKE_S", 0.05)

    def waking(self):
        time.sleep(0.2)
        raise psycopg.OperationalError("the database is resuming")
    monkeypatch.setattr(pg._Pool, "_connect", waking)
    caps = Capabilities(handler="start_campaign@1.0", scope=SCOPE,
                        model_port=ModelPort(FakeModel(), "claude-opus-5", 30), research_port=FakeResearch(),
                        layer_store=pg.PgLayerStore("postgresql://u@db.invalid/napkin_category"),
                        research_semaphore=threading.Semaphore(4))
    caps.bind_job("job_test0bs4")
    with pytest.raises(LayersError, match="unreachable"):
        caps.layers.leaves()
    lines = stdout_events(caplog)
    waking_evs = [x for x in lines if x["ev"] == "waiting"]
    assert waking_evs and waking_evs[0]["what"] == "knowledge layers waking" and waking_evs[0]["db"] == "category"
    conns = [x for x in lines if x["ev"] == "layers_connect"]
    assert len(conns) == 2 and all(x["secs"] >= 0.2 and "OperationalError" in x["error"] for x in conns)
    call = next(x for x in lines if x["ev"] == "layers")
    assert call["op"] == "leaves" and call["secs"] >= 0.4 and "unreachable" in call["error"]


# -- the deploy that took a job with it, and errors escaping a thread ------------------------

def test_a_job_unfinished_at_shutdown_ends_lost_saying_where(tmp_path):
    runlog.configure(str(tmp_path / "runs"))
    try:
        rl = runlog.open_log("job_0bs5", "draft_brief@1.0", "org/x")
        rl.start("draft_brief", "doc-1", ["draft"])
        jobs = JobStore()
        job = SimpleNamespace(id="job_0bs5", task="draft_brief", state="running", caps=SimpleNamespace(runlog=rl))
        jobs.add(job)
        with rl.stage("draft"), rl.busy("model", "draft_brief_whole"):
            Middleware.shutdown(SimpleNamespace(jobs=jobs))
    finally:
        runlog.configure(None)
    end = next(x for x in file_events(tmp_path / "runs") if x["ev"] == "job_end")
    assert end["state"] == "lost" and end["stage"] == "draft" and "model draft_brief_whole" in end["waiting_on"]
    assert end["error"]["type"] == "lost"


def test_an_exception_escaping_a_thread_is_logged_with_its_traceback(caplog, monkeypatch):
    monkeypatch.setattr(threading, "excepthook", threading.excepthook)  # restored after the test
    log_thread_errors()
    caplog.set_level(logging.ERROR, logger="napkin.app")

    def boom():
        raise RuntimeError("a worker fell over")
    t = threading.Thread(target=boom, name="campaign-job_x-extract")
    t.start()
    t.join()
    rec = next(r for r in caplog.records if r.name == "napkin.app" and "a worker fell over" in r.getMessage())
    assert "campaign-job_x-extract" in rec.getMessage() and rec.exc_info and rec.exc_info[0] is RuntimeError


def test_with_bodies_off_the_file_keeps_no_query_or_question_words(tmp_path):
    """Confidential means Napkin keeps none of the client's material (os-layer §4 C4, owner 2026-11-13):
    with bodies off, a search's query and a question's words are not written to the run-log file."""
    runlog.configure(str(tmp_path / "runs"), bodies=False)
    try:
        secret = "CLIENT-CONFIDENTIAL-WORDS"
        rl = runlog.open_log("job_0bs2", "start_campaign@1.0", "org/test-agency")
        rl.start("start_campaign", "doc-1", ["research"], model="claude-x")
        with rl.stage("research"):
            rl.research(lens="market", market="IE", query=secret, queries=[secret], secs=1.0, sources=1)
            rl.question("research", f"Is {secret} right?", options=[secret])
        rl.end("done")
        raw = "\n".join(p.read_text() for p in (tmp_path / "runs").rglob("*.jsonl"))
        assert raw and secret not in raw
        q = next(e for e in file_events(tmp_path / "runs") if e["ev"] == "question")
        assert q["chars"] == len(f"Is {secret} right?")
    finally:
        runlog.configure(None)
