"""Brand Clan lane B: is this file a brand bible (`brand_identify`), and build or update a Brand Clan from it (`brand_build`).

docs/contracts/brand-clan.md section 7 is the contract these write against; docs/contracts/middleware-api.md section 13 is the task API.

Confidential (owner, 2026-11-13): a brand bible is the client's material. Its text and pictures go to the model and nowhere else:
never the shared layers, RAG, evals or a run-log body (every purpose here starts `brand_`, which the run log never records
bodies for), and an error message here never carries what the file said.
"""

PAGE_CAP = 120      # pages read without asking; above it the person is asked before more is spent (owner, 2026-11-23)
HARD_CAP = 400      # pages never read, even when the person says yes
CONFIDENTIAL_PREFIX = "brand_"


def confidential(purpose: str) -> bool:
    """A model purpose whose request and reply bodies must never reach a log."""
    return str(purpose or "").startswith(CONFIDENTIAL_PREFIX)
