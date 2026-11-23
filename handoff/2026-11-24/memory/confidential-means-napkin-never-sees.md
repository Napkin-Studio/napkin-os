---
name: confidential-means-napkin-never-sees
description: "Confidential" marks client material Napkin's own systems (RAG, layers, training) must never take in; the agency and the client see everything, incl. in the client copy
metadata:
  type: project
---

Owner rule, 2026-11-13: three parties — Napkin, the ad agency, the client. The client shares confidential material with the agency; the agency makes something and shares it back with the client. **The only party that must not see it is Napkin.** So:
- a part/fact/material marked Confidential is shown in full to the agency and the client: client copy, PDF, exports, Share all include it;
- it is never written to Napkin's shared knowledge layers or RAG, never harvested into the category layer, never used for evals, goldens or training, never kept in a Napkin-side store.

**Why:** the old docs and code had it backwards (client copy "leaves out confidential parts"; Share's client copy was disabled as "not built yet"). The owner: "Why would we hide the confidential data that the client gave from the client?"

**How to apply:** any feature touching confidentiality, exports, harvest/layers write-back, evals/goldens or run-log bodies must follow this; flag any Napkin-side sink where confidential material could land. Fix tracked in features/confidential-means-napkin-never-sees.clan. Related: [[brand-clan-decisions]], [[review-stays-in-document]].
