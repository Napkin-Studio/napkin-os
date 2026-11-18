"""The repair loop (deck-repair-loop, slice 5): findings become fixes, round by round, never worse.

Round 0 is the build as it is. The adapters (issues.py) turn its findings into issues; each round then picks one action per unpinned
slide from the action map (``ACTION_MAP``: one row per check, rungs tried left to right across rounds), hands the fixes to
``layouts.plan`` (which owns shrink, switch, notes and the variety rule: the loop never binds a slot or picks a layout itself),
renders, runs QA and the checklist, and keeps the round only when it is not worse:

* K1 counts and new findings: blockers and majors not up, and no (check, slide) pair at blocker or major the last kept round did not have;
* K2 the checklist: ``bench.compare.compare(last_kept, round, tier=REPAIR_TIERS)`` with no regression, no metric regression, no lost coverage;
* K3 the token ledger (ledger.py) read back from the round's .pptx, equal to the BASE deck's, block by block, moved points included;
* K4 no hiding: the content-finding set equal to the last kept round's, both ways;
* K5 progress: at least one issue the round targeted is fixed.

A round that fails is rolled back whole. At most two rounds. The only paid rung is ``shorten``: one batched stage e call per round,
behind ``--text-mode condense`` and ``--live`` (or a recording), under the cost caps; its reply may only delete or reuse the slide's own words
(``assemble.shorten_problem``) and is guarded word by word. Everything else is code over data: a pure function of (base deck, findings, policy,
ladder state, recorded replies), so a recorded run replays byte for byte from ``repair_record.json`` without measuring anything again.
No model, no network, no clock in any decision (the time cap reads an injected clock in live runs only, and the stop is recorded).
"""
from __future__ import annotations

import copy
import hashlib
import shutil
import json
import re
import time
from pathlib import Path

import yaml

from . import issues as I
from . import ledger, layouts, spec, validate

DECK = Path(__file__).parent
POLICY_PATH = DECK / "policy" / "repair.yaml"
POLICY_SCHEMA = DECK / "schemas" / "repair_policy.schema.json"
#: Bumped when a shorten guard changes: a record made under another version is never replayed.
GUARD_VERSION = 3
SEV_RANK = {"blocker": 0, "major": 1, "minor": 2}
#: Rungs that are not a fix kind of spec.ISSUE_FIXES: a pseudo-rung of the map.
EXTRA_RUNGS = ("undo_shrink", "left_for_person", "replan", "engine_fault", "critic", "none")
TERMINAL = ("needs_human", "left_for_person", "engine_fault", "none")

# ---------------------------------------------------------------------------------------------------- the action map (data)
_SLOT = ("shrink", "switch_layout", "shorten", "overflow_to_notes", "needs_human")
_GEOM = ("switch_layout", "needs_human")
_CONTENT = ("left_for_person",)
#: One row per check of spec.ISSUE_CHECKS (a test fails when one has no row). ``rungs`` are tried left to right; ``flow`` replaces them for
#: an issue that names no slot (flow or furniture: nothing to shrink or shorten).
ACTION_MAP: dict = {
    "text_overflow": {"rungs": _SLOT, "flow": _GEOM},
    "slot_limit": {"rungs": ("switch_layout", "shorten", "overflow_to_notes", "needs_human"), "flow": _GEOM},
    "word_budget": {"rungs": ("shorten", "overflow_to_notes", "needs_human"), "flow": ("needs_human",)},
    "text_overlap": {"rungs": ("shrink", "switch_layout", "needs_human"), "flow": _GEOM},
    "off_slide": {"rungs": _GEOM},
    "margin": {"rungs": _GEOM},
    "min_font": {"rungs": ("undo_shrink", "switch_layout", "shorten", "overflow_to_notes", "needs_human"), "flow": _GEOM},
    "contrast": {"rungs": ("needs_human",)},
    "text_on_image_contrast": {"rungs": ("add_scrim", "switch_layout", "drop_image", "needs_human")},
    "picture_stretch": {"rungs": ("crop_image", "switch_layout", "needs_human")},
    "picture_lowres": {"rungs": ("switch_layout", "left_for_person")},
    "text_on_image_fallback": {"rungs": ("left_for_person",)},   # deck-look: the words already sit beside the picture; a person may swap it
    "image_flagged": {"rungs": ("left_for_person",), "regen_then_drop": ("regen_image", "drop_image")},
    "image_unapproved": {"rungs": ("left_for_person",)},
    "image_rights": {"rungs": ("drop_image", "left_for_person")},
    "image_missing": {"rungs": ("drop_image", "needs_human")},
    "slot_missing": {"rungs": _GEOM},
    "block_unbound": {"rungs": _GEOM},
    "slot_stale": {"rungs": ("replan", "engine_fault")},
    "slot_unknown": {"rungs": ("replan", "engine_fault")},
    "layout_unknown": {"rungs": ("replan", "engine_fault")},
    "layout_repeat": {"rungs": ("switch_layout",)},
    "line_length": {"rungs": ("switch_layout",)},
    "mostly_empty": {"rungs": ("switch_layout", "left_for_person")},
    "one_corner": {"rungs": ("switch_layout", "left_for_person")},
    "title_drift": {"rungs": ("engine_fault",)},
    "image_style_mixed": {"rungs": _CONTENT},
    "golden_echo": {"rungs": _CONTENT},
    "export_failed": {"rungs": ("none",)},
    "qa_internal": {"rungs": ("none",)},
    "unreadable": {"rungs": ("none",)},
}
for _c in spec.ISSUE_CHECKS:   # content and evidence checks: a fact, a source, a decision or a change of meaning is needed, so a person
    if _c in spec.CRITIC_CHECKS:
        ACTION_MAP[_c] = {"rungs": ("critic",)}   # slice 8's adapter slot: see ``critic_fix_allowed``
    elif _c not in ACTION_MAP:
        ACTION_MAP[_c] = {"rungs": _CONTENT}
#: The sentences a person reads, never a model's (the report's fixed table).
SENTENCES = {
    "text_overflow": "the text ran past its box", "slot_limit": "the text did not fit its slot", "word_budget": "the slide held more words than its budget",
    "text_overlap": "two pieces of text overlapped", "off_slide": "something ran off the slide", "margin": "text sat too close to the edge",
    "min_font": "the type was under the readable floor", "contrast": "the text was hard to read against its background",
    "text_on_image_contrast": "the text was hard to read over the picture", "picture_stretch": "a picture was stretched",
    "picture_lowres": "a picture is low resolution", "text_on_image_fallback": "no part of the picture was calm enough to carry the words, so they sit beside it", "image_flagged": "a picture was flagged", "image_unapproved": "a picture is not approved",
    "image_rights": "a picture has no clear rights", "image_missing": "a picture is missing",
}
#: Content findings K4 watches: every validator finding except these (the word budget and the slot checks move with a layout).
K4_SKIP = ("word_budget",)
#: Checklist items the loop's gate treats differently from checklist.json: the run's cost and time, and the words hash (K3 covers the words),
#: always differ between rounds; a layout swap is the obvious way to break the layout items, so they gate here.
REPAIR_TIERS_OVERRIDE = {"m_usd": "advisory", "m_seconds": "advisory", "w_words_sha": "advisory", "l_repeat_max2": "gate", "l_variety": "gate"}


def repair_tiers() -> dict:
    """``REPAIR_TIERS``: checklist.json's tier map with the loop's overrides (the compare module is unchanged)."""
    from .bench import compare
    return {**compare.tiers(), **REPAIR_TIERS_OVERRIDE}


# ---------------------------------------------------------------------------------------------------- the policy
def load_policy(profile: dict | None = None, override: Path | str | None = None) -> dict:
    """The loop's policy: ``policy/repair.yaml``, a profile's optional ``repair:`` block over it, then a ``--repair-policy`` file over that;
    checked against ``schemas/repair_policy.schema.json`` (a bad policy fails loudly, never silently)."""
    import jsonschema
    pol = yaml.safe_load(POLICY_PATH.read_text())
    for layer in ((profile or {}).get("repair"), yaml.safe_load(Path(override).expanduser().read_text()) if override else None):
        for k, v in (layer or {}).items():
            pol[k] = {**pol[k], **v} if isinstance(v, dict) and isinstance(pol.get(k), dict) else v
    jsonschema.validate(pol, json.loads(POLICY_SCHEMA.read_text()))
    return pol


def approval_id(base_deck: dict) -> str:
    """The id of a person's yes to shortening a client deck: ``apv_`` and the hash of every word the shorten rung may touch (each eligible field of each
    slide of the BASE deck, with its slide and field id). The person approves THESE words, so any change to them voids the approval."""
    rows = sorted((sid, fid, text) for sid in base_deck["order"] for bi in range(len(base_deck["slides"][sid]["blocks"]))
                  for fid, text, _ in eligible_fields(base_deck["slides"][sid], bi))
    return "apv_" + sha(rows)


def run_cap() -> float:
    """The engine's own cap on a run's spend, ``NAPKIN_DECK_MAX_USD`` (default 2.00): a CLI run is capped too, not only a server run."""
    import os
    return float(os.environ.get("NAPKIN_DECK_MAX_USD", "2.0"))


def sha(obj) -> str:
    """The SHA-256 (12 hex) of an object as sorted, non-ASCII-escaped JSON."""
    return hashlib.sha256(json.dumps(obj, sort_keys=True, ensure_ascii=False, default=str).encode()).hexdigest()[:12]


def critic_fix_allowed(question: str, measures: dict, policy: dict | None = None) -> bool:
    """May a critic finding for ``question`` start its fix? Only inside its code-confirm band: the question has a fix and a ``confirm_with``
    check in the rubric, the fix is one the policy lets the critic make, and (with ``needs_code_confirm``) the code predictor agrees
    (bench.visual.code_predict on the stored measures). The critic never shortens or moves text (``select`` enforces that by source)."""
    from .bench import visual
    rubric = json.loads((DECK / "visual_rubric.json").read_text())
    q = next((x for k in ("per_slide", "per_deck") for x in rubric.get(k, []) if x["id"] == question), None)
    pol = (policy or load_policy()).get("critic") or {}
    if not q or q.get("fix", "none") == "none" or not q.get("confirm_with") or q["fix"] not in (pol.get("may_fix") or []):
        return False
    return visual.code_predict(question, measures) == "fail" if pol.get("needs_code_confirm", True) else True


# ---------------------------------------------------------------------------------------------------- eligibility and requests
def _presented(deck: dict) -> list:
    return validate.presented(deck)


def eligible_fields(s: dict, bi: int, moved_items: frozenset = frozenset()) -> list:
    """``[(field id, text, is_label)]`` of block ``bi`` of a (base) slide that the shorten rung may touch. Only ``text``, ``small``,
    ``callout`` and ``card`` text and ``bullets`` or ``kv`` items, with no refs and no sourced basis, never a human (placeholder) or internal
    item. Never a quote, statement, fromto, table, stats, steps, copy or chart block, a title or a heading. On a slide type of
    ``stages.JUDGED`` a block or item with refs is an evidence carrier and stays on screen (it never reaches a request). These rules are
    code here, not words in the prompt."""
    b = s["blocks"][bi]
    if b["kind"] not in ("text", "small", "callout", "card", "bullets", "kv") or b.get("human") or b.get("internal") or b.get("basis") == "sourced":
        return []
    if b.get("refs"):
        return []
    out = []
    if b["kind"] in ("bullets", "kv"):
        for ii, it in enumerate(b.get("items") or []):
            if ii in moved_items:
                continue
            if isinstance(it, dict):
                if it.get("human") or it.get("refs") or it.get("basis") == "sourced" or not str(it.get("text", "")).strip():
                    continue
                out.append((f"{bi}.{ii}", str(it["text"]), False))
            elif isinstance(it, list) and len(it) == 2 and b["kind"] == "kv":
                out.append((f"{bi}.{ii}", str(it[1]), False))
            elif isinstance(it, str) and it.strip():
                out.append((f"{bi}.{ii}", it, False))
    elif str(b.get("text", "")).strip():
        out.append((f"{bi}", str(b["text"]), False))
    return out


def assemble_deleted(old, new):
    from . import assemble
    return assemble.deleted_words(old, new)


def assemble_mark(old, new):
    from . import assemble
    return assemble.mark_deleted(old, new)


def apply_edits(deck: dict, edits: dict) -> dict:
    """A copy of a base deck with ``edits`` ({(slide id, field id): text}) bound into the blocks (a field id is ``<block>`` or
    ``<block>.<item>``). The only place the loop edits words, and only after ``assemble.shorten_problem`` accepted each one."""
    d = copy.deepcopy(deck)
    for (sid, fid), text in edits.items():
        bi, _, ii = fid.partition(".")
        b = d["slides"][sid]["blocks"][int(bi)]
        if not ii:
            b["text"] = text
            continue
        it = b["items"][int(ii)]
        if isinstance(it, dict):
            it["text"] = text
        elif isinstance(it, list):
            it[1] = text
        else:
            b["items"][int(ii)] = text
    return d


def _field_text(deck: dict, sid: str, fid: str) -> str:
    bi, _, ii = fid.partition(".")
    b = deck["slides"][sid]["blocks"][int(bi)]
    if not ii:
        return str(b.get("text", ""))
    it = b["items"][int(ii)]
    return str(it[1] if isinstance(it, list) else it.get("text", "") if isinstance(it, dict) else it)


def slide_text(s: dict) -> str:
    """The base text of a whole slide (title and every block): what the own-words guard compares with."""
    return "\n".join([s.get("title", "")] + [t for b in s["blocks"] for t in ledger.block_texts(b)])


def build_request(deck_kept: dict, work_base: dict, targets: list, library: dict, policy: dict, audience: str, deny: dict | None = None) -> list:
    """The shorten request, one entry per target slot (at most ``policy.shorten.max_slots_per_round``): ``{slide (title), slot, role, max_chars,
    max_words, fields: [{id, text}]}``. Fields are the slot's eligible fields only (``eligible_fields``), their text the CURRENT words. A slot
    with nothing eligible, or whose blocks draw on a part marked Confidential with model false, or whose words or title name a marked text
    (``deny`` is ``lint.deny_list(inp.marks)``), is not sent (the caller lists it).
    ``targets`` is ``[(slide id, slot, measured, limit)]``."""
    out, cap = [], (policy.get("shorten") or {}).get("max_slots_per_round", 12)
    for sid, slot, measured, limit in targets:
        if len(out) >= cap:
            break
        s, w = deck_kept["slides"][sid], work_base["slides"][sid]
        sl = (s.get("slots") or {}).get(slot)
        lay = library.get((s.get("layout") or {}).get("id") or "")
        if not sl or not lay or slot not in lay["slots"]:
            continue
        mapping = ledger.shown_to_base(s, audience)
        moved = spec.moved_map(s, audience)
        fields = []
        for shown in sl.get("blocks", []):
            bi = mapping[shown] if shown < len(mapping) else None
            if bi is None:
                continue
            mv = moved.get(bi, "no")
            if mv is None:
                continue
            fields += [{"id": f, "text": _field_text(work_base, sid, f)} for f, _, _ in eligible_fields(w, bi, frozenset(mv) if isinstance(mv, set) else frozenset())]
        if not fields or any(_confidential(w, int(f["id"].split(".")[0])) for f in fields):
            continue
        if deny and _marked(deny, [s.get("title", ""), *(f["text"] for f in fields)]):   # a marked phrase never goes into a paid request
            continue
        chars = sum(len(f["text"]) for f in fields)
        cap_chars = min(int(limit) if limit else chars, max(1, int(chars * 0.9)))
        cap_chars = max(cap_chars, int(chars * (1 - (policy.get("shorten") or {}).get("max_cut_ratio", 0.35))))
        words = sum(len(f["text"].split()) for f in fields)
        out.append({"slide": s["title"], "slot": slot, "role": lay["slots"][slot].get("role", "body"), "max_chars": cap_chars,
                    "max_words": max(1, int(words * cap_chars / max(chars, 1))), "fields": fields})
    return out


def _marked(deny: dict, texts) -> bool:
    """True when any of these texts carries a phrase the person marked Confidential (visuals.lint.confidential_hit against the deny list)."""
    from visuals import lint   # noqa: PLC0415
    return any(lint.confidential_hit(str(t), deny) for t in texts if t)


def _confidential(s: dict, bi: int) -> bool:
    """True when a block's refs point into a brief part marked Confidential with model false (the engine marks such a ref
    ``confidential``; nothing of it ever goes into a request)."""
    b = s["blocks"][bi]
    return bool(b.get("confidential") or (b.get("model") is False))


def estimate(request: list, system_chars: int = 3200, max_tokens: int = 16000) -> dict:
    """The cost card of a request: slots, estimated input tokens (a quarter of a character each), output priced at ``max_tokens`` (an upper bound),
    and the estimated USD at stage e's model (spec.estimate_usd)."""
    from . import stages
    tin = (len(json.dumps(request, ensure_ascii=False)) + system_chars) // 4
    return {"slots": len(request), "tokens_in": tin, "tokens_out": max_tokens, "usd_upper": spec.estimate_usd(stages.MODELS["e"], tin, max_tokens)}


# ---------------------------------------------------------------------------------------------------- measuring one round
def findings_of(deck: dict, inp, audience: str, plan_issues: list) -> list:
    """validation.json for a planned deck: the validator's findings, then the plan's six slot and layout names (as run_deck writes them)."""
    findings = validate.run(deck, inp, audience)
    for x in plan_issues:
        findings.append({k: v for k, v in (("check", x["check"]), ("level", x["level"]), ("slide", x["slide"]), ("slot", x.get("slot")),
                                           ("message", x["message"]), ("evidence", x.get("evidence"))) if v is not None})
    return findings


def deck_sha_of(path: Path) -> str:
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()[:16]


def stamp_qa(folder: Path, qa: dict) -> dict:
    """Put ``deck_sha`` (the hash of that folder's deck.json) at the top of qa.json, in one function for out/ and every round folder."""
    folder = Path(folder)
    qa = {**qa, "deck_sha": deck_sha_of(folder / "deck.json")}
    (folder / "qa.json").write_text(json.dumps(qa, indent=1, ensure_ascii=False))
    return qa


def counts(issues_: list, deck: dict) -> dict:
    """``{blocker, major, minor}`` over the presented slides and the deck key. A critic issue never counts; ``block_unbound`` and ``slot_stale``
    count as blockers whatever the policy says (the gate's rule)."""
    pres = set(_presented(deck)) | {I.DECK_KEY}
    out = {"blocker": 0, "major": 0, "minor": 0}
    for i in issues_:
        if i["source"] == "critic" or i["slide"] not in pres:
            continue
        out[_gate_severity(i)] += 1
    return out


def _gate_severity(i: dict) -> str:
    return "blocker" if i["check"] in ("block_unbound", "slot_stale") else i["severity"]


def pairs(issues_: list, deck: dict) -> set:
    """The (check, slide) pairs at blocker or major (K1's new-finding rule)."""
    pres = set(_presented(deck)) | {I.DECK_KEY}
    return {(i["check"], i["slide"]) for i in issues_ if i["source"] != "critic" and i["slide"] in pres and _gate_severity(i) in ("blocker", "major")}


def content_set(findings: list):
    """K4's multiset (a Counter): every validator finding except the word budget and the ``slot_*`` checks, as (check, slide, level), with how many."""
    from collections import Counter
    return Counter((f["check"], f.get("slide") or I.DECK_KEY, f.get("level")) for f in findings
            if isinstance(f, dict) and f.get("check") not in K4_SKIP and not str(f.get("check", "")).startswith("slot_")
            and f.get("check") not in I.IMAGE_GUARD_CHECKS and f.get("check") not in spec.QA_RENDER_CHECKS)


def read_ledger(base_deck: dict, deck: dict, folder: Path, audience: str, prs=None) -> list:
    """K3: the differences between the BASE deck's ledger and what the round's .pptx shows, ``[{slide, block, kind, expected, got}]`` (empty when the
    ledger is kept). Read from ``folder/deck.pptx`` (every ``slot:<name>`` shape through layouts.json, plus the ``Moved from the slide:`` notes
    lines against the verbatim base text of each moved point). A round with no readable .pptx has one ``unreadable`` difference."""
    folder = Path(folder)
    try:
        if prs is None:
            from pptx import Presentation
            prs = Presentation(str(folder / "deck.pptx"))
        rec = json.loads((folder / "layouts.json").read_text())
    except Exception as e:   # no deck.pptx or layouts.json: the ledger cannot be read, so the round cannot be proved
        return [{"slide": I.DECK_KEY, "block": None, "kind": "unreadable", "expected": None, "got": str(e)[:120]}]
    got = ledger.read_pptx(prs, deck, rec, audience)
    diffs = []
    for sid in deck["order"]:
        if sid not in got:
            diffs.append({"slide": sid, "block": None, "kind": "unreadable", "expected": "the slide", "got": "missing"})
            continue
        s0, s1 = base_deck["slides"][sid], deck["slides"][sid]
        if s0["title"] != s1["title"] and not s1.get("pinned"):
            pass   # a title is never a ledger field: titles are compared by the base-block check below
        moved = spec.moved_map(s1, audience)
        base = ledger.base_ledger(s0, audience, moved)
        known = ledger.slide_known(s0)
        # the words of untouched blocks: the round's blocks equal the base's except the guarded edits (title and every other field)
        for bi, (b0, b1) in enumerate(zip(s0["blocks"], s1["blocks"])):
            if ledger.tokens("\n".join(ledger.block_texts(b0)), known) != ledger.tokens("\n".join(ledger.block_texts(b1)), known):
                diffs.append({"slide": sid, "block": bi, "kind": "deck", "expected": ledger.block_texts(b0)[:2], "got": ledger.block_texts(b1)[:2]})
        for grp in got[sid]["groups"]:
            if not ledger.compare_group(s0, base, grp["blocks"], grp["tokens"], known, moved):
                diffs.append({"slide": sid, "block": grp["blocks"], "kind": "shown", "expected": ledger.expected(s0, base, grp["blocks"])[:6], "got": grp["tokens"][:6]})
        want = []
        for bi, mv in sorted(moved.items(), key=lambda kv: kv[0]):
            b0 = s0["blocks"][bi]
            idxs = sorted(mv) if isinstance(mv, set) else [None]
            for m in (s1.get("layout") or {}).get("fit", {}).get("moved", []):
                if m["block"] == bi and (m["item"] is None or m["item"] in idxs):
                    want.append((m["block"], m["item"], layouts.moved_line(layouts.item_verbatim(b0, m["item"]), m.get("refs") or [])))
        want = [w[2][2:] for w in sorted(want, key=lambda w: (w[0], -1 if w[1] is None else w[1]))]   # the notes line without its "- "
        have = got[sid]["moved"]
        if sorted(have) != sorted(want):
            diffs.append({"slide": sid, "block": None, "kind": "moved", "expected": want[:3], "got": have[:3]})
    return diffs


def measure(deck: dict, plan_issues: list, folder: Path, ctx: dict, round_: int, stamp: dict | None = None) -> dict:
    """Run one round's checks into ``folder`` and return what the gate reads. ``deck`` is the planned deck. Writes deck.json, validation.json,
    layouts.json, deck.pptx (and deck.pdf when LibreOffice makes one), qa.json (with ``deck_sha``) and issues.json. Render and QA go through the
    injected seams ``ctx['render_fn'](deck, folder, findings) -> {pptx, pic_findings, placed}``, ``ctx['pdf_fn'](pptx, folder) -> Path | None``
    and ``ctx['qa_fn'](pptx, pdf, folder, findings) -> qa dict``, so tests drive real rounds without LibreOffice."""
    from .bench import checklist
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    if stamp:
        deck["meta"]["repair_policy"] = stamp
    findings = findings_of(deck, ctx["inp"], ctx["audience"], plan_issues)
    (folder / "deck.json").write_text(json.dumps(deck, indent=1, ensure_ascii=False, default=str))
    (folder / "validation.json").write_text(json.dumps(findings, indent=1, ensure_ascii=False))
    res = ctx["render_fn"](deck, folder, findings) or {}
    pptx = res.get("pptx")
    for f in res.get("pic_findings") or []:
        f["slide_no"] = deck["order"].index(f["slide"]) + 1
        findings.append(f)
    if res.get("pic_findings"):
        (folder / "validation.json").write_text(json.dumps(findings, indent=1, ensure_ascii=False))
    pdf = ctx["pdf_fn"](pptx, folder) if pptx else None
    qa = ctx["qa_fn"](pptx, pdf, folder, findings) if pptx else {"slides": {"deck": [{"check": "unreadable", "level": "error", "message": "no .pptx"}]}, "pixels": {}, "summary": {}}
    qa = stamp_qa(folder, qa)
    ok = bool(pptx) and not (list(qa.get("slides", {})) == ["deck"] and all(f.get("check") == "unreadable" for f in qa["slides"]["deck"]))
    iss = I.derive(findings, qa, deck, ctx["policy"], round_)
    (folder / "issues.json").write_text(json.dumps(iss, indent=1, ensure_ascii=False))
    diffs = read_ledger(ctx["base_deck"], deck, folder, ctx["audience"]) if pptx else [{"slide": I.DECK_KEY, "block": None, "kind": "unreadable", "expected": None, "got": "no .pptx"}]
    cl = checklist.run_checklist(folder, deck_id="deck") if (folder / "layouts.json").exists() else None
    return {"folder": folder, "deck": deck, "findings": findings, "qa": qa, "issues": iss, "ok": ok, "counts": counts(iss, deck), "pairs": pairs(iss, deck),
            "content": content_set(findings), "ledger": diffs, "checklist": cl, "placed": res.get("placed"), "pptx": pptx, "pdf": pdf,
            "pixels": bool(qa.get("pixels"))}


# ---------------------------------------------------------------------------------------------------- the keep gate
def gate(prev: dict, cur: dict, targeted: set) -> dict:
    """K1 to K5: ``{keep, K1..K5, reasons}``. ``prev`` is the last kept round's measure, ``cur`` this round's, ``targeted`` the ids of the issues
    the round acted on."""
    from .bench import compare
    r = {}
    reasons = []
    c0, c1 = prev["counts"], cur["counts"]
    new_pairs = cur["pairs"] - prev["pairs"]
    r["K1"] = c1["blocker"] <= c0["blocker"] and c1["major"] <= c0["major"] and not new_pairs
    if not r["K1"]:
        reasons.append("more blockers or majors" if (c1["blocker"] > c0["blocker"] or c1["major"] > c0["major"]) else
                       "a new " + ", ".join(sorted({f"{c} on {s}" for c, s in new_pairs})[:2]))
    if prev["checklist"] and cur["checklist"]:
        bundle = lambda m: {"items_version": 0, "decks": {"deck": m["checklist"]}}
        d = compare.compare(bundle(prev), bundle(cur), tolerance=0.0, tier=repair_tiers())
        r["K2"] = not (d["regressions"] or d["metric_regressions"] or d["lost_coverage"])
        r["K2_detail"] = {"regressions": d["regressions"], "metric_regressions": d["metric_regressions"], "lost_coverage": d["lost_coverage"],
                          "changed": sorted({c["item"] for x in d["decks"].values() for c in x["changes"] if c["tier"] == "gate"})}
        if not r["K2"]:
            reasons.append("the checklist got worse: " + ", ".join(r["K2_detail"]["changed"][:3] or ["coverage"]))
    else:
        r["K2"] = not cur["checklist"] is None if prev["checklist"] is None else False
        r["K2_detail"] = {"regressions": 0, "metric_regressions": 0, "lost_coverage": int(not r["K2"]), "changed": []}
        if not r["K2"]:
            reasons.append("the checklist could not be read")
    r["K3"] = not cur["ledger"]
    if not r["K3"]:
        d0 = cur["ledger"][0]
        reasons.append(f"a word that carries a claim changed on slide {d0['slide']}" if d0["kind"] != "unreadable" else "the slides could not be read back")
    r["K4"] = cur["content"] == prev["content"]
    if not r["K4"]:
        reasons.append("a content finding " + ("appeared" if (cur["content"] - prev["content"]) else "disappeared"))
    ids_prev = {i["id"] for i in prev["issues"]}
    ids_cur = {i["id"] for i in cur["issues"]}
    fixed = (targeted & ids_prev) - ids_cur
    r["K5"] = bool(fixed)
    if not r["K5"]:
        reasons.append("fixed none of the issues it acted on")
    if not cur["ok"]:
        r["K1"] = False
        reasons.insert(0, "the QA could not be read")
    r["keep"] = all(r[k] for k in ("K1", "K2", "K3", "K4", "K5"))
    r["reasons"] = reasons
    r["fixed"] = sorted(fixed)
    return r


# ---------------------------------------------------------------------------------------------------- selection and the ladder
def _rungs(issue: dict, policy: dict) -> tuple:
    row = ACTION_MAP[issue["check"]]
    if issue["check"] == "image_flagged" and (policy.get("images") or {}).get("on_flag") == "regen_then_drop":
        return row["regen_then_drop"]
    if issue["slide"] == I.DECK_KEY and issue["check"] not in ("layout_repeat",):
        return ("needs_human",)
    return row["rungs"] if issue.get("slot") or "flow" not in row else row["flow"]


def select(m: dict, policy: dict, deck_order: list, state: dict, pinned: set) -> list:
    """The issues this round may act on, one per slide: open, in ``policy.repair_on``, on a presented unpinned slide (a deck-level issue acts on
    the middle slide of its run: ``layout_repeat``), sorted by severity, the slide's place in the deck, the check name and the id. A critic issue is
    taken only inside its code-confirm band. Returns ``[issue]``; pinned slides' issues are classified by ``classify``."""
    on = set(policy.get("repair_on") or ("blocker", "major"))
    pres = set(_presented(m["deck"]))
    cand = []
    for i in m["issues"]:
        if i["severity"] not in on or i["slide"] in pinned or i["id"] in state["left"] or i["source"] == "critic" and not _critic_ready(i, policy):
            continue
        if i["slide"] != I.DECK_KEY and i["slide"] not in pres:
            continue
        cand.append(i)
    cand.sort(key=lambda i: (SEV_RANK[i["severity"]], deck_order.index(i["slide"]) if i["slide"] in deck_order else 10 ** 6, i["check"], i["id"]))
    out, seen = [], set()
    for i in cand:
        if i["slide"] in seen:
            continue
        seen.add(i["slide"])
        out.append(i)
    return out


def _critic_ready(issue: dict, policy: dict) -> bool:
    return bool((policy.get("critic") or {}).get("enabled")) and critic_fix_allowed(issue["check"], issue.get("evidence") or {}, policy)


def classify(issue: dict, policy: dict, pinned: set, state_left: dict) -> str | None:
    """The reason an issue is left for a person, or None while the loop may still act on it: pinned, a terminal rung, or a content finding."""
    if issue["slide"] in pinned:
        return "pinned"
    rungs = _rungs(issue, policy)
    if all(r in TERMINAL for r in rungs):
        return {"needs_human": "needs a person's decision", "left_for_person": "needs a fact, a source, a decision or a person", "engine_fault": "engine fault: a layout file or the plan broke its own rule",
                "none": "no action"}[rungs[0]]
    return None


# ---------------------------------------------------------------------------------------------------- availability and effects
def _image_slot(s: dict, issue: dict) -> str | None:
    slots = s.get("slots") or {}
    if issue.get("slot") in slots and slots[issue["slot"]].get("kind") == "image":
        return issue["slot"]
    return next((n for n, v in slots.items() if v.get("kind") == "image"), None)


def _evidence_slide(s: dict) -> bool:
    """A slide of a judged (claiming) type that carries refs: its evidence stays on screen, never to the notes."""
    from . import stages
    return s["type"] in stages.JUDGED and any(b.get("refs") or any(isinstance(i, dict) and i.get("refs") for i in b.get("items") or []) for b in s["blocks"])


def available(rung: str, issue: dict, env: dict) -> tuple:
    """``(ok, why)``: may ``rung`` act on this issue now? Reads the last kept deck, the cumulative fixes and the ladder state."""
    sid, slot = issue["slide"], issue.get("slot")
    deck, fixes, pol = env["deck"], env["fixes"], env["policy"]
    s = deck["slides"].get(sid)
    if s is None:
        return False, "no such slide"
    if (sid, rung, slot) in env["state"]["tried"]:
        return False, "already tried"
    lay = s.get("layout") or {}
    lid = lay.get("id")
    f = (fixes.get("slides") or {}).get(sid) or {}
    if rung == "shrink":
        cur = (lay.get("fit") or {}).get("scale")
        if cur is None or lid in (None, "flow"):
            return False, "no measured scale"
        floor = (pol.get("shrink") or {}).get("min_scale", 0.85)
        new = round(min(cur, f.get("scale_max", cur)) - 0.05, 3)
        return (new >= floor - 1e-9, "at the smallest type the policy allows" if new < floor - 1e-9 else "")
    if rung == "undo_shrink":
        return ((f.get("scale_max") or 1.0) < 1.0, "no repair shrink to undo")
    if rung == "switch_layout":
        if lay.get("chosen_by") == "person":
            return False, "a person chose this layout"
        if env["library"] and (env["library"].get(lid) or {}).get("group", "content") != "content":
            return False, "a cover, divider or closing layout is the deck's furniture and is never swapped for a content layout"
        alts = [a for a in lay.get("alternatives") or [] if a not in f.get("avoid", [])]
        return (bool(alts), "no untried alternative layout")
    if rung == "shorten":
        if not env["shorten_ok"]:
            return False, env["shorten_why"]
        if not slot:
            return False, "the finding names no slot"
        return True, ""
    if rung == "overflow_to_notes":
        if env["text_mode"] != "condense":
            return False, "moving text to the notes needs text mode condense"
        if env["density"] == "detailed" or s["type"] in layouts.NEVER_MOVE_TYPES:
            return False, "this density or slide type keeps its points on the slide"
        if _evidence_slide(s):
            return False, "its evidence stays on screen"
        return True, ""
    if rung in ("add_scrim", "crop_image"):
        return (bool(_image_slot(s, issue)), "no picture on the slide")
    if rung == "drop_image":
        return (bool(lid and env["library"].get(lid, {}).get("without_image")), "the layout has no version without its picture")
    if rung == "regen_image":
        return False, "picture regeneration is not wired in this slice (deck-image-gen)"
    if rung == "replan":
        return True, ""
    return False, "not an action"


def apply_effect(fixes: dict, rung: str, issue: dict, env: dict) -> dict:
    """The fix the rung writes, into ``fixes`` (the agreed shape of layouts.plan: ``slides.<sid>.{avoid, scale_max, layout, notes}`` and
    ``images.<sid>.<slot>.{scrim, fit, focal}``). Returns ``{from, to}`` for the report. Nothing else is written: the loop writes no slot."""
    sid = issue["slide"]
    s = env["deck"]["slides"][sid]
    lay = s.get("layout") or {}
    sl = fixes.setdefault("slides", {}).setdefault(sid, {})
    if rung == "shrink":
        cur = (lay.get("fit") or {}).get("scale", 1.0)
        sl["scale_max"] = round(min(cur, sl.get("scale_max", cur)) - 0.05, 3)
        return {"from": round(cur, 3), "to": sl["scale_max"]}
    if rung == "undo_shrink":
        was = sl.get("scale_max")
        sl["scale_max"] = 1.0
        return {"from": was, "to": 1.0}
    if rung == "switch_layout":
        sl["avoid"] = sorted(set(sl.get("avoid", [])) | {lay.get("id")} - {None})
        to = next((a for a in lay.get("alternatives") or [] if a not in sl["avoid"]), None)   # the plan's own order of fitting alternatives
        if to:
            sl["layout"] = to
        return {"from": lay.get("id"), "to": to}
    if rung == "overflow_to_notes":
        sl["notes"] = "allow"
        return {"from": None, "to": "notes"}
    if rung == "drop_image":
        to = env["library"][lay["id"]]["without_image"]
        sl["layout"] = to
        return {"from": lay.get("id"), "to": to}
    if rung in ("add_scrim", "crop_image"):
        slot = _image_slot(s, issue)
        im = ((s.get("slots") or {}).get(slot) or {}).get("image") or {}
        patch = fixes.setdefault("images", {}).setdefault(sid, {}).setdefault(slot, {})
        if rung == "add_scrim":
            patch["scrim"] = "dark"
            return {"from": im.get("scrim") or "none", "to": "dark"}
        patch.update(fit="cover", focal=im.get("focal") or {"x": 0.5, "y": 0.5})
        return {"from": im.get("fit") or "cover", "to": "cover"}
    return {"from": None, "to": None}


def _resolve_critic(issue: dict, policy: dict) -> str | None:
    """The rung a critic issue may take: the rubric's fix for that question when the policy lets the critic make it (never shorten or notes)."""
    rubric = json.loads((DECK / "visual_rubric.json").read_text())
    q = next((x for k in ("per_slide", "per_deck") for x in rubric.get(k, []) if x["id"] == issue["check"]), None)
    kind = q.get("fix") if q else None
    return kind if kind in (policy.get("critic") or {}).get("may_fix", []) and kind not in ("shorten", "overflow_to_notes") else None


def choose(issue: dict, env: dict, skipped: list, defer_shorten: bool = True) -> dict | None:
    """The first available rung for an issue: ``{rung, issue}``; None when it is left for a person (recorded in ``env.state.left``). A rung that
    is unavailable falls through to the next in the same round; a paid rung that cannot run is listed in ``skipped``."""
    rungs = _rungs(issue, env["policy"])
    for rung in rungs:
        if rung == "critic":
            rung = _resolve_critic(issue, env["policy"]) or "none"
        if issue["source"] == "critic" and rung in ("shorten", "overflow_to_notes"):
            continue   # by source, in code: a critic finding never shortens or moves text, whatever the map says
        if rung in TERMINAL:
            env["state"]["left"][issue["id"]] = {"needs_human": "needs a person's decision", "left_for_person": "needs a fact, a source or a decision",
                                                 "engine_fault": "engine fault", "none": "no action"}[rung]
            return None
        ok, why = available(rung, issue, env)
        if ok:
            return {"rung": rung, "issue": issue}
        if rung in ("shorten", "overflow_to_notes", "regen_image") and why != "already tried":
            skipped.append({"slide": issue["slide"], "slot": issue.get("slot"), "rung": rung, "why": why})
    return None


# ---------------------------------------------------------------------------------------------------- the paid rung
def _deny(ctx: dict):
    """The deny list of the deck's marked texts, or None when there are no marks to apply."""
    marks = getattr(ctx.get("inp"), "marks", None)
    if not marks:
        return None
    from visuals import lint   # noqa: PLC0415
    return lint.deny_list(marks)


def shorten_spent(led) -> float:
    """What this deck's shorten calls have cost in its lifetime ledger: per send, the last row's USD (the card's upper bound until the call settles, then the
    measured figure). A call that died before it settled stays at its upper bound, so a crash never frees budget."""
    last = {}
    for r in led.lines() if led else []:
        if r.get("kind") == "shorten":
            last[r.get("send")] = float(r.get("usd") or 0)
    return round(sum(last.values()), 4)


def recording_path(stages, n: int, rsha: str) -> Path:
    """Where a shorten reply is kept: named by its request's hash, so a reply is never overwritten by another request's."""
    return Path(stages) / f"e_repair_{rsha}.json"


def get_reply(ctx: dict, n: int, request: list, skipped: list) -> tuple:
    """The shorten reply for round ``n``: ``(edits [{slide, slot, field, text}], row for report.json)``. A recording of this request (its file is named by the
    request's hash and is never overwritten) is read; one made for another request is listed and never applied. With no recording the call is made only
    with ``--live``, with the marks known, under the caps (policy.max_usd for the deck's whole life, counted in its ledger; NAPKIN_DECK_MAX_USD for the run),
    after printing its cost card. A call that raises (a refusal too) is caught, skipped and listed."""
    import contextlib
    import uuid
    rsha = sha(request)
    stages_dir = Path(ctx["stages"]) if ctx.get("stages") else None
    path = recording_path(stages_dir, n, rsha) if stages_dir else None
    legacy = stages_dir / f"e_repair_{n}.json" if stages_dir else None   # recordings made before the files were named by request hash
    card = estimate(request)
    row = {"source": "skipped", "request_sha": rsha, "cost_card": card}
    for cand in (path, legacy):
        if cand is None or not cand.exists():
            continue
        try:
            obj = json.loads(cand.read_text())
        except ValueError:
            obj = {}
        if obj.get("request_sha") == rsha:
            row.update(source="recorded", produced_by=obj.get("produced_by"), **(obj.get("usage") or {}))
            return obj.get("edits") or [], row
        skipped.append({"slide": None, "slot": None, "rung": "shorten", "why": f"the recording {cand.name} was made for another request (stale), so it is not applied"})
        row["why"] = "stale recording"
        if not ctx["live"]:
            return None, row
    if not ctx["live"]:
        skipped.append({"slide": None, "slot": None, "rung": "shorten", "why": "this build was not live and no recording matches"})
        row["why"] = "not live"
        return None, row
    if getattr(ctx.get("inp"), "marks", None) is None:   # fail closed, as pictures do: with no mark data it cannot be known whether a request carries a marked part
        why = "no mark data, so a paid shorten request is refused (give the marks, even an empty list)"
        skipped.append({"slide": None, "slot": None, "rung": "shorten", "why": why})
        row["why"] = why
        return None, row
    led = ctx.get("shorten_ledger")
    send = uuid.uuid4().hex[:12]
    with (led.locked() if led else contextlib.nullcontext()):   # the check and the marker are one step under the lock, so two builds cannot both pass it
        life = shorten_spent(led) if led else ctx["usd"][0]
        left_policy = float(ctx["policy"].get("max_usd", 0.6)) - life
        left_run = ctx["run_cap"] - ctx["spent"]() - ctx["usd"][0]
        card.update(policy_left=round(left_policy, 4), run_left=round(left_run, 4))
        if card["usd_upper"] > left_policy or card["usd_upper"] > left_run:
            why = "the estimated cost would pass the deck's cap" if card["usd_upper"] > left_policy else "the estimated cost would pass the run's cap (NAPKIN_DECK_MAX_USD)"
            skipped.append({"slide": None, "slot": None, "rung": "shorten", "why": why})
            row["why"] = why
            return None, row
        if led:
            led.append({"kind": "shorten", "send": send, "request": rsha, "usd": card["usd_upper"], "state": "sending"})
    print(f"Repair shorten, cost card: {card['slots']} slots, about {card['tokens_in']} tokens in, up to {card['tokens_out']} out, at most {card['usd_upper']:.3f} USD "
          f"(deck cap left {left_policy:.2f}, run cap left {left_run:.2f})")
    try:
        obj, usage = ctx["call_fn"](request)
    except Exception as e:   # a refusal (the server's cost cap) or any failure: skipped and listed, the deck is still delivered
        why = f"the call failed: {type(e).__name__}"
        skipped.append({"slide": None, "slot": None, "rung": "shorten", "why": why})
        row["why"] = why
        return None, row
    if led:
        with led.locked():
            led.append({"kind": "shorten", "send": send, "request": rsha, "usd": float(usage.get("usd") or 0), "state": "settled"})
    obj = {**obj, "stage": "e_repair", "round": n, "request_sha": rsha, "request": request, "usage": usage}
    if path is not None and not path.exists():   # never overwritten: another request has its own hash
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(obj, indent=1, ensure_ascii=False))
    ctx["usd"][0] += float(usage.get("usd") or 0)
    row.update(source="live", **usage)
    return obj.get("edits") or [], row


def guard_edits(edits: list, request: list, deck_kept_slides: dict, work_base: dict, base_deck: dict, policy: dict, by_title: dict) -> tuple:
    """Run a reply's edits through the guards (assemble.shorten_problem against the BASE deck): ``(accepted {(sid, field): text}, refused [{slide,
    field, why}])``. An edit is refused when its field was not in the request or is not eligible, or any guard fails."""
    from . import assemble
    sh = policy.get("shorten") or {}
    asked = {(r["slide"], r["slot"], f["id"]) for r in request for f in r["fields"]}
    acc, ref = {}, []
    for e in edits if isinstance(edits, list) else []:
        if not isinstance(e, dict):
            continue
        sid = by_title.get(e.get("slide"))
        fid = str(e.get("field", ""))
        if sid is None or (e.get("slide"), e.get("slot"), fid) not in asked:
            ref.append({"slide": sid or e.get("slide"), "field": fid, "why": "a field that was not asked for"})
            continue
        s0 = base_deck["slides"][sid]
        old = _field_text(base_deck, sid, fid)
        why = assemble.shorten_problem(old, e.get("text"), "", frozenset(), tuple(sh.get("guards") or ()), float(sh.get("max_cut_ratio", 0.35)),
                                       current=_field_text(work_base, sid, fid), word_rule=sh.get("word_rule", "delete_only"),
                                       deletable=set(sh["deletable"]) if sh.get("deletable") is not None else None)
        if why:
            ref.append({"slide": sid, "field": fid, "why": why})
        else:
            acc[(sid, fid)] = str(e["text"]).strip()
    return acc, ref


# ---------------------------------------------------------------------------------------------------- the loop
def existing(deck: dict, findings: list, qa: dict | None, folder: Path, ctx: dict) -> dict:
    """Round 0 as the build wrote it into ``folder`` (out/): the same fields ``measure`` returns, without rendering again. ``qa`` None means the
    build ran no QA (the loop does not run then)."""
    from .bench import checklist
    folder = Path(folder)
    iss = I.derive(findings, qa, deck, ctx["policy"], 0)
    ok = bool(qa) and not (list((qa or {}).get("slides", {})) == ["deck"] and all(f.get("check") == "unreadable" for f in qa["slides"]["deck"]))
    pptx = folder / "deck.pptx" if (folder / "deck.pptx").exists() else None
    diffs = read_ledger(ctx["base_deck"], deck, folder, ctx["audience"]) if pptx else [{"slide": I.DECK_KEY, "block": None, "kind": "unreadable", "expected": None, "got": "no .pptx"}]
    cl = checklist.run_checklist(folder, deck_id="deck") if (folder / "layouts.json").exists() and qa else None
    return {"folder": folder, "deck": deck, "findings": findings, "qa": qa, "issues": iss, "ok": ok, "counts": counts(iss, deck), "pairs": pairs(iss, deck),
            "content": content_set(findings), "ledger": diffs, "checklist": cl, "pptx": pptx, "pdf": folder / "deck.pdf" if (folder / "deck.pdf").exists() else None,
            "pixels": bool((qa or {}).get("pixels"))}


def shorten_available(text_mode, audience: str, live: bool, approval, stages, expected: str | None = None, word_rule: str = "delete_only") -> tuple:
    """``(ok, why not)``: may the paid shorten rung run at all? Only with text mode condense; on a client deck only with a person's yes, which is an
    approval id (``approval_id``) equal to the one for these exact words (``expected``): a bare yes, or an id for other words, is refused; and only live or
    with a recording."""
    if text_mode != "condense":
        return False, "shortening needs text mode condense (this build keeps your words)"
    if audience == "client" and word_rule != "delete_only":
        return False, "the reuse word rule is not allowed on a client deck: only deleting listed words is"
    if audience == "client" and not (isinstance(approval, str) and approval and approval == expected):
        return False, "shortening a client deck needs a person's yes for these words (--approve-shorten " + (expected or "ID") + ")"
    if not (live or (stages and list(Path(stages).glob("e_repair_*.json")))):
        return False, "this build was not live and has no recording"
    return True, ""


def replay_key(ctx: dict) -> dict:
    """What a replay must agree on besides the deck and the policy: the audience, the text mode, a client's approval id and the guard version."""
    return {"audience": ctx["audience"], "text_mode": ctx["prefs"].get("text_mode"),
            "approval": ctx.get("approve_shorten") if ctx["audience"] == "client" else None, "guard": GUARD_VERSION}


def record_sig(rec: dict) -> str:
    """A hash over what a record decides (base, policy, key, and each round's verdict, fixes, edits and request): an edited record no longer matches it."""
    return sha({"base": rec.get("base_sha"), "policy": rec.get("policy_sha"), "key": rec.get("key"),
                "rounds": [{k: r.get(k) for k in ("n", "verdict", "fixes", "edits", "request")} for r in rec.get("rounds") or []]})


def _replan(ctx: dict, work_base: dict, fixes: dict, stop: bool = False) -> tuple:
    prefs = {"density": ctx["prefs"].get("density"), "text_mode": ctx["prefs"].get("text_mode"), "repair": stop, "notes": ctx["prefs"].get("notes", True)}
    prefs.update({k: ctx["prefs"][k] for k in ("prefer", "prefer_type") if ctx["prefs"].get(k)})   # deck-types: the recipe's layout preferences, when on
    return layouts.plan(work_base, ctx["library"], prefs, ctx["swaps"], {}, fixes)


def _slide_score(m: dict, sid: str) -> int:
    return sum(1 for i in m["issues"] if i["slide"] == sid and i["source"] != "critic" and _gate_severity(i) in ("blocker", "major"))


def _salvage(prev: dict, cur: dict, actions: list) -> list:
    """The actions of a rolled-back round worth trying again alone: the slide's blockers plus majors went strictly down, the slide gained no issue
    it did not have, and the round did not raise the deck-level count."""
    deck_up = _slide_score(cur, I.DECK_KEY) > _slide_score(prev, I.DECK_KEY)
    out = []
    for a in actions:
        sid = a["slide"]
        before, after = {i["id"] for i in prev["issues"] if i["slide"] == sid}, {i["id"] for i in cur["issues"] if i["slide"] == sid}
        if not deck_up and _slide_score(cur, sid) < _slide_score(prev, sid) and after <= before:
            out.append(a)
    return out


def _report_issues(m0: dict, final: dict, state: dict, targeted_rolled: set, policy: dict, pinned: set) -> list:
    """The final issues.json: every round-0 issue with its end status (fixed, unfixed, rolled_back, left_for_person, open), then any issue a kept round
    added. A person-facing reason for left_for_person is in ``state.left`` and ``reason``."""
    now = {i["id"]: i for i in final["issues"]}
    out = []
    for i in m0["issues"]:
        j = dict(now.get(i["id"], i))
        reason = state["left"].get(i["id"]) or ("pinned" if i["slide"] in pinned else None)
        if i["id"] not in now:
            j["status"] = "fixed"
        elif reason:
            j["status"] = "left_for_person"
        elif i["id"] in targeted_rolled:
            j["status"] = "rolled_back"
        elif i["id"] in state["targeted"]:
            j["status"] = "unfixed"
        else:
            j["status"] = "open"
        j["round"] = 0
        out.append(j)
    known = {i["id"] for i in m0["issues"]}
    for i in final["issues"]:
        if i["id"] not in known:
            out.append({**i, "status": "open"})
    return out


def _summary(n: int, kept: bool, g: dict, actions: list, before: dict, after: dict, m: dict, prev: dict, usd: float, edits_slides: list, texts_changed: bool) -> dict:
    return {"n": n, "kept": kept, "why": ("; ".join(g["reasons"]) if not kept else "")[:160], "actions": actions, "before": before, "after": after,
            "fixed": len(g["fixed"]), "open": sum(after.values()), "checklist": g["K2_detail"], "text": {"packet_changed": texts_changed, "slides": edits_slides},
            "gate": {k: bool(g[k]) for k in ("K1", "K2", "K3", "K4", "K5")}, "usd": round(usd, 4)}


def run(ctx: dict, m0: dict) -> dict:
    """Run the loop on round 0 (``m0``, from ``existing``). ``ctx``: inp, audience, policy, library, prefs {density, text_mode}, swaps, base_deck,
    pinned (slide ids), out (Path), stages (Path or None), live, approve_shorten, call_fn, spent (callable: USD the run's stages spent so far),
    run_cap (USD), clock, record (a parsed repair_record.json or None), the render seams (render_fn, pdf_fn, qa_fn). Returns the result
    (rounds, final measure and deck, stopped, skipped, left, issues, record, stage rows); the caller writes the files and the report."""
    policy = ctx["policy"]
    ctx.setdefault("clock", time.time)
    ctx.setdefault("usd", [0.0])
    stamp = {**policy}
    base = ctx["base_deck"]
    order = list(base["order"])
    pinned = set(ctx.get("pinned") or ())
    by_title = {base["slides"][x]["title"]: x for x in order}
    condense = ctx["prefs"].get("text_mode") == "condense"
    shorten_ok, shorten_why = shorten_available(ctx["prefs"].get("text_mode"), ctx["audience"], ctx["live"], ctx.get("approve_shorten"), ctx.get("stages"), approval_id(ctx["base_deck"]), (policy.get("shorten") or {}).get("word_rule", "delete_only"))
    state = {"tried": set(), "left": {}, "targeted": set()}
    skipped: list = []
    rounds_out, rec_rounds, stage_rows = [], [], {}
    kept = m0
    fixes_kept: dict = {}
    work_kept = base
    edits_all: dict = {}
    rolled_targets: set = set()
    stopped = "nothing_to_do"
    final_n = 0
    pol_sha, base_sha = sha(policy), sha({**base, "meta": {k: v for k, v in base["meta"].items() if k != "built_at"}})
    record = ctx.get("record")
    key = replay_key(ctx)
    replay = bool(record) and record.get("base_sha") == base_sha and record.get("policy_sha") == pol_sha and record.get("key") == key
    if record and not replay:
        skipped.append({"slide": None, "slot": None, "rung": "replay", "why": "the recorded repair is stale (the deck, the policy, the audience, the text mode, the approval or the guards changed), so this run decides afresh"})
    if replay and record.get("sig") != record_sig(record):
        replay, why = False, "the recorded repair was edited after it was written, so it is refused and this run decides afresh"
        skipped.append({"slide": None, "slot": None, "rung": "replay", "why": why})
    secs_round: list = []
    t_start = ctx["clock"]()
    max_rounds = int(policy.get("max_rounds", 2))
    salvage_actions: list | None = None
    n = 0

    def env_for(m, fixes):
        return {"deck": m["deck"], "fixes": fixes, "policy": policy, "state": state, "library": ctx["library"], "shorten_ok": shorten_ok, "shorten_why": shorten_why,
                "text_mode": ctx["prefs"].get("text_mode"), "density": ctx["prefs"].get("density") or "detailed"}

    if replay:
        # replay: the recorded fixes, edits and verdicts are applied round by round; no model, no clock, and nothing is measured to DECIDE. But nothing recorded is
        # trusted: every edit goes through shorten_available and the guards again, and the replayed deck must still pass the ledger.
        bad = ""
        for rr in record["rounds"]:
            n = rr["n"]
            rec_rounds.append(rr)
            rounds_out.append(rr["summary"])
            if rr["verdict"] == "kept":
                fixes_kept = rr["fixes"]
                if rr.get("edits"):
                    if not shorten_ok:
                        bad = "a recorded shortening cannot be replayed here: " + shorten_why
                        break
                    slot_of = {(r["slide"], f["id"]): r["slot"] for r in rr.get("request") or [] for f in r["fields"]}
                    conv = [{"slide": base["slides"][e["slide"]]["title"] if e.get("slide") in base["slides"] else e.get("slide"), "field": e["field"], "text": e["text"],
                             "slot": slot_of.get((base["slides"][e["slide"]]["title"] if e.get("slide") in base["slides"] else None, e["field"]))} for e in rr["edits"]]
                    acc, refused = guard_edits(conv, rr.get("request") or [], None, work_kept, base, policy, by_title)
                    if refused or len(acc) != len(rr["edits"]):
                        bad = "a recorded edit is refused by the guards now: " + (refused[0]["why"] if refused else "unreadable")
                        break
                    edits_all.update(acc)
                    work_kept = apply_edits(base, edits_all)
                final_n = n
        final = None
        if not bad and final_n:
            deck_n, plan_issues, _ = _replan(ctx, work_kept, fixes_kept)
            final = measure(deck_n, plan_issues, Path(ctx["out"]) / "repair" / f"round-{final_n}", ctx, final_n, stamp)
            if final["ledger"]:
                bad = "the replayed deck does not keep the token ledger"
        if not bad:
            stopped = record.get("stopped", stopped)
            skipped += record.get("skipped") or []
            st = record.get("state") or {}
            state["left"], state["targeted"], rolled_targets = dict(st.get("left") or {}), set(st.get("targeted") or ()), set(st.get("rolled") or ())
            return _result(ctx, m0, final or m0, final_n, rounds_out, stopped, skipped, state, rolled_targets, pinned, rec_rounds, record, base_sha, pol_sha, work_kept, fixes_kept, stage_rows,
                           replayed=True)
        skipped.append({"slide": None, "slot": None, "rung": "replay", "why": bad + "; this run decides afresh"})
        shutil.rmtree(Path(ctx["out"]) / "repair", ignore_errors=True)
        rounds_out, rec_rounds, edits_all, fixes_kept, work_kept, final_n, n = [], [], {}, {}, base, 0, 0

    while n < max_rounds:
        n += 1
        if ctx["live"] and secs_round and (ctx["clock"]() - t_start) + max(secs_round) > float(policy.get("max_seconds", 240)):
            stopped = "time_cap"
            n -= 1
            break
        t_round = ctx["clock"]()
        env = env_for(kept, fixes_kept)
        actions: list = []
        request_sent: list = []
        round_edits: dict = {}
        row_skipped: list = []
        if salvage_actions is not None:
            todo, salvage_actions = salvage_actions, None
            for a in todo:
                issue = next((i for i in kept["issues"] if i["id"] == a["issue_id"]), None)
                if issue is None:
                    continue
                actions.append({"rung": a["action"], "issue": issue, "salvaged": True, "edits": a.get("edits") or {}})
                round_edits.update({tuple(k.split("|", 1)): v for k, v in (a.get("edits") or {}).items()})
        else:
            sel = select(kept, policy, order, state, pinned)
            for i in sel:
                if i["slide"] in pinned:
                    continue
                c = choose(i, env, row_skipped)
                if c:
                    actions.append(c)
            # the paid rung: one batched request for every slot that chose shorten
            cands = [a for a in actions if a["rung"] == "shorten"]
            if cands:
                targets = [(a["issue"]["slide"], a["issue"]["slot"], (a["issue"].get("evidence") or {}).get("measured"), (a["issue"].get("evidence") or {}).get("limit")) for a in cands]
                request = build_request(kept["deck"], work_kept, targets, ctx["library"], policy, ctx["audience"], deny=_deny(ctx))
                request_sent = request
                edits, row = (None, None)
                if request:
                    edits, row = get_reply(ctx, n, request, row_skipped)
                    stage_rows[f"e_repair_{n}"] = row
                accepted, refused = guard_edits(edits or [], request or [], kept["deck"]["slides"], work_kept, base, policy, by_title) if edits else ({}, [])
                for r in refused:
                    row_skipped.append({"slide": r["slide"], "slot": None, "rung": "shorten", "why": "edit refused: " + r["why"]})
                round_edits.update(accepted)
                for a in cands:   # a slide whose shorten gave nothing falls through to the next rung in the same round
                    sid = a["issue"]["slide"]
                    state["tried"].add((sid, "shorten", a["issue"].get("slot")))
                    if not any(k[0] == sid for k in accepted):
                        actions.remove(a)
                        if not request:
                            row_skipped.append({"slide": sid, "slot": a["issue"].get("slot"), "rung": "shorten", "why": "no field of the slot may be shortened"})
                        c = choose(a["issue"], env, row_skipped)
                        if c and c["rung"] != "shorten":
                            actions.append(c)
        skipped += row_skipped
        if not actions:
            n -= 1
            stopped = "nothing_to_do"
            if not [i for i in kept["issues"] if i["severity"] in policy["repair_on"] and i["source"] != "critic"]:
                stopped = "clean"
            break
        fixes_round = copy.deepcopy(fixes_kept)
        recs = []
        for a in actions:
            if a["rung"] != "shorten":
                eff = apply_effect(fixes_round, a["rung"], a["issue"], env)
            else:
                eff = {"from": None, "to": "shorter"}
            state["tried"].add((a["issue"]["slide"], a["rung"], a["issue"].get("slot")))
            state["targeted"].add(a["issue"]["id"])
            recs.append({"slide": a["issue"]["slide"], "slot": a["issue"].get("slot"), "issue": a["issue"]["id"], "check": a["issue"]["check"], "action": a["rung"], **eff})
        work_n = apply_edits(work_kept, round_edits) if round_edits else work_kept
        deck_n, plan_issues, _pending = _replan(ctx, work_n, fixes_round)
        folder = Path(ctx["out"]) / "repair" / f"round-{n}"
        m = measure(deck_n, plan_issues, folder, ctx, n, stamp)
        targeted = {a["issue"]["id"] for a in actions}
        g = gate(kept, m, targeted)
        usd = float((stage_rows.get(f"e_repair_{n}") or {}).get("usd") or 0)
        changed = sorted({sid for (sid, _f) in round_edits})
        summ = _summary(n, g["keep"], g, recs, kept["counts"], m["counts"], m, kept, usd, changed, bool(round_edits))
        # what each shortening takes away, for the approver: the deleted words marked in the base text
        summ["shortened"] = [{"slide": sid, "field": fid, "before": _field_text(base, sid, fid), "after": text,
                              "deleted": [w for _i, w in (assemble_deleted(_field_text(base, sid, fid), text) or [])],
                              "marked": assemble_mark(_field_text(base, sid, fid), text)} for (sid, fid), text in sorted(round_edits.items())]
        # to: the layout a switch ended on
        for r in summ["actions"]:
            if r["action"] == "switch_layout":
                r["to"] = (m["deck"]["slides"][r["slide"]].get("layout") or {}).get("id")
        rounds_out.append(summ)
        secs_round.append(ctx["clock"]() - t_round)
        ctx["secs"] = list(secs_round)
        ed_list = [{"slide": k[0], "field": k[1], "text": v} for k, v in sorted(round_edits.items())]
        rec_rounds.append({"n": n, "verdict": "kept" if g["keep"] else "rolled_back", "fixes": fixes_round, "edits": ed_list, "request": request_sent, "shorten_request_sha": (stage_rows.get(f"e_repair_{n}") or {}).get("request_sha"),
                           "gate": summ["gate"], "summary": summ, "actions": [{"issue_id": a["issue"]["id"], "action": a["rung"], "edits": {f"{k[0]}|{k[1]}": v for k, v in round_edits.items() if k[0] == a["issue"]["slide"]}} for a in actions]})
        if g["keep"]:
            kept, fixes_kept, work_kept, final_n = m, fixes_round, work_n, n
            edits_all.update(round_edits)
            c = counts(kept["issues"], kept["deck"])
            if not [i for i in kept["issues"] if i["severity"] in policy["repair_on"] and i["source"] != "critic" and i["slide"] not in pinned and i["id"] not in state["left"]]:
                stopped = "clean"
                break
            stopped = "max_rounds"
        else:
            rolled_targets |= targeted
            if not m["ok"]:
                stopped = "qa_unreadable"
                break
            if n == 1 and max_rounds >= 2:
                sal = _salvage(kept, m, [{"slide": a["issue"]["slide"], "issue_id": a["issue"]["id"], "action": a["rung"], "edits": {f"{k[0]}|{k[1]}": v for k, v in round_edits.items() if k[0] == a["issue"]["slide"]}} for a in actions])
                if sal:
                    salvage_actions = sal
                    stopped = "max_rounds"
                    continue
            stopped = "no_progress" if not g["K5"] else "rolled_back"
            if n >= max_rounds:
                break
            continue   # the next round tries the next untried rung (the ladder runs across rounds); nothing untried ends the loop
    final = kept
    ctx["usd_repair"] = ctx["usd"][0]
    return _result(ctx, m0, final, final_n, rounds_out, stopped, skipped, state, rolled_targets, pinned, rec_rounds, None, base_sha, pol_sha, work_kept, fixes_kept, stage_rows)


def _result(ctx, m0, final, final_n, rounds_out, stopped, skipped, state, rolled_targets, pinned, rec_rounds, record, base_sha, pol_sha, work_kept, fixes_kept, stage_rows, replayed=False) -> dict:
    policy = ctx["policy"]
    iss = _report_issues(m0, final, state, rolled_targets, policy, pinned)
    left = [{"slide": i["slide"], "check": i["check"], "why": "pinned" if i["slide"] in pinned else state["left"].get(i["id"], "needs a person")} for i in iss if i["status"] == "left_for_person"]
    sk = [s for s in skipped]
    if replayed and record is not None:
        left = record.get("left") or left
    repair = {"version": 1, "policy": policy, "policy_sha": pol_sha, "rounds": rounds_out, "stopped": stopped, "skipped": sk, "left_for_person": left}
    rec = {"base_sha": base_sha, "policy_sha": pol_sha, "key": replay_key(ctx), "rounds": rec_rounds, "stopped": stopped, "skipped": sk, "left": left,
           "state": {"left": state["left"], "targeted": sorted(state["targeted"]), "rolled": sorted(rolled_targets)}}
    rec["sig"] = record_sig(rec)
    return {"final_round": final_n, "final": final, "deck": final["deck"], "rounds": rounds_out, "stopped": stopped, "skipped": sk, "left": left, "issues": iss,
            "repair": repair, "record": rec, "stage_rows": stage_rows, "usd": ctx["usd"][0], "ran": bool(rounds_out), "replayed": replayed, "secs": ctx.get("secs", []), "work_base": work_kept, "fixes": fixes_kept}


def sentence(a: dict, status: str) -> str:
    """A fixed sentence for a person (never a model's): ``Slide 7: the body text ran past its box. Fixed: layout image_text to cards.``"""
    what = SENTENCES.get(a["check"], a["check"].replace("_", " "))
    sid = a["slide"]
    n = int(re.sub(r"\D", "", sid) or 0) if sid != I.DECK_KEY else 0
    head = f"Slide {n}" if n else "The deck"
    how = {"switch_layout": f"layout {a.get('from')} to {a.get('to')}", "shrink": f"type scaled from {a.get('from')} to {a.get('to')}",
           "overflow_to_notes": "points moved to the speaker notes (nothing deleted)", "shorten": "wording shortened with the words already on the slide",
           "add_scrim": "a scrim added under the text", "crop_image": "the picture cropped to fill", "drop_image": f"the picture dropped (layout {a.get('to')})",
           "undo_shrink": "the smaller type undone"}.get(a["action"], a["action"])
    return f"{head}: {what}. " + ("Fixed: " if status == "kept" else "Tried, rolled back: ") + how + "."
