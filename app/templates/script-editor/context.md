# Script editor: a writer's page

This document is **one script**, in one of five formats: a headline, body copy, social, a radio script or a two-column TV script. It is spun off from a Brief Maker brief that has passed the Brief gate. The brief is carried whole and read-only under `data.upstream.<brief id>`, and its proposition is lifted into `proposition`.

The page's own fields:
- `format`: `headline`, `body`, `social`, `radio` or `tv`. `slot_s`: 10, 20, 30 or 40 seconds, for radio and TV.
- `script.beats`: the lines, each with a stable `id` (`b1`, `b2`, ...). A beat has `kind` (`voice`, `sfx`, `music`, or `line` for the untimed formats), `role` (`FVO`, `MVO` or `VO`, for a voice), `text`, and for TV `visual_action`. A beat keeps its id when its words change, when it is split (the first half keeps it), joined (the earlier beat keeps it) or moved. A new beat gets a new id and an id is not given twice.
- `script.proposals`: every suggested change to one beat, whoever made it. `{id, beat, was, text, kind, note, by, at, status: open|accepted|rejected, answered_by, answered_at}`. `was` is the words the proposal replaces. Only a person writes through `POST /script/propose` and `POST /script/answer`; the host takes the author from the session, and an accept is refused `409` when the beat no longer says `was`.
- `checks.mandatory` and `checks.banned`: lines the copy must carry and words it must not use, typed on this document. The brief's own mandatories are read from `data.upstream`.
- `handoffs.radio`, `handoffs.film`, `handoffs.judge`: a revision reference `{kind: script, id, revision, content_hash}` for the exact version sent. `film.script` is the Advertising Studio script (`current`, `revisions`) that Send to Film lifts into the Film document, every beat under the same id.

Rules the page and any agent keep:
- The live check lists findings from `house-style.json` and never changes a person's words. Radio notation is read as typed (FVO, MVO, VO, SFX, MUSIC and their aliases).
- Approving is one `approve` decision by the creative director named on the brief; it locks exactly that version. A change after approval is a new version: reopen, edit, approve again. Hand-offs may be recorded on a locked version.
- An AI never writes a beat. A rewrite arrives as a proposal and reaches the page only when the writer accepts it.
- No em or en dash in anything shown. No Cannes, Effie or WARC material. Every write names an agent and an action.
