"""director/model.py is server/napkin/model.py, copied (plan D8): byte-identical below its header, and
its loopback guard refuses a local model URL on Lambda."""

from pathlib import Path
from types import SimpleNamespace

import pytest

from director.model import build_wire

RELAY = Path(__file__).resolve().parents[1]
SERVER = RELAY.parents[1] / "server" / "napkin" / "model.py"


@pytest.mark.skipif(not SERVER.exists(), reason="the middleware is not in this checkout")
def test_the_copy_is_the_middlewares_below_its_header():
    copy = (RELAY / "director" / "model.py").read_text()
    header, body = copy.split("\n", 1)
    assert header.startswith("# Copied from server/napkin/model.py")
    assert body == SERVER.read_text()


def settings(**kw):
    base = dict(model_api="anthropic", model_bedrock_endpoint="runtime", model_region="eu-west-1",
                model_base_url=None, model_api_key="local", model_extra_body=None)
    return SimpleNamespace(**{**base, **kw})


def test_lambda_refuses_a_loopback_model_url(monkeypatch):
    monkeypatch.setenv("AWS_LAMBDA_FUNCTION_NAME", "relay")
    with pytest.raises(ValueError, match="loopback"):
        build_wire(settings(model_base_url="http://127.0.0.1:8797"), client=object())
    monkeypatch.delenv("AWS_LAMBDA_FUNCTION_NAME")
    assert build_wire(settings(model_base_url="http://127.0.0.1:8797"), client=object()).api == "anthropic"
