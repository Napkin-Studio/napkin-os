#!/usr/bin/env bash
# Run the Deck Maker locally with the deck engine behind it: the engine server, the middleware and the web host, wired together.
#
#   scripts/deck-local.sh            # replays a recorded run (Fernley, a fictional client): free, no model
#   NAPKIN_DECK_LIVE=1 scripts/deck-local.sh   # the REAL engine: your prompt, paid model calls, about 0.65 to 1.25 USD a deck,
#                                              # stopping at NAPKIN_DECK_MAX_USD (default 2.00) a run. No recording is replayed.
#
# Open http://127.0.0.1:8099/ , start a Deck Maker document, type a prompt and press Build deck. The run stops at the storyline,
# territories and idea gates; approve each to go on. Ctrl-C stops everything. Ports: web 8099, middleware 8795, engine 8793
# (override DECK_WEB_PORT); it never touches 8787 or 8788. Env it reads: NAPKIN_DECK_LIVE, NAPKIN_DECK_MAX_USD (default 2.00),
# NAPKIN_DECK_REPLAY (a folder of recorded stages), NAPKIN_DECK_RENDER (0 skips the pptx, web and pdf files: no LibreOffice needed;
# default 0 here unless soffice and pdftoppm are installed), NAPKIN_WEB_BIN (a built napkin-web binary, else cargo run).
# Live runs use the engine's own model access: ANTHROPIC_API_KEY, else the one local model backend (scripts/model-local,
# answered by `claude -p` on your Claude Code login), which this script starts when neither it nor ANTHROPIC_BASE_URL is set.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUN="${DECK_LOCAL_DIR:-$ROOT/.deck-local}"
WEB_PORT="${DECK_WEB_PORT:-8099}"
if [ "${NAPKIN_DECK_LIVE:-}" = 1 ]; then
  # Live: the real engine, paid model calls. No recording unless you ask for one (a recording would win over live).
  REPLAY="${NAPKIN_DECK_REPLAY:-}"
  if [ -z "${ANTHROPIC_API_KEY:-}" ] && [ -z "${ANTHROPIC_BASE_URL:-}" ]; then   # no key: the local backend on the Claude Code login
    "$ROOT/scripts/model-local" start >/dev/null
    eval "$("$ROOT/scripts/model-local" env --sh)"
  fi
  MODEL_WIRE="${ANTHROPIC_BASE_URL:+local backend at $ANTHROPIC_BASE_URL}"; MODEL_WIRE="${MODEL_WIRE:-API key}"
else
  REPLAY="${NAPKIN_DECK_REPLAY:-$ROOT/engine/deck/tests/fixtures/fernley/stages}"
fi
mkdir -p "$RUN/engine" "$RUN/web" "$RUN/config" "$RUN/seed" "$RUN/logs"

if command -v soffice >/dev/null && command -v pdftoppm >/dev/null; then RENDER="${NAPKIN_DECK_RENDER:-1}"; else RENDER="${NAPKIN_DECK_RENDER:-0}"; fi

# the app and the shell, built once (delete app/dist to rebuild)
if [ ! -f "$ROOT/app/dist/index.html" ] || [ "${DECK_REBUILD:-0}" = 1 ]; then
  (cd "$ROOT/app" && npm ci --silent && npm run apps >/dev/null && npm run build >/dev/null)
fi
cp "$ROOT"/app/public/apps/*.app.clan "$RUN/seed/"

cat > "$RUN/config/workspace.yaml" <<YAML
proxies:
  middleware:
    endpoint: http://127.0.0.1:8795/v1/tasks
YAML

pids=()
stop() { for p in "${pids[@]:-}"; do kill "$p" 2>/dev/null || true; done; }
trap stop EXIT INT TERM

( cd "$ROOT/engine" && NAPKIN_DECK_DATA="$RUN/engine" NAPKIN_DECK_REPLAY="$REPLAY" PYTHONPATH=. \
  exec uv run --quiet --no-project --python 3.12 --with pdfplumber --with python-docx --with PyYAML --with python-pptx --with lxml --with jsonschema \
  python -m deck.server ) > "$RUN/logs/engine.log" 2>&1 &
pids+=($!)

( cd "$ROOT/server" && NAPKIN_DECK_ENGINE_URL=http://127.0.0.1:8793 NAPKIN_DECK_RENDER="$RENDER" NAPKIN_MODEL_API_KEY=unused \
  NAPKIN_LAYERS_URL=http://127.0.0.1:9 exec uv run --quiet python -m napkin.app ) > "$RUN/logs/middleware.log" 2>&1 &
pids+=($!)

WEB=("${NAPKIN_WEB_BIN:-}")
[ -n "${WEB[0]}" ] || WEB=(cargo run -q -p napkin-web)
( cd "$ROOT" && NAPKIN_WEB_ADDR="127.0.0.1:$WEB_PORT" NAPKIN_WEB_DATA="$RUN/web" NAPKIN_CONFIG_DIR="$RUN/config" NAPKIN_AUTH=none \
  NAPKIN_WEB_STATIC="$ROOT/app/dist" NAPKIN_WEB_SEED="$RUN/seed" exec "${WEB[@]}" ) > "$RUN/logs/web.log" 2>&1 &
pids+=($!)

for url in "http://127.0.0.1:8793/status" "http://127.0.0.1:8795/healthz" "http://127.0.0.1:$WEB_PORT/api/session"; do
  for _ in $(seq 1 90); do curl -fs "$url" >/dev/null 2>&1 && break; sleep 1; done
  curl -fs "$url" >/dev/null 2>&1 || { echo "did not start: $url (see $RUN/logs)"; exit 1; }
done
echo "Deck Maker: http://127.0.0.1:$WEB_PORT/   (engine :8793, middleware :8795; logs in $RUN/logs)"
if [ "${NAPKIN_DECK_LIVE:-}" = 1 ]; then echo "LIVE: the real engine on your prompt. Paid model calls ($MODEL_WIRE), capped at ${NAPKIN_DECK_MAX_USD:-2.00} USD a run."; else echo "Replay only: free, no model."; fi
[ "$RENDER" = 1 ] || echo "Files (pptx, web, pdf) are skipped: soffice and pdftoppm are not both installed."
wait
