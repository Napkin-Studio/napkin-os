---
name: production-tool-providers
description: "Production Tool backends: Runway is the only paid provider since 2026-10-13 (fal/HeyGen removed); the floor fallback stays generic for future labs"
metadata:
  node_type: memory
  type: project
  originSessionId: 7bc8bbbd-c824-44c4-8437-6b45cfd195e7
  modified: 2026-10-13T15:12:03.960Z
---

Production Tool backend roles:
- 2026-10-14: ElevenLabs added as the second provider (direct API, for voices/VO/SFX/music/alignment), per the sound integration; Runway remains the only image/video generator.
- Since 2026-10-13 (PR #73, features/drop-hackathon-extras.clan) Runway is the only paid provider; fal, HeyGen and participants' own keys are gone. The hackathon build is at git tag hackathon-2026-10.
- The Runway-floor fallback (Job.fallbackFrom/fallbackReason) stays generic, so a future lab (ElevenLabs etc.) is a new adapter plus a capability sheet.
- The tool has no sign-in of its own: relay/identity.py fails closed (401) until the Napkin OS sign-in is wired in; do not deploy the Production Tool stack before that.

**Why:** Runway is the long-term platform; the extras were for the event and proved fragile (2026-10-08/09).
**How to apply:** plan generation features on Runway's API; treat other providers as later additions. Related: [[production-tool-overhaul]], [[design-before-code]].
