# Napkin Studio: the new UI (mock)

The clickable mock the owner approved on 8–9 Nov 2026, which the rework in the real app follows.

- Open `napkin-app-v1.html` in a browser, from this folder (it loads `identity-v4/` for the Deep O and the agent spheres).
  Deep links: `?tool=desk|client|brief|research|deck&step=home|prompt|loading|output&brand=wk|tbwa|ogilvy|harbour|droga|napkin`.
- It is generated: `cd app-build && python3 build_app_v1.py` rebuilds it from `studio-tools-v1.frozen-1812.html`
  by applying `phase2.py … phase34.py` in order (exact-string edits). Change it by adding a phase; never hand-edit the HTML.
- `sweep/` holds the last pass before commit: the feature-parity audit (real app + old mocks vs. this UI), the breakage
  sweep, the code map onto `app/`, the backend gaps, and the verifier's report.
- The rework is split into feature records: `features/new-ui-shell.clan`, `brief-new-ui.clan`, `research-new-ui.clan`,
  `os-source-card.clan`, `spinoff-and-links.clan` (all `exploring`, awaiting the owner's approval).

Owner rules carried into the rework: no feature that exists today is taken out or hidden; documents stay paper while the
agency's colours theme the app (light and dark); details live in panels, not on the document.
