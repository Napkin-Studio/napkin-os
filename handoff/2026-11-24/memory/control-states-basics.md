---
name: control-states-basics
description: "Owner 2026-11-24 — every action control must show honest states (disabled+reason, enabled=primary as soon as input is valid, busy, done/failed in words); check in light AND dark theme"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 5f9369b1-b1e6-4fd3-b44c-d946c8ad0c67
  modified: 2026-11-23T19:30:26.069Z
---

Every input + button pair and every action button must have honest, visible states:
- **Disabled**: visibly off, with the reason in words right beside it (never just a grey pill).
- **Enabled**: the moment the person types something the control can act on, it switches to the page's primary style; Enter works.
- **Busy**: "Looking it up…"/spinner, disabled.
- **Done / failed**: said in words.

**Why:** the owner typed into the Territories look-up box and "Look it up" stayed grey (2026-11-24): "the button doesn't change color when typed? Why are you forgetting the basics of design". The owner uses the DARK theme.
**How to apply:** every UI build and mock checks control states (before/after typing) in light and dark, with a test that typing enables the primary style; agents audit all controls on a page, not just the reported one. Relates to [[post-build-live-testing]], [[build-matches-mock]].
