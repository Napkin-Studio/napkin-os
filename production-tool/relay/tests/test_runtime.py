import json

import pytest

from contracts import Contracts
from contracts_dir import contracts_dir
from director import PassthroughDirector, new_id
from providers import load_registry
from providers.base import ProviderError, asset_url, set_asset_urls
from runtime import CachedConfig, parse_event_codes
from tokens import sign, verify


def test_tokens_round_trip_and_reject_tampering():
    t = sign({"pid": "p_abcdef", "exp": 100}, "s" * 20)
    assert verify(t, "s" * 20, 50)["pid"] == "p_abcdef"
    assert verify(t, "s" * 20, 100) is None
    assert verify(t, "x" * 20, 50) is None
    assert verify(t[:-2] + "AA", "s" * 20, 50) is None
    assert verify("garbage", "s" * 20, 50) is None


def test_event_codes_parse():
    assert parse_event_codes('{"participant": ["A"], "organiser": ["B"]}') == {"participant": ["A"], "organiser": ["B"]}
    assert parse_event_codes("A, B") == {"participant": ["A", "B"], "organiser": []}


def test_config_cache_keeps_the_last_good_config():
    good = json.loads((contracts_dir() / "examples" / "config.event.json").read_text())
    now = [0.0]
    source = [good]
    cfg = CachedConfig(lambda: source[0], Contracts(), ttl=30, clock=lambda: now[0])
    assert cfg()["spend"]["capUsd"] == 1300
    source[0] = {"contractVersion": "1"}  # a broken upload
    now[0] = 31
    assert cfg()["spend"]["capUsd"] == 1300
    bad = CachedConfig(lambda: {"nope": 1}, Contracts())
    with pytest.raises(ValueError):
        bad()


def test_new_ids_match_the_contract():
    errors = Contracts().errors("common.schema.json#/$defs/id", new_id("job"))
    assert errors == []


def test_passthrough_director_matches_its_schema_for_every_op():
    sheet = json.loads((contracts_dir() / "capabilities" / "runway.json").read_text())
    c = Contracts()
    a = {"sha256": "sha256:" + "a" * 64, "url": "https://x.test/a", "mime": "image/png"}
    shot = {"id": new_id("shot"), "order": 1, "duration_s": 5, "composition": "wide", "action": "walks", "camera_move": "static"}
    inputs = {
        "generate": {"text": "hero", "sketch": a, "refs": [{"id": new_id("ref"), "tag": "eyes", "role": "shape", "asset": a}]},
        "view": {"view": "side", "character": {"front": a}},
        "frame": {"shot": shot, "character": {"front": a}},
        "region_edit": {"image": a, "region": {"x": 0, "y": 0, "w": 0.5, "h": 0.5}, "text": "red hat"},
        "clip": {"image": a, "shot": shot, "character": {"front": a}},
        "clip_edit": {"video": {**a, "mime": "video/mp4"}, "feel": {"strength": "flex"}},
        "shot_list": {"script": "One. Two. Three.", "targetS": 20},
    }
    for op, inp in inputs.items():
        out = PassthroughDirector().direct({"jobId": new_id("job"), "op": op, "input": inp}, None if op == "shot_list" else sheet)
        assert c.errors("director.schema.json", out) == [], (op, c.errors("director.schema.json", out))


def test_asset_url_resolution():
    set_asset_urls({"sha256:x": "https://cdn/in/sha256:x"})
    assert asset_url("sha256:x") == "https://cdn/in/sha256:x"
    with pytest.raises(ProviderError):
        asset_url("sha256:y")


def test_registry_loads_the_sheets_without_adapters():
    reg = load_registry()
    # adapters are the harness lane's; whatever exists must match its sheet
    for name, p in reg.providers.items():
        assert reg.sheet(name)["provider"] == name
