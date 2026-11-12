# Idea room: the team's ideas first, then routes, then the creative director's pick

This document is **one room for one job's ideas**. It is spun off from a Brief Maker brief that has passed the Brief gate and been confirmed by the client, so the brief is carried whole under `data.upstream.<brief id>` (read-only): the room shows the insight and the proposition every card answers.

The room's data is written by the host's own operations, never by a patch. A patch that names `cards`, `routes`, `routes_out`, `chosen` or `ai_open` is refused.

- `cards`: `{<id>: {text, by, kind, at, brief_link{insight, proposition}, votes[], comments[], tests{}}}`. `kind` is `team` (a person wrote it), and later `banned` and `ai`. `by` is the person's id, read from who was signed in, never from a request body. Votes are counted per card, never per person.
- `ai_open`: set only when the creative director opened the room early: `{state: early, by, decision, at, reason}`.
- `routes_out`: the routes that are branches not merged yet. While any is out the room itself takes no write.
- `routes`: `{<id>: {name, bet, cards[], notes[], version, branch}}`. A route is a fork: its id is the branch's agent id, and it is worked on in the branch's own namespace. Merging folds every branch back with the SDK's deterministic merge, no model; a clash is listed in `merge-report.yaml` with both sides.
- `chosen`: `{route, version, decision, by, at}`, written only by the host's pick, which is one verdict decision by the creative director the brief names, on that exact route version. A second pick needs a reason and supersedes the first; the first stays in the history.

Rules the page and any agent keep:
- Humans first. No model idea reaches the room until five team cards are written by people, or the creative director has opened it early with a reason. The host checks this in front of the model call.
- Every write names an agent and an action.
- Banned cards (the ideas any agency would have) cannot be voted on or put in a route.
- No Cannes, Effie or WARC material is quoted in the room.
