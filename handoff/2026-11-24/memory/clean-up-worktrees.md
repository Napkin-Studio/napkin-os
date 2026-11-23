---
name: clean-up-worktrees
description: "Remove each agent/feature worktree as soon as its work is committed and done, keeping the branch, so disk is not used up"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 7bc8bbbd-c824-44c4-8437-6b45cfd195e7
  modified: 2026-10-14T21:29:37.346Z
---

Remove a git worktree as soon as we are done with it: once its agent has finished and everything is committed (`git worktree unlock` if this session's agent lock remains, then `git worktree remove`, then `git worktree prune`). Keep the branch. Before removing, stop the agent's task (TaskStop) if it still shows any background work, and stop any of my own watchers; an agent whose worktree is gone can't resume and sits as "stuck". Never remove a worktree with uncommitted changes or an agent still running in it; ask first or commit the work.

**Why:** each worktree is 0.5-8 GB (node_modules, target/); the user asked on 2026-10-14 after disk dropped to 69 GB free.
Also (2026-11-22): stop any local demo/test stack (napkin-web, relay, mock-backend, deck server, http.server) I'm not actively using to test, and remove its worktree too; save any untracked results to napkin-local-keep first.

**How to apply:** clean up right after each agent's report, without waiting to be asked. Related: [[design-before-code]].
