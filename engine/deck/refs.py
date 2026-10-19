"""Resolve a claim ref to what it says and where it comes from (shared by assemble, validate, render)."""
from __future__ import annotations

import ast
import operator
import re

NUM = re.compile(r"(?<![\w.])\d{1,3}(?:,\d{3})+(?:\.\d+)?|(?<![\w.])\d+(?:\.\d+)?")


def numbers_in(text: str) -> set:
    """Every number written in a piece of text, as floats (commas removed)."""
    out = set()
    for m in NUM.findall(str(text or "")):
        try:
            out.add(float(m.replace(",", "")))
        except ValueError:
            pass
    return out


_OPS = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul, ast.Div: operator.truediv,
        ast.Pow: operator.pow, ast.Mod: operator.mod, ast.FloorDiv: operator.floordiv}


def safe_calc(expr: str) -> float:
    """Evaluate plain arithmetic (numbers, + - * / // % **, unary minus, parentheses) by walking the
    syntax tree. Nothing else is allowed: no names, calls or attributes. Raises ValueError otherwise."""
    def go(n):
        """Evaluate one syntax node."""
        if isinstance(n, ast.Expression):
            return go(n.body)
        if isinstance(n, ast.Constant) and isinstance(n.value, (int, float)) and not isinstance(n.value, bool):
            return n.value
        if isinstance(n, ast.UnaryOp) and isinstance(n.op, (ast.USub, ast.UAdd)):
            v = go(n.operand)
            return -v if isinstance(n.op, ast.USub) else v
        if isinstance(n, ast.BinOp) and type(n.op) in _OPS:
            a, b = go(n.left), go(n.right)
            if isinstance(n.op, ast.Pow) and (abs(b) > 10 or abs(a) > 1e6):
                raise ValueError("exponent too large")
            return _OPS[type(n.op)](a, b)
        raise ValueError("not arithmetic")
    if len(expr) > 200:
        raise ValueError("expression too long")
    return go(ast.parse(expr.strip(), mode="eval"))


def prompt_sentences(text: str) -> list:
    """The sentences of the person's prompt, numbered from 1 by ``prompt:<n>``. The split is
    deterministic and simple enough to repeat in the app: break at every line end, then after
    each ``.``, ``!`` or ``?`` that is followed by white space (``5.2`` stays whole); trim and drop
    empty pieces."""
    out = []
    for line in str(text or "").splitlines():
        out += [x.strip() for x in re.split(r"(?<=[.!?])\s+", line.strip()) if x.strip()]
    return out


def answer_text(inp, qid: str) -> str:
    """What the person answered to question ``qid``: their text, or the chosen option's label and
    value. Empty when unanswered or skipped."""
    a = (inp.answers or {}).get(qid)
    if not isinstance(a, dict) or a.get("skipped"):
        return ""
    if a.get("text"):
        return str(a["text"])
    if a.get("option_id"):
        for q in (inp.intake or {}).get("questions") or []:
            if q.get("id") == qid:
                for o in q.get("options") or []:
                    if o.get("id") == a["option_id"]:
                        v = o.get("value")
                        return f"{o.get('label', '')} {v if v is not None else ''}".strip()
    return ""


def fmt(row: dict) -> str:
    """Format a fact or document figure for a slide: proportions as %, counts with commas."""
    v, unit = row.get("value"), (row.get("unit") or "")
    if unit == "proportion" and isinstance(v, (int, float)):
        pct = v * 100
        return f"{pct:.1f}%".replace(".0%", "%") if abs(pct - round(pct)) > 1e-6 else f"{round(pct)}%"
    if unit == "eur" and isinstance(v, (int, float)):
        return f"€{v:,.0f}"
    if isinstance(v, bool):
        return "yes" if v else "no"
    if isinstance(v, int) or (isinstance(v, float) and v.is_integer()):
        return f"{int(v):,}"
    return str(v)


def value_numbers(row: dict) -> set:
    """The numbers a fact or figure licenses on a slide (its value in every display form)."""
    v, unit = row.get("value"), row.get("unit")
    out = set()
    if isinstance(v, bool):
        return out
    if isinstance(v, (int, float)):
        out.add(float(v))
        if unit == "proportion":
            out |= {round(v * 100, 1), float(round(v * 100))}
    else:
        out |= numbers_in(v)
    out |= numbers_in(row.get("as_of"))
    out |= numbers_in(row.get("label"))
    return out


class Resolver:
    """Look up any ref against one run's Inputs."""

    def __init__(self, inp, requirements: list | None = None):
        self.inp = inp
        self.reqs = {r["id"]: r for r in (requirements or [])}

    def kind(self, ref: str) -> str:
        """'fact' | 'finding' | 'docfig' | 'doc' | 'brief' | 'req' | 'calc' | 'prompt' | 'answer' | 'unknown'."""
        if ref.startswith("f_"):
            return "fact" if ref in self.inp.facts else "unknown"
        if ref.startswith("fi_"):
            return "finding" if ref in self.inp.findings else "unknown"
        if ref.startswith("doc:"):
            if ref in self.inp.doc_facts:
                return "docfig"
            return "doc" if ref[4:].split("#")[0] in self.inp.docs else "unknown"
        if ref.startswith("brief:"):
            return "brief" if ref[6:].split(".")[0] in self.inp.brief else "unknown"
        if ref.startswith("req:"):
            return "req" if ref[4:] in self.reqs else "unknown"
        if ref.startswith("calc:"):
            return "calc"
        if ref.startswith("prompt:"):
            n = ref[7:]
            return "prompt" if n.isdigit() and 1 <= int(n) <= len(prompt_sentences(self.inp.prompt_text)) else "unknown"
        if ref.startswith("answer:"):
            return "answer" if answer_text(self.inp, ref[7:]) else "unknown"
        return "unknown"

    def brief_value(self, path: str):
        """The value at a brief path (brief:objectives.attitudinal)."""
        parts = path.split(".")
        v = (self.inp.brief.get(parts[0]) or {}).get("value")
        for p in parts[1:]:
            v = v.get(p) if isinstance(v, dict) else None
        return v

    def numbers(self, ref: str) -> set:
        """Numbers this ref licenses on a slide."""
        k = self.kind(ref)
        if k == "fact":
            return value_numbers(self.inp.facts[ref])
        if k == "docfig":
            return value_numbers(self.inp.doc_facts[ref])
        if k == "doc":
            return numbers_in(self.inp.docs[ref[4:].split("#")[0]]["text"])
        if k == "brief":
            return numbers_in(str(self.brief_value(ref[6:])))
        if k == "req":
            return numbers_in(self.reqs[ref[4:]]["text"])
        if k == "finding":
            return numbers_in(self.inp.findings[ref].get("statement"))
        if k == "prompt":
            return numbers_in(prompt_sentences(self.inp.prompt_text)[int(ref[7:]) - 1])
        if k == "answer":
            return numbers_in(answer_text(self.inp, ref[7:]))
        if k == "calc":
            try:
                v = safe_calc(ref[5:])  # arithmetic only: a syntax-tree walk, never eval
                return {float(round(v)), round(float(v), 1)}
            except Exception:  # noqa: BLE001
                return set()
        return set()

    def source_key(self, ref: str) -> tuple:
        """(key, label, url) of the source a ref footnotes to."""
        k = self.kind(ref)
        if k == "fact":
            srcs = self.inp.facts[ref].get("sources") or []
            if srcs and srcs[0] in self.inp.sources:
                s = self.inp.sources[srcs[0]]
                return (srcs[0], f"{s.get('publisher') or s.get('domain')}, \"{s.get('title')}\" ({s.get('published_at') or s.get('retrieved_at')})", s.get("uri"))
            return (ref, f"Research pin {ref}", None)
        if k == "finding":
            return ("research_findings", f"Research findings ({self.inp.research_title}), reviewed by a person", None)
        if k in ("docfig", "doc"):
            dk = ref[4:].split("#")[0]
            name = self.inp.docs.get(dk, {}).get("name", dk)
            return ("doc:" + dk, f"Client document: {name}", None)
        if k == "brief":
            return ("brief", "Brief maker brief (engine run), with each field's provenance", None)
        if k == "req":
            return ("req", "Requirement list read from the client's tender documents", None)
        if k == "prompt":
            return ("prompt", "The person's prompt", None)
        if k == "answer":
            return (ref, "The person's answer to a question", None)
        if k == "calc":
            return ("calc", "Calculated from the figures cited on the slide", None)
        return ("unknown", ref, None)

    def describe(self, ref: str) -> str:
        """One line for speaker notes: id, value and provenance."""
        k = self.kind(ref)
        if k == "fact":
            f = self.inp.facts[ref]
            return f"[{ref}] {f.get('key')} = {fmt(f)} (as of {f.get('as_of')}, confidence {f.get('confidence')})"
        if k == "docfig":
            f = self.inp.doc_facts[ref]
            return f"[{ref}] {f.get('label')} = {fmt(f)} (page {f.get('page')})"
        if k == "finding":
            f = self.inp.findings[ref]
            return f"[{ref}] finding, {f.get('status')}: {str(f.get('statement'))[:140]}"
        if k == "brief":
            b = self.inp.brief.get(ref[6:].split(".")[0], {})
            v = self.brief_value(ref[6:])
            text = " ".join(f"{k}: {x}" for k, x in v.items() if x) if isinstance(v, dict) else "; ".join(map(str, v)) if isinstance(v, list) else str(v or "")
            under = [r for r in b.get("refs") or [] if isinstance(r, str)] or [r for r in b.get("fact_refs") or [] if isinstance(r, str)]
            return (f"[{ref}] brief field ({b.get('mark') or b.get('kind')})" + (f": {text[:140]}" if text.strip() else "")
                    + (f" (rests on {', '.join(under)})" if under else ""))
        if k == "prompt":
            return f"[{ref}] prompt: {prompt_sentences(self.inp.prompt_text)[int(ref[7:]) - 1][:140]}"
        if k == "answer":
            return f"[{ref}] the person's answer: {answer_text(self.inp, ref[7:])[:140]}"
        return f"[{ref}]"
