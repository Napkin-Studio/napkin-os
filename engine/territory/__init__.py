"""Territory tool, first slice (features/territory-tool.clan): from a brief to 3-5 rough territory cards.

Text only, owned data only, no web. Every model call goes through an injected ``llm`` callable, so the
pipeline runs offline in tests; ``run.py`` is the only place a paid call can start, and it shows the cost
first and waits for an explicit yes. Run tests from ``engine/``: ``PYTHONPATH=. python3 -m pytest -q territory/tests``.
"""
