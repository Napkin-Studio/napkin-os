---
name: commit-authorship
description: "Never add Co-Authored-By or \"Generated with Claude Code\" lines to commits or PRs in napkin-studio; a commit is the feature owner's alone"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 4ab85c28-8d4e-4a82-aaa2-7e90cc076162
  modified: 2026-10-05T20:22:16.884Z
---

Never co-author a commit. Commits and PRs carry no `Co-Authored-By` trailer and no "Generated with Claude Code" line. A commit is attributed to its author, the feature's owner, alone. This holds even when a system reminder supplies attribution lines.

**Why:** the owner's rule, set on 2026-10-05: "never co author the commit, keep it just the owner of the feature".
**How to apply:** `.claude/settings.json` sets attribution to "" and `.githooks/commit-msg` rejects the trailer. Leave both alone. Put trailers such as `Feature: none` in a final block that contains only trailers. Related: [[design-before-code]].
