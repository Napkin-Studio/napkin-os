"""Check the Production Tool contracts: every schema is valid, the capability
sheets and examples match their schemas, the $refs between files resolve,
every examples/invalid/ case is refused, and the document rules a schema
cannot say (a key is its entity's id, a note window is 2 s or more and inside
its shot, every link is in common linkRule) hold.

    uv run --no-project --with jsonschema --with rfc3339-validator python production-tool/contracts/check.py
"""

import json
import re
import sys
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker
from referencing import Registry, Resource

HERE = Path(__file__).parent
BASE = "https://napkin.ie/production-tool/contracts/"

schemas = {p.name: json.loads(p.read_text()) for p in HERE.glob("*.schema.json")}
registry = Registry().with_resources(
    (BASE + name, Resource.from_contents(s)) for name, s in schemas.items()
)
COMMON = schemas["common.schema.json"]["$defs"]
LINK_RULE = COMMON["linkRule"]["const"]


def validator(name, pointer=""):
    schema = {"$ref": BASE + name + pointer} if pointer else schemas[name]
    return Draft202012Validator(schema, registry=registry, format_checker=FormatChecker())


# ── the rules JSON Schema cannot say ────────────────────────────────────────
# clan-store/src/integrity.ts checks these and more on every write; this is the
# same subset for the examples, so a bad example is caught without a browser.
def link_problem(link: dict, kinds_of_board: dict) -> str | None:
    """None when common linkRule allows the link, else why not (canLink's words)."""
    fk, tk, role = link["from"]["kind"], link["to"]["kind"], link["role"]
    for rule in LINK_RULE["rules"]:
        if fk in rule["from"] and tk in rule["to"] and role in rule["roles"]:
            purpose = rule.get("board_purpose")
            if purpose and kinds_of_board.get(link["from"]["id"]) != purpose:
                continue
            return None
    return f"no link rule lets a {fk} feed a {tk} as {role}"


def document_rules(doc: dict) -> list[str]:
    problems = []
    if not isinstance(doc, dict):
        return problems
    for name, value in doc.items():
        if not isinstance(value, dict) or name in ("project", "upstream"):
            continue
        for key, item in value.items():
            if any(c in key for c in ".[]#"):
                problems.append(f"{name}: the key {key!r} holds '.', '[', ']' or '#'")
            if name != "assets" and isinstance(item, dict) and item.get("id") != key:
                problems.append(f"{name}[{key}]: its id is {item.get('id')!r}, not its key")
            if name == "assets" and isinstance(item, dict) and item.get("sha256") != key:
                problems.append(f"assets[{key}]: its sha256 is not its key")
    shots = doc.get("shots") or {}
    for rid, r in (doc.get("reviews") or {}).items():
        w = r.get("window") if isinstance(r, dict) else None
        if not w:
            continue
        if w["to_s"] - w["from_s"] < 2:
            problems.append(f"reviews[{rid}].window: {w['to_s'] - w['from_s']} s is under the 2 s a fix needs")
        shot = shots.get(r.get("shot_id"))
        if shot and w["to_s"] > shot["duration_s"]:
            problems.append(f"reviews[{rid}].window ends at {w['to_s']} s, past its {shot['duration_s']} s shot (across a cut)")
    boards = {k: b.get("purpose") for k, b in (doc.get("boards") or {}).items() if isinstance(b, dict)}
    for lid, link in (doc.get("links") or {}).items():
        if isinstance(link, dict) and "from" in link:
            why = link_problem(link, boards)
            if why:
                problems.append(f"links[{lid}]: {why}")
    for qid, ask in (doc.get("asks") or {}).items():
        if isinstance(ask, dict) and ask.get("question", {}).get("id") != qid:
            problems.append(f"asks[{qid}]: its question's id is not its key")
    return problems


sys.path.insert(0, str(HERE))
import pricing  # noqa: E402  (contracts/pricing.py, standard library only)


def sheet_rules(sheet: dict) -> list[str]:
    """A capability sheet's rules a schema cannot say (features/runway-sheet-sync.clan): every op and
    alternate model is in the catalogue, at the model's endpoint, within its durations, outputs and
    ratios, and has a price at its defaults."""
    problems = []
    if not isinstance(sheet, dict):
        return problems
    models = sheet.get("models") or {}
    for op, spec in (sheet.get("ops") or {}).items():
        for s in [spec, *spec.get("alternates", [])]:
            name = s["model"]
            m = models.get(name)
            if m is None:
                problems.append(f"ops.{op}: {name} is not in models")
                continue
            if m.get("endpoint") and m["endpoint"] != s["endpoint"]:
                problems.append(f"ops.{op}: {name} is at {m['endpoint']}, not {s['endpoint']}")
            durations = s.get("durationsS", spec.get("durationsS") if s is not spec else None)
            if durations and m.get("durationsS") and not set(durations) <= set(m["durationsS"]):
                problems.append(f"ops.{op}: {name} durations {durations} are not all in the model's {m['durationsS']}")
            if s.get("outputs") and m.get("outputs") and not set(s["outputs"]) <= set(m["outputs"]):
                problems.append(f"ops.{op}: {name} outputs {s['outputs']} are not all in the model's {m['outputs']}")
            ratio = (s.get("defaults") or {}).get("ratio")
            if ratio and m.get("ratios") and ratio not in {r["ratio"] for r in m["ratios"]}:
                problems.append(f"ops.{op}: {name}'s default ratio {ratio} is not one the model takes")
            if pricing.op_usd(sheet, op, None if s is spec else name) is None:
                problems.append(f"ops.{op}: {name} has no price at its defaults {s.get('defaults')}")
        region = spec.get("regionModel")
        if region and region not in models:
            problems.append(f"ops.{op}: regionModel {region} is not in models")
    return problems


# What each instance file must match: (glob, schema file, $defs pointer, extra rules).
CASES = [
    ("capabilities/*.json", "capabilities.schema.json", "", sheet_rules),
    ("cost-model.json", "cost-model.schema.json", "", None),
    ("spend-policy.json", "spend-policy.schema.json", "", None),
    ("subprocessors.json", "subprocessors.schema.json", "", None),
    ("examples/pricing-cases.json", "pricing-cases.schema.json", "", None),
    ("examples/config.*.json", "config.schema.json", "", None),
    ("examples/job-request.*.json", "relay-api.schema.json", "#/$defs/JobRequest", None),
    ("examples/job.*.json", "relay-api.schema.json", "#/$defs/Job", None),
    ("examples/job-answer.json", "relay-api.schema.json", "#/$defs/JobAnswer", None),
    ("examples/answer-conflict.json", "relay-api.schema.json", "#/$defs/AnswerConflict", None),
    ("examples/library-entry.*.json", "relay-api.schema.json", "#/$defs/LibraryEntry", None),
    ("examples/library-index.json", "relay-api.schema.json", "#/$defs/LibraryIndex", None),
    ("examples/library-publish.*.json", "relay-api.schema.json", "#/$defs/LibraryPublish", None),
    ("examples/me.response.json", "relay-api.schema.json", "#/$defs/Me", None),
    ("examples/projects.response.json", "relay-api.schema.json", "#/$defs/ProjectList", None),
    ("examples/director.*.json", "director.schema.json", "", None),
    ("examples/customdata.*.json", "customdata.schema.json", "", None),
    ("examples/document*.json", "document.schema.json", "", document_rules),
    ("examples/patch-batch.*.json", "patch.schema.json", "#/$defs/PatchBatch", None),
    ("examples/patch-result.*.json", "patch.schema.json", "#/$defs/PatchResult", None),
    ("format-packs.json", "format-packs.schema.json", "", None),
]
# Each examples/invalid/<schema stem>.<case>.json must be refused by that schema (or its rules).
INVALID_TARGETS = {
    "capabilities": ("capabilities.schema.json", "", sheet_rules),
    "document": ("document.schema.json", "", document_rules),
    "job-request": ("relay-api.schema.json", "#/$defs/JobRequest", None),
    "job-answer": ("relay-api.schema.json", "#/$defs/JobAnswer", None),
    "patch-batch": ("patch.schema.json", "#/$defs/PatchBatch", None),
    "customdata": ("customdata.schema.json", "", None),
    "question": ("common.schema.json", "#/$defs/question", None),
    "director": ("director.schema.json", "", None),
}

failures = 0


def fail(msg: str):
    global failures
    failures += 1
    print(msg)


def problems_of(name, pointer, rules, data):
    errors = sorted(validator(name, pointer).iter_errors(data), key=str)
    out = [f"{'/'.join(map(str, e.absolute_path)) or '(root)'}: {e.message[:200]}" for e in errors]
    if rules and not errors:
        out += rules(data)
    return out


for name, schema in schemas.items():
    Draft202012Validator.check_schema(schema)
for pattern, name, pointer, rules in CASES:
    files = sorted(HERE.glob(pattern))
    if not files:
        fail(f"✗ {pattern}: no files")
    for f in files:
        rel = f.relative_to(HERE)
        found = problems_of(name, pointer, rules, json.loads(f.read_text()))
        if found:
            fail(f"✗ {rel}")
            for p in found[:5]:
                print(f"    {p}")
        else:
            print(f"✓ {rel}")

# The invalid cases: each must be refused, or the contract lets through what it promised to stop.
invalid = sorted((HERE / "examples" / "invalid").glob("*.json"))
if not invalid:
    fail("✗ examples/invalid/: no cases")
for f in invalid:
    stem = f.name.split(".")[0]
    if stem not in INVALID_TARGETS:
        fail(f"✗ {f.relative_to(HERE)}: no schema for '{stem}' cases")
        continue
    name, pointer, rules = INVALID_TARGETS[stem]
    if problems_of(name, pointer, rules, json.loads(f.read_text())):
        print(f"✓ {f.relative_to(HERE)} (refused)")
    else:
        fail(f"✗ {f.relative_to(HERE)}: was accepted; it must be refused")

# links.json: what canLink() says for each pair, from linkRule (vitest asserts the same file).
for case in json.loads((HERE / "examples" / "links.json").read_text())["cases"]:
    link = {"from": {"kind": case["from"], "id": "x"}, "to": {"kind": case["to"], "id": "y"}, "role": case["role"]}
    allowed = link_problem(link, {"x": case.get("board_purpose")}) is None
    if allowed != case["ok"]:
        fail(f"✗ examples/links.json: {case['from']} → {case['to']} as {case['role']} is {'allowed' if allowed else 'refused'}; the case says {case['ok']}")
print("✓ examples/links.json")

# Every op has a quota class; the role table has a line for every role.
ops = set(COMMON["op"]["enum"])
if ops != set(COMMON["opQuotaClass"]["const"]):
    fail(f"✗ common opQuotaClass does not cover exactly the ops: {sorted(ops ^ set(COMMON['opQuotaClass']['const']))}")
roles = set(COMMON["refRole"]["enum"])
if roles != set(COMMON["refRoleTable"]["const"]):
    fail(f"✗ common refRoleTable does not cover exactly the roles: {sorted(roles ^ set(COMMON['refRoleTable']['const']))}")

# Every camera value has its words (features/frame-change-edit.clan): the web's labels, director.v7's
# camera lines and the passthrough's lexicon read the one table.
camera_words = COMMON["cameraWords"]["const"]
for field, enum in (("size", "cameraSize"), ("angle", "cameraAngle"), ("movement", "cameraMovement"),
                    ("movement_speed", "movementSpeed")):
    missing = set(COMMON[enum]["enum"]) ^ set(camera_words.get(field, {}))
    if missing:
        fail(f"✗ common cameraWords.{field} does not cover exactly {enum}: {sorted(missing)}")
    for value, row in camera_words.get(field, {}).items():
        if not row.get("label") or not row.get("words"):
            fail(f"✗ common cameraWords.{field}.{value} needs a label and words")
if set(COMMON["cameraPatch"]["properties"]) != set(COMMON["camera"]["properties"]):
    fail("✗ common cameraPatch must have exactly camera's leaves")

# Every op a sheet claims must be routable, and config must name only known providers.
sheets = {json.loads(p.read_text())["provider"]: json.loads(p.read_text()) for p in (HERE / "capabilities").glob("*.json")}
for f in sorted(HERE.glob("examples/config.*.json")):
    cfg = json.loads(f.read_text())
    for op, providers in cfg["routing"].items():
        for p in providers:
            if op not in sheets.get(p, {}).get("ops", {}):
                fail(f"✗ {f.relative_to(HERE)}: routes {op} to {p}, whose sheet does not support it")
    if "fallbackOnly" in cfg:  # no longer read (features/runway-fallback.clan)
        fail(f"✗ {f.relative_to(HERE)}: fallbackOnly is no longer read; drop it")
    # Contract 3 needs the director that asks (director.v6): v5 against v3 is refused by the relay.
    # director.v6.1 (features/frame-aspect.clan) adds the true-shape crop; director.v7
    # (features/frame-change-edit.clan) adds Change this frame. v6 and v6.1 stay bundled for a rollback.
    if cfg["director"]["promptVersion"] not in ("director.v6", "director.v6.1", "director.v7"):
        fail(f"✗ {f.relative_to(HERE)}: promptVersion is {cfg['director']['promptVersion']}; contract 3 runs director.v6, v6.1 or v7")

# Runway is the only paid provider (features/drop-hackathon-extras.clan): the live config routes
# every op to ['runway'] (or nothing), and no sheet or example names a provider that is gone.
live = json.loads((HERE / "examples" / "config.live.json").read_text())
for op, providers in live["routing"].items():
    if providers not in ([], ["runway"]):
        fail(f"✗ examples/config.live.json: routes {op} to {providers}; the live config routes every op to ['runway']")
GONE = re.compile(r"\b(fal|heygen)\b|fal-ai/", re.I)
for f in sorted([*HERE.glob("capabilities/*.json"), *HERE.glob("examples/config.*.json"), *HERE.glob("examples/director.*.json")]):
    if GONE.search(f.read_text()):
        fail(f"✗ {f.relative_to(HERE)}: names fal or HeyGen, which were removed after the hackathon")

# Change this frame reserves the dearer of the two ops it may run as (features/frame-change-edit.clan):
# its price is derived from the sheet, never typed apart from it.
for provider, sheet in sheets.items():
    o = sheet["ops"]
    if "frame_edit" in o:
        want = max(o[k]["estimateUsd"] or 0 for k in ("frame", "region_edit") if k in o)
        if o["frame_edit"]["estimateUsd"] != want:
            fail(f"✗ capabilities/{provider}.json: frame_edit estimateUsd is {o['frame_edit']['estimateUsd']}; "
                 f"it is the higher of frame and region_edit ({want})")
        if o["frame_edit"]["model"] != o["frame"]["model"]:
            fail(f"✗ capabilities/{provider}.json: frame_edit runs on frame's model ({o['frame']['model']})")

# A pick names a model by provider and model id, so an op's models must be distinct.
for provider, sheet in sheets.items():
    for op, spec in sheet["ops"].items():
        models = [spec["model"]] + [a["model"] for a in spec.get("alternates", [])]
        if len(set(models)) != len(models):
            fail(f"✗ capabilities/{provider}.json: {op} names a model twice in {models}")

# The price vectors: pricing.py gives exactly each case's credits, or refuses (the relay's pytest asserts the same file).
for case in json.loads((HERE / "examples" / "pricing-cases.json").read_text())["cases"]:
    sheet = sheets[case["sheet"]]
    try:
        got = pricing.credits(sheet, case["model"], case["settings"])
    except pricing.PriceError as e:
        got = f"refused ({e})"
    want = "refused" if case.get("refused") else case["credits"]
    if (want == "refused") != isinstance(got, str) or (want != "refused" and got != want):
        fail(f"✗ examples/pricing-cases.json: {case['model']} {case['settings']} is {got}; the case says {want}")
print("✓ examples/pricing-cases.json (vectors)")

# The cost model: each scenario's credits, from the sheet, equal its expected total (a price change shows here).
cost_model = json.loads((HERE / "cost-model.json").read_text())
for sc in cost_model["scenarios"]:
    try:
        total = sum(pricing.credits(sheets[cost_model["provider"]], ln["model"], ln["settings"]) * ln["count"] for ln in sc["lines"])
    except pricing.PriceError as e:
        fail(f"✗ cost-model.json: {sc['id']}: {e}")
        continue
    if total != cost_model["expected"].get(sc["id"]):
        fail(f"✗ cost-model.json: {sc['id']} is {total} credits at today's sheet; expected says {cost_model['expected'].get(sc['id'])}")
print("✓ cost-model.json (totals)")

# Every maker a sheet names is in the notice, and the default allowlist names only makers the notice
# covers (features/tenant-limits.clan); subprocessors.md is what subprocessors.py renders.
import subprocessors  # noqa: E402  (contracts/subprocessors.py, standard library only)

policy = json.loads((HERE / "spend-policy.json").read_text())
notice = json.loads((HERE / "subprocessors.json").read_text())
noticed = {e["id"] for e in notice["entries"] if e["control"] == "maker"}
for provider, sheet in sheets.items():
    for name, model in sheet["models"].items():
        if model["maker"] not in noticed and model["maker"] not in policy["alwaysAllowed"]:
            fail(f"✗ capabilities/{provider}.json: {name}'s maker {model['maker']!r} is not in subprocessors.json")
for maker in policy["allow"]["makers"]:
    if maker not in noticed:
        fail(f"✗ spend-policy.json: allows {maker!r}, which subprocessors.json does not list")
for e in notice["entries"]:
    if e.get("via") and e["via"] not in {x["id"] for x in notice["entries"]}:
        fail(f"✗ subprocessors.json: {e['id']} goes via {e['via']!r}, which is not an entry")
if (HERE / "subprocessors.md").read_text() != subprocessors.rendered():
    fail("✗ subprocessors.md: not what subprocessors.json renders; run python production-tool/contracts/subprocessors.py --write")
print("✓ subprocessors.json, subprocessors.md and the makers")

# Tenant data never goes in config.json, which is public three ways (features/os-sign-in.clan).
for f in sorted(HERE.glob("examples/config.*.json")):
    if "tenants" in json.loads(f.read_text()):
        fail(f"✗ {f.relative_to(HERE)}: carries tenants; tenant items live in the private tenants table")

# Format ids never contain '/' and are unique across the file.
packs = json.loads((HERE / "format-packs.json").read_text())
ids = [fmt["id"] for pack in packs["packs"] for fmt in pack["formats"]]
if len(set(ids)) != len(ids):
    fail("✗ format-packs.json: a format id is used twice")

# The X-Napkin-Identity v1 vector (docs/contracts/production-tool-identity.md): the claims, key and body
# give exactly the assertion, which napkin-web's cargo test and the relay's pytest also check.
import base64, hashlib, hmac, uuid  # noqa: E401,E402

vec = json.loads((HERE / "examples" / "identity-assertion.vector.json").read_text())
claims_json = json.dumps(vec["claims"], separators=(",", ":"), ensure_ascii=False)
b64 = lambda b: base64.urlsafe_b64encode(b).rstrip(b"=").decode()  # noqa: E731
head = "v1." + b64(claims_json.encode())
want = head + "." + b64(hmac.new(vec["key"].encode(), head.encode(), hashlib.sha256).digest())
c = vec["claims"]
problems = [
    claims_json != vec["claimsJson"] and "claimsJson is not the compact claims",
    want != vec["assertion"] and "the assertion does not match its claims and key",
    c["bh"] != hashlib.sha256(vec["body"].encode()).hexdigest() and "bh is not the body's SHA-256",
    c["t"] != str(uuid.uuid5(uuid.NAMESPACE_URL, "napkin:agency:" + c["a"])) and "t is not the agency's tenant id",
    (c["m"], c["p"]) != (vec["method"], vec["pathAndQuery"]) and "m and p do not name the request",
]
for p in filter(None, problems):
    fail(f"✗ examples/identity-assertion.vector.json: {p}")
if not any(problems):
    print("✓ examples/identity-assertion.vector.json")

sys.exit(1 if failures else 0)
