# Design: store scans under the view lock (`store-scan-under-lock`)

Status: exploring (a design for the owner, nothing built). Written 14 Nov 2026 on `spike/fabletest` at
e21e0e67 (worktree `/home/napkin/napkin/napkin-slow-server`), from the code, the clean baseline log
(`/tmp/e2e-clean-baseline.log`, run at 77e22cd6) and new measurements. Scripts and raw numbers:
`/home/napkin/napkin-share/work/` (`bench.mjs`, `count-open.mjs`, `logstats.py`, `table.py`, `debug*.json`,
`release.json`, `*.server.log`). The fix branch `fix/store-scan-under-lock` from the previous machine has no
record and no code here; this design does not rely on it.

## Problem

**Symptom.** In the 45-minute one-worker e2e baseline, every one of the 1,058 slow lines (over 1 s) is from
ONE tenant, `5c07b829`: the agency `wk` on the roster server, which every signed-in spec shares and which
grows all run. (My bench's tenant for agency `wk` hashes to the same `5c07b829`.) The mean slow request
went 1.3 s, 2.5 s, 5.4 s by quarter of the run (BUILD-LOG.md:275; by quarter of the log lines
`logstats.py` gives 1.3, 1.4, 3.3, 5.5 s); worst 17.4 s (`capabilities`).

**It is waiting, not working.** For the sandbox ops the `session` phase is 0 ms (the session is cached) and the
whole time is `dispatch`, which lumps the wait for the document's view lock with the work. Three ops prove the
split because they do no work:

- `capabilities` (routes.rs:1120) only reads `session.trusted()`: median 3.2 s, p95 16.2 s, max 17.4 s.
- `POST /d/{doc}/edit-mode` (api.rs:1160) only sets a bool under the lock: median 4.1 s, max 11.4 s.
- `GET /d/{doc}` logs its own open steps (timing.rs:139): `lock` median 1.8 s (max 16.5 s) of a
  1.9 s request, 94 % of the time; the work is `verify` 7 ms and `describe` 40 ms.

**Who holds the lock.** `Session` keeps one `Mutex<ViewState>` per open document (session.rs:162).
`Session::read` (session.rs:231-234) holds it for the whole closure, and these read routes run a scan of the
whole tenant inside that closure:

| op | route | what one request reads while it holds the document's view lock |
|---|---|---|
| `upstream` | routes.rs:655, session.rs:436, library.rs:981, read.rs:754 | per ancestor, `find_upstream` (library.rs:743): the recorded parent first, but "a write to the child moves its lineage on" (library.rs:739), so after any write, and for every hoisted ancestor, `store.documents()` is walked and each document is `Document::load`ed (read, unzip the manifest, SHA of the archive, app signature check) until the id matches; an ancestor that is gone or foreign costs all N |
| `related` | routes.rs:751, library.rs:1493 | `upstream_status` (above) plus a read and `ClanFile::from_bytes` of every document (library.rs:1511) |
| `attach-targets` | routes.rs:689, library.rs:1178 | `Document::load` of every document (library.rs:1202), plus the client registry |
| `judge` GET | routes.rs:879, judge.rs:1307 `card`, judge.rs:444 `brief_of` | a carried brief: `ideas::brief_status` (ideas.rs:290), i.e. `upstream_status`; otherwise a read and parse of every document (judge.rs:461) |
| `ideas/room` | routes.rs:796, ideas.rs:357 | `brief_status`, i.e. `upstream_status`, plus one load |
| `decisions` | routes.rs:761 | `decisions_for` on the open document; when an item names a job, `IndexCache::get` (jobindex.rs:1468): a stat of every document, then the tenant-wide `last` mutex, held across any rebuild (jobindex.rs:1487-1526) |
| `capabilities`, `edit-mode`, `versions`, `client-link/list`, `chain`, `gate` | | nothing outside the document, but they queue for the same lock |

Writes (`Session::perform`, session.rs:243) also hold the lock across their op and the store's apply, and
some writes scan too (`/attach` `find_source` library.rs:1322, `/upstream/update`, `write_backrefs` via
`find_upstream`, library.rs:878). An open (`Session::open_observed`, session.rs:359-381) holds the lock across read, parse,
verify, resolve and describe on purpose (session.rs:345: a reopen racing a write must not put old bytes back);
`spinoff-targets` (api.rs:745) does a full `session.open` per call.

So per request the cost is O(documents in the tenant), and the requests one page makes against one document
run one after another, each holding the lock. `std::sync::Mutex` on Linux is not fair: a thread that releases
and immediately asks again usually wins, so a waiter can wait through many holders.

**The hanging test is the same fault.** `an_open_racing_a_write_does_not_lose_the_write`
(crates/napkin-host/tests/client_link.rs:470) hung 8 times in 8 here under `timeout 30` (no panic: a hang).
A probe in the same file (throwaway, uncommitted, below) timed it: the opener thread loops `session.open`
(about 5 ms of lock each, debug); the writer's `/client-link/issue` waited **18.2 s** while the opener took the
lock **3,664** times, and 16.2 s / 3,227 opens in a second run (that one with gdb attached). With a 50 µs pause between opens the same 12
issues finish in 0.42 s, worst 44 ms. So nothing is lost and nothing deadlocks: the writer is starved by a lock
held for long stretches and handed back to the same thread. In the server the "opener" is the stream of
scans and polls on one document.

**How the e2e page turns this into minutes of lock time.** One document open (brief, N=10, 1440 px, counted in
the browser by `count-open.mjs`) sends **44 requests by the frame being ready plus 2 s** (50 in 12 s): 14
`decisions`, 12 `upstream`, 8 `GET /d`, and one each of `document`, `gate`, `attach-targets`, `related`,
`edit-mode`, `spinoff-targets`, `versions`, `middleware`, `capabilities`, `chain`. Loading the desk alone sends
49, including 10 `GET /d` + 10 `decisions` + 10 `upstream`: `useDeskFacts` (app/src/shell/nui/useDeskFacts.ts:20,
`MAX = 10`) reads the ten newest documents, and again whenever one changes. Each `upstream` and `GET /d` there
is a scan or a full re-read under that document's lock.

**Measured cost** (bench.mjs: one roster-mode napkin-web, brief gate off so a brief spins off without a second
signer, agency `wk` grown through its own API in groups of five: research, a brief spun off it and written with
`READY_BRIEF`, a deck, an idea room and a script spun off the brief; ops timed on the first group's brief, idea
room and script; "6 clients" = six concurrent loops over all ops on those documents; ms unless marked):

Each cell: **one-client median / six-client p95**, ms unless marked (full table with all four numbers per op
and N in the appendix). Release N=1000 was timed on the same data dir as debug N=1000.

| op | debug N=10 | debug N=100 | debug N=300 | debug N=1000 | release N=10 | release N=100 | release N=300 | release N=1000 |
|---|---|---|---|---|---|---|---|---|
| `upstream (brief)` | 54 / 294 | 367 / 2.5 s | 1.2 s / 8.4 s | 4.2 s / 29.1 s | 2.5 / 30 | 17 / 145 | 52 / 638 | 196 / 1.7 s |
| `upstream (room)` | 70 / 196 | 383 / 1.1 s | 1.2 s / 5.6 s | 4.2 s / 8.4 s | 3.3 / 14 | 18 / 51 | 53 / 193 | 197 / 670 |
| `decisions` | 6.3 / 301 | 6.9 / 2.7 s | 8.3 / 8.2 s | 13 / 18.5 s | 1.9 / 25 | 2.1 / 167 | 2.9 / 162 | 5.5 / 1.2 s |
| `related` | 61 / 388 | 445 / 2.4 s | 1.4 s / 7.6 s | 5.0 s / 24.9 s | 3.7 / 30 | 29 / 155 | 88 / 269 | 318 / 1.3 s |
| `judge (room)` | 87 / 255 | 388 / 2.3 s | 1.2 s / 5.6 s | 4.1 s / 40.3 s | 4.5 / 15 | 19 / 48 | 54 / 148 | 198 / 510 |
| `judge (script)` | 78 / 153 | 380 / 834 | 1.2 s / 2.1 s | 4.1 s / 10.1 s | 4.3 / 12 | 19 / 46 | 54 / 105 | 198 / 393 |
| `ideas/room` | 86 / 257 | 389 / 1.2 s | 1.2 s / 2.4 s | 4.1 s / 12.6 s | 4.3 / 17 | 19 / 68 | 54 / 202 | 198 / 589 |
| `attach-targets` | 89 / 536 | 988 / 3.3 s | 3.0 s / 10.1 s | 10.0 s / 38.6 s | 5.5 / 37 | 48 / 202 | 144 / 652 | 479 / 1.6 s |
| `capabilities` | 1.1 / 250 | 1.3 / 2.2 s | 1.2 / 6.7 s | 1.2 / 27.2 s | 0.6 / 19 | 0.8 / 131 | 0.9 / 251 | 1.0 / 1.2 s |
| `open (GET /d)` | 98 / 298 | 98 / 2.8 s | 98 / 10.2 s | 99 / 30.1 s | 7.4 / 31 | 7.4 / 144 | 7.3 / 507 | 7.6 / 1.4 s |
| `needs` | 2.3 / 60 | 3.9 / 444 | 17 / 1.2 s | 248 / 249 | 1.2 / 7.8 | 2.3 / 29 | 9.2 / 150 | 109 / 296 |

Read the table this way: single-client cost grows linearly (`upstream` about 4 ms a document in debug,
`attach-targets` about 10 ms), and with six clients even `capabilities`, which does nothing, waits seconds: at
N=1000 its p95 is 27.2 s in debug and 1.2 s in release. The worst number in the table is `judge` on the idea
room, six clients, N=1000, debug: p95 40.3 s. The bench machine had other builders' e2e stacks running; the single-client rows are
stable run to run (p95 within 1 % of median), the six-client rows are noisier.

**Test-only or product?** A product problem. The e2e tenant is not an artefact: it is how an agency works, one
tenant per agency (`TenantId::of_agency`, tenant.rs:51), every job's documents in it, never pruned. The e2e
only reaches 1,000 documents in 45 minutes instead of a year. An agency of 15 people with 60 jobs a year at
five to ten documents a job (research, brief, deck, idea room, scripts, visual briefs, versions) holds 300 to
600 documents in its first year. A release build divides the scan work by about 20 (`upstream` 4.2 s to 0.2 s
at N=1000; `attach-targets` 10 s to 0.48 s), which is why the e2e (debug) falls over first. It moves the cliff,
it does not remove it: in release at N=1000 one person still pays 0.2 to 0.5 s per scanning op, a document open
fires about 44 requests of which about 15 scan, and six people on one job's documents make `capabilities` (no
work) wait p95 1.2 s and `upstream` p95 1.7 s, on a 20-core ARM64 machine. Production runs on far less
(state.rs:420 cites a 256-CPU-unit task), so expect a multiple of that. The only test-specific parts are the
debug build and the speed at which the tenant grows.

**Did today's merges make it worse?** Yes, a little; they did not cause it. The baseline ran at 77e22cd6,
before `align-needs-lock-people` stage 2 (a97058d3), the Booth folds (b62957ff) and the gate and client link in
the Booth (ba6c8754). Since then: `booth.html` adds a `/decisions` read per Booth draw (the who-holds-it
line); `booth-folds.html` (new) reads `/versions` on open and, on the three Judge tools, `/judge` on open and
every 4 s (booth-folds.html:395), on top of the shell's own 4 s `/judge` poll (app/src/shell/judge/useJudge.ts:57,
already at the baseline): two Judge polls per open script, idea room or visual brief, each an O(N) scan under the
lock (`judge (script)` 1.2 s at N=300 debug); the brief's client-link fold adds `/client-link/list` and
`/client-review/round` (cheap, but they queue). `GET /needs` with `documents[]` (needs.rs:385 `documents_for`)
calls `notices_on` per document, which calls `items_of` over the whole index: O(documents x needs), outside any
document's lock, so not a cause of the waits, but superlinear: 4 ms, 17 ms, 248 ms at N=100, 300, 1000 (debug;
109 ms release at 1000). Worth a fix in the same pass (index the needs by path once per call).

## done_when

1. Bench, debug build (what e2e runs), N=1000, 6 concurrent clients: p95 of `upstream`, `decisions`, `related`,
   `judge`, `ideas/room` and `attach-targets` under 500 ms; `capabilities` and `edit-mode` p95 under 50 ms.
   One client: every one of those ops under 250 ms median at N=1000. Release build: the same ops p95 under
   150 ms at N=1000, 6 clients.
2. The cost of those ops at one client grows by less than 2x from N=100 to N=1000 (it is O(N) today: 10x).
3. A full e2e at one worker on its own three ports: no server request line over 3 s, at most 20 over 1 s, and
   the mean of the slow lines in the last quarter no more than 1.5x the first.
4. `an_open_racing_a_write_does_not_lose_the_write` passes 50 times in 50 under `timeout 30`, each run under 5 s.
5. The new lock-held tests below pass; `cargo build -p napkin-host --no-default-features --target
   wasm32-unknown-unknown` is green (scripts/check.sh:147).

## Prior art in the code

- `IndexCache` (jobindex.rs:1441-1528) and `SearchCache` (searchindex.rs:712): per tenant, keyed by each
  document's `PartStore::stamp` (a stat on the web's file store, store.rs:146), re-reading only documents whose
  stamp moved; already correct for writes by another web task on the same disk. The pattern to copy.
- `LibraryCache` (listing.rs:135): per document facts keyed by revision, outside any session.
- `judge::brief_of` (judge.rs:463-465) already avoids hashing every archive "because the card is read while its
  document is held"; the wave check in BUILD-LOG.md:142 named `attach-targets`, `library` and the Judge card
  as whole-store scans under a lock that stop a 1,000-document tenant for over 10 s.
- `Session::open_observed` and `OpenMark` (session.rs:139-152, 359): how the host reports steps without a clock
  (wasm32 has none), which the server times. `HeldRead` and
  `a_reopen_racing_a_write_never_puts_the_old_document_back` (session.rs:973, 1042): a deterministic race test.
- `Workspace::cached_or_open` (state.rs:99-127) already opens outside the cache's lock for the same reason.

## Approaches

**A. Read a snapshot, release the lock (narrow the lock).** `ViewState.open` becomes `Option<Arc<Document>>`.
`Session::read` takes the lock only to clone the `Arc` and runs the closure on the snapshot after releasing it;
the same for `document_now`, `trusted`, `app_id`, `attach_extracted_text`. `perform` keeps the lock across op
and apply (writes stay serialised and based on the version they saw; `Change::base` still guards other
writers). `open_observed` reads, parses, verifies and describes outside the lock and installs under it only if no
install happened since it started: a generation counter bumped on every install (open or commit); if it moved,
the newer snapshot stands and the open answers from it. `write_backrefs_as` runs on a snapshot (it writes only to
parents, through the store, as today). Add `Session::read_observed(mark)` (`OpenMark::Locked`) so the server logs
`lock` and `work` phases for every sandbox read. Build: 5 to 7 agent hours (session.rs, routes.rs call sites,
timing.rs, tests). Run cost: none; a replaced snapshot lives until its last reader returns. Risks: a read
answers from the snapshot a concurrent write is replacing: the same answer it would have given a moment
earlier, and every decision that matters (gate, lock, approve) is re-checked inside `perform`. A lost write: none
while `perform` holds the lock and an open never installs over a newer install; the hanging test and
`a_reopen_racing_a_write...` are the guards. Leaves the O(N) CPU: `attach-targets` still takes 10 s of a core at
N=1000 debug, and six of them compete for cores.

**B. A per-tenant catalog of manifests, kept by stamp.** New `crates/napkin-host/src/catalog.rs`,
`StoreCatalog`, one beside `jobs` and `search` in `Workspace` (state.rs:40). Per document, read from the
manifest only (`ClanFile::from_bytes`, no hash, no signature): `document_id`, title, app id, name and noun,
`fork`, `document_type`, `carried` id, attached ids, client, job, `updated_at`, kit version, the tenant marker
`foreign` reads, whether the gate applies, approved count. Refreshed as `IndexCache::get` is (stat every
document, re-read the moved ones; its own mutex, never a session's). `find_upstream`, `find_source`,
`attach_targets`, `related` (downstream half), `brief_of` and `upstream_status` ask it for candidate ids and
`Document::load` only the hits, still checking `foreign()` on the loaded document. Build: 9 to 12 agent hours
(catalog, five call sites, tests, a bench test). Run cost: about 1 KB of memory a document; N stats a call
(`decisions`, which stats every document, takes 13 ms at N=1000 debug); the first call after a start reads every manifest once (about 0.8 s at N=1000 debug,
from `related` minus `upstream` in the table; under 0.1 s release). Risks: staleness if a filesystem gave the same stamp for different bytes (the risk
`IndexCache` already accepts, jobindex.rs:1463-1467); nothing is written from the catalog, so nothing is lost; a
candidate the catalog misses would hide a parent until the next stat, so the fallback when the catalog finds no
hit stays the scan (rare, logged). Alone it does not fix waiting behind the remaining per-document work or the
unfair lock, and `decisions` still holds the tenant-wide index mutex through a rebuild.

**C. Cache each answer per document version.** Memoise `related`, `attach-targets`, `upstream` by (document
version, tenant generation). The answers depend on every other document, so the key needs B's stamps anyway;
no cheaper than B and staler. Rejected.

**D. Fewer and lazier reads.** One Judge poll per open document, not two (useJudge.ts:57 and
booth-folds.html:395); `attach-targets` and `related` only when their fold or drawer opens; the desk reads
`upstream` only for documents that were made from something. Build: 2 to 3 agent hours, shell and templates
only. Run cost: none. Risk: a fold opens a moment slower; a changed parent shows on the next read. Cuts the
number of holders by about half; does not change O(N).

**E. A fair lock** (a queue, or `parking_lot::FairMutex`). Ends starvation (the hanging test would pass) but
every holder still holds it for an O(N) scan, so the wait becomes the sum of the queue instead of a lottery.
1 hour. Not enough alone.

## Recommendation

A, then B, in two stages on one record; D's single Judge poll as a small follow-up (open question 1). A alone
ends the waits and the hanging test and is shippable by itself; B removes the O(N) work so the waits do not come
back as CPU contention. Total 14 to 19 agent hours. napkin-host stays wasm32-clean: `Arc`, `Mutex` and a
counter only, no clock, no `std::fs` (stamps come through `PartStore::stamp`). In napkin-web, also run the host's
synchronous dispatch under `tokio::task::spawn_blocking` (sandbox.rs:114, the `/d` handlers), so a slow read
cannot take a runtime worker thread from other tenants (1 to 2 hours, inside A).

## Breakage and guards

- Write ordering and the race in session.rs:345: kept by `perform` holding the lock and by the install
  generation; guarded by `a_reopen_racing_a_write_never_puts_the_old_document_back`, the hanging test, and a new
  test that interleaves an open's read with a commit (HeldRead) and asserts the newer version stands.
- `Document` behind `Arc`: `pieces` (`OnceLock`) is already per snapshot and thread-safe; nothing mutates a
  snapshot (`advance` makes a new one). Check every `view.open.as_mut()` (session.rs `commit`) becomes a replace.
- The wall: `foreign()` stays on every loaded candidate; a catalog test with two agencies' documents in one store.
- The job index: unchanged contract; `decisions` calls `IndexCache::get` after the snapshot is taken, outside the
  view lock.
- Desktop and wasm shells use the same `Session`: behaviour unchanged for one user (no contention).

## Test plan (failing tests first)

1. **Lock not held during a scan** (napkin-host, session.rs tests, deterministic, no timing): a store wrapper
   whose `documents()` blocks on a channel and signals when entered. Thread A calls `dispatch("/related")`
   (then `/attach-targets`, `/upstream`, `/judge`, `/decisions`); when the store signals, thread B asserts
   `session.view.try_lock().is_ok()` and that `dispatch("/capabilities")` returns 200; then the scan is released.
   Fails today on every route (the lock is held).
2. **Open does not hold the lock while it reads**: the same with `read()` of the open document blocking; B's
   `perform` completes while A's open is parked; then A's install is refused by the generation and the snapshot
   is B's version.
3. **Reads per request** (catalog): a counting store (as state.rs:378 `Counting`) with 200 documents asserts a
   warm `/related`, `/attach-targets`, `/upstream`, `/judge` read at most the hits' archives (2 to 3), and a
   write to one document makes the next call re-read exactly one manifest.
4. The hanging test 50 in 50: `for i in $(seq 50); do timeout 30 cargo test -p napkin-host --test client_link
   an_open_racing_a_write_does_not_lose_the_write || break; done`.
5. Bench (`bench.mjs`, kept as `app/e2e/perf/` or `scripts/bench-store.mjs`): the done_when numbers at N=1000.
6. Full e2e, one worker, own ports; `logstats.py` over the log for done_when 3. Existing suites: `scripts/check.sh`
   for host, web, wasm.

## Rollout

napkin-host and napkin-web only; no data or format change, no setting, no infra. The catalog is memory only and
rebuilt on start. Deploy to staging, read the new `lock` and `work` phases in the request log (CloudWatch
Insights: slow lines by `op`, `phases.lock`), then production. Roll back by redeploying the previous image.

## Non-goals

A database or an on-disk index; changing the document format, the decision chain or any contract; cross-process
locking on EFS beyond what stamps give today; the Brief gate's or Needs you's rules; splitting the e2e tenant; the
e2e stand-in.

## Open questions for the owner (with my pick)

1. Which Judge poll stays: the shell's (useJudge.ts) or the Booth fold's? **Pick: the Booth fold's while the
   Booth is open, the shell's only when its own Judge view is shown.**
2. One stat pass for the job index, the search index and the catalog (one per request, shared)? **Pick: yes, but
   after B ships; B first copies `IndexCache`.**
3. May a read answer from the snapshot a concurrent write is replacing (A)? **Pick: yes; every write re-checks
   inside `perform`.**
4. Should the desk keep reading ten documents' `upstream` on every change (useDeskFacts.ts)? **Pick: only for
   documents with a `carried` parent, which the library listing can say (one field).**
5. Keep the e2e roster tenant growing for the whole run? **Pick: yes, it is the only big-tenant test we have;
   add the N=1000 bench as a nightly check instead of splitting it.**

## The throwaway experiment (uncommitted)

`crates/napkin-host/tests/client_link.rs` in the worktree has `race_probe`, `zz_probe_tight` and
`zz_probe_yield` appended after the hanging test: the same fixture, timing each `/client-link/issue` and counting
the opener's opens, without and with a 50 µs pause between opens. Uncommitted; `git checkout --
crates/napkin-host/tests/client_link.rs` removes it. `app/node_modules` and `app/dist` were made by `npm ci` and
a vite build for the request count (both ignored by git). No product code was changed.

## What I could not verify

- The `fix/store-scan-under-lock` code: never seen; nothing here is taken from it.
- The size of the e2e tenant at the end of the baseline (its data dir is deleted with the run); the estimate of
  1,000 documents in 45 minutes comes from the specs, not a count.
- The split of lock wait and work for the e2e's `upstream` and `decisions` lines: the sandbox log has only
  `session` and `dispatch`; `read_observed` (approach A) adds it. The split above rests on the zero-work ops and
  on the open's own `lock` phase.
- Which document each slow e2e line was about beyond its hash, and the bench with the Brief gate on (it needs a
  creative director's approve and a client's answer per brief; the ops timed do not read the gate).
- The request count of a Judge tool's open (counted for a brief only); the Judge polls are counted from the code.
- Production hardware (Fargate, 256 CPU units per the UAT note in state.rs:420) is slower than this ARM64 machine;
  the release numbers here are a floor.


## Appendix: the full table

op, N, median and p95 in ms (s where marked), one client (9, 5 or 3 rounds) and six concurrent clients (4 or 2
rounds each) after one warm-up round. `upstream (brief)`, `decisions`, `related`, `capabilities`,
`attach-targets`, `open` are on the brief; `upstream (room)`, `judge (room)`, `ideas/room` on the idea room;
`judge (script)` on the script; `needs` is the tenant's `GET /needs`.
`debug.json`

| op | N | 1 client median | 1 client p95 | 6 clients median | 6 clients p95 |
|---|---|---|---|---|---|
| `upstream (brief)` | 10 | 54 | 55 | 196 | 294 |
| `upstream (brief)` | 100 | 367 | 369 | 1.7 s | 2.5 s |
| `upstream (brief)` | 300 | 1.2 s | 1.2 s | 5.2 s | 8.4 s |
| `upstream (brief)` | 1000 | 4.2 s | 4.2 s | 18.2 s | 29.1 s |
| `upstream (room)` | 10 | 70 | 71 | 134 | 196 |
| `upstream (room)` | 100 | 383 | 385 | 680 | 1.1 s |
| `upstream (room)` | 300 | 1.2 s | 1.2 s | 3.3 s | 5.6 s |
| `upstream (room)` | 1000 | 4.2 s | 4.2 s | 4.3 s | 8.4 s |
| `decisions` | 10 | 6.3 | 7.0 | 196 | 301 |
| `decisions` | 100 | 6.9 | 7.9 | 713 | 2.7 s |
| `decisions` | 300 | 8.3 | 8.8 | 3.7 s | 8.2 s |
| `decisions` | 1000 | 13 | 14 | 10.1 s | 18.5 s |
| `related` | 10 | 61 | 62 | 205 | 388 |
| `related` | 100 | 445 | 448 | 1.5 s | 2.4 s |
| `related` | 300 | 1.4 s | 1.4 s | 4.4 s | 7.6 s |
| `related` | 1000 | 5.0 s | 5.0 s | 14.3 s | 24.9 s |
| `judge (room)` | 10 | 87 | 88 | 137 | 255 |
| `judge (room)` | 100 | 388 | 390 | 752 | 2.3 s |
| `judge (room)` | 300 | 1.2 s | 1.2 s | 2.1 s | 5.6 s |
| `judge (room)` | 1000 | 4.1 s | 4.1 s | 7.4 s | 40.3 s |
| `judge (script)` | 10 | 78 | 79 | 103 | 153 |
| `judge (script)` | 100 | 380 | 381 | 409 | 834 |
| `judge (script)` | 300 | 1.2 s | 1.2 s | 1.2 s | 2.1 s |
| `judge (script)` | 1000 | 4.1 s | 4.1 s | 4.1 s | 10.1 s |
| `ideas/room` | 10 | 86 | 86 | 154 | 257 |
| `ideas/room` | 100 | 389 | 391 | 776 | 1.2 s |
| `ideas/room` | 300 | 1.2 s | 1.2 s | 2.3 s | 2.4 s |
| `ideas/room` | 1000 | 4.1 s | 4.1 s | 5.1 s | 12.6 s |
| `attach-targets` | 10 | 89 | 90 | 186 | 536 |
| `attach-targets` | 100 | 988 | 992 | 1.4 s | 3.3 s |
| `attach-targets` | 300 | 3.0 s | 3.0 s | 4.4 s | 10.1 s |
| `attach-targets` | 1000 | 10.0 s | 10.0 s | 14.3 s | 38.6 s |
| `capabilities` | 10 | 1.1 | 2.0 | 140 | 250 |
| `capabilities` | 100 | 1.3 | 1.5 | 736 | 2.2 s |
| `capabilities` | 300 | 1.2 | 1.5 | 2.5 s | 6.7 s |
| `capabilities` | 1000 | 1.2 | 1.3 | 11.9 s | 27.2 s |
| `open (GET /d)` | 10 | 98 | 99 | 206 | 298 |
| `open (GET /d)` | 100 | 98 | 99 | 1.4 s | 2.8 s |
| `open (GET /d)` | 300 | 98 | 99 | 3.1 s | 10.2 s |
| `open (GET /d)` | 1000 | 99 | 100 | 13.5 s | 30.1 s |
| `needs` | 10 | 2.3 | 3.4 | 5.0 | 60 |
| `needs` | 100 | 3.9 | 4.6 | 6.8 | 444 |
| `needs` | 300 | 17 | 18 | 17 | 1.2 s |
| `needs` | 1000 | 248 | 248 | 240 | 249 |

`release.json`

| op | N | 1 client median | 1 client p95 | 6 clients median | 6 clients p95 |
|---|---|---|---|---|---|
| `upstream (brief)` | 10 | 2.5 | 2.5 | 12 | 30 |
| `upstream (brief)` | 100 | 17 | 18 | 76 | 145 |
| `upstream (brief)` | 300 | 52 | 70 | 333 | 638 |
| `upstream (brief)` | 1000 | 196 | 196 | 1.0 s | 1.7 s |
| `upstream (room)` | 10 | 3.3 | 4.3 | 7.9 | 14 |
| `upstream (room)` | 100 | 18 | 18 | 26 | 51 |
| `upstream (room)` | 300 | 53 | 53 | 98 | 193 |
| `upstream (room)` | 1000 | 197 | 198 | 199 | 670 |
| `decisions` | 10 | 1.9 | 2.5 | 11 | 25 |
| `decisions` | 100 | 2.1 | 3.3 | 70 | 167 |
| `decisions` | 300 | 2.9 | 3.2 | 58 | 162 |
| `decisions` | 1000 | 5.5 | 5.6 | 519 | 1.2 s |
| `related` | 10 | 3.7 | 3.9 | 15 | 30 |
| `related` | 100 | 29 | 29 | 97 | 155 |
| `related` | 300 | 88 | 89 | 181 | 269 |
| `related` | 1000 | 318 | 318 | 799 | 1.3 s |
| `judge (room)` | 10 | 4.5 | 4.6 | 8.5 | 15 |
| `judge (room)` | 100 | 19 | 20 | 25 | 48 |
| `judge (room)` | 300 | 54 | 55 | 103 | 148 |
| `judge (room)` | 1000 | 198 | 198 | 386 | 510 |
| `judge (script)` | 10 | 4.3 | 5.2 | 7.0 | 12 |
| `judge (script)` | 100 | 19 | 20 | 26 | 46 |
| `judge (script)` | 300 | 54 | 55 | 86 | 105 |
| `judge (script)` | 1000 | 198 | 198 | 392 | 393 |
| `ideas/room` | 10 | 4.3 | 4.4 | 8.4 | 17 |
| `ideas/room` | 100 | 19 | 20 | 36 | 68 |
| `ideas/room` | 300 | 54 | 54 | 124 | 202 |
| `ideas/room` | 1000 | 198 | 198 | 392 | 589 |
| `attach-targets` | 10 | 5.5 | 5.7 | 14 | 37 |
| `attach-targets` | 100 | 48 | 49 | 104 | 202 |
| `attach-targets` | 300 | 144 | 144 | 294 | 652 |
| `attach-targets` | 1000 | 479 | 479 | 950 | 1.6 s |
| `capabilities` | 10 | 0.6 | 0.8 | 12 | 19 |
| `capabilities` | 100 | 0.8 | 0.9 | 68 | 131 |
| `capabilities` | 300 | 0.9 | 1.3 | 174 | 251 |
| `capabilities` | 1000 | 1.0 | 1.4 | 591 | 1.2 s |
| `open (GET /d)` | 10 | 7.4 | 8.6 | 21 | 31 |
| `open (GET /d)` | 100 | 7.4 | 7.9 | 83 | 144 |
| `open (GET /d)` | 300 | 7.3 | 8.3 | 160 | 507 |
| `open (GET /d)` | 1000 | 7.6 | 7.7 | 876 | 1.4 s |
| `needs` | 10 | 1.2 | 1.4 | 2.5 | 7.8 |
| `needs` | 100 | 2.3 | 3.9 | 3.3 | 29 |
| `needs` | 300 | 9.2 | 9.7 | 14 | 150 |
| `needs` | 1000 | 109 | 110 | 110 | 296 |
