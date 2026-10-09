"""The relay: routes, the job ledger, quotas, the fair-share queue and the spend stop.

Storage-agnostic: the Lambda handler (handler.py) and the dev server (local.py)
both build a Relay and call `Relay.http(method, path, headers, body)`.

Job life (states from common.schema.json#/$defs/jobState):
  queued      admitted (quota, in-flight and spend checked) and waiting for a
              provider slot in the global fair-share queue
  submitting  a slot is held; the director and the provider submit are running
  submitted   the provider has it (requestId saved)
  fetching    outputs are being copied to S3 and hashed
  completed | failed | cancelled   final
  uncertain   the provider may have taken it with no id saved: never resubmitted there

Runway is the floor of every job (features/runway-fallback.clan). A job's chain is the
participant's own-key providers for the op (or a pick, or the event's routing), then Runway on
the event's key, always last. A provider in front of Runway that fails for a provider or account
reason, before or after submit, sends the job to Runway's default model for the op, once
(Job.fallbackFrom and fallbackReason say so). Moderation and invalid input never move.

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
from datetime import datetime, timezone

import library
import names
import own_keys
from contracts import Contracts, api
from director.base import Director
from providers import Registry
from providers.base import CapabilityMissing, Moderated, ProviderError, set_job_context
from providers.types import effective_sheet, op_models

log = logging.getLogger("relay")

PROVIDER_NAMES = {"fal": "fal", "runway": "Runway", "heygen": "HeyGen", "mock": "Mock"}

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
    Not a Napkin problem and not the participant's account; sending it again cannot work.
    either: the floor ruled it out after another provider could not make it."""
    provider, _, reason = last_error.partition(": ")
    reason = reason or last_error
    for subject in (provider, op):  # "fal takes at most 5 character refs", "region_edit needs a mask"
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

QUOTA_CLASS = {
    "generate": "image", "view": "image", "frame": "image", "region_edit": "image",
    "clip": "video", "clip_edit": "video", "stitch": "render", "shot_list": "text",
}
INTERNAL_OPS = {"shot_list", "stitch"}  # no provider: the director, or the stitch Lambda
TERMINAL = {"completed", "failed", "cancelled", "uncertain"}
# The event's provider every job falls back to, once, when the op routes to it (features/runway-fallback.clan).
FLOOR = "runway"
NO_FALLBACK = {"moderated", "invalid_input"}  # the floor would refuse the same
UNKNOWN_PRICE_USD = 1.0      # reserved for an op whose sheet has no price (HeyGen)
ORGANISER_QUOTA_FACTOR = 10
SESSION_TTL_S = 24 * 3600
CLAN_MAX_BYTES = 5 * 1024 * 1024
CLAN_MIME = "application/vnd.clan+zip"
CLAN_REASONS = {"interval", "accept", "manual"}
DEFAULT_WORKSPACE = "event"
KEY = re.compile(r"^[a-z][a-z0-9]{1,23}$")


def workspace_of(codes: dict, code: str) -> str:
    """The workspace an event code belongs to (EVENT_CODES "workspaces": {"CODE": "acme"})."""
    mapped = {c.upper(): w for c, w in (codes.get("workspaces") or {}).items()}
    return mapped.get(code, DEFAULT_WORKSPACE)
SUBMITTING_STALE_S = 120       # a submit that never came back
FETCH_LEASE_S = 90
MAX_FETCH_ATTEMPTS = 3
STATUS_ERRORS = {
    "invalid_input": 400, "unauthorised": 401, "blocked": 403, "flag_off": 403,
    "quota_exhausted": 429, "queue_full": 429, "spend_stop": 503, "capability_missing": 422,
    "moderated": 422, "provider_failed": 502, "provider_unavailable": 503, "timeout": 504,
    "uncertain": 409, "conflict": 409, "internal": 500,
}


def own_keys_unreadable(provider: str) -> str:
    return f"The relay can no longer read your {own_keys.NAMES.get(provider, provider)} key for this job. Try again."


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


def iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_iso(s: str) -> float:
    return datetime.strptime(s, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc).timestamp()


def participant_id(handle: str) -> str:
    return "p_" + hashlib.sha256(handle.lower().encode()).hexdigest()[:10]


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
    def __init__(self, *, store, blobs, registry: Registry, director: Director, config, secrets,
                 contracts: Contracts | None = None, clock=time.time, stitch=None,
                 own_adapters: own_keys.OwnAdapters | None = None, cards=None):
        """config: () -> config.json dict (cached by the caller).
        secrets: () -> {"event_codes": {"participant": [...], "organiser": [...]}, "token_secret": str}.
        stitch: (payload dict) -> None, starts the stitch Lambda asynchronously.
        own_adapters: adapters on a participant's own key (built on first use).
        cards: cards.Cards, what each ref picture shows, for the director (None: no model, no cards)."""
        self.store, self.blobs, self.registry, self.director = store, blobs, registry, director
        self._own_adapters = own_adapters
        self.config, self.secrets = config, secrets
        self.contracts = contracts or Contracts()
        self.clock = clock
        self.stitch = stitch
        self.cards = cards

    # ── HTTP ────────────────────────────────────────────────────────────────
    def http(self, method: str, path: str, headers: dict, body: bytes | None) -> tuple[int, dict | None, dict]:
        """Returns (status, JSON body or None, log fields). Never raises."""
        start = self.clock()
        ctx: dict = {"method": method, "route": path}
        try:
            status, out = self._route(method.upper(), path, {k.lower(): v for k, v in headers.items()}, body, ctx)
        except ApiError as e:
            status, out = e.status, e.body()
            ctx["error"] = e.code
        except Exception:
            log.exception("internal error")
            status, out = 500, ApiError("internal", "Something went wrong in the relay.", retryable=True).body()
            ctx["error"] = "internal"
        ctx["status"] = status
        ctx["latencyMs"] = int((self.clock() - start) * 1000)
        if out and "state" in out:
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
        return status, out, ctx

    def _route(self, method, path, headers, body, ctx):
        if path.startswith("/api/"):
            path = path[4:]
        path = path.rstrip("/") or "/"
        if method == "POST" and path == "/session":
            return 200, self.session(self._json(body, "SessionRequest"), ctx)
        if method == "GET" and path == "/config":
            return 200, self.config()
        if method == "GET" and path == "/health":
            return 200, {"ok": True}
        who = self._auth(headers)
        ctx["participant"] = who["pid"]
        if method == "POST" and path == "/uploads":
            self._not_blocked(who)
            return 200, self.upload(self._json(body, "UploadRequest"))
        if method == "POST" and path == "/jobs":
            self._not_blocked(who)
            req = self._json(body, "JobRequest")
            ctx["jobId"], ctx["op"] = req["jobId"], req["op"]
            if req.get("modelChoice"):  # what the participant picked, beside where it ran
                ctx["pick"] = f'{req["modelChoice"]["provider"]}:{req["modelChoice"]["model"]}'
            return 200, public(self.create_job(who, req, headers.get(own_keys.HEADER)))
        if path.startswith("/jobs/"):
            job_id = path[len("/jobs/"):]
            ctx["jobId"] = job_id
            job = self._own_job(who, job_id)
            if method == "GET":
                return 200, public(self.advance(job))
            if method == "DELETE":
                return 200, public(self.cancel(job))
        if path == "/library" or path.startswith("/library/"):
            return 200, self.library_route(who, method, path, body, ctx)
        if method == "POST" and path == "/clan":
            self._not_blocked(who)
            ctx["clanBytes"] = self.mirror_clan(who, headers, body)
            return 204, None
        if method == "POST" and path == "/log":
            entry = self._json(body, "LogEntry")
            ctx.update({"clientLevel": entry["level"], "clientMessage": entry["message"][:500],
                        "jobId": entry.get("jobId"), "stage": entry.get("stage"), "browser": entry.get("browser")})
            if entry.get("stack"):
                ctx["clientStack"] = entry["stack"][:2000]
            return 204, None
        raise ApiError("invalid_input", f"No route {method} {path}.", status=404)

    def _json(self, body: bytes | None, schema: str) -> dict:
        try:
            data = json.loads(body or b"null")
        except (ValueError, UnicodeDecodeError):
            raise ApiError("invalid_input", "The body is not JSON.") from None
        errors = self.contracts.errors(api(schema), data)
        if errors:
            raise ApiError("invalid_input", f"Invalid {schema}: {errors[0]}")
        return data

    def _auth(self, headers: dict) -> dict:
        auth = headers.get("authorization", "")
        if not auth.lower().startswith("bearer "):
            raise ApiError("unauthorised", "Sign in again.")
        from tokens import verify

        payload = verify(auth[7:].strip(), self.secrets()["token_secret"], self.clock())
        if not payload:
            raise ApiError("unauthorised", "Your session has expired. Sign in again.")
        return payload

    def _not_blocked(self, who: dict) -> None:
        if self.store.is_blocked(who["h"]):
            raise ApiError("blocked", "This handle has been blocked by the organisers.")

    def _own_job(self, who: dict, job_id: str) -> dict:
        job = self.store.get_job(job_id)
        if not job or (job["participantId"] != who["pid"] and who.get("r") != "organiser"):
            raise ApiError("invalid_input", "No such job.", status=404)
        return job

    # ── session and uploads ─────────────────────────────────────────────────
    def session(self, req: dict, ctx: dict) -> dict:
        from tokens import sign

        secrets = self.secrets()
        codes = secrets["event_codes"]
        code = req["eventCode"].strip().upper()
        if code in {c.upper() for c in codes.get("organiser", [])}:
            role = "organiser"
        elif code in {c.upper() for c in codes.get("participant", [])}:
            role = "participant"
        else:
            raise ApiError("unauthorised", "That event code is not right.")
        handle = req["handle"]
        if self.store.is_blocked(handle):
            raise ApiError("blocked", "This handle has been blocked by the organisers.")
        pid = participant_id(handle)
        ctx["participant"] = pid
        exp = int(self.clock()) + SESSION_TTL_S
        workspace = workspace_of(codes, code)
        token = sign({"pid": pid, "h": handle, "r": role, "w": workspace, "exp": exp}, secrets["token_secret"])
        return {"token": token, "participantId": pid, "handle": handle, "role": role, "workspace": workspace,
                "expiresAt": iso(exp), "quotas": self.remaining(pid, role)}

    def _day(self) -> str:
        return iso(self.clock())[:10]

    def remaining(self, pid: str, role: str) -> dict:
        quotas = self.config()["quotas"]
        used = self.store.counters(f"{pid}#{self._day()}")
        factor = ORGANISER_QUOTA_FACTOR if role == "organiser" else 1
        return {c: max(0, int(quotas[c] * factor - used.get(c, 0))) for c in ("image", "video", "render")}

    def upload(self, req: dict) -> dict:
        key = f"in/{req['sha256']}"
        url = self.blobs.public_url(key)
        if self.blobs.exists(key):
            return {"exists": True, "url": url}
        return {"exists": False, "putUrl": self.blobs.presign_put(key, req["mime"]), "url": url}

    def mirror_clan(self, who: dict, headers: dict, body: bytes | None) -> int:
        """POST /clan: keep the participant's latest .clan, plus a timestamped copy, for the organisers."""
        data = body or b""
        if len(data) > CLAN_MAX_BYTES:
            raise ApiError("invalid_input", "The document is larger than 5 MB.", status=413)
        if not data.startswith(b"PK\x03\x04"):
            raise ApiError("invalid_input", "The body is not a .clan file.")
        reason = headers.get("x-clan-reason", "manual")
        if reason not in CLAN_REASONS:
            reason = "manual"
        stamp = iso(self.clock()).replace(":", "")
        for key in (f"clan/{who['pid']}/latest.clan", f"clan/{who['pid']}/{stamp}-{reason}.clan"):
            self.blobs.put(key, data, CLAN_MIME)
        return len(data)

    # ── the workspace library ───────────────────────────────────────────────
    def library_route(self, who: dict, method: str, path: str, body: bytes | None, ctx: dict) -> dict:
        workspace = who.get("w") or DEFAULT_WORKSPACE
        lib = library.Library(self.blobs, lambda: iso(self.clock()))
        if method == "GET" and path == "/library":
            return lib.index(workspace)
        key, _, ver = path[len("/library/"):].partition("/")
        if not KEY.match(key) or (ver and not ver.isdigit()):
            raise ApiError("invalid_input", "A key is lowercase letters and digits, 2 to 24 of them.")
        ctx["libraryKey"] = key
        try:
            if method == "GET":
                return lib.entry(workspace, key, int(ver) if ver else None)
            if method == "POST" and not ver:
                self._not_blocked(who)
                return lib.publish(workspace, key, self._json(body, "LibraryPublish"), who["h"])
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
        """Runway, when the event routes the op to it: the last provider of every job's chain.
        A config that does not route the op to Runway (a single-provider pathway) has no floor."""
        if op in INTERNAL_OPS or FLOOR not in cfg["routing"].get(op, []) or not self.registry.supports(FLOOR, op):
            return None
        return FLOOR

    def _chain(self, cfg: dict, op: str, pick: dict | None, own: dict | None) -> list[str]:
        """Where a job runs, in order: the own-key providers (or a pick, or the event's routing),
        then the floor on the event's key."""
        if own:
            front = list(own)
        elif pick:
            front = [pick["provider"]] if self.registry.supports(pick["provider"], op) else []
        else:
            front = self._candidates(cfg, op)
        floor = self._floor(cfg, op)
        return front + ([floor] if floor and floor not in front else [])

    # ── a model the participant picked (features/model-choice.clan) ─────────
    def _check_pick(self, cfg: dict, op: str, pick: dict | None, own: dict | None = None) -> None:
        """Refuse, before any spend or quota, a pick the routing or the sheet does not allow.
        A pick on the participant's own key answers to that key's sheet; any other pick to the
        event's routing, which names only Runway for the event (fal and HeyGen come from own keys)."""
        if pick is None:
            return
        provider, model = pick["provider"], pick["model"]
        if own and provider in own:
            sheet = self.own_adapters.sheet(provider)
        elif provider in cfg["routing"].get(op, []):
            sheet = self.registry.sheet(provider)
        else:
            sheet = None
        if op in INTERNAL_OPS or not sheet or model not in op_models(sheet, op):
            raise ApiError("invalid_input", f"{model} on {provider} cannot make this step. Pick another model.")

    # ── own keys ────────────────────────────────────────────────────────────
    @property
    def own_adapters(self) -> own_keys.OwnAdapters:
        if self._own_adapters is None:
            self._own_adapters = own_keys.OwnAdapters()
        return self._own_adapters

    def _sealer(self) -> own_keys.Sealer:
        return own_keys.Sealer(self.secrets()["token_secret"])

    def _own_candidates(self, cfg: dict, op: str, raw: str | None, pick: dict | None = None) -> dict[str, str]:
        """The participant's keys for the providers that can do this op, in
        preference order. Empty: the job runs on the event's routing."""
        if op in INTERNAL_OPS or not cfg["flags"].get("ownKeys"):
            return {}
        try:
            keys = own_keys.parse(raw)
        except own_keys.BadKeys as e:
            raise ApiError("invalid_input", str(e)) from None
        own = {p: keys[p] for p in own_keys.PROVIDERS if p in keys and self.own_adapters.supports(p, op)}
        if pick:
            # A pick runs on the participant's key for the picked provider, then on the floor. Picking it is
            # their choice, so fal's backup-only rule for clips does not apply (features/harness-refusals.clan).
            return {p: k for p, k in own.items() if p == pick["provider"]}
        if op in own_keys.BACKUP_ONLY.get("fal", ()) and "heygen" not in own:
            own.pop("fal", None)
        return own

    @staticmethod
    def _is_own(job: dict) -> bool:
        """The job runs, or waits to run, on the participant's own key."""
        return job.get("keySource") == "own"

    @staticmethod
    def _on_own(job: dict, provider: str | None) -> bool:
        """This provider runs the job on the participant's key (the floor never does)."""
        return bool(provider) and provider in (job.get("_own") or {})

    def _job_candidates(self, cfg: dict, job: dict) -> list[str]:
        return self._chain(cfg, job["op"], job["_req"].get("modelChoice"), job.get("_own"))

    def _sheet(self, job: dict, provider: str | None = None) -> dict | None:
        provider = provider or job.get("provider")
        if self._on_own(job, provider):
            return self.own_adapters.sheet(provider)
        return self.registry.sheet(provider)

    def _adapter(self, job: dict, provider: str | None = None):
        """The adapter for this job: the event's, or one on the participant's key.
        None when an own key cannot be read (TOKEN_SECRET rotated)."""
        provider = provider or job["provider"]
        if not self._on_own(job, provider):
            return self.registry.get(provider)
        key = self._sealer().open(job["_own"].get(provider, ""), job["jobId"], provider)
        return self.own_adapters.get(provider, key) if key else None

    def _slot_key(self, job: dict, provider: str, cls: str) -> str:
        """Own-key runs use the participant's own slots at that provider, never the event's."""
        if self._on_own(job, provider):
            return f"slots#{provider}#own#{job['participantId']}#{cls}"
        return f"slots#{provider}#{cls}"

    def _check_flags(self, cfg: dict, req: dict) -> None:
        op, inp, flags = req["op"], req["input"], cfg["flags"]
        off = None
        if op in ("shot_list", "frame") and not flags["storyboard"]:
            off = "The storyboard is switched off for now."
        elif op in ("clip", "clip_edit") and not flags["video"]:
            off = "Video is switched off for now."
        elif op == "stitch" and not flags["stitch"]:
            off = "Stitching is switched off for now."
        elif op == "region_edit" and not (flags["regionEditFrames"] or flags["regionEditCanvas"]):
            off = "Region edits are switched off for now."
        elif op == "clip_edit" and (inp.get("region") or inp.get("mask")) and not flags["videoRegionEdit"]:
            off = "Region edits on video are switched off for now."
        elif op == "clip_edit" and inp.get("feel") and not flags["feelEdit"]:
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

    def create_job(self, who: dict, req: dict, own_header: str | None = None) -> dict:
        existing = self.store.get_job(req["jobId"])
        if existing:
            return self._existing(who, existing)
        cfg = self.config()
        op = req["op"]
        qclass = QUOTA_CLASS[op]
        self._check_flags(cfg, req)
        pick = req.get("modelChoice")
        own = self._own_candidates(cfg, op, own_header, pick)
        self._check_pick(cfg, op, pick, own)
        try:  # a misspelt @name is the participant's to fix: say so now, not as a failed job
            names.to_wire(op, req["input"])
        except (names.UnknownName, ValueError) as e:
            raise ApiError("invalid_input", str(e)) from None
        estimate, unknown = 0.0, False
        if op not in INTERNAL_OPS and not own:
            # Reserved at the dearest provider it may run on. An own-key job reserves nothing
            # until it falls back to the floor (_submit reserves and counts it then).
            candidates = self._chain(cfg, op, pick, None)
            if not candidates:
                raise ApiError("capability_missing", "No provider can do this step right now.")
            prices = [self._estimate(op, p, pick["model"] if pick and p == pick["provider"] else None) for p in candidates]
            estimate = max(p for p, _ in prices)
            unknown = any(u for _, u in prices)
        if estimate > 0 and self.store.counters("spend").get("usd", 0) >= cfg["spend"]["capUsd"]:
            raise ApiError("spend_stop", "The event's generation budget is used up.")

        pid, role = who["pid"], who.get("r", "participant")
        if not self.store.incr(f"inflight#{pid}", "n", 1, cfg["inFlightPerParticipant"]):
            raise ApiError("queue_full", f"You have {cfg['inFlightPerParticipant']} jobs running; wait for one to finish.",
                           retryable=True, retry_after=10)
        day = self._day()
        counted = qclass in cfg["quotas"] and not own  # their own money: no daily quota
        if counted:
            limit = cfg["quotas"][qclass] * (ORGANISER_QUOTA_FACTOR if role == "organiser" else 1)
            if not self.store.incr(f"{pid}#{day}", qclass, 1, limit):
                self.store.incr(f"inflight#{pid}", "n", -1)
                raise ApiError("quota_exhausted", f"You have used today's {qclass} quota.")
        if estimate > 0:
            self.store.incr("spend", "usd", estimate)

        now = self.clock()
        job = {
            "contractVersion": "2", "jobId": req["jobId"], "participantId": pid, "op": op,
            "quotaClass": qclass, "state": "queued", "inputHashes": sorted({a["sha256"] for a in asset_refs(req["input"])}),
            "cost": {"estimate": estimate, "reserved": estimate, "currency": "USD", "unknown": unknown},
            "createdAt": iso(now), "updatedAt": iso(now),
            "_req": req, "_role": role, "_day": day, "_counted": counted, "_queue": "q",
            "_released": False, "_tried": [],
        }
        if pick:  # where the job meant to run, for fallbackFrom
            job["_first"] = {"provider": pick["provider"], "model": pick["model"]}
        if op not in INTERNAL_OPS:
            job["keySource"] = "own" if own else "event"
        if own:
            sealer = self._sealer()
            job["_own"] = {p: sealer.seal(k, req["jobId"], p) for p, k in own.items()}
        if not self.store.create_job(job):  # the same jobId raced in: undo, return theirs
            self.store.incr(f"inflight#{pid}", "n", -1)
            if counted:
                self.store.incr(f"{pid}#{day}", qclass, -1)
            if estimate > 0:
                self.store.incr("spend", "usd", -estimate)
            return self._existing(who, self.store.get_job(req["jobId"]))
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
        return trial if self.store.save_job(trial) else None

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
        if self._is_own(job):
            spend_delta = 0.0  # billed to the participant's account, not the event
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

    # ── the queue ───────────────────────────────────────────────────────────
    def _slot_class(self, op: str) -> str:
        return "video" if QUOTA_CLASS[op] == "video" else "image"

    def _queue_position(self, job: dict) -> int:
        """Fair share: participants with fewer jobs at a provider go first, then
        the oldest job. Counted among queued jobs of the same slot class."""
        cls = self._slot_class(job["op"])
        queued = [j for j in self.store.list_active("q") if j["op"] not in INTERNAL_OPS
                  and self._slot_class(j["op"]) == cls and self._same_lane(job, j)]
        running: dict[str, int] = {}
        for j in self.store.list_active("r"):
            running[j["participantId"]] = running.get(j["participantId"], 0) + 1
        queued.sort(key=lambda j: (running.get(j["participantId"], 0), j["createdAt"], j["jobId"]))
        ids = [j["jobId"] for j in queued]
        return ids.index(job["jobId"]) if job["jobId"] in ids else 0

    def _same_lane(self, job: dict, other: dict) -> bool:
        """Event jobs queue together; own-key jobs queue only behind the same
        participant's own-key jobs, since they use that participant's slots."""
        if self._is_own(job):
            return self._is_own(other) and other["participantId"] == job["participantId"]
        return not self._is_own(other)

    def _free_slots(self, job: dict, candidates: list[str], cls: str) -> int:
        free = 0
        for p in candidates:
            limit = (self._sheet(job, p) or {}).get("concurrency", {}).get(cls, 0)
            free += max(0, int(limit - self.store.counters(self._slot_key(job, p, cls)).get("n", 0)))
        return free

    def _dispatch(self, job: dict, cfg: dict) -> dict:
        if job["state"] != "queued":
            return self._with_poll(job)
        op = job["op"]
        if op == "shot_list":
            return self._run_shot_list(job, cfg)
        if op == "stitch":
            return self._run_stitch(job, cfg)
        cls = self._slot_class(op)
        candidates = [p for p in self._job_candidates(cfg, job) if p not in job["_tried"]]
        if not candidates:
            return self._fail(job, "capability_missing", "No provider can do this step right now.",
                              paid=False, refund=True)
        position = self._queue_position(job)
        if position >= self._free_slots(job, candidates, cls):
            return self._with_poll({**job, "queuePosition": position})
        for provider in candidates:
            limit = (self._sheet(job, provider) or {}).get("concurrency", {}).get(cls, 0)
            slot = self._slot_key(job, provider, cls)
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
        message = "No provider could take this job. Try again."
        if job.get("_own"):
            names = " or ".join(own_keys.NAMES[p] for p in job["_own"])
            message = f"Your {names} account could not take this step. Try again, or remove your key to use the event's providers."
            if last:
                message += f" ({last})"
        return self._fail(job, "provider_unavailable", message, retryable=True, paid=False, refund=True)

    def _event_admission(self, job: dict, cfg: dict, estimate: float) -> dict | None:
        """A job about to run on the event's key that was not admitted as one (an own-key job
        falling back, or a job whose first provider failed after submit): the daily quota and the
        spend stop apply to it now. The failed job, or None when it may run."""
        first = job.get("fallbackReason") or ""
        name = PROVIDER_NAMES.get(FLOOR, FLOOR)
        if estimate > 0 and job["cost"].get("reserved", 0) == 0:
            if self.store.counters("spend").get("usd", 0) >= cfg["spend"]["capUsd"]:
                return self._fail(job, "spend_stop", f"{first} {name} could not make it instead: the event's "
                                  "generation budget is used up.".strip(), paid=False, refund=True)
        cls = job["quotaClass"]
        if not job.get("_counted") and cls in cfg["quotas"]:
            limit = cfg["quotas"][cls] * (ORGANISER_QUOTA_FACTOR if job.get("_role") == "organiser" else 1)
            if not self.store.incr(f"{job['participantId']}#{job['_day']}", cls, 1, limit):
                return self._fail(job, "quota_exhausted", f"{first} {name} could not make it instead: you have used "
                                  f"today's {cls} quota.".strip(), paid=False)
        return None

    def _fall_back(self, job: dict, cfg: dict, code: str, message: str, *, paid: bool = True,
                   refund: bool = False, retryable: bool = False, provider_code: str | None = None,
                   may_charge: bool = False, **kw) -> dict:
        """A provider in front of the floor failed for a provider or account reason, before or after
        submit: make the job again on the floor's default model, once. Otherwise fail as before.
        paid: the first provider may have charged the event, so its reservation stays spent.
        may_charge: it may have the job (uncertain), so the job says it may still charge."""
        provider = job.get("provider")
        floor = self._floor(cfg, job["op"])
        if code in NO_FALLBACK or not floor or provider == floor or floor in job["_tried"]:
            return self._fail(job, code, message, retryable=retryable, provider_code=provider_code,
                              paid=paid, refund=refund, **kw)
        if self._on_own(job, provider):
            who = f"{own_keys.NAMES.get(provider, provider)} may still charge your account for its attempt."
        else:
            who = f"{PROVIDER_NAMES.get(provider, provider)} may still charge for its attempt."
        reason = could_not(provider, message) + (f" {who}" if may_charge else "")
        cost = dict(job["cost"])
        spend_back = 0.0 if self._on_own(job, provider) or paid else -cost.get("reserved", 0)
        cost.update(estimate=0.0, reserved=0.0)  # _submit reserves the floor's price
        front = [p for p in self._job_candidates(cfg, job) if p != floor]
        tried = job["_tried"] + [p for p in front if p not in job["_tried"]]
        log.info("job %s: %s failed (%s); making it on %s", job["jobId"], provider, code, floor)
        saved = self._save(job, state="queued", provider=None, model=None, requestId=None, _slot=None, _queue="q",
                           queuePosition=None, keySource="event", cost=cost, _tried=tried,
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
        own = self._on_own(job, provider)
        sheet = effective_sheet(self._sheet(job, provider), job["op"], picked)
        estimate, unknown = (0.0, False) if own else self._estimate(job["op"], provider, picked)
        counted = job.get("_counted", False)
        if not own:  # on the event's key: an own-key job that fell back is counted now
            refused = self._event_admission(job, cfg, estimate)
            if refused is not None:
                self.store.incr(slot, "n", -1)
                return refused
            counted = counted or job["quotaClass"] in cfg["quotas"]
        cost = {**job["cost"], "estimate": estimate, "reserved": estimate, "unknown": unknown}
        model = sheet["ops"][job["op"]]["model"]
        first = job.get("_first") or {"provider": provider, "model": model}
        moved = {"fallbackFrom": first} if first["provider"] != provider else {}
        saved = self._save(job, state="submitting", provider=provider, model=model, _slot=slot,
                           _queue="r", cost=cost, queuePosition=None, keySource="own" if own else "event",
                           _first=first, _counted=counted, **moved)
        if saved is None:
            self.store.incr(slot, "n", -1)
            if counted and not job.get("_counted"):
                self.store.incr(f"{job['participantId']}#{job['_day']}", job["quotaClass"], -1)
            return self._reload(job)
        delta = estimate - job["cost"].get("reserved", 0)
        if delta:
            self.store.incr("spend", "usd", delta)
        job = saved

        try:
            directed, block = self._direct(job, sheet)
        except ApiError as e:
            return self._fail(job, e.code, e.message, paid=False, refund=True)
        if directed.get("needsUser"):
            return self._finish(job, "completed", needsUser=directed["needsUser"], director=block,
                                outputs=[], paid=False, refund=True)
        pjob = directed["providerJob"]
        set_job_context(job["op"], asset_refs(job["_req"]["input"]))
        adapter = self._adapter(job, provider)
        if adapter is None:
            return self._fall_back(job, cfg, "provider_failed", own_keys_unreadable(provider), paid=False,
                                   refund=True, director=block)
        try:
            request_id = adapter.submit(pjob)
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
                back = self._save(job, state="queued", provider=None, model=None, _slot=None, _queue="q",
                                  _tried=tried, _lastError=f"{provider}: {e.message}"[:300],
                                  _sheetOnly=sheet_only, _floorSheet=sheet,
                                  fallbackReason=job.get("fallbackReason") or could_not(provider, e.message),
                                  keySource="own" if rest and self._on_own(job, rest[0]) else "event")
                self.store.incr(slot, "n", -1)
                if back is None:
                    log.error("job %s: could not requeue after %s refused", job["jobId"], provider)
                return None
            message = e.message
            if own and own_keys.refused(provider, e.code, e.message, e.provider_code):
                message = f"Your {own_keys.NAMES[provider]} key was refused. Check it, or remove it."
            return self._fall_back(job, cfg, e.code, message, retryable=e.retryable, provider_code=e.provider_code,
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

    def _direct(self, job: dict, sheet: dict | None) -> tuple[dict, dict]:
        start = self.clock()
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
            out = dict(self.director.direct({**req, "input": wired}, sheet))
        except Exception as e:
            log.exception("director failed")
            raise ApiError("internal", f"The director failed ({type(e).__name__}).") from e
        model = out.pop("_model", getattr(self.director, "model", "unknown"))
        version = out.pop("_promptVersion", getattr(self.director, "prompt_version", "director.v0"))
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
        if out.get("needsUser"):
            return self._finish(saved, "completed", needsUser=out["needsUser"], director=block, outputs=[], paid=False)
        return self._finish(saved, "completed", shots=out["shots"], director=block, outputs=[],
                            kind="generated", paid=False)

    def _run_stitch(self, job: dict, cfg: dict) -> dict:
        if self.stitch is None:
            return self._fail(job, "provider_unavailable", "Stitching is not available here.", paid=False, refund=True)
        clips = []
        for c in job["_req"]["input"].get("clips") or []:
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
            self.stitch({"jobId": job["jobId"], "clips": clips, "eventName": cfg.get("eventName", ""),
                         "outKey": f"ads/{job['jobId']}.mp4", "resultKey": f"ads/{job['jobId']}.json"})
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
        if state in TERMINAL:
            return self._with_poll(job)
        if state == "queued":  # waiting since it was made, or since it fell back to the floor
            if now - job.get("_queuedAt", parse_iso(job["createdAt"])) > self._timeout_s(cfg, job):
                return self._fail(job, "timeout", "Waited too long for a free slot. Try again.",
                                  retryable=True, paid=False, refund=True)
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
            return self._fall_back(job, cfg, "timeout", "The provider took too long. Try again.", retryable=True)
        if state == "submitted" and now < job.get("_nextCheckAt", 0):
            return self._with_poll(job)
        adapter = self._adapter(job)
        if adapter is None:
            if self._on_own(job, job["provider"]):
                return self._fall_back(job, cfg, "provider_failed", own_keys_unreadable(job["provider"]))
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
            saved = self._save(job, state="submitted", queuePosition=st.queue_position, _nextCheckAt=now + min_poll)
            return self._with_poll(saved or job)
        if st.state == "moderated":
            return self._fail(job, "moderated", st.error_message or "The provider refused this content.",
                              provider_code=st.provider_code)
        if st.state == "cancelled":
            return self._finish(job, "cancelled")
        if st.state == "failed":
            code = st.error_code if st.error_code in STATUS_ERRORS else "provider_failed"
            return self._fall_back(job, cfg, code, st.error_message or "The provider could not make this.",
                                   retryable=code != "moderated", provider_code=st.provider_code)
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

    def _advance_stitch(self, job: dict, cfg: dict, now: float) -> dict:
        result = self.blobs.get_json(f"ads/{job['jobId']}.json")
        if result is None:
            if now - job.get("_submittedAt", now) > self._timeout_s(cfg, job):
                return self._fail(job, "timeout", "Stitching took too long. Try again.", retryable=True, paid=False)
            return self._with_poll(job)
        if not result.get("ok"):
            return self._fail(job, "provider_failed", result.get("error", "Stitching failed.")[:300],
                              retryable=True, paid=False)
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
        if state in ("submitted", "uncertain"):
            # Uncertain: no answer in time, so the provider may have it. Stop waiting: cancel it there
            # if we know its id, and never send it again (2026-10-09: a 30 s upload left a job
            # "Checking…" with no way out).
            if job["op"] != "stitch" and job.get("provider") and job.get("requestId"):
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
