# Napkin OS build log

One entry per session, newest last. Entries are never edited after the session ends.
The prompt for this build is docs/napkin-os-build-prompt-v3.1.md. It wins over v2 and v3.

## 2026-11-11 · Discovery · session 1

**Run settings.** Claude Code, Fable 5.2, billed to the Claude API (napkin Console org).
Subagents on Sonnet 5.5. Branch feat/discovery, cut from develop at ea34367b,
in the worktree ../napkin-discovery. Started 00:57 UTC.

**Plan for this session.** The five hand-back items in section 9 of the prompt:

1. The audit: docs/discovery/audit.md
2. The design proposal: docs/design/ (static HTML, 390 and 1440 px)
3. The Phase 1 feature records: features/*.clan, status exploring
4. The harness record and the Cannes removal record
5. The open questions list: docs/discovery/open-questions.md

**Progress.**

- Read napkin-studio.clan, the feature list (66 records) and all three prompts.
- Started nine read-only audits. Five cover this repo: the shell, the brief path,
  the platform, where Cannes material sits, and the production tools.
  Four cover the seven outside repos this login can reach (docs/sources/repos.md).
- Started scripts/check.sh --all on the branch, with no provider key in its environment.
- Harness read by hand: .claude/settings.json holds only the attribution switch,
  so there is no deny rule on .env. The hooks are commit-msg and pre-push; neither
  scans for secrets. CI has no secret scan. scripts/check.sh has an optional e2e suite
  (`--only e2e`), never part of `--all`.

**Could not verify at the start.**

- Eleven of the eighteen outside repos answer Not Found for this login.
- No file in the repo is named ADR-004.
- The raw J001 brief and the v2 section 13 artifacts are not on disk.
