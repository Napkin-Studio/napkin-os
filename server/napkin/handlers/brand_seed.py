"""brand_seed@1: a Brand Clan's first content, from the roster and the brand layer (brand-clan.md section 5).

Runs on a freshly created, empty Brand Clan (`ie.napkin.brand`). No model, no research, no
web: the handler is given a `LayersView`, which has none of those attributes.
"""

from ..pipeline import brand

NAME, TASK, VERSION, KIND, CAPABILITY_MAJOR = "brand_seed", "brand_seed", "1.0", "short", 1
VIEW = "layers"


def run(req, view):
    """-> (result, change, hits)."""
    return brand.seed(req.doc, req.base, req.clan, req.inp, req.handler, view.layers)
