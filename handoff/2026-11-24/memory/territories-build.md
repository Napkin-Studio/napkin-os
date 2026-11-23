---
name: territories-build
description: Territories tool build started 2026-11-23 on integration branch feat/territories; owner approved the 24-record plan with recorded defaults; local tests only
metadata:
  node_type: memory
  type: project
  originSessionId: 5f9369b1-b1e6-4fd3-b44c-d946c8ad0c67
  modified: 2026-11-23T10:29:48.426Z
---

2026-11-23: owner approved the Territories plan (24 records, features/territories*.clan; plan + lessons in ~/Documents/napkin-local-keep/territory-plan-2026-11-23/) and asked to build with parallel agents, merge and push, local tests only (no UAT yet; UAT is busy with the production→deck integration).
Integration branch feat/territories (worktree napkin-wt-territory-plan) = develop + plan records + feat/deck-cloud; each feature on feat/territories-<short> merged into it. Defaults for the 17 open questions are a pinned decision in features/territories.clan (demo pipeline, sketches v1, prices only in Decisions/History, landscape later, name Territories). The owner's demo is on branch claude/ad-campaign-territory-explorer-auewh5 (not feat/territory-explorer); never merge feat/territory-slice (client names in history).

Architecture (owner 2026-11-23): Territories runs INSIDE the middleware like Brief/Research (no engine server, no sidecar); the deck's sidecar ships to UAT for the current round, then folds into the middleware as a follow-up feature.

UAT gate (owner 2026-11-23): Territories goes onto UAT (the territories-cloud step and the territories-uat round) only AFTER the existing 4-tool flow Brief → Research → Production → Deck has been fully tested end to end on UAT. Until then, local tests only.

**How to apply:** follow AGENT-BRIEF.md for every feature agent; merge order respects BUILD-PLAN dependencies; cloud/production hand-off wait for deck-cloud and production-spinoff merges. Related: [[spinoff-carries-everything]], [[design-before-code]].

Territories → Production (owner 2026-11-23): Territories is "just another node", like Brief. Sending routes makes ONE Production project (one campaign) with ONE Territories node PER ROUTE (no tabs), each a frozen copy that carries everything before it (brief + research), linkable to Script/Storyboard/Film; no loose text cards, no separate Brief node needed. The first build (feat/territories-to-production, text cards) must be changed to this; the node mock (napkin-local-keep/territories-node-mock, t1-t3) was APPROVED by the owner 2026-11-23.

Tool order (owner 2026-11-23): Brief → Research → Territories → Production → Deck — on the client dial (Territories gets its own slot; with no docs it says "Start from a brief") and wherever the shell lists a client's tools. Built without a mock at the owner's say ("Just build it").

UX bar (owner 2026-11-24): Territories must look stylish and intuitive and follow the patterns Brief/Research/Production already settled — agents big on the main stage while working, then small in the Booth; hide agents/controls when not needed; ONE visible primary "next" per step. Owner was worried it was "just put together". Process: audit vs house patterns → redesign mocks on the real page (dark first) → owner approval → build → drive it end to end against the mocks before handing over.
