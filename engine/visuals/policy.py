"""Who may send what to the picture models (the Territory frames and the Deck's pictures).

Decision (Shrey, 26 Nov 2026, replacing the refuse-by-default of 18 Nov): client material goes to Runway's picture models the same way it
goes to the language models on Bedrock. Marking a part Confidential changes one thing only: it stays out of Napkin's own RAG, knowledge
layers, training and evals (features/confidential-means-napkin-never-sees). It does not keep a part away from the tools that make the work.

What still runs on every prompt is the picture-prompt lint (``visuals.lint``: the allow-listed words, no brand names, figures or names, no
banned imagery). Every cost card and report prints ``label()``, so the rule is never silent.
"""
from __future__ import annotations

DECIDED = "client material goes to the picture models; Confidential keeps a part out of Napkin's own knowledge only (Shrey, 2026-11-26)"


def label() -> str:
    """The line a card or report prints."""
    return ("Client material -> Runway: sent, like Bedrock. Every prompt is linted; a part marked Confidential stays out of Napkin's own "
            "knowledge, not out of the work")
