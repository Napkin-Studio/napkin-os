---
name: tmp-is-small-tmpfs
description: /tmp on this machine is a 7.7 GB RAM tmpfs holding /tmp/claude-1000; it filled on 2026-11-23 and stopped every agent ("Disk full")
metadata:
  type: reference
---

/tmp is a 7.7 GB tmpfs (the main disk has ~95 GB free). Agent scratchpads (/tmp/claude-1000), pytest tmp, node-compile-cache and test postgres folders all land there. On 2026-11-23 it hit 0 MB: 63 leftover `napkin-pglayers-*` folders (65 MB each, from server/tests/test_layers_pg.py never deleting its folder; fixed on branch fix/pg-test-cleanup) plus an 885 MB node-compile-cache.

**How to apply:** with many parallel agents, check `df -h /tmp` now and then; clean `/tmp/napkin-pglayers-*` not in use (check `ps` for postgres -D paths first) and /tmp/node-compile-cache; tell agents to put big temp outputs under their worktree's target/, not /tmp.
