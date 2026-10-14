"""weights_guard: only models listed in licences/weights.toml load (offline, no torch).
Run: cd engine/rag && python3 -m pytest test_weights_guard.py -q
"""
from __future__ import annotations

import hashlib
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import pytest  # noqa: E402
import weights_guard as wg  # noqa: E402


def _manifest(tmp_path: Path, body: str) -> Path:
    """A weights manifest with the given TOML body."""
    p = tmp_path / "weights.toml"
    p.write_text(body)
    return p


def test_a_listed_id_passes_and_an_unlisted_one_raises(tmp_path):
    """The id is the key: listed loads, anything else raises naming the manifest."""
    m = _manifest(tmp_path, '[[model]]\nid = "org/listed"\nfiles = []\n')
    assert wg.require("org/listed", m) == "org/listed"
    with pytest.raises(wg.UnlistedWeights) as e:
        wg.require("org/other", m)
    assert "org/other" in str(e.value) and "weights.toml" in str(e.value)


def test_a_local_directory_passes_only_with_a_listed_file_hash(tmp_path):
    """A saved-model folder loads only when a weight file's sha256 is in the manifest."""
    good = tmp_path / "good"
    good.mkdir()
    (good / "model.safetensors").write_bytes(b"listed weights")
    bad = tmp_path / "bad"
    bad.mkdir()
    (bad / "model.safetensors").write_bytes(b"something else")
    sha = hashlib.sha256(b"listed weights").hexdigest()
    m = _manifest(tmp_path, f'[[model]]\nid = "org/x"\nfiles = [{{ path = "model.safetensors", sha256 = "{sha}" }}]\n')
    assert wg.require(str(good), m) == str(good)
    with pytest.raises(wg.UnlistedWeights):
        wg.require(str(bad), m)


def test_a_missing_manifest_fails_closed(tmp_path, monkeypatch):
    """No manifest, no model."""
    monkeypatch.setenv("NAPKIN_WEIGHTS_MANIFEST", str(tmp_path / "absent.toml"))
    with pytest.raises(wg.UnlistedWeights):
        wg.require("BAAI/bge-reranker-v2-m3")


def test_the_repo_manifest_lists_the_engines_default_models(monkeypatch):
    """The real licences/weights.toml lists what embed_local and judge_local load by default."""
    monkeypatch.delenv("NAPKIN_WEIGHTS_MANIFEST", raising=False)
    assert wg.require("nvidia/Nemotron-3-Embed-1B-BF16")
    assert wg.require("BAAI/bge-reranker-v2-m3")
