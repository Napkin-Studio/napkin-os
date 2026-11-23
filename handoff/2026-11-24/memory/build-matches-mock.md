---
name: build-matches-mock
description: "A UI rework is done only when each built screen matches the approved mock, checked by me in paired screenshots; passing tests and bug-free flows don't count"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 4095bf40-0248-4153-a500-f8291656ce95
  modified: 2026-11-09T04:59:42.511Z
---

On 2026-11-09 I pushed feat/new-ui (PR 151) as the new UI, with all tests green and three rounds of end-to-end bug testing passed. Shrey opened it, and no screen matched the mock in design/new-ui/napkin-app-v1.html. The tool still looked like the old tool. He asked whether I had run anything at all.

**Why:** the feature designs described the rework as changes to the existing components, for example "ClientsPage gains a dial state". The builders followed those designs. All the testing checked behaviour and bugs; none of it compared the build with the mock. The records' test plans promised screenshot comparisons against the mock, but nobody ran them and I never checked that anyone had.

**How to apply:**
- The mock is the specification. Each screen and state needs a mock-vs-build screenshot pair, and I look at the pair myself before calling the screen done or pushing.
- Brief builders with the mock screen and its phase files (design/new-ui/app-build/phase*.py), not a summary of the design.
- Before handing off, check that every test promised in a feature record's test plan actually ran.
- Related: [[verify-ui-before-handoff]], [[design-before-code]].
