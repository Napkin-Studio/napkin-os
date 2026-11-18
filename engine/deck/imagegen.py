"""Pictures for the slots still empty: planning, the subject call's request, the cost cards, making and recording (deck-image-gen).

This module may reach the network (through ``visuals.runway`` and ``visuals.guard``, both injected in tests); ``deck.images`` may not, which is
why the generation lives here. Sai's rules of 17 Nov 2026 are enforced in code, in this order of what a person sees:

1. Stage g (one Claude call per deck writes the subjects) has its own card and runs only on a yes to that card. It counts inside the cap.
2. The picture card shows every prompt in full. A yes is ``--yes-cost <card id>``: the id covers exactly the jobs, models, ratios, cap and
   spend it was made from, so a changed plan has a new id and an old id is refused.
3. Drafts use flash; pro runs only for an approved, guard-checked hero a person asked for. Both are pinned in ``visuals.runway.TIER_MODEL``.
4. Nothing is made while a part marked Confidential could be drawn: with no mark data the deck is refused; marked text never enters stage g;
   every subject, note and style block passes the allow-list lint (``visuals.lint``) and the deny-list of the marked texts.
5. Nothing is remade automatically: a failure, a flag or a Style Pack change reaches a card and waits for a person.

The recorded outputs are ``<stages>/g_image_subjects.json`` (stage g) and ``<stages>/generated.json`` plus ``<stages>/assets/`` (what slice 3's
images pass reads, like frames.json). The API key is read by ``visuals.runway.api_key`` at the first create only.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
from pathlib import Path

from visuals import guard as vguard
from visuals import jobs, lint, runway, safety
from visuals import style as vstyle

from . import images, spec

RAILS_VERSION = "1"
DECK_RAILS = "No recognisable real people or public figures. No charts, graphs, diagrams, numbers or screens with content."
SUBJECT_MAX, PROMPT_MAX = images.SUBJECT_MAX, images.PROMPT_MAX
MODES = ("off", "subjects", "plan", "live")
#: The slides whose dominant picture may become a hero: the cover, the idea, and any slide laid out full bleed.
HERO_TYPES = ("title", "idea")
HERO_LAYOUTS = ("full_bleed_statement", "cover_image")
#: What a slot's slide type asks of the composition (the line before the style block).
COMPOSITION = {"title": "Keep the lower third calm and uncluttered.", "appendix": "Keep the left third calm and uncluttered.",
               "real_question": "Keep the left third calm and uncluttered.", "close": "Keep the left third calm and uncluttered.",
               "idea": "Medium shot, one moment.", "audience": "Medium shot, one moment.", "territory": "Medium shot, one moment.",
               "execution": "Wide frame, one clear focal point.", "solution": "Medium shot, one moment.", "product": "Medium shot, one moment."}
#: deck-look step 7 (spec.LOOK_V3): a slot whose layout may set words over its picture (the cover, the idea, the real question) asks for
#: the zone the finder tries first to be calm. Prompt text only: the subjects request keeps COMPOSITION (its request_sha and every
#: recorded subject stay valid), nothing new is asked for or paid, and the finder still measures what comes back (images.text_zone).
TEXT_ZONE_HINT = {"title": "Keep the lower left calm, plain and uncluttered.",
                  "idea": "Medium shot, one moment. Keep the lower left calm, plain and uncluttered.",
                  "real_question": "Keep the left third calm and uncluttered."}
ILLUSTRATION_LINE = "An illustration, not a photograph."


def composition(slide_type: str) -> str:
    """The composition line of a picture's prompt: the text-zone hint under the look (TEXT_ZONE_HINT), else COMPOSITION."""
    if spec.LOOK_V3 and slide_type in TEXT_ZONE_HINT:
        return TEXT_ZONE_HINT[slide_type]
    return COMPOSITION.get(slide_type, "Medium shot, one moment.")
#: Code templates: every word is on the allow-list, so they are the fallback a failed subject lands on and the preview before stage g.
TEMPLATES = {"title": "A quiet morning scene with soft light and a clear subject.", "appendix": "An empty room with soft light and a window.",
             "real_question": "A person at a window, seen from behind, in soft morning light.", "close": "A door open to a bright street in the morning.",
             "idea": "A simple everyday thing in soft light, with a clear focal point.", "audience": "An ordinary kitchen table in the morning, with a cup and a window.",
             "territory": "A calm everyday scene that holds the mood of the idea.", "execution": "A street with a blank wall and soft light.",
             "solution": "A simple everyday thing in soft light, with a clear focal point.", "product": "A simple everyday thing in soft light, with a clear focal point."}
STAGE_G_FILE = "g_image_subjects.json"
#: The layout library (slice 4) has no layout that draws ONE picture on a territory slide (frames_strip needs all four frames), so a mood picture made for
#: a territory would be paid for and never shown. Until a layout draws it, those slots are held back with that reason. Flip when the library gains one.
TERRITORY_PICTURE_DRAWN = False
#: Test seams (all None in service): a Runway client factory, the stage g call, the guard's post and the poll sleep. Tests set them; nothing else does.
CLIENT_FACTORY = SUBJECTS_CALL = GUARD_POST = SLEEP = None


class GenError(ValueError):
    """Generation is refused. The message says why and what to do."""


# ---------------------------------------------------------------------------------------------------------- words and anchors

from .bench.checklist import words_sha   # noqa: E402 (the ONE hash of a deck's words: the checklist's)


anchors, anchor_key = images.anchors, images.anchor_key


# ---------------------------------------------------------------------------------------------------------- candidates

def hero_eligible(deck: dict, sid: str, slot: str) -> bool:
    s = deck["slides"].get(sid) or {}
    return slot == "picture" and (s.get("type") in HERO_TYPES or ((s.get("layout") or {}).get("id") in HERO_LAYOUTS))


#: deck-types slice 4: which slides a recipe's ``pictures.generate`` lets generation plan for (None: every picture slide).
GENERATE_TYPES = {"all": None, "cover": ("title",), "none": ()}


def candidate_slots(deck: dict, territories=None, generate: str = "all") -> list:
    """The image slots generation may fill: ``[{sid, slot, aspect, anchor, key, kind}]``. A slot named ``picture`` that is empty. A territory slide
    with no frame at all gets one mood picture slot (kind photo, 4:3); ``frame_n`` slots are never generated. ``generate`` (deck-types: the type's
    recipe, profiles.picture_policy) narrows it: ``cover`` plans the cover only (a credentials deck never gets a generated person or case),
    ``none`` plans nothing (a tender); ``all`` is today. Narrowing only: it never opens a slot, raises the cap or approves anything."""
    anc = anchors(deck, territories)
    only = GENERATE_TYPES.get(generate, None)
    out = []
    for sid in deck["order"]:
        s = deck["slides"][sid]
        if spec.picture_of(s)[0] not in spec.PICTURE_SLIDE_TYPES:
            continue
        if only is not None and spec.picture_of(s)[0] not in only:
            continue
        slots = s.setdefault("slots", {}) if s["type"] == "territory" else (s.get("slots") or {})
        if s["type"] == "territory":
            frames = [v for k, v in slots.items() if k.startswith("frame_") and isinstance(v.get("image"), dict)]
            if any(f["image"].get("status") not in ("empty",) for f in frames):
                continue
            if "picture" not in slots:
                slots["picture"] = {"kind": "image", "image": {"kind": "photo", "status": "empty", "aspect": "4:3", "basis": "creative",
                                                               "reason": "no picture yet: no territory run and none supplied"}}
        for name, v in (s.get("slots") or {}).items():
            im = v.get("image") if isinstance(v, dict) and v.get("kind") == "image" else None
            if not im or im.get("status") != "empty" or not name.startswith("picture") or im.get("kind") in ("frame", "screenshot", "logo"):
                continue
            if (im.get("from") or {}).get("kind") in ("upload", "territory_frame", "brand", "production"):   # production: a rights-pending pull leaves the plan too
                continue
            out.append({"sid": sid, "slot": name, "aspect": im["aspect"], "anchor": anc[sid], "key": anchor_key(anc[sid], name), "kind": im.get("kind") or "photo"})
    return out


# ---------------------------------------------------------------------------------------------------------- confidential marks

def askable(deck: dict, cands: list) -> list:
    """The candidates stage g is asked about: a slot that cannot be drawn (see TERRITORY_PICTURE_DRAWN) is not paid for."""
    return [c for c in cands if TERRITORY_PICTURE_DRAWN or deck["slides"][c["sid"]]["type"] != "territory"]


def mark_paths(inp) -> list:
    return [str(m.get("path", "")) for m in (inp.marks or [])]


def _marked_ref(refs, paths) -> bool:
    """Does a block's ``refs`` name a marked part? A ref ``brief:<field>`` names a brief field; the marks name data paths of the brief."""
    from .inputs import CLAN_FIELDS
    keys = []
    for p in paths:
        head = re.split(r"[.\[]", p)[0]
        keys += [head] + [fid for fid, k in CLAN_FIELDS.items() if k == head]
    for r in refs or []:
        r = str(r)
        if r.startswith("brief:") and any(r[6:].split(".")[0] == k for k in keys):
            return True
    return False


def creative_blocks(slide: dict, inp, deny: dict) -> list:
    """The words stage g may read from a slide: creative or proposal blocks only (no evidence, quote, figure or cited fact), and no block whose
    refs name a marked part or whose text would draw on one."""
    paths = mark_paths(inp)
    out = []
    for b in slide.get("blocks") or []:
        if b.get("basis") not in ("creative", "proposal") or b.get("refs") or b.get("kind") in ("quote", "stat", "table", "chart", "copy") or b.get("internal"):
            continue
        if _marked_ref(b.get("refs"), paths):
            continue
        txt = " ".join(x for x in (b.get("text"), " ".join(" ".join(map(str, r)) for r in b.get("items") or [] if isinstance(r, (list, tuple)))) if x).strip()
        if txt and not lint.confidential_hit(txt, deny):
            out.append(txt[:400])
    return out


def subject_request(deck: dict, inp, territories, cands: list, banned: list, deny: dict) -> dict:
    """What stage g is sent: per slot the slide type and title, its creative blocks, the territory's sketch and mood, the setting hint from
    the brief's tone and world (dropped when marked), the aspect and the composition role; and the banned imagery. Never a marked field."""
    from .inputs import CLAN_FIELDS
    marked_heads = {re.split(r"[.\[]", p)[0] for p in mark_paths(inp)}
    tone = ""
    if CLAN_FIELDS["tone_world_assets"] not in marked_heads and "tone_world_assets" not in marked_heads:
        v = (inp.brief.get("tone_world_assets") or {}).get("value")
        tone = (v if isinstance(v, str) else " ".join(map(str, v)) if isinstance(v, list) else "")[:300]
        if lint.confidential_hit(tone, deny):
            tone = ""
    tmap = {t.get("id"): t for t in territories or []}
    slots = []
    for c in cands:
        s = deck["slides"][c["sid"]]
        title = s.get("title") or ""
        row = {"key": c["key"], "slide_type": s["type"], "title": "" if lint.confidential_hit(title, deny) else title, "aspect": c["aspect"],
               "role": COMPOSITION.get(s["type"], "Medium shot, one moment."), "blocks": creative_blocks(s, inp, deny)}
        t = tmap.get(c["anchor"]["ref"]) if s["type"] == "territory" else None
        if t:
            row["sketch"] = "" if lint.confidential_hit(t.get("sketch") or "", deny) else str(t.get("sketch") or "")[:400]
            row["mood"] = "" if lint.confidential_hit(t.get("mood") or "", deny) else str(t.get("mood") or "")[:200]
        slots.append(row)
    return {"slots": slots, "setting": tone, "banned_imagery": banned}


def request_sha(req: dict) -> str:
    return hashlib.sha256(json.dumps(req, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:12]


def load_subjects(stages: Path, req: dict | None = None) -> dict | None:
    """The recorded stage g, or None. With ``req`` it must have been made for these inputs (its request hash): a recording for other words is
    stale and counts as missing, so a card asks again."""
    p = Path(stages) / STAGE_G_FILE
    if not p.is_file():
        return None
    obj = json.loads(p.read_text())
    if obj.get("stage") != "g" or not isinstance(obj.get("subjects"), dict):
        raise GenError(f"{p} is not a stage g file")
    if req is not None and obj.get("request_sha") != request_sha(req):
        return None
    return obj


# ---------------------------------------------------------------------------------------------------------- the style and safe messaging

def check_models(style) -> None:
    """The tiers are pinned in code: a Style Pack whose models map differently (draft to pro, anything else) is refused at plan time."""
    if dict(style.models) != dict(runway.TIER_MODEL):
        raise GenError(f"the Style Pack maps models {dict(style.models)}; pictures use only {dict(runway.TIER_MODEL)}. Fix the pack: a pack cannot change the tiers")


def safe_state(inp, deck: dict, review: dict | None) -> dict:
    """``{applies, packs, banned, reviewed, reason}``: banned imagery always applies; on a deck a safe-messaging pack applies to, nothing is
    made until ``review.safe_messaging`` {by, at, packs, words_sha, banned_sha} matches the deck's current words and banned list."""
    from . import validate
    packs = [p for p in validate.packs_for(inp) if p.get("banned_imagery")]
    banned = list(dict.fromkeys(b["text"] for p in packs for b in p["banned_imagery"]))
    out = {"applies": bool(packs), "packs": sorted(p["id"] for p in packs), "banned": banned, "reviewed": None, "reason": None}
    if not packs:
        return out
    rec = ((review or {}).get("safe_messaging") if isinstance(review, dict) else None) or {}
    now = {"packs": out["packs"], "words_sha": words_sha(deck), "banned_sha": safety.banned_sha(banned)}
    if images.APPROVER.match(str(rec.get("by") or "")) and rec.get("at") and all(rec.get(k) == v for k, v in now.items()):
        out["reviewed"] = {"by": rec["by"], "at": rec["at"]}
    else:
        out["reason"] = "needs a person's review of this sensitive brief first"
    return out


def record_safe_review(review: dict, inp, deck: dict, by: str, at: str | None = None) -> dict:
    """The CLI stand-in (--images-reviewed --by human:<id>): records the CURRENT hashes in ``review.safe_messaging``."""
    if not images.APPROVER.match(by or ""):
        raise GenError("--images-reviewed needs --by human:<id>: only a person reviews a sensitive brief")
    st = safe_state(inp, deck, None)
    if not st["applies"]:
        raise GenError("no safe-messaging pack applies to this deck: there is nothing to review")
    review["safe_messaging"] = {"by": by, "at": at or jobs.now(), "packs": st["packs"], "words_sha": words_sha(deck), "banned_sha": safety.banned_sha(st["banned"])}
    return review


# ---------------------------------------------------------------------------------------------------------- prompts

def clause(subject: str) -> str:
    first = re.split(r"[,;.]", subject, 1)[0].strip()
    return first[:110] or subject[:110]


def alt_for(subject: str, kind: str, names=()) -> str:
    return images.make_alt(f"{'Illustration' if kind == 'illustration' else 'Photo'}: {clause(subject)}", names)


def assemble_prompt(subject: str, composition: str, style_text: str, kind: str = "photo") -> str:
    parts = [subject.strip(), composition, ILLUSTRATION_LINE if kind == "illustration" else "", style_text, style_text and vstyle.GUARD_RAILS, DECK_RAILS]
    p = " ".join(" ".join(x for x in parts if x).split())
    if len(p) > PROMPT_MAX:
        raise GenError("the assembled prompt is over 2400 characters: shorten the Style Pack's words")
    return p


def style_text_for(style, banned: list) -> str:
    """The Style Pack block, with ``Never show:`` over every banned imagery; linted as a whole. A failure names the pack words to fix."""
    block = vstyle.style_block(style, banned)
    why = lint.lint_text(block, banned=[], allow=banned)
    if why:
        raise GenError(f"the Style Pack's words cannot go to a picture model: {why}. A person fixes the pack; nothing was sent")
    return block


# ---------------------------------------------------------------------------------------------------------- the plan

class Ctx:
    """Everything one run of the image step reads. Built by run_deck; tests build it directly."""

    def __init__(self, deck, inp, territories, style, stages, cache, ledger, deck_id, review=None, approver=None, cap_usd=None, subjects=None,
                 banned_extra=(), territory_usd=0.0, names=(), generate: str = "all"):
        self.deck, self.inp, self.territories, self.style = deck, inp, territories or [], style
        self.stages, self.cache, self.ledger, self.deck_id = Path(stages), Path(cache), ledger, deck_id
        self.review, self.approver, self.subjects = review or {}, approver, subjects
        self.cap = min(float(cap_usd if cap_usd is not None else jobs.CAP_DEFAULT_USD), jobs.CAP_MAX_USD,
                       float(os.environ.get("NAPKIN_DECK_IMAGES_MAX_USD") or jobs.CAP_DEFAULT_USD))
        self.banned_extra, self.territory_usd, self.names = list(banned_extra), territory_usd, list(names)
        self.generate = generate if generate in GENERATE_TYPES else "all"   # deck-types: the recipe's picture policy (narrowing only)
        self.manifest = jobs.load_manifest(self.cache)


def decisions(review: dict, approver: str | None) -> dict:
    """The person's latest decision per asset: ``review.assets.<asset id>`` and the older ``review.images.<slide>.<slot>`` entry (read as one more
    decision for the asset it names). Only the approver's count. ``{asset id: {decision, by, at, note, slide, slot}}``."""
    out = {}

    def take(aid, d, slide=None, slot=None):
        if not (isinstance(d, dict) and aid and approver and images.APPROVER.match(approver) and d.get("by") == approver and d.get("at")
                and d.get("decision") in spec.IMAGE_DECISIONS):
            return
        if aid not in out or str(d["at"]) >= str(out[aid]["at"]):
            out[aid] = {**{k: d[k] for k in ("decision", "by", "at", "note") if d.get(k)}, "slide": slide or d.get("slide"), "slot": slot or d.get("slot")}
    r = review if isinstance(review, dict) else {}
    for aid, d in (r.get("assets") or {}).items():
        take(aid, d)
    for sid, slots in (r.get("images") or {}).items():
        for slot, d in (slots or {}).items():
            if isinstance(d, dict):
                take(d.get("asset"), d, sid, slot)
    return out


def asset_id(sha: str) -> str:
    return "img_" + sha[:12]


def slot_jobs(manifest: dict, key: str, tier: str) -> list:
    return [(k, j) for k, j in (manifest.get("jobs") or {}).items() if j.get("tier") == tier and key in (j.get("slots") or [])]


def make_plan(ctx: Ctx, mode: str = "plan", hero: list | None = None, remake_style: bool = False, remake: list | None = None) -> dict:
    """The whole decision, with no network: which slots are made already, which go on a card, which are held back and why, the prompts in full.
    ``remake``: ``SLIDE.SLOT`` names a person asked to make again (--remake): each goes on the card as a new attempt, from the recorded subject.
    Returns the plan (also what plan.json holds)."""
    deck, inp = ctx.deck, ctx.inp
    remake = {str(x) for x in (remake or ())}
    if inp.marks is None:
        raise GenError("picture generation is refused: this deck has no mark data, so it cannot be known whether a prompt would draw on a part marked "
                       "Confidential. Give the marks (--marks FILE, or build from the document) even when none are marked: an empty list is a real answer")
    check_models(ctx.style)
    safe = safe_state(inp, deck, ctx.review)
    banned = list(dict.fromkeys([*safe["banned"], *ctx.style.banned_imagery, *ctx.banned_extra]))
    deny = lint.deny_list(inp.marks)
    cands = candidate_slots(deck, ctx.territories, ctx.generate)
    req = subject_request(deck, inp, ctx.territories, askable(deck, cands), banned, deny)
    rec = ctx.subjects if ctx.subjects is not None else load_subjects(ctx.stages, req)
    style_text = style_text_for(ctx.style, banned)
    refs = [r.sha256 for r in vstyle.sendable(ctx.style)]
    dec = decisions(ctx.review, ctx.approver)
    plan = {"version": 1, "deck_id": ctx.deck_id, "rails_version": RAILS_VERSION, "words_sha": words_sha(deck), "style": {"hash": ctx.style.hash, "source": ctx.style.source},
            "safe_messaging": {k: safe[k] for k in ("applies", "packs", "reviewed")}, "stage_g": {"recorded": rec is not None, "request_sha": request_sha(req)},
            "cap_usd": ctx.cap, "slots": {}, "banned_imagery": banned}
    if mode == "subjects" or rec is None:   # before stage g exists the prompts are code templates, marked as a preview
        subj = {}
    else:
        subj = rec["subjects"]
    held_style = (deck["meta"].get("style_hold") or {}).get("reason")
    for c in cands:
        s = deck["slides"][c["sid"]]
        row = {"slide": c["sid"], "slot": c["slot"], "anchor": c["anchor"], "key": c["key"], "aspect": c["aspect"], "tier": "draft", "status": "planned",
               "references_sent": len(refs)}
        plan["slots"][c["key"]] = row
        if held_style:
            row.update(status="held", reason=f"the Style Pack could not be read: {held_style}"[:300])
            continue
        if safe["applies"] and not safe["reviewed"]:
            row.update(status="held", reason=safe["reason"])
            continue
        if s["type"] == "territory" and not TERRITORY_PICTURE_DRAWN:
            row.update(status="held", reason="no layout draws one picture on a territory slide yet, so it would be paid for and not shown")
            continue
        # a picture that exists already, and a person's decision on it
        prior = [(k, j) for k, j in slot_jobs(ctx.manifest, c["key"], "draft") if jobs.state(j, ctx.cache) == "saved"]
        cur, note = None, None
        if prior:
            k, j = sorted(prior, key=lambda kj: kj[1].get("created_at") or "")[-1]
            d = dec.get(asset_id(j["sha256"]))
            if d and d["decision"] == "remove":
                row.update(status="rejected", reason="a person asked to remove this picture", job=k)
                continue
            if d and d["decision"] == "replace":
                note = d.get("note")
                row.update(replacing=asset_id(j["sha256"]))
            elif f"{c['sid']}.{c['slot']}" in remake or c["key"] in remake:
                row.update(replacing=asset_id(j["sha256"]), remake="asked by a person (--remake)")
            else:
                cur = (k, j)
        if cur:
            stale = cur[1].get("style_hash") not in (None, ctx.style.hash)
            if not (stale and remake_style):
                row.update(status="made", job=cur[0], style_hash=cur[1].get("style_hash"))
                if stale:
                    row.update(optional="made with another Style Pack: add --remake-style to make it again")
                continue
        attempts = len([1 for _, j in slot_jobs(ctx.manifest, c["key"], "draft")   # a job that may be charged (unknown) or is running keeps its attempt number, so it is seen again
                        if j.get("style_hash") in (None, ctx.style.hash) and jobs.state(j, ctx.cache) in ("saved", "failed")])
        if attempts >= jobs.DRAFT_MAX_ATTEMPTS:
            row.update(status="held", reason="two pictures were already tried for this slot: a person decides (no automatic retry)")
            continue
        got = (subj.get(c["key"]) or {}) if subj else {}
        kind = got.get("kind") if got.get("kind") in ("photo", "illustration") else c["kind"]
        subject = str(got.get("subject") or "")[:SUBJECT_MAX]
        source = "stage_g"
        why = lint.lint_text(subject, banned, deny) if subject else "no subject yet"
        if why:
            source = "template"
            if subj and subject:   # a subject was written and refused: never a silent fallback, the card and report.json say so
                row.update(subject_refused=why)
            subject = TEMPLATES.get(s["type"], TEMPLATES["territory"])
            if subj and why == "would draw on a Confidential part":
                row.update(status="held", reason="would draw on a Confidential part")
                continue
            if lint.lint_text(subject, banned, deny):
                row.update(status="held", reason="no safe subject could be written for this slot")
                continue
        if note:
            nwhy = lint.lint_text(note, banned, deny)
            if nwhy:
                row.update(status="held", reason=f"the Replace note was refused: {nwhy}")
                continue
            subject = f"{subject} Change: {note.strip().rstrip('.')}."[:SUBJECT_MAX + 120]
        comp = composition(s["type"])
        prompt = assemble_prompt(subject, comp, style_text, kind)
        ratio = runway.snap(c["aspect"], runway.TIER_MODEL["draft"], runway.TIER_SIZE["draft"])
        attempt = attempts + 1
        jk = runway.request_key(runway.TIER_MODEL["draft"], ratio, prompt, refs, f"{RAILS_VERSION}:{c['key']}", attempt)   # the slot is part of the request: two slots never share one picture
        row.update(subject=subject, subject_source=source, kind=kind, prompt=prompt, ratio=ratio, model=runway.TIER_MODEL["draft"], job=jk, attempt=attempt,
                   preview=(rec is None))
    # hero jobs, only when a person asked and everything holds
    plan["heroes"] = hero_plan(ctx, plan, hero or [], dec, refs, style_text)
    return plan


def hero_plan(ctx: Ctx, plan: dict, asked: list, dec: dict, refs: list, style_text: str) -> dict:
    """Hero jobs for the slots a person asked for (``slide.slot``), each with its refusal reason when it cannot go. A hero uses the approved
    draft's exact prompt and references; only the model and the ratio change."""
    out = {}
    total, per = jobs.hero_counts(ctx.manifest, ctx.ledger)
    for ask in asked:
        sid, _, slot = ask.partition(".")
        key = next((k for k, r in plan["slots"].items() if r["slide"] == sid and r["slot"] == slot), None)
        row = {"ask": ask}
        out[ask] = row
        if key is None:
            row["reason"] = "that slot is not a generated picture slot of this deck"
            continue
        r = plan["slots"][key]
        if not hero_eligible(ctx.deck, sid, slot):
            row["reason"] = "only the cover, the idea and a full-bleed slide can have a final picture"
            continue
        drafts = [(k, j) for k, j in slot_jobs(ctx.manifest, key, "draft") if jobs.state(j, ctx.cache) == "saved"]
        if not drafts:
            row["reason"] = "there is no draft picture for this slot yet"
            continue
        k, j = sorted(drafts, key=lambda kj: kj[1].get("created_at") or "")[-1]
        d = dec.get(asset_id(j["sha256"]))
        g = j.get("guard") or {}
        if not (d and d["decision"] == "approve"):
            row["reason"] = "the draft is not approved by the deck's approver yet"
        elif not (g.get("checked") and not g.get("flagged")):
            row["reason"] = "the draft was not checked clean by the guard (a final picture needs a checked, clean draft)"
        elif total >= jobs.HERO_MAX_JOBS:
            row["reason"] = f"the deck already has {jobs.HERO_MAX_JOBS} final-picture jobs, failures included"
        elif per.get(key, 0) >= jobs.HERO_MAX_PER_SLOT:
            row["reason"] = "this slot already had a final picture and one retry"
        elif not j.get("prompt"):
            row["reason"] = "the draft's prompt is not on record"
        if row.get("reason"):
            continue
        ratio = runway.snap(r["aspect"], runway.TIER_MODEL["hero"], runway.TIER_SIZE["hero"])
        prompt = j["prompt"]
        attempt = per.get(key, 0) + 1
        row.update(slide=sid, slot=slot, key=key, tier="hero", model=runway.TIER_MODEL["hero"], ratio=ratio, prompt=prompt, draft_job=k,
                   job=runway.request_key(runway.TIER_MODEL["hero"], ratio, prompt, refs, f"{RAILS_VERSION}:{key}", attempt), attempt=attempt)
        total += 1
        per[key] = per.get(key, 0) + 1
    return out


# ---------------------------------------------------------------------------------------------------------- cards

def _card_id(parts) -> str:
    return "c_" + hashlib.sha256(json.dumps(parts, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:16]


def build_cards(ctx: Ctx, plan: dict, retry_unknown: bool = False, remake_style: bool = False) -> dict:
    """The cards a person reads: ``subjects`` (while stage g is not recorded for these words), ``pictures`` (drafts) and ``heroes``. Each has an
    id covering exactly its jobs, models, ratios, the cap and the spend so far. The app does no arithmetic: it shows these."""
    spent = jobs.spent_usd(ctx.manifest, ctx.ledger)
    sends = jobs.send_count(ctx.manifest, ctx.ledger)   # the per-send nonce: after any send every earlier card id is stale, even if the spend came out equal
    cap = ctx.cap
    cards = {}
    if not plan["stage_g"]["recorded"]:
        usd = jobs.SUBJECTS_ESTIMATE_USD
        cards["subjects"] = {"kind": "subjects", "usd": usd, "spent_usd": spent, "cap_usd": cap, "left_usd": round(cap - spent - usd, 2),
                             "over_cap": spent + usd > cap + 1e-9, "rows": [{"what": "stage g: 1 model call writes the picture subjects", "usd": usd}],
                             "id": _card_id(["subjects", plan["stage_g"]["request_sha"], cap, spent, sends]), "plan_file": "plan.json"}
        return cards
    new, held, optional, unknown, over = [], [], [], [], []
    running = spent
    for k, r in plan["slots"].items():
        if r["status"] == "held" or r["status"] == "rejected":
            held.append(f"{r['slide']}.{r['slot']}: {r.get('reason')}")
        elif r["status"] == "planned":
            j = ctx.manifest["jobs"].get(r["job"])
            st = jobs.state(j, ctx.cache) if j else "new"
            if st == "unknown":
                unknown.append(r["job"])
                if not retry_unknown:
                    continue
            elif st != "new":
                continue
            price = runway.credits_for(r["model"], runway.TIER_SIZE["draft"]) * jobs.USD_PER_CREDIT
            if running + price > cap + 1e-9:
                over.append(f"{r['slide']}.{r['slot']}")
                continue
            running += price
            new.append(r)
        elif r.get("optional"):
            optional.append(f"{r['slide']}.{r['slot']}: {r['optional']}")
    usd = round(sum(runway.credits_for(r["model"], "1K") * jobs.USD_PER_CREDIT for r in new), 2)
    cards["pictures"] = {"kind": "drafts", "rows": [{"model": runway.TIER_MODEL["draft"], "tier": "draft", "n": len(new), "credits_each": 7, "usd": usd}],
                         "usd": usd, "spent_usd": spent, "cap_usd": cap, "left_usd": round(cap - spent - usd, 2), "held_back": held, "optional": optional,
                         "unknown": unknown, "over_cap": over, "territory_usd_info": ctx.territory_usd,
                         "prompts": {f"{r['slide']}.{r['slot']}": r["prompt"] for r in new}, "jobs": [r["job"] for r in new], "plan_file": "plan.json",
                         "preview": any(r.get("preview") for r in new),
                         "id": _card_id(["drafts", [(r["job"], r["model"], r["ratio"]) for r in new], cap, spent, sends, bool(retry_unknown)])}
    refused_subjects = [f"{r['slide']}.{r['slot']}: description refused ({r['subject_refused']}), generic used" for r in plan["slots"].values() if r.get("subject_refused")]
    cards["pictures"]["refused_subjects"] = refused_subjects
    cards["pictures"]["remade"] = [f"{r['slide']}.{r['slot']}" for r in new if r.get("remake")]
    heroes = [h for h in plan.get("heroes", {}).values() if h.get("job")]
    refused = [f"{h['ask']}: {h['reason']}" for h in plan.get("heroes", {}).values() if h.get("reason")]
    if heroes or refused:
        hu = round(sum(runway.credits_for(h["model"], "2K") * jobs.USD_PER_CREDIT for h in heroes), 2)
        cards["heroes"] = {"kind": "heroes", "rows": [{"model": runway.TIER_MODEL["hero"], "tier": "hero", "n": len(heroes), "credits_each": 20, "usd": hu}], "usd": hu,
                           "spent_usd": spent, "cap_usd": cap, "left_usd": round(cap - spent - hu, 2), "held_back": refused,
                           "over_cap": spent + hu > cap + 1e-9, "prompts": {h["ask"]: h["prompt"] for h in heroes}, "jobs": [h["job"] for h in heroes],
                           "id": _card_id(["heroes", [(h["job"], h["model"], h["ratio"]) for h in heroes], cap, spent, sends])}
    return cards


def render_card(card: dict) -> str:
    """The card as the CLI prints it."""
    if card["kind"] == "subjects":
        return (f"SUBJECT CARD  card {card['id']}\n  stage g: 1 Claude call writes the picture subjects   ~${card['usd']:.2f}   (counts inside this deck's cap)\n"
                f"  preview prompts (code templates, NOT what will be sent): <cache>/plan.json\n  spent ${card['spent_usd']:.2f} | cap ${card['cap_usd']:.2f} | "
                f"left after this card ${card['left_usd']:.2f}     yes: --images subjects --yes-cost {card['id']}")
    word = {"drafts": "PICTURE COST CARD", "heroes": "FINAL PICTURE COST CARD"}[card["kind"]]
    lines = [f"{word}  card {card['id']}  (estimate; nothing is made until you say yes)"]
    for r in card["rows"]:
        lines.append(f"  {r['model']}  {r['tier']}  {r['n']} new x {r['credits_each']} credits = {r['n'] * r['credits_each']} credits  ${r['usd']:.2f}")
    for h in card.get("refused_subjects") or []:
        lines.append(f"  {h}")
    if card.get("remade"):
        lines.append(f"  Made again at a person's ask (--remake): {', '.join(card['remade'])}")
    for h in card.get("held_back") or []:
        lines.append(f"  Held back, no cost: {h}")
    for o in card.get("optional") or []:
        lines.append(f"  Optional, not included: {o}")
    if card.get("unknown"):
        lines.append(f"  Unknown, may already be charged: {len(card['unknown'])} (add --retry-unknown to put them on a card)")
    for o in card.get("over_cap") or []:
        lines.append(f"  Over the cap, not included: {o}")
    if card.get("territory_usd_info"):
        lines.append(f"  Territory frames already made for this pitch: ${card['territory_usd_info']:.2f} (for information; not counted in this deck's cap)")
    if card.get("preview"):
        lines.append("  Prompts below use code templates (stage g not recorded): preview, not final.")
    lines.append(f"  This card ${card['usd']:.2f} | spent on this deck ${card['spent_usd']:.2f} | cap ${card['cap_usd']:.2f} | left after this card ${card['left_usd']:.2f}")
    lines.append(f"  Every prompt, in full: <cache>/plan.json.   yes: --images live --yes-cost {card['id']}")
    return "\n".join(lines)


# ---------------------------------------------------------------------------------------------------------- making

def guard_fn(banned: list, safe: dict, post=None):
    """The local guard on a saved picture. It only adds flags. Unreachable: ``checked`` false ('not checked'); on a safe-messaging deck it
    flags the picture instead."""
    def check(data: bytes) -> dict:
        kw = {"post": post} if post is not None else {}
        g = vguard.check_image(data, banned or None, **kw)
        if safe.get("applies") and not g.get("checked"):
            return {**g, "flagged": True, "reason": "not checked on a sensitive brief: needs a person"}
        return g
    return check


def run_subjects(ctx: Ctx, plan: dict, call=None, log=print) -> dict:
    """Stage g, on a yes to the subject card: one Claude call, recorded to ``<stages>/g_image_subjects.json`` and written to the ledger BEFORE it is made
    (so the cap counts it even if the process dies). ``call(request) -> (obj, usage)`` is injected in tests; live it is ``stages.image_subjects``."""
    from . import stages as stg
    call = call or stg.image_subjects
    cands = candidate_slots(ctx.deck, ctx.territories, ctx.generate)
    banned = plan["banned_imagery"]
    req = subject_request(ctx.deck, ctx.inp, ctx.territories, askable(ctx.deck, cands), banned, lint.deny_list(ctx.inp.marks))
    key = "g_" + request_sha(req)
    with ctx.ledger.locked():
        spent = jobs.spent_usd(ctx.manifest, ctx.ledger)
        if spent + jobs.SUBJECTS_ESTIMATE_USD > ctx.cap + 1e-9:
            raise GenError(f"cap reached: ${spent:.2f} is spent of ${ctx.cap:.2f}; the subject call would pass it")
        ctx.ledger.append({"key": key, "tier": "subjects", "kind": "subjects", "estimate_usd": jobs.SUBJECTS_ESTIMATE_USD, "state": "creating"})
    obj, usage = call(req)
    subjects = {k: {"subject": str(v.get("subject") or ""), "kind": v.get("kind")} for k, v in (obj.get("subjects") or obj).items() if isinstance(v, dict)}
    usd = float((usage or {}).get("usd") or 0) or None
    rec = {"stage": "g", "produced_by": obj.get("produced_by") or "image_subjects", "request_sha": request_sha(req), "subjects": subjects, "usage": usage or {}}
    Path(ctx.stages).mkdir(parents=True, exist_ok=True)
    (Path(ctx.stages) / STAGE_G_FILE).write_text(json.dumps(rec, indent=1, ensure_ascii=False))
    with ctx.ledger.locked():
        ctx.ledger.append({"key": key, "tier": "subjects", "kind": "subjects", "usd": usd or jobs.SUBJECTS_ESTIMATE_USD, "state": "done"})
    ctx.manifest.setdefault("jobs", {})[key] = {"key": key, "kind": "subjects", "tier": "subjects", "usd": usd or jobs.SUBJECTS_ESTIMATE_USD, "state": "saved", "file": None}
    jobs.save_manifest(ctx.cache, ctx.manifest)
    log(f"stage g: {len(subjects)} subject(s) written")
    return rec


def make(ctx: Ctx, plan: dict, card: dict, client, retry_unknown=False, guard_post=None, sleep=None, log=print) -> dict:
    """Make exactly the jobs on ``card`` (draft or hero). Returns what ``jobs.generate`` returns."""
    import time as _t
    todo = []
    rows = plan["slots"] if card["kind"] == "drafts" else {h["key"]: h for h in plan["heroes"].values() if h.get("job")}
    for r in rows.values():
        if r.get("job") not in card["jobs"]:
            continue
        todo.append({"key": r["job"], "tier": r["tier"], "ratio": r["ratio"], "prompt": r["prompt"], "slots": [r["key"] if "key" in r else r["slot"]],
                     "ref_shas": [x.sha256 for x in vstyle.sendable(ctx.style)], "attempt": r.get("attempt", 1), "card": card["id"]})
    safe = {"applies": plan["safe_messaging"]["applies"]}
    refs_for = lambda j: vstyle.reference_images(ctx.style)  # noqa: E731
    res = jobs.generate(client, todo, ctx.cache, ctx.manifest, ctx.ledger, ctx.cap, refs_for, sleep=sleep or _t.sleep, retry_unknown=retry_unknown,
                        guard=guard_fn(plan["banned_imagery"], safe, guard_post), log=log)
    byjob = {r.get("job"): r for r in rows.values()}
    for j in todo:   # what each job was made with, for the record and for a later remake
        e = ctx.manifest["jobs"].get(j["key"])
        if e is not None:
            e.update(prompt=j["prompt"], style_hash=ctx.style.hash, card=card["id"], subject=byjob[j["key"]].get("subject"), subject_source=byjob[j["key"]].get("subject_source"),
                     subject_refused=byjob[j["key"]].get("subject_refused"), kind_hint=byjob[j["key"]].get("kind"))
    ctx.manifest.setdefault("cards", {})[card["id"]] = {"kind": card["kind"], "at": jobs.now(), "usd": card["usd"]}
    jobs.save_manifest(ctx.cache, ctx.manifest)
    return res


# ---------------------------------------------------------------------------------------------------------- the record for slice 3

def _inspect(path: Path) -> dict:
    return images.inspect_file(path)


def write_generated(ctx: Ctx, plan: dict) -> dict | None:
    """``<stages>/generated.json`` and ``<stages>/assets/``: every picture the cache holds for a slot of this deck (the frames.json pattern).
    Slice 3's images pass reads it. A slot with a made picture is listed; a hero is listed as its slot's candidate."""
    pics = {}
    adir = Path(ctx.stages) / "assets"
    for key, r in plan["slots"].items():
        for tier, jk in (("draft", r.get("job")), ("hero", None)):
            cands = slot_jobs(ctx.manifest, key, tier)
            saved = sorted([(k, j) for k, j in cands if jobs.state(j, ctx.cache) == "saved"], key=lambda kj: kj[1].get("created_at") or "")
            if tier == "draft":
                dec = decisions(ctx.review, ctx.approver)
                saved = [(k, j) for k, j in saved if (dec.get(asset_id(j["sha256"])) or {}).get("decision") not in ("remove", "replace")]
                if r["status"] == "rejected":
                    saved = []
                # a remade picture (a replace) is the newest draft; the older one is dropped
            for k, j in saved[-1:]:
                info = _inspect(Path(ctx.cache) / j["file"])
                adir.mkdir(parents=True, exist_ok=True)
                dst = adir / f"{info['sha256']}.{info['ext']}"
                shutil.copyfile(Path(ctx.cache) / j["file"], dst)
                g = j.get("guard") or {"checked": False, "flagged": False}
                pics[f"{key}#{tier}"] = {"anchor": r["anchor"], "slot": r["slot"], "key": key, "tier": tier, "model": j["model"], "prompt": j.get("prompt"),
                                         "subject": j.get("subject") or r.get("subject"), "subject_source": r.get("subject_source") or j.get("subject_source"),
                                         "subject_refusal": r.get("subject_refused") or j.get("subject_refused"), "file": f"assets/{info['sha256']}.{info['ext']}", "sha256": info["sha256"], "mime": info["mime"],
                                         "width": info["width"], "height": info["height"], "guard": g, "status": "flagged" if g.get("flagged") else "made", "job": k,
                                         "task": j.get("task"), "credits": j.get("cost_credits") or j.get("estimated_credits") or j.get("table_credits"),
                                         "at": j.get("created_at"), "style_hash": j.get("style_hash"), "kind": j.get("kind_hint") or r.get("kind") or "photo", "attempt": j.get("attempt", 1),
                                         "aspect": r["aspect"]}
    if not pics:
        p = Path(ctx.stages) / "generated.json"
        if p.exists():
            p.unlink()
        return None
    obj = {"stage": "generated", "produced_by": "deck.imagegen", "style": {"hash": ctx.style.hash}, "safe_messaging": plan["safe_messaging"],
           "words": plan["words_sha"], "pictures": pics}
    (Path(ctx.stages) / "generated.json").write_text(json.dumps(obj, indent=1, ensure_ascii=False))
    return obj


def write_plan(ctx: Ctx, plan: dict, cards: dict) -> Path:
    ctx.cache.mkdir(parents=True, exist_ok=True)
    p = ctx.cache / "plan.json"
    p.write_text(json.dumps({**plan, "cards": {k: {kk: vv for kk, vv in c.items() if kk != "prompts"} | {"prompts": c.get("prompts", {})} for k, c in cards.items()}},
                            indent=1, ensure_ascii=False))
    return p


def step(ctx: Ctx, mode: str, yes_cost: str | None = None, hero: list | None = None, retry_unknown=False, remake_style=False, client_factory=None,
         subjects_call=None, guard_post=None, sleep=None, out=print, remake=None) -> dict:
    """The whole image step for one build. ``mode``: ``subjects`` (the subject card, and stage g on a yes), ``plan`` (the picture card, no network),
    ``live`` (make exactly the jobs on the card the yes names). Writes plan.json and generated.json. Returns ``{plan, cards, made}``."""
    if mode not in MODES[1:]:
        raise GenError(f"--images {mode!r}: use subjects, plan or live")
    client_factory, subjects_call, guard_post, sleep = client_factory or CLIENT_FACTORY, subjects_call or SUBJECTS_CALL, guard_post or GUARD_POST, sleep or SLEEP
    plan = make_plan(ctx, mode, hero, remake_style, remake)
    cards = build_cards(ctx, plan, retry_unknown, remake_style)
    write_plan(ctx, plan, cards)
    made = None
    if "subjects" in cards:
        out(render_card(cards["subjects"]))
        if mode == "subjects" and yes_cost:
            if yes_cost != cards["subjects"]["id"]:
                raise GenError(f"--yes-cost {yes_cost} is not this card's id ({cards['subjects']['id']}): the plan changed or the id is wrong; nothing was made")
            run_subjects(ctx, plan, subjects_call, log=out)
            plan = make_plan(ctx, mode, hero, remake_style, remake)
            cards = build_cards(ctx, plan, retry_unknown, remake_style)
            write_plan(ctx, plan, cards)
        elif mode == "live":
            raise GenError("--images live is refused: stage g (the picture subjects) is not recorded for these words. Run --images subjects first and say yes to that card")
    for name in ("pictures", "heroes"):
        if name in cards:
            out(render_card(cards[name]))
    if mode == "live":
        want = [c for n, c in cards.items() if n in ("pictures", "heroes") and c["jobs"]]
        if yes_cost is None:
            if want:
                raise GenError("--images live needs --yes-cost <card id>: read the card above and say yes with its id; nothing was made")
        else:
            card = next((c for c in want if c["id"] == yes_cost), None)
            if card is None:
                ids = ", ".join(c["id"] for c in want) or "none: nothing is waiting"
                raise GenError(f"--yes-cost {yes_cost} matches no open card ({ids}): the plan changed or the id is wrong; nothing was made")
            if card["kind"] == "heroes" and card["over_cap"]:
                raise GenError("this card is over the cap: nothing was made")
            try:
                client = client_factory() if client_factory else runway.Client(runway.api_key())
            except runway.RunwayError as e:
                raise GenError(str(e)) from None
            made = make(ctx, plan, card, client, retry_unknown, guard_post, sleep, log=out)
            plan = make_plan(ctx, mode, hero, remake_style)   # no --remake now: the picture just made is current, never remade again by itself
            cards = build_cards(ctx, plan, retry_unknown, remake_style)
            write_plan(ctx, plan, cards)
    gen = write_generated(ctx, plan)
    return {"plan": plan, "cards": cards, "made": made, "generated": gen}


def mark_planned(deck: dict, plan: dict) -> int:
    """Write each slot the plan will make as ``planned`` (from generated, with its subject and prompt), so the layout picker can count it as a picture
    source (``layouts.picture_source``). Returns how many."""
    n = 0
    for r in plan["slots"].values():
        im = ((deck["slides"][r["slide"]].get("slots") or {}).get(r["slot"]) or {}).get("image")
        if r["status"] != "planned" or not im or im.get("status") != "empty":
            continue
        im.update(status="planned", **{"from": {"kind": "generated"}}, subject=r["subject"], prompt=r["prompt"], kind=r["kind"])
        im.pop("reason", None)
        n += 1
    return n


def unplan(deck: dict, info: dict) -> None:
    """Slots still planned after the image step go back to empty, with the reason. No placeholder box is drawn for them."""
    ids = ", ".join(c["id"] for c in (info.get("cards") or {}).values()) or "a card"
    for sid, s in deck["slides"].items():
        for v in (s.get("slots") or {}).values():
            im = v.get("image") if isinstance(v, dict) else None
            if im and im.get("status") == "planned":
                for k in ("subject", "prompt", "from"):
                    im.pop(k, None)
                im["status"] = "empty"
                im["reason"] = f"planned, waiting for a person's yes on {ids}"[:300]
