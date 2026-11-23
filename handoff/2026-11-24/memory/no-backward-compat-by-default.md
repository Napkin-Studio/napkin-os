---
name: no-backward-compat-by-default
description: "Don't design for backward compatibility unless the user says so; ask, never presume"
metadata:
  node_type: memory
  type: feedback
  originSessionId: a2988262-d752-45d6-8f0c-6ecc60c42f17
  modified: 2026-10-07T15:23:04.788Z
---

Backward compatibility (old documents, old contract shapes, fallback fields, feature flags to keep the old path) is not a design consideration unless the user explicitly asks for it. When unsure whether it matters, ask; never presume it.

**Why:** Said on 2026-10-07 while reviewing the canvas-solid-refs design, which had added optional fields, kept `lead_view`, and put the new canvas behind a flag "for old documents". The user asked instead for the best move and no compatibility work.
**How to apply:** In designs, pick the clean shape (replace fields, remove old paths, no flags kept only for compatibility). If keeping compatibility looks necessary (live data, deployed clients), raise it as a question.

Related: [[design-before-code]]
