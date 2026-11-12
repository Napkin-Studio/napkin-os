"""Tests for scripts/uat/watch.py's classification.  python3 -m unittest scripts/uat/test_watch.py"""
import datetime as dt
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from watch import jobs_in_export, summarise  # noqa: E402

T0 = dt.datetime(2026, 11, 12, 6, 25, 0, tzinfo=dt.timezone.utc)


def ev(s, **kw):
    return {"t": (T0 + dt.timedelta(seconds=s)).isoformat(), "s": s, "job": "job_x", **kw}


START = ev(0, ev="job_start", task="start_campaign")


class Summarise(unittest.TestCase):
    def test_done(self):
        e = [START, ev(1, ev="stage_start", stage="extract"),
             ev(10, ev="stage_end", stage="extract", secs=10, model_s=9, search_s=0, model_cost=0.03),
             ev(10, ev="job_end", state="done", secs=10)]
        s = summarise(e, T0 + dt.timedelta(seconds=99))
        self.assertEqual(s["verdict"], "done")
        self.assertEqual(s["slow"], [])

    def test_done_with_raised_stages_is_failed(self):
        # Round 1: job_72a9... ended "done" with every stage raising LayersError.
        e = [START, ev(17, ev="gap", stage="extract", reason="raised", detail="LayersError: relation does not exist"),
             ev(20, ev="job_end", state="done", secs=20)]
        s = summarise(e, T0)
        self.assertEqual(s["verdict"], "failed")
        self.assertIn("LayersError", s["why"])

    def test_failed_state(self):
        s = summarise([START, ev(3, ev="job_end", state="failed", summary="boom")], T0)
        self.assertEqual(s["verdict"], "failed")

    def test_hung(self):
        # Round 1: job_118d... entered "draft" and never logged again.
        e = [START, ev(116, ev="stage_start", stage="draft")]
        s = summarise(e, T0 + dt.timedelta(seconds=116 + 600), hang=120)
        self.assertEqual(s["verdict"], "hung")
        self.assertIn("draft", s["why"])

    def test_waiting_after_stage_end(self):
        # Round 2: identify asked, then logged stage_end; the job waits on a person, it is not hung.
        e = [START, ev(28, ev="question", stage="identify", text="Which brand?"),
             ev(28, ev="stage_end", stage="identify", secs=0.3)]
        self.assertEqual(summarise(e, T0 + dt.timedelta(seconds=600), hang=120)["verdict"], "waiting")

    def test_answered_question_then_silence_is_hung(self):
        e = [START, ev(28, ev="question", stage="identify", text="Which brand?"),
             ev(40, ev="answer", stage="identify"), ev(41, ev="stage_start", stage="select")]
        self.assertEqual(summarise(e, T0 + dt.timedelta(seconds=600), hang=120)["verdict"], "hung")

    def test_working(self):
        e = [START, ev(5, ev="model", stage="research")]
        self.assertEqual(summarise(e, T0 + dt.timedelta(seconds=30))["verdict"], "working")

    def test_waiting_on_a_person_is_not_hung(self):
        e = [START, ev(28, ev="question", stage="identify", text="Which category is it?")]
        s = summarise(e, T0 + dt.timedelta(hours=2), hang=120)
        self.assertEqual(s["verdict"], "waiting")

    def test_slow_stage_flags_unaccounted_time(self):
        # Round 1: extract took 28.3 s with 9.7 s of model time.
        e = [START, ev(28, ev="stage_end", stage="extract", secs=28.3, model_s=9.7, search_s=0),
             ev(28, ev="job_end", state="done", secs=28)]
        s = summarise(e, T0, slack=15)
        self.assertEqual([r["stage"] for r in s["slow"]], ["extract"])

    def test_empty(self):
        self.assertEqual(summarise([], T0)["verdict"], "unknown")


class Export(unittest.TestCase):
    def test_jobs_in_order_and_filtered(self):
        text = "\n".join([
            '{"ts":"2026-11-12T06:25:25Z","account":"plu@pluto","doc":"d1","data":{"job":"job_a"}}',
            '{"ts":"2026-11-12T06:20:00Z","account":"bo@boysandgirls","doc":"d2","data":{"job":"job_b"}}',
            '{"ts":"2026-11-12T06:26:00Z","account":"plu@pluto","doc":"d1","data":{"job":"job_a"}}',
            'not json',
        ])
        self.assertEqual([j["job"] for j in jobs_in_export(text)], ["job_b", "job_a"])
        self.assertEqual([j["job"] for j in jobs_in_export(text, "plu@pluto")], ["job_a"])


if __name__ == "__main__":
    unittest.main()
