# Copied from server/napkin/model_routes.py; keep in step until the shared package (D8)
"""Which model, effort and schema mode each model call uses (peripherals.md §1.9).

Every call names its purpose (`extract`, `synthesise`, `extract_category_facts`,
…). A routes file maps a purpose to a model and an effort, with a default for
everything else, so switching a model is an edit to one file, not a deploy:

    NAPKIN_MODEL_ROUTES=/etc/napkin/model-routes.json     (or the JSON itself)

    {
      "default":  {"model": "opus-4.6", "schema": "auto"},
      "vision":   {"model": "opus-4.6"},
      "purposes": {
        "extract_category_facts": {"model": "opus-5.5", "effort": "low"},
        "write_dossier_cell":     {"model": "opus-5.5", "effort": "low", "max_tokens": 8000}
      }
    }

A call takes, field by field, the first value set in: its purpose's route, the
`vision` route (image transcription only), `default`, then the environment
(NAPKIN_MODEL, NAPKIN_VISION_MODEL). An effort or max_tokens the calling code
passes is used only where no route sets one.

  model       an alias below (resolved for the configured wire) or a provider id,
              sent verbatim
  effort      low | medium | high | xhigh | max; unset = the model's own default.
              Dropped, with a warning, for a model known to refuse it
  schema      auto (default): enforced where the endpoint enforces it, else the
              schema goes in the system prompt; enforced: the endpoint must
              enforce it or the call fails `unsupported`; prompt: always in the
              prompt. Every answer is validated against the full schema here,
              whatever the mode (§1.4)
  max_tokens  replaces the caller's cap: thinking counts against it

EU pin (ADR-004, docs/adr/0004-client-wall.md): with NAPKIN_MODEL_PIN=eu, client
text may only go to a route that processes in the EU. On the bedrock wire an
alias resolves to its `eu.` inference profile, and any route that still
resolves to a `global.` profile (a provider id written out in full), or runs on
a wire that is not EU-pinned, is a violation: startup stops and an edit to the
routes file is refused, unless the purpose is listed with its reason in
napkin/model_route_exceptions.json. `--check` prints the violations and exits 1.

A routes file is re-read when it changes; a file that does not parse or names
an unknown purpose field is refused with a log line and the last good routes
stay in force, so an edit can never stop a running job.

    uv run python -m napkin.model_routes            the routes in force, resolved
    NAPKIN_MODEL_PIN=eu uv run python -m napkin.model_routes --check
"""

from __future__ import annotations

import json
import logging
import os
import threading
from dataclasses import dataclass, replace
from pathlib import Path

log = logging.getLogger("napkin.model")

EFFORTS = ("low", "medium", "high", "xhigh", "max")
SCHEMA_MODES = ("auto", "enforced", "prompt")
FIELDS = ("model", "effort", "schema", "max_tokens")

# alias -> the id per wire. A provider id that is not here is sent verbatim.
ALIASES = {
    "opus-5.5":   {"anthropic": "claude-opus-5-5", "bedrock": "global.anthropic.claude-opus-5-5"},
    "opus-5":     {"anthropic": "claude-opus-5", "bedrock": "global.anthropic.claude-opus-5"},
    "opus-4.6":   {"anthropic": "claude-opus-4-6", "bedrock": "eu.anthropic.claude-opus-4-6-v1"},
    "sonnet-5.5": {"anthropic": "claude-sonnet-5-5", "bedrock": "global.anthropic.claude-sonnet-5-5"},
    "haiku-4.5":  {"anthropic": "claude-haiku-4-5", "bedrock": "global.anthropic.claude-haiku-4-5-20251001-v1:0"},
}
PINS = ("eu",)
EXCEPTIONS_FILE = Path(__file__).with_name("model_route_exceptions.json")
# Wires whose endpoint the EU pin can speak for: only a Bedrock inference profile names its region.
EU_WIRES = ("bedrock",)
# Models that refuse output_config.effort (a 400 on every call if it were sent).
NO_EFFORT = ("haiku-4-5",)


@dataclass(frozen=True)
class Route:
    model: str
    effort: str | None = None
    schema: str = "auto"
    max_tokens: int | None = None
    alias: str | None = None      # the name the routes file used, for logs


class RoutesError(ValueError):
    pass


def load_exceptions(path: Path | None = None) -> dict:
    """The recorded exceptions to the EU pin: {name: {reason, decided_by, date}}, where a name is
    a purpose, `wire:<api>` or `web:nova_grounding`. An entry with no reason or no decider is not
    an exception, it is a gap: refused."""
    path = path or EXCEPTIONS_FILE
    try:
        doc = json.loads(path.read_text())
    except FileNotFoundError:
        return {}
    items = doc.get("exceptions", {}) if isinstance(doc, dict) else None
    if not isinstance(items, dict):
        raise RoutesError(f"{path.name}: expected {{\"exceptions\": {{name: {{reason, decided_by, date}}}}}}")
    for name, e in items.items():
        if not isinstance(e, dict) or not all(isinstance(e.get(k), str) and e[k].strip()
                                              for k in ("reason", "decided_by", "date")):
            raise RoutesError(f"{path.name}: exception {name!r} needs a reason, decided_by and date")
    return items


def _check(name: str, spec) -> dict:
    if not isinstance(spec, dict):
        raise RoutesError(f"{name}: a route is an object with {', '.join(FIELDS)}")
    unknown = set(spec) - set(FIELDS)
    if unknown:
        raise RoutesError(f"{name}: unknown field(s) {', '.join(sorted(unknown))} (allowed: {', '.join(FIELDS)})")
    if "model" in spec and (not isinstance(spec["model"], str) or not spec["model"].strip()):
        raise RoutesError(f"{name}: model must be a non-empty string")
    if spec.get("effort") is not None and spec["effort"] not in EFFORTS:
        raise RoutesError(f"{name}: effort must be one of {', '.join(EFFORTS)} or null")
    if "schema" in spec and spec["schema"] not in SCHEMA_MODES:
        raise RoutesError(f"{name}: schema must be one of {', '.join(SCHEMA_MODES)}")
    mt = spec.get("max_tokens")
    if mt is not None and (not isinstance(mt, int) or isinstance(mt, bool) or not 1 <= mt <= 128000):
        raise RoutesError(f"{name}: max_tokens must be an integer from 1 to 128000")
    return dict(spec)


def parse(doc) -> dict:
    """The routes document, checked: {"default": {...}, "vision": {...}, "purposes": {name: {...}}}."""
    if not isinstance(doc, dict):
        raise RoutesError("the routes file must hold a JSON object")
    unknown = set(doc) - {"default", "vision", "purposes", "comment"}
    if unknown:
        raise RoutesError(f"unknown top-level key(s) {', '.join(sorted(unknown))} (default, vision, purposes)")
    purposes = doc.get("purposes") or {}
    if not isinstance(purposes, dict):
        raise RoutesError("purposes must be an object of purpose -> route")
    return {"default": _check("default", doc.get("default") or {}),
            "vision": _check("vision", doc.get("vision") or {}),
            "purposes": {p: _check(f"purposes.{p}", s) for p, s in purposes.items()}}


class Routes:
    """The routes in force. `source` is a path to a JSON file, the JSON itself, or None."""

    def __init__(self, api: str, model: str, vision_model: str | None = None, source: str | None = None,
                 pin: str | None = None, exceptions: dict | None = None):
        if pin not in (None, *PINS):
            raise RoutesError(f"NAPKIN_MODEL_PIN must be one of {', '.join(PINS)} or unset, not {pin!r}")
        self.api, self.env_model, self.env_vision = api, model, vision_model or None
        self.pin = pin
        self.exceptions = load_exceptions() if exceptions is None else exceptions
        self._lock = threading.Lock()
        self._path, self._mtime = None, None
        self._doc = {"default": {}, "vision": {}, "purposes": {}}
        self.error = None                 # why the last edit was refused, if it was
        if source and source.strip().startswith("{"):
            self._doc = parse(json.loads(source))         # inline: refused loudly at startup
        elif source:
            self._path = Path(source)
            self._doc = parse(json.loads(self._path.read_text()))   # a bad file stops startup, not a job
            self._mtime = self._path.stat().st_mtime
        bad = self.violations()
        if bad:       # a pinned deployment does not start on a route that leaves the EU
            raise RoutesError("; ".join(bad))

    @classmethod
    def from_settings(cls, settings) -> "Routes":
        return cls(settings.model_api, settings.model, settings.vision_model, settings.model_routes,
                   pin=getattr(settings, "model_pin", None))

    # -- the EU pin ----------------------------------------------------------
    def violations(self, doc: dict | None = None) -> list[str]:
        """What breaks the pin: one line per route that resolves to a global profile or runs on a wire
        the pin cannot vouch for, and is not a recorded exception. Empty when no pin is set."""
        if self.pin != "eu":
            return []
        doc = doc if doc is not None else self._doc
        if self.api not in EU_WIRES and f"wire:{self.api}" not in self.exceptions:
            return [f"the {self.api} wire is not EU-pinned: client text would leave the EU "
                    f"(record `wire:{self.api}` in model_route_exceptions.json or use bedrock)"]
        out = []
        for name in ["default", "vision", *sorted(doc["purposes"])]:
            vision = name == "vision"
            purpose = name if name not in ("default", "vision") else "-"
            if name in self.exceptions:
                continue
            model = self._resolve(doc, purpose, vision).model
            if model.startswith("global."):
                out.append(f"{name} resolves to the global profile {model}: not EU-pinned "
                           f"(use an eu. profile, or record an exception for {name!r})")
        return out

    def _maybe_reload(self):
        if self._path is None:
            return
        try:
            mtime = self._path.stat().st_mtime
        except OSError as e:
            if self.error is None:
                log.error("model routes: %s is unreadable (%s); keeping the routes in force", self._path, e)
            self.error = str(e)
            return
        if mtime == self._mtime:
            return
        with self._lock:
            if mtime == self._mtime:
                return
            try:
                doc = parse(json.loads(self._path.read_text()))
            except (OSError, ValueError) as e:      # JSONDecodeError and RoutesError are ValueErrors
                self._mtime, self.error = mtime, str(e)
                log.error("model routes: %s refused (%s); keeping the routes in force", self._path, e)
                return
            bad = self.violations(doc)
            if bad:
                self._mtime, self.error = mtime, "; ".join(bad)
                log.error("model routes: %s refused (%s); keeping the routes in force", self._path, self.error)
                return
            self._doc, self._mtime, self.error = doc, mtime, None
            log.warning("model routes: reloaded %s", self._path)

    def model_id(self, name: str) -> str:
        a = ALIASES.get(name)
        if a is None:
            return name
        mid = a.get(self.api) or a.get("anthropic")
        if self.pin == "eu" and self.api == "bedrock" and mid.startswith("global."):
            mid = "eu." + mid[len("global."):]
        return mid

    def resolve(self, purpose: str, vision: bool = False) -> Route:
        self._maybe_reload()
        return self._resolve(self._doc, purpose, vision)

    def _resolve(self, doc: dict, purpose: str, vision: bool = False) -> Route:
        layers = [doc["purposes"].get(purpose, {})] + ([doc["vision"]] if vision else []) + [doc["default"]]

        def pick(f):
            return next((spec[f] for spec in layers if f in spec), None)

        name = pick("model") or ((self.env_vision or self.env_model) if vision else self.env_model)
        model = self.model_id(name)
        effort = pick("effort")
        if effort and any(m in model for m in NO_EFFORT):
            log.warning("model routes: %s refuses effort; %r dropped for %s", model, effort, purpose)
            effort = None
        return Route(model=model, effort=effort, schema=pick("schema") or "auto", max_tokens=pick("max_tokens"),
                     alias=name if name in ALIASES else None)

    def table(self, purposes=()) -> dict:
        """What is in force, resolved: for /healthz and the CLI."""
        self._maybe_reload()
        names = sorted(set(self._doc["purposes"]) | set(purposes))
        show = lambda r: {k: v for k, v in r.__dict__.items() if v is not None}
        return {"source": str(self._path) if self._path else ("inline" if any(self._doc.values()) else None),
                "error": self.error, "pin": self.pin, "violations": self.violations(), "default": show(self.resolve("-")),
                "vision": show(self.resolve("-", vision=True)),
                "purposes": {p: show(self.resolve(p)) for p in names}}


def with_caller(route: Route, effort: str | None, max_tokens: int | None) -> Route:
    """The caller's effort and cap, where the routes set none."""
    return replace(route, effort=route.effort or (effort if not any(m in route.model for m in NO_EFFORT) else None),
                   max_tokens=route.max_tokens or max_tokens)


def main(argv=None) -> int:  # pragma: no cover - a convenience
    import sys
    from .config import Settings
    argv = sys.argv[1:] if argv is None else argv
    s = Settings.from_env()
    try:
        r = Routes.from_settings(s)
    except RoutesError as e:
        print(f"model routes violate the EU pin: {e}", file=sys.stderr)
        return 1
    print(json.dumps(r.table(), indent=1))
    if "--check" in argv and (r.pin != "eu" or r.violations()):
        print("check: NAPKIN_MODEL_PIN=eu is required and every client route must resolve to the EU",
              file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
