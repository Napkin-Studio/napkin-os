---
name: board-sizing-decision
description: "Owner's 2026-10-15 rule for Production Tool board sizing (grow automatically, never shrink automatically, no pushing neighbours); build after fix/links-and-ink lands"
metadata:
  node_type: memory
  type: project
  originSessionId: 7bc8bbbd-c824-44c4-8437-6b45cfd195e7
  modified: 2026-10-15T01:19:17.113Z
---

Shrey approved on 2026-10-15 (art-boards, not yet built). It is to be built after fix/links-and-ink merges into feat/production-ui, as one feature with resize handles.

- **Dropping in:** something dropped on a board goes inside it, auto-placed in the next free slot (contact-sheet rows, no overlap).
- **Growing:** a board grows automatically to fit, toward free canvas (down, then right). It never pushes other boards. When both ways are blocked, it shows "Board is full · Resize".
- **Never auto-shrinks.** "Fit to contents" is on the board's selection bar.
- **Manual resize:** edge and corner handles. A board can't shrink below its contents. Things left outside after a resize leave the board, with Undo. A manually set size holds until something doesn't fit.
- **New things** (generated pictures, new key views, + Node) land in the right board.

**Why:** a board is a space, not a group. Auto-shrink and pushing neighbours make the layout shift under people, which is worse once live collaboration lands.

**How to apply:** record this on features/art-boards.clan with `clan patch-decision` when the build starts. Related: [[production-tool-overhaul]], [[local-live-relay]].
