#!/usr/bin/env python3
"""The licence gate: every dependency, font, binary and model weight we ship or run,
checked against licences/policy.toml and the three manifests beside it.

    check.py                          the full check (what CI runs)
    check.py --changed FILE...        cheap scans always; the dependency readers only when
                                      a lockfile, manifest or licences/ file is among FILE
    check.py --approval-guard B H     the pre-push guard: licences/*.toml changed in B..H
                                      needs NAPKIN_LICENCE_APPROVED=<an approver>
    check.py --policy-diff BASE       markdown list of policy changes since BASE (CI summary)
    check.py --notices                the third-party packages of the client tier

Python 3.12 standard library only. The rule, the tiers and the file formats are in
docs/contracts/licences.md.
"""
from __future__ import annotations

import argparse
import concurrent.futures
import fnmatch
import hashlib
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
import tomllib
import urllib.request
import struct
import zipfile
import zlib
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Iterable

REPO = Path(__file__).resolve().parents[2]
CACHE = Path(os.environ.get("NAPKIN_LICENCE_CACHE") or Path.home() / ".cache" / "napkin-licences")
TIERS = ("client", "server", "build")
RANK = {"client": 3, "server": 2, "build": 1}
CRATES_IO = {"registry+https://github.com/rust-lang/crates.io-index", "sparse+https://index.crates.io/"}
NPM_REGISTRY = "https://registry.npmjs.org/"
PYPI_REGISTRY = "https://pypi.org/simple"
FONT_EXT = (".woff2", ".woff", ".ttf", ".otf")
SCAN_EXT = (".py", ".ts", ".tsx", ".js", ".mjs", ".jsx", ".html")


# ==== SPDX expressions =============================================================
class SpdxError(ValueError):
    """An expression the evaluator cannot read."""


def _tokens(text: str) -> list[str]:
    """Split an expression into ids, operators and parentheses. '/' is the legacy OR."""
    out: list[str] = []
    for raw in re.findall(r"\(|\)|/|[^\s()/]+", text):
        up = raw.upper()
        if raw == "/":
            out.append("OR")
        elif up in ("AND", "OR", "WITH"):
            out.append(up)
        else:
            out.append(raw)
    return out


def parse_spdx(text: str, aliases: dict[str, str] | None = None):
    """Parse an SPDX expression into a tree: ('id', x) | ('and', [..]) | ('or', [..]).
    A WITH exception stays on its leaf as 'Base WITH exc'. Precedence: WITH > AND > OR.
    Whole-string aliases are applied first ('Apache License 2.0'), then per-id aliases."""
    aliases = aliases or {}
    text = text.strip()
    if text in aliases:
        text = aliases[text]
    toks = _tokens(text)
    if not toks:
        raise SpdxError("empty licence expression")
    pos = 0

    def peek():
        return toks[pos] if pos < len(toks) else None

    def take():
        nonlocal pos
        if pos >= len(toks):
            raise SpdxError(f"expression ends early: {text!r}")
        pos += 1
        return toks[pos - 1]

    def primary():
        t = peek()
        if t is None:
            raise SpdxError(f"expression ends early: {text!r}")
        if t == "(":
            take()
            node = expr()
            if take() != ")":
                raise SpdxError(f"unbalanced parentheses: {text!r}")
            return node
        if t in ("AND", "OR", "WITH", ")"):
            raise SpdxError(f"unexpected {t!r} in {text!r}")
        ident = aliases.get(take(), None) or toks[pos - 1]
        if peek() == "WITH":
            take()
            exc = take() if peek() not in (None, "(", ")", "AND", "OR", "WITH") else None
            if exc is None:
                raise SpdxError(f"WITH needs an exception id: {text!r}")
            return ("id", f"{ident} WITH {exc}")
        return ("id", ident)

    def conj():
        parts = [primary()]
        while peek() == "AND":
            take()
            parts.append(primary())
        return parts[0] if len(parts) == 1 else ("and", parts)

    def expr():
        parts = [conj()]
        while peek() == "OR":
            take()
            parts.append(conj())
        return parts[0] if len(parts) == 1 else ("or", parts)

    node = expr()
    if pos != len(toks):
        raise SpdxError(f"trailing input in {text!r}")
    return node


def leaves(node) -> list[str]:
    """Every licence id in the tree, in order."""
    if node[0] == "id":
        return [node[1]]
    return [x for child in node[1] for x in leaves(child)]


def satisfy(node, ok: Callable[[str], bool]) -> list[str] | None:
    """The ids that satisfy the expression under `ok` (first allowed OR branch, all AND
    parts), or None when it cannot be satisfied."""
    kind = node[0]
    if kind == "id":
        return [node[1]] if ok(node[1]) else None
    if kind == "and":
        got: list[str] = []
        for child in node[1]:
            part = satisfy(child, ok)
            if part is None:
                return None
            got += part
        return got
    for child in node[1]:
        part = satisfy(child, ok)
        if part is not None:
            return part
    return None


# ==== policy =======================================================================
def approver_name(approved_by: str) -> str:
    """'Shrey (2026-10-13 decision)' -> 'Shrey'."""
    return (approved_by or "").split("(")[0].strip()


def _match_any(ident: str, patterns: Iterable[str]) -> bool:
    return any(fnmatch.fnmatchcase(ident, p) for p in patterns)


@dataclass
class Policy:
    raw: dict
    path: Path

    @classmethod
    def load(cls, path: Path) -> "Policy":
        with open(path, "rb") as f:
            return cls(tomllib.load(f), path)

    # -- fields --
    @property
    def approvers(self) -> list[str]:
        return list(self.raw.get("approvers", []))

    @property
    def lic(self) -> dict:
        return self.raw.get("licences", {})

    @property
    def aliases(self) -> dict[str, str]:
        return dict(self.raw.get("aliases", {}))

    @property
    def mpl_ids(self) -> list[str]:
        return list(self.raw.get("mpl", {}).get("ids", ["MPL-2.0"]))

    @property
    def mpl_registries(self) -> list[str]:
        return list(self.raw.get("mpl", {}).get("registries", ["npm"]))

    @property
    def exceptions(self) -> list[dict]:
        return list(self.raw.get("exception", []))

    @property
    def clarifications(self) -> list[dict]:
        return list(self.raw.get("clarification", []))

    @property
    def roots(self) -> dict:
        return self.raw.get("roots", {})

    @property
    def scan_exclude(self) -> list[str]:
        return list(self.raw.get("scan", {}).get("exclude", []))

    @property
    def own_licences(self) -> list[str]:
        return list(self.raw.get("scan", {}).get("own_licences", ["MPL-2.0"]))

    # -- rules --
    def is_denied(self, ident: str) -> bool:
        base = ident.split(" WITH ")[0]
        return _match_any(base, self.lic.get("denied", [])) or _match_any(ident, self.lic.get("denied", []))

    def is_copyleft(self, ident: str) -> bool:
        return _match_any(ident.split(" WITH ")[0], self.lic.get("copyleft", []))

    def is_permissive(self, ident: str) -> bool:
        if ident in self.lic.get("permissive", []):
            return True
        if " WITH " in ident:
            base, exc = ident.split(" WITH ", 1)
            return base in self.lic.get("permissive", []) and exc in self.lic.get("with_exceptions", [])
        return False

    def allowed(self, ident: str, tier: str, source: str = "") -> bool:
        """Whether one id is allowed for a tier without an exception. MPL ids are allowed
        in any tier only from a registry named in [mpl].registries (unmodified is checked
        tree-wide by the vendored scan)."""
        if self.is_denied(ident):
            return False
        if ident in self.mpl_ids:
            return source in self.mpl_registries
        if self.is_permissive(ident):
            return True
        if tier == "build" and ident in self.lic.get("build", []):
            return True
        if tier == "font" and ident in self.lic.get("fonts", []):
            return True
        if tier == "weights" and ident in self.lic.get("weights", []):
            return True
        return False

    def known_ids(self) -> set[str]:
        ids = set(self.aliases.values()) | set(self.mpl_ids)
        for key in ("permissive", "copyleft", "build", "fonts", "weights"):
            ids |= set(self.lic.get(key, []))
        return ids

    def denied_marker(self, text: str) -> str | None:
        for m in self.lic.get("denied_markers", []):
            if m.lower() in text.lower():
                return m
        return None

    def validate(self) -> list[str]:
        """Structural problems in policy.toml itself."""
        errs = []
        if not self.approvers:
            errs.append("policy.toml: `approvers` is empty")
        for key in ("permissive", "copyleft", "denied", "denied_markers"):
            if not self.lic.get(key):
                errs.append(f"policy.toml: [licences].{key} is missing")
        need = ("package", "ecosystem", "version", "tier", "licence", "reason", "approved_by", "date")
        for e in self.exceptions:
            label = f"exception {e.get('package')}@{e.get('version')}"
            missing = [k for k in need if not str(e.get(k, "")).strip()]
            if missing:
                errs.append(f"policy.toml: {label} lacks {', '.join(missing)}")
                continue
            if approver_name(e["approved_by"]) not in self.approvers:
                errs.append(f"policy.toml: {label} approved_by {e['approved_by']!r} is not one of "
                            f"approvers {self.approvers}")
            if e["tier"] not in TIERS:
                errs.append(f"policy.toml: {label} tier {e['tier']!r} is not one of {TIERS}")
            if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(e["date"])):
                errs.append(f"policy.toml: {label} date {e['date']!r} is not YYYY-MM-DD")
            if self.denied_marker(e["licence"]):
                errs.append(f"policy.toml: {label} excepts a denied licence ({e['licence']}); "
                            f"no exception can allow it")
                continue
            try:
                ids = leaves(parse_spdx(e["licence"], self.aliases))
            except SpdxError as x:
                errs.append(f"policy.toml: {label} licence: {x}")
                continue
            if any(self.is_denied(i) for i in ids):
                errs.append(f"policy.toml: {label} excepts a denied licence ({e['licence']}); "
                            f"no exception can allow it")
            if e["tier"] == "client" and any(self.is_copyleft(i) for i in ids):
                errs.append(f"policy.toml: {label} puts copyleft ({e['licence']}) in the client "
                            f"tier; copyleft never ships to clients")
        cneed = ("package", "ecosystem", "version", "licence", "licence_file", "licence_file_sha256", "reason")
        for c in self.clarifications:
            missing = [k for k in cneed if not str(c.get(k, "")).strip()]
            if missing:
                errs.append(f"policy.toml: clarification {c.get('package')}@{c.get('version')} "
                            f"lacks {', '.join(missing)}")
        return errs


# ==== packages =====================================================================
@dataclass
class Pkg:
    ecosystem: str          # npm | cargo | pypi
    name: str
    version: str
    licence: str | None
    tier: str               # client | server | build
    root: str               # where it was found, e.g. "npm:app"
    source: str             # npm | crates.io | pypi | git:<url> | path:<p> | url:<u>
    via: str = ""
    archive: str | None = None

    @property
    def key(self):
        return (self.ecosystem, self.name, self.version)


def merge(pkgs: Iterable[Pkg]) -> list[Pkg]:
    """One record per (ecosystem, name, version): the highest tier wins."""
    best: dict[tuple, Pkg] = {}
    for p in pkgs:
        cur = best.get(p.key)
        if cur is None or RANK[p.tier] > RANK[cur.tier]:
            best[p.key] = p
    return sorted(best.values(), key=lambda p: p.key)


# ---- npm ---------------------------------------------------------------------------
def _npm_name(key: str) -> str:
    return key.rsplit("node_modules/", 1)[-1]


def npm_packages(root: Path, tier: str, label: str) -> list[Pkg]:
    """package-lock.json v3: prod packages take `tier`, dev ones the build tier.
    devOptional (dev, and optional for a prod package) can install in production, so it
    counts as prod. Links and workspace folders are first party and skipped."""
    lock = json.loads((root / "package-lock.json").read_text())
    if lock.get("lockfileVersion", 0) < 2:
        raise SystemExit(f"{root}/package-lock.json: lockfileVersion {lock.get('lockfileVersion')} "
                         f"has no 'packages' map; run npm install with npm >= 7")
    packages = lock["packages"]
    via = _npm_via(packages)
    out = []
    for key, meta in packages.items():
        if key == "" or meta.get("link") or "node_modules/" not in key:
            continue
        resolved = meta.get("resolved") or ""
        source = "npm" if resolved.startswith(NPM_REGISTRY) else (
            "git:" + resolved if resolved.startswith("git") else "url:" + resolved)
        out.append(Pkg("npm", _npm_name(key), meta.get("version", "?"), meta.get("license"),
                       "build" if meta.get("dev") else tier, label, source,
                       via=via.get(key, key), archive=resolved or None))
    return out


def _npm_via(packages: dict) -> dict[str, str]:
    """Shortest dependency chain from the root to each installed key (node resolution)."""
    def resolve(name: str, frm: str) -> str | None:
        base = frm
        while True:
            cand = (base + "/" if base else "") + "node_modules/" + name
            if cand in packages:
                return cand
            if not base:
                return None
            cut = base.rfind("/node_modules/")
            base = base[:cut] if cut >= 0 else ""

    chains = {"": [packages.get("", {}).get("name", "(root)")]}
    queue = [""]
    while queue:
        cur = queue.pop(0)
        meta = packages.get(cur, {})
        deps = {**meta.get("dependencies", {}), **meta.get("optionalDependencies", {}),
                **meta.get("peerDependencies", {}), **(meta.get("devDependencies", {}) if cur == "" else {})}
        for name in deps:
            k = resolve(name, cur)
            if k and k not in chains:
                chains[k] = chains[cur] + [f"{name}@{packages[k].get('version', '?')}"]
                queue.append(k)
    return {k: " > ".join(v) for k, v in chains.items() if k}


# ---- cargo -------------------------------------------------------------------------
def _run(cmd: list[str], cwd: Path) -> str:
    r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit(f"{' '.join(cmd)} failed in {cwd}:\n{r.stderr.strip()}")
    return r.stdout


def cargo_metadata(ws: Path) -> dict:
    return json.loads(_run(["cargo", "metadata", "--locked", "--format-version", "1"], ws))


def cargo_tree(ws: Path, package: str, target: str) -> list[tuple[str, str]]:
    """(name, version) of every crate a root links for a target: normal edges only, no
    proc macros, features resolved for this root alone."""
    out = _run(["cargo", "tree", "--locked", "-e", "normal,no-proc-macro", "-p", package,
                "--target", target, "--prefix", "none", "--format", "{p}"], ws)
    got = []
    for line in out.splitlines():
        m = re.match(r"^(\S+) v(\S+)", line.strip())
        if m:
            got.append((m.group(1), m.group(2)))
    return got


def rust_tiers(ws: Path, roots: list[dict], meta: dict | None = None) -> dict[tuple[str, str], tuple[str, str]]:
    """(name, version) -> (tier, root) for every package in the lock: each root's tree at
    its tier, everything else (proc macros, build and dev dependencies) build."""
    meta = meta or cargo_metadata(ws)
    tiers: dict[tuple[str, str], tuple[str, str]] = {}
    for r in roots:
        for t in r.get("targets", ["all"]):
            for nv in cargo_tree(ws, r["package"], t):
                cur = tiers.get(nv)
                if cur is None or RANK[r["tier"]] > RANK[cur[0]]:
                    tiers[nv] = (r["tier"], f"cargo:{r['package']}@{t}")
    for p in meta["packages"]:
        tiers.setdefault((p["name"], p["version"]), ("build", "cargo:workspace"))
    return tiers


def cargo_packages(ws: Path, roots: list[dict]) -> tuple[list[Pkg], list[str]]:
    """Third-party crates with their tiers, and problems with our own crates (a workspace
    member with no licence)."""
    meta = cargo_metadata(ws)
    tiers = rust_tiers(ws, roots, meta)
    members = set(meta["workspace_members"])
    problems, out = [], []
    for p in meta["packages"]:
        if p["id"] in members:
            if not p.get("license") and not p.get("license_file"):
                problems.append(f"cargo: workspace crate {p['name']} declares no licence "
                                f"(add `license.workspace = true` to {Path(p['manifest_path']).relative_to(ws)})")
            continue
        src = p.get("source")
        source = ("crates.io" if src in CRATES_IO else
                  "git:" + src if src and src.startswith("git+") else
                  "path:" + str(Path(p["manifest_path"]).parent) if src is None else "url:" + src)
        tier, root = tiers.get((p["name"], p["version"]), ("build", "cargo:workspace"))
        archive = (f"https://static.crates.io/crates/{p['name']}/{p['name']}-{p['version']}.crate"
                   if source == "crates.io" else None)
        out.append(Pkg("cargo", p["name"], p["version"], p.get("license"), tier, root, source,
                       via=root, archive=archive))
    return out, problems


# ---- python (uv.lock + PyPI metadata) ------------------------------------------------
def _uv_source(src: dict) -> str:
    if "registry" in src:
        return "pypi" if src["registry"].rstrip("/") == PYPI_REGISTRY else "url:" + src["registry"]
    for k in ("git", "url", "path", "directory", "editable", "virtual"):
        if k in src:
            return f"{'git' if k == 'git' else 'path' if k in ('path', 'directory', 'editable', 'virtual') else 'url'}:{src[k]}"
    return "unknown"


def uv_packages(root: Path, tier: str, label: str) -> list[Pkg]:
    """uv.lock: the project's runtime closure (every extra included) takes `tier`, its
    dependency groups the build tier. Markers are ignored: every platform counts."""
    with open(root / "uv.lock", "rb") as f:
        lock = tomllib.load(f)
    pkgs = lock.get("package", [])
    by_name: dict[str, list[dict]] = {}
    for p in pkgs:
        by_name.setdefault(p["name"], []).append(p)
    first_party = [p for p in pkgs if any(k in p.get("source", {}) for k in ("virtual", "editable"))
                   or ("directory" in p.get("source", {}) and _inside_repo(root, p["source"]["directory"]))]
    fp_names = {p["name"] for p in first_party}
    roots = [p for p in first_party if p.get("source", {}).get("virtual") == "." or
             p.get("source", {}).get("editable") == "."]

    def walk(entries: list[dict], seen: dict[tuple, list[str]], chain: list[str]):
        stack = [(e, chain) for e in entries]
        while stack:
            e, ch = stack.pop()
            cands = by_name.get(e["name"], [])
            if "version" in e:
                cands = [c for c in cands if c["version"] == e["version"]] or cands
            for c in cands:
                k = (c["name"], c["version"])
                extras = tuple(sorted(e.get("extra", [])))
                if (k, extras) in seen:
                    continue
                seen[(k, extras)] = ch + [f"{c['name']}@{c['version']}"]
                nxt = list(c.get("dependencies", []))
                for x in extras:
                    nxt += c.get("optional-dependencies", {}).get(x, [])
                stack += [(n, seen[(k, extras)]) for n in nxt]

    run: dict[tuple, list[str]] = {}
    dev: dict[tuple, list[str]] = {}
    for r in roots:
        walk(list(r.get("dependencies", [])) +
             [d for ds in r.get("optional-dependencies", {}).values() for d in ds], run, [r["name"]])
        walk([d for ds in r.get("dev-dependencies", {}).values() for d in ds], dev, [r["name"] + " (dev)"])
    run_keys = {k for k, _ in run}
    out: dict[tuple, Pkg] = {}
    for table, t in ((run, tier), (dev, "build")):
        for (k, _), ch in table.items():
            if k[0] in fp_names or (t == "build" and k in run_keys) or k in out:
                continue
            p = next(c for c in by_name[k[0]] if c["version"] == k[1])
            src = _uv_source(p.get("source", {}))
            archive = ((p.get("wheels") or [{}])[0].get("url") or (p.get("sdist") or {}).get("url"))
            out[k] = Pkg("pypi", k[0], k[1], None, t, label, src, via=" > ".join(ch), archive=archive)
    return list(out.values())


def _inside_repo(root: Path, rel: str) -> bool:
    try:
        (root / rel).resolve().relative_to(REPO)
        return True
    except ValueError:
        return False


CLASSIFIERS = {
    "MIT License": "MIT", "MIT No Attribution License (MIT-0)": "MIT-0",
    "Apache Software License": "Apache-2.0", "BSD License": "LicenseRef-BSD-unspecified",
    "ISC License (ISCL)": "ISC", "Python Software Foundation License": "PSF-2.0",
    "Mozilla Public License 2.0 (MPL 2.0)": "MPL-2.0",
    "GNU Lesser General Public License v3 (LGPLv3)": "LGPL-3.0-only",
    "GNU Lesser General Public License v3 or later (LGPLv3+)": "LGPL-3.0-or-later",
    "GNU General Public License v3 (GPLv3)": "GPL-3.0-only",
    "GNU Affero General Public License v3": "AGPL-3.0-only",
    "The Unlicense (Unlicense)": "Unlicense", "Historical Permission Notice and Disclaimer (HPND)": "HPND",
    "Zope Public License": "ZPL-2.1", "zlib/libpng License": "Zlib",
    "CMU License (MIT-CMU)": "MIT-CMU", "Boost Software License 1.0 (BSL-1.0)": "BSL-1.0",
    "Public Domain": "LicenseRef-Public-Domain", "Other/Proprietary License": "LicenseRef-Proprietary",
}


def pypi_licence(info: dict, known: set[str], aliases: dict[str, str]) -> str | None:
    """The licence of a PyPI release from its JSON metadata: license_expression; else a
    short `license` whose ids are all known to the policy (after aliases); else the
    classifiers joined with AND; else the raw `license` text (which then fails, naming
    itself, until an alias or clarification covers it). None when there is nothing."""
    expr = (info.get("license_expression") or "").strip()
    if expr:
        return expr
    lic = (info.get("license") or "").strip()
    if lic in aliases:
        return lic
    if lic and len(lic) <= 100 and "\n" not in lic:
        try:
            if all(i.split(" WITH ")[0] in known for i in leaves(parse_spdx(lic, aliases))):
                return lic
        except SpdxError:
            pass
    cls = [c.split(" :: ")[-1] for c in info.get("classifiers") or [] if c.startswith("License :: ")]
    mapped = sorted({CLASSIFIERS.get(c, f"LicenseRef-classifier-{re.sub(r'[^A-Za-z0-9.]+', '-', c)}") for c in cls})
    if mapped:
        return " AND ".join(mapped)
    return " ".join(lic.split())[:200] or None


def pypi_info(name: str, version: str) -> dict:
    """PyPI JSON metadata for one exact release, cached by name and version."""
    path = CACHE / "pypi" / f"{name.lower()}-{version}.json"
    if path.is_file():
        return json.loads(path.read_text())
    url = f"https://pypi.org/pypi/{name}/{version}/json"
    last = None
    for _ in range(3):
        try:
            with urllib.request.urlopen(url, timeout=30) as r:
                info = json.load(r)["info"]
            break
        except Exception as e:      # noqa: BLE001 - retried, then reported
            last = e
    else:
        raise SystemExit(f"PyPI metadata for {name}=={version} unavailable: {last}")
    keep = {k: info.get(k) for k in ("license", "license_expression", "classifiers")}
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(keep))
    return keep


def fill_pypi_licences(pkgs: list[Pkg], policy: "Policy",
                       fetch: Callable[[str, str], dict] = pypi_info) -> None:
    todo = [p for p in pkgs if p.ecosystem == "pypi" and p.licence is None and p.source == "pypi"]
    with concurrent.futures.ThreadPoolExecutor(16) as ex:
        for p, info in zip(todo, ex.map(lambda p: fetch(p.name, p.version), todo)):
            p.licence = pypi_licence(info, policy.known_ids(), policy.aliases)


# ==== judging ======================================================================
class _HttpRange(io.RawIOBase):
    """A seekable read-only view of a URL through HTTP Range requests, so a licence file
    can be read out of a large wheel (CUDA wheels are hundreds of MB) without downloading
    it: zipfile reads the central directory and then just that member."""

    def __init__(self, url: str):
        super().__init__()
        self.url, self.pos = url, 0
        with urllib.request.urlopen(urllib.request.Request(url, method="HEAD"), timeout=60) as r:
            self.size = int(r.headers["Content-Length"])

    def seekable(self):
        return True

    def readable(self):
        return True

    def tell(self):
        return self.pos

    def seek(self, off, whence=0):
        self.pos = off if whence == 0 else self.pos + off if whence == 1 else self.size + off
        return self.pos

    def readinto(self, b):
        n = min(len(b), self.size - self.pos)
        if n <= 0:
            return 0
        req = urllib.request.Request(self.url, headers={"Range": f"bytes={self.pos}-{self.pos + n - 1}"})
        with urllib.request.urlopen(req, timeout=60) as r:
            data = r.read()
        b[:len(data)] = data
        self.pos += len(data)
        return len(data)


def _archive_member(url: str, member: str) -> bytes:
    """One file from a package archive (npm .tgz, .crate, wheel, sdist), cached by URL
    and member. Wheels are read by HTTP range; other archives are downloaded."""
    path = CACHE / "archives" / hashlib.sha256(f"{url}\0{member}".encode()).hexdigest()
    if path.is_file():
        return path.read_bytes()
    if url.endswith(".whl") or url.endswith(".zip"):
        with zipfile.ZipFile(io.BufferedReader(_HttpRange(url), buffer_size=1 << 16)) as z:
            data = z.read(member)
    else:
        with urllib.request.urlopen(url, timeout=60) as r:
            blob = r.read()
        with tarfile.open(fileobj=io.BytesIO(blob)) as t:
            f = t.extractfile(member)
            if f is None:
                raise KeyError(member)
            data = f.read()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return data


@dataclass
class Report:
    failures: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    used_exceptions: set[int] = field(default_factory=set)
    used_clarifications: set[int] = field(default_factory=set)

    def fail(self, msg: str):
        self.failures.append(msg)


def _fix_exception(p: Pkg, lic: str) -> str:
    return (f"      [[exception]]\n      package = \"{p.name}\"\n      ecosystem = \"{p.ecosystem}\"\n"
            f"      version = \"{p.version}\"\n      tier = \"{p.tier}\"\n      licence = \"{lic}\"\n"
            f"      reason = \"<why it is needed and why it never ships to clients>\"\n"
            f"      approved_by = \"<a name in approvers; a person approves>\"\n      date = \"YYYY-MM-DD\"")


def _fix_clarification(p: Pkg) -> str:
    return (f"      [[clarification]]\n      package = \"{p.name}\"\n      ecosystem = \"{p.ecosystem}\"\n"
            f"      version = \"{p.version}\"\n      licence = \"<SPDX id read from the licence file>\"\n"
            f"      licence_file = \"<path inside the package archive>\"\n"
            f"      licence_file_sha256 = \"<sha256 of that file>\"\n      reason = \"<what the metadata lacks>\"")


def _same_licence(text: str, node, policy: Policy) -> bool:
    try:
        return parse_spdx(text, policy.aliases) == node
    except SpdxError:
        return False


def judge(pkgs: list[Pkg], policy: Policy, report: Report,
          member: Callable[[str, str], bytes] = _archive_member) -> None:
    """Every package against the policy. Failures name the package, tier, licence, the
    path that pulls it in and the policy lines that would fix it."""
    for p in pkgs:
        where = f"{p.ecosystem} {p.name}@{p.version} [{p.tier}] via {p.via or p.root}"
        if p.ecosystem in ("npm", "cargo", "pypi") and not (
                p.source in ("npm", "crates.io", "pypi")):
            report.fail(f"{where}: installed from {p.source}, not a registry; third-party code must "
                        f"come unmodified from its registry")
            continue
        lic = p.licence
        for i, c in enumerate(policy.clarifications):
            if (c["package"], c["ecosystem"], str(c["version"])) == (p.name, p.ecosystem, p.version):
                try:
                    got = hashlib.sha256(member(p.archive or "", c["licence_file"])).hexdigest()
                except Exception as e:  # noqa: BLE001
                    report.fail(f"{where}: clarification's licence file {c['licence_file']} unreadable ({e})")
                    break
                if got != c["licence_file_sha256"]:
                    report.fail(f"{where}: clarification's licence file {c['licence_file']} has sha256 "
                                f"{got}, not {c['licence_file_sha256']}; re-read the licence")
                    break
                report.used_clarifications.add(i)
                lic = p.licence = c["licence"]      # the effective licence, for --notices too
                break
        if not lic or not str(lic).strip():
            report.fail(f"{where}: no licence in its metadata\n    fix (after reading the package's "
                        f"licence file):\n{_fix_clarification(p)}")
            continue
        lic = str(lic)
        marker = policy.denied_marker(lic)
        if marker:
            report.fail(f"{where}: licence {lic!r} is denied ({marker}); no exception can allow it. "
                        f"Remove the dependency.")
            continue
        try:
            node = parse_spdx(lic, policy.aliases)
        except SpdxError as e:
            report.fail(f"{where}: licence {lic!r} is not an SPDX expression ({e})\n    fix:\n"
                        f"{_fix_clarification(p)}\n    or add an alias to [aliases]")
            continue
        if satisfy(node, lambda i: policy.allowed(i, p.tier, p.source)) is not None:
            continue
        if satisfy(node, lambda i: not policy.is_denied(i)) is None:
            report.fail(f"{where}: licence {lic!r} needs a denied id; no exception can allow it. "
                        f"Remove the dependency.")
            continue
        hit = None
        for i, e in enumerate(policy.exceptions):
            if (e["package"], e["ecosystem"], str(e["version"])) == (p.name, p.ecosystem, p.version):
                hit = (i, e)
                break
        if hit and hit[1]["tier"] == p.tier and _same_licence(hit[1]["licence"], node, policy):
            report.used_exceptions.add(hit[0])
            continue
        if hit:
            report.fail(f"{where}: licence {lic!r} — the exception for it says tier "
                        f"{hit[1]['tier']!r} and licence {hit[1]['licence']!r}; it no longer matches")
            continue
        if p.tier == "client" and satisfy(node, lambda i: not policy.is_copyleft(i) and not policy.is_denied(i)) is None:
            report.fail(f"{where}: licence {lic!r} is copyleft and this ships to clients; no exception "
                        f"can allow it. Remove or replace the dependency.")
            continue
        report.fail(f"{where}: licence {lic!r} is not allowed in the {p.tier} tier\n"
                    f"    fix: an approved exception in licences/policy.toml:\n{_fix_exception(p, lic)}")


# ==== manifests ====================================================================
def load_toml(path: Path) -> dict:
    with open(path, "rb") as f:
        return tomllib.load(f)


def tracked_files(repo: Path) -> list[str]:
    out = subprocess.run(["git", "ls-files", "-z"], cwd=repo, capture_output=True, check=True).stdout
    return [f for f in out.decode().split("\0") if f]


def excluded(path: str, patterns: list[str]) -> bool:
    return any(fnmatch.fnmatchcase(path, p) for p in patterns)


# ---- weights -----------------------------------------------------------------------
LOADER_IMPORT = re.compile(r"sentence_transformers|transformers|huggingface_hub|rembg|onnxruntime|"
                           r"@huggingface/transformers|@xenova/transformers|from_pretrained")
CALL = re.compile(r"\b(from_pretrained|SentenceTransformer|CrossEncoder|snapshot_download|"
                  r"new_session|pipeline)\s*\(\s*([^,)]*)")
CONST = re.compile(r"^\s*(?:export\s+)?(?:const\s+|let\s+)?(_?DEFAULT_MODEL|_?MODEL|[A-Z_]*MODEL_NAME)\s*(?::\s*\w+\s*)?=\s*"
                   r"(?:os\.environ\.get\(\s*['\"][^'\"]*['\"]\s*,\s*)?['\"]([^'\"]+)['\"]", re.M)
HF_ID = re.compile(r"^[A-Za-z0-9][\w.-]*/[\w.-]+$")
STR = re.compile(r"^\s*['\"]([^'\"]+)['\"]\s*$")


def scan_model_ids(repo: Path, files: list[str]) -> tuple[list[tuple[str, int, str]], list[str]]:
    """Model ids named in code that loads local weights: string arguments of the loader
    calls, the names they pass when those resolve to a constant in the file, and MODEL /
    DEFAULT_MODEL constants (including os.environ.get defaults). Also returns problems:
    a rembg new_session() with no model name."""
    found, problems = [], []
    for rel in files:
        if not rel.endswith(SCAN_EXT[:-1]):
            continue
        try:
            text = (repo / rel).read_text(errors="replace")
        except OSError:
            continue
        if not LOADER_IMPORT.search(text):
            continue
        consts = {m.group(1): m.group(2) for m in CONST.finditer(text)}
        for m in CONST.finditer(text):
            if HF_ID.match(m.group(2)):
                found.append((rel, text.count("\n", 0, m.start()) + 1, m.group(2)))
        for m in CALL.finditer(text):
            fn, arg = m.group(1), m.group(2).strip()
            line = text.count("\n", 0, m.start()) + 1
            s = STR.match(arg)
            if fn == "new_session":
                # rembg: the model is the first argument or model_name=; its default and
                # several of its models are CC BY-NC, so the name must be explicit and listed.
                if arg.startswith("model_name"):
                    arg = arg.split("=", 1)[1].strip()
                    s = STR.match(arg)
                name = s.group(1) if s else consts.get(arg)
                if not name:
                    problems.append(f"{rel}:{line}: rembg new_session() with no model name (or one the "
                                    f"gate cannot read); its default and several of its models are "
                                    f"CC BY-NC, so pass a model listed in licences/weights.toml")
                else:
                    found.append((rel, line, name))
                continue
            if fn == "pipeline":
                rest = text[m.end():m.end() + 200]
                s2 = re.match(r"\s*,\s*['\"]([^'\"]+)['\"]", rest)
                if s2 and HF_ID.match(s2.group(1)):
                    found.append((rel, line, s2.group(1)))
                continue
            if s and HF_ID.match(s.group(1)):
                found.append((rel, line, s.group(1)))
            elif arg in consts and HF_ID.match(consts[arg]):
                found.append((rel, line, consts[arg]))
    return found, problems


def check_weights(manifest: dict, policy: Policy, found: list[tuple[str, int, str]], report: Report) -> None:
    need = ("id", "source", "revision", "files", "weight_licence", "code_licence", "model_card_url",
            "tier", "used_by", "approved_by")
    ids = set()
    for m in manifest.get("model", []):
        label = f"weights.toml model {m.get('id')}"
        missing = [k for k in need if not m.get(k)]
        if missing:
            report.fail(f"{label}: lacks {', '.join(missing)}")
            continue
        ids.add(m["id"])
        for f in m["files"]:
            if not f.get("path") or not re.fullmatch(r"[0-9a-f]{64}", f.get("sha256", "")):
                report.fail(f"{label}: file entry {f} needs a path and a sha256")
        if approver_name(m["approved_by"]) not in policy.approvers:
            report.fail(f"{label}: approved_by {m['approved_by']!r} is not one of approvers {policy.approvers}")
        for key in ("weight_licence", "code_licence"):
            val = m[key]
            if key == "code_licence" and val == "none":
                continue
            marker = policy.denied_marker(val)
            try:
                node = parse_spdx(val, policy.aliases)
            except SpdxError as e:
                report.fail(f"{label}: {key} {val!r}: {e}")
                continue
            if marker or satisfy(node, lambda i: policy.allowed(i, "weights", "")) is None:
                report.fail(f"{label}: {key} {val!r} is not allowed for weights (non-commercial and "
                            f"source-available licences never are)")
    for rel, line, mid in found:
        if mid not in ids:
            report.fail(f"{rel}:{line}: model {mid} is not in licences/weights.toml\n    fix: add a "
                        f"[[model]] entry with its weight licence, revision and file hashes, approved by a person")


# ---- fonts -------------------------------------------------------------------------
GFONTS = re.compile(r"fonts\.googleapis\.com/css2?\?([^\"'\s>)]*)")


# ---- the licence embedded in a font file ---------------------------------------------
# The name table: 0 copyright, 13 licence description, 14 licence URL. A shipped file's own
# text is what reaches users, so the gate reads it and compares it with fonts.toml. WOFF2
# needs Brotli, which the standard library lacks: the gate runs with `--with brotli`
# (check.sh, CI) and fails closed without it.
WOFF2_TAGS = ["cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post", "cvt ", "fpgm", "glyf",
              "loca", "prep", "CFF ", "VORG", "EBDT", "EBLC", "gasp", "hdmx", "kern", "LTSH", "PCLT",
              "VDMX", "vhea", "vmtx", "BASE", "GDEF", "GPOS", "GSUB", "EBSC", "JSTF", "MATH", "CBDT",
              "CBLC", "COLR", "CPAL", "SVG ", "sbix", "acnt", "avar", "bdat", "bloc", "bsln", "cvar",
              "fdsc", "feat", "fmtx", "fvar", "gvar", "hsty", "just", "lcar", "mort", "morx", "opbd",
              "prop", "trak", "Zapf", "Silf", "Glat", "Gloc", "Feat", "Sill"]


class FontError(ValueError):
    """A font file the gate cannot read."""


def _b128(data: bytes, pos: int) -> tuple[int, int]:
    val = 0
    for i in range(5):
        b = data[pos + i]
        val = (val << 7) | (b & 0x7F)
        if not b & 0x80:
            return val, pos + i + 1
    raise FontError("bad UIntBase128")


def _name_table(data: bytes) -> bytes:
    """The raw 'name' table of a TTF/OTF, WOFF or WOFF2 file."""
    sig = data[:4]
    if sig == b"wOF2":
        num = struct.unpack(">H", data[12:14])[0]
        comp_len = struct.unpack(">I", data[20:24])[0]
        pos, entries = 48, []
        for _ in range(num):
            flags = data[pos]; pos += 1
            if flags & 0x3F == 63:
                tag = data[pos:pos + 4].decode("latin-1"); pos += 4
            else:
                tag = WOFF2_TAGS[flags & 0x3F]
            orig, pos = _b128(data, pos)
            ver = flags >> 6
            length = orig
            if (tag in ("glyf", "loca") and ver == 0) or (tag not in ("glyf", "loca") and ver != 0):
                length, pos = _b128(data, pos)
            entries.append((tag, length))
        try:
            import brotli  # type: ignore[import-not-found]
        except ImportError as e:
            raise FontError("reading WOFF2 needs brotli: run the gate with `uv run --with brotli`") from e
        blob = brotli.decompress(data[pos:pos + comp_len])
        off = 0
        for tag, length in entries:
            if tag == "name":
                return blob[off:off + length]
            off += length
        raise FontError("no name table")
    if sig == b"wOFF":
        num = struct.unpack(">H", data[12:14])[0]
        for i in range(num):
            tag, off, clen, olen, _ = struct.unpack(">4sIIII", data[44 + 20 * i:64 + 20 * i])
            if tag == b"name":
                raw = data[off:off + clen]
                return zlib.decompress(raw) if clen < olen else raw
        raise FontError("no name table")
    if sig in (b"\x00\x01\x00\x00", b"OTTO", b"true"):
        num = struct.unpack(">H", data[4:6])[0]
        for i in range(num):
            tag, _, off, length = struct.unpack(">4sIII", data[12 + 16 * i:28 + 16 * i])
            if tag == b"name":
                return data[off:off + length]
        raise FontError("no name table")
    raise FontError(f"not a font file (signature {sig!r})")


def font_names(data: bytes) -> dict[int, str]:
    """nameID -> text (Windows/Unicode records preferred over Mac)."""
    t = _name_table(data)
    count, str_off = struct.unpack(">HH", t[2:6])
    out: dict[int, str] = {}
    for i in range(count):
        plat, enc, lang, nid, length, off = struct.unpack(">HHHHHH", t[6 + 12 * i:18 + 12 * i])
        raw = t[str_off + off:str_off + off + length]
        text = raw.decode("utf-16-be", "replace") if plat in (0, 3) else raw.decode("mac_roman", "replace")
        if nid not in out or plat in (0, 3):
            out[nid] = text
    return out


OFL_HINTS = ("open font license", "scripts.sil.org/ofl", "openfontlicense.org")
RESTRICTIVE = ("supplied font", "other use is prohibited", "may only", "subject to the license agreement",
               "all rights reserved. no", "personal use", "non-commercial", "evaluation")


def embedded_licence(names: dict[int, str]) -> str:
    """What a font file says about its own licence: an SPDX id, 'none' when it says
    nothing, or 'unknown: <text>' when it says something the gate does not recognise.
    The licence description (13) wins over the URL (14), which wins over the copyright (0)."""
    desc, url, cr = (names.get(13) or "").strip(), (names.get(14) or "").strip(), (names.get(0) or "")
    low = desc.lower()
    if "liberation font software" in low or ("ascender" in cr.lower() and "liberation" in low):
        return "GPL-2.0-only WITH Font-exception-2.0"      # Liberation 1.x (Ascender): GPLv2 + font exception
    if desc:
        # Terms that restrict use ("Microsoft supplied font ... Any other use is prohibited")
        # are never read as OFL, even when OFL-like terms follow: a person reads them.
        if any(r in low for r in RESTRICTIVE):
            return "unknown: " + " ".join(desc.split())[:120]
        if any(h in low for h in OFL_HINTS) or "reserved font name" in low and "ofl" in url.lower():
            return "OFL-1.1"
        if "mit license" in low or "permission is hereby granted" in low:
            return "MIT"
        if "apache license" in low:
            return "Apache-2.0"
        if "general public license" in low:
            return "LicenseRef-GPL-font"
        return "unknown: " + " ".join(desc.split())[:120]
    if any(h in url.lower() for h in OFL_HINTS):
        return "OFL-1.1"
    if url:
        return "unknown: " + url
    if "mit license" in cr.lower():
        return "MIT"
    return "none"


def _family_for(fonts: dict, shipped_by: str, filename: str) -> dict | None:
    for fam in fonts.get("family", []):
        if fam.get("shipped_by") == shipped_by and any(fnmatch.fnmatchcase(filename, g) for g in fam.get("files", [])):
            return fam
    return None


def _check_font_entries(fonts: dict, policy: Policy, report: Report) -> None:
    for fam in fonts.get("family", []):
        label = f"fonts.toml family {fam.get('name')}"
        missing = [k for k in ("name", "shipped_by", "licence", "source_url") if not fam.get(k)]
        if missing:
            report.fail(f"{label}: lacks {', '.join(missing)}")
            continue
        try:
            node = parse_spdx(fam["licence"], policy.aliases)
        except SpdxError as e:
            report.fail(f"{label}: {e}")
            continue
        if fam.get("replaced_by"):
            continue                       # never served: check_font_overrides proves the swap
        if satisfy(node, lambda i: policy.allowed(i, "font", "")) is None:
            report.fail(f"{label}: licence {fam['licence']!r} is not allowed for fonts")


def check_font_overrides(repo: Path, fonts: dict, report: Report) -> None:
    """A package's font file we never serve (`replaced_by`) passes only while the swap is
    real: the replacement is in the repo with the sha256 its own entry pins, the build's
    override list (fonts.toml [overrides].manifest) puts that exact file in place of the
    package's, and the build and runtime still wire it in ([overrides].requires)."""
    ov = fonts.get("overrides", {})
    replaced = [f for f in fonts.get("family", []) if f.get("replaced_by")]
    if not replaced:
        return
    man_path = repo / ov.get("manifest", "")
    if not ov.get("manifest") or not man_path.is_file():
        report.fail(f"fonts.toml: families are replaced_by files but [overrides].manifest ({ov.get('manifest')}) is missing")
        return
    manifest = json.loads(man_path.read_text())
    entries = {e["file"]: e for e in manifest.get("overrides", [])}
    for rel, marker in ov.get("requires", []):
        f = repo / rel
        if not f.is_file() or marker not in f.read_text(errors="replace"):
            report.fail(f"{rel}: no longer contains {marker!r}, so the font replacements may not reach the build; "
                        f"Excalidraw would serve its own files")
    for fam in replaced:
        rel = fam["replaced_by"]
        path = repo / rel
        label = f"fonts.toml family {fam['name']} (replaced_by {rel})"
        if not path.is_file():
            report.fail(f"{label}: the replacement file is missing")
            continue
        got = hashlib.sha256(path.read_bytes()).hexdigest()
        own = _family_for(fonts, "repo", path.name)
        if own is None or own.get("sha256") != got:
            report.fail(f"{label}: the replacement's sha256 {got} is not the one its own [[family]] "
                        f"(shipped_by = \"repo\") pins ({own.get('sha256') if own else 'no entry'})")
        entry = entries.get(path.name)
        if entry is None or entry.get("sha256") != got or not any(
                fnmatch.fnmatchcase(Path(entry.get("target", "")).name, g) for g in fam.get("files", [])):
            report.fail(f"{label}: {ov['manifest']} does not put this file (sha256 {got}) in place of "
                        f"{fam['files']}; the build would serve the package's own file")


def scan_font_files(dirs: list[tuple[str, Path]], fonts: dict, report: Report) -> None:
    """Every font file inside installed production packages must have a family entry
    whose shipped_by is that package@version and whose files glob matches."""
    missing: dict[tuple[str, str, str], list[str]] = {}
    mismatched: dict[tuple[str, str], list[str]] = {}
    for label, nm in dirs:
        for path in sorted(nm.rglob("*")):
            if not path.name.lower().endswith(FONT_EXT) or not path.is_file():
                continue
            rel = path.relative_to(nm).as_posix()
            parts = rel.split("node_modules/")[-1].split("/")
            pkg = "/".join(parts[:2]) if parts[0].startswith("@") else parts[0]
            pj = nm / rel.rsplit(pkg, 1)[0] / pkg / "package.json"
            ver = json.loads(pj.read_text()).get("version", "?") if pj.is_file() else "?"
            fam = _family_for(fonts, f"{pkg}@{ver}", path.name)
            if fam is not None and fam.get("replaced_by"):
                continue                   # not served; check_font_overrides proves the swap
            if fam is None:
                stem = re.split(r"[-.]", path.name, maxsplit=1)[0]
                missing.setdefault((label, f"{pkg}@{ver}", stem), []).append(rel)
                continue
            _check_embedded(fam, path, f"font {label}: node_modules/{rel}", mismatched)
    for (label, shipped, stem), rels in sorted(missing.items()):
        report.fail(f"font {label}: {len(rels)} file(s) like node_modules/{rels[0]} ({shipped}) have no entry "
                    f"in licences/fonts.toml\n    fix: a [[family]] with shipped_by = \"{shipped}\", "
                    f"files = [\"{stem}*\"], its licence and source_url, confirmed upstream")
    for (fam, problem), where in sorted(mismatched.items()):
        report.fail(f"{where[0]}{f' (and {len(where) - 1} more)' if len(where) > 1 else ''}: family {fam!r} "
                    f"{problem}")


def _check_embedded(fam: dict, path: Path, where: str, mismatched: dict) -> None:
    """The file's own licence text must agree with its family entry. A file that says
    nothing passes only when the entry says embedded_licence = "none" (with the evidence
    for its licence in a comment); an unrecognised or different text always fails."""
    try:
        got = embedded_licence(font_names(path.read_bytes()))
    except (FontError, struct.error, IndexError, zlib.error) as e:
        mismatched.setdefault((fam["name"], f"cannot be read ({e})"), []).append(where)
        return
    want = fam.get("embedded_licence", fam.get("licence"))
    if got != want:
        mismatched.setdefault((fam["name"], f"says {got!r} inside the file, but licences/fonts.toml expects "
                               f"{want!r}; re-read the shipped file and its upstream before changing the entry"),
                              []).append(where)


def scan_repo_fonts(repo: Path, files: list[str], fonts: dict, report: Report) -> None:
    """Tracked font files, and Google Fonts family= links in tracked code."""
    linked = {f["name"] for f in fonts.get("family", []) if f.get("shipped_by") == "fonts.googleapis.com"}
    mismatched: dict[tuple[str, str], list[str]] = {}
    for rel in files:
        if rel.lower().endswith(FONT_EXT):
            fam = _family_for(fonts, "repo", Path(rel).name)
            if fam is None:
                report.fail(f"font {rel}: a tracked font file with no [[family]] (shipped_by = \"repo\") "
                            f"entry in licences/fonts.toml")
            else:
                if fam.get("sha256") and hashlib.sha256((repo / rel).read_bytes()).hexdigest() != fam["sha256"]:
                    report.fail(f"font {rel}: sha256 differs from the {fam['sha256']} that family "
                                f"{fam['name']!r} pins; re-verify the file before changing the pin")
                _check_embedded(fam, repo / rel, f"font {rel}", mismatched)
            continue
        if not rel.endswith((".html", ".ts", ".tsx", ".py")):
            continue
        try:
            text = (repo / rel).read_text(errors="replace")
        except OSError:
            continue
        for m in GFONTS.finditer(text):
            for fam in re.findall(r"family=([^:&;]+)", m.group(1)):
                name = urllib.request.unquote(fam).replace("+", " ").strip()
                if name and "..." not in name and name not in linked:
                    line = text.count("\n", 0, m.start()) + 1
                    report.fail(f"{rel}:{line}: Google Fonts family {name!r} is not in licences/fonts.toml\n"
                                f"    fix: a [[family]] with name = \"{name}\", shipped_by = "
                                f"\"fonts.googleapis.com\", its licence and source_url")
    for (fam, problem), where in sorted(mismatched.items()):
        report.fail(f"{where[0]}: family {fam!r} {problem}")


def npm_prod_tree(root: Path) -> Path:
    """A production-only install (npm ci --omit=dev --ignore-scripts) of an npm root, in
    the cache, keyed by its lockfile's hash. Returns its node_modules."""
    lock = (root / "package-lock.json").read_bytes()
    dest = CACHE / "npm-prod" / f"{root.name}-{hashlib.sha256(lock).hexdigest()[:16]}"
    if (dest / "node_modules" / ".package-lock.json").is_file():
        return dest / "node_modules"
    shutil.rmtree(dest, ignore_errors=True)
    dest.mkdir(parents=True)
    shutil.copy(root / "package.json", dest / "package.json")
    (dest / "package-lock.json").write_bytes(lock)
    _run(["npm", "ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund", "--loglevel=error"], dest)
    (dest / "node_modules").mkdir(exist_ok=True)
    return dest / "node_modules"


# ---- binaries ----------------------------------------------------------------------
def _shell_var(text: str, name: str) -> str | None:
    m = re.search(rf"^\s*(?:readonly\s+)?{name}=['\"]?([^'\"\n]+)['\"]?", text, re.M)
    return m.group(1).strip() if m else None


def check_binaries(repo: Path, manifest: dict, policy: Policy, files: list[str], report: Report) -> None:
    need = ("name", "version", "licence", "tier", "used_by")
    images = set()
    for b in manifest.get("binary", []):
        label = f"binaries.toml {b.get('name')}"
        missing = [k for k in need if not b.get(k)]
        if missing:
            report.fail(f"{label}: lacks {', '.join(missing)}")
            continue
        if b["tier"] not in ("server", "system", "build"):
            report.fail(f"{label}: tier {b['tier']!r} must be server, system (not bundled) or build; "
                        f"binaries never ship to clients through this list")
        for u in b["used_by"]:
            if not (repo / u.split(":")[0]).exists():
                report.fail(f"{label}: used_by {u} does not exist")
        if b.get("image"):
            images.add(b["image"])
        try:
            node = parse_spdx(b["licence"], policy.aliases)
        except SpdxError as e:
            report.fail(f"{label}: {e}")
            continue
        if any(policy.is_denied(i) for i in leaves(node)) or policy.denied_marker(b["licence"]):
            report.fail(f"{label}: licence {b['licence']!r} is denied")
        elif satisfy(node, lambda i: policy.allowed(i, "build" if b["tier"] == "build" else "client", "")) is None \
                and b["tier"] == "server":
            if not b.get("reason") or approver_name(b.get("approved_by", "")) not in policy.approvers:
                report.fail(f"{label}: copyleft or unlisted licence {b['licence']!r} on the server needs a "
                            f"reason and approved_by (one of {policy.approvers})")
        elif b["tier"] == "system" and not b.get("reason"):
            report.fail(f"{label}: a system dependency needs a reason (why it is not bundled)")
        script = b.get("pin_script")
        if script:
            text = (repo / script).read_text()
            prefix = b.get("pin_prefix", b["name"].upper())
            for key, var in (("version", "VERSION"), ("url", "URL"), ("sha256", "SHA256"), ("mirror_path", "MIRROR_PATH")):
                want = b.get(key)
                got = _shell_var(text, f"{prefix}_{var}")
                if want and got is not None and "$" in got:
                    got = re.sub(r"\$\{?" + prefix + r"_VERSION\}?", b["version"], got)
                if want and got != want:
                    report.fail(f"{script}: {prefix}_{var}={got!r} but binaries.toml says {want!r}")
            if not b.get("sha256") or not re.fullmatch(r"[0-9a-f]{64}", b["sha256"]):
                report.fail(f"{label}: a pinned download needs its sha256")
            if "sha256sum -c" not in text:
                report.fail(f"{script}: downloads {b['name']} without `sha256sum -c`")
    for rel in files:
        if Path(rel).name.startswith("Dockerfile") and not excluded(rel, policy.scan_exclude):
            froms = re.findall(r"^FROM\s+(?:--platform=\S+\s+)?(\S+)", (repo / rel).read_text(), re.M)
            if froms and froms[-1] not in images:
                report.fail(f"{rel}: runtime image {froms[-1]} is not in licences/binaries.toml")


# ---- unmodified / vendored -----------------------------------------------------------
HEADER = re.compile(r"^\s*(?://+|#+|/\*+|\*+|<!--)\s*(SPDX-License-Identifier:\s*(\S[^*\n]*?)|@licen[s]e\b(.*))\s*(?:\*/|-->)?\s*$")
OFF_REGISTRY = re.compile(r"^(git\+|git:|github:|gitlab:|bitbucket:|file:|link:|https?:)")


def scan_unmodified(repo: Path, files: list[str], policy: Policy, report: Report) -> None:
    """Third-party code must arrive unmodified from its registry: no patches, no vendored
    copies, no off-registry sources."""
    for rel in files:
        if excluded(rel, policy.scan_exclude):
            continue
        parts = rel.split("/")
        if "patches" in parts[:-1]:
            report.fail(f"{rel}: a patches/ directory; third-party packages are installed unmodified")
        if rel.endswith(".min.js"):
            report.fail(f"{rel}: a vendored minified file; install it from its registry instead")
        if "vendor" in parts[:-1] or "third_party" in parts[:-1]:
            report.fail(f"{rel}: under vendor/ or third_party/; install third-party code from its registry")
        name = parts[-1]
        if name == "package.json":
            pj = json.loads((repo / rel).read_text())
            for sect in ("dependencies", "devDependencies", "optionalDependencies"):
                if "patch-package" in pj.get(sect, {}):
                    report.fail(f"{rel}: patch-package in {sect}")
            for k, v in pj.get("scripts", {}).items():
                if "patch-package" in v or (k in ("postinstall", "preinstall", "install", "prepare") and "patch" in v):
                    report.fail(f"{rel}: script {k!r} patches installed packages ({v})")
            def walk_over(o, path):
                if isinstance(o, dict):
                    for k2, v2 in o.items():
                        walk_over(v2, path + [k2])
                elif isinstance(o, str) and OFF_REGISTRY.match(o):
                    report.fail(f"{rel}: overrides {'.'.join(path)} points off the registry ({o})")
            walk_over(pj.get("overrides", {}), [])
            for sect in ("dependencies", "devDependencies", "optionalDependencies"):
                for dep, spec in pj.get(sect, {}).items():
                    if isinstance(spec, str) and OFF_REGISTRY.match(spec) and not spec.startswith("file:"):
                        report.fail(f"{rel}: {sect}.{dep} = {spec!r} is not a registry version")
        elif name == "package-lock.json":
            lock = json.loads((repo / rel).read_text())
            for key, meta in lock.get("packages", {}).items():
                if key == "" or meta.get("link") or "node_modules/" not in key:
                    continue
                res = meta.get("resolved") or ""
                if not res.startswith(NPM_REGISTRY):
                    report.fail(f"{rel}: {key} resolved from {res or '(nothing)'}, not {NPM_REGISTRY}")
                elif not meta.get("integrity"):
                    report.fail(f"{rel}: {key} has no integrity hash")
        elif name == "Cargo.toml" or rel == ".cargo/config.toml":
            data = load_toml(repo / rel)
            if "patch" in data or "replace" in data:
                report.fail(f"{rel}: a [patch]/[replace] section; crates are used unmodified from crates.io")
            if rel == ".cargo/config.toml" and "source" in data:
                report.fail(f"{rel}: a [source] replacement")
            for sect in ("dependencies", "dev-dependencies", "build-dependencies"):
                for dep, spec in {**data.get(sect, {}), **data.get("workspace", {}).get(sect, {})}.items():
                    if isinstance(spec, dict) and "git" in spec:
                        report.fail(f"{rel}: {sect}.{dep} comes from git ({spec['git']})")
        elif name == "pyproject.toml":
            data = load_toml(repo / rel)
            for dep, spec in data.get("tool", {}).get("uv", {}).get("sources", {}).items():
                specs = spec if isinstance(spec, list) else [spec]
                for s in specs:
                    if "git" in s or "url" in s:
                        report.fail(f"{rel}: [tool.uv.sources] {dep} from {s.get('git') or s.get('url')}")
                    elif "path" in s and not (repo / Path(rel).parent / s["path"] / "pyproject.toml").is_file():
                        report.fail(f"{rel}: [tool.uv.sources] {dep} from path {s['path']} (not one of our projects)")
        if name.endswith((".js", ".mjs", ".ts", ".tsx", ".jsx", ".py", ".rs", ".css", ".html", ".sh")):
            try:
                head = (repo / rel).read_text(errors="replace").splitlines()[:30]
            except OSError:
                continue
            for line in head:
                m = HEADER.match(line)
                if not m:
                    continue
                spdx = (m.group(2) or "").strip()
                if m.group(3) is not None or spdx not in policy.own_licences:
                    report.fail(f"{rel}: carries a third-party licence header ({line.strip()[:80]}); "
                                f"install it from its registry instead of copying it in")
                break


def check_engine_requirements(repo: Path, report: Report) -> None:
    """Every name in engine/requirements.txt is a core dependency in engine/pyproject.toml."""
    req, pp = repo / "engine" / "requirements.txt", repo / "engine" / "pyproject.toml"
    if not req.is_file() or not pp.is_file():
        return
    norm = lambda s: re.split(r"[<>=!~\[; ]", s.strip(), 1)[0].lower().replace("_", "-")
    core = {norm(d) for d in load_toml(pp)["project"].get("dependencies", [])}
    for line in req.read_text().splitlines():
        line = line.split("#")[0].strip()
        if line and norm(line) not in core:
            report.fail(f"engine/requirements.txt: {norm(line)} is not a core dependency in engine/pyproject.toml")


# ==== the run ======================================================================
READER_TRIGGERS = re.compile(r"(^|/)(package(-lock)?\.json|Cargo\.(toml|lock)|pyproject\.toml|uv\.lock|"
                             r"requirements[^/]*\.txt)$|^licences/|^scripts/licences/|^\.cargo/")


def run(repo: Path = REPO, changed: list[str] | None = None, *, readers: bool | None = None,
        fetch=pypi_info, member=_archive_member, install=npm_prod_tree, out=print) -> Report:
    lic_dir = repo / "licences"
    policy = Policy.load(lic_dir / "policy.toml")
    report = Report()
    for e in policy.validate():
        report.fail(e)
    files = tracked_files(repo)
    scan = [f for f in files if not excluded(f, policy.scan_exclude)]
    weights = load_toml(lic_dir / "weights.toml")
    fonts = load_toml(lic_dir / "fonts.toml")
    binaries = load_toml(lic_dir / "binaries.toml")

    # cheap scans: always
    found, problems = scan_model_ids(repo, scan)
    for p in problems:
        report.fail(p)
    check_weights(weights, policy, found, report)
    _check_font_entries(fonts, policy, report)
    scan_repo_fonts(repo, scan, fonts, report)
    check_font_overrides(repo, fonts, report)
    check_binaries(repo, binaries, policy, files, report)
    scan_unmodified(repo, files, policy, report)
    check_engine_requirements(repo, report)

    if readers is None:
        readers = changed is None or any(READER_TRIGGERS.search(f) for f in changed)
    if not readers:
        out("licences: no lockfile, manifest or licences/ change; dependency readers skipped")
        return report

    roots = policy.roots
    pkgs: list[Pkg] = []
    for r in roots.get("npm", []):
        d = repo / r["path"]
        if not (d / "package-lock.json").is_file():
            report.fail(f"policy.toml: npm root {r['path']} has no package-lock.json")
            continue
        pkgs += npm_packages(d, r["tier"], f"npm:{r['path']}")
    cargo_roots = roots.get("rust", [])
    if cargo_roots:
        cp, cprob = cargo_packages(repo, cargo_roots)
        pkgs += cp
        for p in cprob:
            report.fail(p)
    for r in roots.get("python", []):
        d = repo / r["path"]
        if not (d / "uv.lock").is_file():
            report.fail(f"policy.toml: python root {r['path']} has no uv.lock")
            continue
        pkgs += uv_packages(d, r["tier"], f"python:{r['path']}")
    pkgs = merge(pkgs)
    fill_pypi_licences(pkgs, policy, fetch)
    judge(pkgs, policy, report, member)
    for i, e in enumerate(policy.exceptions):
        if i not in report.used_exceptions:
            report.fail(f"policy.toml: exception {e.get('package')}@{e.get('version')} ({e.get('ecosystem')}) "
                        f"matches nothing in the tree; remove it")
    for i, c in enumerate(policy.clarifications):
        if i not in report.used_clarifications:
            report.fail(f"policy.toml: clarification {c.get('package')}@{c.get('version')} matches nothing; remove it")

    dirs = []
    for r in roots.get("npm", []):
        if r["tier"] == "client" and (repo / r["path"] / "package-lock.json").is_file():
            dirs.append((r["path"], install(repo / r["path"])))
    scan_font_files(dirs, fonts, report)
    report.notes.append(f"{len(pkgs)} third-party packages checked "
                        f"({sum(p.tier == 'client' for p in pkgs)} client, "
                        f"{sum(p.tier == 'server' for p in pkgs)} server, {sum(p.tier == 'build' for p in pkgs)} build)")
    report.pkgs = pkgs  # type: ignore[attr-defined]
    return report


# ==== approval guard and policy diff ===============================================
ENTRY_TABLES = {"policy.toml": ("exception", "clarification"), "weights.toml": ("model",),
                "fonts.toml": ("family",), "binaries.toml": ("binary",)}


def _git_show(repo: Path, rev: str, path: str) -> dict:
    r = subprocess.run(["git", "show", f"{rev}:{path}"], cwd=repo, capture_output=True)
    return tomllib.loads(r.stdout.decode()) if r.returncode == 0 else {}


def policy_changes(repo: Path, base: str, head: str | None) -> list[tuple[str, str, dict | str]]:
    """(file, kind, entry) for every added or changed manifest entry and every changed
    top-level setting in licences/*.toml between base and head (head None: worktree)."""
    args = ["git", "diff", "--name-only", base] + ([head] if head else []) + ["--", "licences/"]
    names = [n for n in subprocess.run(args, cwd=repo, capture_output=True, text=True).stdout.split() if n.endswith(".toml")]
    out = []
    for n in names:
        old = _git_show(repo, base, n)
        new = _git_show(repo, head, n) if head else (tomllib.loads((repo / n).read_text()) if (repo / n).is_file() else {})
        tables = ENTRY_TABLES.get(Path(n).name, ())
        for t in tables:
            for e in new.get(t, []):
                if e not in old.get(t, []):
                    out.append((n, f"added/changed {t}", e))
            for e in old.get(t, []):
                if e not in new.get(t, []):
                    out.append((n, f"removed {t}", e))
        for k in set(old) | set(new):
            if k not in tables and old.get(k) != new.get(k):
                out.append((n, f"changed [{k}]", f"{old.get(k)!r} -> {new.get(k)!r}"))
    return out


def approval_guard(repo: Path, base: str, head: str, approver: str | None) -> list[str]:
    changes = policy_changes(repo, base, head)
    if not changes:
        return []
    policy = Policy.load(repo / "licences" / "policy.toml") if head is None else Policy(
        tomllib.loads(subprocess.run(["git", "show", f"{head}:licences/policy.toml"], cwd=repo,
                                     capture_output=True, text=True).stdout), Path("policy.toml"))
    errs = []
    if not approver:
        return [f"licences/*.toml changes in {base[:9]}..{head[:9]} ({len(changes)} change(s)) need a person's "
                f"approval: NAPKIN_LICENCE_APPROVED=<name> git push (person-only; agents never set it)"]
    if approver not in policy.approvers:
        return [f"NAPKIN_LICENCE_APPROVED={approver!r} is not one of approvers {policy.approvers}"]
    for f, kind, e in changes:
        if isinstance(e, dict) and kind.startswith("added") and "approved_by" in e and approver_name(e["approved_by"]) != approver:
            errs.append(f"{f}: {kind} {e.get('package') or e.get('id') or e.get('name')} says approved_by "
                        f"{e['approved_by']!r}, but the approval given is {approver!r}")
    return errs


def policy_diff_markdown(repo: Path, base: str) -> str:
    changes = policy_changes(repo, base, None)
    if not changes:
        return "### Licence policy changes in this PR\n\nNone.\n"
    lines = ["### Licence policy changes in this PR", ""]
    for f, kind, e in changes:
        if isinstance(e, dict):
            who = e.get("approved_by", "-")
            what = e.get("package") or e.get("id") or e.get("name")
            lines.append(f"- `{f}` {kind}: **{what}** {e.get('version', '')} "
                         f"licence `{e.get('licence') or e.get('weight_licence')}` tier {e.get('tier', '-')}, approved by {who}")
        else:
            lines.append(f"- `{f}` {kind}: {e}")
    return "\n".join(lines) + "\n"


ATTRIBUTION = ("CC-BY-*",)


def notices(pkgs: list[Pkg], policy: Policy, fonts: dict) -> str:
    """Third-party notices: every client-tier package, then every package in any tier
    (and every font) whose licence requires attribution (CC-BY-*), which must be credited
    wherever that work reaches people."""
    def needs_credit(lic: str | None) -> bool:
        try:
            return bool(lic) and any(_match_any(i.split(" WITH ")[0], ATTRIBUTION)
                                     for i in leaves(parse_spdx(lic, policy.aliases)))
        except SpdxError:
            return False
    lines = ["# Client-tier third-party packages", "ecosystem\tname\tversion\tlicence"]
    lines += [f"{p.ecosystem}\t{p.name}\t{p.version}\t{p.licence}" for p in pkgs if p.tier == "client"]
    lines += ["", "# Attribution required (CC-BY): credit these in the notices of whatever ships or serves them",
              "tier\tecosystem\tname\tversion\tlicence"]
    lines += [f"{p.tier}\t{p.ecosystem}\t{p.name}\t{p.version}\t{p.licence}" for p in pkgs if needs_credit(p.licence)]
    lines += [f"font\t-\t{f['name']}\t{f.get('shipped_by', '')}\t{f['licence']}"
              for f in fonts.get("family", []) if needs_credit(f.get("licence"))]
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--changed", nargs="*", default=None, metavar="FILE")
    ap.add_argument("--approval-guard", nargs=2, metavar=("BASE", "HEAD"))
    ap.add_argument("--policy-diff", metavar="BASE")
    ap.add_argument("--notices", action="store_true")
    a = ap.parse_args(argv)
    if a.approval_guard:
        errs = approval_guard(REPO, *a.approval_guard, os.environ.get("NAPKIN_LICENCE_APPROVED") or None)
        for e in errs:
            print(f"licences: {e}", file=sys.stderr)
        return 1 if errs else 0
    if a.policy_diff:
        print(policy_diff_markdown(REPO, a.policy_diff))
        return 0
    rep = run(REPO, a.changed, readers=True if a.notices else None)
    if a.notices:
        print(notices(getattr(rep, "pkgs", []), Policy.load(REPO / "licences" / "policy.toml"),
                      load_toml(REPO / "licences" / "fonts.toml")), end="")
        return 0
    for n in rep.notes:
        print(f"licences: {n}")
    if rep.failures:
        print(f"licences: {len(rep.failures)} problem(s):", file=sys.stderr)
        for f in rep.failures:
            print(f"  ✗ {f}", file=sys.stderr)
        print("licences: the rule and how to request an exception: docs/contracts/licences.md", file=sys.stderr)
        return 1
    print("licences: pass")
    return 0


if __name__ == "__main__":
    sys.exit(main())
