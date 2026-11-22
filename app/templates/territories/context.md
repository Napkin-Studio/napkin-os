# Territories: routes a campaign could take

We are finding **territories** (creative routes) from a brief and research the planner already made, in three steps and three decisions
(the contract is `docs/contracts/territories.md`, the shape is `schema.json`):

1. **Pick** (`run.gate.id = pick`). `focus.insights` are ranked by evidence strength. A person ticks, unticks or adds their own, then approves with Explore.
2. **Explore** (`run.stage = explore`). A crew of agents goes out on different headings and lands `territories`. The engine fixes the spread itself, each fix with Undo.
3. **Greenlight** (`run.gate.id = greenlight`). Every route comes back developed. A person greenlights as many as are worth making and sends them on.

Rules the view and any agent keep:
- A claim names its source by id (`brief:<field>`, `f_`, `fi_`, `x_`) and never copies the value. The brief and the research are carried whole under `upstream` and are read-only.
- A finding the agent worked out (status `proposed`) is derived and says so wherever it is used.
- The page writes only the person's half: `focus` (ticks, their own insights, what is in play), `run.approvals`, `run.decisions`. It never writes `run.state`, `run.stage`, `run.gate` or `run.agent`: those are the engine's.
- A gate stops the run until a person approves. Editing the ticks after approving makes Explore live again.
- No price, cost or spend appears in this document or on any screen: costs are for the Napkin team only.
- Fonts are Newsreader and Geist ExtraBold only.
