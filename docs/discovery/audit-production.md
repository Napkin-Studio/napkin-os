# Audit: production tools, decks and the stand-ins

Area: `production-tool/`, `app/templates/`, `engine/deck`, `mock-agent/`, `mock-backend/`,
`mock-middleware/`. A 15-minute triage per tool by a read-only subagent at d64e0899.

| Tool | What it does today | Status | Tests, and what was run | Unfinished |
| --- | --- | --- | --- | --- |
| Production Tool | A browser canvas for character, storyboard and video. A relay holds the job ledger, quotas, queue and spend stop. A director turns clicks into provider jobs. Writes one attributed entry per finished job into a real .clan (`clan-store/src/attribution.ts`) | 9 records building, 5 verifying. Many wait on Shrey's review | `cd production-tool/relay && uv run pytest`, about 30 files, offline. Ran `tests/test_mock.py`: 19 passed | Runway video region edits. Runway clip and region edits never run live. The relay does not run the leak check and paste-back. Not in `scripts/check.sh` |
| Advertising Studio | One template: concepts, script revisions with beat ids, shots, blocking, takes, audio cues, approvals, stale marking | No feature record | No test names it | It is a screen and a contract. No backend in this repo makes anything for it |
| Deck Maker | The engine runs nine stages to a deck, with 28 code checks, then renders PowerPoint, PDF, a web deck and a HyperFrames project. The app is a view over a .clan | 4 records building, deck-ci exploring | `cd engine && PYTHONPATH=. python3 -m pytest -q deck/tests`, 13 files, offline. Ran `test_validate.py`: 32 passed | The app never calls the engine. PDF and PowerPoint export work only from the command line. Territory and idea gate screens are not built. Engine tests are not in `check.sh` or CI |
| Brief Maker, Campaign Research | See audit-brief.md | | | |
| mock-middleware | A stand-in for `server/`: no model, no network, canned output, a frozen clock. The only true fixture mode | | In the `mock-backend` suite | |
| mock-backend | Fakes the model port, research, retrieval, layers and roster. Answers with headless Claude Code, so results are not repeatable | | `contract_test.py` | No recorded replay for model calls |
| mock-agent | A one-pass agent that calls Claude live | | 4 tests pass offline | No fixture mode |

## Answers the prompt asked for

1. **Is the Production Tool harness the recipe runner? No.** It is a per-job provider harness. It has a job queue, capability sheets, lineage (`parent_ids`, `input_hashes`) and one fixed multi-step edit (`region/pipeline.py`). It has no saved named recipe, no step graph and no runner that executes steps in order. The browser drives one step per click.
2. **Cost fields exist**, named estimate, reserved and confirmed (`production-tool/contracts/common.schema.json`), in US dollars. The relay reserves at submit and confirms on completion, with one global cap. There are no credits, no tiers, no per-job or per-agency cap and no list price beside the charge.
3. **No result cache** keyed on model, prompt, seed and inputs. Only Anthropic prompt caching.
4. **Deck Maker exports PDF and PowerPoint from the command line only.**
5. **Advertising Studio binds script approval to an exact revision.** Blocking and takes are not bound that way, so "each approval" overstates it.
6. **Capability sheets exist for Runway and the mock only** (`production-tool/contracts/capabilities/`). None for fal, HeyGen, ElevenLabs, Black Forest Labs, World Labs, NVIDIA, Luma or ByteDance. The fal and HeyGen adapters that several records describe are not in this tree.

## Where the prompt is wrong about the code

- "The Production Tool harness, with each recipe as a template" (section 10): the harness is not a runner. A runner is new work.
- Sketch, Standard and Hero tiers, the cost ledger, credits on the button, the monthly cap and the result cache: none exists. v3 writes about them as if the base were there.
- There are two model interfaces, not one: the middleware's generation port and the Production Tool's Provider interface.
- Deck Maker's "three modes" (client presentation, strategy deck, Pitch maker) are not in the code. Its types are agency pitch, investor seed, credentials and tender response.
- "Renders to HyperFrames video": it writes a HyperFrames project, not a rendered film.

## A side effect to clear

Running the relay test rewrote `production-tool/relay/uv.lock` in the worktree. The file was
already known to be stale. It is not staged or committed by this run. Restore it with
`git checkout -- production-tool/relay/uv.lock`.
