---
name: sphere-ring-design-v1
description: "Frozen 2026-10-29 agent look: one morphing sphere, travelling-arc ring (length = completion), progress panel; files in ~/Documents/napkin-design-mocks/sphere-ring-v1"
metadata:
  node_type: memory
  type: project
  originSessionId: d2e32620-2c65-4389-b59d-1524323d25c3
  modified: 2026-11-03T12:50:43.092Z
---

The owner (Shrey) fixed this agent design on 2026-10-29 as "fine for now" and moved on to the entire UI, which may change it. The frozen mock, its source, the earlier labs, a 49 s video and the Runway probe are in `~/Documents/napkin-design-mocks/sphere-ring-v1/` (README there lists what is locked and what is open). It is a mock, not repo code; nothing is committed. `SPEC.md` in that folder (written 2026-11-03) is the replication spec for coding agents: copy the template's shader and tables verbatim, change only the data source and host UI.

Locked decisions:
- One sphere morphing in place between agents (not one sphere per agent), wearing each agent's geometry read from the V0.4 SVG sheet.
- A handoff is one uninterrupted pour; "waiting for the receiver" is shown by the ring and label, never by pausing the motion.
- Ring = a travelling arc that keeps turning. Its length is completion (steps finished, plus provider progress when reported), closing to a full ring when done. Texture (solid/dotted/dashed/ticks), breadth (thin/regular/bold) and colour say what the agent is doing and ease between steps. The earlier full-circle and segmented-dial rings were rejected.
- A side panel carries steps, "step N of M", time left as a range with its basis ("taking longer than usual", never a stuck countdown).
- Mouse: hover light, click ripple, drag squish.

**Why:** the owner wants agents to feel continuous and alive, with a uniform, honest way to say what step and how long. Honesty rule from the V0.4 sheet: no percentage unless the backend measures it.

**How to apply:** start the full-UI work from this mock and the frozen README; change it only if the wider UI needs it, and say so. Open items: step colours (fixed palette beside the agency accent, V0.4 says one accent only); some agent geometry reads as a face (Orchestrator); all numbers are simulated except one Runway probe (a 4 s Veo 3.1 Fast clip took ~50-54 s, progress is a 0-1 fraction, images ~13 s).

Backend work it depends on, none approved or built: [[design-before-code]] applies. Feature record `job-progress` (worktree ~/Documents/Code/napkin-studio-job-progress, branch feat/job-progress, exploring, owner has not approved) for steps, progress and ETA; a separate, unopened streaming feature for thinking/writing/searching/reading. Spent so far on Runway for the probe: 61 credits; the larger clip matrix (about 10 clips, $4-8) was offered and not approved. Relevant: [[local-live-relay]] (never smoke-test on the owner's live relay), [[clean-up-worktrees]] (remove the job-progress worktree once its work is committed).
