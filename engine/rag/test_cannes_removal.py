"""cannes_removal: plan lists only, execute removes only cannes rows, and the ingest is stopped.

Every row below is a stand-in written for the test: tagged with a source, holding no archive text."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

import cannes_removal as cr

ENGINE = Path(__file__).resolve().parent.parent


def _make_root(tmp_path):
    root = tmp_path / "engine"
    idx = root / "rag" / "_index_v9"
    idx.mkdir(parents=True)
    rows = [{"id": f"c{i}", "source": "cannes", "text": "STAND-IN", "vector": [0.0]} for i in range(3)]
    rows += [{"id": f"i{i}", "source": "ipa", "text": "STAND-IN", "vector": [0.0]} for i in range(2)]
    (idx / "chunks.jsonl").write_text("".join(json.dumps(r) + "\n" for r in rows))
    (idx / "manifest.json").write_text(json.dumps({"chunks": 5, "dim": 1}))
    (root / "reference" / "_raw").mkdir(parents=True)
    (root / "reference" / "_raw" / "cannes.json").write_text("[]")
    (root / "reference" / "_raw" / "effie.csv").write_text("x")
    (root / "reference" / "rag" / "cannes").mkdir(parents=True)
    (root / "reference" / "rag" / "cannes" / "cannes_0001.md").write_text("STAND-IN")
    (root / "reference" / "rag" / "effie").mkdir()
    (root / "reference" / "rag" / "effie" / "effie_0001.md").write_text("STAND-IN")
    return root, idx


class FakeQdrant:
    def __init__(self, n):
        self.n, self.calls = n, []

    def __call__(self, method, path, body=None):
        self.calls.append((method, path))
        if path.endswith("/points/count"):
            return {"result": {"count": self.n}}
        if "/points/delete" in path:
            self.n = 0
            return {"result": {}}
        raise AssertionError(path)


def test_plan_lists_counts_and_changes_nothing(tmp_path, capsys):
    root, idx = _make_root(tmp_path)
    q = FakeQdrant(7)
    before = {p: p.read_bytes() for p in root.rglob("*") if p.is_file()}
    assert cr.main(["plan", "--engine-root", str(root), "--qdrant", "--collection", "napkin_rag"], req=q) == 0
    out = capsys.readouterr().out
    assert "3 of 5 rows" in out and "napkin_rag: 7 points" in out and "cannes.json" in out
    assert "STAND-IN" not in out
    assert all(c[1].endswith("/points/count") for c in q.calls)
    assert before == {p: p.read_bytes() for p in root.rglob("*") if p.is_file()}


def test_remove_without_execute_is_a_dry_run(tmp_path, capsys):
    root, idx = _make_root(tmp_path)
    assert cr.main(["remove", "--engine-root", str(root)]) == 0
    assert "nothing was deleted" in capsys.readouterr().out
    assert cr.count_local(idx) == (5, 3)


def test_execute_needs_a_named_person_and_a_log(tmp_path):
    root, _ = _make_root(tmp_path)
    with pytest.raises(SystemExit):
        cr.main(["remove", "--engine-root", str(root), "--execute"])


def test_execute_removes_only_cannes_and_records_counts(tmp_path):
    root, idx = _make_root(tmp_path)
    q, log = FakeQdrant(7), tmp_path / "log.json"
    rc = cr.main(["remove", "--engine-root", str(root), "--execute", "--approved-by", "Test Person",
                  "--log", str(log), "--qdrant", "--collection", "napkin_rag"], req=q)
    assert rc == 0
    assert cr.count_local(idx) == (2, 0)
    assert json.loads((idx / "manifest.json").read_text())["chunks"] == 2
    assert not (root / "reference/_raw/cannes.json").exists()
    assert not (root / "reference/rag/cannes").exists()
    # Effie material is not touched
    assert (root / "reference/_raw/effie.csv").exists()
    assert (root / "reference/rag/effie/effie_0001.md").exists()
    rec = json.loads(log.read_text())
    assert rec["approved_by"] == "Test Person" and rec["verified_zero"] is True
    assert rec["local_indexes"][0]["removed"] == 3 and rec["qdrant"][0] == {"collection": "napkin_rag", "before": 7, "after": 0}


def test_qdrant_filter_names_only_the_source():
    q = FakeQdrant(1)
    cr.qdrant_delete("c", q)
    assert q.calls == [("POST", "/collections/c/points/delete?wait=true")]


def test_ingest_cannes_is_stopped():
    r = subprocess.run([sys.executable, "-I", "-c", "import sys; sys.path.insert(0, sys.argv[1]); import ingest_cannes; ingest_cannes.main()",
                        str(ENGINE)], capture_output=True, text=True, cwd=str(ENGINE))
    assert r.returncode != 0 and "cannes-removal" in (r.stderr + r.stdout)
    # the module is run the way done_when says
    r2 = subprocess.run([sys.executable, "-m", "ingest_cannes"], capture_output=True, text=True,
                        cwd=str(ENGINE))
    assert r2.returncode != 0 and "cannes-removal" in (r2.stderr + r2.stdout)


def test_ingest_cannes_is_not_registered():
    assert "ingest_cannes" not in (ENGINE / "pyproject.toml").read_text()
