"""weights_guard.py — load only model weights listed in licences/weights.toml.

The licence gate (scripts/licences/check.py) checks the model ids it can see in code,
but RAG_EMBED_LOCAL_MODEL and RAG_LOCAL_RERANKER pick a model at run time. This guard
closes that gap: embed_local.model() and judge_local.resolve_model() call require()
before anything loads, and an id that is not in the manifest raises UnlistedWeights.

A local directory (judge_local accepts a saved-model folder) passes only when one of
its weight files has the sha256 of a file listed for some model, so a folder cannot
smuggle in an unlisted model either.

The manifest is found at licences/weights.toml above this file, or at
NAPKIN_WEIGHTS_MANIFEST. A missing manifest fails closed.
"""
from __future__ import annotations

import hashlib
import os
import tomllib
from pathlib import Path

DEFAULT_MANIFEST = Path(__file__).resolve().parents[2] / "licences" / "weights.toml"
WEIGHT_SUFFIXES = (".safetensors", ".bin", ".onnx", ".pt", ".gguf")


class UnlistedWeights(RuntimeError):
    """The model is not in licences/weights.toml, so it may not be loaded."""


def manifest_path() -> Path:
    return Path(os.environ.get("NAPKIN_WEIGHTS_MANIFEST") or DEFAULT_MANIFEST)


def load_manifest(path: Path | None = None) -> list[dict]:
    path = path or manifest_path()
    try:
        with open(path, "rb") as f:
            return list(tomllib.load(f).get("model", []))
    except FileNotFoundError as e:
        raise UnlistedWeights(f"weights manifest {path} not found; no model may load without it") from e


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def require(model: str, manifest: Path | None = None) -> str:
    """Return `model` if it may be loaded, else raise UnlistedWeights naming the fix."""
    models = load_manifest(manifest)
    if any(m.get("id") == model for m in models):
        return model
    p = Path(model).expanduser()
    if p.is_dir():
        known = {f["sha256"] for m in models for f in m.get("files", [])}
        weights = sorted(x for x in p.rglob("*") if x.is_file() and x.suffix in WEIGHT_SUFFIXES)
        if any(_sha256(w) in known for w in weights):
            return model
        raise UnlistedWeights(
            f"{p}: none of its weight files matches a sha256 in {manifest or manifest_path()}; "
            f"list the model there (with a person's approval) before loading it")
    raise UnlistedWeights(
        f"model {model!r} is not in {manifest or manifest_path()}; add a [[model]] entry with its "
        f"weight licence and file hashes, approved by a person (docs/contracts/licences.md)")
