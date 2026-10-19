# Contract — Deck Maker run

Status: **draft** · Feature: `features/deck-maker-ui.clan` · Owner: Sai
Readers: the Deck Maker app (`app/templates/deck-maker/`), the future server feature that runs the
engine, and `engine/deck/`.

The app is a view over one `.clan` document. It never calls the engine; it reads `shared/data.yaml`
and writes attributed patches (`clan.patchData`). Whatever runs the engine writes the same fields.
Every shape below is the engine's own, except `run`, `evidence` and `exports`, which hold what the
screens need around it. Schema: `app/templates/deck-maker/schema.json`. Sample:
`app/templates/deck-maker/example/data.yaml` (checked against `engine/deck/deck.schema.json` by
`engine/deck/tests/test_deck_maker_fixture.py`).

## Fields

| Field | Written by | Source |
|---|---|---|
| `inputs.prompt` `{client, project, agency}` | the app | Start screen. An empty agency shows as `[Agency]` |
| `inputs.research`, `inputs.brief` | host | the two attached documents (names and counts) |
| `inputs.kind` `agency\|investor`, `inputs.format` `pitch\|full` | the app | `run_deck --kind`, `--format` |
| `inputs.library.enabled` | nobody yet | ADR 0027 (proposed). Off |
| `run.stages[]` `{id,name,sub,status}` | the runner | `engine/deck/stages.py` |
| `run.gate` | the runner | the open gate, or `null` |
| `run.approvals.<gate>` `{by, at}` | the app | on Approve |
| `deck` | the runner | `deck.json` (+ `appendix_count`) |
| `validation` | the runner | `validation.json`: `errors`, `to_supply`, findings by slide |
| `evidence.<ref>` `{kind,text}` | the runner | what each cited ref says, resolved from the inputs |
| `report` | the runner | `report.json`: `seconds`, `tokens`, `cost_usd`. The app shows these, never an estimate |
| `exports.web\|pptx\|anim\|pdf` | the runner | file names, once written. Absent means "Not built yet" |
| `change_requests[]` | the app | an Ask-for-a-change click: `{slide, change, at, status}`. Words only; sources stay |

## Gates

A gate stops the run. `run.gate` names it and every stage after it is `next`, never `now`
(`DeckLogic.gateHolds`). Approving writes one patch: the gate's stage `done`, the next stage `now`,
`gate: null`, `approvals.<gate> = {by, at}`, with the decision `approve <gate>`. Only the open gate
can be approved. Edit beats and Ask Dex to try again are specified here and not yet built: each is
one attributed decision (`edit <gate>`, `retry <gate>`) that the runner acts on.

## Rules the screens keep

- Inputs are the prompt, the research and the brief (ADR 0023). The library panel is off.
- A placeholder (`human: true`, or text of the form `[…]`) shows as "To supply". The app has no
  control that writes one.
- A line with no source is labelled opinion, proposal or creative, never hidden and never flagged
  as an error (the engine's `bare_claim` rule).
- A ref the run holds no evidence for shows as "not found", never skipped.

## Not in this contract yet

The runner (middleware tasks `build_deck`, `approve_gate`, `ask_change` in the template's
`app/pipeline.yaml`), the territory and idea gates' screens, and file delivery for `exports`.
They need the server feature.
