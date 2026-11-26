# Brand Clan: the Brand Bible of one look of one client's brand

This document is a **Brand Clan** (`ie.napkin.brand`): one look of one client's brand (Original, Zero, Summer 26), in one agency. It holds the Brand Bible: logos, colours, typography, voice (tone and rules), imagery style and bans, the source file, and four empty provisions (previous work, categories explored, likes and dislikes, preferences). Contract: `docs/contracts/brand-clan.md`.

Rules every view and agent keep:
- `shared/data.yaml` is the **published** version only (`kit.version`). It changes only when a person publishes or accepts a version. Never write a draft or a proposal into it; they live in `app/brand/state.yaml`, and old versions in `app/brand/versions/`, read-only.
- Work documents hold a frozen copy and an Update chip. Nothing in work changes until a person presses Update.
- Empty beats wrong: a section you cannot find stays empty and is listed in `gaps`. Never invent a colour, a font or a rule.
- Every list item has a stable `id`. Colour `role` is a deck token (accent, paper, ink, panel, accent_ink) or `chart`/`other`.
- A person's edit, publish or accept is a decision with their name. An agent never publishes.
- Confidential: the bible is the client's material. It never goes to shared layers, RAG, evals or run-log bodies.
