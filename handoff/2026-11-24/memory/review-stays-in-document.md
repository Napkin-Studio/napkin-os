---
name: review-stays-in-document
description: "Owner rule (2026-10-19): human review changes only the document and its downstream; layers change only via a client-accepted harvest; research writes stay"
metadata:
  node_type: memory
  type: project
  originSessionId: 784b1dc6-27a3-47a6-b347-eb9799af0b82
  modified: 2026-10-19T11:19:42.332Z
---

Owner (Shrey) decision, 2026-10-19, after a staging verify failed with "licence open is less restricted than its sources" (verify_finding reuses one `human:<id>` source row whose licence was fixed by that person's first verification):

- Verifying, rejecting or correcting a fact or finding changes **only the document and everything downstream of it in the document**: the findings resting on it, their confidence, the report's conclusions and wording. The person is recorded as the verifier.
- **Nothing upstream** (the knowledge layers) changes on review. Upstream changes only when the document is **client-accepted**, through a separate harvest process that also extracts RAG-relevant material, crediting the verifier.
- **Research runs keep writing raw facts to the layers** as now (unreviewed, reusable cache).
- Downstream update: **the agent rewrites the affected findings and report parts on every verify/reject** (owner chose this over instant marks plus an on-request rewrite, accepting a model call per click).

- Also approved 2026-10-19 (feature review-in-document): reconsider updates findings in place (confidence, cites) and marks fallen ones `superseded` with a link to the replacement; a verified finding that still holds after a correction **stays verified**, with a recheck note; report edits are held per part of the page.

**Why:** review is about this document; agency memory should only learn from work the client accepted.
**How to apply:** design review features within this; the verify licence bug goes away once verification stops writing to the layers, but the harvest must still handle per-licence reviewer sources. Related: [[brand-clan-decisions]], [[design-before-code]].
