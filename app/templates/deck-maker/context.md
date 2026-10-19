# Deck Maker: a pitch deck from a brief

We are making a **pitch deck** from three inputs and nothing else (ADR 0023): the user's prompt (client, project, agency), the research tool's output and the brief tool's output.

The engine is `engine/deck/`. It writes `deck.json`, `validation.json` and `report.json`; this document holds them as `deck`, `validation` and `report`. The view renders from `shared/data.yaml`. Do not generate or edit HTML.

Rules the view and any agent keep:
- Every number on a slide traces to the research, the brief or the prompt. A claim with no source is labelled an opinion, proposal or creative line, never hidden.
- A finding a person rejected is never used on a slide.
- What only the user knows (presenter, budget split, agency name) stays a labelled placeholder such as `[Agency]`. It is never made up and the view has no way to fill it for the user.
- A gate (storyline, territory, idea) stops the run until a person approves. Approve, edit and retry are each one attributed decision. Nothing past an open gate runs.
- Optional team-library inputs (brand kit, pictures) stay off until ADR 0027 is approved.
