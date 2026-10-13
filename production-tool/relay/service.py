"""The relay: routes, the job ledger, quotas, the fair-share queue and the spend stop.

Storage-agnostic: the Lambda handler (handler.py) and the dev server (local.py)
both build a Relay and call `Relay.http(method, path, headers, body)`.

Job life (states from common.schema.json#/$defs/jobState):
  queued      admitted (quota, in-flight and spend checked) and waiting for a
              provider slot in the global fair-share queue
  submitting  a slot is held; the director and the provider submit are running
  submitted   the provider has it (requestId saved)
  fetching    outputs are being copied to S3 and hashed
  needs_input the director asked (Job.question); uncharged, holding nothing, waiting for
              POST /jobs/{jobId}/answer from anyone in the agency (contract 3)
  completed | failed | cancelled   final
  uncertain   the provider may have taken it with no id saved: never resubmitted there

Runway is the floor of every job (features/runway-fallback.clan). A job's chain is the routing
for the op (or a pick), then Runway, always last. A provider in front of Runway that fails for a
provider or account reason, before or after submit, sends the job to Runway's default model for
the op, once (Job.fallbackFrom and fallbackReason say so). Moderation and invalid input never move.

Every route but GET /health and GET /config takes its person from the identity seam (identity.py,
features/drop-hackathon-extras.clan); no person is a 401. The person's agency is their tenant
(features/os-sign-in.clan): a tenant that is missing from the tenants table or not enabled is a 403
flag_off, saved projects and the library are the tenant's (shared by everyone in the agency), and
every job carries the internal _tenant.

Each request only ever advances its own job, and the scheduled sweep advances
jobs nobody is polling, so no worker is needed.
"""

from __future__ import annotations

import hashlib
import json
import logging
import math
import re
import time
import unicodedata
from datetime import datetime, timezone

from aspect import crop_png, measure, target_aspect
import dogfood
import identity
import library
import names
import projects
from contracts import Contracts, api
from director.base import Director, PassthroughDirector, PromptTooOld, new_id
from providers import Registry
from providers.base import CapabilityMissing, Moderated, ProviderError, set_job_context
from providers.types import effective_sheet, op_models

log = logging.getLogger("relay")

PROVIDER_NAMES = {"runway": "Runway", "mock": "Mock"}

# What to change when a step asks for more than the provider takes (features/harness-refusals.clan).
SHEET_HINTS = (
    ("character refs", "Name fewer characters in this shot, or a single view (@maya_front) instead of a whole character (@maya)."),
    (" refs", "Name fewer pictures in this shot."),
    ("needs a mask", "Paint over the area with the brush, or remove the box."),
    ("takes no mask", "Remove the painted area and use a box."),
    ("duration", "Change the shot's length."),
)


def sheet_refusal(op: str, last_error: str, either: bool = False) -> str:
    """The message for a step every provider ruled out on its sheet: what the limit is and what to change.
    Not a Napkin problem and not the person's account; sending it again cannot work.
    either: the floor ruled it out after another provider could not make it."""
    provider, _, reason = last_error.partition(": ")
    reason = reason or last_error
    for subject in (provider, op):  # "runway takes at most 5 character refs", "region_edit needs a mask"
        head, _, rest = reason.partition(" ")
        if subject and head == subject and rest.split(" ", 1)[0] in ("takes", "needs", "cannot", "returns", "does"):
            reason = "it " + rest
    hint = next((h for k, h in SHEET_HINTS if k in reason), "Change the step and send it again.")
    name = PROVIDER_NAMES.get(provider, provider or "The provider")
    if either:
        return f"{name} cannot do this step either: {reason}. {hint}"
    return f"{name} cannot do this {op.replace('_', ' ')}: {reason}. {hint}"


def could_not(provider: str, message: str) -> str:
    """Why a job left a provider for the next one in its chain (Job.fallbackReason)."""
    return f"{PROVIDER_NAMES.get(provider, provider)} could not make it: {message.rstrip('.')}."

def _common_defs() -> dict:
    from contracts_dir import contracts_dir
    return json.loads((contracts_dir() / "common.schema.json").read_text())["$defs"]


_COMMON = _common_defs()
CONTRACT = _COMMON["contractVersion"]["const"]  # "3"
STALE_BUILD = "This build reads contract 3; reload the page."
# Each op's daily quota class (common opQuotaClass).
QUOTA_CLASS = dict(_COMMON["opQuotaClass"]["const"])
INTERNAL_OPS = {"shot_list", "stitch"}  # no provider: the director, or the stitch Lambda
# Ops contract 3 names that this relay does not build yet: 422 capability_missing before quota or spend.
BUILT_OPS = {"generate", "view", "shot_list", "frame", "region_edit", "frame_edit", "clip", "clip_edit", "stitch"}
UNBUILT_OPS = set(QUOTA_CLASS) - BUILT_OPS
QUESTION_ID = re.compile(r"^q_[0-9A-HJKMNP-TV-Z]{26}$")


def crew_for(op: str) -> str:
    """Who works an op (ui-behaviour 5.1; clan-store's attribution.crewFor)."""
    return {"shot_list": "dex", "frame_edit": "dex", "bridge": "dex", "write": "skye", "cutout": "rhea",
            "upscale": "rhea", "region_edit": "rhea", "clip_patch": "edie", "stitch": "edie", "read": "ellis",
            "transcribe": "ellis", "check": "jude"}.get(op, "wren")
TERMINAL = {"completed", "failed", "cancelled", "uncertain"}
# The provider every job falls back to, once, when the op routes to it (features/runway-fallback.clan).
FLOOR = "runway"
NO_FALLBACK = {"moderated", "invalid_input"}  # the floor would refuse the same
UNKNOWN_PRICE_USD = 1.0      # reserved for an op whose sheet has no price
# How long a queued job may wait for a free provider slot, per class, when config.json sets no queueTimeoutS.
QUEUE_TIMEOUT_S = {"image": 1800, "video": 1800}
# What napkin-web's proxy and a Function URL both take (binary bodies arrive base64-encoded, and a
# Lambda request is at most 6 MB): features/os-sign-in.clan.
CLAN_MAX_BYTES = 4_500_000
CLAN_TOO_BIG = "This project is too big to save online (over 4.5 MB). Export it instead."
NOT_ON = "The Production Tool is not on for your agency yet."
TENANT_TTL_S = 30
CLAN_MIME = "application/vnd.clan+zip"
CLAN_REASONS = {"interval", "accept", "manual"}
# X-Project-Id on POST /clan: a project's id, made by the web app like every id (common.schema.json#/$defs/id).
PROJECT_ID = re.compile(r"^[a-z]+_[0-9A-HJKMNP-TV-Z]{26}$")
KEY = re.compile(r"^[a-z][a-z0-9]{1,23}$")
# GET /clan/{project} answers with the bytes. A Lambda response is at most 6 MB once base64-encoded,
# so a larger project is opened from an Export instead (features/personal-workspaces.clan).
OPEN_MAX_BYTES = 4_300_000
CANVAS_MAX_BYTES = 4_000_000
SUBMITTING_STALE_S = 120       # a submit that never came back
STITCH_BAD_CLIP = "bad_clip"   # stitch.py: a clip it could not read (the result names which)
FETCH_LEASE_S = 90
MAX_FETCH_ATTEMPTS = 3
STATUS_ERRORS = {
    "invalid_input": 400, "unauthorised": 401, "blocked": 403, "flag_off": 403,
    "quota_exhausted": 429, "queue_full": 429, "spend_stop": 503, "capability_missing": 422,
    "moderated": 422, "provider_failed": 502, "provider_unavailable": 503, "timeout": 504,
    "uncertain": 409, "conflict": 409, "internal": 500,
}


class Raw:
    """A response that is not JSON (GET /clan/{project}: the .clan bytes), with its own headers."""

    def __init__(self, data: bytes, mime: str, headers: dict | None = None):
        self.data, self.mime, self.headers = data, mime, headers or {}


class ApiError(Exception):
    def __init__(self, code: str, message: str, *, retryable: bool = False,
                 retry_after: int | None = None, status: int | None = None):
        super().__init__(message)
        self.code, self.message, self.retryable, self.retry_after = code, message, retryable, retry_after
        self.status = status or STATUS_ERRORS[code]

    def body(self) -> dict:
        err = {"code": self.code, "message": self.message, "retryable": self.retryable}
        if self.retry_after is not None:
            err["retryAfterS"] = self.retry_after
        return {"error": err}


def project_name(raw: str | None) -> str | None:
    """X-Project-Name: the name Home shows, percent-encoded UTF-8. None when absent or unreadable."""
    if not raw:
        return None
    from urllib.parse import unquote

    try:
        name = " ".join(unquote(raw, errors="strict").split())[:80]
    except UnicodeDecodeError:
        return None
    return name or None


def iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_iso(s: str) -> float:
    return datetime.strptime(s, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc).timestamp()


def same_text(s: str) -> str:
    """One spelling for a team or a name: Unicode NFKC, case folded, runs of spaces as one, trimmed.
    'Blue Herons', 'blue  herons' and 'BLUE HERONS' are one team; 'ｔｅａｍ' is 'team'."""
    return " ".join(unicodedata.normalize("NFKC", s).casefold().split())


def participant_id(team: str, handle: str) -> str:
    """The team name and the name together, in one spelling (features/personal-workspaces.clan): two
    Mayas in different teams are two workspaces. The team only makes the workspace unique; nothing is shared."""
    return "p_" + hashlib.sha256(f"{same_text(team)}/{same_text(handle)}".encode()).hexdigest()[:10]


def blocked_keys(team: str | None, handle: str) -> list[str]:
    """What a block can name: the person (team/name), or a name in every team."""
    return [handle] + ([f"{same_text(team)}/{same_text(handle)}"] if team else [])


def asset_refs(node) -> list[dict]:
    """Every assetRef ({sha256, url, mime}) anywhere in a job input."""
    found = []
    if isinstance(node, dict):
        if isinstance(node.get("sha256"), str) and isinstance(node.get("url"), str):
            found.append(node)
        for v in node.values():
            if isinstance(v, (dict, list)):
                found += asset_refs(v)
    elif isinstance(node, list):
        for v in node:
            found += asset_refs(v)
    return found


def public(job: dict) -> dict:
    return {k: v for k, v in job.items() if not k.startswith("_") and v is not None}


class Relay:
    def __init__(self, *, store, blobs, registry: Registry, director: Director, config,
                 contracts: Contracts | None = None, clock=time.time, stitch=None, cards=None,
                 who=identity.who):
        """config: () -> config.json dict (cached by the caller).
        stitch: (payload dict) -> None, starts the stitch Lambda asynchronously.
        cards: cards.Cards, what each ref picture shows, for the director (None: no model, no cards).
        who: (method, path_and_query, headers, body) -> {"pid", "h", "t", "name"?, "tenant"} or None,
        the identity seam (identity.py)."""
        self.store, self.blobs, self.registry, self.director = store, blobs, registry, director
        self.config, self.who = config, who
        self.contracts = contracts or Contracts()
        self.clock = clock
        self.stitch = stitch
        self.cards = cards
        self.dogfood = dogfood.Dogfood(blobs, clock)
        self._tenants: dict[str, tuple[float, dict | None]] = {}

    # ── HTTP ────────────────────────────────────────────────────────────────
    def http(self, method: str, path: str, headers: dict, body: bytes | None,
             query: str = "") -> tuple[int, dict | Raw | None, dict]:
        """Returns (status, body, log fields); the body is a JSON dict, Raw bytes, or None. Never raises.
        path is the raw path the relay received, query its raw query string (no '?')."""
        start = self.clock()
        ctx: dict = {"method": method, "route": path}
        try:
            status, out = self._route(method.upper(), path, {k.lower(): v for k, v in headers.items()}, body, ctx,
                                      query)
        except ApiError as e:
            status, out = e.status, e.body()
            ctx["error"] = e.code
        except Exception:
            log.exception("internal error")
            status, out = 500, ApiError("internal", "Something went wrong in the relay.", retryable=True).body()
            ctx["error"] = "internal"
        ctx["status"] = status
        ctx["latencyMs"] = int((self.clock() - start) * 1000)
        if isinstance(out, dict) and "state" in out:
            ctx["state"] = out["state"]
            ctx.setdefault("jobId", out.get("jobId"))
            ctx.setdefault("op", out.get("op"))
            ctx["provider"] = out.get("provider")
            ctx["model"] = out.get("model")
            cost = out.get("cost") or {}
            ctx["costUsd"] = cost.get("confirmed", cost.get("reserved"))
            if out.get("error"):
                ctx["error"] = out["error"]["code"]
            if out["state"] in TERMINAL and out.get("updatedAt"):
                ctx["jobS"] = parse_iso(out["updatedAt"]) - parse_iso(out["createdAt"])
        who = ctx.pop("_who", None)
        if who:
            self._dog_request(who, method.upper(), path, headers, body, status, out, ctx)
        return status, out, ctx

    def _route(self, method, path, headers, body, ctx, query=""):
        signed = path + (f"?{query}" if query else "")  # what napkin-web's assertion names
        if path.startswith("/api/"):
            path = path[4:]
        path = path.rstrip("/") or "/"
        if method == "GET" and path == "/config":
            return 200, self.config()
        if method == "GET" and path == "/health":
            return 200, {"ok": True}
        who = self._auth(method, signed, headers, body)
        ctx["participant"] = who["pid"]
        ctx["tenant"] = who["tenant"]["id"]
        self._tenant_on(who)
        ctx["_who"] = who
        if method == "GET" and path == "/me":
            return 200, self.me(who)
        if path.startswith("/dogfood/"):
            return self.dogfood_route(who, method, path, body)
        if method == "POST" and path == "/uploads":
            self._not_blocked(who)
            return 200, self.upload(self._json(body, "UploadRequest"))
        if method == "POST" and path == "/jobs":
            self._not_blocked(who)
            req = self._json(body, "JobRequest")
            ctx["jobId"], ctx["op"] = req["jobId"], req["op"]
            if req.get("modelChoice"):  # what the person picked, beside where it ran
                ctx["pick"] = f'{req["modelChoice"]["provider"]}:{req["modelChoice"]["model"]}'
            return 200, public(self.create_job(who, req))
        if path.startswith("/jobs/"):
            job_id, _, sub = path[len("/jobs/"):].partition("/")
            ctx["jobId"] = job_id
            job = self._tenant_job(who, job_id)
            if sub == "answer" and method == "POST":
                self._not_blocked(who)
                return self.answer(who, job, self._json(body, "JobAnswer"))
            if sub:
                raise ApiError("invalid_input", f"No route {method} {path}.", status=404)
            if method == "GET":
                return 200, public(self.advance(job))
            if method == "DELETE":
                return 200, public(self.cancel(job))
        if path == "/library" or path.startswith("/library/"):
            return 200, self.library_route(who, method, path, body, ctx)
        if method == "POST" and path == "/clan":
            self._not_blocked(who)
            saved = self.mirror_clan(who, headers, body, ctx)
            return (200, saved) if saved else (204, None)
        if method == "GET" and path == "/projects":
            return 200, {"projects": [projects.public_row(r) for r in self._projects().list(self._workspace(who))]}
        if path.startswith("/clan/"):
            return self.project_route(who, method, path[len("/clan/"):], body, ctx)
        if method == "POST" and path == "/log":
            entry = self._json(body, "LogEntry")
            ctx.update({"clientLevel": entry["level"], "clientMessage": entry["message"][:500],
                        "jobId": entry.get("jobId"), "node": entry.get("node"), "browser": entry.get("browser")})
            if entry.get("stack"):
                ctx["clientStack"] = entry["stack"][:2000]
            return 204, None
        raise ApiError("invalid_input", f"No route {method} {path}.", status=404)

    def _json(self, body: bytes | None, schema: str) -> dict:
        try:
            data = json.loads(body or b"null")
        except (ValueError, UnicodeDecodeError):
            raise ApiError("invalid_input", "The body is not JSON.") from None
        try:  # half an emoji (a lone surrogate) is valid JSON but not UTF-8: it broke the job later, as "uncertain"
            json.dumps(data, ensure_ascii=False).encode("utf-8")
        except UnicodeEncodeError:
            raise ApiError("invalid_input", "The text has a broken character in it (half an emoji). "
                           "Delete the last character and type it again.") from None
        # A page from an older build (contract 2) is told to reload, before its body is read any further.
        if schema in ("JobRequest", "JobAnswer") and isinstance(data, dict) and data.get("contractVersion") != CONTRACT:
            raise ApiError("invalid_input", STALE_BUILD)
        errors = self.contracts.errors(api(schema), data)
        if errors:
            raise ApiError("invalid_input", f"Invalid {schema}: {errors[0]}")
        return data

    def _auth(self, method: str, signed: str, headers: dict, body: bytes | None) -> dict:
        """The person from the identity seam; fails closed (features/drop-hackathon-extras.clan)."""
        who = self.who(method, signed, headers, body)
        if not who:
            raise ApiError("unauthorised", "Sign in to use the Production Tool.")
        return who

    def _tenant(self, tenant_id: str) -> dict | None:
        """The tenant's item from the tenants table, cached for 30 s (features/os-sign-in.clan).
        tenant-limits reads its cap and allowlist through here too."""
        now = self.clock()
        hit = self._tenants.get(tenant_id)
        if hit and now - hit[0] < TENANT_TTL_S:
            return hit[1]
        item = self.store.tenant(tenant_id)
        self._tenants[tenant_id] = (now, item)
        return item

    def _tenant_on(self, who: dict) -> None:
        """Only the agencies Napkin has turned on (fail closed: a missing item is off)."""
        item = self._tenant(who["tenant"]["id"])
        if not item or not item.get("enabled"):
            raise ApiError("flag_off", NOT_ON)

    @staticmethod
    def _workspace(who: dict) -> str:
        """Where the person's saved projects and library live: their agency's (tenants/{id}/)."""
        return who["tenant"]["id"]

    def _not_blocked(self, who: dict) -> None:
        if any(self.store.is_blocked(k) for k in blocked_keys(who.get("t"), who["h"])):
            raise ApiError("blocked", "This name has been blocked.")

    def _tenant_job(self, who: dict, job_id: str) -> dict:
        """A job of the person's agency: anyone in it may read it, stop it and answer its question
        (ui-behaviour 4.3, 4.7); its cost stays on its starter's budget."""
        job = self.store.get_job(job_id)
        if not job or job.get("_tenant") != who["tenant"]["id"]:
            raise ApiError("invalid_input", "No such job.", status=404)
        return job

    # ── the beta's record (dogfood.py, features/production-tool-dogfood.clan) ──
    def _dog_on(self) -> bool:
        try:
            return bool((self.config().get("flags") or {}).get("dogfood"))
        except Exception:
            return False

    def _dog(self, write) -> None:
        """Run one write to the record; recording never fails or slows what the person asked."""
        try:
            write()
        except Exception:
            log.exception("dogfood: write failed")

    def dogfood_route(self, who: dict, method: str, path: str, body: bytes | None) -> tuple[int, dict | None]:
        if not self._dog_on():
            raise ApiError("invalid_input", "This build does not record.", status=404)
        if method == "POST" and path == "/dogfood/consent":
            self._not_blocked(who)
            self.dogfood.consent(who)
            return 204, None
        if method == "POST" and path == "/dogfood/events":
            if not self.dogfood.consented(who["pid"]):
                raise ApiError("unauthorised", "Read the beta notice first.", status=403)
            if len(body or b"") > dogfood.BATCH_BYTES:
                raise ApiError("invalid_input", "The batch is too large.", status=413)
            batch = self._json(body, "DogfoodBatch")
            self.dogfood.write_batch(who["pid"], batch["events"])
            return 204, None
        raise ApiError("invalid_input", f"No route {method} {path}.", status=404)

    def _dog_request(self, who: dict, method: str, path: str, headers: dict, body: bytes | None,
                     status: int, out: dict | None, ctx: dict) -> None:
        """What the person sent: every write and every refusal, never a read that worked (polls,
        config, the library index) and never a header."""
        route = (path[4:] if path.startswith("/api/") else path).rstrip("/") or "/"
        if route.startswith("/dogfood/") or (method == "GET" and status < 400):
            return
        if not self._dog_on() or not self.dogfood.consented(who["pid"]):
            return
        pid = who["pid"]
        heads = {k.lower(): v for k, v in headers.items()}
        if route == "/log" and status < 400:
            try:
                entry = json.loads(body or b"{}")
            except ValueError:
                entry = {}
            self._dog(lambda: self.dogfood.record(pid, "report", str(entry.get("level", "report")), entry))
            return
        if route == "/jobs" and method == "POST" and ((out or {}).get("error") or {}).get("code") == "queue_full":
            # The runner sends it again until a place frees: one 'queued' change, folded after that.
            self._dog(lambda: self.dogfood.record(pid, "job", "queued", {
                "jobId": ctx.get("jobId"), "op": ctx.get("op"), "waiting": "queue_full", "status": status}))
            return
        name = route
        project = heads.get("x-project-id")
        if route.startswith("/clan/"):  # a saved project's routes (personal workspaces): one name each
            project = project or route.split("/")[2]
            name = "/clan/{project}/canvas" if route.endswith("/canvas") else "/clan/{project}"
        for prefix, label in (("/jobs/", "/jobs/{id}"), ("/library/", "/library/{shelf}/{key}")):
            if route.startswith(prefix):
                name = label
        if route.startswith("/jobs/") and route.endswith("/answer"):
            name = "/jobs/{id}/answer"
        data = {"status": status, "latencyMs": ctx.get("latencyMs")}
        for k in ("error", "jobId", "op", "pick", "libraryKey"):
            if ctx.get(k) is not None:
                data[k] = ctx[k]
        if route == "/jobs" or route.startswith("/library/"):
            data["body"] = dogfood.body_value(body or b"")
        elif body:
            data["bytes"] = len(body)
        if route == "/clan":
            data["reason"] = heads.get("x-clan-reason")
        self._dog(lambda: self.dogfood.record(pid, "request", f"{method} {name}", data, project=project))

    def _dog_job(self, job: dict, before: str | None) -> None:
        """A job changed state: one event with where it ran, why it moved, and what it cost."""
        if not self._dog_on():
            return
        pid = job["participantId"]
        if not self.dogfood.consented(pid):
            return
        data: dict = {"jobId": job["jobId"], "op": job["op"], "from": before}
        pick = (job.get("_req") or {}).get("modelChoice")
        if pick:
            data["pick"] = f'{pick["provider"]}:{pick["model"]}'
        for k in ("provider", "model", "fallbackFrom", "fallbackReason", "error"):
            if job.get(k) is not None:
                data[k] = job[k]
        cost = job.get("cost") or {}
        if cost.get("confirmed") is not None or cost.get("reserved"):
            data["costUsd"] = cost.get("confirmed", cost.get("reserved"))
        block = job.get("director")
        if block:
            data["director"] = {"model": block.get("model"), "promptVersion": block.get("promptVersion"),
                                "latencyMs": block.get("latencyMs"), "rationale": (block.get("rationale") or "")[:2000],
                                "cards": len(block.get("cards") or [])}
        if job["state"] in TERMINAL and job.get("createdAt") and job.get("updatedAt"):
            data["jobS"] = round(parse_iso(job["updatedAt"]) - parse_iso(job["createdAt"]), 1)
        self._dog(lambda: self.dogfood.record(pid, "job", job["state"], data))

    # ── the person and uploads ──────────────────────────────────────────────
    def me(self, who: dict) -> dict:
        """GET /me (relay-api.schema.json#/$defs/Me): who the seam says is asking, their tenant, and
        the agency's workspace."""
        pid = who["pid"]
        workspace = self._workspace(who)
        out = {"participantId": pid, "handle": who["h"], "team": who.get("t") or "", "workspace": workspace,
               "tenant": dict(who["tenant"]), "quotas": self.remaining(pid),
               "projects": self._projects().count(workspace)}
        if who.get("name"):
            out["name"] = who["name"]
        if self._dog_on():
            out["dogfood"] = {"consented": self.dogfood.consented(pid)}
        return out

    def _day(self) -> str:
        return iso(self.clock())[:10]

    def remaining(self, pid: str) -> dict:
        quotas = self.config()["quotas"]
        used = self.store.counters(f"{pid}#{self._day()}")
        return {c: max(0, int(quotas[c] - used.get(c, 0))) for c in ("image", "video", "render")}

    def upload(self, req: dict) -> dict:
        key = f"in/{req['sha256']}"
        url = self.blobs.public_url(key)
        if self.blobs.exists(key):
            return {"exists": True, "url": url}
        made = f"out/{req['sha256']}"  # the relay made it: the browser need not send it back
        if self.blobs.exists(made):
            return {"exists": True, "url": self.blobs.public_url(made)}
        return {"exists": False, "putUrl": self.blobs.presign_put(key, req["mime"]), "url": url}

    def _projects(self) -> projects.Projects:
        return projects.Projects(self.blobs, lambda: iso(self.clock()))

    def mirror_clan(self, who: dict, headers: dict, body: bytes | None, ctx: dict) -> dict | None:
        """POST /clan: keep the person's .clan. With X-Project-Id it is a saved project
        (projects.py): checked against If-Match, listed by GET /projects; answers ClanSaved.
        Without it, the participant's own latest copy and a timestamped one, as before (None: 204)."""
        data = body or b""
        if len(data) > CLAN_MAX_BYTES:
            raise ApiError("invalid_input", CLAN_TOO_BIG, status=413)
        if not data.startswith(b"PK\x03\x04"):
            raise ApiError("invalid_input", "The body is not a .clan file.")
        reason = headers.get("x-clan-reason", "manual")
        if reason not in CLAN_REASONS:
            reason = "manual"
        # One copy per project when the app says which (features/project-home.clan); the participant's own path without it.
        project = headers.get("x-project-id")
        if project is not None and not PROJECT_ID.match(project):
            raise ApiError("invalid_input", "X-Project-Id is not a project id.")
        ctx["clanBytes"] = len(data)
        if not project:
            base = f"clan/{who['pid']}"
            stamp = iso(self.clock()).replace(":", "")
            for key in (f"{base}/latest.clan", f"{base}/{stamp}-{reason}.clan"):
                self.blobs.put(key, data, CLAN_MIME)
            return None
        ctx["project"] = project
        try:
            row = self._projects().save(self._workspace(who), project, data, reason,
                                        if_match=projects.parse_if_match(headers.get("if-match")),
                                        name=project_name(headers.get("x-project-name")))
        except projects.Stale as e:
            raise ApiError("conflict", str(e)) from None
        except projects.Busy as e:
            raise ApiError("conflict", str(e), retryable=True) from None
        return {"project": projects.public_row(row)}

    def project_route(self, who: dict, method: str, rest: str, body: bytes | None, ctx: dict):
        """GET /clan/{project}: the saved bytes (Raw, with their ETag). GET|PUT /clan/{project}/canvas."""
        project, _, sub = rest.partition("/")
        if not PROJECT_ID.match(project) or sub not in ("", "canvas"):
            raise ApiError("invalid_input", f"No route {method} /clan/{rest}.", status=404)
        ctx["project"] = project
        store = self._projects()
        workspace = self._workspace(who)
        try:
            if method == "GET" and not sub:
                data, row = store.read(workspace, project)
                if len(data) > OPEN_MAX_BYTES:
                    raise ApiError("invalid_input", "This project is too large to open from the server. "
                                   "Export it in the browser that made it, and open the file here.", status=413)
                return 200, Raw(data, CLAN_MIME, {"ETag": f'"{row["etag"]}"', "X-Saved-At": row["savedAt"]})
            if method == "GET":
                return 200, store.canvas(workspace, project)
            if method == "PUT" and sub:
                self._not_blocked(who)
                if len(body or b"") > CANVAS_MAX_BYTES:
                    raise ApiError("invalid_input", "The canvas is larger than 4 MB.", status=413)
                canvas = self._json(body, "ProjectCanvas")
                store.put_canvas(workspace, project, {**canvas, "savedAt": iso(self.clock())})
                return 204, None
        except projects.Missing as e:
            raise ApiError("invalid_input", str(e), status=404) from None
        raise ApiError("invalid_input", f"No route {method} /clan/{rest}.", status=404)

    # ── the workspace library ───────────────────────────────────────────────
    def library_route(self, who: dict, method: str, path: str, body: bytes | None, ctx: dict) -> dict:
        workspace = self._workspace(who)  # the agency's library, shared by everyone in it
        lib = library.Library(self.blobs, lambda: iso(self.clock()))
        parts = path[len("/library/"):].split("/") if path.startswith("/library/") else []
        if not parts:
            raise ApiError("invalid_input", "Name a shelf: /library/{shelf} (agency for what no client owns).", status=404)
        shelf, key, ver = (parts + [None, None])[:3]
        if len(parts) > 3 or not library.SHELF.match(shelf):
            raise ApiError("invalid_input", "A shelf is lowercase letters, digits, - and _, up to 64 of them.")
        if method == "GET" and key is None:
            return lib.index(workspace, shelf)
        if not KEY.match(key or "") or (ver and not ver.isdigit()):
            raise ApiError("invalid_input", "A key is lowercase letters and digits, 2 to 24 of them.")
        ctx["libraryKey"] = f"{shelf}/{key}"
        try:
            if method == "GET":
                return lib.entry(workspace, shelf, key, int(ver) if ver else None)
            if method == "POST" and not ver:
                self._not_blocked(who)
                return lib.publish(workspace, shelf, key, self._json(body, "LibraryPublish"), who["h"])
        except library.Conflict as e:
            raise ApiError("conflict", str(e)) from None
        except library.Missing as e:
            raise ApiError("invalid_input", str(e), status=404) from None
        except ValueError as e:
            raise ApiError("invalid_input", str(e)) from None
        raise ApiError("invalid_input", f"No route {method} {path}.", status=404)

    # ── admission ───────────────────────────────────────────────────────────
    def _candidates(self, cfg: dict, op: str) -> list[str]:
        return [p for p in cfg["routing"].get(op, []) if self.registry.supports(p, op)]

    def _floor(self, cfg: dict, op: str) -> str | None:
        """Runway, when the config routes the op to it: the last provider of every job's chain.
        A config that does not route the op to Runway (a single-provider pathway) has no floor."""
        if op in INTERNAL_OPS or FLOOR not in cfg["routing"].get(op, []) or not self.registry.supports(FLOOR, op):
            return None
        return FLOOR

    def _chain(self, cfg: dict, op: str, pick: dict | None) -> list[str]:
        """Where a job runs, in order: a pick (or the routing), then the floor."""
        if pick:
            front = [pick["provider"]] if self.registry.supports(pick["provider"], op) else []
        else:
            front = self._candidates(cfg, op)
        floor = self._floor(cfg, op)
        return front + ([floor] if floor and floor not in front else [])

    # ── a model the person picked (features/model-choice.clan) ──────────────
    def _check_pick(self, cfg: dict, op: str, pick: dict | None) -> None:
        """Refuse, before any spend or quota, a pick the routing or the sheet does not allow."""
        if pick is None:
            return
        provider, model = pick["provider"], pick["model"]
        sheet = self.registry.sheet(provider) if provider in cfg["routing"].get(op, []) else None
        if op in INTERNAL_OPS or not sheet or model not in op_models(sheet, op):
            raise ApiError("invalid_input", f"{model} on {provider} cannot make this step. Pick another model.")

    def _job_candidates(self, cfg: dict, job: dict) -> list[str]:
        return self._chain(cfg, job["op"], job["_req"].get("modelChoice"))

    def _sheet(self, job: dict, provider: str | None = None) -> dict | None:
        return self.registry.sheet(provider or job.get("provider"))

    def _adapter(self, job: dict, provider: str | None = None):
        return self.registry.get(provider or job["provider"])

    def _check_flags(self, cfg: dict, req: dict) -> None:
        op, inp, flags = req["op"], req["input"], cfg["flags"]
        off = None
        if op in ("shot_list", "frame", "frame_edit") and not flags["storyboard"]:
            off = "The storyboard is switched off for now."
        elif op in ("clip", "clip_edit") and not flags["video"]:
            off = "Video is switched off for now."
        elif op == "stitch" and not flags["stitch"]:
            off = "Stitching is switched off for now."
        elif op == "region_edit" and not (flags["regionEditFrames"] or flags["regionEditCanvas"]):
            off = "Region edits are switched off for now."
        elif op == "clip_edit" and (inp.get("region") or inp.get("mask")) and not flags["videoRegionEdit"]:
            off = "Region edits on video are switched off for now."
        elif op == "clip_edit" and not (inp.get("region") or inp.get("mask")) and not flags["feelEdit"]:
            # A clip_edit with no region and no mask is a feel edit, with or without a feel block.
            off = "Feel edits are switched off for now."
        elif op not in INTERNAL_OPS and not cfg["routing"].get(op):
            off = "This step is switched off for now."
        if off:
            raise ApiError("flag_off", off)

    def _estimate(self, op: str, provider: str, model: str | None = None) -> tuple[float, bool]:
        sheet = self.registry.sheet(provider)
        if sheet and op in sheet.get("ops", {}):
            sheet = effective_sheet(sheet, op, model)
        price = ((sheet or {}).get("ops", {}).get(op) or {}).get("estimateUsd")
        return (UNKNOWN_PRICE_USD, True) if price is None else (float(price), False)

    @staticmethod
    def _check_frame(req: dict) -> None:
        """A clip starts from a picture (its shot's frame). Refused here, before quota or spend,
        not later by the provider (a video as the frame reached Runway)."""
        if req["op"] != "clip":
            return
        image = req["input"].get("image")
        if image and not str(image.get("mime", "")).startswith("image/"):
            raise ApiError("invalid_input", "A clip starts from a picture, and this shot's frame is not one. Draw the frame again.")
        if not image and not req["input"].get("refs"):
            raise ApiError("invalid_input", "This shot has no frame yet. Draw its frame first.")

    def create_job(self, who: dict, req: dict) -> dict:
        existing = self.store.get_job(req["jobId"])
        if existing:
            return self._existing(who, existing)
        cfg = self.config()
        op = req["op"]
        if op in UNBUILT_OPS:
            raise ApiError("capability_missing", "This step is not built yet.")
        qclass = QUOTA_CLASS[op]
        self._check_flags(cfg, req)
        pick = req.get("modelChoice")
        self._check_pick(cfg, op, pick)
        self._check_frame(req)
        try:  # a misspelt @name is the person's to fix: say so now, not as a failed job
            names.to_wire(op, req["input"])
        except (names.UnknownName, ValueError) as e:
            raise ApiError("invalid_input", str(e)) from None
        estimate, unknown = 0.0, False
        if op not in INTERNAL_OPS:
            # Reserved at the dearest provider it may run on.
            candidates = self._chain(cfg, op, pick)
            if not candidates:
                raise ApiError("capability_missing", "No provider can do this step right now.")
            prices = [self._estimate(op, p, pick["model"] if pick and p == pick["provider"] else None) for p in candidates]
            estimate = max(p for p, _ in prices)
            unknown = any(u for _, u in prices)
        # Admitted only when this job fits under the cap: "spent < cap" let the last jobs pass it.
        if estimate > 0 and self.store.counters("spend").get("usd", 0) + estimate > cfg["spend"]["capUsd"]:
            raise ApiError("spend_stop", "The generation budget is used up.")

        pid = who["pid"]
        if not self.store.incr(f"inflight#{pid}", "n", 1, cfg["inFlightPerParticipant"]):
            raise ApiError("queue_full", f"You have {cfg['inFlightPerParticipant']} jobs running; wait for one to finish.",
                           retryable=True, retry_after=10)
        day = self._day()
        counted = qclass in cfg["quotas"]
        if counted and not self.store.incr(f"{pid}#{day}", qclass, 1, cfg["quotas"][qclass]):
            self.store.incr(f"inflight#{pid}", "n", -1)
            raise ApiError("quota_exhausted", f"You have used today's {qclass} quota.")
        if estimate > 0:
            self.store.incr("spend", "usd", estimate)

        now = self.clock()
        job = {
            "contractVersion": CONTRACT, "jobId": req["jobId"], "participantId": pid,
            "tenantId": who["tenant"]["id"], "projectId": req["projectId"], "startedBy": f"human:{pid}",
            "crew": crew_for(op), "node": req["node"], "nonce": req["nonce"], "purpose": req.get("purpose"),
            "op": op, "quotaClass": qclass, "state": "queued", "inputHashes": sorted({a["sha256"] for a in asset_refs(req["input"])}),
            "cost": {"estimate": estimate, "reserved": estimate, "currency": "USD", "unknown": unknown},
            "createdAt": iso(now), "updatedAt": iso(now),
            "_req": req, "_day": day, "_counted": counted, "_queue": "q", "_tenant": who["tenant"]["id"],
            "_released": False, "_tried": [],
        }
        if pick:  # where the job meant to run, for fallbackFrom
            job["_first"] = {"provider": pick["provider"], "model": pick["model"]}
        if not self.store.create_job(job):  # the same jobId raced in: undo, return theirs
            self.store.incr(f"inflight#{pid}", "n", -1)
            if counted:
                self.store.incr(f"{pid}#{day}", qclass, -1)
            if estimate > 0:
                self.store.incr("spend", "usd", -estimate)
            return self._existing(who, self.store.get_job(req["jobId"]))
        self._dog_job(job, None)
        return self._dispatch(job, cfg)

    def _existing(self, who: dict, job: dict) -> dict:
        if job["participantId"] != who["pid"]:
            raise ApiError("invalid_input", "That jobId is taken.", status=409)
        return self._with_poll(job)

    # ── transitions ─────────────────────────────────────────────────────────
    def _save(self, job: dict, **changes) -> dict | None:
        """Apply changes and save; None when someone else saved first."""
        trial = dict(job)
        trial.update(changes)
        trial["updatedAt"] = iso(self.clock())
        if not self.store.save_job(trial):
            return None
        if trial["state"] != job["state"]:
            self._dog_job(trial, job["state"])
        return trial

    def _reload(self, job: dict) -> dict:
        return self._with_poll(self.store.get_job(job["jobId"]))

    def _finish(self, job: dict, state: str, *, error: dict | None = None, paid: bool = True,
                refund: bool = False, **changes) -> dict:
        """Move to a final state once, then give back the in-flight place, the
        provider slot and (when nothing was paid) the reserved spend and quota."""
        cost = dict(job["cost"])
        confirmed = changes.pop("confirmed", None)
        spend_delta = 0.0
        if not paid:
            spend_delta = -cost.get("reserved", 0)
            cost["reserved"] = 0
        elif confirmed is not None:
            spend_delta = confirmed - cost.get("reserved", 0)
            cost["confirmed"] = confirmed
            cost["unknown"] = False
        saved = self._save(job, state=state, error=error, cost=cost, _queue=None, _released=True,
                           queuePosition=None, **changes)
        if saved is None:
            return self._reload(job)
        if not job.get("_released"):
            self.store.incr(f"inflight#{job['participantId']}", "n", -1)
            if job.get("_slot"):
                self.store.incr(job["_slot"], "n", -1)
            if refund and job.get("_counted"):
                self.store.incr(f"{job['participantId']}#{job['_day']}", job["quotaClass"], -1)
            if spend_delta:
                self.store.incr("spend", "usd", spend_delta)
        return self._with_poll(saved)

    def _fail(self, job: dict, code: str, message: str, *, retryable: bool = False,
              provider_code: str | None = None, **kw) -> dict:
        err = {"code": code, "message": message, "retryable": retryable}
        if provider_code:
            err["providerCode"] = provider_code
        state = "uncertain" if code == "uncertain" else "failed"
        return self._finish(job, state, error=err, **kw)

    def _with_poll(self, job: dict) -> dict:
        job = dict(job)
        if job["state"] in TERMINAL:
            job.pop("nextPollS", None)
            return job
        min_poll = 2
        if job.get("provider"):
            sheet = self._sheet(job) or {}
            min_poll = max(min_poll, math.ceil(sheet.get("results", {}).get("minPollS", 1)))
        if job["state"] == "queued":
            min_poll = max(min_poll, 3)
        if job["quotaClass"] in ("video", "render"):
            min_poll = max(min_poll, 3 if job["quotaClass"] == "render" else 5)
        job["nextPollS"] = min_poll
        return job

    def _timeout_s(self, cfg: dict, job: dict) -> int:
        t = cfg["jobTimeoutS"]
        return t["image"] if job["quotaClass"] in ("image", "text") else t["video"]

    def _queue_timeout_s(self, cfg: dict, job: dict) -> int:
        """How long a job may wait for a free slot (config queueTimeoutS, else QUEUE_TIMEOUT_S), never less
        than its running limit. Separate from jobTimeoutS: in a busy room a clip waits its turn instead of
        failing after 10 minutes of queue (2026-10-09, sized for 100 people)."""
        t = cfg.get("queueTimeoutS") or QUEUE_TIMEOUT_S
        wait = t["image"] if job["quotaClass"] in ("image", "text") else t["video"]
        return max(wait, self._timeout_s(cfg, job))

    # ── the queue ───────────────────────────────────────────────────────────
    def _slot_class(self, op: str) -> str:
        return "video" if QUOTA_CLASS[op] == "video" else "image"

    def _queue_position(self, job: dict) -> int:
        """Fair share: people with fewer jobs at a provider go first, then
        the oldest job. Counted among queued jobs of the same slot class."""
        cls = self._slot_class(job["op"])
        queued = [j for j in self.store.list_active("q") if j["op"] not in INTERNAL_OPS
                  and self._slot_class(j["op"]) == cls]
        running: dict[str, int] = {}
        for j in self.store.list_active("r"):
            running[j["participantId"]] = running.get(j["participantId"], 0) + 1
        queued.sort(key=lambda j: (running.get(j["participantId"], 0), j["createdAt"], j["jobId"]))
        ids = [j["jobId"] for j in queued]
        return ids.index(job["jobId"]) if job["jobId"] in ids else 0

    def _free_slots(self, candidates: list[str], cls: str) -> int:
        free = 0
        for p in candidates:
            limit = (self.registry.sheet(p) or {}).get("concurrency", {}).get(cls, 0)
            free += max(0, int(limit - self.store.counters(f"slots#{p}#{cls}").get("n", 0)))
        return free

    def _dispatch(self, job: dict, cfg: dict) -> dict:
        if job["state"] != "queued":
            return self._with_poll(job)
        op = job["op"]
        if op == "shot_list":
            return self._run_shot_list(job, cfg)
        if op == "stitch":
            return self._run_stitch(job, cfg)
        if job.get("_notBefore", 0) > self.clock():  # its provider asked us to wait (a 429's Retry-After)
            return self._with_poll(job)
        cls = self._slot_class(op)
        candidates = [p for p in self._job_candidates(cfg, job) if p not in job["_tried"]]
        if not candidates:
            return self._fail(job, "capability_missing", "No provider can do this step right now.",
                              paid=False, refund=True)
        position = self._queue_position(job)
        if position >= self._free_slots(candidates, cls):
            return self._with_poll({**job, "queuePosition": position})
        for provider in candidates:
            limit = (self.registry.sheet(provider) or {}).get("concurrency", {}).get(cls, 0)
            slot = f"slots#{provider}#{cls}"
            if limit <= 0 or not self.store.incr(slot, "n", 1, limit):
                continue
            outcome = self._submit(job, cfg, provider, slot)
            if outcome is not None:
                return outcome
            job = self.store.get_job(job["jobId"])  # refused before acceptance: try the next one
            if job["state"] != "queued":
                return self._with_poll(job)
        if not [p for p in self._job_candidates(cfg, job) if p not in job["_tried"]]:
            return self._exhausted(job, cfg)
        return self._with_poll({**job, "queuePosition": 0})

    def _exhausted(self, job: dict, cfg: dict) -> dict:
        """Every provider in the job's chain refused it before accepting it."""
        last = job.get("_lastError") or ""
        first = job.get("fallbackReason")
        if first and last.startswith(f"{FLOOR}: "):
            # The floor refused too, after the first provider could not make it: say both.
            if job.get("_floorSheet"):  # Runway's sheet cannot do it (a masked clip_edit): sending it again cannot work
                return self._fail(job, "capability_missing", f"{first} {sheet_refusal(job['op'], last, either=True)}",
                                  paid=False, refund=True)
            return self._fail(job, "provider_unavailable",
                              f"{first} {PROVIDER_NAMES[FLOOR]} could not take it either ({last.partition(': ')[2]}). Try again.",
                              retryable=True, paid=False, refund=True)
        if job["_tried"] and job.get("_sheetOnly") and last:
            # Every provider ruled the request out on its sheet: sending it again cannot work.
            return self._fail(job, "capability_missing", sheet_refusal(job["op"], last), paid=False, refund=True)
        return self._fail(job, "provider_unavailable", "No provider could take this job. Try again.",
                          retryable=True, paid=False, refund=True)

    def _floor_admission(self, job: dict, cfg: dict, estimate: float) -> dict | None:
        """A job about to run on the floor after its first provider kept its reservation (it may
        have charged for its attempt): the spend stop applies to the floor's price now. The failed
        job, or None when it may run."""
        if estimate > 0 and job["cost"].get("reserved", 0) == 0:
            if self.store.counters("spend").get("usd", 0) + estimate > cfg["spend"]["capUsd"]:
                first = job.get("fallbackReason") or ""
                return self._fail(job, "spend_stop", f"{first} {PROVIDER_NAMES.get(FLOOR, FLOOR)} could not make it "
                                  "instead: the generation budget is used up.".strip(), paid=False, refund=True)
        return None

    def _fall_back(self, job: dict, cfg: dict, code: str, message: str, *, paid: bool = True,
                   refund: bool = False, retryable: bool = False, provider_code: str | None = None,
                   may_charge: bool = False, **kw) -> dict:
        """A provider in front of the floor failed for a provider or account reason, before or after
        submit: make the job again on the floor's default model, once. Otherwise fail as before.
        paid: the first provider may have charged for it, so its reservation stays spent.
        may_charge: it may have the job (uncertain), so the job says it may still charge."""
        provider = job.get("provider")
        floor = self._floor(cfg, job["op"])
        if code in NO_FALLBACK or not floor or provider == floor or floor in job["_tried"]:
            return self._fail(job, code, message, retryable=retryable, provider_code=provider_code,
                              paid=paid, refund=refund, **kw)
        charge = f"{PROVIDER_NAMES.get(provider, provider)} may still charge for its attempt."
        reason = could_not(provider, message) + (f" {charge}" if may_charge else "")
        cost = dict(job["cost"])
        spend_back = 0.0 if paid else -cost.get("reserved", 0)
        cost.update(estimate=0.0, reserved=0.0)  # _submit reserves the floor's price
        front = [p for p in self._job_candidates(cfg, job) if p != floor]
        tried = job["_tried"] + [p for p in front if p not in job["_tried"]]
        log.info("job %s: %s failed (%s); making it on %s", job["jobId"], provider, code, floor)
        saved = self._save(job, state="queued", provider=None, model=None, requestId=None, _slot=None, _queue="q",
                           queuePosition=None, cost=cost, _tried=tried,
                           _first=job.get("_first") or {"provider": provider, "model": job.get("model")},
                           fallbackReason=reason, _lastError=f"{provider}: {message}"[:300], _sheetOnly=False,
                           _queuedAt=self.clock(), _submittedAt=None, _nextCheckAt=None, _leaseUntil=None,
                           _fetchErrors=None, director=None)
        if saved is None:
            return self._reload(job)
        if job.get("_slot"):
            self.store.incr(job["_slot"], "n", -1)
        if spend_back:
            self.store.incr("spend", "usd", spend_back)
        return self._dispatch(saved, cfg)

    def _submit(self, job: dict, cfg: dict, provider: str, slot: str) -> dict | None:
        """Director, then provider submit. None means the provider refused before
        accepting and the job is back in the queue for the next provider."""
        # A picked model runs on its own provider; anywhere else (the floor) the default runs.
        pick = job["_req"].get("modelChoice")
        picked = pick["model"] if pick and pick["provider"] == provider else None
        sheet = effective_sheet(self.registry.sheet(provider), job["op"], picked)
        estimate, unknown = self._estimate(job["op"], provider, picked)
        refused = self._floor_admission(job, cfg, estimate)
        if refused is not None:
            self.store.incr(slot, "n", -1)
            return refused
        cost = {**job["cost"], "estimate": estimate, "reserved": estimate, "unknown": unknown}
        model = sheet["ops"][job["op"]]["model"]
        first = job.get("_first") or {"provider": provider, "model": model}
        moved = {"fallbackFrom": first} if first["provider"] != provider else {}
        shape = target_aspect(job["op"], job["_req"].get("input") or {})
        saved = self._save(job, state="submitting", provider=provider, model=model, _slot=slot,
                           _queue="r", cost=cost, queuePosition=None, _first=first,
                           _aspect={"w": shape[0], "h": shape[1]} if shape else None, **moved)
        if saved is None:
            self.store.incr(slot, "n", -1)
            return self._reload(job)
        delta = estimate - job["cost"].get("reserved", 0)
        if delta:
            self.store.incr("spend", "usd", delta)
        job = saved

        try:
            directed, block = self._direct(job, sheet)
        except ApiError as e:
            return self._fail(job, e.code, e.message, paid=False, refund=True)
        if directed.get("question"):
            return self._ask(job, directed["question"], block)
        # Change this frame runs as the op Dex resolved (features/frame-change-edit.clan): the adapter,
        # its sheet and its price are that op's, and a change of camera movement only draws nothing.
        run_as = job["op"]
        if job["op"] == "frame_edit":
            run_as = (directed.get("frameEdit") or {}).get("runAs") or "frame"
            if run_as == "none":
                return self._finish(job, "completed", director=block, outputs=[], kind="generated",
                                    paid=False, refund=True)
            job = self._reserve_as(job, provider, run_as)
        pjob = directed["providerJob"]
        set_job_context(run_as, asset_refs(job["_req"]["input"]))
        try:
            request_id = self._adapter(job, provider).submit(pjob)
        except Moderated as e:
            return self._fail(job, "moderated", e.message, provider_code=e.provider_code, paid=False,
                              director=block)
        except ProviderError as e:
            if e.accepted:
                return self._fall_back(job, cfg, "uncertain", "The provider may have this job; it will not be sent again.",
                                       provider_code=e.provider_code, director=block, may_charge=True)
            if isinstance(e, CapabilityMissing) or e.code in ("provider_unavailable", "queue_full", "capability_missing"):
                # A sheet refusal is about the request; an outage or a full queue is about the provider.
                sheet = isinstance(e, CapabilityMissing) or e.code == "capability_missing"
                sheet_only = job.get("_sheetOnly", True) and sheet
                tried = job["_tried"] + [provider]
                rest = [p for p in self._job_candidates(cfg, job) if p not in tried]
                retry_after = getattr(e, "retry_after_s", None)
                if provider == FLOOR and not rest and not sheet and e.retryable and retry_after is not None:
                    # Runway, the last of the chain, asked us to wait (a 429 with Retry-After; its adapter reads
                    # the header only there): wait in the queue and send it there again then. It failed at once
                    # before (2026-10-09); the queue timeout still bounds the wait. An outage still fails at once.
                    wait = max(1, int(retry_after))
                    back = self._save(job, state="queued", provider=None, model=None, _slot=None, _queue="q",
                                      _lastError=f"{provider}: {e.message}"[:300], _notBefore=self.clock() + wait)
                    self.store.incr(slot, "n", -1)
                    if back is None:
                        return self._reload(job)
                    return self._with_poll(back)
                # Why the job left this provider, for the next one. The floor is the last: no "Runway could not
                # make it" in front of "Runway cannot do this step either" (it said Runway twice, 2026-10-09).
                reason = job.get("fallbackReason") or (could_not(provider, e.message) if rest else None)
                back = self._save(job, state="queued", provider=None, model=None, _slot=None, _queue="q",
                                  _tried=tried, _lastError=f"{provider}: {e.message}"[:300],
                                  _sheetOnly=sheet_only, _floorSheet=sheet, fallbackReason=reason)
                self.store.incr(slot, "n", -1)
                if back is None:
                    log.error("job %s: could not requeue after %s refused", job["jobId"], provider)
                return None
            return self._fall_back(job, cfg, e.code, e.message, retryable=e.retryable, provider_code=e.provider_code,
                                   paid=False, refund=True, director=block)
        except Exception as e:  # timeout, reset: it may have been accepted
            log.exception("submit to %s raised", provider)
            return self._fall_back(job, cfg, "uncertain",
                                   f"The provider may have this job; it will not be sent again ({type(e).__name__}).",
                                   director=block, may_charge=True)
        now = self.clock()
        min_poll = (sheet.get("results") or {}).get("minPollS", 1)
        saved = self._save(job, state="submitted", requestId=str(request_id), director=block,
                           _submittedAt=now, _nextCheckAt=now + min_poll)
        if saved is None:
            log.error("job %s: provider %s accepted request %s but the ledger write lost a race",
                      job["jobId"], provider, request_id)
            return self._reload(job)
        return self._with_poll(saved)

    def _reserve_as(self, job: dict, provider: str, op: str) -> dict:
        """A frame_edit reserved the dearer of its two ops; once Dex has read the words, the reservation
        follows the op it runs as (the spend counter by the difference)."""
        estimate, unknown = self._estimate(op, provider)
        delta = estimate - job["cost"].get("reserved", 0)
        if not delta:
            return job
        saved = self._save(job, cost={**job["cost"], "estimate": estimate, "reserved": estimate, "unknown": unknown})
        if saved is None:
            return job
        self.store.incr("spend", "usd", delta)
        return saved

    # A frame_edit's current frame reaches Dex within this, or the words go as they are (features/frame-change-edit.clan).
    FRAME_FETCH_S = 3.0

    def _frame_image(self, job: dict) -> tuple[list | None, str | None]:
        """The current frame, downscaled as a character card's picture (cards.downscale), for a director
        that looks at it: ([image], None), or (None, why the passthrough makes the job instead). Only
        pictures in our own store, within FRAME_FETCH_S; an agency that has turned Claude off
        (tenant-limits' allow.claude) sends it nowhere."""
        if not getattr(self.director, "sees_images", False):
            return None, None
        item = self._tenant(job.get("_tenant") or "") or {}
        allow = item.get("allow") or (item.get("body") or {}).get("allow") or {}
        if allow.get("claude") is False:
            return None, "your agency keeps its pictures from Claude"
        url = ((job["_req"].get("input") or {}).get("image") or {}).get("url") or ""
        if self.blobs.key_for_url(url) is None:
            return None, "the frame is not one of ours"
        from concurrent.futures import ThreadPoolExecutor, TimeoutError as FetchTimeout

        from cards import downscale
        pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="frame")
        try:
            data = pool.submit(self.blobs.fetch, url).result(timeout=self.FRAME_FETCH_S)
            media_type, b64 = downscale(data)
        except FetchTimeout:
            log.warning("job %s: the frame took over %ss to fetch; the words go as they are", job["jobId"], self.FRAME_FETCH_S)
            return None, f"the frame did not load within {self.FRAME_FETCH_S:g} s"
        except Exception as e:
            log.warning("job %s: could not read the frame (%s); the words go as they are", job["jobId"], e)
            return None, "the frame could not be read"
        finally:
            pool.shutdown(wait=False)
        return [{"media_type": media_type, "data": b64}], None

    def _direct(self, job: dict, sheet: dict | None) -> tuple[dict, dict]:
        start = self.clock()
        director = self.director  # the passthrough instead, for a frame_edit Dex cannot look at
        try:
            use_config = getattr(self.director, "use_config", None)
            if use_config:  # config.json's director block: the model ids and prompt version
                use_config(self.config().get("director") or {})
            req = job["_req"]
            # Extra views over this provider's ref limits are left out, not refused (names.fit_refs).
            inp, dropped = names.fit_refs(req["op"], req.get("input") or {}, sheet)
            if dropped:
                log.info("job %s: left out %s for %s's ref limits", job["jobId"], ", ".join(dropped), job.get("provider"))
            inp, kinds = self._with_cards(job, inp)
            # The director sees wire tags (names.py); the ledger keeps the participant's names.
            wired = names.to_wire(req["op"], inp)
            if wired.get("answer"):  # what was asked, and what the person chose, in words the director reads
                q = self._asked(job) or {}
                a = wired["answer"]
                chose = next((o for o in q.get("options", []) if o["id"] == a.get("optionId")), None)
                wired = {**wired, "answer": {**a, **({"question": q["text"]} if q.get("text") else {}),
                                              **({"chose": chose["label"]} if chose else {}),
                                              **({"value": chose["value"]} if chose and "value" in chose else {})}}
            kw, unseen = {}, None
            if req["op"] == "frame_edit":
                images, unseen = self._frame_image(job)
                if images:
                    kw = {"images": images}
                elif unseen:  # Dex cannot see the frame: the words go as they are, and the History says why
                    director = PassthroughDirector()
            out = dict(director.direct({**req, "input": wired}, sheet, **kw))
            if unseen:
                out["rationale"] = f"Dex could not look at the frame ({unseen}), so your words went as they are."[:300]
        except PromptTooOld as e:  # a config with director.v5 under contract 3: said plainly, never run
            log.error("%s", e)
            raise ApiError("internal", str(e)) from e
        except Exception as e:
            log.exception("director failed")
            raise ApiError("internal", f"The director failed ({type(e).__name__}).") from e
        model = out.pop("_model", getattr(director, "model", "unknown"))
        version = out.pop("_promptVersion", getattr(director, "prompt_version", "director.v0"))
        errors = self.contracts.errors("director.schema.json", out)
        if errors:
            raise ApiError("internal", f"The director's answer did not match its schema: {errors[0]}")
        block = {"model": model, "promptVersion": version, "output": out,
                 "rationale": out.get("rationale", ""), "latencyMs": int((self.clock() - start) * 1000)}
        # What the director was told each picture shows (the History's "What the director saw").
        used = [{"tag": r["tag"], "sha256": r["asset"]["sha256"], "kind": kinds.get(r["asset"]["sha256"], "other"), "card": r["card"]}
                for r in wired.get("refs") or [] if r.get("card") and r.get("tag")]
        if used:
            block["cards"] = used
        return out, block

    def _with_cards(self, job: dict, inp: dict) -> tuple[dict, dict[str, str]]:
        """The refs the job sends, each with its character card where one is ready (cards.py), and
        each carded picture's kind. Never fails the job: without a card the director works from
        names, as before."""
        if self.cards is None or job["op"] == "shot_list" or not inp.get("refs"):
            return inp, {}
        try:
            got = self.cards.attach(inp["refs"], job["jobId"])
        except Exception:
            log.exception("job %s: cards failed; the director goes on without them", job["jobId"])
            return inp, {}
        return {**inp, "refs": got.refs}, {c["sha256"]: c["kind"] for c in got.cards}

    def _run_shot_list(self, job: dict, cfg: dict) -> dict:
        saved = self._save(job, state="submitting", _queue="r")
        if saved is None:
            return self._reload(job)
        try:
            out, block = self._direct(saved, None)
        except ApiError as e:
            return self._fail(saved, e.code, e.message, paid=False, refund=True)
        if out.get("question"):
            return self._ask(saved, out["question"], block)
        return self._finish(saved, "completed", shots=out["shots"], director=block, outputs=[],
                            kind="generated", paid=False)

    # ── asks (needs_input, ui-behaviour 3.17, 5.2) ──────────────────────────
    def _ask(self, job: dict, question: dict, block: dict) -> dict:
        """The director asked instead of guessing: the job waits in needs_input, uncharged, holding no
        in-flight place and no provider slot, and never times out into a guess. The relay names the
        question (its id is the document's ask key)."""
        q = {"id": new_id("q"), **{k: v for k, v in question.items() if k != "id"}}
        if job["op"] == "frame_edit":
            # No price on an option (owner decision 2026-10-13): what the chosen change costs is recorded
            # with the job, for History. Whatever Dex wrote is dropped.
            q["options"] = [{k: v for k, v in o.items() if k != "cost"} for o in q.get("options") or []]
        cost = {**job["cost"], "reserved": 0.0}
        saved = self._save(job, state="needs_input", question=q, director=block, cost=cost, _queue=None,
                           _released=True, queuePosition=None, _slot=None, provider=None, model=None,
                           requestId=None, fallbackFrom=None)
        if saved is None:
            return self._reload(job)
        if not job.get("_released"):
            self.store.incr(f"inflight#{job['participantId']}", "n", -1)
            if job.get("_slot"):
                self.store.incr(job["_slot"], "n", -1)
            if job["cost"].get("reserved"):
                self.store.incr("spend", "usd", -job["cost"]["reserved"])
        return self._with_poll(saved)

    @staticmethod
    def _answer_of(body: dict) -> dict:
        return {"option_id": body["optionId"]} if "optionId" in body else {"text": body["text"]}

    def _answer_conflict(self, job: dict) -> tuple[int, dict]:
        q = job.get("question") or {}
        ans = job.get("answer") or {}
        label = next((o["label"] for o in q.get("options", []) if o["id"] == ans.get("option_id")), ans.get("text", ""))
        who = (job.get("answeredBy") or "").removeprefix("human:") or "someone"
        if not job.get("answeredBy"):
            raise ApiError("conflict", "This job is not waiting for an answer.")
        return 409, {"error": {"code": "conflict", "message": f"{who} answered first: {label}."[:300], "retryable": False},
                     "answeredBy": job["answeredBy"], "answer": ans}

    def answer(self, who: dict, job: dict, body: dict) -> tuple[int, dict]:
        """POST /jobs/{jobId}/answer: anyone in the job's agency answers; the first answer wins. The same
        job resumes, on its starter's budget (participantId and startedBy stay theirs)."""
        if job.get("answeredBy") or job["state"] != "needs_input":
            return self._answer_conflict(job)
        q = job.get("question") or {}
        if body["questionId"] != q.get("id"):
            raise ApiError("invalid_input", "That is not this job's question.")
        if "optionId" in body and body["optionId"] not in {o["id"] for o in q.get("options", [])}:
            raise ApiError("invalid_input", "That is not one of the question's options.")
        if "text" in body and not q.get("allow_text"):
            raise ApiError("invalid_input", "This question takes one of its options, not words.")
        req = json.loads(json.dumps(job["_req"]))
        req["input"] = {**req["input"], "answer": {k: v for k, v in body.items()}}
        saved = self._save(job, answeredBy=f"human:{who['pid']}", answer=self._answer_of(body), _req=req)
        if saved is None:  # someone else's answer got in first
            return self._answer_conflict(self.store.get_job(job["jobId"]))
        cfg = self.config()
        starter = saved["participantId"]
        if not self.store.incr(f"inflight#{starter}", "n", 1, cfg["inFlightPerParticipant"]):
            failed = self._fail(saved, "queue_full", "Its starter has too many jobs running; answer again soon.",
                                retryable=True, paid=False, refund=True)
            return 200, public(failed)
        resumed = self._save(saved, state="queued", _queue="q", _released=False, _queuedAt=self.clock(), _tried=[])
        if resumed is None:
            self.store.incr(f"inflight#{starter}", "n", -1)
            return 200, public(self._reload(saved))
        return 200, public(self._dispatch(resumed, cfg))

    def _asked(self, job: dict) -> dict | None:
        """The question an answer in this job's input settles: its own (it resumed), or its parent's (a Change)."""
        if job.get("question"):
            return job["question"]
        qid = ((job["_req"].get("input") or {}).get("answer") or {}).get("questionId")
        for pid in job["_req"].get("parentIds") or []:
            parent = self.store.get_job(pid)
            if parent and (parent.get("question") or {}).get("id") == qid:
                return parent["question"]
        return None

    def _run_stitch(self, job: dict, cfg: dict) -> dict:
        if self.stitch is None:
            return self._fail(job, "provider_unavailable", "Stitching is not available here.", paid=False, refund=True)
        clips = []
        for c in job["_req"]["input"].get("clips") or []:
            if c.get("endCard"):  # contract 3's end-card shot: stitch draws the end card itself
                continue
            key = self.blobs.key_for_url(c["asset"]["url"])
            if not key:
                return self._fail(job, "invalid_input", "A clip is not one of ours; upload it first.",
                                  paid=False, refund=True)
            clips.append({"key": key, **({"trimS": c["trimS"]} if "trimS" in c else {})})
        if not clips:
            return self._fail(job, "invalid_input", "Stitch needs at least one clip.", paid=False, refund=True)
        now = self.clock()
        saved = self._save(job, state="submitted", model="ffmpeg", requestId=job["jobId"], _queue="r",
                           _submittedAt=now, _nextCheckAt=now + 3)
        if saved is None:
            return self._reload(job)
        try:
            self.stitch({"jobId": job["jobId"], "clips": clips, "outKey": f"ads/{job['jobId']}.mp4", "resultKey": f"ads/{job['jobId']}.json"})
        except Exception as e:
            log.exception("stitch invoke failed")
            return self._fail(saved, "provider_unavailable", f"Stitching could not start ({type(e).__name__}).",
                              retryable=True, paid=False, refund=True)
        return self._with_poll(saved)

    # ── polling ─────────────────────────────────────────────────────────────
    def advance(self, job: dict) -> dict:
        cfg = self.config()
        now = self.clock()
        state = job["state"]
        if state in TERMINAL or state == "needs_input":  # an ask waits for a person, never for a clock
            return self._with_poll(job)
        if state == "queued":  # waiting since it was made, or since it fell back to the floor
            if now - job.get("_queuedAt", parse_iso(job["createdAt"])) > self._queue_timeout_s(cfg, job):
                message = "Waited too long for a free slot. Try again."
                if job.get("_notBefore") and job.get("_lastError"):  # waiting on a busy provider: say which, and why
                    busy, _, detail = job["_lastError"].partition(": ")
                    message = f"{PROVIDER_NAMES.get(busy, busy)} could not take it in time ({detail}). Try again."
                    if job.get("fallbackReason"):
                        message = f"{job['fallbackReason']} {message}"
                return self._fail(job, "timeout", message, retryable=True, paid=False, refund=True)
            return self._dispatch(job, cfg)
        if state == "submitting":
            if now - parse_iso(job["updatedAt"]) > SUBMITTING_STALE_S:
                return self._fall_back(job, cfg, "uncertain", "The submit never came back; it will not be sent again.",
                                       may_charge=True)
            return self._with_poll(job)
        if state == "fetching" and job.get("_leaseUntil", 0) > now:
            return self._with_poll(job)
        # submitted, or fetching with an expired lease
        if job["op"] == "stitch":
            return self._advance_stitch(job, cfg, now)
        if now - job.get("_submittedAt", now) > self._timeout_s(cfg, job):
            try:
                self._adapter(job).cancel(job["requestId"])
            except Exception:
                log.exception("cancel after timeout failed")
            # Never seen running (it sat in the provider's queue, THROTTLED at Runway): nothing was made, so
            # neither the spend nor the person's quota is kept for it (2026-10-09).
            never_ran = {} if job.get("_ran") else {"paid": False, "refund": True}
            return self._fall_back(job, cfg, "timeout", "The provider took too long. Try again.", retryable=True,
                                   **never_ran)
        if state == "submitted" and now < job.get("_nextCheckAt", 0):
            return self._with_poll(job)
        adapter = self._adapter(job)
        if adapter is None:  # its adapter is gone from this relay: wait for one that has it
            return self._with_poll(job)
        sheet = self._sheet(job) or {}
        min_poll = (sheet.get("results") or {}).get("minPollS", 1)
        try:
            st = adapter.status(job["requestId"])
        except Exception:
            log.exception("status from %s raised", job["provider"])
            saved = self._save(job, _nextCheckAt=now + min_poll)
            return self._with_poll(saved or job)
        if st.state in ("queued", "running"):
            saved = self._save(job, state="submitted", queuePosition=st.queue_position, _nextCheckAt=now + min_poll,
                               _ran=bool(job.get("_ran")) or st.state == "running")
            return self._with_poll(saved or job)
        if st.state == "moderated":
            return self._fail(job, "moderated", st.error_message or "The provider refused this content.",
                              provider_code=st.provider_code)
        if st.state == "cancelled":
            return self._finish(job, "cancelled")
        if st.state == "failed":
            code = st.error_code if st.error_code in STATUS_ERRORS else "provider_failed"
            # The adapter knows whether trying again can help (INTERNAL.BAD_OUTPUT cannot); it said
            # "retryable" regardless before. The provider's or our failure gives the quota back; the
            # spend stays reserved, since the provider may have billed it (2026-10-09).
            retryable = st.retryable if st.retryable is not None else code != "moderated"
            theirs = st.source != "input" and code not in ("moderated", "invalid_input")
            return self._fall_back(job, cfg, code, st.error_message or "The provider could not make this.",
                                   retryable=retryable, provider_code=st.provider_code, refund=theirs)
        return self._fetch(job, st, now)

    def _fetch(self, job: dict, st, now: float) -> dict:
        claimed = self._save(job, state="fetching", _leaseUntil=now + FETCH_LEASE_S)
        if claimed is None:
            return self._reload(job)
        try:
            outputs = []
            for o in st.outputs:
                data = self.blobs.fetch(o["url"])
                sha = "sha256:" + hashlib.sha256(data).hexdigest()
                mime = o.get("mime") or "application/octet-stream"
                key = f"out/{sha}"
                if not self.blobs.exists(key):
                    self.blobs.put(key, data, mime)
                out = {"sha256": sha, "url": self.blobs.public_url(key), "mime": mime, "bytes": len(data)}
                for k in ("w", "h", "durationS"):
                    if o.get(k) is not None:
                        out[k] = o[k]
                if mime.startswith("image/"):
                    out = self._true_shape(out, data, job.get("_aspect"))
                outputs.append(out)
            if not outputs:
                raise ValueError("the provider reported success with no outputs")
        except Exception as e:
            log.exception("copying outputs of %s failed", job["jobId"])
            attempts = claimed.get("_fetchErrors", 0) + 1
            if attempts >= MAX_FETCH_ATTEMPTS:
                return self._fail(claimed, "provider_failed", f"Could not copy the result ({type(e).__name__}).",
                                  retryable=True)
            back = self._save(claimed, state="submitted", _fetchErrors=attempts, _nextCheckAt=now + 2)
            return self._with_poll(back or claimed)
        kind = "mock" if job["provider"] == "mock" else "generated"
        return self._finish(claimed, "completed", outputs=outputs, kind=kind, confirmed=st.cost_usd)

    def _true_shape(self, out: dict, data: bytes, aspect: dict | None) -> dict:
        """An image output measured, and centre-cropped to the job's shape when the provider's size
        differs (frame-aspect): the cropped PNG is the output, with croppedFrom the size it was cut
        from; the original stays under its own out/<sha>."""
        size = measure(data)
        if size:
            out["w"], out["h"] = size
        if not aspect:
            return out
        cropped = crop_png(data, (aspect["w"], aspect["h"]))
        if cropped is None:
            return out
        png, (w, h), (ow, oh) = cropped
        sha = "sha256:" + hashlib.sha256(png).hexdigest()
        key = f"out/{sha}"
        if not self.blobs.exists(key):
            self.blobs.put(key, png, "image/png")
        return {"sha256": sha, "url": self.blobs.public_url(key), "mime": "image/png", "bytes": len(png),
                "w": w, "h": h, "croppedFrom": {"w": ow, "h": oh}}

    def _advance_stitch(self, job: dict, cfg: dict, now: float) -> dict:
        result = self.blobs.get_json(f"ads/{job['jobId']}.json")
        # A render that failed, timed out or was cancelled made no ad: the day's render comes back (refund).
        if result is None:
            if now - job.get("_submittedAt", now) > self._timeout_s(cfg, job):
                return self._fail(job, "timeout", "Stitching took too long. Try again.", retryable=True, paid=False,
                                  refund=True)
            return self._with_poll(job)
        if not result.get("ok"):
            if result.get("code") == STITCH_BAD_CLIP:  # a clip it cannot read: render again fails the same way
                return self._fail(job, "invalid_input", result.get("error", "A clip could not be read.")[:300],
                                  paid=False, refund=True)
            return self._fail(job, "provider_failed", result.get("error", "Stitching failed.")[:300],
                              retryable=True, paid=False, refund=True)
        out = {"sha256": result["sha256"], "url": self.blobs.public_url(f"ads/{job['jobId']}.mp4"),
               "mime": "video/mp4", "bytes": result["bytes"]}
        for k in ("w", "h", "durationS"):
            if result.get(k) is not None:
                out[k] = result[k]
        return self._finish(job, "completed", outputs=[out], kind="generated", paid=False)

    def cancel(self, job: dict) -> dict:
        state = job["state"]
        if state == "queued":
            return self._finish(job, "cancelled", paid=False, refund=True)
        if state == "needs_input":  # holds nothing but the day's quota, which comes back
            out = self._finish(job, "cancelled", paid=False)
            if out["state"] == "cancelled" and job.get("_counted"):
                self.store.incr(f"{job['participantId']}#{job['_day']}", job["quotaClass"], -1)
            return out
        if state in ("submitted", "uncertain"):
            if job["op"] == "stitch":  # our own Lambda, no provider bill: the render comes back
                return self._finish(job, "cancelled", paid=False, refund=True)
            # Uncertain: no answer in time, so the provider may have it. Stop waiting: cancel it there
            # if we know its id, and never send it again (2026-10-09: a 30 s upload left a job
            # "Checking…" with no way out).
            if job.get("provider") and job.get("requestId"):
                try:
                    self._adapter(job).cancel(job["requestId"])
                except Exception:
                    log.exception("provider cancel failed")
            return self._finish(job, "cancelled")
        return self._with_poll(job)  # final, or mid-submit / mid-copy: let it land

    # ── the scheduled sweep ─────────────────────────────────────────────────
    def sweep(self, limit: int = 50) -> int:
        """Advance jobs nobody is polling (closed tabs), so slots and quotas come back."""
        n = 0
        for queue in ("r", "q"):
            for job in self.store.list_active(queue):
                if n >= limit:
                    return n
                try:
                    self.advance(job)
                except Exception:
                    log.exception("sweep of %s failed", job["jobId"])
                n += 1
        return n
