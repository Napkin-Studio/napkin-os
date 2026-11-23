---
name: how-we-work-jira
description: "Team operating rules (board, task pipeline, meetings) live in Jira PM-46, in force from 2026-11-09"
metadata:
  node_type: memory
  type: project
  originSessionId: 64a998b4-56ae-4cbb-b5b0-c46958f2bc80
  modified: 2026-11-06T10:50:15.525Z
---

Org operating rules were written 2026-11-06 into Jira (napkin-team.atlassian.net, project PM) as Workstream PM-46 "How we work". Reference pages: PM-47 (board rules), PM-48 (task pipeline), PM-49 (meeting routine). Action tickets: PM-50 to PM-56. In force from Mon 2026-11-09. NOBT is empty and is to be retired. LLP is the Live Learn Play project, owned by Gavin Rooney and Aaditya.

Key rules: no ticket, no work (anything over 30 min); one named owner and no shared "Napkin Creative" account; To Do = committed this week; WIP max 2 per person; name a reviewer, who answers within 1 working day; 14-day stale rule; code tickets link branch, PR and feature record. Rhythm: async Slack check-in by 10:00; Mon 10:00 planning; Thu 15:00 demo; retro every other Friday; monthly roadmap on the first Monday.

**Why:** On 2026-11-06 the board had 80 unassigned and 193 stale tickets, with 67 stuck in review.
**How to apply:** When creating or updating Jira tickets for this team, follow the PM-47 ticket rules: verb-and-outcome summary, parent Workstream, a "Done when" line, a size label, and the Jira key in the PR. Only the Atlassian Jira scope is connected, not Confluence. Links with [[design-before-code]].

PM bot (set up 2026-11-06): Slack #eng-standup (C0CF3337UK1, members Shrey, sai and Vahid) is the daily stand-up channel. Two cloud routines use only the Slack and Atlassian connectors, with no repo:
- trig_019N8U9URHn2Js58g2QKa7za runs weekdays at 11:00 UTC. It files deduplicated stories into PM Backlog (label `pm-bot`), comments on existing tickets, and replies in threads. A ❌ reaction means it should correct itself.
- trig_01WDgpPEmKY7q3GyETsovsHs runs Mondays at 08:30 UTC and posts the planning brief. It is read-only on Jira.

The bot posts as Shrey's account, so every bot message starts with "🤖 PM bot:". It never commits, assigns existing tickets, moves or closes tickets. Cron is in UTC, so in Irish summer time (IST) both runs land an hour later on Dublin clocks. Manage the routines at claude.ai/code/routines.
