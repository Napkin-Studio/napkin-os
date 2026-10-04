"""One structured call through the configured model port, to prove a wire
before real work runs on it (auth, region, model id, structured output).

    cd server && NAPKIN_MODEL_API=bedrock NAPKIN_MODEL_REGION=eu-west-1 \
        uv run python scripts/model_smoke.py [purpose]

With a purpose, the call goes the way that purpose's route sends it
(NAPKIN_MODEL_ROUTES): the model, effort and schema mode a real call would get.
Prints them, the object and the usage, or the ModelError kind. A few hundred tokens.
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from napkin.config import Settings  # noqa: E402
from napkin.model import ModelError, ModelPort, Usage, build_wire  # noqa: E402
from napkin.model_routes import Routes  # noqa: E402

SCHEMA = {"type": "object", "additionalProperties": False, "required": ["capital", "country", "note"],
          "properties": {"capital": {"type": "string"}, "country": {"type": "string", "enum": ["IE", "GB", "FR"]},
                         "note": {"anyOf": [{"type": "string"}, {"type": "null"}]}}}


def main() -> int:
    s = Settings.from_env()
    wire = build_wire(s)
    port = ModelPort(wire, s.model, s.model_timeout, max_tokens=4000,
                     routes=Routes(wire.api, s.model, s.vision_model, s.model_routes))
    purpose = sys.argv[1] if len(sys.argv) > 1 else "smoke"
    route = {k: v for k, v in port.routes.resolve(purpose).__dict__.items() if v is not None}
    u = Usage()
    try:
        out = port.call(purpose, "Answer with the requested JSON only.", {"question": "Capital of Ireland?"},
                        SCHEMA, usage=u, attribution="smoke")
    except ModelError as e:
        print(json.dumps({"wire": port.api, "route": route, "error": e.kind, "message": str(e)}))
        return 1
    print(json.dumps({"wire": port.api, "route": route, "schema_in_prompt": sorted(port._unenforced),
                      "result": out, "usage": u.by_model}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
