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

    def has_brief(self) -> bool:
        """True when a brief supplied at least one field (a field an intake stage filled does not count)."""
        return any(f.get("value") and not f.get("from_intake") for f in self.brief.values())

    def has_research(self) -> bool:
        """True when a research CLAN was given."""
        return bool(self.facts or self.findings)


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
    return fields, htw, oq, cov


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


def brief_from_data(data: dict) -> tuple[dict, dict, list, dict]:
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
           "how_to_win_points": sum(len(v) for v in htw.values()), "open_questions": len(oq), "brief_source": "brief-maker clan"}
    return fields, htw, oq, cov


def load_brief_clan(clan: Path) -> tuple[dict, dict, list, dict]:
    """Read a Brief Maker .clan (the brief tool's output) into (fields, how_to_win, open_questions,
    coverage), the same shape load_brief returns for a brief_object.json."""
    z = zipfile.ZipFile(clan)
    return brief_from_data(yaml.safe_load(z.read("shared/data.yaml")) or {})


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
    inp = Inputs(brief=fields, how_to_win=htw, open_questions=oq, prompt_text=prompt_text or "",
                 answers=answers or {}, intake=intake or {}, verified=verified or {})
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


def from_upstream(data: dict, members: dict | None = None, docs: dict | None = None, doc_facts: dict | None = None) -> Inputs:
    """Build the Inputs from a Deck document: ``data`` is its data (``upstream.<source document id>``
    frozen sources, ``inputs.prompt``, ``intake``); ``members`` its merged ``facts``, ``findings``,
    ``sources`` and ``decisions`` (the whole carried decision chain), each a list or wrapped in its
    top-level key. ``docs`` (doc key -> {name, text, chars}) and ``doc_facts`` are what the server
    extracted from the attached documents. The brief goes through ``brief_from_data`` (CLAN_FIELDS)
    and the research through ``parse_research``, so there is one mapping. A finding rejected in
    the chain stays rejected. With no brief upstream the brief fields are empty."""
    data, members = data or {}, members or {}
    up = data.get("upstream") or {}
    brief_id, brief_data = next(((k, v) for k, v in up.items() if _is_brief_data(v)), (None, None))
    research_id = next((k for k, v in up.items() if k != brief_id and isinstance(v, dict) and v), None)
    if brief_data is not None:
        fields, htw, oq, cov = brief_from_data(brief_data)
    else:
        fields, htw, oq, cov = empty_brief(), {}, [], {"brief_fields": len(BRIEF_FIELDS), "brief_fields_filled": 0,
                                                       "how_to_win_points": 0, "open_questions": 0, "brief_source": "none"}
    prompt = ((data.get("inputs") or {}).get("prompt") or {})
    intake = data.get("intake") or {}
    inp = Inputs(brief=fields, how_to_win=htw, open_questions=oq, prompt_text=str(prompt.get("text") or ""),
                 answers=dict(intake.get("answers") or {}), intake={k: v for k, v in intake.items() if k != "answers"})
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
