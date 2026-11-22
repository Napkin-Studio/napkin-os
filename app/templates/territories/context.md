# Territories: routes for a campaign, from a brief and its research

A Territories document explores routes for a campaign. Its shape is `docs/contracts/territories.md` and `schema.json`; the document is the only state.

**How it starts.** A person starts it with Continue in, Territories, from a Brief Maker or Research Tool document. The host spin-off carries the source whole under
`data.upstream.<source document id>` (the brief's fields and everything the research holds; the facts, findings and sources are merged into this document's own members
and the host builds `data.projection` from them). All of it is read-only: no one writes under `upstream` or `projection`. Brief or research alone also works. A document made
with neither starts from a category and a question.

**Rules every agent keeps.**
- Cite, never copy. A claim names its source (`brief:<field>`, `f_` a pin, `fi_` a finding, `x_` its own find); the value is read from what was carried.
- A new document starts with `run.approvals` empty. A spin-off never carries an approval: no gate is passed before a person passes it.
- A finding a person rejected upstream is never used.
- Brief fields are read by their contract names (`smp`) or Brief Maker's own keys (`single_minded_proposition`); `engine/territory/carried.py` is the one reading.
- The first screen says what arrived in words (counts and the key brief fields), never as field names or "field is null".
- Do not generate or edit HTML.

## What the page writes (Pick)
- The page writes only the person's half: `focus` (ticks, their own insights, what is in play), `run.approvals.pick` and `run.decisions`. It never writes `run.state`, `run.stage`, `run.gate` or `run.agent`: those are the engine's.
- Editing the ticks after approving Pick records an edit, so the approval no longer stands and Explore is live again.
- No figure of money appears on any screen. Fonts are Newsreader and Geist ExtraBold only.
