"""Deck Maker: turn a client brief, research and the brief maker's brief into a pitch deck.

The package is the engine side of the Deck Maker app (ADR 0016). The pipeline is:

    inputs -> a. requirements -> b. storyline -> c. territories -> d. idea + executions
           -> assemble (deterministic) -> e. slide copy -> f. validate -> g. render -> h. visual QA

Model stages (a-e) live in ``stages.py``; everything else is plain code with no model call, so a
deck can be rebuilt, validated and rendered for free from recorded stage outputs.
"""
