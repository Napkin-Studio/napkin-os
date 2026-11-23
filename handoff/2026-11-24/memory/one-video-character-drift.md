---
name: one-video-character-drift
description: Live test 2026-11-16 — one-video takes pinned on frame 1 lose the character after the first cut; take_refs keeps identity; generation and cut detection are accurate
metadata:
  node_type: memory
  type: project
  originSessionId: 5f9369b1-b1e6-4fd3-b44c-d946c8ad0c67
  modified: 2026-11-16T11:09:57.795Z
---

Live test on 2026-11-16 (own stack 8191/8888, b2632e15, Mira project, $8.90 spent):
- Runway generation and relay cut detection are accurate: takes come back at the planned length, cuts within ~0.03–0.1 s (some missed → window falls back to plan).
- **Take pinned on frame 1 (mode take) drifts the character after the first cut** on both WAN 3 and Seedance 2.5 (silver hair → blonde by shot 3). The design sends no refs beside a frame (relay connected.py) and ignores storyboard frames 2+.
- **take_refs (no frame, character pictures as refs) keeps identity** across shots, but ignores the storyboard frames and leaked the character sheet's text/swatches into the video.
- Per-shot clips each pinned on their own (consistent) frame keep identity.
- Seedance 2.5 take cost $4.50 for 15 s vs WAN 3 $1.50.
- Bugs found and fixed on feat/production-tool-land: makeTake dropped script-linked characters (refs: [] → relay 400), Box tab offered Omni Flash (10 s) for a 15 s box, blank-project Write the script was dead, own projects reopened on Excalidraw.

**Why:** the owner said one-video "has never worked as expected"; this is the evidence.
**How to apply:** any redesign of Make as one video must decide frame-pinned vs refs (or a hybrid: frames as composition refs + character refs); don't re-run the same paid matrix. Findings list: the session scratchpad live/findings.md (temporary). Related: [[production-tool-overhaul]], [[own-engine-default]], [[local-live-relay]].
