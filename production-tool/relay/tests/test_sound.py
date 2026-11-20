"""Sound on a clip (relay/sound.py, features/pt-film-r1.clan; UAT 2026-11-21 B6: every clip came out silent)."""

from __future__ import annotations

from director.base import PassthroughDirector
from providers import load_sheet
from providers.types import effective_sheet
from service import Relay
import sound

RUNWAY = load_sheet("runway")


def sheet_for(model: str) -> dict:
    return effective_sheet(RUNWAY, "clip", model)


def shot(beats=(), d=3):
    return {"id": "shot_1", "kind": "shot", "duration_s": d, "camera": {"size": "medium"}, "action": "She fills his mug.",
            "refs": [], "beats": list(beats)}


LINE = {"kind": "line", "at_s": 1, "text": "Quietboil. Let them sleep.", "speaker": "HER", "parenthetical": "(whispering)"}
SNORE = {"kind": "sound", "at_s": 0, "text": "A snore from the next room."}
MOMENT = {"kind": "moment", "at_s": 0, "text": "She tiptoes in."}


def test_sound_is_on_for_a_line_a_vo_or_a_sound_on_a_model_with_the_switch():
    assert sound.audio_on({"shot": shot([LINE])}, sheet_for("veo3.1"))
    assert sound.audio_on({"shot": shot([SNORE])}, sheet_for("wan3"))
    assert not sound.audio_on({"shot": shot([MOMENT])}, sheet_for("veo3.1"))
    # No switch (Omni Flash 1.1): the model makes its own sound; the job carries no switch.
    assert not sound.audio_on({"shot": shot([LINE])}, sheet_for("gemini_omni_flash_1.1"))


def test_the_lines_are_said_as_speech_in_the_prompt_only_with_sound():
    job = {"prompt": "A kitchen at night.", "audio": False}
    sound.apply(job, {"shot": shot([LINE, MOMENT])}, sheet_for("veo3.1"), prompt_max=1000)
    assert job["audio"] is True
    assert job["prompt"].endswith('[1 s] HER, whispering: “Quietboil. Let them sleep.” ' + sound.NO_SUBTITLES)
    quiet = {"prompt": "A kitchen at night.", "audio": False}
    sound.apply(quiet, {"shot": shot([MOMENT])}, sheet_for("veo3.1"))
    assert quiet == {"prompt": "A kitchen at night.", "audio": False}
    # A take times each line in the take: shot 2 starts at 3 s.
    take = {"shots": [shot([MOMENT]), shot([LINE], 2.5)]}
    assert sound.spoken_lines(take, [0, 3]) == ['[4 s] HER, whispering: “Quietboil. Let them sleep.”']


def test_the_lines_never_push_the_prompt_past_the_models_limit():
    job = {"prompt": "x" * 990, "audio": False}
    sound.apply(job, {"shot": shot([LINE])}, sheet_for("veo3.1"), prompt_max=1000)
    assert job["audio"] is True and job["prompt"] == "x" * 990


def test_the_passthrough_turns_sound_on_for_a_shot_with_a_line():
    sheet = sheet_for("veo3.1")
    out = PassthroughDirector().direct({"op": "clip", "input": {"shot": shot([LINE]), "image": {"sha256": "sha256:" + "a" * 64, "url": "https://x/a.png", "mime": "image/png"}}}, sheet)
    assert out["providerJob"]["audio"] is True and "Quietboil" in out["providerJob"]["prompt"]
    out = PassthroughDirector().direct({"op": "clip", "input": {"shot": shot([MOMENT]), "image": {"sha256": "sha256:" + "a" * 64, "url": "https://x/a.png", "mime": "image/png"}}}, sheet)
    assert out["providerJob"]["audio"] is False


def test_a_clip_with_sound_is_reserved_at_the_sound_price():
    sheet = sheet_for("veo3.1")
    spec = sheet["ops"]["clip"]
    assert Relay._settings("clip", spec, sheet, {"shot": shot([LINE], 4)}).get("audio") is True
    assert "audio" not in Relay._settings("clip", spec, sheet, {"shot": shot([MOMENT], 4)})


def test_dex_never_reads_the_lines_of_a_clip_or_a_takes_shots():
    from director.director import _without_dialogue
    out = _without_dialogue("clip", {"shot": shot([LINE, MOMENT]), "shots": [shot([LINE]), shot([SNORE])]})
    assert [b["kind"] for b in out["shot"]["beats"]] == ["moment"]
    assert [[b["kind"] for b in s["beats"]] for s in out["shots"]] == [[], ["sound"]]


def test_a_tagless_model_reads_follows_image_n_without_the_tag_said_as_words():
    """UAT 2026-11-21: Omni's take prompt read "follows image 1 (in 1)"."""
    from providers.tags import rewrite_tags
    p = "Shot 1 [0-3 s] She tiptoes in, follows image 1 (@in_1)\\nShot 2 [3-6 s] She presses it, follows image 2 (@in_2)"
    assert rewrite_tags(p, ["in_1", "in_2"], "none") == p.replace(" (@in_1)", "").replace(" (@in_2)", "")
    assert "(@in_1)" in rewrite_tags(p, ["in_1", "in_2"], "at_tag")
