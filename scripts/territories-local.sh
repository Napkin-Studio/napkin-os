#!/usr/bin/env bash
# Try Territories on your own machine: the middleware (Territories runs in it), the web host and the app shell, with Claude
# reached through scripts/model-local, which answers with `claude -p` on your own Claude Code login (no per-call API cost).
#
#   scripts/territories-local.sh
#
# Open http://127.0.0.1:8399/ (no sign-in locally: NAPKIN_AUTH=none, you are the owner). Make a brief in Brief Maker (or a
# Research Tool document), Continue in -> Territories, then run Pick -> Explore -> Greenlight -> World, export, look things up,
# and Send to production or deck. Brief Maker, Research Tool, Territories, Deck Maker and Production are all installed.
# Ctrl-C stops what this script started (a model-local that was already up is left running).
#
# Claude: needs `claude` on PATH and signed in (claude, then /login). Model work and web look-ups use your Claude plan.
# Pictures (Runway frames) are OFF: NAPKIN_TERRITORY_IMAGES is unset and RUNWAY_API_KEY is not passed on. To turn them on:
#   TERRITORIES_IMAGES=1 RUNWAY_API_KEY=... scripts/territories-local.sh
# That sets NAPKIN_TERRITORY_IMAGES=1 and COSTS RUNWAY MONEY: a card asks before each paid batch, and the run stops at
# NAPKIN_TERRITORY_IMAGES_MAX_USD (default 2.00). The key comes from the environment only (no .env is read).
#
# Ports (env overrides): web TERRITORIES_WEB_PORT=8399, middleware TERRITORIES_MW_PORT=8395, model MODEL_LOCAL_PORT=8797.
# It never touches 8091/8788/8191/8888/8897 or deck-local's 8099/8795/8793. Data and logs: $TERRITORIES_LOCAL_DIR
# (default .territories-local; delete it to start clean). Other env: NAPKIN_WEB_BIN (a built napkin-web, else target/debug,
# else cargo run), TERRITORIES_REBUILD=1 (rebuild app/dist), NAPKIN_TERRITORY_MAX_USD (model cap per run, default 3.00).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUN="${TERRITORIES_LOCAL_DIR:-$ROOT/.territories-local}"
WEB_PORT="${TERRITORIES_WEB_PORT:-8399}"
MW_PORT="${TERRITORIES_MW_PORT:-8395}"
export MODEL_LOCAL_PORT="${MODEL_LOCAL_PORT:-8797}"
mkdir -p "$RUN/web" "$RUN/config" "$RUN/seed" "$RUN/logs" "$RUN/territory"

for p in "$WEB_PORT" "$MW_PORT"; do
  if (exec 3<>"/dev/tcp/127.0.0.1/$p") 2>/dev/null; then echo "port $p is already in use: set TERRITORIES_WEB_PORT / TERRITORIES_MW_PORT"; exit 1; fi
done

# the apps and the shell, built once (the Territories app must be in the build)
if [ ! -f "$ROOT/app/dist/index.html" ] || [ ! -f "$ROOT/app/dist/apps/territories.app.clan" ] || [ "${TERRITORIES_REBUILD:-0}" = 1 ]; then
  echo "building the apps and the shell (once)..."
  (cd "$ROOT/app" && npm ci --silent && npm run apps >/dev/null && npm run build >/dev/null)
fi
rm -f "$RUN/seed/"*.clan
cp "$ROOT"/app/public/apps/*.app.clan "$RUN/seed/"

cat > "$RUN/config/workspace.yaml" <<YAML
proxies:
  middleware:
    endpoint: http://127.0.0.1:$MW_PORT/v1/tasks
YAML

pids=()
we_started_model=0
stop() {
  for p in "${pids[@]:-}"; do [ -n "$p" ] && kill "$p" 2>/dev/null || true; done
  [ "$we_started_model" = 1 ] && "$ROOT/scripts/model-local" stop >/dev/null 2>&1 || true
}
trap stop EXIT INT TERM

# Claude through the local model port
if ! "$ROOT/scripts/model-local" status >/dev/null 2>&1; then we_started_model=1; fi
"$ROOT/scripts/model-local" start
MODEL_ENV="$("$ROOT/scripts/model-local" env)"

IMG=(-u NAPKIN_TERRITORY_IMAGES -u RUNWAY_API_KEY)
if [ "${TERRITORIES_IMAGES:-}" = 1 ]; then
  [ -n "${RUNWAY_API_KEY:-}" ] || { echo "TERRITORIES_IMAGES=1 needs RUNWAY_API_KEY in the environment"; exit 1; }
  IMG=(NAPKIN_TERRITORY_IMAGES=1)
fi

( cd "$ROOT/server" && eval "$MODEL_ENV" && exec env "${IMG[@]}" PYTHONPATH="$ROOT/engine" NAPKIN_TERRITORY_DATA="$RUN/territory" \
  NAPKIN_PORT="$MW_PORT" NAPKIN_LAYERS_URL=http://127.0.0.1:9 uv run --quiet python -m napkin.app ) > "$RUN/logs/middleware.log" 2>&1 &
pids+=($!)

WEB=("${NAPKIN_WEB_BIN:-}")
if [ -z "${WEB[0]}" ]; then
  if [ -x "$ROOT/target/debug/napkin-web" ] && [ "${TERRITORIES_REBUILD:-0}" != 1 ]; then WEB=("$ROOT/target/debug/napkin-web"); else WEB=(cargo run -q -p napkin-web); fi
fi
( cd "$ROOT" && NAPKIN_WEB_ADDR="127.0.0.1:$WEB_PORT" NAPKIN_WEB_DATA="$RUN/web" NAPKIN_CONFIG_DIR="$RUN/config" NAPKIN_AUTH=none \
  NAPKIN_WEB_STATIC="$ROOT/app/dist" NAPKIN_WEB_SEED="$RUN/seed" exec "${WEB[@]}" ) > "$RUN/logs/web.log" 2>&1 &
pids+=($!)

for url in "http://127.0.0.1:$MW_PORT/healthz" "http://127.0.0.1:$WEB_PORT/api/session"; do
  for _ in $(seq 1 180); do curl -fs "$url" >/dev/null 2>&1 && break; sleep 1; done
  curl -fs "$url" >/dev/null 2>&1 || { echo "did not start: $url (see $RUN/logs)"; exit 1; }
done
echo "Territories: http://127.0.0.1:$WEB_PORT/   (middleware :$MW_PORT, model :$MODEL_LOCAL_PORT; logs in $RUN/logs)"
echo "No sign-in locally: you are the owner. Claude runs on your Claude Code login through model-local."
if [ "${TERRITORIES_IMAGES:-}" = 1 ]; then echo "PICTURES ON: Runway frames cost money, capped at ${NAPKIN_TERRITORY_IMAGES_MAX_USD:-2.00} USD a document."; else echo "Pictures are off (no Runway)."; fi
wait
