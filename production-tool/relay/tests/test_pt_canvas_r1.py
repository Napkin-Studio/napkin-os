"""UAT round 1, canvas and images (features/pt-canvas-r1.clan): what Dex received kept on the job record, and a view
of a person sent as a person."""

import json

from director import PassthroughDirector
from director.base import view_subject
from director.record import LIST_MAX, STRING_MAX, TOTAL_MAX, for_record

from test_director import fixture, make, run

SHA = "sha256:" + "a" * 64
OTHER = "sha256:" + "b" * 64


# --- director.input on the record ---------------------------------------------------------------------------------

def test_the_agent_block_keeps_what_dex_received():
    d, _ = make(fixture("generate_runway")["reply"])
    res = run("generate_runway", d)
    given = res.agent_block["input"]
    assert given["refs"] and all("url" not in r.get("asset", {}) for r in given["refs"])
    assert all(r["asset"]["sha256"].startswith("sha256:") for r in given["refs"] if r.get("asset"))
    assert json.dumps(given).count("https://") == 0


def test_the_record_cuts_strings_lists_and_the_whole():
    payload = {
        "text": "x" * 5000,
        "refs": [{"id": f"r{i}", "role": "other", "asset": {"sha256": SHA, "url": "https://cdn/x", "mime": "image/png"}} for i in range(30)],
        "script": "y" * 20000,
        "shots": [{"action": "z" * 900, "n": i} for i in range(40)],
    }
    out = for_record(payload)
    assert len(out["text"]) == STRING_MAX and out["text"].endswith("…")
    assert len(out["refs"]) == LIST_MAX + 1 and out["refs"][-1] == f"… {30 - LIST_MAX} more"
    assert "url" not in out["refs"][0]["asset"] and "mime" not in out["refs"][0]["asset"]
    assert len(json.dumps(out, ensure_ascii=False).encode()) <= TOTAL_MAX
    assert payload["refs"][0]["asset"]["url"] == "https://cdn/x"  # the payload itself is untouched


def test_a_small_input_is_kept_whole_but_its_urls():
    payload = {"text": "a cafe", "ratio": "16:9", "image": {"sha256": SHA, "url": "https://cdn/x"}}
    assert for_record(payload) == {"text": "a cafe", "ratio": "16:9", "image": {"sha256": SHA}}


def test_dogfood_never_takes_the_input():
    """The dogfood job event keeps the block's model, version, latency, rationale and card count only."""
    import service
    src = open(service.__file__).read()
    start = src.index("def _dog_job")
    body = src[start:src.index("def ", start + 10)]
    assert '"input"' not in body and "block.get(\"input\")" not in body


# --- a view of a person goes as one (IMG-11) ------------------------------------------------------------------------

def view_input(**subject):
    return {"view": "side", "image": {"sha256": SHA, "url": "https://cdn/x"}, "aspect": {"w": 4, "h": 5},
            **({"subject": subject} if subject else {})}


def test_the_passthrough_sends_a_character_front_as_a_person_and_says_who():
    out = PassthroughDirector().direct({"op": "view", "input": view_input(role="character", name="ruby", label="the woman with short red hair")}, None)
    job = out["providerJob"]
    (ref,) = job["refs"]
    assert ref == {"sha256": SHA, "name": "current", "role": "character"}
    assert "@current is ruby (the woman with short red hair)" in job["prompt"]


def test_an_object_front_and_an_old_web_stay_as_they_were():
    for inp in (view_input(role="product", name="flask"), view_input()):
        job = PassthroughDirector().direct({"op": "view", "input": inp}, None)["providerJob"]
        assert job["refs"][0]["role"] == "current" and " is " not in job["prompt"]


def test_dex_job_for_a_view_is_corrected_once():
    job = {"prompt": "side view of @current, the same character, full body.",
           "refs": [{"sha256": SHA, "name": "current", "role": "current"}, {"sha256": OTHER, "name": "ruby_back", "role": "character"}]}
    inp = view_input(role="character", name="ruby")
    view_subject(job, "view", inp)
    view_subject(job, "view", inp)
    assert job["refs"][0]["role"] == "character" and job["refs"][1]["role"] == "character"
    assert job["prompt"].count("@current is ruby") == 1
    other = {"prompt": "p", "refs": [{"sha256": SHA, "name": "current", "role": "current"}]}
    view_subject(other, "generate", inp)
    assert other["refs"][0]["role"] == "current"


def test_runway_gets_subject_human_for_the_view():
    """The adapter maps role character to subject human: the same mapping every generate uses."""
    from providers import runway
    src = open(runway.__file__).read()
    assert '"subject": "human" if r.role == "character" else "object"' in src
