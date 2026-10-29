#!/usr/bin/env python3
"""
ingest_awardlib.py — the award case library as RAG-ready markdown, following the pattern
of ingest_effie.py / ingest_ipa.py.

The library is a workbook of short award cases ("Creative Chess Evidence", sheet `Cases`).
Its strategy fields (insight, proposition) are Napkin reconstructions from public sources,
not the entrant's words; its results are entrant-reported and not audited; its rights are
"public facts only, no asset reuse". Every file this script writes says so in its body and
in its chunk header, so the label travels with the text.

    python3 ingest_awardlib.py                      # reference/_raw/awardlib/cases.xlsx
    python3 ingest_awardlib.py --input cases.csv --dry-run

Writes one .md per case to reference/rag/awardlib/lib_<hash>.md plus _manifest.json (the
input's sha256, the rule, every count, every skip). The index picks the files up through
rag/build_rag.sh like any other source, and they stay hidden from retrieval until
RAG_AWARDLIB admits them (rag/brief_context.py; ADR 0017).

What goes in (the slice) — an effectiveness award, or a result the entrant states in
numbers. What stays out — rights that are not plainly "public facts only"; a case whose
title and brand already exist in the IPA / Cannes / Effie corpus; a case with no client
category (never guessed: the brand table is model-derived and lists what it covers).

Deterministic: rows sorted by case_id, no timestamps in the files, same input -> same bytes
-> same chunk ids. .xlsx needs openpyxl (imported only then); CSV and JSON need nothing.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / "rag"))
import chunking  # noqa: E402  (frontmatter reader, for the dedupe scan)
import normalise  # noqa: E402

DEFAULT_INPUT = HERE / "reference" / "_raw" / "awardlib" / "cases.xlsx"
DEFAULT_MAPPING = HERE / "reference" / "awardlib" / "brand_categories.json"
DEFAULT_CORPUS = HERE / "reference" / "rag"
DEFAULT_OUT = DEFAULT_CORPUS / "awardlib"
SLICES = ("effectiveness_results", "all")
DEDUPE_SOURCES = ("ipa", "cannes", "effie")          # corpora a library case may duplicate
CONTRACT_TIERS = ("grand_prix", "gold", "silver", "bronze", "shortlist")

PROVENANCE = ("**Provenance:** the strategy fields below are Napkin reconstructions from public "
              "sources, not the entrant's own words. Results are entrant-reported and not "
              "independently audited. Public facts only; no asset reuse rights.")


# ---- small, tested rules -------------------------------------------------------------
def norm_key(s) -> str:
    """Lower-case, non-alphanumerics collapsed to single spaces: the lookup key for brands
    and titles."""
    return re.sub(r"[^a-z0-9]+", " ", str(s or "").lower()).strip()


_LABEL = re.compile(r"(?i)^\s*\[?\s*(reconstructed by napkin|napkin reconstruction|reconstructed)\s*\]?\s*:?\s*")


def strip_label(text) -> str:
    """Drop a leading 'Reconstructed by Napkin:' style tag. The section heading and the
    chunk header already say it, and a tag in the middle of a sentence reads as noise."""
    return _LABEL.sub("", re.sub(r"\s+", " ", str(text or "")).strip()).strip()


def award_family(raw) -> str:
    """effectiveness | creative | pr | craft | unknown. The sheet writes `pr` and
    `public_relations` for one family and, in a few rows, an award show's name or nothing."""
    v = norm_key(raw)
    if v == "effectiveness":
        return "effectiveness"
    if v == "creative":
        return "creative"
    if v in ("pr", "public relations"):
        return "pr"
    if v == "craft":
        return "craft"
    return "unknown"


_NEG_START = re.compile(r"(?i)^\s*(no\b|none\b|not\b|unknown\b|n/?a\b|u$|null\b|nothing\b|neither\b)")


def results_evidence(text) -> str:
    """entrant_reported when the results text states a number and is not a negation, else
    none. 507 distinct free-text status strings exist in the sheet, so the TEXT is the
    evidence, not the status column: a quantified claim is the only thing a brief can cite."""
    t = re.sub(r"\s+", " ", str(text or "")).strip()
    if not t or t.startswith("{"):          # empty, or a structured blob rather than a result
        return "none"
    if not re.search(r"\d", t) or _NEG_START.search(t):
        return "none"
    return "entrant_reported"


def rights(raw) -> str:
    """public_facts_only for every variant the sheet uses for 'public facts, no asset reuse'
    (33 spellings and a JSON form); unknown for anything else, which is skipped."""
    s = str(raw or "").strip()
    if not s:
        return "unknown"
    if s.startswith("{"):
        try:
            return "public_facts_only" if json.loads(s).get("assets_reused") is False else "unknown"
        except ValueError:
            return "unknown"
    return "public_facts_only" if "public" in s.lower() else "unknown"


def native_wording(raw) -> str | None:
    """The awarding body's own wording, for display: None when absent or a structured blob."""
    s = re.sub(r"\s+", " ", str(raw or "")).strip()
    return None if not s or s.startswith("{") or s.lower() == "unknown" else s[:120]


def resolve_tier(native: str | None, outcome) -> str | None:
    """The tier label chunking will normalise. The awarding body's wording wins when it names
    a tier (Gold, Grand Prix, a pencil); when it does not (Merit, Finalist, absent) the
    sheet's normalized outcome stands in if it is a contract tier; otherwise the wording is
    passed on as it is and normalises to `other`, never to a guess."""
    if native and normalise.award_tier(native) not in (None, "other"):
        return native
    o = str(outcome or "").strip().lower()
    if o in CONTRACT_TIERS:
        return o.replace("_", " ")
    return native


def in_slice(family: str, evidence: str, mode: str) -> bool:
    """effectiveness_results: an effectiveness award, or a stated result. all: everything."""
    return mode == "all" or family == "effectiveness" or evidence == "entrant_reported"


# ---- input -----------------------------------------------------------------------------
def read_rows(path: Path) -> list[dict]:
    """Rows as {column: value} from .xlsx (sheet `Cases`, else the first), .csv or .json."""
    suffix = path.suffix.lower()
    if suffix in (".csv", ".tsv"):
        with open(path, newline="", encoding="utf-8") as f:
            return list(csv.DictReader(f, delimiter="\t" if suffix == ".tsv" else ","))
    if suffix == ".json":
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else list(data.get("rows") or data.get("data") or [])
    if suffix in (".xlsx", ".xlsm"):
        import openpyxl                     # only here: CI's engine environment does not carry it
        wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
        ws = wb["Cases"] if "Cases" in wb.sheetnames else wb.worksheets[0]
        it = ws.iter_rows(values_only=True)
        head = [str(h) if h is not None else "" for h in next(it)]
        return [dict(zip(head, r)) for r in it if any(c is not None for c in r)]
    sys.exit(f"unsupported input type: {path}")


def load_mapping(path: Path) -> dict:
    """norm_key(brand) -> {category, ambiguous}. The file is committed next to this script."""
    raw = json.loads(path.read_text(encoding="utf-8"))
    return {norm_key(b): v for b, v in (raw.get("brands") or {}).items()}


def load_existing(corpus: Path) -> list[dict]:
    """Titles already in the IPA / Cannes / Effie corpus, for the duplicate check."""
    out: list[dict] = []
    for src in DEDUPE_SOURCES:
        for p in sorted((corpus / src).rglob("*.md")) if (corpus / src).is_dir() else []:
            meta, _ = chunking.parse_frontmatter(p.read_text(encoding="utf-8", errors="replace"))
            name = re.sub(r"\(\d{4}\)\s*$", "", str(meta.get("framework_name") or meta.get("title") or p.stem))
            if not meta:
                continue
            out.append({"doc_id": str(meta.get("framework_id") or p.stem), "title": norm_key(name),
                        "client": set(norm_key(meta.get("client")).split()),
                        "year": str(meta.get("year") or "")})
    return out


def _year(v) -> int | None:
    m = re.fullmatch(r"\s*(\d{4})\s*", str(v or ""))
    return int(m.group(1)) if m else None


def find_duplicate(title: str, brand: str, year, existing: list[dict]) -> str | None:
    """doc_id of an existing case this one repeats. The same normalised title is not enough
    on its own (generic titles such as "Launch" recur across brands): it must also share a
    brand word or fall within a year of the existing case. A title that shares at least 80%
    of its words needs the brand to overlap too: the library words a title differently
    from the entry form."""
    t, b, y = norm_key(title), set(norm_key(brand).split()), _year(year)
    tt = set(t.split())
    for e in existing:
        ey = _year(e["year"])
        near = y is not None and ey is not None and abs(y - ey) <= 1
        if e["title"] == t and ((b & e["client"]) or near):
            return e["doc_id"]
        et = set(e["title"].split())
        if tt and et and len(tt & et) / len(tt | et) >= 0.8 and (b & e["client"]):
            return e["doc_id"]
    return None


# ---- one case ---------------------------------------------------------------------------
def doc_id_for(case_id) -> str:
    return "lib_" + hashlib.sha1(str(case_id).encode()).hexdigest()[:10]


def build_case(row: dict, mapping: dict) -> tuple[dict | None, str | None]:
    """(case, None) or (None, reason it is skipped). Pure: no files, no corpus."""
    g = lambda k: row.get(k)                                         # noqa: E731
    if rights(g("rights_status")) != "public_facts_only":
        return None, "rights_not_public_facts_only"
    text = strip_label(g("rag_text") or "")
    problem = strip_label(g("problem"))
    if not (text or problem):
        return None, "no_text"
    family = award_family(g("award_family"))
    evidence = results_evidence(g("reported_results"))
    brand = str(g("brand") or "").strip()
    cat = mapping.get(norm_key(brand))
    native = native_wording(g("native_award_wording"))
    year = str(g("award_year") or "").strip()[:4]
    title = str(g("title") or "").strip()
    fm = {
        "source": "awardlib",
        "framework_id": doc_id_for(g("case_id")),
        "framework_name": f"{brand} — {title} ({year})" if year else f"{brand} — {title}",     # award year, as the other sources
        "category": "award_library_case",
        "client_category": cat["category"] if cat else None,
        "category_confidence": ("ambiguous" if cat and cat.get("ambiguous") else "derived") if cat else None,
        "award_tier": resolve_tier(native, g("normalized_outcome")),
        "award_tier_raw": native,
        "award_outcome": str(g("normalized_outcome") or "").strip().lower() or None,
        "award_show": str(g("award_show") or "").strip() or None,
        "award_family": family,
        "year": year or None,
        "campaign_year": str(g("campaign_year") or "").strip()[:4] or None,
        "client": brand or None,
        "agency": str(g("agency") or "").strip() or None,
        "country": str(g("country") or "").strip() or None,
        "case_id": str(g("case_id")),
        "text_origin": "napkin_reconstruction",
        "results_evidence": evidence,
        "rights": "public_facts_only",
        "human_review": "machine_only",
        "official_source_url": str(g("official_source_url") or "").strip() or None,
        "campaign_source_url": str(g("campaign_source_url") or "").strip() or None,
    }
    sections = [("Problem", strip_label(g("problem"))), ("Audience", strip_label(g("audience"))),
                ("Insight (reconstructed)", strip_label(g("insight"))),
                ("Proposition (reconstructed)", strip_label(g("proposition"))),
                ("Idea", strip_label(g("idea"))), ("Execution", strip_label(g("execution"))),
                ("Reported results (entrant-reported, not audited)", strip_label(g("reported_results")))]
    sections = [(h, t) for h, t in sections if t and not t.startswith("{")]
    return {"fm": {k: v for k, v in fm.items() if v not in (None, "")}, "title": fm["framework_name"],
            "sections": sections, "family": family, "evidence": evidence, "brand": brand,
            "year": year, "case_title": title, "has_category": bool(cat),
            "sources": [(lbl, u) for lbl, u in (("Award listing", fm.get("official_source_url")),
                                                ("Campaign source", fm.get("campaign_source_url"))) if u]}, None


def render_md(case: dict) -> str:
    """The markdown file. Every frontmatter value is JSON (a valid YAML scalar) so a title
    with a colon or a quote cannot break the block."""
    fm = "\n".join(f"{k}: {json.dumps(v, ensure_ascii=False)}" for k, v in case["fm"].items())
    parts = [f"---\n{fm}\n---\n", f"# {case['title']}\n\n{PROVENANCE}\n"]
    for h, t in case["sections"]:
        parts.append(f"## {h}\n{t}\n")
    if case["sources"]:
        parts.append("## Sources\n" + "\n".join(f"- {lbl}: {u}" for lbl, u in case["sources"]) + "\n")
    return "\n".join(parts)


# ---- the run ----------------------------------------------------------------------------
def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run(input_path: Path, mapping_path: Path, corpus: Path, out_dir: Path, slice_mode: str = "effectiveness_results",
        dry_run: bool = False, prune: bool = False) -> dict:
    rows = sorted(read_rows(input_path), key=lambda r: str(r.get("case_id")))
    mapping, existing = load_mapping(mapping_path), load_existing(corpus)
    skipped: dict[str, int] = {}
    duplicates: list[dict] = []
    written: list[str] = []
    out: dict[str, str] = {}
    for row in rows:
        if not row.get("case_id"):
            skipped["no_case_id"] = skipped.get("no_case_id", 0) + 1
            continue
        case, why = build_case(row, mapping)
        if case is None:
            reason = why or "unreadable"
            skipped[reason] = skipped.get(reason, 0) + 1
            continue
        if not in_slice(case["family"], case["evidence"], slice_mode):
            skipped["outside_slice"] = skipped.get("outside_slice", 0) + 1
            continue
        dup = find_duplicate(case["case_title"], case["brand"], case["year"], existing)
        if dup:
            duplicates.append({"case_id": case["fm"]["case_id"], "title": case["case_title"], "matches": dup})
            skipped["duplicate_of_existing_corpus"] = skipped.get("duplicate_of_existing_corpus", 0) + 1
            continue
        if not case["has_category"]:
            skipped["no_client_category"] = skipped.get("no_client_category", 0) + 1
            continue
        out[case["fm"]["framework_id"] + ".md"] = render_md(case)
    manifest = {"input": str(input_path), "input_sha256": sha256(input_path), "mapping_sha256": sha256(mapping_path),
                "slice": slice_mode, "rows_read": len(rows), "written": len(out), "skipped": dict(sorted(skipped.items())),
                "duplicates": duplicates}
    if not dry_run:
        out_dir.mkdir(parents=True, exist_ok=True)
        for name, md in out.items():
            (out_dir / name).write_text(md, encoding="utf-8")
            written.append(name)
        if prune:
            for p in sorted(out_dir.glob("lib_*.md")):
                if p.name not in out:
                    p.unlink()
        (out_dir / "_manifest.json").write_text(json.dumps(manifest, indent=1, ensure_ascii=False, sort_keys=True) + "\n",
                                                encoding="utf-8")
    return manifest


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=(__doc__ or "").split("\n\n")[0])
    ap.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    ap.add_argument("--mapping", type=Path, default=DEFAULT_MAPPING)
    ap.add_argument("--corpus", type=Path, default=DEFAULT_CORPUS, help="where the IPA/Cannes/Effie .md live, for the duplicate check")
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--slice", choices=SLICES, default="effectiveness_results")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--prune", action="store_true", help="delete lib_*.md files this run no longer produces")
    a = ap.parse_args(argv)
    if not a.input.exists():
        sys.exit(f"input not found: {a.input}\n(copy the workbook there, or pass --input)")
    if not a.corpus.is_dir():
        print(f"warning: no corpus at {a.corpus}: nothing to check duplicates against", file=sys.stderr)
    m = run(a.input, a.mapping, a.corpus, a.out, a.slice, a.dry_run, a.prune)
    verb = "Would write" if a.dry_run else "Wrote"
    print(f"{verb} {m['written']} cases to {a.out} (of {m['rows_read']} rows; slice {m['slice']})")
    for k, v in m["skipped"].items():
        print(f"  skipped {v:5}  {k}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
