---
name: relay-restart-inflight
description: "Never restart the owner's live local relay while a paid job is in flight; the local relay keeps jobs in memory and loses them"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 7bc8bbbd-c824-44c4-8437-6b45cfd195e7
  modified: 2026-10-15T03:18:43.383Z
---

The local relay (`python -m local`, MemoryStore) keeps jobs in memory. Restarting it while a Runway job is in flight loses the job. Runway still finishes the job and charges for it, but the clip never lands. This happened on 2026-10-15: the $0.80 Veo clip on task b72d6404 was recovered by hand from Runway's GET /v1/tasks/{id}.

**Why:** the owner pays for every clip, and a lost one looks to him like "it didn't make the new version".
**How to apply:** before killing or restarting the relay on 8788, check its log for jobs that are submitted but not completed (`"state": "submitted"` with no later completed/failed for that jobId). If any exist, wait, or ask the owner. If one was lost anyway, the Runway task id is in the log's `GET .../v1/tasks/<id>` lines, and fetching it is free. Related: [[local-live-relay]].
