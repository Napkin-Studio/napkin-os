# Visual Brief: one page from the chosen territory

This document is **one page**: the territory a creative director will take to stills, film and radio, written down so it can be approved once and then not drift. It is spun off from a Brief Maker brief that has passed the Brief gate, so the brief is carried whole under `data.upstream.<brief id>` (read-only) and the brief's proposition and tone are lifted into this page's own fields.

The page's own fields:
- `territory`: `name`, `line` (one sentence), `source` (`typed` for a territory written by hand, `territories` for one the Territories tool made), `chosen_by`.
- `proposition`: a string, lifted from the brief's single-minded proposition.
- `tone`, `must_show`, `never_show`: lists of short lines. `tone` is lifted from the brief's tone and world; `must_show` and `never_show` use the Production Recipes names for product and brand rules, so a recipe can read them.
- `reference_frames`: up to three slots `a`, `b`, `c`, each `{asset, path, caption}`, an image a person uploaded. Nothing here generates an image.

Rules the page and any agent keep:
- Approving is one `approve` decision by the creative director named on the brief, and it locks exactly that version. A write to a locked page is refused. A change after approval is a new version: reopen, edit, approve again. The approved version stays in the history as it was.
- Every image sits in a rectangle, corners no rounder than 2 px. Never a circle, never a pill.
- No Cannes, Effie or WARC material is quoted on the page.
- Every write names an agent and an action.
