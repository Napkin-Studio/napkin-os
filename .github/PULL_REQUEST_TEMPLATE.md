<!-- Title = the squash commit subject: `<area>: <imperative summary>`, ≤72 chars. -->

## What and why

<!-- What changes for the user or the code, and why. -->

## Feature record

`features/<slug>.clan`, status: <!-- designed / building / verifying / shipped -->
<!-- or "Feature: none" for a typo-sized fix -->

- [ ] The design was approved before the code (`design.approved_by`)
- [ ] `build_log`, `open_questions` and `next_step` are current
- [ ] If the work drifted from the design, a decision records why

## How verified

<!-- The commands and their results: scripts/check.sh (which suites), plus any manual run. -->

## Definition of done

- [ ] `scripts/check.sh` passes, and CI is green
- [ ] There is a test for the new or changed behaviour. No old test was deleted, skipped or weakened to get green.
- [ ] No paid or live model call in tests (mocked or replayed)
- [ ] Docs, contracts (`docs/contracts/`) and `napkin-studio.clan` are updated, or "N/A because …"
- [ ] Safe to deploy: merging deploys staging

## Notes for reviewers
