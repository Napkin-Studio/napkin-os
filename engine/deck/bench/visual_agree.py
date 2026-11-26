"""``visual agree``: grade the critic and a code-only baseline against a person, and write the trust file.

A question is ``off`` (the default), ``advisory`` (shown, never fixes) or ``acts`` (may start a code-confirmed fix). The
state comes only from this step (the file carries an HMAC over the whole document, signed with a secret kept outside the repo, so a hand edit reads as off), from the
pre-registered primary configuration, and from the gates below. Fail is the positive class throughout.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
from pathlib import Path

from . import visual as V
from .judges import BenchError
from . import visual_stats as S

GATES = {"off_min_fails": 5, "adv_kappa": 0.4, "adv_flip": 0.25, "acts_kappa_lb": 0.4, "acts_spec_lb": 0.9, "acts_fails": 15,
         "acts_natural_fails": 5, "acts_added": 5, "acts_self": 0.8, "cant_max": 0.2}
N_BOOT = 2000
STATES = ("off", "advisory", "acts")


SECRET_ENV = "NAPKIN_TRUST_SECRET"


def secret() -> bytes | None:
    """The signing secret, from the environment: it never lives in the repo, so a file edited (or recomputed) by someone
    without it cannot read as trusted."""
    v = os.environ.get(SECRET_ENV, "")
    return v.encode() if v else None


def sign(doc: dict, key: bytes) -> str:
    """HMAC-SHA256 over the whole document except its ``digest`` field (key, configuration, gates and questions)."""
    body = {k: v for k, v in doc.items() if k != "digest"}
    return hmac.new(key, json.dumps(body, sort_keys=True, ensure_ascii=False).encode(), hashlib.sha256).hexdigest()


def trust_key(cfg: dict) -> dict:
    """What a trust figure was earned under; any difference at read time means off."""
    return {"rubric_version": cfg.get("rubric_version"), "prompt_sha": cfg.get("prompt_sha"), "model": cfg.get("model"),
            "image_size": cfg.get("width"), "libreoffice": cfg.get("libreoffice"), "fonts": cfg.get("fonts")}


def read_trust(path: Path, current_key: dict | None = None) -> dict:
    """``{question id: state}`` for every rubric question. Off for all when the file is missing, edited by hand (digest),
    or keyed differently from ``current_key``."""
    items = V.rubric_items()
    off = {q: "off" for q in items}
    try:
        t = json.loads(Path(path).read_text())
    except (OSError, ValueError):
        return off
    qs = t.get("questions") or {}
    sec = secret()
    if sec is None or not isinstance(t.get("digest"), str) or not hmac.compare_digest(t["digest"], sign(t, sec)) or t.get("key") is None:
        return off
    if current_key is not None and t["key"] != current_key:
        return off
    return {q: (qs.get(q, {}).get("state") if qs.get(q, {}).get("state") in STATES else "off") for q in items}


def _answers(grades: dict) -> dict:
    return grades.get("answers", grades)


def _fig(rows: list, seed: int, n_boot: int) -> dict:
    """Agreement figures of ``rows`` (dicts with person, other booleans = fail, and cluster)."""
    pairs = [(r["p"], r["c"]) for r in rows]
    n = len(rows)
    pf = [r for r in rows if r["p"]]
    pp = [r for r in rows if not r["p"]]
    k = S.kappa(pairs)
    ci = S.cluster_bootstrap(rows, lambda rs: S.kappa([(r["p"], r["c"]) for r in rs]), lambda r: r["cluster"], n_boot, seed)
    sp_k = sum(1 for r in pp if not r["c"])
    return {"n": n, "person_fails": len(pf), "raw_agreement": S.rate(sum(1 for a, b in pairs if a == b), n),
            "kappa": k, "kappa_ci90": [ci["lo"], ci["hi"]], "specificity": S.rate(sp_k, len(pp)), "specificity_wilson_lb": S.wilson_lower(sp_k, len(pp)),
            "fail_recall": S.rate(sum(1 for r in pf if r["c"]), len(pf))}


def agree(grades: dict, visual: dict, key: dict, seed: int = 0, n_boot: int = N_BOOT, signing_key: bytes | None = None) -> dict:
    """The trust document for these grades, critic answers and key, signed with the secret from the environment (or
    ``signing_key``); without a secret there is nothing to sign with and BenchError is raised. No file, no model."""
    signing_key = signing_key or secret()
    if signing_key is None:
        raise BenchError(f"set {SECRET_ENV} (a secret kept outside the repo) to sign the trust file")
    items = V.rubric_items()
    ans = _answers(grades)
    cfg = visual["config"]
    primary = bool(cfg.get("primary"))
    slides = {t: s for t, s in key["slides"].items() if not s.get("repeat_of")}
    # a person's self-agreement, pooled over every question on the repeated slides
    selfp = []
    for t, s in key["slides"].items():
        if s.get("repeat_of"):
            for q, a in (ans.get(t) or {}).items():
                b = (ans.get(s["repeat_of"]) or {}).get(q)
                if a in ("yes", "no") and b in ("yes", "no"):
                    selfp.append((a, b))
    pooled_self = S.self_agreement(selfp)
    out: dict = {}
    for q, it in items.items():
        if it["scope"] == "deck" or q not in {x for ss in V.SESSION_QUESTIONS.values() for x in ss}:
            out[q] = {"state": "off", "reasons": ["bench only: no deck-level grades in version 1"], "n": 0}
            continue
        rows, asked, cant, unjudged, flips = [], 0, 0, 0, []
        for t, s in slides.items():
            if q not in s["questions"]:
                continue
            p = (ans.get(t) or {}).get(q)
            res = visual["results"].get(t) or {}
            v1 = ((res.get("1") or {}).get("answers") or {}).get(q, {}).get("verdict")
            v2 = ((res.get("2") or {}).get("answers") or {}).get(q, {}).get("verdict")
            if p is not None:
                asked += 1
            if p == "cant":
                cant += 1
            if v1 == "unjudgeable":
                unjudged += 1
            if v1 in ("pass", "fail") and v2 in ("pass", "fail"):
                flips.append((v1 == "fail", v2 == "fail"))
            if p in ("yes", "no") and v1 in ("pass", "fail"):
                m = s["measures"]
                rows.append({"p": p == "no", "c": v1 == "fail", "c2": (v2 == "fail") if v2 in ("pass", "fail") else None,
                             "b": V.code_predict(q, m) == "fail", "cluster": s["content"], "natural": not s["seeded"], "tok": t})
        by = {"both": rows, "natural": [r for r in rows if r["natural"]], "seeded": [r for r in rows if not r["natural"]]}
        crit = {k: _fig(v, seed, n_boot) for k, v in by.items()}
        base = {k: _fig([{**r, "c": r["b"]} for r in v], seed, n_boot) for k, v in by.items()}
        flip = S.flip_rate(flips)
        both = crit["both"]
        # added value: person fails the code baseline passed that the critic caught, and a paired bootstrap of the kappa gap
        caught = sum(1 for r in rows if r["p"] and not r["b"] and r["c"])
        gap = S.cluster_bootstrap(rows, lambda rs: _gap(rs), lambda r: r["cluster"], n_boot, seed)
        added = {"caught_over_baseline": caught, "kappa_gap_lb": gap["lo"], "passes": bool(caught >= GATES["acts_added"] and gap["lo"] is not None and gap["lo"] > 0)}
        k_lb = both["kappa_ci90"][0]
        nat_fails = crit["natural"]["person_fails"]
        has_fix = it.get("fix", "none") != "none" and bool(it.get("confirm_with"))
        reasons, state = [], "off"
        cant_rate = S.rate(cant, asked)
        if not primary:
            reasons.append("exploratory configuration: only the pre-registered primary configuration can move a state")
        elif both["kappa"] is None:
            reasons.append("kappa is undefined (no fails or no passes on a side)")
        elif both["person_fails"] < GATES["off_min_fails"]:
            reasons.append(f"only {both['person_fails']} person fails (needs {GATES['off_min_fails']})")
        elif cant_rate is not None and cant_rate > GATES["cant_max"]:
            reasons.append(f"the person said can't-tell on {cant_rate:.0%} (over {GATES['cant_max']:.0%}): reword the question, do not trust")
        elif not (both["kappa"] >= GATES["adv_kappa"] and k_lb is not None and k_lb > 0):
            reasons.append("kappa under 0.4 or its lower bound not above 0")
        elif flip is not None and flip > GATES["adv_flip"]:
            reasons.append(f"flip rate {flip:.2f} is over {GATES['adv_flip']}")
        else:
            state = "advisory"
            need = []
            if not (k_lb >= GATES["acts_kappa_lb"]):
                need.append("kappa lower bound under 0.4")
            if both["specificity_wilson_lb"] is None or both["specificity_wilson_lb"] < GATES["acts_spec_lb"]:
                need.append("specificity lower bound under 0.9")
            if both["person_fails"] < GATES["acts_fails"]:
                need.append(f"person fails under {GATES['acts_fails']}")
            if nat_fails < GATES["acts_natural_fails"]:
                need.append(f"natural person fails under {GATES['acts_natural_fails']}")
            if not added["passes"]:
                need.append("the critic does not beat the code baseline (tighten the code check instead)")
            if pooled_self is None or pooled_self < GATES["acts_self"]:
                need.append("the person's pooled self-agreement is under 0.8 or unmeasured")
            if not has_fix:
                need.append("the question has no fix or no confirm_with")
            if need:
                reasons += need
            else:
                state = "acts"
        out[q] = {"state": state, "reasons": reasons, "n": both["n"], "by_subset": crit, "baseline": base, "flip_rate": flip,
                  "added_value": added, "cant_rate": cant_rate, "unjudgeable_rate": S.rate(unjudged, len(slides_with(slides, q))),
                  "kappa_order2": S.kappa([(r["p"], r["c2"]) for r in rows if r["c2"] is not None])}
    doc = {"version": 1, "written_by": "deck.bench visual agree", "key": trust_key(cfg), "primary_configuration": primary,
           "gates": GATES, "self_agreement_pooled": pooled_self, "self_agreement_pairs": len(selfp), "questions": out}
    doc["digest"] = sign(doc, signing_key)
    return doc


def slides_with(slides: dict, q: str) -> list:
    return [t for t, s in slides.items() if q in s["questions"]]


def _gap(rows: list) -> float | None:
    a = S.kappa([(r["p"], r["c"]) for r in rows])
    b = S.kappa([(r["p"], r["b"]) for r in rows])
    if b is None:   # a baseline that never fails (or always does) is no better than chance
        b = 0.0
    return None if a is None else a - b


def off_file() -> dict:
    """The committed starting point: every question off, no key, unsigned (it reads as all-off whatever the secret)."""
    qs = {q: {"state": "off", "reasons": ["no grades yet"], "n": 0} for q in V.rubric_items()}
    return {"version": 1, "written_by": "deck.bench visual agree", "key": None, "primary_configuration": False, "gates": GATES,
            "self_agreement_pooled": None, "self_agreement_pairs": 0, "questions": qs, "digest": None}
