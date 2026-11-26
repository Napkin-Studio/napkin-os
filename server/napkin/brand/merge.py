"""The model's readings -> one candidate Brand Bible (contract 2.2), checked field by field.

Pure functions: the pieces the model read (colours, type, voice, imagery per run of pages) and what it said each picture is, in; a
candidate out, with `gaps` for every section the file did not give. Nothing is invented here either: an invalid hex, an unknown
role or a picture the model never saw is dropped, and what is dropped is never repaired into something that looks real."""

import hashlib
import re

from .ids import Ids

ROLES = ("accent", "paper", "ink", "panel", "accent_ink", "chart", "other")
VARIANTS = ("light", "dark", "mark", "other")
TYPE_ROLES = ("head", "body", "other")
EXT = {"image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp", "image/svg+xml": "svg"}
LIMITS = {"colours": 24, "typography": 12, "rules": 40, "bans": 30, "logos": 12, "examples": 12}


def clip(s, n: int) -> str:
    t = re.sub(r"\s+", " ", str(s or "")).strip()
    if len(t) <= n:
        return t
    cut = t[: n - 1].rsplit(" ", 1)[0] or t[: n - 1]
    return cut.rstrip(" ,;:") + "…"


def norm(s) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(s or "").lower()).strip()


def hex_of(v) -> str | None:
    h = str(v or "").strip()
    m = re.fullmatch(r"#?([0-9a-fA-F]{6}|[0-9a-fA-F]{3})", h)
    if not m:
        return None
    d = m.group(1)
    if len(d) == 3:
        d = "".join(c * 2 for c in d)
    return "#" + d.upper()


def colours(pieces: list) -> list:
    out, seen, ids = [], {}, Ids()
    for p in pieces:
        for c in p.get("colours") or []:
            h = hex_of(c.get("hex"))
            if not h:
                continue
            role = c.get("role") if c.get("role") in ROLES else "other"
            if h in seen:
                if seen[h]["role"] == "other" and role != "other":
                    seen[h]["role"] = role
                continue
            if len(out) >= LIMITS["colours"]:
                continue
            name = clip(c.get("name"), 40) or h
            item = {"id": ids.take(name), "name": name, "hex": h, "role": role}
            seen[h] = item
            out.append(item)
    return out


def typography(pieces: list) -> list:
    out, seen, ids = [], set(), Ids()
    for p in pieces:
        for t in p.get("typography") or []:
            fam = clip(t.get("family"), 80)
            if not fam or norm(fam) in seen or len(out) >= LIMITS["typography"]:
                continue
            seen.add(norm(fam))
            item = {"id": ids.take(fam), "family": fam}
            if clip(t.get("weight"), 40):
                item["weight"] = clip(t.get("weight"), 40)
            if clip(t.get("use"), 80):
                item["use"] = clip(t.get("use"), 80)
            item["role"] = t.get("role") if t.get("role") in TYPE_ROLES else "other"
            out.append(item)
    return out


def rules(pieces: list) -> list:
    out, seen, ids = [], set(), Ids()
    for p in pieces:
        for r in p.get("rules") or []:
            text = clip(r.get("text"), 300)
            if not text or norm(text) in seen or len(out) >= LIMITS["rules"]:
                continue
            seen.add(norm(text))
            item = {"id": ids.take(" ".join(norm(text).split()[:5]) or "rule"), "text": text}
            if r.get("kind") in ("do", "dont"):
                item["kind"] = r["kind"]
            out.append(item)
    return out


def bans(pieces: list) -> list:
    out, seen = [], set()
    for p in pieces:
        for b in p.get("imagery_bans") or []:
            t = clip(b, 200)
            if t and norm(t) not in seen and len(out) < LIMITS["bans"]:
                seen.add(norm(t))
                out.append(t)
    return out


def first(pieces: list, key: str, n: int) -> str:
    for p in pieces:
        t = clip(p.get(key), n)
        if t:
            return t
    return ""


def pictures(classified: list, images: dict) -> tuple[list, list, dict]:
    """(logos, examples, uploads): each picture the model saw, by id; `asset` is `upload:<name>` until the host names it."""
    logos, examples, uploads, seen = [], [], {}, set()
    lid, eid = Ids(), Ids()
    for c in classified:
        im = images.get(c.get("image_id"))
        if im is None or c.get("use") not in ("logo", "example"):
            continue
        digest = hashlib.sha256(im.data).hexdigest()
        if digest in seen:
            continue
        ext = EXT.get(im.media_type, "bin")
        if c["use"] == "logo" and len(logos) < LIMITS["logos"]:
            label = clip(c.get("label"), 60) or "Logo"
            variant = c.get("variant") if c.get("variant") in VARIANTS else "other"
            i = lid.take(label)
            name = f"logo-{i}.{ext}"
            item = {"id": i, "label": label, "variant": variant, "asset": f"upload:{name}"}
            if clip(c.get("note"), 200):
                item["note"] = clip(c.get("note"), 200)
            logos.append(item)
        elif c["use"] == "example" and len(examples) < LIMITS["examples"]:
            i = eid.take("example")
            name = f"example-{i}.{ext}"
            item = {"id": i, "asset": f"upload:{name}"}
            if clip(c.get("note"), 200):
                item["note"] = clip(c.get("note"), 200)
            examples.append(item)
        else:
            continue
        seen.add(digest)
        uploads[name] = (im.data, im.media_type)
    return logos, examples, uploads


def assemble(name: str, pieces: list, classified: list, images: dict, saw_pictures: bool) -> tuple[dict, dict]:
    """-> (candidate, uploads {asset name: (bytes, media type)}). The candidate omits every section the file did not give and lists it in gaps."""
    cols, types, rls, bns = colours(pieces), typography(pieces), rules(pieces), bans(pieces)
    logos, examples, uploads = pictures(classified, images)
    tone, style, logo_note = first(pieces, "tone", 400), first(pieces, "imagery_style", 400), first(pieces, "logo_note", 300)
    visual = {k: v for k, v in (("logos", logos), ("logo_note", logo_note), ("colours", cols), ("typography", types)) if v}
    voice = {k: v for k, v in (("tone", tone), ("rules", rls)) if v}
    imagery = {k: v for k, v in (("style", style), ("bans", bns), ("examples", examples)) if v}
    cand = {"name": name}
    for key, sec in (("visual", visual), ("voice", voice), ("imagery", imagery)):
        if sec:
            cand[key] = sec
    gaps = []
    if not logos:
        gaps.append({"area": "logos", "note": "No logo files could be taken from the file." if saw_pictures
                     else "The file held no pictures to take a logo from."})
    if not cols:
        gaps.append({"area": "colours", "note": "The file gives no colour values (hex) to take."})
    if not types:
        gaps.append({"area": "typography", "note": "The file names no typefaces."})
    if not (tone or rls):
        gaps.append({"area": "voice", "note": "The file says nothing about tone or writing rules."})
    if not (style or bns or examples):
        gaps.append({"area": "imagery", "note": "The file says nothing about the style of pictures."})
    if gaps:
        cand["gaps"] = gaps
    return cand, uploads


def has_content(cand: dict) -> bool:
    return any(cand.get(k) for k in ("visual", "voice", "imagery"))


def resolve_assets(cand: dict, paths: dict) -> dict:
    """Swap each `upload:<name>` for the path the host gave the stored file (`human/assets/<unique name>`)."""
    def fix(v):
        if isinstance(v, str) and v.startswith("upload:"):
            return paths[v[len("upload:"):]]
        if isinstance(v, list):
            return [fix(x) for x in v]
        if isinstance(v, dict):
            return {k: fix(x) for k, x in v.items()}
        return v
    return fix(cand)


def safe_name(name: str) -> str:
    n = re.sub(r"[^A-Za-z0-9._ -]+", "-", str(name or "file")).strip(" .-")[:120]
    return n or "file"
