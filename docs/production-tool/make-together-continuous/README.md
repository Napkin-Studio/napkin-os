# Make together as a continuous move: hand-off

**Status:** designed but not approved, and parked by the owner on 2026-11-25 ("Dont start the build for make together. Let's finish what we have started first."). The design is in `features/make-together-continuous.clan`, with status `exploring`. Read it with `scripts/feature show make-together-continuous`.

**To pick this up:**
1. Ask Shrey the five open questions in the record. Each has a recommendation.
2. Record his answers and approval (`design.approved_by`).
3. Run `scripts/feature status make-together-continuous designed`, then build on this branch.

## What it is

Today, "Make together" makes several shots in one generation with timed cuts, the "one take" mode in `production-tool/relay/connected.py`. The owner wants joined shots to be one continuous camera move: frame 1 → 2 → 3 with no cut, and cuts only between groups. The person picks the groups, and Production suggests them from its existing "continue" join logic.

## The method the tests proved (V4)

1. Make segment 1 from storyboard frame 1 to frame 2, using a model that takes a first and last frame (WAN 3 or Veo 3.1). Use 5 s where the shot allows.
2. Take segment 1's **actual** last frame. If the final 3 frames spike (a snap), trim them first.
3. Draw the next frame from that real last frame: "same camera, a moment later", following the words and keeping the storyboard frame's intent.
4. Make segment 2 from the real last frame to the new frame. Repeat for each further frame.
5. Join on the shared frames.

## Test results (2026-11-25, WAN 3, Copperell fictional brand, $7.96 total)

| Video | How it was made | Result |
|---|---|---|
| A | Today's one take with timed cuts | Cuts cleanly, but ignores storyboard frames 2–3 (SSIM 0.21 / −0.05) |
| B | Frames 1→2→3 chained, 2 × 5 s, joined on frame 2 | Owner: "far superior". The join is seamless. The **end snaps**: the hand vanishes and mist appears in one frame |
| C | A continuous move across a scene change (kitchen → shop) | Owner: "far superior". It morphs like a dreamlike transition |
| X | A cut at every frame (5 clips) | Choppy, about 10 cuts in 14 s; the product drifts between clips |
| Y | Groups made continuous, frames drawn independently | Owner: "not really better than X… maybe worse. Y has glitches". Two snaps, where the frames weren't reachable by the move |
| V1 | Frames redrawn from frame 1 before making | Snaps at the join |
| V2 | Chained from the real last frame, old final frame | Clean join, snaps at the end |
| V3 | Owner's idea: next frame drawn from the real last frame | **No snaps** |
| V4 | B's frames + real-last-frame chain + final frame drawn from it + trim | **No snaps** once the last 2 frames are trimmed |

**Snap measure:** the biggest frame-to-frame change in a segment's last 3 frames, divided by that segment's median change. SSIM at the ends hides snaps, so it isn't enough on its own.

## Files

- `mock/index.html`: a clickable mock with six states (groups, big jump, making, made, storyboard, Edit) and a light/dark switch. The "made" state plays a clip that isn't committed (see below).
- `mock/png/`: every state at 1280, dark and light.
- `tools/`: the test scripts.
  - `run.py`: A/B/C.
  - `run2.py`: X/Y.
  - `run3.py`: V1–V3.
  - `run4.py`: V4.
  - `analyse*.py`: seams and snap measures.
  - `assemble_*.py`: joins and trims.

  They read the Runway key from `~/.config/napkin/runway.key` and never print it. Every paid call is logged.
- **Videos** (189 MB, not committed): on the GB10 machine at the session scratchpad `cont-test/`. The Tailscale viewer was `http://100.89.255.110:8601/tonight/cont-test/index.html`. If they're gone, re-run `tools/run4.py` (about $0.60) to reproduce V4.

## Not yet tested

- Sound across a group. The recommendation is a paid test of about $1 before building.
- Veo 3.1 for the chained method. The tests used WAN 3.
