# Feature records

Every feature has one CLAN document here: `features/<slug>.clan`. It holds the
design agreed before any code was written, and the build as it went: what
changed, in which commit, what is still open, and what to do next. A person or
an agent who has never seen the feature should be able to open the record and
carry on without a briefing.

We use our own format for this on purpose. Attribution is enforced, so every
change says who made it and why. The schema (`feature.schema.json`) is checked
on every write. The decision chain keeps the history short enough to read.

## The lifecycle

```
exploring ──▶ designed ──▶ building ──▶ verifying ──▶ shipped
    │  (owner approves                                  
    │   the design)                     abandoned (at any point, with a decision saying why)
```

**exploring.** No code yet. Whoever picks up the feature, person or agent,
answers the design questions in the record's `agent/context.md`:

1. Problem, `done_when`, `non_goals`
2. Prior art: what already exists in the repo or in other feature records
3. At least two approaches, each with its build cost and run cost. One is chosen, and the record says why the others lose.
4. Rework risks: what would make us redo this or slow the process later, and how the design avoids it
5. Reach: which areas and contracts it touches, and who reads them
6. Breakage: what could break, and the test or check that catches it
7. Rollout and rollback

The point is to find the better design before anyone writes code, not after
a week spent doing it the slow way.

**designed.** The owner has read the design and approved it
(`design.approved_by`). `scripts/feature status <slug> designed` refuses until
every part is filled in.

**building / verifying.** Build what was approved. If the design turns out to
be wrong, record a decision and update `design` first. Each meaningful step
gets a `build_log` entry tied to a commit.

## Commands

```bash
scripts/feature new <slug> "<title>" [--owner NAME]
scripts/feature list
scripts/feature show <slug>                  # the full agent context: read this first
scripts/feature status <slug> designed       # gated on a complete, approved design
scripts/feature log <slug> "what changed"    # build_log entry at HEAD
scripts/feature checked <slug> pass "rust frontend"
scripts/feature verify                       # the gate, over every record
```

For anything else, use the `clan` CLI directly (`clan agent-help`). For example:
`clan patch-data features/<slug>.clan '{"design":{…}}' --agent <you> --action "design: approaches"`.
Set `FEATURE_AGENT` to say who is writing. It defaults to your git user.name,
and agents set their own name, for example `FEATURE_AGENT=claude`.

## What the pre-push hook enforces

`.githooks/pre-push` (turn it on with `git config core.hooksPath .githooks`).
Work on `feat/<slug>` and land it through a squash-merged PR, because pushes to
`main` are refused. Project-wide facts and the plan live in `napkin-studio.clan`.
Its `plan` names feature slugs and never copies their content.

- Commits that change code must change a feature record in the same push.
  A typo-sized fix can carry the commit trailer `Feature: none` instead, as the
  last line of the message.
- Every feature record in the push must pass `scripts/feature verify`.
- `scripts/check.sh` must pass for the CI suites the push reaches.

`.clan` files are ZIP archives (`*.clan binary` in `.gitattributes`). One
record per feature keeps two people from editing the same file. If two
branches do touch the same record, resolve it with `clan merge`, not by hand.
