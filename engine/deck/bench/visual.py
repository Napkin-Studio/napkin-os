"""The vision critic bench, phase 1 (feature deck-vision-critic): measure an eye before it is trusted.

    python3 -m deck.bench visual renders OUT_DIR                 two renders of each invented fixture deck
    python3 -m deck.bench visual pack RUN_DIR... --session A|B --out DIR --seed N
    python3 -m deck.bench visual run --key KEY --images DIR --orders 2 --max-usd X [--live --yes-cost]
    python3 -m deck.bench visual agree grades.json visual.json --key KEY

``pack`` writes a blind grading page (index.html plus slide PNGs, no network) and a key file we keep. ``run`` asks the
critic the questions that apply to each graded slide, in two question orders, from recordings or live, under a dollar
cap. ``agree`` (visual_agree.py) grades the critic and a code-only baseline against a person's answers and writes the
trust file. Nothing here is imported by the deck pipeline: no run, deck, export or prompt reads it. Invented decks only.
"""
from __future__ import annotations

import copy
import hashlib
import json
import random
import re
import shutil
import subprocess
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from .. import issues, spec
from ..validate import presented as _presented, words as _words
from . import visual_transport as vt
from .judges import BenchError

DECK = Path(__file__).resolve().parents[1]
RUBRIC_PATH = DECK / "visual_rubric.json"
DATA_PATH = Path(__file__).with_name("visual_data.json")
PROMPT_PATH = DECK / "prompts" / "critic.md"
TRUST_PATH = Path(__file__).parent / "baseline" / "critic_trust.json"

#: The pre-registered primary configuration (set before any grading). Only it can move a question's state.
PRIMARY = {"model": "claude-sonnet-5-5", "width": 1280, "effort": "low", "prompt_version": 1, "orders": 2}
SESSION_QUESTIONS = {"A": ("v_one_focus", "v_balance", "v_not_crowded", "v_looks_finished"),
                     "B": ("v_image_fits", "v_image_clean", "v_text_on_image", "v_crop_ok")}
CONTENT_EXCLUDED = ("title", "appendix", "close")
FILLED = ("made", "flagged", "approved")
#: Slides in a session, with the seeded share, and the unannounced repeats (plan: about 100 slides plus 8 repeats).
SESSION_SLIDES, REPEATS = 100, 8
SEEDED_QUOTA = {"overfilled": 16, "aside": 16, "equal_blocks": 8}   # session A; each acts-candidate question needs >= 15 person fails
SEEDED_TARGETS = {"overfilled": ("v_not_crowded", "v_looks_finished"), "aside": ("v_balance", "v_looks_finished"),
                  "equal_blocks": ("v_one_focus", "v_looks_finished")}
MAX_OUT_TOKENS = 1200
DECK_CAP_USD = 0.40   # the per-deck live cap Sai approved (critic.max_usd in phase 2); applied to every bench run too
WORKERS = 4


# ---------------------------------------------------------------- rubric and data

def load_rubric(path: Path = RUBRIC_PATH) -> dict:
    return json.loads(Path(path).read_text())


def load_data(path: Path = DATA_PATH) -> dict:
    return json.loads(Path(path).read_text())


def rubric_items(rubric: dict | None = None) -> dict:
    """``{id: item}`` over per_slide and per_deck, each with a ``scope`` of slide or deck."""
    r = rubric or load_rubric()
    return {**{i["id"]: {**i, "scope": "slide"} for i in r["per_slide"]}, **{i["id"]: {**i, "scope": "deck"} for i in r["per_deck"]}}


def prompt_text() -> str:
    return PROMPT_PATH.read_text()


def prompt_sha() -> str:
    return hashlib.sha256(PROMPT_PATH.read_bytes()).hexdigest()


def prompt_version() -> int:
    m = re.search(r"Prompt version (\d+)", prompt_text())
    return int(m.group(1)) if m else 0


def applies(item: dict, facts: dict) -> bool:
    """Whether a per-slide question is asked on a slide, from the item's ``applies_to`` (groups content, has_image)."""
    a = item.get("applies_to") or {}
    if "has_image" in a and bool(a["has_image"]) != bool(facts.get("has_image")):
        return False
    if a.get("groups") and "content" in a["groups"] and not facts.get("content"):
        return False
    return True


def questions_for(facts: dict, session: str, rubric: dict | None = None) -> list:
    """The question ids of a session that apply to a slide, in rubric order."""
    items = rubric_items(rubric)
    return [q for q in SESSION_QUESTIONS[session] if applies(items[q], facts)]


# ---------------------------------------------------------------- slides of a run folder

def _read(path: Path):
    try:
        return json.loads(Path(path).read_text())
    except (OSError, ValueError):
        return None


def slide_hash(deck: dict, sid: str) -> str:
    """A stable id for a slide's content (the slide object of deck.json), the key recordings map back to a fixture."""
    return hashlib.sha256(json.dumps(deck["slides"][sid], sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:16]


def cluster_of(run_dir: Path) -> tuple:
    """(content, render) of a run folder: ``name`` and ``name__alt`` are two renders of the same content."""
    name = Path(run_dir).name
    m = re.match(r"^(.*)__([a-z0-9]+)$", name)
    return (m.group(1), m.group(2)) if m else (name, "base")


def has_image(slide: dict) -> bool:
    for slot in (slide.get("slots") or {}).values():
        img = slot.get("image") if isinstance(slot, dict) and slot.get("kind") == "image" else None
        if isinstance(img, dict) and img.get("status") in FILLED:
            return True
    return False


def image_flagged(slide: dict) -> bool:
    return any(isinstance(s, dict) and isinstance(s.get("image"), dict) and s["image"].get("status") == "flagged" for s in (slide.get("slots") or {}).values())


def slide_facts(deck: dict, sid: str) -> dict:
    ids = _presented(deck)
    sl = deck["slides"][sid]
    return {"type": sl["type"], "n": ids.index(sid) + 1, "of": len(ids), "has_image": has_image(sl),
            "content": sl["type"] not in CONTENT_EXCLUDED, "first": ids[0] == sid, "last": ids[-1] == sid}


def text_sizes(slide_shapes) -> list:
    """The largest explicit font size (pt) of each text shape, for the focus baseline."""
    from .. import qa_render
    out = []
    for sh in slide_shapes:
        if getattr(sh, "has_text_frame", False) and sh.text_frame.text.strip():
            out.append(max(qa_render._para_size(p) for p in sh.text_frame.paragraphs))
    return out


def measures(deck: dict, sid: str, n: int, qa: dict | None, pptx_slide, validation) -> dict:
    """What the code-only baseline reads about one slide, kept in key.json so ``agree`` is a pure function of files."""
    sl = deck["slides"][sid]
    px = ((qa or {}).get("pixels") or {}).get(str(n)) or {}
    h3, v3 = px.get("h3") or [], px.get("v3") or []
    flags = [f["check"] for f in ((qa or {}).get("slides") or {}).get(str(n), []) if isinstance(f, dict) and f.get("level") in ("warn", "error")]
    flags += [f.get("check") for f in (validation or []) if isinstance(f, dict) and f.get("slide") == sid and f.get("level") in ("warn", "error")]
    layout = sl.get("layout") if isinstance(sl.get("layout"), dict) else {}
    return {"ink": px.get("ink"),
            "corner": None if not h3 or not sum(h3) or not sum(v3) else round(min(max(h3) / sum(h3), max(v3) / sum(v3)), 3),
            "words": _words(sl), "budget": sl.get("budget") or spec.SLIDE_TYPES[sl["type"]]["words"],
            "relaxed": bool((layout.get("fit") or {}).get("relaxed")), "sizes": text_sizes(pptx_slide.shapes) if pptx_slide is not None else [],
            "flags": sorted(set(flags)), "image_flagged": image_flagged(sl)}


def code_predict(qid: str, m: dict) -> str:
    """The code-only baseline's answer for a question: ``fail`` or ``pass`` from stored measures, never a model.
    v_image_fits and v_crop_ok have no code predictor (pass everywhere)."""
    fail = False
    if qid == "v_one_focus":
        s = m.get("sizes") or []
        fail = len(s) >= 2 and sum(1 for x in s if x >= max(s) - 0.5) > 1
    elif qid == "v_balance":
        fail = (m.get("corner") is not None and m["corner"] >= 0.65) or (m.get("ink") is not None and m["ink"] <= 0.04)
    elif qid == "v_not_crowded":
        fail = bool(m.get("words", 0) > (m.get("budget") or 10 ** 9) or m.get("relaxed"))
    elif qid == "v_looks_finished":
        fail = bool(m.get("flags"))
    elif qid == "v_image_clean":
        fail = bool(m.get("image_flagged"))
    elif qid == "v_text_on_image":
        fail = "text_on_image_contrast" in (m.get("flags") or [])
    return "fail" if fail else "pass"


# ---------------------------------------------------------------- seeded faults

def _title_shape(slide):
    shapes = [s for s in slide.shapes if getattr(s, "has_text_frame", False) and s.text_frame.text.strip()]
    return min(shapes, key=lambda s: (s.top or 0)) if shapes else None


def seed_fault(prs, index: int, kind: str) -> bool:
    """Apply one frozen, deterministic design fault to slide ``index`` (0-based) of a python-pptx deck, in place.
    overfilled: every body text is tripled. aside: everything shrinks into the top-left quarter. equal_blocks: the body
    becomes three identical boxes at one size and the title is small. Returns False when the slide cannot take it."""
    from pptx.util import Emu, Pt
    sl = prs.slides[index]
    W, H = prs.slide_width, prs.slide_height
    title = _title_shape(sl)
    bodies = [s for s in sl.shapes if getattr(s, "has_text_frame", False) and s.text_frame.text.strip() and s is not title]
    if kind == "overfilled":
        if not bodies:
            return False
        for sh in bodies:
            for p in list(sh.text_frame.paragraphs):
                for _ in range(2):
                    p._p.addnext(copy.deepcopy(p._p))
        return True
    if kind == "aside":
        for sh in sl.shapes:
            if sh.width is None:
                continue
            sh.left, sh.top, sh.width, sh.height = Emu(int(sh.left * 0.45)), Emu(int(sh.top * 0.45)), Emu(int(sh.width * 0.45)), Emu(int(sh.height * 0.45))
            if getattr(sh, "has_text_frame", False):
                for p in sh.text_frame.paragraphs:
                    for r in p.runs:
                        if r.font.size:
                            r.font.size = Pt(max(6, r.font.size.pt * 0.5))
        return True
    if kind == "equal_blocks":
        texts = [p.text.strip() for sh in bodies for p in sh.text_frame.paragraphs if p.text.strip()]
        if not texts:
            return False
        for sh in bodies:
            sh._element.getparent().remove(sh._element)
        if title is not None:
            for p in title.text_frame.paragraphs:
                for r in p.runs:
                    r.font.size = Pt(20)
        gap = int(W * 0.03)
        w = int((W - gap * 4) / 3)
        for k in range(3):
            box = sl.shapes.add_textbox(Emu(gap + k * (w + gap)), Emu(int(H * 0.35)), Emu(w), Emu(int(H * 0.5)))
            tf = box.text_frame
            tf.word_wrap = True
            tf.text = " ".join(texts[k % len(texts)].split()[:14])
            for p in tf.paragraphs:
                for r in p.runs:
                    r.font.size = Pt(24)
        return True
    raise BenchError(f"unknown seeded fault {kind!r}")


# ---------------------------------------------------------------- rendering (injectable: tests have no LibreOffice)

class Renderer:
    """pptx -> pdf (LibreOffice), pdf -> PNG pages at a width (pdftoppm), qa measures of a pptx and pdf."""

    def pdf(self, pptx: Path, workdir: Path) -> Path:
        from .. import run_deck
        pdf = Path(workdir) / (Path(pptx).stem + ".pdf")
        for attempt in (1, 2):   # LibreOffice sometimes loses a conversion right after the previous one; a private profile and one retry fix it
            subprocess.run([run_deck._soffice(), f"-env:UserInstallation=file://{Path(workdir).resolve()}/lo_profile_{attempt}", "--headless", "--convert-to", "pdf",
                            "--outdir", str(workdir), str(pptx)], capture_output=True, timeout=300)
            if pdf.exists() and pdf.stat().st_size > 0:
                return pdf
        raise BenchError(f"LibreOffice made no PDF from {pptx}")

    def pages(self, pdf: Path, dest: Path, width: int) -> list:
        dest.mkdir(parents=True, exist_ok=True)
        exe = shutil.which("pdftoppm") or "/opt/homebrew/bin/pdftoppm"
        r = subprocess.run([exe, "-png", "-scale-to-x", str(width), "-scale-to-y", "-1", str(pdf), str(dest / "p")], capture_output=True, text=True, timeout=300)
        if r.returncode:
            raise BenchError(f"pdftoppm failed on {pdf}: {r.stderr.strip()[:300]}")
        return sorted(dest.glob("p-*.png"))

    def qa(self, pptx: Path, pdf: Path) -> dict:
        from .. import qa_render
        return qa_render.check_pptx(Path(pptx), Path(pdf))

    def versions(self) -> dict:
        from .. import run_deck
        try:
            lo = subprocess.run([run_deck._soffice(), "--version"], capture_output=True, text=True, timeout=60).stdout.strip()
        except Exception:
            lo = "unknown"
        try:
            fonts = subprocess.run(["fc-list", ":", "family"], capture_output=True, text=True, timeout=60).stdout
            fp = hashlib.sha256("\n".join(sorted(set(fonts.splitlines()))).encode()).hexdigest()[:12] if fonts.strip() else "unknown"
        except Exception:
            fp = "unknown"
        return {"libreoffice": lo, "fonts": fp}


# ---------------------------------------------------------------- pack

def _sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def collect(run_dirs: list, renderer: Renderer, width: int, workdir: Path) -> list:
    """Read each run folder once: deck, qa, validation, its natural pages at ``width`` and its pptx."""
    from pptx import Presentation
    out = []
    for rd in run_dirs:
        rd = Path(rd)
        deck = _read(rd / "deck.json")
        if not isinstance(deck, dict) or not (rd / "deck.pdf").exists() or not (rd / "deck.pptx").exists():
            raise BenchError(f"{rd}: needs deck.json, deck.pptx and deck.pdf (a build with LibreOffice, not --geometry-only)")
        ids = _presented(deck)
        pages = renderer.pages(rd / "deck.pdf", workdir / f"nat_{len(out)}", width)
        if len(pages) < len(ids):
            raise BenchError(f"{rd}: {len(pages)} rendered pages for {len(ids)} presented slides")
        content, render = cluster_of(rd)
        out.append({"dir": rd, "deck": deck, "ids": ids, "pages": pages, "qa": _read(rd / "qa.json") or renderer.qa(rd / "deck.pptx", rd / "deck.pdf"),
                    "validation": _read(rd / "validation.json"), "prs": Presentation(str(rd / "deck.pptx")), "content": content, "render": render})
    return out


def plan_seeds(decks: list, rng: random.Random, session: str, rubric: dict) -> list:
    """Pick which slides take which frozen fault: ``[(deck_index, slide_index, kind)]``. Session B has no seeded faults
    until pictures exist (they are defined after slices 3 and 4)."""
    if session != "A":
        return []
    pool = []
    for di, d in enumerate(decks):
        for si, sid in enumerate(d["ids"]):
            f = slide_facts(d["deck"], sid)
            if f["content"] and not f["first"] and not f["last"] and not f["has_image"]:
                pool.append((di, si))
    rng.shuffle(pool)
    kinds = [k for k, n in SEEDED_QUOTA.items() for _ in range(n)]
    rng.shuffle(kinds)
    return [(di, si, k) for (di, si), k in zip(pool, kinds)]


def render_seeds(decks: list, plan: list, renderer: Renderer, width: int, workdir: Path) -> dict:
    """Render the seeded slides: one modified pptx per deck. Returns ``{(di, si): (png path, qa dict, pptx slide, kind)}``;
    a fault a slide cannot take is skipped."""
    from pptx import Presentation
    got = {}
    for di, d in enumerate(decks):
        mine = [(si, k) for (dj, si, k) in plan if dj == di]
        if not mine:
            continue
        prs = Presentation(str(d["dir"] / "deck.pptx"))
        done = [(si, k) for si, k in mine if seed_fault(prs, si, k)]
        p = workdir / f"seed_{di}.pptx"
        prs.save(str(p))
        pdf = renderer.pdf(p, workdir)
        pages = renderer.pages(pdf, workdir / f"seed_{di}_pages", width)
        qa = renderer.qa(p, pdf)
        for si, k in done:
            got[(di, si)] = (pages[si], qa, prs.slides[si], k)
    return got


def pick_natural(decks: list, taken: set, rng: random.Random, session: str, want: int, rubric: dict) -> list:
    """Natural slides: every picture slide, every first and last slide, the rest at random up to ``want``."""
    must, rest = [], []
    for di, d in enumerate(decks):
        for si, sid in enumerate(d["ids"]):
            if (di, si) in taken:
                continue
            f = slide_facts(d["deck"], sid)
            if not questions_for(f, session, rubric):
                continue
            (must if (f["has_image"] or f["first"] or f["last"]) else rest).append((di, si))
    rng.shuffle(rest)
    return must + rest[:max(0, want - len(must))]


def write_png(src: Path, dst: Path) -> None:
    """Copy a picture re-encoded one way for every slide (RGB, same PNG settings, no metadata or trailing bytes), so a
    seeded slide's file is not given away by its size or encoder. Without Pillow the file is copied as it is."""
    try:
        from PIL import Image
    except ImportError:
        shutil.copyfile(src, dst)
        return
    with Image.open(src) as im:
        im.convert("RGB").save(dst, "PNG", optimize=True, compress_level=9)


def shown_labels(seq: list, label: dict, decks: list, rng: random.Random) -> list:
    """The (deck label, slide number) each entry shows on the page. A repeat gets a fresh pair: another deck's label and
    a number not used in that deck, so S010 and its repeat cannot be matched by their labels."""
    used = {(label[e["di"]], e["facts"]["n"]) for e in seq if "repeat_of" not in e}
    out = []
    for e in seq:
        if "repeat_of" not in e:
            out.append((label[e["di"]], e["facts"]["n"]))
            continue
        options = [(label[di], n) for di in label for n in range(1, len(decks[di]["ids"]) + 1) if di != e["di"] and (label[di], n) not in used]
        pick = rng.choice(options) if options else (label[e["di"]], e["facts"]["n"])
        used.add(pick)
        out.append(pick)
    return out


def pack(run_dirs: list, session: str, out: Path, key_out: Path, seed: int = 0, renderer: Renderer | None = None,
         slides: int = SESSION_SLIDES, repeats: int = REPEATS, quota: dict | None = None) -> dict:
    """Write the blind grading page (``out``/index.html and PNGs) and the key (``key_out``). No model call."""
    from . import visual_page
    renderer = renderer or Renderer()
    rubric = load_rubric()
    rng = random.Random(seed)
    global SEEDED_QUOTA
    saved_quota = SEEDED_QUOTA
    if quota is not None:
        SEEDED_QUOTA = quota
    width = PRIMARY["width"]
    out, key_out = Path(out), Path(key_out)
    try:
        with tempfile.TemporaryDirectory(prefix="visual_pack_") as tmp:
            tmp = Path(tmp)
            decks = collect(run_dirs, renderer, width, tmp)
            plan = plan_seeds(decks, rng, session, rubric)
            seeded = render_seeds(decks, plan, renderer, width, tmp)
            taken = {k for k in seeded}
            natural = pick_natural(decks, taken, rng, session, slides - len(seeded), rubric)
            if not natural and not seeded:
                raise BenchError(f"session {session}: no slide has a question that applies (session B needs slides with a placed picture)")
            order = list(range(len(decks)))
            rng.shuffle(order)
            label = {di: f"D{n:02d}" for n, di in enumerate(order, 1)}
            entries = []
            for di, si in sorted(set(natural) | taken, key=lambda t: (order.index(t[0]), t[1])):
                d = decks[di]
                sid = d["ids"][si]
                facts = slide_facts(d["deck"], sid)
                if (di, si) in seeded:
                    png, qa, ps, kind = seeded[(di, si)]
                    seed_info = {"kind": kind, "targets": list(SEEDED_TARGETS[kind])}
                else:
                    png, qa, ps, seed_info = d["pages"][si], d["qa"], d["prs"].slides[si], None
                entries.append({"di": di, "si": si, "sid": sid, "facts": facts, "png": png, "qa": qa, "ps": ps, "seeded": seed_info})
            # unannounced repeats of natural slides, placed well after the original
            seq = list(entries)
            nat_entries = [e for e in entries if not e["seeded"]]
            for e in rng.sample(nat_entries, min(repeats, len(nat_entries))):
                at = seq.index(e)
                seq.insert(rng.randrange(min(len(seq), at + 10), len(seq) + 1), {**e, "repeat_of": e})
            out.mkdir(parents=True, exist_ok=True)
            for old in out.glob("*.png"):
                old.unlink()
            key = {"session": session, "seed": seed, "rubric_version": rubric["version"], "prompt_sha": prompt_sha(), "width": width,
                   "environment": renderer.versions(), "slides": {}, "decks": {label[di]: {"run": str(decks[di]["dir"].name), "content": decks[di]["content"],
                                                                                         "render": decks[di]["render"]} for di in order}}
            page_slides, tokens = [], {}
            shown = shown_labels(seq, label, decks, rng)
            for n, e in enumerate(seq, 1):
                tok = f"S{n:03d}"
                d = decks[e["di"]]
                img = f"slide-{n:03d}.png"
                write_png(e["png"], out / img)
                rep = e.get("repeat_of")
                if rep is not None:
                    tokens_of = tokens[id(rep)]
                else:
                    tokens[id(e)] = tok
                    tokens_of = None
                qs = questions_for(e["facts"], session, rubric)
                m = measures(d["deck"], e["sid"], e["si"] + 1, e["qa"], e["ps"], d["validation"])
                key["slides"][tok] = {"deck": label[e["di"]], "content": d["content"], "render": d["render"], "run": d["dir"].name, "slide_id": e["sid"],
                                      "n": e["facts"]["n"], "type": e["facts"]["type"], "hash": slide_hash(d["deck"], e["sid"]), "questions": qs,
                                      "seeded": e["seeded"], "repeat_of": tokens_of, "image": img, "image_sha": _sha((out / img).read_bytes()),
                                      "facts": e["facts"], "measures": m, "shown": {"deck": shown[n - 1][0], "n": shown[n - 1][1]}}
                page_slides.append({"token": tok, "img": img, "deck": shown[n - 1][0], "n": shown[n - 1][1], "questions": qs})
            warm = _warmup(decks, seeded, rng, renderer, width, out, session) if session == "A" else []
            key["warmup"] = [{"img": w["img"], "kind": w["kind"]} for w in warm]
            visual_page.write(out / "index.html", session, page_slides, load_data(), rubric_items(rubric), warm)
            key_out.parent.mkdir(parents=True, exist_ok=True)
            key_out.write_text(json.dumps(key, indent=1, ensure_ascii=False) + "\n")
    finally:
        SEEDED_QUOTA = saved_quota
    return key


def _warmup(decks, seeded, rng, renderer, width, out: Path, session: str) -> list:
    """Warm-up examples (not scored): a clean invented slide and one frozen fault per kind, from the first deck."""
    from pptx import Presentation
    d = decks[0]
    used = {si for (di, si) in seeded if di == 0}
    free = [si for si, sid in enumerate(d["ids"]) if si not in used and slide_facts(d["deck"], sid)["content"]
            and not slide_facts(d["deck"], sid)["first"] and not slide_facts(d["deck"], sid)["last"]]
    if len(free) < 4:
        return []
    picks = free[:4]
    with tempfile.TemporaryDirectory(prefix="visual_warm_") as tmp:
        tmp = Path(tmp)
        prs = Presentation(str(d["dir"] / "deck.pptx"))
        kinds = ["overfilled", "aside", "equal_blocks"]
        ok = [(si, k) for si, k in zip(picks[1:], kinds) if seed_fault(prs, si, k)]
        p = tmp / "warm.pptx"
        prs.save(str(p))
        pages = renderer.pages(renderer.pdf(p, tmp), tmp / "pages", width)
        res = []
        examples = [("pass", d["pages"][picks[0]])] + [(k, pages[si]) for si, k in ok]
        for n, (kind, src) in enumerate(examples, 1):
            name = f"warm-{n}.png"
            write_png(src, out / name)
            res.append({"img": name, "kind": kind})
    return res


# ---------------------------------------------------------------- run

def user_text(facts: dict, qids: list, items: dict) -> str:
    qs = "\n".join(f"{i}. {q}: {items[q]['question']}" for i, q in enumerate(qids, 1))
    return (f"Slide facts: type {facts['type']}; slide {facts['n']} of {facts['of']}; "
            f"{'has' if facts['has_image'] else 'has no'} placed picture.\nQuestions, answer each:\n{qs}\n")


def parse_reply(text: str, qids: list) -> dict:
    """``{qid: {verdict, description}}`` from a reply; anything malformed or missing is unjudgeable, never a pass."""
    out = {q: {"verdict": "unjudgeable", "description": "no usable answer"} for q in qids}
    try:
        m = re.search(r"\{.*\}", text or "", re.S)
        ans = json.loads(m.group(0))["answers"] if m else {}
    except (ValueError, KeyError, TypeError):
        return out
    if not isinstance(ans, dict):
        return out
    for q in qids:
        a = ans.get(q)
        if isinstance(a, dict) and a.get("verdict") in ("pass", "fail", "unjudgeable"):
            out[q] = {"verdict": a["verdict"], "description": str(a.get("description", ""))[:200]}
    return out


def call_key(image_sha: str, rubric_version: int, psha: str, model: str, qids: list, effort: str = PRIMARY["effort"]) -> str:
    return hashlib.sha256(json.dumps([image_sha, rubric_version, psha, model, list(qids), effort]).encode()).hexdigest()[:24]


def build_jobs(key: dict, orders: int) -> list:
    """``[(token, order, question ids, slide)]``: the calls a run makes (repeats are not asked)."""
    jobs = []
    for tok, s in key["slides"].items():
        if s.get("repeat_of") or not s["questions"]:
            continue
        for order in range(1, orders + 1):
            jobs.append((tok, order, list(s["questions"]) if order == 1 else list(reversed(s["questions"])), s))
    return jobs


def plan_cost(key: dict, images: Path, model: str, orders: int, max_usd: float, max_tokens: int = MAX_OUT_TOKENS,
              max_deck_usd: float = DECK_CAP_USD) -> dict:
    """The cost card from the real token estimate of every call (each picture's size and the real prompt text), with a
    card id that ``--yes-cost`` must repeat: the id covers the calls, the estimate, the model and both caps."""
    items = rubric_items()
    system = prompt_text()
    est_in = worst = 0.0
    jobs = build_jobs(key, orders)
    for _tok, _o, qids, s in jobs:
        png = (Path(images) / s["image"]).read_bytes()
        n = vt.estimate_input_tokens(png, len(system) + len(user_text(s["facts"], qids, items)))
        est_in += n
        worst += vt.worst_case_usd(model, n, max_tokens)
    typical = sum(spec.estimate_usd(model, 0, 800, 0, vt.estimate_input_tokens((Path(images) / s["image"]).read_bytes(), len(system) + 300)) for _t, _o, _q, s in jobs)
    ident = hashlib.sha256(json.dumps([len(jobs), int(est_in), model, orders, round(max_usd, 4), round(max_deck_usd, 4), max_tokens, prompt_sha()]).encode()).hexdigest()[:8]
    text = (f"COST CARD {ident}\n  calls: {len(jobs)} ({model}, slide picture + questions, prompt v{prompt_version()}), about {int(est_in):,} input tokens\n"
            f"  typical: about ${typical:.2f}; worst case ${worst:.2f}; caps: --max-usd ${max_usd:.2f}, ${max_deck_usd:.2f} a deck\n"
            f"  transport: the Napkin API key (ANTHROPIC_API_KEY), invented slides only\n  to run: --live --yes-cost {ident}\n")
    return {"id": ident, "calls": len(jobs), "est_in": int(est_in), "worst_usd": round(worst, 4), "typical_usd": round(typical, 4), "text": text}


def run(key: dict, images: Path, transport, *, model: str = PRIMARY["model"], orders: int = 2, max_usd: float,
        max_deck_usd: float = DECK_CAP_USD, effort: str = PRIMARY["effort"], recordings: Path | None = None, record_to: Path | None = None,
        workers: int = WORKERS, live: bool = False, max_tokens: int = MAX_OUT_TOKENS, card_id: str | None = None) -> dict:
    """Ask the critic the applicable questions of every graded slide, in ``orders`` question orders. A call is replayed
    from ``recordings`` when one matches (cost 0); otherwise it needs ``live``, a transport and the id printed on the
    cost card (``card_id``). Each call reserves its worst case against ``max_usd`` and against its deck's ``max_deck_usd``
    before it starts; a call that would pass either cap is not started and is unjudgeable with the reason. A paid call
    is always booked: its real usage when known, else its reserved worst case, also when its answer is unusable
    (max_tokens, refusal) or the call failed after being sent. Returns the visual.json document."""
    rubric = load_rubric()
    items = rubric_items(rubric)
    psha = prompt_sha()
    budget = vt.Budget(max_usd, max_deck_usd)
    system = prompt_text()
    if live:
        card = plan_cost(key, images, model, orders, max_usd, max_tokens, max_deck_usd)
        if card_id != card["id"]:
            raise BenchError(f"a live run needs the id on its cost card: --yes-cost {card['id']}\n{card['text']}")
    jobs = build_jobs(key, orders)

    def one(job):
        tok, order, qids, s = job
        png = (Path(images) / s["image"]).read_bytes()
        ck = call_key(s["image_sha"], rubric["version"], psha, model, qids, effort)
        base = {"order": order, "qids": qids, "call_key": ck}
        skip = lambda why: (tok, {**base, "answers": parse_reply("", qids), "usd": 0.0, "secs": 0.0, "source": "unjudgeable", "reason": why})
        if recordings and (Path(recordings) / f"{ck}.json").exists():
            rec = json.loads((Path(recordings) / f"{ck}.json").read_text())
            return tok, {**base, "answers": parse_reply(rec["reply"], qids), "usd": 0.0, "secs": 0.0, "source": "recorded"}
        if not live or transport is None:
            return skip("no recording and not --live")
        text = user_text(s["facts"], qids, items)
        deck = s.get("deck", "")
        res = budget.reserve(model, vt.estimate_input_tokens(png, len(system) + len(text)), max_tokens, deck)
        if res is None:
            return skip(budget.why)
        try:
            r = transport.call(system=system, user_text=text, image_png=png, model=model, max_tokens=max_tokens)
        except vt.NoCharge as e:   # nothing was sent: released, not booked
            budget.settle(res, 0.0, deck)
            return skip(f"call not sent: {e}")
        except Exception as e:   # sent, outcome unknown: it may have been billed, so the worst case is booked
            budget.settle(res, res, deck)
            return tok, {**base, "answers": parse_reply("", qids), "usd": res, "secs": 0.0, "source": "unjudgeable", "reason": f"call failed ({type(e).__name__}); worst case booked"}
        usd = vt.reply_usd(r, model, res)
        budget.settle(res, usd, deck)
        if r.stop:
            return tok, {**base, "answers": parse_reply("", qids), "usd": usd, "secs": r.secs, "source": "live", "reason": f"stopped: {r.stop}", "tokens": [r.tokens_in, r.tokens_out]}
        if record_to:
            Path(record_to).mkdir(parents=True, exist_ok=True)
            (Path(record_to) / f"{ck}.json").write_text(json.dumps({"call_key": ck, "slide_hash": s["hash"], "image_sha": s["image_sha"], "model": model, "effort": effort,
                                                                   "rubric_version": rubric["version"], "prompt_sha": psha, "qids": qids, "reply": r.text}, indent=1))
        return tok, {**base, "answers": parse_reply(r.text, qids), "usd": usd, "secs": r.secs, "source": "live", "tokens": [r.tokens_in, r.tokens_out]}

    results: dict = {}
    with ThreadPoolExecutor(max_workers=max(1, workers)) as ex:
        for tok, rec in ex.map(one, jobs):
            results.setdefault(tok, {})[str(rec["order"])] = rec
    env = key.get("environment", {})
    cfg = {"model": model, "width": key["width"], "effort": effort, "prompt_version": prompt_version(), "prompt_sha": psha,
           "rubric_version": rubric["version"], "orders": orders, "libreoffice": env.get("libreoffice"), "fonts": env.get("fonts")}
    cfg["primary"] = all(cfg[k] == v for k, v in PRIMARY.items())
    calls = [r for per in results.values() for r in per.values()]
    return {"config": cfg, "results": results, "usd": round(budget.spent, 4), "max_usd": max_usd, "max_deck_usd": max_deck_usd, "deck_usd": budget.group_spent(),
            "overruns": budget.overruns, "calls": sum(1 for r in calls if r["source"] == "live"),
            "replayed": sum(1 for r in calls if r["source"] == "recorded"), "unjudgeable_calls": sum(1 for r in calls if r["source"] == "unjudgeable")}


def recording_problems(directory: Path, fixture_hashes: set) -> list:
    """Every recording file that does not map to an invented fixture slide hash (the committed-recordings rule)."""
    bad = []
    for p in sorted(Path(directory).glob("*.json")) if Path(directory).exists() else []:
        try:
            h = json.loads(p.read_text()).get("slide_hash")
        except ValueError:
            h = None
        if h not in fixture_hashes:
            bad.append(p.name)
    return bad
