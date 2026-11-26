#!/usr/bin/env bash
# Try Territories on your own machine: the middleware (Territories runs in it), the web host, the app shell, and the
# Production Tool (its relay and web), with Claude reached through scripts/model-local, which answers with `claude -p`
# on your own Claude Code login.
#
#   scripts/territories-local.sh
#   RUNWAY_API_KEY=... scripts/territories-local.sh     # also makes Production's pictures and film, for real
#
# WHAT RUNS (all on 127.0.0.1, all stopped by Ctrl-C):
#   the web host (shell + /production)      TERRITORIES_WEB_PORT   8399
#   the middleware (Territories)            TERRITORIES_MW_PORT    8395
#   model-local: model AND research port    MODEL_LOCAL_PORT       8797   (one process: mock-backend; a copy already up is
#                                                                           reused and left running)
#   the Production relay                    TERRITORIES_RELAY_PORT 8393
#   the Deck Maker engine (live, claude -p) TERRITORIES_DECK_PORT  8397   (Continue in -> Deck builds for real)
# Open http://127.0.0.1:8399/ and sign in as dev@napkin (a roster name, no password; TERRITORIES_SIGN_IN changes it).
# Production needs a sign-in, so that is the one thing that differs from before. TERRITORIES_PRODUCTION=0 leaves
# Production out and goes back to no sign-in (NAPKIN_AUTH=none).
# Make a brief in Brief Maker (or a Research Tool document), Continue in -> Territories, then Pick -> Explore ->
# Greenlight -> World, export, look things up, and Send to production (it lands on /production/ with its route nodes) or
# deck.
#
# WHAT COSTS MONEY
#   Claude (model work and look-ups): nothing per call. It runs on your Claude Code login, so it uses your Claude plan.
#   Look-ups and research: `claude -p` with its WebSearch and WebFetch tools through model-local's research port. The
#     middleware is pointed at it with NAPKIN_RESEARCH_URL, the setting the cloud uses for its research service. No Tavily
#     key, no Nova, no API bill. A source is kept only if its URL came back from the CLI's own search or fetch.
#   Runway, in Production: ONLY when RUNWAY_API_KEY is in the environment. Then every picture and clip Production makes
#     SPENDS REAL MONEY, and the relay stops new paid jobs at PRODUCTION_LOCAL_MAX_USD (default 10 USD, its own
#     spend.capUsd, printed at start). Without the key Production still runs, with pictures and film off.
#   Runway frames for Territories itself stay off unless TERRITORIES_IMAGES=1 (needs the key too; capped at
#     NAPKIN_TERRITORY_IMAGES_MAX_USD, default 2.00 a document, and a card asks before each paid batch).
#   The key comes from the environment only: no .env is read, and it is never printed or logged.
#
# HOW TO STOP: Ctrl-C in this terminal. It stops the web host, middleware and relay it started (and model-local if it
# started it). A Production job still running at Runway is lost to this stack when the relay stops; its task id is in
# $TERRITORIES_LOCAL_DIR/production/relay.log. Delete $TERRITORIES_LOCAL_DIR to start clean.
#
# Claude: needs `claude` on PATH and signed in (claude, then /login).
# Data and logs: $TERRITORIES_LOCAL_DIR (default .territories-local). It never touches 8091/8788/8191/8888/8897 or
# deck-local's 8099/8795/8793. Other env: NAPKIN_WEB_BIN (a built napkin-web, else target/debug, else cargo run),
# TERRITORIES_REBUILD=1 (rebuild app/dist), NAPKIN_TERRITORY_MAX_USD (model cap per run, default 3.00).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUN="${TERRITORIES_LOCAL_DIR:-$ROOT/.territories-local}"
WEB_PORT="${TERRITORIES_WEB_PORT:-8399}"
MW_PORT="${TERRITORIES_MW_PORT:-8395}"
export MODEL_LOCAL_PORT="${MODEL_LOCAL_PORT:-8797}"
RELAY_PORT="${TERRITORIES_RELAY_PORT:-8393}"
DECK_PORT="${TERRITORIES_DECK_PORT:-8397}"
PROD="${TERRITORIES_PRODUCTION:-1}"
SIGN_IN="${TERRITORIES_SIGN_IN:-dev@napkin}"
MAX_USD="${PRODUCTION_LOCAL_MAX_USD:-10}"
mkdir -p "$RUN/web" "$RUN/config" "$RUN/seed" "$RUN/logs" "$RUN/territory" "$RUN/deck-engine"

PORTS=("$WEB_PORT" "$MW_PORT" "$DECK_PORT"); [ "$PROD" = 1 ] && PORTS+=("$RELAY_PORT")
for p in "${PORTS[@]}"; do
  if (exec 3<>"/dev/tcp/127.0.0.1/$p") 2>/dev/null; then echo "port $p is already in use: set TERRITORIES_WEB_PORT / TERRITORIES_MW_PORT / TERRITORIES_RELAY_PORT"; exit 1; fi
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
groups=()   # session leaders (the relay): the whole group goes, uv's child included
we_started_model=0
stop() {
  for p in "${pids[@]:-}"; do [ -n "$p" ] && kill "$p" 2>/dev/null || true; done
  for g in "${groups[@]:-}"; do [ -n "$g" ] && { kill -- -"$g" 2>/dev/null || kill "$g" 2>/dev/null || true; }; done
  [ "$we_started_model" = 1 ] && "$ROOT/scripts/model-local" stop >/dev/null 2>&1 || true
}
trap stop EXIT INT TERM

# Claude through the local model port
if ! "$ROOT/scripts/model-local" status >/dev/null 2>&1; then we_started_model=1; fi
"$ROOT/scripts/model-local" start
MODEL_ENV="$("$ROOT/scripts/model-local" env)"

IMG=(-u NAPKIN_TERRITORY_IMAGES -u RUNWAY_API_KEY -u RUNWAYML_API_SECRET)
if [ "${TERRITORIES_IMAGES:-}" = 1 ]; then
  [ -n "${RUNWAY_API_KEY:-}" ] || { echo "TERRITORIES_IMAGES=1 needs RUNWAY_API_KEY in the environment"; exit 1; }
  # Territories' frames read the key as RUNWAYML_API_SECRET (engine/visuals/runway.py), the name the cloud's middleware task has: passed
  # through the environment only, never printed (live click-through 2026-11-26: without it the frames said the picture service was not connected).
  IMG=(NAPKIN_TERRITORY_IMAGES=1); IMG_KEY=1      # exported in the middleware's own subshell below: never on a command line (ps)
fi

# Look-ups and research: the same setting the cloud uses for its research service, here model-local's research port
# (claude -p with WebSearch/WebFetch on your login). Nothing in the middleware knows it is local.
RESEARCH_URL="http://127.0.0.1:$MODEL_LOCAL_PORT"

# A deck from a Production project fetches its pictures from the relay with napkin-web's signed assets pass. The local relay is plain
# http on 127.0.0.1, which the engine and the middleware refuse unless this dev-only switch is on in their own environments
# (docs/contracts/deck-visuals.md, "Local stack"). Without it every Production slot was "not reachable" (acceptance A61).
LOOP=(DECK_RELAY_ALLOW_LOOPBACK=0); [ "$PROD" = 1 ] && LOOP=(DECK_RELAY_ALLOW_LOOPBACK=1)

# The Deck Maker engine, live through model-local (claude -p): without it Continue in -> Deck opens but never builds.
( cd "$ROOT/engine" && eval "$MODEL_ENV" && export BRIEF_CLAUDE_TRANSPORT=auto "${LOOP[@]}" && NAPKIN_DECK_DATA="$RUN/deck-engine" NAPKIN_DECK_PORT="$DECK_PORT" NAPKIN_DECK_LIVE=1 NAPKIN_DECK_REPLAY="" NAPKIN_DECK_RENDER=web PYTHONPATH=. \
  exec uv run --quiet --no-project --python 3.12 --with pdfplumber --with python-docx --with PyYAML --with python-pptx --with lxml --with jsonschema --with anthropic --with pillow \
  python -m deck.server ) > "$RUN/logs/deck-engine.log" 2>&1 &
pids+=($!)
# The knowledge layers are model-local's (its mock layers family): pointed anywhere else, Research stops with "layers unreachable".
( cd "$ROOT/server" && eval "$MODEL_ENV" && { [ "${IMG_KEY:-0}" = 1 ] && export RUNWAYML_API_SECRET="$RUNWAY_API_KEY" || true; } && exec env "${IMG[@]}" "${LOOP[@]}" NAPKIN_DECK_ENGINE_URL="http://127.0.0.1:$DECK_PORT" NAPKIN_DECK_RENDER=1 NAPKIN_RESEARCH_URL="$RESEARCH_URL" PYTHONPATH="$ROOT/engine" NAPKIN_TERRITORY_DATA="$RUN/territory" \
  NAPKIN_PORT="$MW_PORT" NAPKIN_LAYERS_URL="http://127.0.0.1:$MODEL_LOCAL_PORT" uv run --quiet python -m napkin.app ) > "$RUN/logs/middleware.log" 2>&1 &
pids+=($!)


# Production: the relay and the web's /production, behind the same napkin-web (it needs a sign-in, so the roster)
PROD_MODE=off
AUTH_ENV=(NAPKIN_AUTH=none)
PROD_ENV=()
if [ "$PROD" = 1 ]; then
  command -v uv >/dev/null || { echo "uv is not on PATH (the Production relay runs with uv); or TERRITORIES_PRODUCTION=0"; exit 1; }
  PS="$RUN/production"; mkdir -p "$PS/secrets" "$PS/relay-data"; chmod 700 "$PS/secrets"
  secret() { local f="$PS/secrets/$1"; [ -s "$f" ] || { python3 -c 'import secrets; print(secrets.token_hex(24))' >"$f"; chmod 600 "$f"; }; cat "$f"; }
  DIST="$("$ROOT/scripts/run-production-local" build | tail -n 1)"
  rm -rf "$PS/production-dist" && cp -r "$DIST" "$PS/production-dist"
  [ -s "$PS/roster.tsv" ] || printf '%s\t%s\n' "$SIGN_IN" "$(git -C "$ROOT" config user.name || echo Developer)" > "$PS/roster.tsv"
  TOKEN="$(secret relay-token)"
  RELAY_ENV=(TOKEN_SECRET="$TOKEN")
  if [ -n "${RUNWAY_API_KEY:-}" ]; then
    PROD_MODE=runway
    python3 - "$ROOT/production-tool/contracts/examples/config.testing.json" "$PS/live-config.json" "$MAX_USD" <<'PY'
import json, sys
src, out, cap = sys.argv[1], sys.argv[2], float(sys.argv[3])
c = json.load(open(src))
c["spend"] = {"capUsd": cap, "warnUsd": round(cap * 0.8, 2)}
c.setdefault("routing", {}).setdefault("upscale", ["runway"])
json.dump(c, open(out, "w"), indent=2)
PY
    while IFS= read -r line; do [[ "$line" == export\ * ]] && RELAY_ENV+=("${line#export }"); done <<<"$MODEL_ENV"
    RELAY_ENV+=(RUNWAY_API_KEY="$RUNWAY_API_KEY" LOCAL_CONFIG="$PS/live-config.json")
  else
    PROD_MODE=mock
  fi
  rm -f "$PS/relay.pid"   # a pid left by an earlier run must not pass for this one
  # the relay leads its own session so stop can kill uv's child too; the key reaches only the relay, and only when set
  ( cd "$ROOT/production-tool/relay" || exit 1; exec env -u RUNWAY_API_KEY -u RUNWAYML_API_SECRET -u ANTHROPIC_API_KEY \
      -u NAPKIN_MODEL_API -u NAPKIN_MODEL_BASE_URL -u ANTHROPIC_BASE_URL -u AWS_PROFILE "${RELAY_ENV[@]}" \
      setsid bash -c 'echo $$ >"$1"; shift; exec "$@"' _ "$PS/relay.pid" \
      uv run -q --python 3.12 python -m local --port "$RELAY_PORT" --data "$PS/relay-data" ) > "$PS/relay.log" 2>&1 </dev/null &
  for _ in $(seq 1 50); do [ -s "$PS/relay.pid" ] && break; sleep 0.1; done
  groups+=("$(cat "$PS/relay.pid" 2>/dev/null || true)")
  AUTH_ENV=(NAPKIN_AUTH=roster NAPKIN_AUTH_ROSTER="$PS/roster.tsv" NAPKIN_SESSION_SECRET="$(secret session)")
  PROD_ENV=(NAPKIN_PRODUCTION_RELAY_URL="http://127.0.0.1:$RELAY_PORT" NAPKIN_PRODUCTION_MEDIA_BASE="http://localhost:$RELAY_PORT"
            NAPKIN_PRODUCTION_RELAY_SECRET="$TOKEN" NAPKIN_PRODUCTION_STATIC="$PS/production-dist")
fi

WEB=("${NAPKIN_WEB_BIN:-}")
if [ -z "${WEB[0]}" ]; then
  if [ -x "$ROOT/target/debug/napkin-web" ] && [ "${TERRITORIES_REBUILD:-0}" != 1 ]; then WEB=("$ROOT/target/debug/napkin-web"); else WEB=(cargo run -q -p napkin-web); fi
fi
( cd "$ROOT" && exec env NAPKIN_WEB_ADDR="127.0.0.1:$WEB_PORT" NAPKIN_WEB_DATA="$RUN/web" NAPKIN_CONFIG_DIR="$RUN/config" "${AUTH_ENV[@]}" "${PROD_ENV[@]}" \
  NAPKIN_WEB_STATIC="$ROOT/app/dist" NAPKIN_WEB_SEED="$RUN/seed" "${WEB[@]}" ) > "$RUN/logs/web.log" 2>&1 &
pids+=($!)

URLS=("http://127.0.0.1:$MW_PORT/healthz" "http://127.0.0.1:$WEB_PORT/api/session")
if [ "$PROD" = 1 ]; then   # the relay has no health route: its port answering is enough
  for _ in $(seq 1 120); do (exec 3<>"/dev/tcp/127.0.0.1/$RELAY_PORT") 2>/dev/null && break; sleep 1; done
  (exec 3<>"/dev/tcp/127.0.0.1/$RELAY_PORT") 2>/dev/null || { echo "the Production relay did not start (see $PS/relay.log)"; exit 1; }
fi
up() { [ "$(curl -s -o /dev/null -w '%{http_code}' "$1" 2>/dev/null)" != 000 ]; }   # any answer: with a sign-in, /api/session says 401
for url in "${URLS[@]}"; do
  for _ in $(seq 1 180); do up "$url" && break; sleep 1; done
  up "$url" || { echo "did not start: $url (see $RUN/logs)"; exit 1; }
done
echo "Territories: http://127.0.0.1:$WEB_PORT/   (middleware :$MW_PORT, model and research :$MODEL_LOCAL_PORT; logs in $RUN/logs)"
echo "Claude (model work and look-ups through claude -p web search) runs on your Claude Code login: no API bill."
if [ "$PROD" = 1 ]; then
  echo "Sign in as $SIGN_IN (no password). Production: http://127.0.0.1:$WEB_PORT/production/   (relay :$RELAY_PORT, log $PS/relay.log)"
  case "$PROD_MODE" in
    runway) echo "PRODUCTION SPENDS REAL MONEY on Runway (pictures and film). The relay stops new paid jobs at $MAX_USD USD (PRODUCTION_LOCAL_MAX_USD)." ;;
    *) echo "Production pictures and film are OFF (no RUNWAY_API_KEY in the environment): it runs with its mock maker, nothing costs money." ;;
  esac
else
  echo "Production is off (TERRITORIES_PRODUCTION=0); no sign-in."
fi
if [ "${TERRITORIES_IMAGES:-}" = 1 ]; then echo "TERRITORIES PICTURES ON: Runway frames cost money, capped at ${NAPKIN_TERRITORY_IMAGES_MAX_USD:-2.00} USD a document."; else echo "Territories pictures are off (no Runway)."; fi
echo "Ctrl-C stops everything this started."
wait
