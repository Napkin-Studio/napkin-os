# Laurence's planning skills

Seven skills Laurence sent on 25 Oct 2026 ("Napkin planning and design skills (for Sai and Shrey)"), installed as
project skills so anyone using Claude Code in this repo can use them. The text is exactly his, split into one folder
per skill and its reference files. Section 3 of his document; his design-skills list (section 4) is not here.

| Skill | Where it is used |
|---|---|
| `strategic-planning` (+ 3 references) | Brief Maker: the insight and proposition tests, the job, barrier and objection, Jude's review (ADR 0034, 0035) |
| `media-planner` | Brief Maker: budget wording; the role of each medium and how we will know it worked are next (not built) |
| `competitive-brief` | Brief Maker: the competitor context wording |
| `strategic-territories` | Deck Maker territories prompt (not yet changed: Shrey's lane) |
| `campaign-plan` | A step after the brief (not built) |
| `content-strategy`, `monday-brief` | Written for business owners with sales-data connectors; no tool yet |

Things to know before relying on them:
- They refer to skills and files that are not in this pack: `human-pass`, `social-content-engine`,
  `creative-direction`, `presentation-design`, `report-builder`, `business-pulse`, and a `CONNECTORS.md`.
- `campaign-plan`, `competitive-brief`, `content-strategy` and `monday-brief` read as written for another toolset
  (connectors, battlecards, sales data). Their licence and origin have not been confirmed with Laurence.
- These are development-time skills for people and coding agents. The product's own agents (Ellis, Sam, Dara, Jude)
  read their rules from `server/napkin/brief/` (the schema, `planned.py`, `checks.py`), not from here.
