"""Acceptance A45: the idea stage failed (the model was unavailable) and the agent row read "Brief agent · Writes the brief · Failed, retrying".
A failure names the agent of the row that failed."""

from __future__ import annotations

from deck import run_state as rs


def test_a_failure_names_the_agent_of_the_row_that_failed(tmp_path):
    for row, agent in (("idea", "idea"), ("territories", "strategy"), ("storyline", "strategy"), ("copy", "copy"), ("check", "review"), ("inputs", "brief")):
        run = rs.run_object(state="failed", stages=tmp_path, current=None, error={"stage": row, "message": "NoClaudeAvailable", "retryable": True})
        assert run["stage"] == row and run["agent"] == {"key": agent, "activity": "error"}, (row, run["agent"])   # A45: always "brief"
    run = rs.run_object(state="failed", stages=tmp_path, current="d", error={"stage": "idea", "message": "x", "retryable": True})
    assert run["agent"]["key"] == "idea"


def test_every_row_has_an_agent_and_the_steps_agree_with_their_rows():
    assert set(rs.ROW_AGENT) == set(rs.ROW_IDS)
    for step, (agent, _) in rs.STEP_AGENT.items():
        if rs.STEP_ROW.get(step) in ("storyline", "territories", "idea", "copy", "inputs"):
            assert agent == rs.ROW_AGENT[rs.STEP_ROW[step]], step
