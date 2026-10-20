# Deck Maker: a pitch deck from what you give it

We are making a **pitch deck** from what the person gave and nothing else (ADR 0023, amended by 0028): their prompt (client, project, agency and an open text of any length), the documents they attach, and, optionally, the brief tool's and research tool's output, frozen at `data.upstream` by a spin-off (read-only). A deck builds from any one of these. The brief and research cards are derived from `upstream`, never stored. Outside facts enter only through the Research Tool, and only when the person says yes: the Strengthen button records `research_request` and launches nothing.

The runner's intake (`intake.gaps`, `intake.questions`) is shown on Start; the person's answers are written at `intake.answers.<qid>`. A skipped or unanswered question never blocks a build.

The engine writes the deck-type question `q_deck_type` first. Start shows it as the "What kind of deck?" selector (agency_pitch, tender_response, investor_seed, credentials); the person's choice is written at `intake.answers.q_deck_type`, and `inputs.kind` is derived from it (investor_seed is investor, the others agency). Skipping defaults to agency pitch.

The engine is `engine/deck/`. It writes `deck.json`, `validation.json` and `report.json`; this document holds them as `deck`, `validation` and `report`. The view renders from `shared/data.yaml`. Do not generate or edit HTML.

Rules the view and any agent keep:
- Every number on a slide traces to the research, the brief or the prompt. A claim with no source is labelled an opinion, proposal or creative line, never hidden.
- A finding a person rejected is never used on a slide.
- What only the user knows (presenter, budget split, agency name) stays a labelled placeholder such as `[Agency]`. It is never made up and the view has no way to fill it for the user.
- A gate (storyline, territory, idea) stops the run until a person approves. Approve, edit and retry are each one attributed decision. Nothing past an open gate runs.
- Optional team-library inputs (brand kit, pictures) stay off until ADR 0027 is approved.
