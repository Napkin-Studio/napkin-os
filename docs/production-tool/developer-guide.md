# Napkin Production Tool: developer guide

How to run the Production Tool on your own computer, test it and change it. For what the tool does
and how to use it, see the [user guide](guide.md).

Related documents:
- the [provider reference](provider-reference.md): every model, its price, what we send and what
  each provider accepts (generated; do not edit by hand);
- the provider research notes: [`providers.md`](providers.md);
- the event specification: [`hackathon-spec.md`](hackathon-spec.md);
- the feature records in [`features/`](../../features/), e.g. `model-choice.clan`,
  `harness-errors.clan`, `harness-pathways.clan`, `default-models.clan`.

## Prerequisites

| Tool | Version / note |
|---|---|
| uv | With Python 3.12 (the relay requires `>=3.12,<3.13`). |
| Node | 20, as CI uses. If your shell's `npm`/`node` are nvm lazy-load wrappers that fail ("command not found: _load_nvm"), put the real binaries first: `export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"`. |
| Rust | With the `wasm32-unknown-unknown` target: `rustup target add wasm32-unknown-unknown`. |
| wasm-bindgen-cli | Must match `crates/napkin-wasm/Cargo.toml`, currently **0.2.128**: `cargo install wasm-bindgen-cli --version 0.2.128 --locked`. |
| terraform | Only if your changes reach `infra/`; the check script runs it then. |

## One-time setup

1. Turn on the repo's git hooks: `git config core.hooksPath .githooks`.
2. Build the CLAN store's wasm. Without it, the web app fails at start with *"Failed to resolve import ./wasm/napkin_wasm.js"*.
   ```
   cd production-tool/clan-store && npm ci && npm run build
   ```
3. Install the web app's packages: `cd production-tool/web && npm ci`.
4. Put provider keys in a `.env` file at the repo root. It's gitignored; **never commit it**. Only the steps whose key is present can run for real:
   ```
   FAL_KEY=...
   RUNWAY_API_KEY=...
   HEYGEN_API_KEY=...
   ```
   A provider with no key is skipped at start, with a log line like "provider runway failed to start". Steps routed only to it can't run.

## Start the relay (the local server)

The local relay keeps everything in memory, so restarting it forgets all jobs. It signs in with event code **`LOCAL`** (participant) or **`ORGLOCAL`** (organiser).

```
cd production-tool/relay
set -a; source ../../.env; set +a        # loads the keys into this shell only
LOCAL_CONFIG=/path/to/config.json uv run --frozen --python 3.12 python -m local --port 8787
```

- **Config:**
  - Without `LOCAL_CONFIG`, every step runs on the free **mock** provider, which returns your input stamped "MOCK".
  - With `LOCAL_CONFIG`, it reads your config file (same shape as `contracts/examples/config.*.json`) and re-reads it every 30 s, so routing and flag changes need no restart.
  - To use real services, route steps to them, e.g. `"frame": ["fal", "mock"]` with `"fallbackOnly": ["mock"]`.
- **No director model configured** (`ANTHROPIC_API_KEY` or `NAPKIN_MODEL_API` unset): a simple passthrough director writes prompts from the shot text. That's fine for testing routing; it isn't representative of prompt quality.
- **Use `--frozen`:** without it, `uv` rewrites the out-of-date `uv.lock` on every run (see [Gotchas](#gotchas)).

## Start the web app

```
cd production-tool/web
VITE_RELAY_URL=http://127.0.0.1:8787 npx vite --port 5173 --strictPort --host 127.0.0.1
```

Open **http://127.0.0.1:5173**:
- **Use `127.0.0.1`, not `localhost`.** Vite can bind to IPv6 (`::1`) while the relay listens on IPv4, and then one side can't reach the other.
- **Dev switch:** the **⚙ Dev** button picks the config. Use "From the relay (GET /config)" to follow your local relay.
- **Spending:** jobs routed to fal, Runway or HeyGen spend real money on the keys in your `.env`.

## Running the tests

| What | Command |
|---|---|
| Relay | `cd production-tool/relay && uv run --frozen --python 3.12 --with pytest --with 'moto[dynamodb]' --with 'moto[s3]' --with 'moto[ssm]' python -m pytest -q` |
| Contracts | `uv run --no-project --with jsonschema --with rfc3339-validator python production-tool/contracts/check.py` |
| Web | `cd production-tool/web && npm run lint && npm test && npm run build:web` |
| Everything a change reaches | `scripts/check.sh` from the repo root (`--list` shows what will run; `--base <branch>` compares against another branch) |

The pre-push hook runs `scripts/check.sh` and refuses the push if it fails. Never use `--no-verify`.

## Gotchas

- **`History.tsx` vs `history.ts`:** on macOS, `import './ui/History'` used to resolve to `history.ts`, and the app failed at start. The helper is now `historyItems.ts` (fixed 2026-10-08). If a stale cache shows the old error, restart Vite with `--force`.
- **`uv.lock` rewritten:** `relay/uv.lock` and `stitch/uv.lock` are behind `pyproject.toml` (moto is missing from the dev group), so any `uv run` without `--frozen` rewrites them. Restore them with `git checkout -- production-tool/relay/uv.lock production-tool/stitch/uv.lock` until they're regenerated.
- **A new branch's checks reach `infra/`:** with no upstream, `scripts/check.sh` compares against `develop`, which pulls in the whole Production Tool history, including `infra/`. That needs terraform installed. Use `--base <your base branch>` to check only your own changes.

## Changing things: the feature workflow

Every non-trivial change gets a feature record and an approved design before code:
- `scripts/feature new`, `show`, `status` and `log`;
- the rules are in [`CLAUDE.md`](../../CLAUDE.md) and [`features/README.md`](../../features/README.md).

Branches are `feat/<slug>`. Pull requests go into `develop` and are squash-merged.

## Testing the providers

- **Every step on every provider pathway, offline:** `production-tool/relay/tests/test_pathways.py`
  runs each step through the relay and the real adapters against stand-ins of fal, Runway and
  HeyGen, and checks every request against the provider's published schema.
- **Refresh those schemas:** `uv run --frozen --python 3.12 python scripts/refresh_provider_schemas.py`
  in `production-tool/relay` (`--check` shows what changed).
- **Cost per pathway:** `scripts/pathway_costs.py`.
- **A real run, with a spending cap:** `scripts/pathway_smoke.py --live --max-usd 1 --image-url
  <https picture>`. It's a dry run without `--live`, and reads keys only from your environment.
- **The provider reference page:** regenerate it with `scripts/provider_reference.py` after a sheet
  or schema changes; a test fails until you do.
