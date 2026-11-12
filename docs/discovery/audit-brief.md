# Audit: the brief path

Area: `app/templates/brief-maker`, `app/templates/campaign-research`, `engine/`,
`server/napkin/brief/`, the OS layer's approve and client_review, and 16 feature records.
Read at d64e0899 by a read-only subagent. No test ran: the one attempted failed on a
missing package in the fresh worktree.

**The headline.** The brief itself is the strongest part of the repo. Messy brief to agency
brief works, with a real Judge behind it. What Phase 1 adds around it does not exist: a gate
that blocks anything, a client who can confirm, a second signer, Territories, and the visual
brief.

| Phase 1 line | What exists | Record and status | Missing |
| --- | --- | --- | --- |
| Messy brief to agency brief | Brief Maker calls `draft_brief` (`server/napkin/handlers/draft_brief.py`). The default flow is extract, plan with research, one whole-brief draft, one whole-brief review (`server/napkin/brief/planned.py`). An optional intake pause asks up to 3 questions | brief-intake-qa, brief-first-draft-checks (building) | Nothing in the flow. The "under 3 minutes" claim is untested on staging |
| Brief check | A scorecard with seven dimensions, pass, vague or missing, a quoted line of evidence checked against the material, and a fix line. It runs on the client's material at extract (`server/napkin/brief/capture.py:587`) | brief-hard-check (verifying) | Its fixes are shown as notes. They do not become questions for the client. Who signs off is never asked. The single-mindedness verdict is stored but not shown |
| Brief gate | No gate object. There is a rubric (`golden_brief.schema.json`), code checks (`rubric.py`) and model checks (`judge.py`). The only thing that blocks is the lock list: a document cannot lock while a bad verdict is unanswered | brief-hard-check, brief-media-measure (building) | A gate that holds Territories shut |
| Gate item: one proposition | Checked: single sentence, within limit, single-minded | | |
| Gate item: insight is a human truth | Checked: seven model checks, including tension and rings true | | |
| Gate item: one measurable objective | Checked: three levels, measurable, linked | | |
| Gate item: feel or do | Checked: all three responses present and laddered | | |
| Gate item: what would make this famous | **Not checked.** The word appears nowhere in the code | | A new check |
| Gate item: effectiveness plan | A required `measurement` field with six checks. Proof is checked through reasons to believe | brief-media-measure (building) | **No baseline check** |
| Sign-off | `/approve` writes one approve decision naming the version, and locks it (`crates/napkin-host/src/ops/review.rs:1694`). One actor per approve | | A second signer. The prompt wants planner and creative director |
| Client confirms | `client_review` exists, on a locked document, citing the approve it answers. An agency person records it; the client is typed data (name, email, channel, evidence) | | A client actor and a link. This is a contract change |
| New version after approval | `/unapprove` with a reason, or reopen one part, then edit and approve again. The label counts approve decisions | spinoff-and-links (verifying) | A Changed brief alert on the brief itself. Today the notice fires only on documents linked to it. No cost in hours and days before saving |
| Research | Campaign Research opens from a brief's Continue in menu and prefills client, audience, background and objectives. A person confirms them | research-new-ui (verifying) | Market, brand and proposition are not carried, though the record says they are. It opens from a brief in any state, not only a confirmed one |
| Territories | A record only: designed, approved by Sai on 2 Nov 2026. A text pipeline on owned data that gives 3 to 5 territories. Its design draws on "award and IPA/Cannes data" | territory-tool (designed) | All code. Its use of Cannes data now breaks section 8 and must change. Its next_step contradicts its approved_by |
| Visual brief | Nothing | none | All of it |
| Judge | Per field: code checks plus one model call. Whole brief: coherence and a definition of done. Health from 0 to 100. Verdicts are written as verdict decisions with a reason code | brief-hard-check | The score out of 30 with idea, craft and effect is a different scale and a new gate |
| Retrieval trace | The run log records a count of hits per retrieval, not each hit. `source` is kept only for passages a decision cites | | A per-brief list of every hit with its source. Test 12 needs it |
| Attribution | The Brief Maker always sends an agent and an action. But the host records a decision only when the body names an agent (`crates/napkin-host/src/ops/edit.rs:167`), and the CLI has `--no-decision`. So a write can be missing from the chain | redraft-provenance (verifying) | Test 11 cannot be proved by reading the chain alone. `edited_by: human` exists only for text patches; structured edits use `agent: human` |

## Where the prompt is wrong about the code

1. **"Build on the existing BetterBriefs scorecard; do not write a second one."** There are already two in the live path. One scores the client's material at extract. The review agent scores the draft on the same seven dimensions and, on reading the code, overwrites the first in `review.scorecard` (`planned.py:1037-1073`). A third, `score_betterbriefs` in `engine/parse_brief.py`, runs only on the engine path. The prompt names the third. The feature record must name which one Brief check extends.
2. **"The planner and creative director sign."** One approve, one actor.
3. **"Signing is an approve decision, which locks it. Client confirmed is a client_review decision."** `client_review` needs a locked document. So the order is fixed: the agency signs first, then the client confirms. The prompt's order (client confirms, then both sign) cannot run on the contract as it stands.
4. **"Before it is saved, it shows its cost in hours and days."** No code, and nothing to compute it from: there is no scope or rate card.
5. **"Territories stay closed until the brief passes."** Nothing enforces it and no Territories tool exists.
