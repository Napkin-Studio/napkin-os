# territories-local launcher: resume notes (2026-11-24)

Branch: feat/territories-local-full (from feat/territories d3064114), pushed, ls-remote matches.
SHA: 3533bd927309dfac902f13b3cc9f046da2bd79e8
Worktree: /home/batunii/Documents/Code/napkin-wt-t-local (kept; has untracked node_modules symlinks/copies in app/, production-tool/* from the owner's worktree, do not commit; delete before any npm ci or they would clobber the owner's modules)
No wip commit needed: everything is committed and pushed, pre-push checks passed.

## Done
- Look-ups search the web through model-local's research port (mock-backend research family, claude -p WebSearch/WebFetch); middleware pointed by NAPKIN_RESEARCH_URL. No new service.
- Research port keeps only URLs the CLI's tools returned (common._seen_urls, research_port). Tests: mock-backend/tests/test_research.py, server/tests/test_research_local.py (fake claude on PATH + middleware ResearchPort).
- market "" accepted as an open look-up (Territories sends none when the brief has none); absent/UK still 400, contract suite unchanged; docs/contracts/peripherals.md row updated. OWNER TO CONFIRM this contract choice.
- scripts/territories-local.sh also runs the Production relay (:8393) and /production behind roster sign-in dev@napkin; Runway only with RUNWAY_API_KEY in env, cap PRODUCTION_LOCAL_MAX_USD (default 10); TERRITORIES_PRODUCTION=0 opts out. run-production-local got a `build` command. README + header updated. Feature log written.
- Live (my stack 8999/8995/20597/8993, now stopped): look-up gave 4 real CSO quotes, pinned one; Send to production landed on the Production canvas with the route node. Screenshots: /home/batunii/Documents/napkin-local-keep/t-local-full/shots (13, 15, 19, 20).

## Left (in order)
1. Real-Runway picture check (at most one, cap $1): needs RUNWAY_API_KEY in env; write to t-local-full/paid.log first. NOT done, no key was in env; no paid call was made.
2. Open a PR into develop (CLAUDE.md flow) if the owner wants it; do not merge into feat/territories.
3. Known pre-existing failure: mock-backend tests.test_search_jev FetchReasons (fails on the owner's tree too).
4. Each "Continue in -> Territories" makes a new exploration; 3 exist in my test data (harmless).

## Next command (owner stack, own ports)
cd /home/batunii/Documents/Code/napkin-wt-t-local && RUNWAY_API_KEY=... PRODUCTION_LOCAL_MAX_USD=1 TERRITORIES_LOCAL_DIR=/home/batunii/Documents/napkin-local-keep/t-local-full TERRITORIES_WEB_PORT=8999 TERRITORIES_MW_PORT=8995 MODEL_LOCAL_PORT=20597 TERRITORIES_RELAY_PORT=8993 NAPKIN_WEB_BIN=/home/batunii/Documents/Code/napkin-wt-territory-plan/target/debug/napkin-web scripts/territories-local.sh
(then sign in as dev@napkin; Ctrl-C stops everything)

## Open questions
- Accept market "" for open look-ups, or should the Territories UI send a market?
- Roster sign-in is now needed locally (Production requires accounts); fine for the owner?
