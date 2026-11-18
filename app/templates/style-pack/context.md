# Style Pack: the look of the pictures (and, optionally, the deck)

This document is a **Style Pack**: the one thing that decides how the pictures of a pitch look, shared by the Territory tool and the Deck Maker (deck-look-kits). Laurence owns it. It has versions, attribution and an update notice, like any attached document.

It holds look words, palette words, this-not-that pairs, a finish (photo-real or rough), banned imagery, notes, reference images with their rights, model tiers, and an optional `deck` section of colour and type pointers. **It holds no word, number, name or legal line that reaches a slide.** A pack never changes what a deck says (ADR 0023 as amended by ADR 0027).

Rules every view and agent keep:
- Only a **steward** (`kit.stewards`) may change the pack or mark a reference `own` or `licensed`, and must give a reason (`why`). `licensed` also needs a holder and terms. An agent never sets rights.
- Only `own` and `licensed` references are ever sent to an image model, at most 14 (the first 14 by name). `client_supplied` and `reference_only` are for eyes only.
- `models` pick from the existing catalogue only (`gemini_image3.1_flash`, `gemini_image3_pro`). The deck's per-deck cap still applies.
- The guard rails (no logos, no brand names, no readable text in a frame) live in code and are never in the pack.
- A pack change is an attributed decision, not an appearance edit: rights and models decide what leaves and what is spent.
- The `deck` section is empty by default. Pointers first (`{brand: <colour id>}`, `{agency: base|accent}`), a literal (`{hex}`, `{family}`) only for a pitch with no brand kit.
- Pictures are never remade on their own after an update: the deck says what changed and the person chooses.
- The style hash is computed by `engine/visuals/style.py`; `kit.published.style_hash` is a display stamp only.
