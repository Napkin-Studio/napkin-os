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


def test_a_plans_sound_beats_stay_only_where_the_script_names_the_sound():
    """UAT 2026-11-21, F22: Dex put "night hum" and "faint hush" on most shots, each turning sound on."""
    script = "INT. KITCHEN - NIGHT\nThe dog lets out one soft snore. MAYA (whispering) Good boy."
    shots = [
        {"beats": [{"kind": "sound", "at_s": 0, "text": "night hum"}, {"kind": "moment", "at_s": 0, "text": "she enters"}]},
        {"beats": [{"kind": "sound", "at_s": 1, "text": "one soft snore"}]},
        {"beats": [{"kind": "sound", "at_s": 0, "text": "faint hush"}]},
    ]
    kept, gone = sound.keep_asked_sounds(shots, script)
    assert [[b["text"] for b in s["beats"]] for s in kept] == [["she enters"], ["one soft snore"], []]
    assert gone == ["night hum", "faint hush"]
    assert sound.keep_asked_sounds(shots, "") == (shots, [])


def test_a_silence_beat_is_not_a_sound():
    """UAT round 3, F22/R3-F6: "Silence: the kettle boils with no noise at all" turned sound on (Veo with sound)."""
    script = "The kettle glows blue and boils without a sound. Through the thin wall, the snoring carries on."
    shots = [
        {"id": "s3", "beats": [{"kind": "sound", "at_s": 0, "text": "Silence: the kettle boils with no noise at all."}]},
        {"id": "s5", "beats": [{"kind": "sound", "at_s": 0, "text": "Steady snoring through the wall."}]},
    ]
    kept, gone = sound.keep_asked_sounds(shots, script)
    assert kept[0]["beats"] == [] and kept[1]["beats"] == shots[1]["beats"]
    assert gone == ["Silence: the kettle boils with no noise at all."]
    assert not sound.wants_sound({"shot": shots[0]})
    assert sound.wants_sound({"shot": shots[1]})
    for words in ("No sound at all", "The room is silent", "a soundless boil", "without any noise"):
        assert sound.is_silence({"kind": "sound", "text": words}), words
    assert not sound.is_silence({"kind": "sound", "text": "A soft click as the switch flips"})
    nothing, dropped = sound.keep_asked_sounds(shots, "")
    assert nothing[0]["beats"] == [] and dropped == ["Silence: the kettle boils with no noise at all."]


def test_a_clip_with_sound_hears_its_sound_beats_said_as_sound():
    # UAT round 4, R4-F10: Box 1 was made with sound, and "A soft click, then quiet" never reached the prompt.
    click = {"kind": "sound", "at_s": 1.5, "text": "A soft click, then quiet."}
    job = {"prompt": "A kettle on a counter.", "audio": False}
    sound.apply(job, {"shots": [shot([MOMENT]), shot([click], 2)]}, sheet_for("wan3"), starts=[0, 3], prompt_max=1000)
    assert job["audio"] is True
    assert job["prompt"] == "A kettle on a counter.\n[4.5 s] Sound: A soft click, then quiet."
    # With a line too: the line as speech first, then the sound.
    both = {"prompt": "A kitchen.", "audio": False}
    sound.apply(both, {"shot": shot([LINE, click])}, sheet_for("veo3.1"), prompt_max=1000)
    assert both["prompt"].split("\n")[1:] == ['[1 s] HER, whispering: “Quietboil. Let them sleep.” ' + sound.NO_SUBTITLES, "[1.5 s] Sound: A soft click, then quiet."]
    # A silence beat is never said; a model with no switch hears nothing more.
    hush = {"prompt": "A kettle.", "audio": False}
    sound.apply(hush, {"shot": shot([{"kind": "sound", "at_s": 0, "text": "Silence: no roar at all."}])}, sheet_for("wan3"))
    assert hush["prompt"] == "A kettle."
    quiet = {"prompt": "A kettle."}
    sound.apply(quiet, {"shot": shot([click])}, sheet_for("gemini_omni_flash_1.1"))
    assert quiet["prompt"] == "A kettle."


# ── UAT round 5, R5-F2: a shot that speaks gets its line's spoken length ──────────────────────────────────────────

def r5_shot_list() -> list[dict]:
    """Round 5's plan (job_01M7Y84Y6B5T1VTZTV30BYZ07Z): 10 s, "Good boy." whispered in 1.0 s, the end line as a VO."""
    def s(d, beats=()):
        return {"kind": "shot", "duration_s": d, "camera": {"size": "medium"}, "action": "x", "refs": [], "beats": list(beats)}
    return [s(1.5), s(1.5, [{"kind": "sound", "at_s": 0.5, "text": "Tap gurgles"}]), s(1.5),
            s(1.5, [{"kind": "sound", "at_s": 0, "text": "Soft murmur"}, {"kind": "sound", "at_s": 1, "text": "Click"}]),
            s(1, [{"kind": "line", "at_s": 0, "text": "Good boy.", "speaker": "MAYA", "parenthetical": "whispering, to the kettle"}]),
            s(1, [{"kind": "sound", "at_s": 0, "text": "Flatmate snoring"}]),
            s(2, [{"kind": "vo", "at_s": 0.5, "text": "Quietboil. Let them sleep.", "speaker": "NARRATOR"}])]


def test_r5_spoken_length_whispered_slower_with_lead_in_and_tail():
    assert sound.spoken_need({"beats": [{"kind": "line", "at_s": 0, "text": "Good boy.", "parenthetical": "whispering"}]}) == 2.0
    assert sound.spoken_need({"beats": [{"kind": "line", "at_s": 0, "text": "Good boy."}]}) == 2.0  # 0.5 + 0.8 + 0.5 -> 2.0
    assert sound.spoken_need({"beats": [{"kind": "vo", "at_s": 0.5, "text": "Quietboil. Let them sleep."}]}) == 3.0
    assert sound.spoken_need({"beats": [{"kind": "sound", "at_s": 0, "text": "Snoring"}]}) == 0


def test_r5_the_line_shots_grow_and_the_silent_ones_give_the_time_back():
    shots, notes = sound.spoken_floor(r5_shot_list(), 10)
    lengths = [s["duration_s"] for s in shots]
    assert lengths[4] == 2.0 and lengths[6] == 3.0          # "Good boy." whispered; the end line VO
    assert lengths[3] == 1.5 and lengths[5] == 1.0          # no shot goes below its last beat (+0.5) or 1 s
    assert all(lengths[i] >= 1.0 for i in (0, 1, 2))
    # Shots 1-3 had 1.5 s of room for 2 s more: the film runs 0.5 s long rather than cut a line, and says so.
    assert sum(lengths) == 10.5
    assert any("runs 0.5 s long" in n for n in notes)
    # Every beat stays inside its shot.
    assert all(b["at_s"] <= s["duration_s"] for s in shots for b in s["beats"])


def test_r5_with_room_the_total_stays_the_target_and_a_plan_that_fits_is_unchanged():
    base = r5_shot_list()
    base[0]["duration_s"] = 3.0
    base[2]["duration_s"] = 3.0
    shots, _ = sound.spoken_floor(base, 13)
    assert sum(s["duration_s"] for s in shots) == 13
    fine = [{**s, "beats": [b for b in s["beats"] if b["kind"] == "sound"]} for s in r5_shot_list()]
    assert sound.spoken_floor(fine, 10) == (fine, [])
