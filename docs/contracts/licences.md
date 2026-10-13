# Contract — licences

Status: **in force** from the merge of feature `licence-gate`. Owner: Shrey.
Enforced by `scripts/licences/check.py`, the CI job
**Licences — npm · cargo · python · weights · fonts**, the `licences` suite of
`scripts/check.sh`, and step 0 of `.githooks/pre-push`.

Every track reads this before it adds a dependency, a font, a binary or a model.

---

## 1. The rule

The owner's decision (Shrey, 2026-10-13; `docs/production-tool/overhaul-plan.md`
"Owner decisions"; `features/licence-gate.clan`):

1. **Permissive open source only.** MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause,
   ISC, 0BSD, CC0-1.0, Unlicense, Zlib, Unicode-3.0, BlueOak-1.0.0, Python-2.0 and
   similar permissive licences. OFL-1.1 for fonts.
2. **MPL-2.0 only installed unmodified from a registry** (npm, crates.io, PyPI).
   No patches, no vendored copies, no git or path sources.
3. **GPL, LGPL and AGPL never in anything shipped to clients.** On our servers
   only, in artefacts that are never distributed, and listed explicitly as an
   exception (the stitch Lambda's ffmpeg; psycopg).
4. **Never paid, commercial or source-available** (tldraw, BUSL, SSPL, Elastic,
   SUL, PolyForm, Commons Clause, CC-BY-NC). No exception can allow these.
5. **Model weights are listed** in `licences/weights.toml` with their weight
   licence, revision and file hashes. No non-commercial weights.

## 2. Tiers

| Tier | What | Allowed |
|---|---|---|
| client | Anything a user receives: the npm production dependencies of `app/`, `production-tool/web`, `production-tool/clan-store`; the crates linked by `napkin-wasm` (wasm32), `clan-cli` and `clan-app` (every target) | `[licences].permissive`; MPL from a listed registry |
| server | Runs on our servers, never distributed: the crates linked by `napkin-web`; the runtime dependencies (and extras) of every `uv.lock` (relay, stitch, server, layers-service, engine) | client list; copyleft only for a package named in an `[[exception]]` |
| build | Dev dependencies, dependency groups, proc macros, build and dev crates | client list plus `[licences].build` |

A package reached by more than one root takes its highest tier. Rust tiers are
resolved per root and target with `cargo tree -e normal,no-proc-macro`, so an
optional dependency behind a feature only the server enables (napkin-host's
reqwest and tokio) is server tier, not client.

The roots are a list in `licences/policy.toml`; a root that does not exist fails
the check, so moving a tool means editing that list in the same PR.

## 3. The files

| File | Holds |
|---|---|
| `licences/policy.toml` | `approvers`; `[licences]` permissive, with_exceptions, build, fonts, weights, copyleft, denied (globs), denied_markers; `[mpl]` ids and registries; `[aliases]`; `[roots]` npm, rust (package, targets, tier), python; `[scan]` exclude and own_licences; `[[exception]]`; `[[clarification]]` |
| `licences/weights.toml` | `[[model]]` id, source, revision, files `[{path, sha256}]`, weight_licence, code_licence, model_card_url, tier, used_by, approved_by |
| `licences/fonts.toml` | `[[family]]` name, shipped_by (`package@version`, `fonts.googleapis.com` or `repo`), files (globs), licence, source_url |
| `licences/binaries.toml` | `[[binary]]` name, version, url, mirror_url, sha256, licence, tier (server, system, build), used_by, reason, approved_by; image; pin_script, pin_prefix, mirror_path |

An **exception** names one package at one exact version: package, ecosystem
(npm, cargo, pypi), version, tier, licence (as the gate reads it), reason,
approved_by, date. It never covers a denied licence, and copyleft never gets a
client exception. An exception that matches nothing in the tree fails the check.

A **clarification** gives the licence of a package whose metadata has none (or
only free text): package, ecosystem, version, licence, licence_file (its path in
the package archive), licence_file_sha256, reason. The gate downloads the
archive and checks the hash, so a version bump forces a fresh read.

## 4. What the gate checks

- Every third-party package of every root, by lockfile: `package-lock.json` v3,
  `cargo tree` per root and target plus `cargo metadata`, and each `uv.lock` with
  licence metadata from the PyPI JSON API for the exact pinned version (cached in
  `~/.cache/napkin-licences`). SPDX expressions are evaluated with OR, AND, WITH
  and parentheses; legacy forms go through `[aliases]`.
- Unmodified code: no `patches/` directory, no patch-package or postinstall
  patch step, no `overrides` off the registry, every `resolved` on
  registry.npmjs.org with an `integrity`, no Cargo `[patch]`/`[replace]` or git
  crates, no `[tool.uv.sources]` git or URL sources, no tracked `*.min.js`, no
  `vendor/` or `third_party/`, and no third-party SPDX or `@license` header in a
  tracked file.
- Weights: every model id in code that loads local weights (from_pretrained,
  SentenceTransformer, CrossEncoder, snapshot_download, transformers.js
  `pipeline`, rembg `new_session`, and MODEL / DEFAULT_MODEL constants including
  `os.environ.get` defaults) is in `weights.toml`; rembg `new_session()` names its
  model; no NC weight licence. At run time `engine/rag/weights_guard.py` refuses an
  unlisted id or local folder, so environment overrides cannot get round it.
- Fonts: every font file in the production install (`npm ci --omit=dev
  --ignore-scripts`) of each npm client root, every tracked font file, and every
  `fonts.googleapis.com` family= link in tracked .html, .ts, .tsx and .py code.
- Binaries: each entry's licence for its tier, the last `FROM` of every
  Dockerfile is listed, and a pinned download's script uses exactly the listed
  version, URL, sha256 and mirror path with `sha256sum -c`.
- `engine/requirements.txt` names only core dependencies of `engine/pyproject.toml`.

Each failure names the package, its tier, its licence, the path that pulls it in,
and the policy lines that would fix it.

## 5. Asking for an exception

1. Do not add it yourself if you are an agent. Write the failure, the package's
   role, why no permissive alternative works, and why it never reaches a client,
   in your feature record's `open_questions`, and stop.
2. A person in `approvers` decides. If yes, the exception (or model, binary or
   font entry) goes into `licences/*.toml` with `approved_by` set to that person.
3. The push needs `NAPKIN_LICENCE_APPROVED=<that name> git push`. The pre-push
   hook refuses any change to `licences/*.toml` without it, refuses a name that
   is not in `approvers`, and refuses an added or changed entry whose approved_by
   is someone else. **Only a person sets this variable.** Agents push as the
   owner's git identity, so this variable and the CI job summary (which lists
   every policy change in the PR) are the guard. `.github/CODEOWNERS` assigns
   `licences/` to the approvers.

## 6. Running it

```
scripts/check.sh --only licences          # unit tests, then the whole tree
uv run --no-project --python 3.12 python scripts/licences/check.py
uv run --no-project --python 3.12 python scripts/licences/check.py --changed <files>
uv run --no-project --python 3.12 python scripts/licences/check.py --notices   # client-tier packages
```

On a path-picked `scripts/check.sh` run the cheap scans (weights, fonts links,
vendored files, binaries, policy) always run; the lockfile readers run only when
a lockfile, manifest or `licences/` file changed. CI always runs everything.
