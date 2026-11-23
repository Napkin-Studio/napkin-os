---
name: delayering-feature
description: "Delayering (object layers from generated images): research and design done 2026-10-23, record features/delayering.clan awaiting Shrey's approval; Pencil's feature is Seedream 5 layer separation; code integration branch is feat/production-tool-v2"
metadata:
  node_type: memory
  type: project
  originSessionId: 1522c266-f059-4704-8b49-e61bb8231199
  modified: 2026-10-23T18:06:18.388Z
---

Delayering research and design (2026-10-22/23): `docs/production-tool/delayering-research-2026-10-22.md` (sections 8a results, 9 questions), sweep files in `docs/production-tool/delayering-sweeps/`, feature record `features/delayering.clan` (status exploring, design written, `approved_by` empty), test script `production-tool/relay/scripts/delayer_tests.py` with results in `production-tool/relay/results/delayer-tests.md`. All on the `feat/production-tool-overhaul` worktree, uncommitted as of 2026-10-23 evening.

**Why:** Pencil's "delayering" (trypencil, LinkedIn post 2026-10-21) is ByteDance Seedream 5 layer separation behind their UI; Runway has it web-app only. Owner decisions 2026-10-23: on demand (a Split into layers action), cut-outs plus Runway fill with no GPU, prototype and Runway tests approved (not product_swap). Measured on Runway: Ideogram 4.5 maskUri makes a clean plate at the input size (8 cr); Seedream 5 Pro plain words also (5 cr); Sunburst transparent is faithful but its alpha never reaches 255 and has an 18% near-opaque halo (re-matte needed); transparent references are flattened to a checkerboard; Magnific keeps alpha; gpt_image_2 transparent fails unbilled; Bria FIBO returns flat white.

**How to apply:** Design approach A = layer records on the frame version (fractional rank, signed pixel transform, composite stays frames.asset) with server-first ML (BiRefNet-lite, SAM 2.1 tiny, MI-GAN on the relay CPU), browser ML only behind a first-run timing gate. Next: owner approves, then `scripts/feature status delayering designed`, cut `feat/delayering` from `feat/production-tool-v2`, PR 1 contracts + layer model. Do not reopen Runway-only, the licence rule, no-prices-in-UI or iPad server fallback. See [[production-tool-providers]], [[production-tool-overhaul]], [[verify-ui-before-handoff]].
