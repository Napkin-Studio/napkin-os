# ADR 0023 — Deck Maker: the deck takes only the prompt, the research and the brief

Status: accepted (Sai, 2026-10-05) · Code: `engine/deck/assemble.py` (guardrails, cover), `validate.py`
(`numbers_trace`, `numbers_uncited`, `rule_broken`), `packs/` · Builds on ADR 0016 · Register:
`docs/deck-maker/edge-cases.md` DK-025.

## Context

The thin slice added content from outside the inputs: legal lines and "required on deck" text from
the category packs, a VAT line, and "Napkin" as the agency on the cover. Each looked helpful, but
none could be traced to anything the client or the user gave, and the deck's promise is that
everything on it is traceable.

## Decision

Sai, verbatim: "the pitch deck cannot have any extra information as input apart from the prompt user
gave, the research tool output and the brief tool output. that is all."

1. Inputs are: the prompt (`--client`, `--project`, `--agency`), the research tool's CLAN, and the
   brief tool's output. Documents attached to the brief (`--doc`) count as brief material.
2. Guardrails come only from the brief's mandatories, research findings on regulation and category
   codes, and the brief's tone requirement.
3. Packs may still flag banned imagery, phrases and watch words (they check, they do not add), but
   `legal_lines` and `required_on_deck` no longer go on slides.
4. The agency name appears only when the prompt gives one; otherwise the cover shows `[Agency]`.
5. Every stage prompt ends with "Inputs are the only source…".

## Consequences

- Numbers are enforced in code (`numbers_trace` fails an invented number). Words are not: model
  copy can still add outside facts (DK-025), so this rule is partly a review duty.
- Client builds always carry some labelled placeholders (presenter, team, case studies, budget
  split, decision date) because nothing in the inputs supplies them.
