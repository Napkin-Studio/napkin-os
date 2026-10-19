"""brand_identify@1: which brands of this agency does a typed name match? (brand-clan.md section 5)

Read only, on any document. The agency's layers only (`find_brands`, then `roster` for each
candidate): no model, no research, no web. The handler is given a `LayersView`, which has
none of those attributes. The shell asks the person when there are several.
"""

from ..pipeline import brand

NAME, TASK, VERSION, KIND, CAPABILITY_MAJOR = "brand_identify", "brand_identify", "1.0", "short", 1
VIEW = "layers"


def run(req, view):
    """-> (result, change, hits)."""
    return brand.identify(req.inp, view.layers)
