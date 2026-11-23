---
name: keep-merged-branches
description: "Never delete a branch after it merges (local or remote); the owner overrides CLAUDE.md's \"delete branches after they merge\""
metadata:
  node_type: memory
  type: feedback
  originSessionId: 4095bf40-0248-4153-a500-f8291656ce95
  modified: 2026-11-11T06:10:15.699Z
---

On 2026-11-11 I deleted the remote `feat/new-ui` branch after squash-merging PR 151 into develop, following CLAUDE.md's "Delete branches after they merge". Shrey: "why delete the branch new UI? Can you undo it and push it as well?" When I asked whether to stop deleting merged branches in general, he said yes.

**Why:** he wants merged branches kept, on GitHub and locally.

**How to apply:**
- After a merge, leave the branch in place, both the remote and the local one.
- Only delete a branch when Shrey asks for that specific branch.
- Removing a finished worktree folder is still fine; the branch stays. See [[clean-up-worktrees]].
