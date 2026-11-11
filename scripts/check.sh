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
# Suites: rust wasm conformance frontend desktop engine middleware mock-backend terraform production-tool secrets copy
# `secrets` (gitleaks over the commits in range, with .gitleaks.toml) runs for any change. It needs the
# gitleaks binary on PATH or in $GITLEAKS_BIN (CI pins v8.30.1; the suite says how to get it).
# `copy` fails on an em dash in an interface string: string literals and templates in .ts/.tsx/.js/.jsx
# under app/src and app/templates (tests, .d.ts and comments are skipped; .clan, .yaml, .md, .html are not read).
# `e2e` (the Playwright smoke in app/e2e against a seeded local stack) runs only when named
# (`--only e2e`): it needs a browser (`cd app && npx playwright install chromium`) and a cold run
# builds the shell and napkin-web first.
# `desktop` (cargo check of app/src-tauri) runs only when that path changes or is named:
# the full .deb bundle stays in CI.
set -uo pipefail

root="$(git rev-parse --show-toplevel)"
cd "$root"
# The suites test the CLI's own `next:` hints; a caller's CLAN_NO_HINTS must not reach them.
unset CLAN_NO_HINTS
# Real PDF renders (crates/napkin-host/tests/export_pdf.rs) run here when a browser is installed.
for b in chromium chromium-browser google-chrome-stable google-chrome; do
  command -v "$b" >/dev/null && { export NAPKIN_PDF_RENDER_TESTS=1; break; }
done
ALL=(rust wasm conformance frontend desktop engine middleware mock-backend terraform production-tool secrets copy)
# Suites that only run when named; never part of --all or of what a change reaches.
OPTIONAL=(e2e)

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
if [[ $all -eq 1 ]]; then
  for s in "${ALL[@]}"; do want[$s]=1; done
elif [[ -n "$only" ]]; then
  IFS=',' read -ra picked <<<"$only"
  for s in "${picked[@]}"; do want[$s]=1; done
else
  notes=()
  while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    # The pre-push hook runs the secret scan itself, so it sets NAPKIN_SECRETS_DONE for the run it hands us.
    [[ -z "${NAPKIN_SECRETS_DONE:-}" ]] && want[secrets]=1
    case "$f" in app/src/*|app/templates/*) want[copy]=1 ;; esac
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
      production-tool/*)
        want[production-tool]=1 ;;
      infra/*)
        want[terraform]=1
        infra_changed=1 ;;
      .github/workflows/*)
        notes+=("$f changed: workflows run only on GitHub; consider scripts/check.sh --all") ;;
      Dockerfile|docker-compose.yml|server/Dockerfile|.dockerignore)
        notes+=("$f changed: the Deploy workflow builds the images; try 'docker build .' locally") ;;
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
  [[ " ${ALL[*]} ${OPTIONAL[*]} " == *" $s "* ]] || { echo "check.sh: unknown suite '$s' (have: ${ALL[*]} ${OPTIONAL[*]})" >&2; exit 2; }
done
for s in "${OPTIONAL[@]}"; do [[ -n "${want[$s]:-}" ]] && run_list+=("$s"); done

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
  ( cd infra && terraform fmt -check -recursive ) &&
  for env in staging hackathon; do
    ( cd "infra/envs/$env" && export TF_DATA_DIR="$cache/tfdata-$env" TF_PLUGIN_CACHE_DIR="$cache/tf-plugins" &&
      terraform init -backend=false -input=false >/dev/null &&
      terraform validate && terraform test ) || return 1
  done
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
  if [[ -f production-tool/web/package.json ]]; then
    ( cd production-tool/web &&
      { [[ -d node_modules && node_modules/.package-lock.json -nt package-lock.json ]] || npm ci --no-audit --no-fund; } &&
      npm run -s lint && npm test && npm run -s build:web )
  fi
}

suite_secrets() {
  local gl="${GITLEAKS_BIN:-gitleaks}" r="$range" b mb
  if ! command -v "$gl" >/dev/null 2>&1; then
    echo "secrets: gitleaks is not installed, so no push can be checked for keys."
    echo "  Get the pinned release (v8.30.1) from https://github.com/gitleaks/gitleaks/releases/tag/v8.30.1,"
    echo "  check it against the release's checksums file, and put it on PATH or set GITLEAKS_BIN=<path>."
    echo "  (macOS: brew install gitleaks.) The hook never skips this scan."
    return 1
  fi
  if [[ -z "$r" ]]; then
    b="${base:-$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null ||
      { git rev-parse -q --verify origin/develop >/dev/null && echo origin/develop; } || echo origin/main)}"
    mb="$(git merge-base "$b" HEAD 2>/dev/null)" && r="$mb..HEAD"
  fi
  if [[ -n "$r" && -z "$(git rev-list "$r")" ]]; then echo "secrets: no commits in $r"; return 0; fi
  # --redact: a finding is reported by rule, file and line, never by value.
  "$gl" git --config "$root/.gitleaks.toml" --redact --no-banner ${r:+--log-opts "$r"} "$root"
}
suite_copy() {
  # Interface strings carry no em dash (house style). Roots can be overridden for the fixture test.
  python3 -I - ${NAPKIN_COPY_ROOTS:-app/src app/templates} <<'PY'
import pathlib, sys
EM = "\u2014"
def code_lines(src):
    inblock = False
    for ln, line in enumerate(src.split("\n"), 1):
        out, i, n = "", 0, len(line)
        while i < n:
            if inblock:
                j = line.find("*/", i)
                if j < 0:
                    i = n
                else:
                    inblock, i = False, j + 2
                continue
            if line.startswith("/*", i):
                inblock, i = True, i + 2
                continue
            if line.startswith("//", i) and (i == 0 or line[i - 1] != ":") and sum(out.count(q) for q in "'\"`") % 2 == 0:
                break   # a line comment (quotes before it are balanced, and it is not a URL)
            out += line[i]
            i += 1
        yield ln, out
bad = 0
for root in sys.argv[1:]:
    for p in sorted(pathlib.Path(root).rglob("*")):
        if (p.is_file() and p.suffix in (".ts", ".tsx", ".js", ".jsx", ".mjs") and ".test." not in p.name
                and not p.name.endswith(".d.ts") and "node_modules" not in p.parts):
            src = p.read_text(encoding="utf8", errors="replace")
            if EM not in src:
                continue
            for ln, code in code_lines(src):
                if EM in code:
                    bad += 1
                    print(f"{p}:{ln}: em dash in an interface string: {code.strip()[:100]}")
if bad:
    print(f"copy: {bad} em dash(es). Rewrite the sentence with a comma, colon or full stop.")
    sys.exit(1)
PY
}

suite_e2e() {
  ( cd app &&
    { [[ -d node_modules && node_modules/.package-lock.json -nt package-lock.json ]] || npm ci --no-audit --no-fund; } &&
    npx playwright test -c e2e/playwright.config.ts )
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
