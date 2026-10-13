"""Tests for the licence gate (scripts/licences/check.py).

    uv run --no-project --python 3.12 --with pytest python -m pytest -q scripts/licences

Everything but test_repo_tree_passes is offline: fixture lockfiles under fixtures/,
recorded PyPI metadata, and scratch git repositories in tmp_path. The violation
strings these tests write are spelled in pieces where the gate's own scans would
otherwise read them (scripts/licences/ is excluded from the scans anyway).
"""
from __future__ import annotations

import copy
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tomllib
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import check  # noqa: E402
from check import Pkg, Policy, Report, parse_spdx, satisfy, leaves  # noqa: E402

REPO = check.REPO
FIX = HERE / "fixtures"
RECORDED = json.loads((FIX / "pypi" / "recorded.json").read_text())
SPDX_HDR = "SPDX-" + "License-Identifier"


def policy(**changes) -> Policy:
    """The real policy with no exceptions or clarifications, plus `changes` (top-level keys
    replaced; 'licences' and 'mpl' merged)."""
    raw = copy.deepcopy(Policy.load(REPO / "licences" / "policy.toml").raw)
    raw["exception"], raw["clarification"] = [], []
    for k, v in changes.items():
        if k in ("licences", "mpl") and isinstance(v, dict):
            raw.setdefault(k, {}).update(v)
        else:
            raw[k] = v
    return Policy(raw, Path("policy.toml"))


def judged(pkgs, pol=None, member=None) -> Report:
    rep = Report()
    check.judge(pkgs, pol or policy(), rep, member or (lambda url, m: b""))
    return rep


def pkg(name="x", licence="MIT", tier="client", eco="npm", version="1.0.0", source=None) -> Pkg:
    src = source or {"npm": "npm", "cargo": "crates.io", "pypi": "pypi"}[eco]
    return Pkg(eco, name, version, licence, tier, f"{eco}:fixture", src, via="fixture")


EXC = {"package": "psycopg", "ecosystem": "pypi", "version": "3.3.6", "tier": "server",
       "licence": "LGPL-3.0-only", "reason": "server only", "approved_by": "Shrey", "date": "2026-10-13"}


# ==== SPDX =========================================================================
ALLOWED = {"MIT", "Apache-2.0", "BSD-3-Clause", "Zlib", "Unicode-3.0", "Apache-2.0 WITH LLVM-exception"}


@pytest.mark.parametrize("expr, ok", [
    ("(Apache-2.0 OR MIT) AND BSD-3-Clause", True),          # encoding_rs
    ("MIT OR Apache-2.0 OR LGPL-2.1-or-later", True),          # r-efi passes via MIT
    ("Apache-2.0 WITH LLVM-exception", True),
    ("(MIT AND Zlib)", True),                                   # pako
    ("(MPL-2.0 OR Apache-2.0)", True),                          # dompurify via Apache
    ("(MIT OR Apache-2.0) AND Unicode-3.0", True),
    ("GPL-2.0 AND MIT", False),
    ("GPL-2.0-only OR LGPL-3.0-only", False),
    ("MIT AND (GPL-3.0-only OR Apache-2.0)", True),
    ("MIT OR Apache-2.0 AND GPL-3.0-only", True),               # AND binds tighter: MIT alone
])
def test_spdx_table(expr, ok):
    assert (satisfy(parse_spdx(expr), lambda i: i in ALLOWED) is not None) is ok


def test_spdx_precedence_and_with():
    assert parse_spdx("MIT OR Apache-2.0 AND BSD-3-Clause") == (
        "or", [("id", "MIT"), ("and", [("id", "Apache-2.0"), ("id", "BSD-3-Clause")])])
    assert parse_spdx("Apache-2.0 WITH LLVM-exception OR MIT") == (
        "or", [("id", "Apache-2.0 WITH LLVM-exception"), ("id", "MIT")])


@pytest.mark.parametrize("bad", ["", "MIT AND", "(MIT", "MIT)", "AND MIT", "Apache-2.0 WITH"])
def test_spdx_rejects_malformed(bad):
    with pytest.raises(check.SpdxError):
        parse_spdx(bad)


@pytest.mark.parametrize("legacy, ids", [
    ("MIT/Apache-2.0", ["MIT", "Apache-2.0"]),
    ("Apache-2.0/MIT", ["Apache-2.0", "MIT"]),
    ("Apache License 2.0", ["Apache-2.0"]),
    ("Apache 2.0 License", ["Apache-2.0"]),
    ("BSD-3", ["BSD-3-Clause"]),
    ("Dual Licensed - GNU AFFERO GPL 3.0 or Artifex Commercial License",
     ["AGPL-3.0-only", "LicenseRef-Artifex-Commercial"]),
])
def test_aliases_normalise_legacy_forms(legacy, ids):
    assert leaves(parse_spdx(legacy, policy().aliases)) == ids


# ==== readers ======================================================================
def test_npm_prod_is_client_and_dev_is_build_with_a_dependency_path():
    got = {(p.name, p.version): p for p in check.npm_packages(FIX / "npm", "client", "npm:fixture")}
    assert got[("ok-mit", "1.0.0")].tier == "client"
    assert got[("dev-tool", "1.0.0")].tier == "build"
    assert got[("deep", "2.0.0")].via == "fixture-client > ok-mit@1.0.0 > deep@2.0.0"
    assert got[("mpl-git", "1.0.0")].source.startswith("git:")
    assert got[("deep", "1.0.0")].source == "npm"


def test_python_runtime_is_server_tier_and_dev_groups_are_build():
    got = {p.name: p for p in check.uv_packages(FIX / "uv", "server", "python:fixture")}
    assert got["psycopg"].tier == "server" and got["psycopg-binary"].tier == "server"  # via the extra
    assert got["certifi"].tier == "server"
    assert got["pytest"].tier == "build" and got["pluggy"].tier == "build"
    assert got["requests"].tier == "server"           # dev reaches it too; runtime wins
    assert "fixture-server" not in got                 # the project itself is first party
    assert got["certifi"].via == "fixture-server > requests@2.32.0 > certifi@2026.1.1"


@pytest.mark.parametrize("key, want", [
    ("typesafe-sdk==0.7.1", "MIT"),
    ("jinja2==3.1.6", "LicenseRef-BSD-unspecified"),
    ("transformers==5.19.0", "Apache 2.0 License"),
    ("nvidia-cublas==13.1.1.3", "LicenseRef-NVIDIA-Proprietary"),
    ("pgserver==0.1.4", None),
    ("psycopg==3.3.6", "GNU Lesser General Public License v3 (LGPLv3)"),
    ("pymupdf==1.28.2", "Dual Licensed - GNU AFFERO GPL 3.0 or Artifex Commercial License"),
])
def test_pypi_metadata_parser(key, want):
    pol = policy()
    assert check.pypi_licence(RECORDED[key], pol.known_ids(), pol.aliases) == want


def test_pypi_licences_fill_from_recorded_metadata_without_network():
    pkgs = check.uv_packages(FIX / "uv", "server", "python:fixture")
    check.fill_pypi_licences(pkgs, policy(), fetch=lambda n, v: RECORDED[f"{n}=={v}"])
    rep = judged(pkgs, policy(exception=[EXC, {**EXC, "package": "psycopg-binary"}]))
    assert rep.failures == []


CARGO = shutil.which("cargo")


@pytest.mark.skipif(not CARGO, reason="cargo not installed")
def test_rust_tiers_per_root_feature_target_and_proc_macro(tmp_path):
    ws = tmp_path / "cargo"
    shutil.copytree(FIX / "cargo", ws)
    roots = [{"package": "app", "targets": ["x86_64-unknown-linux-gnu", "wasm32-unknown-unknown"], "tier": "client"},
             {"package": "srv", "targets": ["x86_64-unknown-linux-gnu"], "tier": "server"}]
    tiers = {n: t for (n, _), (t, _) in check.rust_tiers(ws, roots).items()}
    assert tiers["lib"] == "client"
    assert tiers["netdep"] == "server"       # behind a feature only the server root enables
    assert tiers["mac"] == "build"           # a proc macro never ships
    assert tiers["wasmonly"] == "client"     # reached only on the wasm32 target of a client root
    native_only = check.rust_tiers(ws, [{"package": "app", "targets": ["x86_64-unknown-linux-gnu"], "tier": "client"}])
    assert native_only[("wasmonly", "0.1.0")][0] == "build"


@pytest.mark.skipif(not CARGO, reason="cargo not installed")
def test_napkin_wasm_links_no_reqwest_and_no_tokio():
    """The real tree: napkin-host's optional native stack stays out of the browser build."""
    names = {n for n, _ in check.cargo_tree(REPO, "napkin-wasm", "wasm32-unknown-unknown")}
    assert "clan-sdk" in names and "lol_html" in names
    assert not names & {"reqwest", "tokio", "hyper", "cssparser-macros"}


# ==== policy =======================================================================
def test_gpl_npm_prod_dependency_in_a_client_root_fails():
    pkgs = check.npm_packages(FIX / "npm", "client", "npm:fixture")
    rep = judged([p for p in pkgs if p.name == "gpl-prod"])
    assert len(rep.failures) == 1 and "copyleft and this ships to clients" in rep.failures[0]


def test_lgpl_python_on_the_server_fails_without_an_exception_and_passes_with_one():
    p = pkg("psycopg", "LGPL-3.0-only", "server", "pypi", "3.3.6")
    rep = judged([p])
    assert rep.failures and "[[exception]]" in rep.failures[0] and 'tier = "server"' in rep.failures[0]
    assert judged([p], policy(exception=[EXC])).failures == []


@pytest.mark.parametrize("lic", ["BUSL-1.1", "SEE LICENSE IN LICENSE.md", "CC-BY-NC-4.0", "Elastic-2.0",
                                 "SSPL-1.0", "UNLICENSED", "LicenseRef-tldraw"])
def test_a_denied_licence_fails_even_with_an_exception(lic):
    exc = {**EXC, "package": "x", "ecosystem": "npm", "version": "1.0.0", "licence": lic}
    rep = judged([pkg("x", lic, "server")], policy(exception=[exc]))
    assert any("no exception can allow it" in f for f in rep.failures)
    assert any("denied" in e for e in policy(exception=[exc]).validate())


def test_tldraw_style_package_from_the_fixture_lock_fails():
    pkgs = [p for p in check.npm_packages(FIX / "npm", "client", "npm:fixture") if p.name == "tldraw-like"]
    assert "denied" in judged(pkgs).failures[0]


def test_mpl_from_npm_passes_and_crates_io_depends_on_mpl_registries():
    assert judged([pkg("m", "MPL-2.0", "client", "npm")]).failures == []
    crate = pkg("cssparser", "MPL-2.0", "client", "cargo", "0.36.0")
    assert judged([crate], policy(mpl={"registries": ["npm"]})).failures
    assert judged([crate], policy(mpl={"registries": ["npm", "crates.io"]})).failures == []


def test_mpl_resolved_from_git_fails():
    pkgs = [p for p in check.npm_packages(FIX / "npm", "client", "npm:fixture") if p.name == "mpl-git"]
    rep = judged(pkgs)
    assert len(rep.failures) == 1 and "not a registry" in rep.failures[0]


def test_dual_mpl_or_apache_passes_and_cc_by_3_dev_fails_on_build():
    pkgs = {p.name: p for p in check.npm_packages(FIX / "npm", "client", "npm:fixture")}
    assert judged([pkgs["dual"], pkgs["deep"]]).failures == []
    assert "build tier" in judged([pkgs["dev-cc-by"]]).failures[0]


def test_unused_exception_fails(tmp_path):
    repo = mini_repo(tmp_path, policy_extra={"exception": [EXC], "roots": {"npm": [{"path": "web", "tier": "client"}]}},
                     files={"web/package.json": '{"name": "web"}',
                            "web/package-lock.json": json.dumps({"lockfileVersion": 3, "packages": {"": {"name": "web"}}})})
    (tmp_path / "empty-nm").mkdir()
    rep = check.run(repo, readers=True, install=lambda root: tmp_path / "empty-nm", out=lambda *_: None)
    assert any("exception psycopg@3.3.6 (pypi) matches nothing" in f for f in rep.failures)


def test_exception_without_a_person_in_approvers_fails():
    errs = policy(exception=[{**EXC, "approved_by": "claude"}]).validate()
    assert any("is not one of approvers" in e for e in errs)
    assert policy(exception=[{**EXC, "approved_by": "Shrey (2026-10-13 decision)"}]).validate() == []


def test_copyleft_can_never_get_a_client_exception():
    errs = policy(exception=[{**EXC, "tier": "client"}]).validate()
    assert any("copyleft never ships to clients" in e for e in errs)


def test_a_missing_licence_needs_a_clarification_checked_against_the_file_hash():
    p = pkg("fuzzy", None, "client", "npm", "0.1.3")
    p.archive = "https://registry.npmjs.org/fuzzy/-/fuzzy-0.1.3.tgz"
    assert "[[clarification]]" in judged([p]).failures[0]
    text = b"Permission is hereby granted"
    clar = {"package": "fuzzy", "ecosystem": "npm", "version": "0.1.3", "licence": "MIT",
            "licence_file": "package/LICENSE-MIT", "licence_file_sha256": hashlib.sha256(text).hexdigest(),
            "reason": "no license field"}
    assert judged([p], policy(clarification=[clar]), member=lambda u, m: text).failures == []
    assert "re-read the licence" in judged([p], policy(clarification=[clar]), member=lambda u, m: b"changed").failures[0]


# ==== scratch repositories =========================================================
def git(repo: Path, *args: str, env=None) -> str:
    return subprocess.run(["git", *args], cwd=repo, check=True, capture_output=True, text=True,
                          env={**os.environ, "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t",
                               "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@t", **(env or {})}).stdout


def toml_dump(d: dict) -> str:
    """Just enough TOML for the policy and manifests these tests write."""
    def val(v):
        if isinstance(v, str):
            return json.dumps(v)
        if isinstance(v, bool):
            return "true" if v else "false"
        if isinstance(v, list):
            return "[" + ", ".join(val(x) for x in v) + "]"
        if isinstance(v, dict):
            return "{ " + ", ".join(f"{json.dumps(k)} = {val(x)}" for k, x in v.items()) + " }"
        return str(v)
    out, tables = [], []
    for k, v in d.items():
        if v == [] and k in ("exception", "clarification", "model", "family", "binary"):
            continue
        if isinstance(v, list) and v and all(isinstance(x, dict) for x in v) and k in (
                "exception", "clarification", "model", "family", "binary"):
            tables.append((k, v))
        elif isinstance(v, dict) and k not in ("roots",):
            tables.append((k, v))
        else:
            out.append(f"{json.dumps(k) if ' ' in k else k} = {val(v)}")
    for k, v in tables:
        if isinstance(v, dict):
            out.append(f"\n[{k}]")
            out += [f"{json.dumps(kk)} = {val(vv)}" for kk, vv in v.items()]
        else:
            for e in v:
                out.append(f"\n[[{k}]]")
                out += [f"{kk} = {val(vv)}" for kk, vv in e.items()]
    return "\n".join(out) + "\n"


def mini_repo(tmp_path: Path, files: dict | None = None, policy_extra: dict | None = None,
              weights=None, fonts=None, binaries=None) -> Path:
    """A git repo with a licences/ directory (the real policy, no roots, no exceptions)."""
    repo = tmp_path / "repo"
    repo.mkdir()
    raw = copy.deepcopy(Policy.load(REPO / "licences" / "policy.toml").raw)
    raw.update({"exception": [], "clarification": [], "roots": {}})
    raw.update(policy_extra or {})
    (repo / "licences").mkdir()
    (repo / "licences" / "policy.toml").write_text(toml_dump(raw))
    (repo / "licences" / "weights.toml").write_text(toml_dump({"model": weights or []}) if weights else "model = []\n")
    (repo / "licences" / "fonts.toml").write_text(toml_dump({"family": fonts}) if fonts else "family = []\n")
    (repo / "licences" / "binaries.toml").write_text(toml_dump({"binary": binaries}) if binaries else "binary = []\n")
    for rel, text in (files or {}).items():
        (repo / rel).parent.mkdir(parents=True, exist_ok=True)
        (repo / rel).write_bytes(text if isinstance(text, bytes) else text.encode())
    git(repo, "init", "-q", "-b", "main")
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "-m", "fixture")
    return repo


def cheap(repo: Path) -> list[str]:
    return check.run(repo, readers=False, out=lambda *_: None).failures


def test_mini_repo_round_trips_the_real_policy(tmp_path):
    assert cheap(mini_repo(tmp_path)) == []


# ---- unmodified and vendored ---------------------------------------------------------
@pytest.mark.parametrize("files, needle", [
    ({"web/patches/react+19.0.0.patch": "diff"}, "patches/ directory"),
    ({"web/package.json": json.dumps({"devDependencies": {"patch-package": "^8"}})}, "patch-package"),
    ({"web/package.json": json.dumps({"scripts": {"postinstall": "node apply-patch.js"}})}, "patches installed packages"),
    ({"web/package.json": json.dumps({"overrides": {"foo": "github:me/foo"}})}, "points off the registry"),
    ({"web/package-lock.json": json.dumps({"lockfileVersion": 3, "packages": {
        "": {}, "node_modules/a": {"version": "1", "resolved": "https://evil.example/a.tgz", "integrity": "x"}}})},
     "not https://registry.npmjs.org/"),
    ({"web/package-lock.json": json.dumps({"lockfileVersion": 3, "packages": {
        "": {}, "node_modules/a": {"version": "1", "resolved": "https://registry.npmjs.org/a/-/a-1.tgz"}}})},
     "no integrity"),
    ({"Cargo.toml": '[workspace]\nmembers = []\n\n[patch.crates-io]\nfoo = { path = "foo" }\n'}, "[patch]"),
    ({"svc/pyproject.toml": '[project]\nname = "svc"\n\n[tool.uv.sources]\nfoo = { git = "https://example.com/foo" }\n'},
     "[tool.uv.sources] foo"),
    ({"web/src/lib/chart.min.js": "!function(){}"}, "vendored minified"),
    ({"web/vendor/lib.js": "x"}, "vendor/ or third_party/"),
    ({"web/src/copied.js": f"// {SPDX_HDR}: GPL-2.0-only\nexport const x = 1\n"}, "third-party licence header"),
    ({"web/src/copied2.js": "/**\n * @lic" "ense MIT\n */\n"}, "third-party licence header"),
])
def test_unmodified_and_vendored_violations_fail(tmp_path, files, needle):
    fails = cheap(mini_repo(tmp_path, files))
    assert any(needle in f for f in fails), fails


def test_our_own_spdx_header_passes(tmp_path):
    assert cheap(mini_repo(tmp_path, {"src/ours.rs": f"// {SPDX_HDR}: MPL-2.0\nfn main() {{}}\n"})) == []


# ---- weights ---------------------------------------------------------------------------
GOOD_MODEL = {"id": "org/good", "source": "https://huggingface.co/org/good", "revision": "abc",
              "files": [{"path": "model.safetensors", "sha256": "a" * 64}], "weight_licence": "Apache-2.0",
              "code_licence": "none", "model_card_url": "https://huggingface.co/org/good", "tier": "server",
              "used_by": ["svc/load.py"], "approved_by": "Shrey"}


@pytest.mark.parametrize("code, needle", [
    ('from sentence_transformers import SentenceTransformer\nm = SentenceTransformer("org/unlisted")\n', "org/unlisted"),
    ('import os\nfrom transformers import AutoModel\nMODEL = os.environ.get("X_MODEL", "org/env-default")\n'
     'AutoModel.from_pretrained(MODEL)\n', "org/env-default"),
    ('from huggingface_hub import snapshot_download\nsnapshot_download("org/snap")\n', "org/snap"),
    ('from rembg import new_session\ns = new_session()\n', "with no model name"),
    ('from rembg import new_session\ns = new_session("u2net_human_seg")\n', "u2net_human_seg"),
    ('import { pipeline } from "@huggingface/transformers"\nconst p = await pipeline("image-segmentation", "briaai/RMBG-1.4")\n',
     "briaai/RMBG-1.4"),
])
def test_model_ids_missing_from_the_manifest_fail(tmp_path, code, needle):
    ext = ".ts" if "import {" in code else ".py"
    fails = cheap(mini_repo(tmp_path, {f"svc/load{ext}": code}, weights=[GOOD_MODEL]))
    assert any(needle in f for f in fails), fails


def test_a_listed_model_and_a_named_rembg_model_pass(tmp_path):
    rembg = {**GOOD_MODEL, "id": "birefnet-general", "weight_licence": "MIT"}
    code = ('from rembg import new_session\nfrom sentence_transformers import CrossEncoder\n'
            'DEFAULT_MODEL = "org/good"\nCrossEncoder(DEFAULT_MODEL)\ns = new_session("birefnet-general")\n')
    assert cheap(mini_repo(tmp_path, {"svc/load.py": code}, weights=[GOOD_MODEL, rembg])) == []


def test_non_commercial_weights_and_an_incomplete_entry_fail(tmp_path):
    nc = {**GOOD_MODEL, "id": "org/nc", "weight_licence": "CC-BY-NC-4.0"}
    partial = {"id": "org/partial", "weight_licence": "MIT"}
    fails = cheap(mini_repo(tmp_path, weights=[nc, partial]))
    assert any("org/nc" in f and "not allowed for weights" in f for f in fails)
    assert any("org/partial" in f and "lacks" in f for f in fails)


def test_hosted_api_model_names_are_not_weights(tmp_path):
    """A MODEL constant in a file that loads no local weights is a hosted API name."""
    code = 'import requests\nMODEL = "nvidia/llama-nemotron-rerank-vl-1b-v2"\n'
    assert cheap(mini_repo(tmp_path, {"svc/hosted.py": code})) == []


# ---- fonts -----------------------------------------------------------------------------
EXCALI = {"name": "Virgil", "shipped_by": "@excalidraw/excalidraw@0.18.1", "files": ["Virgil-*"],
          "licence": "OFL-1.1", "source_url": "https://github.com/excalidraw/virgil"}


def fake_node_modules(root: Path) -> Path:
    nm = root / "node_modules"
    pkg = nm / "@excalidraw" / "excalidraw"
    for d in ("dist/prod/fonts/Virgil", "dist/dev/fonts/Virgil", "dist/prod/fonts/Mystery"):
        (pkg / d).mkdir(parents=True, exist_ok=True)
    (pkg / "package.json").write_text('{"name": "@excalidraw/excalidraw", "version": "0.18.1"}')
    (pkg / "dist/prod/fonts/Virgil/Virgil-Regular.woff2").write_bytes(b"wOF2")
    (pkg / "dist/dev/fonts/Virgil/Virgil-Regular.woff2").write_bytes(b"wOF2")
    return nm


def test_an_unlisted_font_in_a_production_install_fails(tmp_path):
    nm = fake_node_modules(tmp_path)
    rep = Report()
    check.scan_font_files([("web", nm)], {"family": [EXCALI]}, rep)
    assert rep.failures == []
    (nm / "@excalidraw/excalidraw/dist/dev/fonts/Mystery-Regular.woff2").write_bytes(b"wOF2")
    check.scan_font_files([("web", nm)], {"family": [EXCALI]}, rep)
    assert len(rep.failures) == 1 and "Mystery" in rep.failures[0] and "dist/dev" in rep.failures[0]


@pytest.mark.parametrize("rel, text", [
    ("web/src/Shell.tsx", 'const css = `<link href="https://fonts.googleapis.com/css2?family=Comic+Neue:wght@400">`'),
    ("svc/render.py", 'HEAD = \'<link href="https://fonts.googleapis.com/css2?family=Geist:wght@500&family=Comic+Neue">\''),
])
def test_an_unlisted_google_font_link_fails(tmp_path, rel, text):
    geist = {"name": "Geist", "shipped_by": "fonts.googleapis.com", "licence": "OFL-1.1", "source_url": "x"}
    fails = cheap(mini_repo(tmp_path, {rel: text}, fonts=[geist]))
    assert [f for f in fails if "Comic Neue" in f] and not [f for f in fails if "'Geist'" in f]


def test_a_tracked_font_file_without_an_entry_fails(tmp_path):
    fails = cheap(mini_repo(tmp_path, {"web/public/Odd-Regular.ttf": b"\x00\x01"}))
    assert any("tracked font file" in f for f in fails)


# ---- binaries --------------------------------------------------------------------------
FF = {"name": "ffmpeg", "version": "7.0.2", "url": "https://example.com/ffmpeg-7.0.2.tar.xz",
      "sha256": "b" * 64, "mirror_path": "build/ffmpeg-7.0.2.tar.xz", "licence": "GPL-3.0-or-later",
      "tier": "server", "used_by": ["build-layer.sh"], "pin_script": "build-layer.sh", "pin_prefix": "FFMPEG",
      "reason": "server only", "approved_by": "Shrey"}
SCRIPT = ('FFMPEG_VERSION=7.0.2\nFFMPEG_URL="https://example.com/ffmpeg-${FFMPEG_VERSION}.tar.xz"\n'
          f'FFMPEG_SHA256={"b" * 64}\nFFMPEG_MIRROR_PATH="build/ffmpeg-${{FFMPEG_VERSION}}.tar.xz"\n'
          'echo "$FFMPEG_SHA256  f" | sha256sum -c -\n')


def test_a_pinned_binary_matching_its_script_passes(tmp_path):
    assert cheap(mini_repo(tmp_path, {"build-layer.sh": SCRIPT}, binaries=[FF])) == []


@pytest.mark.parametrize("script, needle", [
    (SCRIPT.replace("b" * 64, "c" * 64), "FFMPEG_SHA256"),
    (SCRIPT.replace("example.com", "other.example"), "FFMPEG_URL"),
    ('curl -o f https://example.com/ffmpeg-release.tar.xz\n', "FFMPEG_VERSION"),   # unpinned
    (SCRIPT.replace("sha256sum -c", "true"), "without `sha256sum -c`"),
])
def test_an_unpinned_or_mismatched_binary_fails(tmp_path, script, needle):
    fails = cheap(mini_repo(tmp_path, {"build-layer.sh": script}, binaries=[FF]))
    assert any(needle in f for f in fails), fails


def test_server_copyleft_binary_needs_a_person_and_runtime_images_must_be_listed(tmp_path):
    fails = cheap(mini_repo(tmp_path, {"build-layer.sh": SCRIPT, "Dockerfile": "FROM alpine:3 AS b\nFROM debian:bookworm-slim\n"},
                            binaries=[{**FF, "approved_by": "an agent"}]))
    assert any("needs a reason and approved_by" in f for f in fails)
    assert any("debian:bookworm-slim is not in" in f for f in fails)


# ---- the approval guard (pre-push) and the policy diff ---------------------------------
def test_exception_with_no_person_approval_is_refused(tmp_path):
    repo = mini_repo(tmp_path)
    base = git(repo, "rev-parse", "HEAD").strip()
    pol = repo / "licences" / "policy.toml"
    pol.write_text(pol.read_text() + toml_dump({"exception": [EXC]}).lstrip())
    git(repo, "commit", "-qam", "add an exception")
    head = git(repo, "rev-parse", "HEAD").strip()
    assert "need a person's approval" in check.approval_guard(repo, base, head, None)[0]
    assert "not one of approvers" in check.approval_guard(repo, base, head, "claude")[0]
    assert check.approval_guard(repo, base, head, "Shrey") == []
    pol.write_text(pol.read_text().replace('approved_by = "Shrey"', 'approved_by = "Sai"'))
    git(repo, "commit", "-qam", "approved by someone else")
    assert "says approved_by 'Sai'" in check.approval_guard(repo, head, git(repo, "rev-parse", "HEAD").strip(), "Shrey")[0]
    md = check.policy_diff_markdown(repo, base)
    assert "psycopg" in md and "approved by Sai" in md


def _hook_repo(tmp_path: Path) -> tuple[Path, str]:
    repo = mini_repo(tmp_path, {"README": "x"})
    for rel in (".githooks/pre-push", "scripts/licences/check.py"):
        (repo / rel).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(REPO / rel, repo / rel)
    git(repo, "add", "-A")
    git(repo, "commit", "-qm", "tools")
    return repo, git(repo, "rev-parse", "HEAD").strip()


def _push(repo: Path, base: str, env: dict) -> subprocess.CompletedProcess:
    head = git(repo, "rev-parse", "HEAD").strip()
    line = f"refs/heads/feat/x {head} refs/heads/feat/x {base}\n"
    return subprocess.run([str(repo / ".githooks" / "pre-push"), "origin", "x"], cwd=repo, input=line,
                          capture_output=True, text=True,
                          env={**os.environ, "NAPKIN_SKIP_CHECKS": "1", "NAPKIN_NO_FEATURE": "1", **env})


def test_pre_push_refuses_a_policy_change_without_napkin_licence_approved(tmp_path):
    repo, base = _hook_repo(tmp_path)
    pol = repo / "licences" / "policy.toml"
    pol.write_text(pol.read_text() + toml_dump({"exception": [EXC]}).lstrip())
    git(repo, "commit", "-qam", "exception")
    env = {k: v for k, v in os.environ.items() if k != "NAPKIN_LICENCE_APPROVED"}
    r = _push(repo, base, {**env, "NAPKIN_LICENCE_APPROVED": ""})
    assert r.returncode == 1 and "approval" in r.stdout + r.stderr
    assert _push(repo, base, {"NAPKIN_LICENCE_APPROVED": "Shrey"}).returncode == 0


def test_pre_push_ignores_pushes_that_leave_licences_alone(tmp_path):
    repo, base = _hook_repo(tmp_path)
    (repo / "README").write_text("y")
    git(repo, "commit", "-qam", "docs")
    assert _push(repo, base, {"NAPKIN_LICENCE_APPROVED": ""}).returncode == 0


# ---- check.sh routing --------------------------------------------------------------------
@pytest.mark.parametrize("path", ["Cargo.lock", "app/package-lock.json", "app/package.json", "server/uv.lock",
                                  "app/src/shell/AppRuntime.tsx", "engine/rag/new_loader.py",
                                  "licences/weights.toml", "production-tool/stitch/build-layer.sh"])
def test_check_sh_routes_lockfiles_and_code_to_the_licences_suite(tmp_path, path):
    repo = tmp_path / "r"
    (repo / "scripts").mkdir(parents=True)
    shutil.copy(REPO / "scripts" / "check.sh", repo / "scripts" / "check.sh")
    git(repo, "init", "-q", "-b", "main")
    git(repo, "add", "-A")
    git(repo, "commit", "-qm", "base")
    base = git(repo, "rev-parse", "HEAD").strip()
    f = repo / path
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text("x = 'from_pretrained'\n")
    git(repo, "add", "-A")
    git(repo, "commit", "-qm", "change")
    out = subprocess.run(["bash", "scripts/check.sh", "--list", "--range", f"{base}..HEAD"], cwd=repo,
                         capture_output=True, text=True).stdout
    assert "licences" in out.split("suites:")[-1], out


# ==== the real tree ================================================================
def test_repo_tree_passes():
    """check.py over this repository passes with the committed policy. scripts/check.sh sets
    NAPKIN_LICENCE_CHANGED on a path-picked run, so the lockfile readers run only when a
    manifest changed; CI and --all run everything."""
    changed = os.environ.get("NAPKIN_LICENCE_CHANGED")
    files = [f for f in changed.splitlines() if f] if changed is not None else None
    rep = check.run(REPO, files, out=lambda *_: None)
    assert not rep.failures, "licence gate failures:\n" + "\n".join(rep.failures)


def test_notices_list_client_packages_and_every_attribution_licence():
    """--notices: the client tier, then every CC-BY package (any tier) and font to credit."""
    pkgs = [pkg("react", "MIT", "client"), pkg("caniuse-lite", "CC-BY-4.0", "build"),
            pkg("pypdfium2", "BSD-3-Clause AND CC-BY-4.0", "server", "pypi"), pkg("srv", "MIT", "server", "pypi")]
    fonts = {"family": [{"name": "Odd", "shipped_by": "x@1", "licence": "CC-BY-4.0"},
                        {"name": "Geist", "shipped_by": "fonts.googleapis.com", "licence": "OFL-1.1"}]}
    client, credit = check.notices(pkgs, policy(), fonts).split("# Attribution required")
    assert "react" in client and "srv" not in client
    assert "caniuse-lite" in credit and "pypdfium2" in credit and "Odd" in credit
    assert "react" not in credit and "Geist" not in credit
