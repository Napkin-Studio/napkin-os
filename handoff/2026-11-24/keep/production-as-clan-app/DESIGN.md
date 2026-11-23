# Production as a normal CLAN app: design for your decision (2026-11-23)

Record: `features/production-as-clan-app.clan` on branch `feat/production-as-clan-app` (worktree napkin-wt-pt-clan). Status: exploring. Nothing built, pushed or deployed.

## The short answer
Your proposal is right about stages 1 and 2 and wrong about stage 3. Production's document is already a CLAN document and already an installed app (`ie.napkin.production`). Only its home (relay S3) and its door (`/production` plus a signed identity) are special. Move those and it behaves like Brief Maker. Moving the paid jobs into the middleware would lose paid jobs, so I recommend leaving them in the relay.

## What changes for people
- A Production project shows on Home and in the library under its client, like a brief. Today a brief spun off to Production never gets a client (UAT bug S3).
- Brief to Production, Territories to Production and Production to Deck are the one ordinary spin-off. The "Napkin could not find the saved project" message (S1) goes with the special routes.
- Opens from the library; one sign-in. Two tabs saving one project: the second is told, nothing is overwritten (same as today, now for every tool).
- Pictures and video: same pictures, same speed. They stay links by sha256.

## What I measured (UAT, read-only)
| Thing | Number |
|---|---|
| Projects on the relay | 22 (UAT test data) |
| Saved document size | 39 KB to 197 KB zipped (Hollow Oak 197 KB, 1.16 MB expanded) |
| Saves | 703 kept (53 MB); peak day 453 (UAT loop), 716 over 14 days, 5 conflicts (0.7%) |
| Save speed today | p50 145 to 184 ms, p95 205 to 383 ms |
| How often | edits go to the browser at once; a post every 60 s while changing, plus accept, manual, export |
| Media | 2.6 GB total (out 2.0 GB, in 389 MB, ads 169 MB) |
The host can take this rate and size easily, but it has three gaps we close first: it does not check versions on write, keeps no history, and its disk has no backup.

## Recommended stages (agent-days)
| Stage | What | Days | You see |
|---|---|---|---|
| 0 | Host groundwork: version check on write, snapshot ring, whole-document save route, AWS Backup | 3 | nothing |
| 1 | Documents live in the library; plain spin-offs; relay `/clan` and `/projects` deleted; no CDN addresses stored in documents | 7 (fresh) / 9 (migrate) | client listing, spin-offs work |
| 2 | Tool opens as an app page on napkin-web's own origin, session cookie, no signed identity for documents; folds in the CSP work | 5 | one door |
| 3 (re-scoped) | Browser talks only to napkin-web; napkin-web calls the relay as provider and media service; a job finished after the tab closed lands once (like Research does) | 9 | closed-tab jobs land |
| Total | | about 24 (15 to the end of stage 2) | |
Run cost is about the same as today: documents on EFS cost cents, relay Lambda, DynamoDB, S3 and CloudFront are unchanged.

Split into four records after you approve: `production-in-library` (0+1), `production-app-page` (2), `production-jobs-via-host` (3), and `production-relay-to-middleware` (parked).

## What we keep from the relay
Everything that is hard and already durable: the job state machine in DynamoDB with the one-minute sweeper, the spend ledger and caps, the Runway adapter and fallbacks, Dex and Skye, the ffmpeg stitch, and S3 plus CloudFront for pictures and video (Runway must fetch inputs over plain HTTPS; the workspace blob store on EFS cannot serve that). What goes: `projects.py`, the `/clan` and `/projects` routes, the project index, the two spin-off routes, most of the re-homing code, and the signed identity for document calls.

## Why not stage 3 as proposed
Middleware jobs are in-memory threads (`server/napkin/jobs.py`: "it is lost" on restart or deploy) and it has no durable store or tenant cap. A paid Runway job that dies is charged and never lands (the 2026-10-15 lost clip). On AWS the relay does not have that problem today. It would cost 25 to 30 more days, gives people nothing visible, and "one cap" fights your rule to count Claude and provider spend apart. Parked until live-sync gives the middleware a durable store.

## Fresh start vs migration (22 projects)
| | Fresh start (recommended) | Migration |
|---|---|---|
| Extra cost | 0 to 0.5 day (scripted hand import of the ones you name) | about 2 days |
| Result | New projects only; S3 data untouched; Hollow Oak, An Post, Let Them Sleep brought in by hand through the existing upload route, given their client | All 22 become library documents, ids change |
| Risk | You re-show a project that was not brought in | script bugs; client names matched by guess |
Both leave the S3 objects alone.

## Rework risks we designed around
Absolute CloudFront URLs in documents (38 in Hollow Oak) are dropped, sha only. The decision chain is 52% of a document and grows; limits raised and compaction goes to the clan-sdk-repack record. Whole-file save is a stepping stone against the OS contract (server applies patches); it uses the host's own version so live-sync reuses it. Territories record 21 should target the generic spin-off now (unblocked by stage 1, saves its 1.5 d bridge). The Deck's reader keeps contract 3 and the assets pass; only the source address changes.

## What does NOT go away
`deploy-production-tool.yml` stays: the relay and stitch live in the hackathon AWS env that UAT and staging both call. Live collaboration is not delivered (it is the planned live-sync feature, size L, nothing built; today there is no presence or lock). This feature gives it the one server-held document it needs. The signed bridge becomes a service credential for job and media calls; it does not vanish.

## Questions for you
1. Fresh start or migration? (I recommend fresh; which 3 or 4 projects do you still show?)
2. Accept stage 3 re-scoped (jobs stay in the relay) and the full move parked?
3. Stage 2 as a first-party app page (5 d), not the sandboxed frame (30 to 40 d, it is live-sync work)?
4. Snapshots: thin (newest 50) plus daily backup, or keep every save like the relay?
5. Media stays public-by-hash on CloudFront for now; private media is a separate feature. OK?
6. Live collaboration is out of this feature. Confirmed?
7. Tell the Territories plan to target the plain spin-off for record 21?
8. A Production project takes its brief's client, else "no client". Any other rule?
9. Relay library shelves (keys, brand kits, formats): leave until Brand Clan, or move in stage 3?
