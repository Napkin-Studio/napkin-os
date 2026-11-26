"""napkin-deck: build a pitch deck from a prompt, documents, a brief, research, or any mix (ADR 0028).

    python3 -m deck.run_deck [--brief brief_object.json] [--research X.clan] [--prompt-text T | --prompt-file F] \
        [--doc KEY=PATH ...] --stages DIR \
        --client "Lumen Water" --project "National awareness campaign" --out DIR [--master agency.potx]

At least one of a prompt (``--prompt-text`` or ``--prompt-file``), a document (``--doc``), a brief or
research must be given; the run refuses otherwise. ``--answers FILE`` is the person's answers to the
intake questions (``{qid: {text|option_id, at, skipped?}}``).

``--stages DIR`` holds the recorded stage outputs (a0_intake.json, a_requirements.json, doc_facts.json,
b_storyline.json, c_territories.json, d_idea.json, fit.json). With ``--live`` the missing ones are produced
by the model stages (stages.py) and written there first; without it the run makes no model call.
Every run writes deck.json, validation.json, report.json (time, tokens and cost per stage,
slide count, coverage), deck.pptx, deck.pdf, slide PNGs and deck.html (the animated web deck).
``--kind agency|investor|tender|credentials`` picks the deck type (a profile, profiles/<id>.yaml: tender is profile
tender_response); without it the person's answer to the question q_deck_type decides, and a skipped or missing answer
means agency_pitch, recorded in ``meta.built_from.profile``. ``--format full`` keeps every slide in the story (default ``pitch``: at most 18 presented, then an
appendix); ``--audience client`` renders for the room (agency notes dropped, leaks fail the gate);
``--animate auto|click`` adds native PowerPoint animations; ``--hyperframes`` also writes a
HyperFrames slideshow project (``--builds`` for one click per block).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from . import assemble, export_clean, from_production, imagegen, images, inputs, intake, look, profiles, qa_render, render_hyperframes, render_pptx, render_web, repair, spec, validate
from . import theme as themes

#: Stage a0 (intake) comes first: it fills the brief fields the brief does not supply.
STAGE_FILES = {"a0": "a0_intake.json", "a": "a_requirements.json", "b": "b_storyline.json", "c": "c_territories.json", "d": "d_idea.json"}
#: An investor deck's story is one stage.
INVESTOR_STAGE_FILES = {"a0": "a0_intake.json", "i": "i_investor.json"}
#: Where ``--until`` may stop: after a stage, or after ``deck`` (the deck assembled and validated, before any file is rendered).
UNTIL_CHOICES = ("a0", "a", "b", "c", "d", "i", "deck")


#: Test seams for the repair loop's rounds (None: the real renderer, converter and QA). ``render_seam(deck, folder, findings)`` returns
#: ``{pptx, pic_findings, placed}``, ``pdf_seam(pptx, folder)`` a PDF path or None, ``qa_seam(pptx, pdf, folder, findings)`` a qa dict.
render_seam = pdf_seam = qa_seam = None


def _close(a, rep: dict, t0: float) -> dict:
    """Price the stages, total the cost and write report.json: the end of a run, whole or stopped at ``--until``."""
    rep["wall_secs"] = round(time.time() - t0, 1)
    rep["stages"] = {k: _price_stage(v or {}) for k, v in rep["stages"].items()}   # the CLI transport reports tokens, not dollars
    rep["usd_total"] = round(sum((v or {}).get("usd", 0) or 0 for v in rep["stages"].values()), 4)
    if any(v.get("usd_estimated") for v in rep["stages"].values()):
        rep["usd_basis"] = spec.USD_BASIS
    (a.out / "report.json").write_text(json.dumps(rep, indent=1, ensure_ascii=False))
    return rep


#: A client build whose checks fail writes nothing (``_withheld``). The suite sets this False (tests/conftest.py): many tests read the files of a client
#: render of the invented fixtures, which carry unresolved placeholders and so always fail the gate. tests/test_design_fixes.py sets it back to True.
WITHHOLD_FAILING_CLIENT = True


def _withheld(a, rep: dict, deck: dict, findings: list, t0: float) -> dict:
    """A client build whose checks fail: no deck.pptx, deck.html, PDF or PNG is written (and none an earlier build left stays), and report.json says why.
    A client slide never carries a check id; the person reads the reason here and in validation.json. A review render keeps its marks."""
    bad = [f for f in findings if f["level"] == "error"]
    for name in ("deck.pptx", "deck.html", "deck.pdf", "layouts.json"):
        (a.out / name).unlink(missing_ok=True)
    images.wipe_outputs(a.out)
    checks = sorted({f["check"] for f in bad})
    rep["withheld"] = {"reason": f"withheld: the client file was not written because {len(bad)} check{'s' if len(bad) != 1 else ''} failed ({', '.join(checks)}); "
                                 "fix them, or build the review file to see them", "errors": len(bad), "checks": checks,
                       "slides": sorted({f["slide"] for f in bad if f.get("slide")})}
    rep["slides"] = len(deck["order"])
    rep["slides_by_status"] = {s: sum(1 for x in deck["slides"].values() if x["status"] == s) for s in ("from_source", "drafted", "needs_human")}
    _close(a, rep, t0)
    print(json.dumps({"withheld": rep["withheld"], "slides": rep["slides"], "wall_secs": rep["wall_secs"]}, indent=1))
    return rep


def _stopped(a, rep: dict, t0: float, at: str) -> dict:
    """A run stopped by ``--until``: nothing past ``at`` ran or was written. The stage outputs are in --stages, so a later run carries on from them."""
    rep["until"] = at
    _close(a, rep, t0)
    print(json.dumps({"until": at, "usd_total": rep["usd_total"], "wall_secs": rep["wall_secs"]}, indent=1))
    return rep


def _soffice() -> str:
    """The LibreOffice binary on this machine (Linux VM or macOS app)."""
    for c in ("soffice", "/Applications/LibreOffice.app/Contents/MacOS/soffice"):
        if shutil.which(c) or Path(c).exists():
            return c
    raise RuntimeError("LibreOffice not found: the PDF cannot be made")


FONTS_DIR = Path(__file__).resolve().parent / "fonts"
#: The vendored STATIC faces' PostScript names, by the family the pptx names (deck/fonts/*/static). A LOOK_V3 PDF must embed these and only
#: these for its Archivo and Source Sans 3 text: a substitute (Arial, Carlito, Liberation) means the fonts were not found, and any other
#: Archivo / SourceSans3 name (ArchivoRoman-*, SourceSans3-Roman, SourceSans3-ExtraLight, Archivo-SemiBold) is a variable font's instance,
#: the hairline-weight bug of phase 12.
STATIC_FACES = {"Archivo": frozenset({"Archivo-Regular", "Archivo-Bold", "Archivo-Italic", "Archivo-BoldItalic"}),
                "Source Sans 3": frozenset({"SourceSans3-Regular", "SourceSans3-Bold", "SourceSans3-It", "SourceSans3-BoldIt"})}
_PS_PREFIX = {"Archivo": "Archivo", "Source Sans 3": "SourceSans3"}
FONT_FIX = ("install the deck's static fonts once with scripts/install-deck-fonts.sh (it copies engine/deck/fonts/*/static/*.ttf into your "
            "user font folder), and remove any variable Archivo or Source Sans 3 (a file named with [wght]) from your font folders")


class FontsNotEmbedded(Exception):
    """A LOOK_V3 PDF set in a substitute or a variable instance instead of the vendored static faces. Not a RuntimeError on purpose: a caller
    that treats a failed conversion as "no PDF this round" must not swallow it; the build stops and says how to fix the machine."""


def _load_vendored_fonts(profile: str) -> dict:
    """Point LibreOffice at the vendored OFL fonts' STATIC faces (deck/fonts/*/static), never the variable files: LibreOffice and PowerPoint
    draw a variable font at its default instance, and Source Sans 3's default is ExtraLight (wght 200), a faint hairline.

    LibreOffice does not reliably read a private profile's ``user/fonts`` (7.4 on macOS ignores it), so that copy alone is not trusted. On Linux
    LibreOffice finds fonts through fontconfig, and fontconfig's documented ``FONTCONFIG_FILE`` points it at a config that includes the
    system one plus the vendored static folders: no system install is needed there. macOS LibreOffice uses CoreText, which reads only the
    installed fonts, so on a Mac the static faces must be installed (scripts/install-deck-fonts.sh). Either way ``check_pdf_fonts`` is the
    proof: it fails the render unless the static faces were embedded. Returns the environment for the soffice call."""
    env = dict(os.environ)
    static = sorted({str(f.parent) for f in FONTS_DIR.glob("*/static/*.ttf")})
    dest = Path(profile) / "user" / "fonts"
    dest.mkdir(parents=True, exist_ok=True)
    for f in FONTS_DIR.glob("*/static/*.ttf"):
        shutil.copy2(f, dest / f.name)
    if sys.platform != "darwin":
        conf = Path(profile) / "fonts.conf"
        dirs = "".join(f"<dir>{d}</dir>" for d in static)
        conf.write_text('<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig>'
                        f'<include ignore_missing="yes">/etc/fonts/fonts.conf</include>{dirs}<cachedir>{Path(profile) / "fc-cache"}</cachedir>'
                        '</fontconfig>')
        env["FONTCONFIG_FILE"] = str(conf)
    return env


_RUN = re.compile(r"<a:r>(.*?)</a:r>", re.S)


def named_families(pptx) -> set:
    """The look's families (Archivo, Source Sans 3) that a run with words names in the pptx's slides."""
    import zipfile   # noqa: PLC0415
    out = set()
    with zipfile.ZipFile(pptx) as z:
        for n in z.namelist():
            if not re.match(r"ppt/slides/slide\d+\.xml$", n):
                continue
            for run in _RUN.findall(z.read(n).decode("utf-8", "replace")):
                if not re.search(r"<a:t>[^<]*\S[^<]*</a:t>", run):
                    continue
                out.update(fam for fam in STATIC_FACES if f'typeface="{fam}"' in run)
    return out


def pdf_fonts(pdf) -> list:
    """``[(PostScript name without the subset tag, embedded)]`` from poppler's ``pdffonts``."""
    exe = shutil.which("pdffonts") or ("/opt/homebrew/bin/pdffonts" if Path("/opt/homebrew/bin/pdffonts").exists() else None)
    if not exe:
        raise FontsNotEmbedded("pdffonts (poppler) is not installed, so the LOOK_V3 PDF's fonts cannot be checked; install poppler "
                               "(brew install poppler, apt install poppler-utils)")
    out = subprocess.run([exe, str(pdf)], check=True, capture_output=True, text=True, timeout=60).stdout.splitlines()
    rows = []
    for line in out[2:]:
        parts = line.split()
        if len(parts) < 5:
            continue
        # name type [type word] encoding emb sub uni id gen: emb is the fifth column from the end
        rows.append((re.sub(r"^[A-Z]{6}\+", "", parts[0]), parts[-5] == "yes"))
    return rows


def check_pdf_fonts(pptx, pdf) -> dict:
    """Under LOOK_V3: every family the pptx names (Archivo, Source Sans 3) must reach the PDF as its vendored static faces, embedded, and no
    Archivo / SourceSans3 face outside the static set (a variable instance) may appear. Raises FontsNotEmbedded naming the one-command fix.
    Returns ``{"named": [...], "embedded": [...]}``."""
    named = named_families(pptx)
    rows = pdf_fonts(pdf)
    problems = []
    for fam in sorted(named):
        prefix, ok = _PS_PREFIX[fam], STATIC_FACES[fam]
        faces = [(n, e) for n, e in rows if n.startswith(prefix)]
        if not any(n in ok and e for n, e in faces):
            problems.append(f"{fam} is named in the deck but no static {fam} face is embedded in the PDF (LibreOffice substituted it)")
    for n, e in rows:
        fam = next((f for f, p in _PS_PREFIX.items() if n.startswith(p)), None)
        if fam and n not in STATIC_FACES[fam]:
            problems.append(f"{n} is a variable font's instance, not a static face (the hairline-weight bug)")
        elif fam and not e:
            problems.append(f"{n} is used but not embedded")
    if problems:
        raise FontsNotEmbedded(f"{Path(pdf).name}: " + "; ".join(problems) + f". Fix: {FONT_FIX}.")
    return {"named": sorted(named), "embedded": sorted({n for n, e in rows if e})}


def web_render() -> bool:
    """deck-cloud: NAPKIN_DECK_RENDER=web. The cloud image has no LibreOffice or poppler: the build writes deck.pptx (python-pptx) and deck.html
    and skips only the LibreOffice PDF, the page PNGs and the PDF-based visual QA (so no repair loop). The PDF is printed from deck.html by the web host."""
    return os.environ.get("NAPKIN_DECK_RENDER", "").strip().lower() == "web"


#: What report.qa says when the PowerPoint was not drawn and looked at (web render mode).
NO_PPTX_CHECK = "The PowerPoint was not visually checked here (no LibreOffice in this environment): the web deck and the PDF fit their text in the browser."


def to_pdf(pptx, outdir, timeout: int = 180):
    """Convert a pptx to PDF with LibreOffice, in a private profile (``-env:UserInstallation``) that is removed afterwards.
    Two soffice processes that share a profile hand the second job to the first and exit 0 with no PDF, so every call gets its own.
    Under LOOK_V3 the vendored static fonts are offered to LibreOffice and the PDF is then checked with ``pdffonts``: a substitute or a
    variable instance raises FontsNotEmbedded (the gate and every LOOK_V3 render fail rather than ship the wrong type)."""
    profile = tempfile.mkdtemp(prefix="deck_lo_")
    try:
        env = _load_vendored_fonts(profile) if spec.LOOK_V3 else None
        done = subprocess.run([_soffice(), f"-env:UserInstallation=file://{profile}", "--headless", "--convert-to", "pdf", "--outdir", str(outdir), str(pptx)],
                              check=True, capture_output=True, timeout=timeout, env=env)
    finally:
        shutil.rmtree(profile, ignore_errors=True)
    if spec.LOOK_V3 and pptx and outdir:   # a test seam may pass no pptx: nothing was rendered, so nothing to check
        pdf = Path(outdir) / (Path(pptx).stem + ".pdf")
        if pdf.exists():
            check_pdf_fonts(pptx, pdf)
    return done


def _recipe_prefs(profile: dict, fmt: str) -> dict:
    """deck-types: what the layout plan takes from the type's recipe (profiles.recipe): ``{prefer, prefer_type}`` (when the recipe prefers a layout
    the catalogue can draw) and ``{roles, windows}`` (its density), only with spec.RECIPES and spec.LOOK_V3 on; ``{}`` otherwise, so the plan's
    prefs are today's byte for byte."""
    if not profiles.recipes_on():
        return {}
    r = profiles.recipe(profile, fmt)
    out = {"prefer": r["layouts"], "prefer_type": r["type"]} if r["layouts"] else {}
    return {**out, "roles": r["density"]["roles"], "windows": r["density"]["windows"]}   # slice 4: the type's density roles and word windows


def _recorded_stages(stages: Path) -> set:
    """The model stages already recorded in a stages folder (their files exist): what a type change can reuse for free."""
    files = {**STAGE_FILES, **INVESTOR_STAGE_FILES}
    return {k for k, fn in files.items() if (stages / fn).exists()}


def _type_change(a, profile: dict) -> dict:
    """deck-types slice 6 (design.precedence.changing_later): what building as ``profile`` costs from what --stages holds. Free (every stage the
    type runs is recorded): code only, seconds. Otherwise a deck built before (some model stage recorded) changing type needs new writing: with
    --live it is refused before any call unless the person confirmed (--confirm-stages), naming the stages; without --live the missing stages
    are reported as today. A first build (nothing recorded) is not a change. Pictures are never part of it: a type change plans no picture job
    of its own, and a made or approved picture keeps its record."""
    recorded = _recorded_stages(a.stages)
    tc = profiles.type_change(profile, recorded)
    out = {"free": tc["free"], "needs": tc["needs"], "recorded": sorted(recorded)}
    model = recorded - set(profiles.CHANGE_OPTIONAL)
    if tc["needs"] and model:
        out["line"] = profiles.change_sheet(None, profile, recorded)["line"]
        if a.live and not a.confirm_stages and not getattr(a, "same_type", False):
            raise SystemExit(f"refused: {profiles.NeedsStages(profile['id'], tc['needs'])}")
    return out


def _protect_boxes(a, deck: dict) -> dict:
    """deck-slide-size: asset id -> the protect boxes (``keep``) of each Production picture the deck binds (stages/production.json), so a re-crop
    at 4:3 or A4 that cuts them is a finding. Empty without a Production file."""
    pf = a.stages / "production.json"
    if not pf.is_file():
        return {}
    try:
        items = (json.loads(pf.read_text()) or {}).get("items") or {}
    except (OSError, ValueError):
        return {}
    used = {(sl.get("image") or {}).get("asset") for s in deck["slides"].values() for sl in (s.get("slots") or {}).values() if isinstance(sl, dict)}
    out = {}
    for it in items.values():
        aid = "img_" + str(it.get("sha256") or "")[:12]
        if it.get("keep") and aid in used:
            out[aid] = it["keep"]
    return out


def _explicit_size(a, deck_ctx, answers: dict | None = None) -> str | None:
    """The size a person asked for: --size > the Deck document's look.size.canvas > their answer to the intake's size card (not a skip)."""
    lk = (deck_ctx.get("look") if isinstance(deck_ctx, dict) else None) or {}
    dsz = lk.get("size")
    dsz = dsz.get("canvas") if isinstance(dsz, dict) else dsz
    dsz = dsz if dsz in spec.SLIDE_SIZES else None
    ans = (answers or {}).get(intake.SIZE_QUESTION_ID) or {}
    asz = ans.get("option_id") if isinstance(ans, dict) and not ans.get("skipped") else None
    return a.size or dsz or (asz if asz in spec.SLIDE_SIZES else None)


def _master_size(a, explicit: str | None) -> str | None:
    """deck-slide-size: a --master's own size (one of spec.SLIDE_SIZES), None without a master. Refused (SystemExit) when the master is none of
    the three (the renderer never draws a geometry other than the slide's) or when a size was asked that differs from it (a master fixes its
    own size and is never converted). run_deck calls it right after reading the inputs, before any paid stage."""
    if not a.master:
        return None
    from pptx import Presentation   # noqa: PLC0415
    m = Presentation(str(a.master))
    msz = themes.size_by_emu(int(m.slide_width), int(m.slide_height))
    w_, h_ = int(m.slide_width) / 914400, int(m.slide_height) / 914400
    if msz is None:
        raise SystemExit(f"refused: the master {Path(a.master).name} is {w_:.2f} x {h_:.2f} in, none of the slide sizes the deck draws "
                         f"({', '.join(spec.SLIDE_SIZES)}): use a master of one of those sizes")
    if explicit and msz != explicit:
        raise SystemExit(f"refused: the master {Path(a.master).name} is {msz} and the size asked is {explicit}: a master fixes its own slide size "
                         "and is never converted. Drop the size (the master's is used) or use a master of that size")
    return msz


def _resolve_size(a, deck: dict, deck_ctx, rec: dict | None, answers: dict | None = None) -> str:
    """deck-slide-size: the deck's slide size, stamped once (``deck.meta.preferences.size``, the one place every reader takes it from) before the
    pictures and the plan. Precedence: the person's (``_explicit_size``) > a .potx master's own size (always over the recipe, 16:9 too) > the
    recipe's (deck-types slice 8: a tender and the read format default to A4; only with the recipes on) > 16:9. Nothing is stamped when
    nobody gave a size and the result is 16:9, so a 16:9 deck is today's. Returns the size name."""
    explicit = _explicit_size(a, deck_ctx, answers)
    msz = _master_size(a, explicit)
    if explicit:
        name, source = explicit, "person"
    elif msz:   # a master's own size wins over a recipe's, whatever it is
        if msz == spec.SIZE_DEFAULT:
            return spec.SIZE_DEFAULT
        name, source = msz, "master"
    elif rec and rec.get("size") and rec["size"] != spec.SIZE_DEFAULT:
        name, source = rec["size"], "recipe"
    else:
        return spec.SIZE_DEFAULT
    deck["meta"].setdefault("preferences", {})["size"] = {"canvas": name, "source": source}
    return name


def _stamp_type(deck: dict, profile: dict, choice: dict, fmt: str | None = None) -> None:
    """Record the deck type in the deck: ``meta.built_from.type`` (the profile id) and ``.profile`` (id,
    label, how it was chosen and why), and ``meta.profile`` when the person was asked (answered or skipped)
    or the type is not a legacy one. A plain default agency or investor deck stays as it always was."""
    rec = {"id": profile["id"], "label": profile["label"], "source": choice["source"], "note": choice["note"]}
    if choice.get("evidence"):   # deck-types: an inferred type carries the words it was read from (Review quotes them, with Change)
        rec["evidence"] = list(choice["evidence"])
    if fmt and profiles.recipes_on():   # deck-types: the format the recipe was resolved for
        rec["format"] = fmt
    deck["meta"]["built_from"] = {**deck["meta"]["built_from"], "type": profile["id"], "profile": rec}
    if profile["arrange"] == "spine" or choice["source"] in ("answer", "skipped", "pick", "inferred"):
        deck["meta"]["profile"] = rec


def _replay_agency(a, ctx: dict, rep_look: dict) -> tuple[dict | None, bool]:
    """The agency look this build uses, and whether the deck opted out. A deck keeps the look it was built with: the first build with an
    agency look copies the --agency-look JSON into the run folder (``look.json``) and every later build replays that copy, so a recorded run
    replays byte for byte and the agency's changes never re-dress a deck on their own. A deck built before there was an agency look (a
    ``deck.json`` already in the run folder and no ``look.json``) keeps its look too. ``--update-look`` (the person's "update to current
    look") takes the current look and records it. Returns (agency JSON or None, use)."""
    lp = (ctx.get("look") or {}).get("agency_look") or {} if ctx else {}
    use = not (a.no_agency_look or lp.get("use") is False)
    current = json.loads(a.agency_look.expanduser().read_text()) if a.agency_look else None
    rec_path = a.out / "look.json"
    raw = json.loads(rec_path.read_text()) if rec_path.exists() else None
    recorded = ({"agency": raw["agency"], "applied_at": raw.get("applied_at") or ""} if raw and "agency" in raw
                else {"agency": raw, "applied_at": ""} if raw else None)   # a copy made before applied_at existed is the bare look
    # An update is a person's request, kept in the document: it counts only while it is newer than the look last applied, so it never re-reads
    # the agency's look on every later build. --update-look is the request made now.
    asked = str(lp.get("update_requested") or "")
    update = bool(a.update_look or (asked and (recorded is None or asked > recorded["applied_at"])))
    if recorded and not update:
        if current and current.get("rev") != recorded["agency"].get("rev"):
            rep_look["notice"] = (f"Your agency's look changed since this deck was built (rev {recorded['agency'].get('rev')} to {current.get('rev')}). This deck keeps the look it "
                                  "has; choose 'update to current look' to take the new one.")
        return recorded["agency"], use
    if not recorded and (a.out / "deck.json").exists() and not update:
        if current:
            rep_look["notice"] = "This deck was built before your agency's look was set up and keeps its look. Choose 'update to current look' to dress it."
        return None, use
    if current:
        import datetime   # noqa: PLC0415
        rec_path.write_text(json.dumps({"agency": current, "applied_at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")},
                                       indent=1, ensure_ascii=False))
    return current, use


def _strict_default(profile: dict, fmt: str, style, kit) -> bool:
    """deck-types slice 4: the recipe's brand strictness, the default of the strict_brand preference. It applies only when an agency Style Pack
    or a Brand Clan is attached (design: 'on when an agency pack is present'): with neither there is no kit to be strict to, and strict mode would
    only take the agency look away. A person's own strict_brand choice (look.strict_brand, --strict-brand) always wins."""
    has_pack = style is not None and getattr(style, "source", "") != "built-in default"
    return bool(profiles.recipe(profile, fmt)["brand"]["strict"]) and (has_pack or look._present(look.brand_tokens(kit)))


def _stamp_look(a, deck: dict, brand: dict | None, rep: dict, ctx: dict | None = None, profile: dict | None = None) -> None:
    """Resolve the deck's look (look.py) and stamp it: ``meta.brand`` (what the renderers read), ``meta.theme`` (what a reader sees) and the
    client's logo as a deck asset. With no --style, no agency look and no --brand nothing is written, so today's decks and every golden are
    unchanged. A Style Pack that cannot be used is never skipped silently: ``meta.style_hold`` and the report say so."""
    ctx = ctx or {}
    client = deck["meta"].get("client") or a.client
    style, pack_src = None, a.style or ctx.get("pack")
    if pack_src:
        from visuals import style as vstyle   # noqa: PLC0415 (a sibling package of engine/deck, imported only when a pack is given)
        try:
            if isinstance(pack_src, tuple) and not ((pack_src[0].get("kit") or {}).get("published")):
                raise vstyle.StyleError("the attached Style Pack's version is not published (kit.published is empty): a steward publishes it before a deck uses it")
            style = vstyle.load(*pack_src, forbid=[client]) if isinstance(pack_src, tuple) else vstyle.load(pack_src, forbid=[client])
        except (vstyle.StyleError, OSError) as e:   # a pack that breaks its rules is not used, and pictures are held until it is fixed
            rep["style_pack"] = {"used": False, "hold": True, "error": str(e)}
            deck["meta"]["style_hold"] = {"reason": str(e), "pack": Path(str(a.style)).name if a.style else "attached Style Pack"}
        else:
            rep["style_pack"] = {"used": True, "hash": style.hash, "warnings": style.warnings, "sent_references": [r.name for r in style.references],
                                 "withheld_references": style.withheld}
    look_rep: dict = {}
    agency, use = _replay_agency(a, ctx, look_rep)
    lp = ctx.get("look") or {}
    wears = (lp.get("brand") or {}).get("wears") or a.wears if ctx else a.wears
    wears_problem = None
    if wears not in look.WEARS:   # an unknown value never crashes a build: the default stands and the problem is said
        wears_problem = f"look.brand.wears {wears!r} is not one of {', '.join(look.WEARS)}: the deck wears the agency"
        wears = "agency"
    strict = bool(lp.get("strict_brand")) or a.strict_brand
    if profile and profiles.recipes_on() and "strict_brand" not in lp and not a.strict_brand:
        strict = _strict_default(profile, a.format, style, ctx.get("brand"))   # deck-types slice 4: the type's default (person > recipe)
    got = look.resolve(wears=wears, strict_brand=strict, brand_file=brand, brand=look.brand_tokens(ctx.get("brand")), style=style,
                       agency=agency, use_agency=use, client=client)
    if got.brand:
        deck["meta"]["brand"] = got.brand
    if wears_problem:
        look_rep.setdefault("problems", []).append(wears_problem)
        if got.theme:
            got.theme["problems"].append(wears_problem)
    if got.theme:
        if got.logo:
            try:
                aid, rec = look.make_logo_asset(got.logo, a.out / "assets")
                deck.setdefault("assets", {})[aid] = rec
                got.theme["logo"] = {"asset": aid, "placement": got.logo["placement"]}
            except look.LogoError as e:
                note = f"The client's logo could not be placed: {e}"
                got.theme.setdefault("held", []).append(note)
                got.theme["problems"].append(note)
        deck["meta"]["theme"] = got.theme
        look_rep.update(source=got.theme["source"], problems=got.theme["problems"], derived=got.theme["derived"], held=got.theme.get("held", []))
    if agency or look_rep.get("notice"):
        deck["meta"].setdefault("preferences", {})["agency_look"] = {"use": use, "source": "person" if (a.no_agency_look or ((ctx.get("look") or {}).get("agency_look") or {}).get("by")) else "default"}
    if look_rep:
        rep["look"] = look_rep


def _stamp_pinned(a, deck: dict, deck_ctx: dict | None) -> set:
    """Stamp ``deck.slides.<id>.pinned`` from the person's review (``--review FILE``, or the document's ``review``): a pinned slide is left alone by the
    plan's fixes and by the repair loop. Models never write it. Returns the pinned slide ids (none when there is no review)."""
    review = {}
    if a.review and a.review.exists():
        raw = json.loads(a.review.read_text())
        review = raw.get("review", raw) if isinstance(raw, dict) else {}
    elif (deck_ctx or {}).get("review"):
        review = deck_ctx["review"]
    out = {sid for sid in (review.get("pinned") or {}) if sid in deck["slides"]}
    for sid in sorted(out):
        deck["slides"][sid]["pinned"] = True
    return out


def _repair(a, inp, profile: dict, deck: dict, findings: list, qa: dict, pics, placed: set, rep: dict, base_deck: dict, pinned: set, swaps: dict, level, tm, policy: dict, pptx):
    """The repair loop (repair.py) on the finished build: round 0 is what was just written into ``a.out``. Writes issues.json always (the loop is on), and
    when a round ran: repair.json, repair_record.json, out/repair/ (the base deck, every round's folder, round 0's files) and the report's repair section;
    when a round was kept, the kept round's files become the deck's (deck.json, validation.json, qa.json, layouts.json, deck.pptx, deck.pdf) and the web deck, the
    PNGs and the HyperFrames project are made again from it. Returns the deck, findings and placed set the run ends with."""
    from . import layouts, stages
    out = a.out
    if not (out / "deck.pptx").exists():   # nothing was rendered (a renderer stubbed out): the loop never starts
        return deck, findings, placed

    def render_fn(d, folder, f):
        if render_seam:
            got = render_seam(d, folder, f)
        else:
            pic_f, pl, ic = [], set(), {}
            render_pptx.render(d, inp, folder / "deck.pptx", a.master, f, animate=a.animate or False, layouts_out=folder / "layouts.json", pictures=pics, picture_findings=pic_f,
                               placed=pl, notes=not a.no_notes, no_plan=a.no_layout_plan, icons=ic, clean=a.clean_export,
                               protect=_protect_boxes(a, d) if themes.size_of(d) != spec.SIZE_DEFAULT else None)   # deck-slide-size: as the first render
            got = {"pptx": folder / "deck.pptx", "pic_findings": pic_f, "placed": pl, "icons": ic}
        return {**got, "pptx": got["pptx"] if got.get("pptx") and Path(got["pptx"]).exists() else None}

    def pdf_fn(p, folder):
        if pdf_seam:
            return pdf_seam(p, folder)
        try:
            to_pdf(p, folder)
        except (subprocess.SubprocessError, RuntimeError, OSError):   # no PDF for this round: it loses its pixels, so the gate cannot keep it
            return None
        return folder / "deck.pdf" if (folder / "deck.pdf").exists() else None

    def qa_fn(p, pdf, folder, f):
        return (qa_seam or qa_render.run)(p, pdf, folder, f)

    def call_fn(request):
        return stages.repair_copy(deck, inp, profile, request)

    def spent() -> float:
        return sum((_price_stage(v or {}).get("usd") or 0) for v in rep["stages"].values())

    record = None
    for p in (a.stages / "repair_record.json", out / "repair_record.json"):
        if not p.exists():
            continue
        try:
            got = json.loads(p.read_text())
        except ValueError:
            continue
        if p.parent == a.stages or got.get("stages") == str(a.stages.resolve()):   # out/'s record is used only when it was written for these --stages
            record = got
            break
    ctx = {"inp": inp, "audience": a.audience, "clean": a.clean_export, "policy": policy, "library": layouts.load(), "prefs": {"density": level, "text_mode": tm, "notes": not a.no_notes, **_recipe_prefs(profile, a.format)}, "swaps": swaps, "base_deck": base_deck,
           "pinned": pinned, "out": out, "stages": a.stages, "live": a.live, "approve_shorten": a.approve_shorten, "call_fn": call_fn, "spent": spent,
           "run_cap": repair.run_cap(), "shorten_ledger": _shorten_ledger(a, inp, deck), "record": record, "render_fn": render_fn, "pdf_fn": pdf_fn, "qa_fn": qa_fn}
    iss0 = repair.I.derive(findings, qa, deck, policy, 0)
    (out / "issues.json").write_text(json.dumps(iss0, indent=1, ensure_ascii=False))
    if not policy["max_rounds"] or not [i for i in iss0 if i["severity"] in policy["repair_on"] and i["source"] != "critic"]:
        return deck, findings, placed   # max_rounds 0 still writes issues.json, and a clean deck runs no round
    shutil.rmtree(out / "repair", ignore_errors=True)
    t = time.time()
    m0 = repair.existing(deck, findings, qa, out, ctx)
    if not m0["ok"]:   # the QA could not be read: lost coverage, so no round (S6)
        return deck, findings, placed
    res = repair.run(ctx, m0)
    if not res["ran"] and not res["skipped"]:
        return deck, findings, placed
    (out / "repair").mkdir(exist_ok=True)
    (out / "repair" / "base_deck.json").write_text(json.dumps(base_deck, indent=1, ensure_ascii=False, default=str))
    final = res["final"]
    n = res["final_round"]
    if res["ran"] and n:   # a kept round: its files become the deck's; round 0's go to out/repair/round-0
        r0 = out / "repair" / "round-0"
        r0.mkdir(parents=True, exist_ok=True)
        for name in ("deck.json", "validation.json", "qa.json", "layouts.json", "deck.pptx", "deck.pdf", "issues.json"):
            if (out / name).exists():
                shutil.copyfile(out / name, r0 / name)
        folder = final["folder"]
        for name in ("deck.json", "validation.json", "qa.json", "layouts.json", "deck.pptx", "deck.pdf"):
            if (folder / name).exists():
                shutil.copyfile(folder / name, out / name)
            elif name == "deck.pdf":
                (out / name).unlink(missing_ok=True)
        deck, findings, placed = final["deck"], final["findings"], (final.get("placed") or placed)
        rep["validation"] = validate.summary(findings)
        render_web.render(deck, inp, out / "deck.html", findings, pictures=pics, placed=placed if pics else None, look=not a.no_layout_plan,
                          icons=final.get("icons"), clean=a.clean_export)
        if a.hyperframes:
            render_hyperframes.render(deck, inp, out / "hyperframes", findings, builds=a.builds, pictures=pics, placed=placed if pics else None, look=not a.no_layout_plan)
        if (out / "deck.pdf").exists():
            (out / "png").mkdir(exist_ok=True)
            subprocess.run(["pdftoppm", "-png", "-r", "60", str(out / "deck.pdf"), str(out / "png" / "slide")], check=False)
        rep["qa"] = _qa_line(final["qa"]["summary"], len(deck["order"])) if (final.get("qa") or {}).get("summary") else rep.get("qa")
    elif res["ran"]:   # nothing kept: the deck stays as built, with the policy stamped (a round ran) and its checks re-stamped
        deck["meta"]["repair_policy"] = policy
        (out / "deck.json").write_text(json.dumps(deck, indent=1, ensure_ascii=False, default=str))
        repair.stamp_qa(out, qa)
    (out / "issues.json").write_text(json.dumps(res["issues"], indent=1, ensure_ascii=False))
    (out / "repair.json").write_text(json.dumps(res["repair"], indent=1, ensure_ascii=False))
    rec_dir = a.stages if a.live else out
    rec_dir.mkdir(parents=True, exist_ok=True)
    (rec_dir / "repair_record.json").write_text(json.dumps({**res["record"], "stages": str(a.stages.resolve())}, indent=1, ensure_ascii=False))
    for k, row in res["stage_rows"].items():
        rep["stages"][k] = row
    rep["repair"] = {"policy_sha": res["repair"]["policy_sha"], "rounds": [{**x, "seconds": round(s, 1)} for x, s in zip(res["rounds"], res.get("secs") or [0] * len(res["rounds"]))],
                     "stopped": res["stopped"], "skipped": res["skipped"], "left_for_person": res["left"], "usd": round(res["usd"], 4)}
    if res["replayed"]:
        rep["repair"]["replayed"] = True
    rep["stages"]["repair"] = {"secs": round(time.time() - t, 2), "model": None, "usd": 0}
    kept = sum(1 for x in res["rounds"] if x["kept"])
    fixed = sum(1 for i in res["issues"] if i["status"] == "fixed")
    print(f"Repair: {len(res['rounds'])} round(s), {kept} kept, {fixed} fixed, {len(res['left'])} left for you, {res['usd']:.2f} USD" + (" (replayed)" if res["replayed"] else ""))
    return deck, findings, placed


def _qa_line(summary: dict, n_slides: int) -> str:
    """The stage h line for the report: the summary's counts, said against the slides that were checked. The summary's own
    line counts only the slides it flagged ('on 0 slides' for a clean deck), which reads as if nothing was checked."""
    line = str(summary.get("line", ""))
    tail = line[line.index(" ("):] if " (" in line else ""   # the by-check counts, as the summary wrote them
    return (f"QA: {summary.get('errors', 0)} errors, {summary.get('warnings', 0)} warnings on {n_slides} slides checked "
            f"({summary.get('slides_flagged', 0)} flagged)" + tail)


def _price_stage(row: dict) -> dict:
    """A stage's report row with its dollars filled in. A ``usd`` the transport reported is kept as it is. Otherwise, where
    the row names a model and holds tokens (``prompt_tokens``/``completion_tokens``, or ``tokens_in``/``tokens_out``), usd is
    an ESTIMATE from the price table (spec.estimate_usd) and ``usd_estimated`` says so. Rows with no tokens stay at 0."""
    if row.get("usd") or not row.get("model"):
        return row
    tin = row.get("prompt_tokens") or row.get("tokens_in") or 0
    tout = row.get("completion_tokens") or row.get("tokens_out") or 0
    usd = spec.estimate_usd(row["model"], tin, tout, row.get("cache_read_tokens") or 0, row.get("cache_creation_tokens") or 0)
    return {**row, "usd": usd, "usd_estimated": True} if usd else row


def _needs_intake(inp) -> bool:
    """True when stage a0 has something to do: a brief field the brief leaves empty, and a prompt,
    a document or research to read it from. A complete brief runs no intake call."""
    return bool(intake.gap_report(inp)["brief_fields"]) and bool(inp.prompt_text.strip() or inp.docs or inp.has_research())


def _slug(name: str) -> str:
    """A criterion's file stem: lower-case words joined by ``_``, for ``d_<criterion>.json``. A name whose stem is over 40 characters
    is cut to 32 and given an 8-character hash of the whole stem, so two long names that share their first 40 characters never share a file;
    a stem of 40 or fewer is unchanged (recorded files keep their names)."""
    full = re.sub(r"[^a-z0-9]+", "_", str(name).lower()).strip("_")
    if len(full) <= 40:
        return full or "criterion"
    return full[:31].rstrip("_") + "_" + hashlib.sha1(full.encode()).hexdigest()[:8]


def _criterion_answers(a, inp, st: dict, profile: dict, rep: dict) -> None:
    """The per-criterion answer step (a deck type whose spine holds ``criterion_answer``: the tender response): for each scored
    criterion of stage a, with its word budget from its weight (assemble.criterion_budgets), read the recorded ``d_<criterion>.json``;
    with none recorded and no --live that criterion is skipped quietly (``skipped: no recorded output``), so every older stage directory
    rebuilds as before. With --live one call (stages.criterion_answer) is made and recorded first. The answers go to ``st['d_criteria']``,
    where the assembler derives the deck's answer slides from them; the report row says which were recorded, live or skipped."""
    scoring = (st.get("a") or {}).get("scoring") or []
    if "criterion_answer" not in profile["spine"] or not scoring or not profiles.runs(profile, "d"):
        return
    budgets = assemble.criterion_budgets(scoring)
    answers, rows, usages = [], {}, []
    for c in scoring:
        name = str(c.get("criterion") or "")
        if not name:
            continue
        p = a.stages / f"d_{_slug(name)}.json"
        if p.exists():
            obj = json.loads(p.read_text())
            rows[name] = {"source": "recorded", "produced_by": obj.get("produced_by"), "budget": budgets[name], **(obj.get("usage") or {})}
            if obj.get("usage"):
                usages.append(obj["usage"])   # a recorded call's tokens count in the stage's total too, so a recorded run is priced
        elif a.live:
            from . import stages
            obj, usage = stages.criterion_answer(inp, st, c, budgets[name], profile)
            obj["usage"] = usage
            p.write_text(json.dumps(obj, indent=1, ensure_ascii=False))
            rows[name] = {"source": "live", "budget": budgets[name], **usage}
            usages.append(usage)
        else:
            rows[name] = {"source": "skipped: no recorded output", "budget": budgets[name]}
            continue
        obj.setdefault("criterion", name)
        answers.append(obj)
    if answers:
        st["d_criteria"] = {"stage": "d_criteria", "produced_by": "; ".join(sorted({str(x.get("produced_by")) for x in answers})), "answers": answers}
    got = [r["source"] for r in rows.values()]
    rep["stages"]["d_criteria"] = {"source": "skipped: no recorded output" if not answers else "recorded" if all(g == "recorded" for g in got if not g.startswith("skipped")) else "live",
                                   "criteria": len(rows), "answered": len(answers), "per_criterion": rows}
    if usages:   # the calls' tokens and dollars, recorded or live, count in the run's total (the per-criterion rows keep their own)
        from . import stages
        rep["stages"]["d_criteria"].update(stages._sum(usages))


def _judge_insight(a, inp, st: dict, profile: dict, rep: dict) -> None:
    """The insight judge step: when stage b wrote insight candidates, read the recorded ``insight_judge.json`` into ``st``.
    With none recorded and no --live the step is skipped quietly (``skipped: no recorded output``) and the deck is built
    with the writer's choice. With --live the judge runs once (stages.insight_judge) and its output is recorded; when every
    candidate fails and stage b was itself live this run, stage b is re-run ONCE with the judge's reasons, its candidates
    judged again, and the retry is logged in ``b['insight_retry']``. A deck whose stage b has no candidates runs nothing and
    adds no row to the report, so an old recorded stage directory is reported as it always was."""
    from . import stages
    if not assemble.valid_candidates(st.get("b") or {}) or not profiles.runs(profile, "b"):
        return
    jp, bp = a.stages / "insight_judge.json", a.stages / STAGE_FILES["b"]

    def live_judge():
        """Judge the current candidates, record the output, and return its report row."""
        obj, usage = stages.insight_judge(st, profile, inp)
        obj["usage"] = usage
        jp.write_text(json.dumps(obj, indent=1, ensure_ascii=False))
        st["insight_judge"] = obj
        return {"source": "live", **usage}

    b_live = (rep["stages"].get("b") or {}).get("source") == "live"
    if jp.exists() and not b_live:   # verdicts are keyed by candidate id: a recorded file never describes candidates written this run
        st["insight_judge"] = json.loads(jp.read_text())
        rep["stages"]["insight_judge"] = {"source": "recorded", "produced_by": st["insight_judge"].get("produced_by"), **(st["insight_judge"].get("usage") or {})}
        return
    if not a.live:
        rep["stages"]["insight_judge"] = {"source": "skipped: no recorded output"}
        return
    rep["stages"]["insight_judge"] = live_judge()
    verdicts = assemble.judge_verdicts(st["insight_judge"])
    if verdicts and not any(v["pass"] for v in verdicts.values()) and (rep["stages"].get("b") or {}).get("source") == "live" and not st["b"].get("insight_retry"):
        reasons = [f"{i}: {v['reason'] or ', '.join(v['failed'])}" for i, v in verdicts.items()]
        first = [str(c["id"]) for c in assemble.valid_candidates(st["b"])]
        st["b"], usage = stages.storyline(inp, st, profile, retry_reasons=reasons)
        st["b"].update(usage=usage, insight_retry={"reasons": reasons, "first_candidates": first})   # a logged decision, bounded to one
        bp.write_text(json.dumps(st["b"], indent=1, ensure_ascii=False))
        rep["stages"]["insight_retry"] = {"source": "live", **usage}
        rep["stages"]["insight_judge"] = live_judge()


def _follow_judge(a, st: dict, rep: dict) -> None:
    """When stage b was written live this run and the judge's first passing candidate is not the writer's pick, make it the
    insight stages c and d are written against: ``insight.chosen_candidate_id`` becomes the judge's, the writer's own pick is
    kept as ``insight.writer_chosen_candidate_id`` (assemble reads it back), and stage b is re-recorded. A recorded stage b is
    never rewritten, and nothing happens without a passing candidate."""
    b = st.get("b") or {}
    if (rep["stages"].get("b") or {}).get("source") != "live" or not st.get("insight_judge"):
        return
    passing = assemble.passing_ids(b, st["insight_judge"])
    ins = b.setdefault("insight", {})
    writer = str(ins.get("writer_chosen_candidate_id") or ins.get("chosen_candidate_id") or "")
    if passing and passing[0] != str(ins.get("chosen_candidate_id") or ""):
        ins.update(writer_chosen_candidate_id=writer, chosen_candidate_id=passing[0])
        (a.stages / STAGE_FILES["b"]).write_text(json.dumps(b, indent=1, ensure_ascii=False))


def _red_team(a, deck: dict, inp, profile: dict, rep: dict) -> None:
    """The red-team step, after stage e on the finished deck: read the recorded ``red_team.json``; with none recorded and no
    --live it is skipped quietly (``skipped: no recorded output``) and the deck is untouched. With --live one Sonnet call
    (stages.red_team) is made and recorded first. The objections go to ``deck.meta.red_team`` and each is a decision in
    ``report.json`` (``decisions``), applied by assemble.apply_red_team only when safe. The report carries a cost note."""
    rp = a.stages / "red_team.json"
    if rp.exists():
        rt = json.loads(rp.read_text())
        row = {"source": "recorded", "produced_by": rt.get("produced_by"), **(rt.get("usage") or {})}
    elif a.live:
        from . import stages
        rt, usage = stages.red_team(deck, inp, profile)
        rt["usage"] = usage
        rp.write_text(json.dumps(rt, indent=1, ensure_ascii=False))
        row = {"source": "live", **usage}
    else:
        rep["stages"]["red_team"] = {"source": "skipped: no recorded output"}
        return
    decisions = assemble.apply_red_team(deck, rt)
    row.update(objections=len(decisions), applied=sum(d["applied"] for d in decisions),
               cost_note="one Sonnet call on the finished deck; the plan's budget is under $1.75 a deck in all")
    rep["stages"]["red_team"] = row
    rep["decisions"] = [*rep.get("decisions", []), *decisions]


def _picture_style(a, deck_ctx, client: str):
    """The Style Pack the picture step prompts with: the --style folder or the document's pack, else the built-in default. A pack that cannot be read
    is not used (the deck's ``style_hold`` holds every slot and says why)."""
    from visuals import style as vstyle   # noqa: PLC0415
    src = a.style or (deck_ctx or {}).get("pack")
    try:
        if src:
            return vstyle.load(*src, forbid=[client]) if isinstance(src, tuple) else vstyle.load(src, forbid=[client])
    except (vstyle.StyleError, OSError):
        pass
    return vstyle.load(None)


def _brief_upstream(a, inp) -> bool:
    """``--brief-upstream FILE`` (JSON ``{id, data}``, the engine server's way: the middleware sends the brief the deck was spun off from): the
    deck builds from its fields (inputs.apply_upstream_brief), with the carried decision chain's marks. A ``--brief`` or ``--deck`` wins. UAT
    round 4 L2: never sent before, so a brief-only deck built from an empty brief. Returns whether the brief was taken."""
    if not getattr(a, "brief_upstream", None) or getattr(a, "brief", None) or getattr(a, "deck", None):
        return False
    try:
        raw = json.loads(a.brief_upstream.read_text())
        got = (str(raw["id"]), raw["data"]) if isinstance(raw, dict) and isinstance(raw.get("data"), dict) and raw.get("id") else None
    except (OSError, ValueError, KeyError):
        got = None
    if got is None:
        raise SystemExit("refused: --brief-upstream must be a JSON file {id, data}: the brief's document id and its data")
    chain = None
    if getattr(a, "members", None):
        try:
            m = json.loads(a.members.read_text())
            chain = m.get("decisions") if isinstance(m, dict) else None
        except (OSError, ValueError):
            chain = None
    others = {}
    if getattr(a, "production_upstream", None):   # a mark the chain holds on the carried Production project is read there
        try:
            raw = json.loads(a.production_upstream.read_text())
            if isinstance(raw, dict) and raw.get("id") and isinstance(raw.get("data"), dict):
                others[str(raw["id"])] = raw["data"]
        except (OSError, ValueError):
            pass   # _production_upstream refuses a bad file with its own message
    return inputs.apply_upstream_brief(inp, got[0], got[1], chain if isinstance(chain, list) else None, others)


def _production_upstream(a, inp, deck_ctx) -> tuple | None:
    """``(source document id, data)`` of the Production project this deck was spun off from, or None: from ``--production-upstream FILE`` (the
    engine server's way: the middleware sends the carried data) or from the Deck document's own ``data.upstream`` (``--deck``). With no brief
    of its own the deck takes the one the project carries (inputs.apply_production_brief). An explicit ``--production`` wins over both."""
    got = None
    if a.production_upstream:
        try:
            raw = json.loads(a.production_upstream.read_text())
            got = (str(raw["id"]), raw["data"]) if isinstance(raw, dict) and isinstance(raw.get("data"), dict) and raw.get("id") else None
        except (OSError, ValueError, KeyError):
            got = None
        if got is None:
            raise SystemExit("refused: --production-upstream must be a JSON file {id, data}: the Production project's document id and its data")
        inputs.apply_production_brief(inp, *got)
    elif (deck_ctx or {}).get("production"):
        got = deck_ctx["production"]
    doc = None
    try:   # what the project's finals are, for the idea stage: a deck of a Production project shows its pictures and no film
        if isinstance(a.production, str):
            from . import prod_picker   # noqa: PLC0415
            doc = prod_picker.Source(Path(a.production).expanduser()).doc
        elif got:
            doc = from_production.carried({"upstream": {got[0]: got[1]}})[1]
        if doc:
            inp.production_visuals = from_production.finals_summary(doc)
    except Exception:   # noqa: BLE001  (a bad project is refused later, with its reason; here it only means no summary)
        inp.production_visuals = None
    return None if a.production else got


def _add_marks(a, inp) -> None:
    """``--marks FILE`` adds to the marks the document carried (an empty list is a real answer: the marks are known). Applied once, at load, so the picture step and
    the paid shorten request both see them."""
    if a.marks:   # marks given by hand only ADD to the ones the document carried, and must be well formed
        raw = json.loads(a.marks.read_text())
        raw = raw.get("marks", raw) if isinstance(raw, dict) and "marks" in raw else raw
        if not (isinstance(raw, list) and all(isinstance(m, dict) and isinstance(m.get("text"), str) and m["text"].strip() and isinstance(m.get("path", ""), str) for m in raw)):
            raise SystemExit("refused: --marks must be a list of {path, text, kind} objects, each with non-empty text (an empty list adds nothing)")
        inp.marks = (inp.marks or []) + raw


def _image_step(a, deck: dict, inp, terr: list, review: dict, wrapped: bool, deck_ctx, rep: dict, generate: str = "all"):
    """The picture step (deck-image-gen), between the placed pictures and the layout plan. Prints the open card(s); makes pictures only for a
    ``--yes-cost`` that names a card's id. ``generate`` (deck-types: the type's recipe) narrows which empty slots generation may plan.
    Returns what imagegen.step returns."""
    try:
        if a.images_reviewed:
            imagegen.record_safe_review(review, inp, deck, a.by)
            a.review.write_text(json.dumps({"review": review} if wrapped else review, indent=1, ensure_ascii=False))
        deck_id = a.deck_id or _deck_id(a, inp, deck)
        led = a.ledger or Path(os.environ.get("NAPKIN_DECK_LEDGER") or Path.home() / ".napkin" / "deck-images" / "ledger.jsonl")
        from visuals import jobs as vjobs   # noqa: PLC0415
        ctx = imagegen.Ctx(deck, inp, terr, _picture_style(a, deck_ctx, a.client), a.stages, a.images_cache or (a.stages / "images"), vjobs.Ledger(led, deck_id), deck_id,
                           review=review, approver=a.approver, cap_usd=a.cap_usd, banned_extra=look.brand_tokens((deck_ctx or {}).get("brand")).get("imagery_bans") or [],
                           territory_usd=_territory_usd(a.stages), generate=generate)
        ctx.production_note = (rep.get("production") or {}).get("card")   # 'Production: N picked, M not reachable' on the card (no cost)
        res = imagegen.step(ctx, a.images, a.yes_cost, a.hero, a.retry_unknown, a.remake_style, remake=[x.strip() for v in a.remake for x in v.split(',') if x.strip()])
    except (imagegen.GenError, images.ImageError) as e:
        raise SystemExit(f"refused: {e}")
    rep["images"] = {"mode": a.images, "cards": {k: {"id": c["id"], "usd": c["usd"]} for k, c in res["cards"].items()},
                     "spent_usd": vjobs.spent_usd(ctx.manifest, ctx.ledger), "cap_usd": ctx.cap,
                     "client_to_runway": res["plan"].get("client_to_runway"),   # the policy that applied, said in the report too
                     "made": (res["made"] or {}).get("created", 0), "stopped": (res["made"] or {}).get("stopped"),
                     "held": [f"{r['slide']}.{r['slot']}: {r.get('reason')}" for r in res["plan"]["slots"].values() if r["status"] in ("held", "rejected")],
                     "refusals": [{"slot": f"{r['slide']}.{r['slot']}", "reason": r["subject_refused"], "used": "generic template"}
                                  for r in res["plan"]["slots"].values() if r.get("subject_refused")]}
    return res


def _shorten_ledger(a, inp, deck: dict):
    """The deck's lifetime ledger of shorten spend: a file beside the picture ledger, counted under the same deck id, outside any stages folder, so deleting a cache
    cannot lower what the deck has spent. Only a live build uses it."""
    if not a.live:
        return None
    from visuals import jobs as vjobs   # noqa: PLC0415
    led = a.ledger or Path(os.environ.get("NAPKIN_DECK_LEDGER") or Path.home() / ".napkin" / "deck-images" / "ledger.jsonl")
    return vjobs.Ledger(led.with_name(led.stem + ".shorten.jsonl"), a.deck_id or _deck_id(a, inp, deck))


def _deck_id(a, inp, deck: dict) -> str:
    """The id the spend ledger counts a deck under, from what the deck IS: a Deck document's own id, else a hash of the brief's words and the deck's
    title (client and project). A copied or renamed stages folder is the same deck and shares its cap."""
    if a.deck:
        import zipfile   # noqa: PLC0415
        try:
            man = __import__("yaml").safe_load(zipfile.ZipFile(a.deck).read("manifest.yaml")) or {}
            did = man.get("document_id") or man.get("id")
            if did:
                return "doc-" + str(did)
        except (OSError, KeyError, zipfile.BadZipFile):
            pass
    blob = json.dumps([{k: (f or {}).get("value") for k, f in sorted(inp.brief.items())}, deck["meta"].get("client"), deck["meta"].get("project")], sort_keys=True, ensure_ascii=False, default=str)
    return "brief-" + hashlib.sha256(blob.encode()).hexdigest()[:16]


def _territory_usd(stages: Path) -> float:
    """What the Territory tool already spent on this pitch's frames, for information on the card (never counted in the deck's cap)."""
    try:
        f = images.load_frames(stages)
    except images.ImageError:
        return 0.0
    return round(float(((f or {}).get("run") or {}).get("usd") or 0), 2)


def _read_answers(path) -> tuple:
    """The person's answers and verify decisions from ``--answers FILE``: ``(answers, verified)``. The file is the
    flat ``{qid: {text|option_id, at, skipped?}}`` it always was, or an ``intake`` object as the app keeps it
    (``{answers: {...}, verified: {<ref>: {by, at}}}``). No file: both empty."""
    if not path:
        return {}, {}
    raw = json.loads(Path(path).read_text())
    if isinstance(raw, dict) and set(raw) & {"answers", "verified"} and all(isinstance(raw.get(k), dict) for k in set(raw) & {"answers", "verified"}) \
            and not any(str(k).startswith("q_") for k in raw):
        return raw.get("answers") or {}, raw.get("verified") or {}
    return raw, {}


def main(argv=None):
    """Run the pipeline end to end and print the report."""
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--brief", type=Path, help="the brief tool's output (optional: a prompt, documents or research alone build a deck)")
    ap.add_argument("--prompt-text", help="the person's prompt, any length (cited prompt:<n>)")
    ap.add_argument("--prompt-file", type=Path, help="a text file holding the person's prompt")
    ap.add_argument("--answers", type=Path, help="JSON of the person's answers to the intake questions: {qid: {text|option_id, at, skipped?}}")
    ap.add_argument("--research", type=Path)
    ap.add_argument("--stages", required=True, type=Path)
    ap.add_argument("--client", required=True)
    ap.add_argument("--project", required=True)
    ap.add_argument("--agency", default="[Agency]")
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--master", type=Path)
    ap.add_argument("--live", action="store_true", help="run missing model stages (paid)")
    ap.add_argument("--format", choices=("pitch", "full"), default="pitch",
                    help="pitch (default): the presented story, then an appendix; full: every slide in story order")
    ap.add_argument("--audience", choices=("review", "client"), default="review",
                    help="client: drop agency notes and fail the gate on any agency-only text left on screen")
    ap.add_argument("--animate", choices=("auto", "click"), help="native PowerPoint animations: builds play on their own, or one per click")
    ap.add_argument("--hyperframes", action="store_true", help="also write a HyperFrames slideshow project (hyperframes/)")
    ap.add_argument("--builds", action="store_true", help="HyperFrames: one click per block instead of one per slide")
    ap.add_argument("--kind", choices=tuple(profiles.KIND_TO_PROFILE), default=None,
                    help="the deck type: agency (default, unless the person's answer to q_deck_type chooses), investor (seed) pitch, "
                         "tender (a tender response, profile tender_response), credentials (a chemistry-meeting deck) or creative (a creative work "
                         "session, profile creative_work)")
    ap.add_argument("--type", dest="deck_type", choices=profiles.ids(), default=None,
                    help="the person's explicit pick on the type picker (deck-types): ranks with --kind above an answer to q_deck_type, an inference "
                         "and the default. A Deck document's inputs.deck_type is the same pick; --kind wins for the run when both are given")
    ap.add_argument("--confirm-stages", action="store_true",
                    help="a person's yes to the model stages a type change needs (deck-types, with --live): without it a change that needs new writing is "
                         "refused before any call, naming the stages. Pictures are never re-made by a type change either way")
    ap.add_argument("--same-type", action="store_true",
                    help="the caller (the engine server) has checked that this run continues the type it started with, so the stages not yet written are "
                         "the next gate's, not a type change's new writing: the --live refusal does not apply")
    ap.add_argument("--doc", action="append", default=[], metavar="KEY=PATH",
                    help="a client document (PDF page by page, or text), cited as doc:KEY#pN; repeatable")
    ap.add_argument("--brand", type=Path, help="brand JSON: name, colors (THEME keys, accent_ink), head/body fonts, logo files")
    ap.add_argument("--style", type=Path, help="a Style Pack: a folder (style.yaml and images) or a Style Pack .clan; its deck colours and type "
                                               "(empty by default) rank above the agency look (deck-look-kits)")
    ap.add_argument("--agency-look", type=Path, help="the signed-in person's agency look, JSON (id, rev, accent, base, accent_ink, accent_use, surface): "
                                                     "it dresses the deck automatically unless --no-agency-look; an agency with no look passes none")
    ap.add_argument("--update-look", action="store_true", help="take the agency's current look (--agency-look) in place of the one this deck recorded when it was built")
    ap.add_argument("--deck", type=Path, help="a Deck document (.clan): the brief, research and look come from it (the runner's path); an attached Style Pack or Brand Clan "
                                              "is never read as research and a Brand Clan's pins never reach the facts")
    ap.add_argument("--no-agency-look", action="store_true", help="this deck opts out of the agency look (look.agency_look.use false)")
    ap.add_argument("--wears", choices=look.WEARS, default="agency",
                    help="whose brand the deck wears: agency (default; a client kit gives only its logo and imagery bans), client or co_branded")
    ap.add_argument("--strict-brand", action="store_true", help="only the kit's given tokens: ignore Style Pack literals and the agency look")
    ap.add_argument("--density", choices=spec.DENSITY_LEVELS, default=None,
                    help="how much a content slide holds: lean (about 30 words), standard (60), detailed (the type's budget). Without it the engine resolves it by format "
                         "(a presented pitch is lean, a leave-behind detailed) and stamps meta.preferences.density with its source")
    ap.add_argument("--size", choices=spec.SLIDE_SIZES, default=None,
                    help="the slide size (deck-slide-size): 16:9 (default), 4:3 or a4 (A4 landscape, 297 x 210 mm). Without it: the Deck document's look.size, "
                         "a --master's own size, the deck type's (with the recipes on: a tender and a deck sent to be read are A4), else 16:9. Margins and type "
                         "stay the same size; the layouts reflow and the fit ladder takes what no longer fits. A4 defaults to density detailed")
    ap.add_argument("--layout", action="append", default=[], metavar="SLIDE=ID",
                    help="a person's layout swap for one slide (repeatable); honoured when the layout holds the slide, else layout_unknown")
    ap.add_argument("--no-layout-plan", action="store_true", help="skip the layout plan: the renderers choose as before the library (rollback)")
    ap.add_argument("--no-notes", action="store_true", help="a notes-free export: no speaker notes in the pptx (the moved points go with them)")
    ap.add_argument("--no-qa", action="store_true", help="skip stage h, the rendered-slide QA (qa.json): the repair loop reads the QA, so it does not run either")
    ap.add_argument("--no-repair", action="store_true", help="turn the repair loop off: no round, no issues.json, the output is exactly the engine without it")
    ap.add_argument("--text-mode", choices=spec.TEXT_MODES, default=None,
                    help="condense: the repair loop may move whole points to the speaker notes and shorten wording with the slide's own words; preserve: it never does. Absent: no shorten and no loop move (the app's default is condense and the runner passes it)")
    ap.add_argument("--repair-policy", type=Path, help="a repair policy file over policy/repair.yaml (tests and experiments)")
    ap.add_argument("--approve-shorten", metavar="ID", default=None,
                    help="a person's yes to shortening a deck built for --audience client: the approval id for these exact words (apv_..., printed in the repair report's skipped list); "
                         "any change to the shortenable words voids it. A bare flag is not a yes")
    ap.add_argument("--until", choices=UNTIL_CHOICES, default=None,
                    help="stop after this stage and write report.json (stages a0 a b c d, or i for an investor deck); 'deck' stops once the deck "
                         "is assembled and validated, before any file is rendered. Stage outputs stay in --stages: a later run carries on from them")
    ap.add_argument("--pictures", choices=("creative_cover", "creative", "none"), default=None,
                    help="place pictures that already exist (stages/frames.json from deck.from_territory, and --image): creative_cover (the "
                         "creative slides, the cover and the divider), creative, or none. Absent: frames.json is ignored and no slot is written")
    ap.add_argument("--production", nargs="?", const=True, default=False, metavar="FILE",
                    help="place the Production Tool's pictures: the key visual on the cover and the idea, each execution the size its channel matches. "
                         "Bare: stages/production.json from deck.from_production. With FILE (a Production .clan, or its export zip): the picker "
                         "(deck.prod_picker) lists every asset from metadata, picks by rule and pulls only the picked pictures (the .clan's own, then "
                         "https with --production-fetch, then the zip). Nothing is made or spent; implies --pictures creative_cover unless --pictures says otherwise")
    ap.add_argument("--members", type=Path, metavar="FILE",
                    help="the research the Deck document carries, JSON {facts, findings, sources, decisions} (the engine server's way: the middleware sends it): "
                         "taken as the deck's research evidence when no --research is given")
    ap.add_argument("--clean-export", action="store_true",
                    help="the exported files carry no internal check banner (DRAFT, CHECK FAILED), no bracket placeholder and no open 'to confirm' on a slide: "
                         "open items go to the appendix, and the page numbers and notes carry no ids (the cloud's web render)")
    ap.add_argument("--brief-upstream", type=Path, metavar="FILE",
                    help="the brief this deck was spun off from, carried whole (JSON {id, data}: the source document id and its shared/data.yaml): the deck "
                         "builds from its fields (the engine server's way: the middleware sends it). A --brief or --deck wins")
    ap.add_argument("--production-upstream", type=Path, metavar="FILE",
                    help="the Production project this deck was spun off from, carried whole (JSON {id, data}: the source document id and its shared/data.yaml): "
                         "its finals fill the slots first, then the rules for the empty ones; its pictures are fetched by link from the relay. A --deck document "
                         "that carries one under data.upstream needs no flag. An explicit --production beats it")
    ap.add_argument("--production-fetch", action="store_true",
                    help="with --production FILE: download picked pictures from their https:// locations (hosts on policy/production_fetch.yaml only; "
                         "empty by default, so it refuses until the hosts are named). Off: nothing is downloaded")
    ap.add_argument("--production-agent", action="store_true",
                    help="with --production FILE: a Claude (Sonnet) call breaks ties the rules leave, on metadata rows only (about $0.01 a tie). Off: the newest wins")
    ap.add_argument("--production-pick", action="append", default=[], metavar="SLIDE.SLOT=KEY",
                    help="with --production FILE: a person's swap of a slot's Production picture to another of its candidates (repeatable; recorded in "
                         "stages/production_choices.json and kept for later builds). The app's review.production, given with --review, says the same")
    ap.add_argument("--production-look", action="store_true",
                    help="with --production FILE: a vision check of the pulled pictures (local Ollama, else Claude Haiku; 8 at most) that only flags them")
    ap.add_argument("--image", action="append", default=[], metavar="SLIDE.SLOT=FILE",
                    help="place a picture you supply on a slide of a picture type (never an evidence slide; the slot 'logo' is refused); repeatable")
    ap.add_argument("--image-rights", action="append", default=[], metavar="SLIDE.SLOT=RIGHTS",
                    help="own, licensed or client_supplied for a supplied picture; with none it is recorded as reference_only and not placed")
    ap.add_argument("--review", type=Path, help="the person's review JSON ({pinned, images}) as the app keeps it: stamps approvals on the pictures")
    ap.add_argument("--approver", help="the deck's picture approver, human:<id>: only a decision by this person is stamped as approved")
    ap.add_argument("--picture-label", default=spec.PICTURE_LABEL, help="what a picture is labelled until approved (up to 30 characters, no digit, no name)")
    ap.add_argument("--picture-source", choices=spec.PICTURE_SOURCES, default="existing",
                    help="existing: only pictures we already have. generated: also pictures made for empty slots (same as --images plan unless --images says more)")
    ap.add_argument("--images", choices=imagegen.MODES, default="off",
                    help="make pictures for the empty slots (deck-image-gen): subjects (the subject card; with --yes-cost the one model call), plan (the "
                         "picture card, no network) or live (make exactly the jobs on the card --yes-cost names). off: nothing is planned")
    ap.add_argument("--yes-cost", metavar="CARD_ID", help="a person's yes to ONE card: its id (c_ and 8 hex). A missing, different or stale id is refused before any call")
    ap.add_argument("--hero", action="append", default=[], metavar="SLIDE.SLOT", help="ask for a final (pro) picture of an approved, guard-checked draft (a card of its own)")
    ap.add_argument("--retry-unknown", action="store_true", help="put jobs whose create got no answer (they may be charged) on the card again")
    ap.add_argument("--remake", action="append", default=[], metavar="SLIDE.SLOT",
                    help="a person asks to make this made picture again, from its recorded subject: it goes on the next card as a new attempt (never automatic; two pictures per slot at most)")
    ap.add_argument("--remake-style", action="store_true", help="put pictures made with another Style Pack on the card (a changed pack never remakes by itself)")
    ap.add_argument("--marks", type=Path, help="the parts marked Confidential, JSON [{path, text, kind}] (an empty list is a real answer); needed with --images for a deck built from files")
    ap.add_argument("--images-cache", type=Path, help="where the picture jobs, plan and manifest live (default: <stages>/images)")
    ap.add_argument("--deck-id", help="DEV ONLY (needs --dev): the id the spend ledger counts this deck under. Normally it comes from the deck's content (the document id, "
                                      "or a hash of the brief and the deck title), so a copied folder shares one cap")
    ap.add_argument("--ledger", type=Path, help="DEV ONLY (needs --dev): the spend ledger file (normally $NAPKIN_DECK_LEDGER or ~/.napkin/deck-images/ledger.jsonl)")
    ap.add_argument("--dev", action="store_true", help="allow --deck-id and --ledger: they can split one deck's spend across ledgers, so they are for tests and tools that own both")
    ap.add_argument("--cap-usd", type=float, default=None, help="a LOWER cap for this deck's pictures (default and most 2.50; the subject call and failures count)")
    ap.add_argument("--images-reviewed", action="store_true", help="record a person's review of a sensitive brief in --review (needs --by human:<id>)")
    ap.add_argument("--by", help="who reviewed (human:<id>) with --images-reviewed")
    ap.add_argument("--images-only", action="store_true", help="rebuild from the recorded stages only (never a text model); refuses if any text stage is missing")
    a = ap.parse_args(argv)
    a.pictures_asked = a.pictures is not None   # deck-types: a person's own --pictures beats the type's picture default
    if a.picture_source == "generated" and a.images == "off":
        a.images = "plan"
    if (a.images != "off" or a.production) and a.pictures is None:
        a.pictures = "creative_cover"
    if a.production and a.pictures == "none":
        ap.error("--production places pictures and --pictures none asks for none: drop one")
    if (a.production_fetch or a.production_agent or a.production_look or a.production_pick) and not isinstance(a.production, str):
        ap.error("--production-fetch, --production-agent, --production-look and --production-pick work on a Production file: give --production FILE (.clan or zip)")
    prod_picks = {}
    for x in a.production_pick:
        sk, eq, key = x.partition("=")
        if not (eq and key and re.fullmatch(r"s[0-9]{2,3}\.[a-z][a-z0-9_]{1,23}", sk)):
            ap.error(f"--production-pick needs SLIDE.SLOT=KEY (e.g. s11.picture=size_...), got {x!r}")
        prod_picks[sk] = {"key": key, "by": "a person (--production-pick)", "at": time.strftime("%Y-%m-%dT%H:%M:%S")}
    if a.images_only and a.live:
        ap.error("--images-only never calls a text model: drop --live")
    if a.cap_usd is not None and not (0 < a.cap_usd <= 2.5):
        ap.error("--cap-usd must be above 0 and at most 2.50: the per-deck cap is Sai's and nothing raises it")
    if (a.deck_id or a.ledger) and not a.dev:
        ap.error("--deck-id and --ledger split a deck's spend across ledgers and need --dev")
    if a.dev and (a.deck_id or a.ledger):
        print("WARNING: --dev: the spend ledger or deck id was set by hand, so this deck's cap is not shared with its other builds. Never use this for a real run.", file=sys.stderr)
    if a.yes_cost and a.images == "off":
        ap.error("--yes-cost is the yes to a picture card: give --images subjects or live with it")
    if a.images_reviewed and not (a.review and a.by):
        ap.error("--images-reviewed needs --review FILE and --by human:<id>")
    if a.pictures == "none" and a.image:
        ap.error("--image asks for a picture and --pictures none asks for none: drop one")
    try:
        supplied = images.parse_image_args(a.image, a.image_rights)
    except images.ImageError as e:
        ap.error(str(e))
    if a.prompt_text and a.prompt_file:
        ap.error("give --prompt-text or --prompt-file, not both")
    prompt_text = (a.prompt_file.expanduser().read_text(encoding="utf-8", errors="replace") if a.prompt_file else a.prompt_text or "").strip()
    if not (prompt_text or a.doc or a.brief or a.research or a.deck):
        ap.error("nothing to build a deck from: give a prompt (--prompt-text or --prompt-file), a document (--doc), a brief (--brief) or research (--research)")
    a.out.mkdir(parents=True, exist_ok=True)
    images.wipe_stale(a.out)   # every build, --until deck included: no repair round, repair.json, issues.json or qa.json from an earlier build
    if a.live:
        a.stages.mkdir(parents=True, exist_ok=True)   # a live run writes each stage here as it goes; a missing folder used to fail after the first paid call
    rep = {"stages": {}, "started": time.strftime("%Y-%m-%dT%H:%M:%S")}
    t0 = time.time()

    t = time.time()
    docs = []
    for d in a.doc:
        key, eq, path = d.partition("=")
        if not (eq and key.strip() and path.strip()):
            ap.error(f"--doc needs KEY=PATH, got {d!r}")
        if key in {k for k, _ in docs}:
            ap.error(f"--doc key {key!r} is given twice: each document needs its own key")
        docs.append((key, Path(path).expanduser()))
    answers, verified = _read_answers(a.answers)
    deck_ctx = None
    if a.deck:
        try:
            inp, deck_ctx = inputs.from_deck_document(a.deck)
        except inputs.MarksError as e:
            raise SystemExit(f"refused: {e}")
        if prompt_text:
            inp.prompt_text = prompt_text
    else:
        try:
            inp = inputs.load(a.brief, a.research, a.stages / "doc_facts.json", docs, prompt_text=prompt_text, answers=answers, verified=verified)
        except inputs.MarksError as e:
            raise SystemExit(f"refused: {e}")
    if a.members and not a.research:
        try:
            inputs.apply_research(inp, json.loads(a.members.read_text()))
        except (OSError, ValueError) as e:
            raise SystemExit(f"refused: --members must be a JSON file of the carried research ({e})")
    _brief_upstream(a, inp)   # spun off a brief: its fields (before a Production project's, which yields to it)
    _add_marks(a, inp)
    _master_size(a, _explicit_size(a, deck_ctx, answers))   # deck-slide-size: a master/size conflict is refused here, before any paid stage
    prod_up = _production_upstream(a, inp, deck_ctx)   # production-spinoff: the Production project carried whole, unless a --production file was given
    if prod_up and a.pictures is None:
        a.pictures = "creative_cover"
    rep["stages"]["inputs"] = {"secs": round(time.time() - t, 2), "model": None, "tokens_in": 0, "tokens_out": 0, "usd": 0}
    pick = a.deck_type or (deck_ctx or {}).get("deck_type")   # deck-types: the person's explicit pick (--type, or the document's inputs.deck_type)
    try:
        choice = intake.chosen_type(inp, a.kind, pick)   # --kind, then the pick, then the person's answer, then (recipes on) a high-confidence inference, then the default
    except profiles.ProfileError as e:
        raise SystemExit(f"refused: {e}")
    profile = profiles.load(choice["type"])
    kind = profile["kind"]                     # which assembler: agency or investor
    rec = profiles.recipe(profile, a.format) if profiles.recipes_on() else None   # deck-types: resolved once (None with the flag off)
    if rec and not a.pictures_asked and a.pictures is not None:
        a.pictures = rec["pictures"]["on"]   # the person set no picture preference: the type's default (only where pictures were asked for at all)
    if prod_up and (kind == "investor" or a.pictures == "none"):   # nobody asked for it by flag: an investor deck or a no-pictures run just does not use it
        prod_up = None
        if kind == "investor" and not a.pictures_asked and a.images == "off":
            a.pictures = None
    if a.production and kind == "investor":   # never silently ignored, and refused before any stage runs or spends
        raise SystemExit("refused: --production places the Production Tool's campaign pictures on a pitch deck's cover, idea and executions; "
                         "an investor deck has none of those slides. Drop --production")
    rep["type"] = {"id": profile["id"], "source": choice["source"], "note": choice["note"], **({"evidence": choice["evidence"]} if choice.get("evidence") else {})}
    if rec:   # deck-types: the recipe this run builds from, resolved once (flag off: no key, the report is today's)
        rep["recipe"] = {"type": rec["type"], "format": rec["format"], "length": rec["length"], "layouts": rec["layouts"], "not_built": rec["not_built"],
                         "density": rec["density"]["level"], "pictures": rec["pictures"], "brand": rec["brand"], "titles": rec["titles"],
                         "size": {"value": rec["size"], "applied": False, "waits_on": "deck-slide-size"}}
    rep["type_question"] = intake.type_card_for(inp)   # computed in code: it exists even when no a0 stage ran
    supply = intake.supply_questions(inp, kind, profile if profile["arrange"] == "spine" else None)   # computed in code: what only the person knows
    rep["supply_questions"] = supply
    rep["coverage"] = inp.coverage
    pages = {k: d["pages"] for k, d in inp.docs.items() if d.get("pages")}
    if pages:
        rep["doc_pages"] = pages   # every page of every document read (never dropped)

    names = profiles.stage_names(profile, INVESTOR_STAGE_FILES if kind == "investor" else STAGE_FILES)
    if rec:   # deck-types slice 6: a type change re-plans for free from recorded stages, and asks first when it needs a model stage
        rep["type_change"] = _type_change(a, profile)
    if a.until not in (None, "deck") and a.until not in names:
        ap.error(f"--until {a.until}: this deck type has no such stage (it runs {', '.join(names)})")
    if a.images_only:
        need = [fn for k, fn in names.items() if k != "a0"] + ["fit.json", "e_copy.json", "red_team.json"] + ([imagegen.STAGE_G_FILE] if a.images == "live" else [])
        gone = [fn for fn in need if not (a.stages / fn).exists()]
        if gone:
            raise SystemExit("refused: --images-only rebuilds from recorded stages and the following are missing: " + ", ".join(gone))
    st = {}
    for k, fn in names.items():
        p = a.stages / fn
        if k == "a0" and not p.exists() and not (a.live and _needs_intake(inp)):
            if a.until == k:
                return _stopped(a, rep, t0, k)
            continue   # intake adds no stage, and no cost, when the brief supplies everything or there is nothing else to read
        if p.exists():
            st[k] = json.loads(p.read_text())
            if k == "a0":
                errs = intake.validate_a0(st[k])
                if errs:
                    raise SystemExit(f"{p} is not a valid a0 intake: " + "; ".join(errs[:5]))
            rep["stages"][k] = {"source": "recorded", "produced_by": st[k].get("produced_by"),
                                **(st[k].get("usage") or {"tokens_in": 0, "tokens_out": 0, "usd": 0, "secs": 0})}
        elif a.live:
            from . import stages
            st[k], usage = stages.run_stage(k, inp, st, profile)
            st[k]["usage"] = usage   # kept with the output, so a later recorded run still reports its cost
            p.write_text(json.dumps(st[k], indent=1, ensure_ascii=False))
            rep["stages"][k] = {"source": "live", **usage}
        else:
            rep["stages"][k] = {"source": "missing"}
        if k == "b" and k in st:   # the insight is judged BEFORE territories (c) and the idea (d) are written, so they are written against the insight the deck shows
            _judge_insight(a, inp, st, profile, rep)
            _follow_judge(a, st, rep)
        if k == "a0" and k in st:   # later stages and the build read the brief with the intake's fields in it
            st[k]["gaps"] = intake.gap_report(inp, st[k], kind)
            asked = len(st[k]["questions"])   # the stage's own questions, before the deck type question joins them
            card = None if choice["source"] == "pick" else intake.type_card_for(inp)   # deck-types: a picked type is not asked again (its place goes to another question)
            intake.add_type_question(st[k], card, profile if profile["arrange"] == "spine" else None)   # the deck type is the first question; a legacy type adds none of its own, so its deck is unchanged
            intake.add_supply_questions(st[k], supply)   # after the type question and the stage's own, within the five-question cap
            if profiles.recipes_on() and not a.master and not _explicit_size(a, deck_ctx, answers):   # deck-slide-size: asked only when nobody chose a size and no master fixes it
                intake.add_size_question(st[k], intake.size_card_for(inp, a.format))
            inp.intake = st[k]
            rep["intake"] = {"applied": intake.apply_a0(inp, st[k]), "gaps": st[k]["gaps"], "questions": asked,
                             "questions_total": len(st[k]["questions"])}
        if a.until == k:
            return _stopped(a, rep, t0, k)

    _criterion_answers(a, inp, st, profile, rep)

    t = time.time()
    fp = a.stages / "fit.json"   # the fit judge reads an assembled deck; its verdicts decide what a pitch presents
    fit = json.loads(fp.read_text()) if fp.exists() else None
    builder = assemble.build_investor if kind == "investor" else assemble.build
    frames, bound, prod, picker_src = None, None, None, None
    names = [x for x in (a.client, a.agency) if x]
    if a.brand and a.brand.exists():   # the brand's own name may not label or describe a picture either: read before any frame is bound
        try:
            bn = json.loads(a.brand.read_text()).get("name")
        except ValueError:
            bn = None
        names += [bn] if bn else []
    try:
        label = images.clean_label(a.picture_label, names)
        if a.approver and not images.APPROVER.match(a.approver):
            raise images.ImageError("--approver must be human:<id>: only a person approves a picture")
        if a.pictures and kind != "investor":   # frames.json is read ONLY with --pictures: a stray one in a stages folder changes nothing
            frames = images.load_frames(a.stages)
            if frames and frames.get("territories_sha256_12") and frames["territories_sha256_12"] != images.territories_sha((st.get("c") or {}).get("territories")):
                raise images.ImageError("frames.json was made for other territories than c_territories.json now holds (its territories hash differs): "
                                        "frames bind by territory id, so they would sit on the wrong slides. Run deck.from_territory again, with --replace")
            if frames:
                bound = images.bind_frames(None, frames, st.get("c") or {}, a.pictures, names)
            if isinstance(a.production, str):   # a .clan or the export zip: opened and checked now, picked once the deck exists (deck-prod-picker)
                from . import prod_picker
                picker_src = prod_picker.Source(Path(a.production).expanduser())
            elif prod_up and not a.production:   # the Production project carried in the deck: finals first, pictures by link (production-spinoff)
                from . import prod_picker
                picker_src = prod_picker.CarriedSource(*prod_up)
            elif a.production:   # production.json is read ONLY with --production: a stray one changes nothing (deck-prod-assets)
                prod = images.load_production(a.stages)
                if prod is None:
                    raise images.ImageError(f"--production: {a.stages}/production.json is missing. Run deck.from_production BUNDLE.zip --stages {a.stages} first")
    except images.ImageError as e:
        raise SystemExit(f"refused: {e}")
    except ValueError as e:   # from_production.FromProductionError (and a YAML error) from the picker's file: refused before any build
        raise SystemExit(f"refused: {'--production ' + Path(str(a.production)).name if a.production else 'the Production project this deck carries'}: {e}")
    extra = {"pictures": bound} if bound else {}
    if (picker_src or prod) and kind != "investor":   # a deck whose pictures are Production's finals: its executions keep their own slides
        extra["production"] = True
        _doc = (prod_up[1] if prod_up else getattr(picker_src, "doc", None)) or {}
        extra["working_title"] = str(((_doc.get("project") or {}) if isinstance(_doc, dict) else {}).get("title") or "")   # the name Start prefilled: not a cover title
    build = lambda f: builder(inp, st, client=a.client, project=a.project, agency=a.agency, fmt=a.format, fit=f, profile=profile, **extra)
    deck = build(fit)
    if fit:
        rep["stages"]["fit"] = {"source": "recorded", "produced_by": fit.get("produced_by"), **(fit.get("usage") or {})}
    elif a.live and profiles.runs(profile, "fit"):
        from . import stages
        fit, usage = stages.fit(deck, inp, profile)
        fit["usage"] = usage
        fp.write_text(json.dumps(fit, indent=1, ensure_ascii=False))
        rep["stages"]["fit"] = {"source": "live", **usage}
        deck = build(fit)
    else:
        rep["stages"]["fit"] = {"source": "missing"}
    deck["meta"]["audience"] = a.audience
    if kind == "investor":   # a slide with no source is held behind the Appendix: its question card joins the supply cards
        have = {c["id"] for c in supply}
        rep["supply_questions"] = supply + [c for c in intake.gap_questions(assemble.investor_gaps(deck)) if c["id"] not in have]
    rep["confirm"] = intake.confirm_summary(deck, intake.stamp_confirm(deck, inp))   # what to confirm, and how much a person has verified or supplied
    _stamp_type(deck, profile, choice, a.format)
    size = _resolve_size(a, deck, deck_ctx, rec, answers)
    if size != spec.SIZE_DEFAULT:   # the report names the size only when it is not 16:9
        rep["size"] = dict(deck["meta"]["preferences"]["size"])
    if rec and "recipe" in rep:
        rep["recipe"]["size"] = {"value": rec["size"], "applied": (deck["meta"].get("preferences") or {}).get("size", {}).get("source") == "recipe"}
    brand = None
    if a.brand:   # colours, fonts and logos: the logo files are read here so the deck carries them
        brand = json.loads(a.brand.read_text())
        for k in ("logo_dark_svg", "logo_light_svg"):
            if brand.get(k) and Path(brand[k]).expanduser().exists():
                brand[k] = Path(brand[k]).expanduser().read_text()
        for k in ("logo_dark_png", "logo_light_png"):
            if brand.get(k):
                brand[k] = str(Path(brand[k]).expanduser())
    _stamp_look(a, deck, brand, rep, deck_ctx, profile)
    ep = a.stages / "e_copy.json"   # stage e: tighten over-budget presented slides; recorded edits are re-applied by title
    if ep.exists():
        ecopy = json.loads(ep.read_text())
        rep["stages"]["e"] = {"source": "recorded", "produced_by": ecopy.get("produced_by"), **(ecopy.get("usage") or {})}
    elif a.live and profiles.runs(profile, "e"):
        from . import stages
        ecopy, usage = stages.copy(deck, inp, profile)
        ecopy["usage"] = usage
        ep.write_text(json.dumps(ecopy, indent=1, ensure_ascii=False))
        rep["stages"]["e"] = {"source": "live", **usage}
    else:
        ecopy = None
        rep["stages"]["e"] = {"source": "missing"}
    if ecopy:
        rep["stages"]["e"]["applied"] = assemble.apply_copy(deck, ecopy.get("edits") or [])
        if ecopy.get("narrowed"):   # headline narrowing: a recorded e_copy.json without it changes nothing
            rep["stages"]["e"]["narrowing"] = assemble.apply_narrowing(deck, ecopy["narrowed"])
    _red_team(a, deck, inp, profile, rep)
    sources, held, plan_res, stale_gen = {}, [], None, []
    if a.pictures or supplied:   # pictures that already exist: records and assets only; nothing is made, sent or spent
        try:
            if bound and bound["assets"]:
                images.register_assets(deck, bound["assets"])
            held = images.place_supplied(deck, supplied, images.deck_names(deck), sources)
            if prod or picker_src:   # after a person's own pictures (kept), before the empty slots and the image step (a filled or rights-pending slot is never planned)
                brief_doc = next((d for d, app in ((deck_ctx or {}).get("apps") or {}).items() if app == "ie.napkin.brief-maker"), None)
                if picker_src:
                    rvw = json.loads(a.review.read_text()) if a.review else {}
                    rvw = rvw.get("review", rvw) if isinstance(rvw, dict) else {}   # the app's {review: ...} wrapper, or the bare object
                    swaps = {**prod_picker.choices_from_review(rvw), **prod_picks}
                    pres = prod_picker.run(deck, picker_src, a.stages, a.pictures, images.deck_names(deck), brief_doc, fetch=a.production_fetch,
                                           agent=a.production_agent, look=a.production_look, choices=swaps,
                                           relay=prod_picker.relay_for(a.stages) if picker_src.kind == "upstream" else None)
                    prod = images.load_production(a.stages)
                    for name, u in (("production_agent", pres["usage"]["agent"]), ("production_look", pres["usage"]["look"])):
                        if u:   # only on its flag: pulling itself never spends
                            rep["stages"][name] = {"source": "live", **u}
                    print(pres["card"] + (f"  ({pres['picker']['fetch']['refused']})" if pres["picker"]["fetch"]["refused"] else ""))
                else:
                    pres = images.bind_production(deck, prod, a.pictures, images.deck_names(deck), brief_doc)
                held = held + pres["held"]
                rep["production"] = {"project": (prod.get("project") or {}).get("id"), "offer_sha256": prod.get("offer_sha256"),
                                     "placed": pres["placed"], "held": len(pres["held"]), "kept": pres["kept"], "usd": 0,
                                     "key_visual": pres["master"]}
                if picker_src:
                    rep["production"].update(picker=pres["picker"], card=pres["card"])
            if a.pictures:   # deck-types: the type's picture types narrow the empty slots when the person set no picture preference
                images.add_empty_slots(deck, a.pictures, rec["pictures"]["types"] if rec and not a.pictures_asked else None)
            review = json.loads(a.review.read_text()) if a.review else {}
            wrapped = isinstance(review, dict) and "review" in review
            review = review.get("review", review) if isinstance(review, dict) else {}
            terr = (st.get("c") or {}).get("territories") or []
            if a.images != "off":
                plan_res = _image_step(a, deck, inp, terr, review, wrapped, deck_ctx, rep, generate=rec["pictures"]["generate"] if rec else "all")
            gen = images.load_generated(a.stages) if a.pictures else None
            if gen:
                bound_gen = images.bind_generated(deck, gen, terr, images.deck_names(deck), imagegen.words_sha(deck))
                if bound_gen.get("stale"):
                    stale_gen.append({"check": "image_missing", "level": "warn", "slide": deck["order"][0],
                                      "message": f"{bound_gen['stale']} generated picture(s) were made for other words than this deck now has, so none was used: make them again from a card"})
            images.prune_assets(deck)
            stamped = images.stamp_review(deck, review, a.approver)
            hold = deck["meta"].get("style_hold") or (frames or {}).get("style_hold")   # one hold: a failed pack load (look stamping) or the frames plan's
            if hold:
                deck["meta"]["style_hold"] = hold
            images.stamp_preferences(deck, a.pictures or "creative_cover", label, a.approver, hold,
                                     ((frames or {}).get("style") or {}).get("hash") if hold else None,
                                     generated=a.images != "off" or a.picture_source == "generated", cap_usd=a.cap_usd)
        except images.ImageError as e:
            raise SystemExit(f"refused: {e}")
        if hold:
            print("style pack held: " + hold.get("reason", "the Style Pack could not be read") + " The build went on; the pictures keep the style they were made in.")
        if frames:
            deck["meta"]["built_from"] = {**deck["meta"]["built_from"], "territory_run": {
                "file": frames["run"]["file"], "sha256_12": frames["run"]["sha256_12"], "frames_version": frames.get("version"),
                "same_brief": frames["run"]["same_brief"]}}
        rep["pictures"] = {"slots": sum(1 for _ in images.image_slots(deck)), "drawn": len(images.drawn(deck, a.audience)), "held": held, "review": stamped}
    if a.images != "off" and plan_res:
        imagegen.mark_planned(deck, plan_res["plan"])
    rep["stages"]["assemble"] = {"secs": round(time.time() - t, 2), "model": None, "usd": 0}

    if a.clean_export and kind != "investor":   # the exported files carry no agency-only text: open items move to one appendix slide
        rep["export_clean"] = export_clean.scrub(deck)
    plan_issues = []
    loop_on, policy, base_deck, pinned_ids, swaps, level, tm = False, None, None, set(), {}, None, None
    if not a.no_layout_plan:   # the layout plan (deck-layout-library): after stage e, the red team and the pictures, before validate
        from . import layouts
        t = time.time()
        lk = (deck_ctx.get("look") if isinstance(deck_ctx, dict) else None) or {}   # the document's look: density (a person's choice) and layouts (their swaps)
        dl = lk.get("density")
        dl = dl.get("level") if isinstance(dl, dict) else dl
        dl = dl if dl in spec.DENSITY_LEVELS else None
        level = a.density or dl or ((spec.SIZE_DENSITY_DEFAULTS.get(size) or (rec["density"]["level"] if rec else spec.DENSITY_DEFAULTS.get(a.format))) if spec.LOOK_V2 else None)   # deck-types: the type's level (person > size (A4: detailed) > recipe > default)
        if a.no_notes:   # no notes means nowhere for a moved point to go: nothing leaves the slide
            level = "detailed"
        if level:
            deck["meta"].setdefault("preferences", {})["density"] = {"level": level, "source": "person" if (a.density or dl or a.no_notes) else "default"}
        swaps = {k: v for k, v in (lk.get("layouts") or {}).items() if k in deck["slides"] and isinstance(v, str)}
        for item in a.layout:
            sid_, _, lid_ = item.partition("=")
            if sid_ not in deck["slides"] or not lid_:
                raise SystemExit(f"--layout {item}: expected SLIDE=ID with a slide id of this deck")
            swaps[sid_] = lid_
        tm = (deck["meta"].get("preferences") or {}).get("text_mode")
        tm = tm.get("mode") if isinstance(tm, dict) else tm
        asked_tm = a.text_mode or (deck_ctx or {}).get("text_mode")
        if asked_tm in spec.TEXT_MODES:   # the person's choice (or the document's): condense lets the loop move points to the notes and shorten; absent: the loop does neither (a paid shorten needs the explicit choice) while the plan's density still moves points to the notes unless preserve
            tm = asked_tm
            deck["meta"].setdefault("preferences", {})["text_mode"] = {"mode": tm, "source": "person" if a.text_mode else "default"}
        pinned_ids = _stamp_pinned(a, deck, deck_ctx)
        loop_on = not a.no_repair and not a.no_qa and a.until is None and not web_render()
        policy = repair.load_policy(profile, a.repair_policy) if loop_on else None
        stop_for_shorten = loop_on and bool(policy["max_rounds"]) and repair.shorten_available(tm, a.audience, a.live, a.approve_shorten, a.stages, repair.approval_id(deck), (policy["shorten"] or {}).get("word_rule", "delete_only"))[0]
        if spec.LOOK_V3 and (a.pictures or supplied):   # deck-look step 7: measure where words may sit on the cover's and the idea's pictures (Pillow, free)
            from . import theme as _themes
            _th = _themes.get_theme(_themes.DEFAULT, deck["meta"].get("brand") or {})
            zones = images.solve_text_zones(deck, images.source_paths(deck, a.audience, [a.stages], sources), ink=_th.ink, paper=_th.on_dark, canvas=themes.canvas(size))
            if zones:
                rep["text_zones"] = {sid: z for sid, z in zones}
        base_deck = deck   # pictures are already bound here: the repair loop re-plans from this deck and never asks for a picture
        rprefs = _recipe_prefs(profile, a.format)   # deck-types: the recipe's layout preferences ({} with the flag off)
        replan = lambda d: layouts.plan(d, prefs={"density": level, "text_mode": tm, "repair": bool(stop_for_shorten), "notes": not a.no_notes, **rprefs}, swaps=swaps)   # noqa: E731
        deck, plan_issues, _pending = replan(base_deck)
        if layouts.unmade_planned(deck):   # slots planned for pictures nobody has paid for: back to empty (in the base deck too, so a repair round never plans them), then plan again without them (free, in code)
            imagegen.unplan(base_deck, rep.get("images") or {})
            deck, plan_issues, _pending = replan(base_deck)
        rungs = (deck["meta"].get("layout_plan") or {}).get("rungs", {})
        rep["layout_plan"] = {"secs": round(time.time() - t, 3), "rungs": rungs, "variety_swaps": (deck["meta"].get("layout_plan") or {}).get("variety_swaps", 0), "skipped": ["condense"]}
        rep["stages"]["layout_plan"] = {"secs": round(time.time() - t, 3), "model": None, "usd": 0}
    else:   # no plan: a slot still planned for a picture nobody paid for goes back to empty here too, so deck.json holds no prompt or subject for it
        from . import layouts
        if layouts.unmade_planned(deck):
            imagegen.unplan(deck, rep.get("images") or {})
    t = time.time()
    findings = validate.run(deck, inp, a.audience) + stale_gen
    for x in plan_issues:   # the six slot and layout names, warn (slot_missing on a required slot: error)
        findings.append({k: v for k, v in (("check", x["check"]), ("level", x["level"]), ("slide", x["slide"]), ("slot", x.get("slot")),
                                           ("message", x["message"]), ("evidence", x.get("evidence"))) if v is not None})
    rep["validation"] = validate.summary(findings)
    ws = validate.weight_share_report(deck)   # the buyer's weights against the words spent on each criterion: record only
    if ws["rows"]:
        rep["weight_share"] = ws
    relay = validate.relay_test(deck)   # record only: no model, never blocks
    if relay:
        rep["relay_test"] = relay
    if deck["meta"].get("insight"):
        rep["insight"] = {**deck["meta"]["insight"], "candidates": len(deck["meta"].get("insight_candidates") or [])}
    rep["stages"]["validate"] = {"secs": round(time.time() - t, 2), "model": None, "usd": 0}
    (a.out / "deck.json").write_text(json.dumps(deck, indent=1, ensure_ascii=False, default=str))
    (a.out / "validation.json").write_text(json.dumps(findings, indent=1, ensure_ascii=False))
    if a.until == "deck":
        rep["slides"] = len(deck["order"])
        rep["slides_by_status"] = {s: sum(1 for x in deck["slides"].values() if x["status"] == s) for s in ("from_source", "drafted", "needs_human")}
        return _stopped(a, rep, t0, "deck")

    if a.audience == "client" and WITHHOLD_FAILING_CLIENT and any(f["level"] == "error" for f in findings):   # a client file with a failing check is never written
        return _withheld(a, rep, deck, findings, t0)

    pics, pic_findings, placed, icons = None, [], set(), {}
    if a.pictures or supplied or a.audience == "client":   # never ship what an earlier build left in a reused --out (a client folder above all)
        lg = (deck["meta"].get("theme") or {}).get("logo") or {}   # the cleared client logo is a deck asset, not a picture: it outlives the wipe
        lrec = (deck.get("assets") or {}).get(lg.get("asset")) or {}
        lfile = a.out / lrec["file"] if lrec.get("file") else None
        lbytes = lfile.read_bytes() if lfile and lfile.is_file() else None
        images.wipe_outputs(a.out)
        if lbytes is not None:
            lfile.parent.mkdir(parents=True, exist_ok=True)
            lfile.write_bytes(lbytes)
    if a.pictures or supplied:   # only what this audience draws is copied or derived: a client folder holds no byte of an unapproved picture
        try:
            pics = images.copy_assets(deck, a.out, a.audience, [a.stages], sources)
        except images.ImageError as e:
            raise SystemExit(f"refused: {e}")
    t = time.time()
    pptx = render_pptx.render(deck, inp, a.out / "deck.pptx", a.master, findings, animate=a.animate or False, layouts_out=a.out / "layouts.json", pictures=pics, picture_findings=pic_findings, placed=placed,
                              notes=not a.no_notes, no_plan=a.no_layout_plan, icons=icons, clean=a.clean_export, protect=_protect_boxes(a, deck) if size != spec.SIZE_DEFAULT else None)
    if pic_findings:   # a slide drawn without its picture because it would not fit beside it: say so in the findings
        for f in pic_findings:
            f["slide_no"] = deck["order"].index(f["slide"]) + 1
        findings.extend(pic_findings)
        rep["validation"] = validate.summary(findings)
        (a.out / "validation.json").write_text(json.dumps(findings, indent=1, ensure_ascii=False))
    rep["stages"]["render_pptx"] = {"secs": round(time.time() - t, 2), "model": None, "usd": 0}

    t = time.time()
    render_web.render(deck, inp, a.out / "deck.html", findings, pictures=pics, placed=placed if pics else None, look=not a.no_layout_plan, icons=icons,
                      clean=a.clean_export)
    if a.hyperframes:
        render_hyperframes.render(deck, inp, a.out / "hyperframes", findings, builds=a.builds, pictures=pics, placed=placed if pics else None, look=not a.no_layout_plan)
    rep["stages"]["render_web"] = {"secs": round(time.time() - t, 2), "model": None, "usd": 0}

    web_only = web_render()
    if not web_only:
        t = time.time()
        to_pdf(pptx, a.out)   # a private profile per call: a shared one made a second LibreOffice exit 0 with no PDF
        (a.out / "png").mkdir(exist_ok=True)   # pdftoppm overwrites by name; nothing is deleted
        subprocess.run(["pdftoppm", "-png", "-r", "60", str(a.out / "deck.pdf"), str(a.out / "png" / "slide")], check=True)
        rep["stages"]["render_pdf_png"] = {"secs": round(time.time() - t, 2), "model": None, "usd": 0}
    else:
        rep["qa"] = NO_PPTX_CHECK

    # ---- stage h: rendered-slide QA (qa_render.py). It never blocks the build: a finding is only reported. ----
    if not a.no_qa and not web_only:
        t = time.time()
        qa = (qa_seam or qa_render.run)(pptx, a.out / "deck.pdf", a.out, findings)
        qa = repair.stamp_qa(a.out, qa)   # deck_sha: the hash of the deck.json these checks read (the same stamp in every round folder)
        rep["qa"] = _qa_line(qa["summary"], len(deck["order"]))
        rep["stages"]["qa_render"] = {"secs": round(time.time() - t, 2), "model": None, "usd": 0}
        print(rep["qa"])
        if loop_on:
            deck, findings, placed = _repair(a, inp, profile, deck, findings, qa, pics, placed, rep, base_deck, pinned_ids, swaps, level, tm, policy, pptx)
    # ---- end stage h ----

    if spec.GRAPHICS:   # deck-graphics: what the FINAL render drew (after any repair round) and, for a deck with no chart or diagram, why
        from . import graphics   # noqa: PLC0415
        rep["graphics"] = graphics.report(deck, a.out / "layouts.json", a.out / "deck.pptx")
    rep["slides"] = len(deck["order"])
    rep["slides_by_status"] = {s: sum(1 for x in deck["slides"].values() if x["status"] == s) for s in ("from_source", "drafted", "needs_human")}
    _close(a, rep, t0)
    print(json.dumps({k: rep[k] for k in ("slides", "slides_by_status", "validation", "wall_secs", "usd_total")}, indent=1))
    return rep


if __name__ == "__main__":
    main()
