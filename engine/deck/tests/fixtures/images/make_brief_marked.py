"""Builds the invented marked brief (Lumen Water; no real client): a Brief Maker .clan with confidential_fields and a classify mark."""
import io, zipfile, yaml
from pathlib import Path


def build(path: Path) -> Path:
    data = {"background": "Lumen Water sells bottled water to households.", "objectives": {"commercial": "Move more cases through grocers."},
            "audience": "Households that never think about the tap.",
            "single_minded_proposition": "Every drop has a story.", "tone_and_world": "A quiet kitchen at dawn.",
            "budget_and_scope": "Project Nightjar launches with oat milk in a blue kettle for 2027.",
            "mandatories": ["Keep the kettle campaign secret until spring."],
            "confidential_fields": ["budget_and_scope", "mandatories[0]"]}
    chain = [{"id": "d_1", "kind": "classify", "targets": ["doc1#audience"], "licence": {"model": False, "export": True, "corpus": False}}]
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("manifest.yaml", yaml.safe_dump({"document_id": "doc1", "app": {"app_id": "ie.napkin.brief-maker"}}))
        z.writestr("shared/data.yaml", yaml.safe_dump(data))
        z.writestr("agent/decision-chain.yaml", yaml.safe_dump({"decisions": chain}))
    return path
