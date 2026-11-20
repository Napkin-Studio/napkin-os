"""Load and normalise everything a deck is built from.

Five inputs, each optional so long as the person gave something (ADR 0028: a prompt, documents, a
brief or research, in any combination; at least a prompt, a document or a brief):

* the person's prompt text and any answers they gave to the intake questions (``prompt:<n>``, ``answer:<qid>``);
* the brief maker's ``brief_object.json`` (fields, provenance, fact_refs, how_to_win, open questions);
* a research CLAN (``shared/facts.yaml``, ``findings.yaml``, ``sources.yaml``, the decision chain,
  and the client documents' extracted text under ``human/assets/.extracted/``);
* documents the person attached (``--doc``: .docx, .pdf, .txt, .md, .eml, images);
* client-document figures read from pages whose text layer is unusable (``doc_facts.json``,
  written by the vision read stage; see stages.py ``read_doc_figures``).

A Deck document's own data (``from_upstream``) is read the same way as the files. Nothing here calls a model. Coverage of every input is recorded in ``Inputs.coverage`` so a run
can report that nothing was dropped (Sai's rule: never drop input).
"""
from __future__ import annotations

import json
import re
import zipfile
from dataclasses import dataclass, field
from pathlib import Path

import yaml

#: brief_object field ids -> the deck's brief paths (brief:<path>)
BRIEF_FIELDS = ["background", "objectives", "audience", "competitor_context", "insight", "smp",
                "reasons_to_believe", "desired_response", "tone_world_assets", "budget_scope",
                "mandatories"]


@dataclass
class Inputs:
    """Everything the deck can cite, keyed the way claims reference it."""
    brief: dict                      # field id -> {value, kind, mark, fact_refs, reason?, rejected_attempt?}
    how_to_win: dict = field(default_factory=dict)   # stated_evaluation_criteria, unstated_needs, likely_landmines, ...
    open_questions: list = field(default_factory=list)   # [{question, why, priority}]
    facts: dict = field(default_factory=dict)        # f_ id -> fact row
    findings: dict = field(default_factory=dict)     # fi_ id -> finding row (status: verified|proposed|rejected)
    sources: dict = field(default_factory=dict)      # src_ id -> source row
    docs: dict = field(default_factory=dict)         # doc key -> {name, text, chars}
    doc_facts: dict = field(default_factory=dict)    # doc:<key>#<loc> -> {value, unit, label, as_of, page}
    research_doc_id: str | None = None
    research_title: str | None = None
    rejected_pins: set = field(default_factory=set)  # pins a person marked bad
    coverage: dict = field(default_factory=dict)
    prompt_text: str = ""                            # the person's prompt, any length (cited prompt:<n>)
    answers: dict = field(default_factory=dict)      # qid -> {text|option_id, at, skipped?} (cited answer:<qid>)
    built_from: dict = field(default_factory=dict)   # intake.tier(): {tier, documents, brief, research}
    intake: dict = field(default_factory=dict)       # the a0 gaps/questions as the runner wrote them
    verified: dict = field(default_factory=dict)     # confirm ref -> {by, at}: the person's verify decisions (intake.verified.<ref>)
    marks: list | None = None                        # parts a person marked Confidential: [{path, text, kind}]; None = never checked (picture generation is refused)
    brief_source: dict = field(default_factory=dict)  # finish fixes: the brief's own source sentences {n: text}, what its source_refs number (load_brief)
    brief_issues: list = field(default_factory=list)  # brief gaps: what is wrong with or missing from the brief (brief_object.brief_issues)

    def has_brief(self) -> bool:
        """True when a brief supplied at least one field (a field an intake stage filled does not count)."""
        return any(f.get("value") and not f.get("from_intake") for f in self.brief.values())

    def has_research(self) -> bool:
        """True when a research CLAN was given. The evidence track's figures (``--evidence``, origin ``evidence``) are citable facts but not
        a research CLAN: a prompt-only run that has them is still built from a prompt (its tier and its sketch rule stand)."""
        return bool(self.findings) or any(f.get("origin") != "evidence" for f in self.facts.values())


def _unwrap(doc, key):
    """CLAN members wrap their list in a top-level key (RUNBOOK §3); accept either form."""
    if isinstance(doc, dict):
        return doc.get(key) or []
    return doc or []


def load_brief(path: Path) -> tuple[dict, dict, list, dict]:
    """Read brief_object.json into (fields, how_to_win, open_questions, coverage)."""
    b = json.loads(Path(path).read_text())
    golden = b.get("loop2_golden") or {}
    gfields = golden.get("fields") or {}
    prov = golden.get("provenance") or {}
    fields = {}
    for fid in BRIEF_FIELDS:
        f = gfields.get(fid) or {}
        p = prov.get(fid) or {}
        fields[fid] = {
            "value": f.get("value"),
            "kind": p.get("kind") or f.get("source") or "missing",
            "mark": p.get("mark") or "",
            "fact_refs": f.get("fact_refs") or [],
            "reason": f.get("reason"),
            "rejected_attempt": f.get("rejected_attempt"),
            "review": f.get("review"),
            "rival": (f.get("territory") or {}).get("rival"),
        }
    capture = b.get("loop1_capture") or {}
    htw = capture.get("how_to_win") or {}
    oq = []
    for q in (b.get("loop2_brief") or {}).get("open_questions") or []:
        oq.append({"question": q.get("question"), "why": q.get("why_it_matters", ""), "priority": q.get("priority", "normal")})
    for q in golden.get("generation_open_questions") or []:
        oq.append({"question": q.get("question"), "why": q.get("why_it_matters", ""), "priority": q.get("priority", "medium")})
    cov = {"brief_fields": len(fields), "brief_fields_filled": sum(1 for f in fields.values() if f["value"]),
           "how_to_win_points": sum(len(v) for v in htw.values() if isinstance(v, list)),
           "open_questions": len(oq), "capture_fields": len(capture.get("fields") or {})}
    src = source_sentences(capture)
    if src:
        cov["source_sentences"] = src   # popped by load() into Inputs.brief_source: never part of the recorded coverage
    if isinstance(b.get("brief_issues"), list) and b["brief_issues"]:
        cov["brief_issues"] = [i for i in b["brief_issues"] if isinstance(i, dict)]   # popped by load() into Inputs.brief_issues
    return fields, htw, oq, cov


def source_sentences(capture: dict) -> dict:
    """finish fixes: the brief tool's source sentences ``{n: text}``, rebuilt from what its capture quotes. Every captured field and every
    how-to-win point carries ``source_refs`` (sentence numbers of the client's own text) beside the words it quotes (``source_quote`` or
    ``evidence``). The stages see those numbers and cite them as ``prompt:<n>``; with no prompt in the run they resolved to nothing
    (unknown_ref on every slide citing one). A quote that splits into as many sentences as it has refs gives each its sentence; a
    number never seen whole stays unknown, so nothing is guessed."""
    from .refs import prompt_sentences
    out: dict = {}

    def walk(x):
        if isinstance(x, dict):
            refs_ = x.get("source_refs")
            quote = x.get("source_quote") or x.get("evidence")
            if isinstance(refs_, list) and refs_ and isinstance(quote, str) and all(isinstance(r, int) for r in refs_):
                parts = prompt_sentences(quote)
                if len(parts) == len(refs_):
                    for n, t in zip(refs_, parts):
                        out.setdefault(int(n), t)
            for v in x.values():
                walk(v)
        elif isinstance(x, list):
            for v in x:
                walk(v)
    walk(capture or {})
    return dict(sorted(out.items()))


def parse_research(facts, findings, sources, chain, docs=None, doc_id=None, title=None, *, chain_rejects_findings=False) -> dict:
    """The one reading of research rows: lists (or members wrapped in their top-level key) into the
    dict load_research returns. A pin a person marked bad in the decision chain is a rejected pin.
    With ``chain_rejects_findings`` a finding a person marked bad in the chain is also set to
    status ``rejected`` (a Deck document carries the chain whole, so a finding rejected upstream
    stays rejected)."""
    facts = {f["id"]: f for f in _unwrap(facts, "facts")}
    findings = {f["id"]: f for f in _unwrap(findings, "findings")}
    sources = {s["id"]: s for s in _unwrap(sources, "sources")}
    chain = _unwrap(chain, "decisions")
    rejected_pins = set()
    for d in chain:
        if d.get("kind") == "verdict" and d.get("polarity") == "bad":
            for t in d.get("targets") or []:
                tid = str(t).split("[")[-1].rstrip("]")
                if tid.startswith("f_"):
                    rejected_pins.add(tid)
                elif chain_rejects_findings and tid in findings and findings[tid].get("status") != "rejected":
                    findings[tid] = {**findings[tid], "status": "rejected",
                                     "rejection": {"reason": d.get("reason") or d.get("note") or "marked bad in the decision chain"}}
    return {"facts": facts, "findings": findings, "sources": sources, "docs": docs or {},
            "rejected_pins": rejected_pins, "doc_id": doc_id, "title": title, "chain_len": len(chain)}


def load_research(clan: Path) -> dict:
    """Read a research CLAN zip (read-only; .clan files are edited only with the clan CLI)."""
    z = zipfile.ZipFile(clan)
    names = set(z.namelist())
    rd = lambda n: yaml.safe_load(z.read(n)) if n in names else None  # noqa: E731
    docs = {}
    for n in sorted(names):
        if n.startswith("human/assets/.extracted/") and n.endswith(".txt"):
            name = n.rsplit("/", 1)[-1][:-4]
            text = z.read(n).decode("utf-8", "replace")
            key, n = _doc_key(name), 2
            while key in docs:   # names sharing a 24-character prefix must not overwrite each other
                key = f"{_doc_key(name)[:20]}_{n}"
                n += 1
            docs[key] = {"name": name, "text": text, "chars": len(text), "origin": "research"}   # the client's own material, never the agency's
    man = rd("manifest.yaml") or {}
    data = rd("shared/data.yaml") or {}
    return parse_research(rd("shared/facts.yaml"), rd("shared/findings.yaml"), rd("shared/sources.yaml"),
                          rd("agent/decision-chain.yaml"), docs, man.get("document_id") or man.get("id"),
                          (data.get("campaign") or {}).get("name") or man.get("title") or clan.stem)


def _doc_key(name: str) -> str:
    """A short stable key for a client document: 'rft', 'trd', 'qa', 'tracker' or a slug."""
    low = name.lower()
    for k, pat in (("rft", " rft"), ("trd", " trd"), ("qa", "questions and answers"), ("tracker", "nfppublic")):
        if pat in low:
            return k
    return "".join(c if c.isalnum() else "_" for c in low)[:24]


#: Brief Maker (.clan) field -> the deck's brief field id
CLAN_FIELDS = {"background": "background", "objectives": "objectives", "audience": "audience",
               "competitor_context": "competitor_context", "insight": "insight", "smp": "single_minded_proposition",
               "reasons_to_believe": "reasons_to_believe", "desired_response": "desired_response",
               "tone_world_assets": "tone_and_world", "budget_scope": "budget_and_scope", "mandatories": "mandatories"}


def is_clan(path: Path) -> bool:
    """True for a .clan or .clan.zip file (a zip with a manifest)."""
    try:
        return zipfile.is_zipfile(path) and "manifest.yaml" in zipfile.ZipFile(path).namelist()
    except OSError:
        return False


def empty_brief() -> dict:
    """Every brief field, empty: what the deck sees when no brief was given."""
    return {fid: {"value": None, "kind": "missing", "mark": "", "fact_refs": [], "reason": None,
                  "rejected_attempt": None, "review": None, "rival": None} for fid in BRIEF_FIELDS}


def _at_path(data, path: str):
    """The value at a data path such as ``objectives.commercial`` or ``mandatories[0]`` (None when absent)."""
    cur = data
    for part in re.findall(r"[^.\[\]]+", str(path)):
        if isinstance(cur, dict):
            cur = cur.get(part)
        elif isinstance(cur, list) and part.isdigit() and int(part) < len(cur):
            cur = cur[int(part)]
        else:
            return None
    return cur


def _flat(v) -> str:
    if isinstance(v, str):
        return v
    if isinstance(v, dict):
        return " ".join(_flat(x) for x in v.values())
    if isinstance(v, (list, tuple)):
        return " ".join(_flat(x) for x in v)
    return "" if v is None else str(v)


class MarksError(ValueError):
    """A mark names a part that is not there or is empty: refused, never skipped (a skipped mark would let its text reach a prompt)."""


def _field_value(v):
    """A Research Tool field carries its provenance beside its value (``{value, origin, source, ...}``): the marked text is the value."""
    return v["value"] if isinstance(v, dict) and "value" in v and "origin" in v else v


def marks_from_data(data: dict, chain: list | None = None, doc_id: str | None = None, docs: dict | None = None) -> list:
    """The parts a person marked Confidential, with their text: brief parts in ``confidential_fields``, parts a ``classify`` decision marked
    ``model: false`` or ``corpus: false`` (the chain; the target is ``<document>#<path>``), and materials whose licence is
    ``client-confidential``. ``[{path, text, kind}]``; an empty list means the checks ran and found none.

    A carried chain holds marks on several documents, so a ``classify`` target is looked up only in the document it names: ``data`` when
    it names ``doc_id``, ``docs[<document>]`` (the other documents by id, e.g. a Deck's upstream research) when it names one of those,
    recorded as ``<document>#<path>``. With ``doc_id`` given, a target naming a document that is neither is refused (MarksError), like a
    mark whose part is missing or empty: never skipped. With neither ``doc_id`` nor the named document known (a lone brief .clan, whose
    own id the loader does not know), the target is looked up in ``data``, as before."""
    data = data or {}
    docs = docs or {}
    out, seen = [], set()

    def add(path, text, kind):
        text = _flat(text).strip()
        if not text:
            raise MarksError(f"the part marked Confidential at {path!r} ({kind}) resolves to nothing or is empty: fix the path or clear the mark; nothing was skipped")
        if (path, kind) not in seen:
            seen.add((path, kind))
            out.append({"path": path, "text": text, "kind": kind})
    for path in data.get("confidential_fields") or []:
        add(str(path), _at_path(data, path), "confidential_field")
    for d in chain or []:
        if not isinstance(d, dict) or d.get("kind") != "classify" or d.get("superseded_by"):
            continue
        lic = d.get("licence") if isinstance(d.get("licence"), dict) else {}
        if lic.get("model", False) and lic.get("corpus", False):
            continue
        for tg in d.get("targets") or []:
            if isinstance(tg, str) and "#" in tg:
                doc, path = tg.split("#", 1)
                if doc_id is not None and doc == doc_id:
                    add(path, _at_path(data, path), "classify")
                elif doc in docs:
                    add(f"{doc}#{path}", _field_value(_at_path(docs[doc], path)), "classify")
                elif doc_id is not None:
                    raise MarksError(f"the part marked Confidential at {tg!r} (classify) names a document this deck does not hold: "
                                     "it cannot be checked; nothing was skipped")
                else:
                    add(path, _at_path(data, path), "classify")
    mats = data.get("materials")
    for mid, m in (mats.items() if isinstance(mats, dict) else [(x.get("id"), x) for x in mats or [] if isinstance(x, dict)]):
        if isinstance(m, dict) and str(m.get("licence") or "").lower() == "client-confidential":
            add(f"materials[{mid}]", f"{m.get('name') or ''} {m.get('text') or ''}", "licence")
    return out


def brief_from_data(data: dict, chain: list | None = None, doc_id: str | None = None,
                    docs: dict | None = None) -> tuple[dict, dict, list, dict]:
    """The one field mapping for a Brief Maker's data (``shared/data.yaml``, or ``data.upstream.<id>``
    in a Deck document): (fields, how_to_win, open_questions, coverage) via CLAN_FIELDS."""
    data = data or {}
    fields = {fid: {"value": data.get(key), "kind": "brief-maker" if data.get(key) else "missing", "mark": "",
                    "fact_refs": [], "reason": None, "rejected_attempt": None, "review": None, "rival": None}
              for fid, key in CLAN_FIELDS.items()}
    htw = {}
    for h in (data.get("capture") or {}).get("how_to_win") or []:
        htw.setdefault(h.get("kind") or "points", []).append({"point": h.get("point"), "evidence": h.get("evidence", "")})
    oq = [{"question": q if isinstance(q, str) else q.get("question"), "why": "", "priority": "normal"} for q in data.get("open_questions") or []]
    cov = {"brief_fields": len(fields), "brief_fields_filled": sum(1 for f in fields.values() if f["value"]),
           "how_to_win_points": sum(len(v) for v in htw.values()), "open_questions": len(oq), "brief_source": "brief-maker clan",
           "marks": marks_from_data(data, chain, doc_id, docs)}   # popped into Inputs.marks by the loaders: marked texts never stay in the coverage that reaches a report
    return fields, htw, oq, cov


def load_brief_clan(clan: Path) -> tuple[dict, dict, list, dict]:
    """Read a Brief Maker .clan (the brief tool's output) into (fields, how_to_win, open_questions,
    coverage), the same shape load_brief returns for a brief_object.json."""
    z = zipfile.ZipFile(clan)
    chain = yaml.safe_load(z.read("agent/decision-chain.yaml")) if "agent/decision-chain.yaml" in z.namelist() else []
    chain = chain.get("decisions") if isinstance(chain, dict) else chain
    return brief_from_data(yaml.safe_load(z.read("shared/data.yaml")) or {}, chain or [])


def _pdf_pages(path: Path) -> tuple[str, int] | None:
    """A PDF page by page with pdftotext, each page opened with its [pN] locator, or None when
    pdftotext is not installed. Returns (text, page count)."""
    import subprocess
    try:
        info = subprocess.run(["pdfinfo", str(path)], capture_output=True, text=True).stdout
        pages = int(next((l.split()[-1] for l in info.splitlines() if l.startswith("Pages:")), "0"))
        text = "\n".join(f"[p{n}]\n" + subprocess.run(["pdftotext", "-layout", "-f", str(n), "-l", str(n), str(path), "-"], capture_output=True, text=True).stdout
                         for n in range(1, pages + 1))
    except FileNotFoundError:
        return None
    return text, pages


def load_doc(path: Path) -> dict:
    """A document the person attached, as text: .docx, .txt, .md, .eml and images through
    ``brief_ingest.ingest``; a PDF page by page, each page opened with its [pN] locator (cite it as
    doc:<key>#pN). A PDF with no usable text layer (a scan) is transcribed by ingest and carried
    whole under [p1], with ``transcribed`` saying so. Never drops a page: ``pages`` counts them.
    A suffix ingest does not know is read as text, as it always was."""
    path = Path(path).expanduser()
    suffix = path.suffix.lower()
    out = {"name": path.name}
    if suffix == ".pdf":
        got = _pdf_pages(path)
        text, pages = got if got else ("", 0)
        if not text.replace("\n", " ").strip() or len(re.sub(r"\[p\d+\]|\s", "", text)) < max(200, 40 * max(1, pages)):
            from brief_ingest import _INGEST_NOTES, ingest   # noqa: PLC0415 (engine module, imported only when needed)
            try:
                alt, _ = ingest(path)
            except (SystemExit, Exception):  # noqa: BLE001  (ingest exits when pdfplumber is missing: keep the text layer we have)
                alt = ""
            if len(alt.strip()) > len(re.sub(r"\[p\d+\]", "", text).strip()):
                text, pages = "[p1]\n" + alt, pages or 1
                if _INGEST_NOTES.get("transcribed"):
                    out["transcribed"] = _INGEST_NOTES["transcribed"]
        out["pages"] = pages
    elif suffix in INGEST_SUFFIXES:
        from brief_ingest import _INGEST_NOTES, ingest   # noqa: PLC0415
        text, _ = ingest(path)
        if _INGEST_NOTES.get("transcribed"):
            out["transcribed"] = _INGEST_NOTES["transcribed"]
    else:
        text = path.read_text(encoding="utf-8", errors="replace")
    out.update(text=text, chars=len(text))
    return out


#: Suffixes brief_ingest.ingest reads (a PDF is read page by page above).
INGEST_SUFFIXES = (".txt", ".md", ".text", ".eml", ".docx", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp")


def _research_coverage(inp: Inputs, chain_len: int) -> dict:
    """Coverage rows for the research parts of an Inputs."""
    return dict(facts=len(inp.facts), findings=len(inp.findings),
                findings_by_status={s: sum(1 for f in inp.findings.values() if f.get("status") == s)
                                    for s in ("verified", "proposed", "rejected")},
                sources=len(inp.sources), docs={k: d["chars"] for k, d in inp.docs.items()},
                decisions=chain_len)


def load(brief: Path | None, research: Path | None = None, doc_facts: Path | None = None, docs: list | None = None,
         prompt_text: str = "", answers: dict | None = None, intake: dict | None = None, verified: dict | None = None) -> Inputs:
    """Build the Inputs for one run and record coverage of each part. ``brief`` is the brief tool's
    output (or None: the deck builds from the prompt, documents or research): a brief_object.json,
    or a Brief Maker .clan, which also carries its research pins (used as the research when no
    --research is given). ``docs``: (key, path) documents the person attached. ``prompt_text``,
    ``answers`` and ``intake`` are the person's prompt, their answers and the a0 questions; ``verified`` is their
    verify decisions on the confirm list ({ref: {by, at}})."""
    if brief is None:
        fields, htw, oq, cov = empty_brief(), {}, [], {"brief_fields": len(BRIEF_FIELDS), "brief_fields_filled": 0,
                                                       "how_to_win_points": 0, "open_questions": 0, "brief_source": "none"}
        clan = False
    else:
        clan = is_clan(Path(brief))
        fields, htw, oq, cov = load_brief_clan(brief) if clan else load_brief(brief)
    marks = cov.pop("marks", None)
    src = cov.pop("source_sentences", None) or {}
    issues = cov.pop("brief_issues", None) or []
    inp = Inputs(brief=fields, how_to_win=htw, open_questions=oq, prompt_text=prompt_text or "",
                 answers=answers or {}, intake=intake or {}, verified=verified or {}, marks=marks, brief_source=src, brief_issues=issues)
    research = research or (brief if clan else None)
    if research:
        r = load_research(research)
        inp.facts, inp.findings, inp.sources, inp.docs = r["facts"], r["findings"], r["sources"], r["docs"]
        inp.rejected_pins, inp.research_doc_id, inp.research_title = r["rejected_pins"], r["doc_id"], r["title"]
        cov.update(_research_coverage(inp, r["chain_len"]))
    for key, path in docs or []:
        if key in inp.docs:
            raise ValueError(f"document key {key!r} is used twice: each document needs its own key")
        inp.docs[key] = load_doc(path)
    if docs:
        cov["docs"] = {k: d["chars"] for k, d in inp.docs.items()}
    if doc_facts and Path(doc_facts).exists():
        inp.doc_facts = json.loads(Path(doc_facts).read_text()).get("figures", {})
        cov["doc_figures"] = len(inp.doc_facts)
    inp.coverage = cov
    return inp


def _is_brief_data(d: dict) -> bool:
    """True when an upstream entry is a Brief Maker's data (it holds brief fields or a capture)."""
    return isinstance(d, dict) and (any(k in d for k in CLAN_FIELDS.values()) or "capture" in d)


#: Presentation kits a Deck may hold (deck-look-kits). A kit tells the deck how to look: it is never the brief,
#: never the research, and none of its words or figures is evidence (ADR 0023 as amended by ADR 0027).
BRAND_APP, STYLE_PACK_APP = "ie.napkin.brand", "ie.napkin.style-pack"
KIT_APPS = (BRAND_APP, STYLE_PACK_APP)
#: The brand layer's reference on a pin (Contract 6, section 2): ``fact://brand/<slug>/<key>@v``.
_BRAND_REF = "fact://brand/"


def _is_kit(key: str, entry, apps: dict | None) -> bool:
    """True when an upstream entry is a kit. The runner's app map (``lineage.attached[].app_id``) decides when it
    names the entry; with no map (or an entry it does not name) the shape does: a kit holds ``kit.version``."""
    if apps and key in apps:
        return apps[key] in KIT_APPS
    return isinstance(entry, dict) and isinstance(entry.get("kit"), dict) and "version" in entry["kit"]


def _is_brand_pin(pin: dict, kit_ids: set = frozenset()) -> bool:
    """A pin the brand layer owns: its reference (compared without regard to case), its layer (any layer starting with ``brand``), or a
    source that is an attached kit's document."""
    refs = [pin.get(k) for k in ("ref", "uri", "id")]
    if any(isinstance(r, str) and r.strip().casefold().startswith(_BRAND_REF) for r in refs):
        return True
    if str(pin.get("layer") or "").strip().casefold().startswith("brand"):
        return True
    named = {pin.get("source"), pin.get("source_id"), *(pin.get("sources") or [])}
    return bool(named & set(kit_ids))


def _drop_kit_pins(members: dict, kit_pins: set, kit_ids: set = frozenset()) -> tuple[dict, list]:
    """``members`` without the pins that arrived with a kit, and without the sources only those pins cite.
    Returns (members, dropped pin ids). A Brand Clan attach merges its pins into the deck's facts; the deck's
    facts are research, so they leave here, before anything reads them."""
    rows = _unwrap(members.get("facts"), "facts")
    gone = [p for p in rows if isinstance(p, dict) and (p.get("id") in kit_pins or _is_brand_pin(p, kit_ids))]
    if not gone:
        return members, []
    gone_ids = {p.get("id") for p in gone}
    kept = [p for p in rows if p.get("id") not in gone_ids]

    def cited(pins):
        out = set()
        for p in pins:
            for k in ("source", "source_id"):
                if p.get(k):
                    out.add(p[k])
            out.update(p.get("sources") or [])
        return out

    only_brand = cited(gone) - cited(kept)
    out = {**members, "facts": kept}
    if members.get("sources") is not None:
        out["sources"] = [s for s in _unwrap(members.get("sources"), "sources") if s.get("id") not in only_brand]
    return out, sorted(i for i in gone_ids if i)


def from_upstream(data: dict, members: dict | None = None, docs: dict | None = None, doc_facts: dict | None = None,
                  apps: dict | None = None, kit_pins: set | list | None = None, self_id: str | None = None) -> Inputs:
    """Build the Inputs from a Deck document: ``data`` is its data (``upstream.<source document id>``
    frozen sources, ``inputs.prompt``, ``intake``); ``members`` its merged ``facts``, ``findings``,
    ``sources`` and ``decisions`` (the whole carried decision chain), each a list or wrapped in its
    top-level key. ``docs`` (doc key -> {name, text, chars}) and ``doc_facts`` are what the server
    extracted from the attached documents. The brief goes through ``brief_from_data`` (CLAN_FIELDS)
    and the research through ``parse_research``, so there is one mapping. A finding rejected in
    the chain stays rejected. With no brief upstream the brief fields are empty.

    ``apps`` (``{source document id: app_id}``, from ``lineage.attached``) says what each entry is. A Brand Clan
    or Style Pack is a kit: never the brief or the research, and every pin that arrived with a kit is dropped from
    the facts (``kit_pins``: the ids the runner knows came with one; a pin marked with the brand layer's reference
    is dropped too). Without ``apps`` a kit is recognised by its ``kit.version`` block.

    ``self_id`` is the Deck document's own id (its manifest's): a ``classify`` mark in the carried chain that names the Deck itself is
    read in the Deck's own data, beside marks on the brief and the research, never refused for naming a document it does not hold."""
    data, members = data or {}, members or {}
    up = data.get("upstream") or {}
    kits = [k for k, v in up.items() if _is_kit(k, v, apps)]
    up = {k: v for k, v in up.items() if k not in kits}
    brief_id, brief_data = next(((k, v) for k, v in up.items() if _is_brief_data(v)), (None, None))
    research_id = next((k for k, v in up.items() if k != brief_id and isinstance(v, dict) and v), None)
    dropped: list = []
    kit_ids = set(kits) | {k for k, app in (apps or {}).items() if app in KIT_APPS}
    if kits or kit_ids:
        members, dropped = _drop_kit_pins(members, set(kit_pins or ()), kit_ids)
    elif kit_pins:
        members, dropped = _drop_kit_pins(members, set(kit_pins))
    chain_list = members.get("decisions") if "decisions" in members else members.get("chain")
    chain_list = chain_list.get("decisions") if isinstance(chain_list, dict) else chain_list
    if brief_data is not None:
        # The chain's marks are looked up in the documents they name (the brief, or the research beside it), never all in the brief.
        others = {k: v for k, v in up.items() if k != brief_id}
        if self_id and self_id != brief_id:
            others[self_id] = data   # a mark on the Deck document itself is read in the Deck's own data
        fields, htw, oq, cov = brief_from_data(brief_data, chain_list or [], brief_id, others)
    else:
        fields, htw, oq, cov = empty_brief(), {}, [], {"brief_fields": len(BRIEF_FIELDS), "brief_fields_filled": 0,
                                                       "how_to_win_points": 0, "open_questions": 0, "brief_source": "none"}
    if kits:
        cov["kits_ignored"] = sorted(kits)
    if dropped:
        cov["kit_pins_dropped"] = dropped
    prompt = ((data.get("inputs") or {}).get("prompt") or {})
    intake = data.get("intake") or {}
    marks = cov.pop("marks", None)
    if "confidential_fields" in data:   # a Deck that carries its own marks, beside any the brief carried
        # The chain's marks were read with the brief's when there is one (each in its own document); otherwise here, upstream ones there.
        marks = (marks or []) + (marks_from_data(data) if brief_data is not None else marks_from_data(data, chain_list or [], docs=up))
    inp = Inputs(brief=fields, how_to_win=htw, open_questions=oq, prompt_text=str(prompt.get("text") or ""),
                 answers=dict(intake.get("answers") or {}), intake={k: v for k, v in intake.items() if k != "answers"}, marks=marks)
    chain = members.get("decisions") if "decisions" in members else members.get("chain")
    if members.get("facts") or members.get("findings") or research_id:
        title = ((up.get(research_id) or {}).get("campaign") or {}).get("name") if research_id else None
        r = parse_research(members.get("facts"), members.get("findings"), members.get("sources"), chain,
                           doc_id=research_id, title=title, chain_rejects_findings=True)
        inp.facts, inp.findings, inp.sources = r["facts"], r["findings"], r["sources"]
        inp.rejected_pins, inp.research_doc_id, inp.research_title = r["rejected_pins"], r["doc_id"], r["title"]
        inp.docs = dict(docs or {})
        cov.update(_research_coverage(inp, r["chain_len"]))
    elif docs:
        inp.docs = dict(docs)
        cov["docs"] = {k: d["chars"] for k, d in inp.docs.items()}
    pages = {k: d["pages"] for k, d in inp.docs.items() if d.get("pages")}
    if pages:
        cov["doc_pages"] = pages
    if doc_facts:
        inp.doc_facts = dict(doc_facts)
        cov["doc_figures"] = len(inp.doc_facts)
    inp.coverage = cov
    return inp


def from_deck_document(path: Path) -> tuple[Inputs, dict]:
    """The runner's one way into a Deck document (a ``.clan``): its Inputs through ``from_upstream`` with the app map read from
    ``lineage.attached`` (so an attached kit is never the brief or research and a Brand Clan's pins never reach the facts), and what
    the look needs: ``{apps, look (the document's look preferences), library (inputs.library.enabled), pack (Style Pack data and an
    asset reader, or None), brand (the frozen Brand Clan, or None)}``. Kits count only while ``inputs.library.enabled`` is true
    (ADR 0027); the facts filter acts always. Read on every run, so an Update (a newer frozen kit) is re-applied by construction."""
    z = zipfile.ZipFile(path)
    names = set(z.namelist())
    rd = lambda n: yaml.safe_load(z.read(n)) if n in names else None  # noqa: E731
    man, data = rd("manifest.yaml") or {}, rd("shared/data.yaml") or {}
    attached = (man.get("lineage") or {}).get("attached") or []
    apps = {(a.get("carried") or {}).get("document_id"): a.get("app_id") for a in attached if (a.get("carried") or {}).get("document_id")}
    members = {"facts": rd("shared/facts.yaml"), "findings": rd("shared/findings.yaml"), "sources": rd("shared/sources.yaml"),
               "decisions": rd("agent/decision-chain.yaml")}
    inp = from_upstream(data, {k: v for k, v in members.items() if v is not None}, apps=apps,
                        self_id=str(man.get("document_id") or man.get("id") or "") or None)
    up = data.get("upstream") or {}
    lib = bool(((data.get("inputs") or {}).get("library") or {}).get("enabled") is True)
    pack = brand = None
    for did, app in apps.items():
        if did in up and lib:
            if app == STYLE_PACK_APP and pack is None:
                pack = (up[did], lambda p: z.read(p) if p in names else None)
            elif app == BRAND_APP and brand is None:
                brand = up[did]
    if lib is False and any(app in KIT_APPS for app in apps.values()):
        inp.coverage["kits_gated_off"] = True
    return inp, {"apps": apps, "look": data.get("look") or {}, "library": lib, "pack": pack, "brand": brand,
                 "text_mode": (data.get("inputs") or {}).get("text_mode"), "review": data.get("review") or {},
                 "deck_type": _deck_type_pick((data.get("inputs") or {}).get("deck_type"))}


def _deck_type_pick(v) -> str | None:
    """deck-types: the person's explicit pick on the type picker (``inputs.deck_type: {id, by, at}``; null or absent: no pick, 'Not sure')."""
    pid = v.get("id") if isinstance(v, dict) else None
    return pid if isinstance(pid, str) and pid else None
