#!/usr/bin/env bash
# The CI suites (.github/workflows/ci.yml), run locally, but only the ones the
# change reaches. The pre-push hook runs this over the commits being pushed.
#
#   scripts/check.sh                   changes since the upstream (or origin/main), plus the working tree
#   scripts/check.sh --base <ref>      changes since <ref>
#   scripts/check.sh --range A..B      changes in a commit range (what pre-push passes)
#   scripts/check.sh --all             every suite
#   scripts/check.sh --only rust,wasm  just these suites
#   scripts/check.sh --list            say which suites would run, run nothing
#
# Suites: rust wasm conformance frontend desktop engine middleware mock-backend terraform production-tool image licences
# `image` (docker build --target runtime) runs when the Dockerfile, .dockerignore or the parts of
# production-tool the image bundles change, or when named; it needs docker.
# `desktop` (cargo check of app/src-tauri) runs only when that path changes or is named:
# the full .deb bundle stays in CI. `licences` (scripts/licences/check.py) runs its cheap
# scans on any code change and reads the lockfiles only when a manifest or licences/ changed.
set -uo pipefail

root="$(git rev-parse --show-toplevel)"
cd "$root"
# The suites test the CLI's own `next:` hints; a caller's CLAN_NO_HINTS must not reach them.
unset CLAN_NO_HINTS
# Real PDF renders (crates/napkin-host/tests/export_pdf.rs) run here when a browser is installed.
for b in chromium chromium-browser google-chrome-stable google-chrome; do
  command -v "$b" >/dev/null && { export NAPKIN_PDF_RENDER_TESTS=1; break; }
done
ALL=(rust wasm conformance frontend desktop engine middleware mock-backend terraform production-tool image licences)

base="" range="" only="" list=0 all=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --base)  base="$2"; shift 2 ;;
    --range) range="$2"; shift 2 ;;
    --only)  only="$2"; shift 2 ;;
    --all)   all=1; shift ;;
    --list)  list=1; shift ;;
    -h|--help) sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "check.sh: unknown option $1" >&2; exit 2 ;;
  esac
done

# --- which files changed ----------------------------------------------------
changed_files() {
  if [[ -n "$range" ]]; then
    git diff --name-only "$range"
    return
  fi
  if [[ -z "$base" ]]; then
    base="$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null ||
      { git rev-parse -q --verify origin/develop >/dev/null && echo origin/develop; } || echo origin/main)"
  fi
  git diff --name-only "$(git merge-base "$base" HEAD)" HEAD
  git diff --name-only HEAD          # staged and unstaged
  git ls-files --others --exclude-standard
}

declare -A want=()
licence_files=()
if [[ $all -eq 1 ]]; then
  for s in "${ALL[@]}"; do want[$s]=1; done
elif [[ -n "$only" ]]; then
  IFS=',' read -ra picked <<<"$only"
  for s in "${picked[@]}"; do want[$s]=1; done
else
  notes=()
  while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    case "$f" in
      Cargo.toml|Cargo.lock|.cargo/*)
        want[rust]=1; want[wasm]=1; want[conformance]=1 ;;
      spec/*)  # the SDK builds the format's own text into itself
        want[rust]=1; want[wasm]=1; want[conformance]=1 ;;
      crates/clan-sdk/*)
        want[rust]=1; want[wasm]=1; want[conformance]=1; want[frontend]=1 ;;
      crates/clan-cli/*|test-sandbox/*)
        want[rust]=1; want[conformance]=1 ;;
      crates/napkin-host/*|crates/napkin-wasm/*)
        want[rust]=1; want[wasm]=1 ;;
      crates/*)
        want[rust]=1 ;;
      app/src-tauri/*)
        want[desktop]=1 ;;
      app/*)
        want[frontend]=1 ;;
      engine/*|mock-agent/*)
        want[engine]=1 ;;
      server/*)
        want[middleware]=1 ;;
      mock-backend/*|mock-middleware/*)
        want[mock-backend]=1 ;;
      production-tool/web/*|production-tool/clan-store/*|production-tool/contracts/*|production-tool/canvas-engine/*)
        # napkin-web's image bundles the tool's web app and the canvas engine it imports (Dockerfile, production stage)
        want[production-tool]=1; want[image]=1 ;;
      production-tool/*)
        want[production-tool]=1 ;;
      infra/*)
        want[terraform]=1
        infra_changed=1 ;;
      .github/workflows/deploy.yml)
        want[terraform]=1 ;;  # its paths-ignore lint lives in the terraform suite
      .github/workflows/*)
        notes+=("$f changed: workflows run only on GitHub; consider scripts/check.sh --all") ;;
      Dockerfile|.dockerignore)
        want[image]=1 ;;
      docker-compose.yml|server/Dockerfile)
        notes+=("$f changed: the Deploy workflow builds the images; try 'docker build .' locally") ;;
    esac
    # A second pass, so the first-match routing above is unchanged: what the licence gate reads.
    case "$f" in
      package.json|*/package.json|package-lock.json|*/package-lock.json|\
      Cargo.toml|*/Cargo.toml|Cargo.lock|.cargo/*|pyproject.toml|*/pyproject.toml|uv.lock|*/uv.lock|\
      requirements*.txt|*/requirements*.txt|licences/*|scripts/licences/*|*/build-layer.sh|\
      Dockerfile*|*/Dockerfile*|*.woff2|*.woff|*.ttf|*.otf|patches/*|*/patches/*|\
      *.py|*.ts|*.tsx|*.js|*.mjs|*.jsx|*.html)
        want[licences]=1; licence_files+=("$f") ;;
    esac
  done < <(changed_files | sort -u)
  for n in "${notes[@]}"; do echo "note: $n"; done
  if [[ -n "${infra_changed:-}" ]]; then
    echo "note: infra/ changed. The Deploy workflow only swaps images, so these changes reach AWS"
    echo "      only when a person applies them: plan and apply in infra/envs/<env> BEFORE the"
    echo "      deploy, then verify the running task definition (CLAUDE.md, Infrastructure changes)."
  fi
fi

run_list=()
for s in "${ALL[@]}"; do [[ -n "${want[$s]:-}" ]] && run_list+=("$s"); done
for s in "${!want[@]}"; do
  [[ " ${ALL[*]} " == *" $s "* ]] || { echo "check.sh: unknown suite '$s' (have: ${ALL[*]})" >&2; exit 2; }
done

if [[ ${#run_list[@]} -eq 0 ]]; then
  echo "check.sh: nothing in the change reaches a CI suite"
  exit 0
fi
echo "suites: ${run_list[*]}"
[[ $list -eq 1 ]] && exit 0

# --- the suites, as ci.yml runs them -----------------------------------------
CRATES=(-p clan-sdk -p clan-cli -p napkin-host -p napkin-web)
PY_ENGINE_DEPS=(--with numpy --with requests --with httpx --with pypdf --with pdfplumber
                --with python-docx --with PyYAML --with python-dotenv --with pytest)

suite_rust() {
  cargo fmt "${CRATES[@]}" -- --check &&
  cargo clippy -q "${CRATES[@]}" --all-targets &&
  cargo test -q "${CRATES[@]}" --all-targets
}
suite_wasm() {
  cargo build -q -p clan-sdk --target wasm32-unknown-unknown &&
  cargo build -q -p napkin-host --no-default-features --target wasm32-unknown-unknown &&
  cargo build -q -p napkin-wasm --target wasm32-unknown-unknown
}
suite_conformance() {
  cargo build -q -p clan-cli --release &&
  node test-sandbox/pipeline/conformance.mjs --clan "$root/target/release/clan"
}
suite_frontend() {
  ( cd app &&
    { [[ -d node_modules && node_modules/.package-lock.json -nt package-lock.json ]] || npm ci --no-audit --no-fund; } &&
    npm run -s lint && npm test && npm run -s build )
}
suite_desktop() {
  cargo check -q -p clan-app
}
suite_engine() {
  ( cd engine/rag && BRIEF_TESTS_OFFLINE=1 uv run -q --no-project --python 3.12 "${PY_ENGINE_DEPS[@]}" python -m pytest -q -p no:cacheprovider ) &&
  ( cd engine/agent-server && BRIEF_TESTS_OFFLINE=1 uv run -q --no-project --python 3.12 "${PY_ENGINE_DEPS[@]}" python -m pytest -q -p no:cacheprovider ) &&
  ( cd mock-agent && uv run -q --no-project --python 3.12 "${PY_ENGINE_DEPS[@]}" python -m pytest -q -p no:cacheprovider )
}
suite_middleware() {
  ( cd server && uv run -q --python 3.12 pytest -q )
}
suite_mock-backend() {
  ( cd mock-backend && uv run -q --no-project --python 3.12 --with trafilatura python -m unittest discover -s tests )
}
suite_terraform() {
  # Its own data dir: a checkout that has run a real `terraform init` keeps an S3
  # backend in .terraform, and the mocked-provider test must never reach AWS.
  local cache="${XDG_CACHE_HOME:-$HOME/.cache}/napkin-check"
  mkdir -p "$cache/tf-plugins"
  deploy_paths_lint &&
  ( cd infra && terraform fmt -check -recursive ) &&
  for env in staging hackathon; do
    ( cd "infra/envs/$env" && export TF_DATA_DIR="$cache/tfdata-$env" TF_PLUGIN_CACHE_DIR="$cache/tf-plugins" &&
      terraform init -backend=false -input=false >/dev/null &&
      terraform validate && terraform test ) || return 1
  done
}
# deploy.yml must not ignore the parts of production-tool that napkin-web's image bundles
# (features/os-sign-in.clan): a release that changes only the tool has to redeploy staging.
deploy_paths_lint() {
  if grep -nE "^[[:space:]]*-[[:space:]]*'?production-tool/\*\*'?[[:space:]]*$" .github/workflows/deploy.yml; then
    echo "deploy.yml ignores all of production-tool/**; ignore only production-tool/relay/** and production-tool/stitch/**" >&2
    return 1
  fi
}
suite_image() {
  if ! command -v docker >/dev/null; then
    echo "image: docker is not installed; the CI image job builds it" >&2
    return 0
  fi
  docker build -q --target runtime -t napkin-web:check . >/dev/null &&
  docker run --rm --entrypoint test napkin-web:check -f /srv/napkin/production/index.html
}
suite_production-tool() {
  # relay and stitch (offline), the locked contracts, and the web app once the UI lane adds it
  ( cd production-tool/relay && uv run -q --python 3.12 pytest -q ) &&
  ( cd production-tool/stitch && uv run -q --python 3.12 pytest -q ) &&
  uv run -q --no-project --with jsonschema --with rfc3339-validator python production-tool/contracts/check.py &&
  # The CLAN store: napkin-wasm (cargo + wasm-bindgen) into clan-store/src/wasm, its tests
  # (against the real `clan` CLI), then the web app on top of it.
  ( cd production-tool/clan-store &&
    { [[ -d node_modules && node_modules/.package-lock.json -nt package-lock.json ]] || npm ci --no-audit --no-fund; } &&
    npm run -s build && npm run -s lint && npm test ) &&
  # The canvas engine (features/canvas-engine.clan): lint, tests, and the PR bench on the
  # seed-1 G3 scene (byte, memory and draw-time checks; features/engine-ci.clan).
  ( cd production-tool/canvas-engine &&
    { [[ -d node_modules && node_modules/.package-lock.json -nt package-lock.json ]] || npm ci --no-audit --no-fund; } &&
    npm run -s lint && npm test && npm run -s bench ) &&
  if [[ -f production-tool/web/package.json ]]; then
    ( cd production-tool/web &&
      { [[ -d node_modules && node_modules/.package-lock.json -nt package-lock.json ]] || npm ci --no-audit --no-fund; } &&
      npm run -s lint && npm test && npm run -s build:web )
  fi
}

suite_licences() {
  # The unit tests, then the repo itself (test_repo_tree_passes): on a path-picked run it
  # reads the lockfiles only when one of the changed files is a manifest or licences/.
  if [[ $all -eq 0 && -z "$only" ]]; then
    export NAPKIN_LICENCE_CHANGED="$(printf '%s\n' "${licence_files[@]}")"
  fi
  uv run -q --no-project --python 3.12 --with pytest --with brotli python -m pytest -q -p no:cacheprovider scripts/licences
}

logdir="$(mktemp -d "${TMPDIR:-/tmp}/napkin-check.XXXXXX")"
declare -A result=()
failed=0
for s in "${run_list[@]}"; do
  printf '── %-13s ' "$s"
  start=$SECONDS
  if "suite_$s" >"$logdir/$s.log" 2>&1; then
    result[$s]=pass; printf 'pass  (%ss)\n' $((SECONDS - start))
  else
    result[$s]=FAIL; failed=1; printf 'FAIL  (%ss)  log: %s\n' $((SECONDS - start)) "$logdir/$s.log"
    tail -n 25 "$logdir/$s.log" | sed 's/^/   │ /'
  fi
done

if [[ $failed -eq 0 ]]; then
  echo "all checks passed: ${run_list[*]}"
  rm -rf "$logdir"
else
  echo "checks failed; full logs in $logdir"
fi
exit $failed
