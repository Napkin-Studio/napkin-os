"""Clock times out of clip prompts unless a shot asks for words on screen (relay/onscreen.py; UAT 2026-11-21, F11:
Omni burned "1 a.m. 1 a.m." into a joined take)."""
import onscreen


def test_a_time_becomes_the_time_of_day():
    p = "maya front in a dark shared kitchen at 1 a.m., dim low light.\nShot 1 [0-2.5 s] A dark shared kitchen, 1 a.m. maya sock-skates in."
    out = onscreen.soften(p)
    assert "a.m" not in out and "1 " not in out.split("Shot 1")[0]
    assert out.startswith("maya front in a dark shared kitchen in the small hours, dim low light.")
    assert "A dark shared kitchen, in the small hours maya" in out
    assert onscreen.soften("At 7:30 pm the street") == "in the evening the street"


def test_a_shot_that_asks_for_words_on_screen_keeps_its_time():
    job = {"prompt": "The oven clock reads 1:04 a.m."}
    onscreen.apply(job, {"shot": {"action": "The oven clock reads 1:04 a.m."}})
    assert job["prompt"] == "The oven clock reads 1:04 a.m."
    job = {"prompt": "A kitchen at 1 a.m."}
    onscreen.apply(job, {"shots": [{"action": "A kitchen at 1 a.m."}]})
    assert job["prompt"] == "A kitchen in the small hours."
