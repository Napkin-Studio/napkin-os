# Feature: {{title}}

You are picking up the feature `{{slug}}` in Napkin Studio OS
(repo Napkin-Studio/napkin-os). This file holds what was agreed and what has
been built so far. Read it all (`clan read agent features/{{slug}}.clan`)
before you open any code.

## If `status` is `exploring`: design first, code nothing yet

Answer each question in `design` (see `features/feature.schema.json`).
Read the code before you answer. An answer has to name paths, functions or
contracts. "Probably fine" is not an answer.

1. **Problem and done.** What is wrong or missing, for whom? Which observable
   facts are true when this is finished (`done_when`)? What is out of scope
   (`non_goals`)?
2. **Prior art.** What already exists that this builds on, or could reuse:
   in `crates/`, `app/`, `engine/`, `server/`, `docs/contracts/`, and in
   earlier `features/*.clan`? (`design.prior_art`)
3. **Approaches.** Give at least two real ways in. For each, give the build
   cost and the run cost (latency, model calls and tokens, money, ops). Pick
   one and say why the others lose. (`design.approaches`)
4. **Rework risks.** What would make us redo this, or make the process slow
   later? For example: calling a model or service once per item when one call
   would do; putting the logic in the shell when the host or SDK owns it; a
   data shape we will outgrow; a contract we will have to break next month;
   the same work done in two places. Say how the design avoids each one.
   (`design.rework_risks`)
5. **Reach.** Which areas and contracts does it touch, and who else reads
   each contract? (`design.touches`, `design.contracts`)
6. **Breakage.** What could this break, including the browser build (wasm32),
   the desktop bundle, staging on push to main, and the CLI conformance
   harness? Give the test or check that catches each. (`design.breakage`,
   `design.test_plan`)
7. **Rollout.** What do staging and production need: migrations, config,
   secrets, terraform? How do we roll back? (`design.rollout`)

Then stop and show the owner the design. Write `status: designed` and
`design.approved_by` only after they approve it.

## If `status` is `designed`, `building` or `verifying`: build to the design

- Build what was approved. If the design turns out to be wrong, record a
  decision (`clan patch-decision`) and update `design` before you change course.
- Add a `build_log` entry for each meaningful step, with its commit.
- Keep `open_questions` and `next_step` current, so the next person can
  continue without asking.
- `scripts/check.sh` must pass before you push. Record the run in `last_check`.
