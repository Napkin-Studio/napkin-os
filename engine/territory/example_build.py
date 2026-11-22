"""Builds the Territories fixtures in app/templates/territories/example/ from one fictional run (Linea, a weekend return by rail in
Ireland: the owner's demo), following the demo's flow: Pick -> the crew explores -> greenlight -> world.

    cd engine && PYTHONPATH=. python -m territory.example_build          # rewrite the files
    cd engine && PYTHONPATH=. python -m territory.example_build --check  # fail if they are stale (the contract test does this)

Files (all JSON, all fictional; no real brand, person or figure):
    data.json       the finished run: everything greenlit and sent
    facts.json      the carried research pins   (valid against app/templates/campaign-research/facts.schema.json)
    findings.json   the carried findings        (valid against findings.schema.json); three are derived (status proposed)
    states/*.json   the run at each gate, including every blocked state the gate logic must hold:
        pick                          step 1 open: insights ticked, nothing explored
        explore_running               crew out, routes landing
        greenlight_open               every route developed, nothing greenlit yet
        greenlight_derived_pending    a greenlit route rests on a derived finding nobody has settled
        greenlight_sensitive_missing  a sensitive-topic review is required and missing
        failed_refused                the host refused an engine reply; run.error in words
"""
from __future__ import annotations

import copy
import json
import sys
from pathlib import Path

from territory import contract

BRIEF_ID = "5b0d3a7e-4c1f-4e2a-9a55-1d6c0f2b7e11"
RESEARCH_ID = "a91c64f2-7d3b-4b8e-8f10-3e5d2c9a6b47"
T0 = "2026-11-18T09:00:00Z"
PICK_AT, GREEN_AT, SEND_AT = "2026-11-18T09:12:00Z", "2026-11-18T10:05:00Z", "2026-11-18T10:20:00Z"

BRIEF = {
    "background": "Linea runs weekend trains from Dublin to Galway and wants more couples and families to take them.",
    "objectives": "Lift weekend return bookings by 12% over the summer.",
    "audience": "Couples and young families in Dublin who drive west two or three weekends a year and arrive tired.",
    "insight": "A drive is a job somebody has to do. A train journey is time somebody gives back to you.",
    "smp": "The weekend starts when you sit down.",
    "desired_response": "Think the train is quicker than I assumed. Feel the trip is part of the break. Book a weekend return.",
    "tone_world_assets": "Warm, wry, never preachy.",
    "mandatories": "Weekend return fare. No anti-car tone (shared regional partners).",
}

FACTS = [  # key, id, text value, unit, source
    ("f_ROUTE0412", "route.time_gap", "By car 2h 35m on a Saturday morning; by train 2h 20m.", "text"),
    ("f_TIRED0418", "weekend.arriving_tired", "61% of weekend travellers name arriving tired as the worst part of the trip.", "text"),
    ("f_DRIVER0431", "household.one_driver", "In 4 of 5 households one person does every weekend drive.", "text"),
    ("f_FARE00440", "fare.two_or_more", "For two or more people a weekend return costs less than fuel and parking for the same trip.", "text"),
    ("f_BOOK00447", "booking.late", "38% of weekend trips are booked fewer than 48 hours ahead.", "text"),
    ("f_CLIMATE450", "climate.deciding", "Climate is a deciding factor for 11% of weekend travellers.", "text"),
]
FINDINGS = [  # id, statement, cites, status
    ("fi_NOTALK003", "Families describe the drive as the part where nobody talks. The default driver quietly resents the role.", ["f_DRIVER0431", "f_TIRED0418"], "proposed"),
    ("fi_RIVALS005", "Rivals' ads show the destination, never the journey.", ["f_ROUTE0412"], "verified"),
    ("fi_FARE00007", "People overestimate the rail fare by about 40%.", ["f_FARE00440"], "proposed"),
    ("fi_SPONT0009", "Spontaneous trips are the ones people remember best.", ["f_BOOK00447"], "proposed"),
]
FINDS = [  # id, kind, text, source, date, lookup
    ("x_FORUM0001", "found", "In travel forum threads about weekends west, the train ride itself is named as a highlight.", "Public travel forums, 120 posts read", "2025-2026", "lq_forum"),
    ("x_COMPAR0002", "found", "54% of rail passengers in a comparator market count the journey as part of the trip.", "Passenger survey, comparator market", "2025", "lq_forum"),
    ("x_LOUNGE0003", "case", "Your holiday starts here, not at the gate.", "Case library (example), airport lounges", "2023", "lq_cases"),
    ("x_MEALKIT004", "case", "Dinner in 20 minutes. The rest of the evening is yours.", "Case library (example), meal kits", "2024", "lq_cases"),
    ("x_AUDIOB0005", "case", "Your commute is now your favourite part of the day.", "Case library (example), audiobooks", "2022", "lq_cases"),
    ("x_THEMEPK009", "case", "The story starts in the queue.", "Case library (example), theme parks", "2024", "lq_cases"),
]

JOURNEY = [("tv", "Thursday 21:00", "TV, after the news"), ("story", "Thursday 22:40", "Instagram, scrolling in bed"),
           ("poster", "Friday 08:15", "48-sheet outside Heuston"), ("radio", "Friday 17:30", "Drive-time radio, stuck in traffic"),
           ("seat", "Saturday 09:20", "On board, the table seat"), ("email", "Sunday 16:00", "Inbox, before the trip home")]

CREW = [  # id, direction, role, name, short, heading, angle, colour
    ("cr_core", "core", "strategy", "Close to the core", "Core", "Stay on the proposition. Say it as plainly and truly as possible.", 250, "#8C8577"),
    ("cr_feel", "feel", "idea", "Towards warmth", "Warmth", "Go towards the feeling the brief points at: warm, sincere, family.", 185, "#E07A5F"),
    ("cr_opposite", "opposite", "copy", "The opposite pole", "Opposite", "Go the other way from warmth: wry, loud, comic. Never mock drivers.", 5, "#3D5AFE"),
    ("cr_adjacent", "adjacent", "research", "Next door", "Next door", "Look at neighbouring categories and bring back a device.", 105, "#E3A21A"),
    ("cr_outside", "outside", "synthesis", "Far outside", "Outside", "Leap out of travel entirely: lounges, theme parks, cruises. Then come back.", 318, "#8E5CF0"),
]

INSIGHTS = [  # id, kind, text, evidence, strength, ticked, by
    ("in_arrive", "truth", "Arriving tired is the worst part of the weekend.", ["f_TIRED0418"], "strong", True, "engine"),
    ("in_timeback", "truth", "A drive is a job somebody has to do; a train journey is time somebody gives back.", ["brief:insight", "f_ROUTE0412"], "strong", True, "engine"),
    ("in_journey", "tension", "Rivals sell the destination; nobody sells the journey.", ["fi_RIVALS005"], "strong", True, "engine"),
    ("in_driver", "tension", "One person does every drive, and quietly resents it.", ["f_DRIVER0431", "fi_NOTALK003"], "moderate", True, "engine"),
    ("in_friday", "truth", "Most weekends are decided on a Friday.", ["f_BOOK00447"], "moderate", True, "engine"),
    ("in_forum", "truth", "People already call the train ride a highlight.", ["x_FORUM0001", "x_COMPAR0002"], "moderate", True, "engine"),
    ("in_lounge", "borrowed", "The holiday starts before you leave: lounges and queues sell the build-up.", ["x_LOUNGE0003", "x_THEMEPK009"], "moderate", False, "engine"),
    ("in_fare", "provocation", "What if the fare were the surprise, not the catch?", ["f_FARE00440", "fi_FARE00007"], "thin", False, "engine"),
    ("in_mealkit", "borrowed", "Meal kits sell the hour back.", ["x_MEALKIT004"], "thin", False, "engine"),
    ("in_nofight", "yours", "Nobody wants to argue about the motorway.", [], "thin", True, "Shrey"),
]


def pal(bg, ink, acc, soft):
    return {"bg": bg, "ink": ink, "acc": acc, "soft": soft}


def tf(font, weight, italic):
    return {"font": font, "weight": weight, "italic": italic}


# key, name, thought, why, crew, distance, evidence, tier, rank, marks, status, state, risks, + world args
ROUTES = [
    dict(key="started", id="t_started", name="Already Started", thought="The weekend doesn't start at the hotel. It starts at Platform 4.",
         why="The brief says the weekend starts when you sit down; this route makes that the whole story.", crew="cr_core", d=.22, ev=["f_TIRED0418"],
         tier="safe", rank=1, marks=(5, 4, 1), blind=(5, 4, 4, 4, 5, 4, 5), state="developed", status="live",
         risks=["SkyHop's 'The holiday starts at the gate' is close. Rail has to own the stronger version: two hours, not fifty minutes."],
         pal=pal("#F4B942", "#1D1B4C", "#FFF6E0", "#E3962B"), type=tf("newsreader", 600, True),
         H=("Platform 4. Weekend already in progress.", "THE WEEKEND LEFT AT 9:05.", "Somewhere past Kildare, the week lets go of you.", "YOUR WEEKEND STARTS NOW. NOT IN GALWAY. NOW."),
         lines=["Out-of-office: on.", "Seat 14B. Day one of two.", "Kettle on at Portarlington.", "Weekend status: underway."],
         sc4=["platform", "window", "table", "arrival"], scenes=dict(story="window", poster="platform", seat="table", email="arrival"),
         tv=["Platform 4, 9:04. A woman checks the board and smiles.", "She sits. The out-of-office pings on. SFX: a long exhale.",
             "Tea, crisps, a paperback opened for the first time since March.", "Super: The weekend starts when you sit down."],
         radio=[("SFX", "Station ambience. A departure chime."), ("VO", "At 9:05 this morning, Aoife's weekend started."), ("SFX", "Doors close. A long, happy exhale."),
                ("VO", "Not in Galway. Not at the hotel. Right here, in seat 14B."), ("VO", "Linea. The weekend starts when you sit down. Weekend returns from 29 euro.")],
         social="POV: you're twenty minutes into the weekend and you haven't left Dublin yet.", seat="Congratulations. You are now on your weekend.",
         crm=["Your weekend leaves at 9:05", "Seat 14B is free. Bring the book you keep meaning to start."],
         music="Warm acoustic guitar, unhurried, like a Saturday-morning radio show.", sonic="The doors' two-note chime, slowed down into a sigh.",
         refs=["Golden-hour documentary photography", "Station-takeover typography"], no=["Sunsets-and-strings tourism films", "Models pointing out of windows"],
         dial=(65, 35, 55, 40)),
    dict(key="sitdown", id="t_sitdown", name="Sit Down, It's Saturday", thought="The proposition, said as plainly as it can be said.",
         why="The safest reading of the brief. It may feel expected.", crew="cr_core", d=.30, ev=["brief:smp"], tier="safe", rank=5, marks=(4, 2, 1),
         blind=(4, 4, 3, 2, 4, 3, 4), state="developed", status="live", risks=["Close to the brief, so it may feel expected."],
         pal=pal("#EFE6D2", "#2A2A2A", "#C9462A", "#D9CCAE"), type=tf("newsreader", 400, False),
         H=("Sit down. It's Saturday.", "SIT DOWN. IT'S SATURDAY.", "Sit down. The weekend can start now.", "SIT DOWN. START THE WEEKEND."),
         sc4=["platform", "window", "table", "arrival"], dial=(55, 30, 40, 45)),
    dict(key="sunday", id="t_sunday", name="Sunday Night, Sorted", thought="The best part of the train is the trip home. Sunday evening, no traffic, no dread.",
         why="Most campaigns sell the way out. Nobody sells the way home.", crew="cr_feel", d=.42, ev=["f_TIRED0418"], tier="stretch", rank=3, marks=(4, 5, 1),
         blind=(4, 5, 4, 4, 4, 3, 4), state="developed", status="live", risks=["The weekend-return fare has to be clear or it reads as a one-way message."],
         pal=pal("#1E2140", "#F1ECFF", "#F7C873", "#3A3F75"), type=tf("newsreader", 400, False),
         H=("Sunday, 7pm. Nobody is merging.", "NO SUNDAY TRAFFIC. NONE.", "Come home rested. It turns out that's allowed.", "THE BEST PART OF THE WEEKEND IS THE WAY HOME."),
         lines=["Home by 9:40. Somehow rested.", "The Sunday dread, cancelled.", "Monday can wait in Mullingar."],
         sc4=["road", "night", "window", "home"], scenes=dict(story="road", poster="night", seat="window", email="home"),
         tv=["A motorway at dusk: a river of red brake lights.", "Pull back. We're watching it from a lit train window.",
             "A couple share headphones. Nobody checks the time.", "Super: Sunday, sorted."],
         radio=[("SFX", "A car radio traffic report, fading."), ("RADIO", "Tailbacks of eight kilometres on the M6."), ("SFX", "It fades to quiet. A page turns."),
                ("VO", "Sunday, 7pm. You're on the train. None of that is your problem."), ("VO", "Linea. Sunday, sorted. Weekend returns from 29 euro.")],
         social="The M6 at 7pm vs carriage C at 7pm. Swipe.", seat="You'll be home by 9:40. Rested, apparently.",
         crm=["Sunday 7pm: the motorway is bad. You won't care.", "Your return leaves Galway at 17:25. Window seats left."],
         music="Slow piano, late-night radio, a little hush.", sonic="A soft rail click that settles like a heartbeat.",
         refs=["Night photography of lit windows", "Late-night radio idents"], no=["Melancholy for its own sake", "Showing delays or crashes"], dial=(72, 20, 80, 30)),
    dict(key="small", id="t_small", name="Small Weekends", thought="Not a holiday. Just a Saturday somewhere else, together.",
         why="Families do not need a big trip; they need a reason to leave the house together.", crew="cr_feel", d=.56, ev=["fi_NOTALK003", "f_DRIVER0431"], tier="stretch",
         rank=4, marks=(4, 4, 2), blind=(4, 4, 4, 3, 4, 3, 4), state="developed", status="live", risks=["Small can read as unambitious. It needs one bold device."],
         pal=pal("#E4ECEE", "#22313A", "#D9472B", "#B9CCD2"), type=tf("newsreader", 400, False),
         H=("Nowhere special. Everyone you love.", "A SATURDAY. SOMEWHERE ELSE.", "Not a holiday. Just a Saturday somewhere else, together.", "SMALL WEEKENDS. BIG DEAL."),
         lines=["Ennis, 11:40. Ice cream nobody needed.", "We didn't do much. It was great.", "Population: us."],
         sc4=["table", "window", "town", "home"], scenes=dict(story="town", poster="table", seat="window", email="town"),
         tv=["Handheld. A family at a table seat, sharing an orange.", "A kid draws the fields in the fog on the window.", "Ennis, 11:40. Ice cream nobody needed.",
             "Super: Small weekends."],
         radio=[("SFX", "A kid humming. Cutlery on a table seat."), ("MUM", "What will we do in Ennis?"), ("KID", "Nothing!"),
                ("VO", "Not a holiday. Just a Saturday somewhere else, together."), ("VO", "Linea. Small weekends. Weekend returns from 29 euro.")],
         social="Things we did on Saturday: 1. got the train. 2. that was the good bit.", seat="Write down what you did today. It counts.",
         crm=["Nothing planned this Saturday? Perfect.", "Ennis, Athlone, Westport. Small places, two hours away."],
         music="Field recordings, a kid humming, one ukulele.", sonic="A pencil scribble, then the departure chime.",
         refs=["Family documentary photography", "Handwritten captions"], no=["Big-holiday clichés", "Perfect-family casting"], dial=(40, 28, 18, 25)),
    dict(key="passenger", id="t_passenger", name="Passenger Seat", thought="For once, the person who always drives gets to be a passenger.",
         why="One person does every drive; this gives them the weekend off.", crew="cr_opposite", d=.46, ev=["f_DRIVER0431", "fi_NOTALK003"], tier="stretch", rank=2,
         marks=(4, 5, 2), blind=(5, 4, 4, 5, 4, 4, 4), state="developed", status="live",
         risks=["Rests partly on a finding the agent derived and nobody has verified yet.", "Must not mock drivers (partners' no-anti-car rule)."],
         pal=pal("#D7F25A", "#10291C", "#FF5B35", "#A9CC2E"), type=tf("geist_extra_bold", 800, False),
         H=("For once, Dad gets the window.", "DESIGNATED DRIVER: NOBODY.", "This weekend, the one who always drives gets to look out the window.", "EVERYBODY'S A PASSENGER."),
         lines=["Hands off the wheel. Hands on the crisps.", "Sat nav: retired.", "Nobody has to find parking.", "Mam's turn to nap."],
         sc4=["car", "window", "sleep", "arrival"], scenes=dict(story="sleep", poster="window", seat="sleep", email="car"),
         tv=["Last year. Dad at the wheel. Four hours, one wrong turn, total silence.", "This year. Dad at the window, eyes wide like a kid.",
             "Twenty minutes later he's asleep, mouth open. The family takes a photo.", "Super: Everybody's a passenger."],
         radio=[("SFX", "An indicator ticking. A sigh from the driver's seat."), ("KID", "Are we nearly there?"), ("DAD", "Silence."),
                ("VO", "This weekend, give the driver the weekend off."), ("SFX", "Train chime. Dad laughing at something out the window."),
                ("VO", "Linea. Everybody's a passenger. Weekend returns from 29 euro.")],
         social="Tag the person who always drives. They've earned this one.", seat="Driver's seat: unavailable. Enjoy the view.",
         crm=["Give the driver the weekend off", "Four tickets, one table, zero arguments about the motorway."],
         music="Bouncy brass and a snare drum, sitcom energy.", sonic="A car horn that bends into the train chime.",
         refs=["Observational sitcom", "Phone-shot family videos"], no=["Mocking drivers", "Any crash or danger imagery"], dial=(20, 78, 25, 60)),
    dict(key="lonely", id="t_lonely", name="The Lonely Motorway", thought="The motorway, played as a character, misses the families who left it for the train.",
         why="Turns the one driver's job into comedy without blaming the car.", crew="cr_opposite", d=.80, ev=["f_DRIVER0431", "fi_RIVALS005"], tier="brave", rank=7,
         marks=(3, 5, 3), blind=(3, 4, 4, 5, 3, 4, 3), state="developed", status="live",
         risks=["Close to the no-anti-car line: the motorway is sad, never the car blamed. Review flags it."],
         pal=pal("#2B2B2B", "#F5F1E6", "#FFD23F", "#4A4A4A"), type=tf("geist_extra_bold", 800, False),
         H=("The M6 misses you.", "THE M6 MISSES YOU. IT'LL GET OVER IT.", "The motorway noticed you left.", "THE M6 MISSES YOU. IT'LL GET OVER IT."),
         sc4=["road", "night", "window", "home"], dial=(15, 70, 30, 60), mandatory_warn=True),
    dict(key="mixtape", id="t_mixtape", name="Weekend Mixtape", thought="Every route west gets its own playlist. The train is the opening track of the weekend.",
         why="Borrows the mixtape's ritual: the journey is the first song.", crew="cr_adjacent", d=.74, ev=["x_AUDIOB0005", "f_BOOK00447"], tier="stretch", rank=6,
         marks=(4, 4, 2), blind=(4, 4, 4, 4, 4, 3, 3), state="developed", status="live", risks=["Music licensing for the playlists is an open question for the client."],
         pal=pal("#141414", "#FBE3F2", "#FF4FA3", "#3A2A35"), type=tf("newsreader", 600, True),
         H=("Side A: Dublin to Galway. 2h 20m.", "SIDE A. NO SKIPPING.", "The first track of the weekend is the 9:05.", "PRESS PLAY ON PLATFORM 4."),
         sc4=["platform", "window", "table", "home"], dial=(45, 60, 60, 55)),
    dict(key="lounge", id="t_lounge", name="Departure Lounge", thought="Platform 4 is the weekend's departure lounge: the holiday starts before the train moves.",
         why="Airport lounges sell the build-up; the train can do it without the wait.", crew="cr_outside", d=.68, ev=["x_LOUNGE0003", "fi_RIVALS005"], tier="brave", rank=8,
         marks=(4, 2, 2), blind=(4, 3, 3, 3, 4, 3, 4), state="developed", status="live",
         risks=["SkyHop's 'The holiday starts at the gate' is the same thought. Rail must own it with the two-hour journey, not the wait."],
         pal=pal("#16213E", "#F4EBD0", "#C9A227", "#2C3E66"), type=tf("newsreader", 400, False), rival_warn=True,
         H=("Your lounge for the weekend: Platform 4.", "THE LOUNGE HAS A TIMETABLE.", "The holiday starts before the train moves.", "WELCOME TO THE LOUNGE. IT MOVES."),
         sc4=["platform", "table", "window", "arrival"], dial=(60, 35, 70, 55)),
    dict(key="breakfast", id="t_breakfast", name="Breakfast From Platform 4", thought="Borrow the hotel ritual: the weekend begins with breakfast on board.",
         why="Meal kits sell the hour back; breakfast sells the first hour of the weekend.", crew="cr_adjacent", d=.52, ev=["x_MEALKIT004"], tier="stretch",
         state="found", status="live", risks=["Needs on-board catering at weekends. Ask the client."]),
    dict(key="ride", id="t_ride", name="The Ride Before the Ride", thought="Like a theme-park queue, the build-up is half the fun.",
         why="Far from rail; the theme-park device must stay a metaphor.", crew="cr_outside", d=.95, ev=[], tier="brave", state="found", status="live",
         risks=["Rests on no evidence yet. This direction is unproven."]),
    dict(key="anon", id="t_anon", name="Motorway Anonymous", thought="A support group for people recovering from years of Friday traffic.",
         why="Comedy in the driver's job.", crew="cr_opposite", d=.88, ev=["f_DRIVER0431"], tier="brave", state="found", status="killed",
         kill_reason="Funny, but it leaves the proposition behind: it no longer says the weekend starts when you sit down.",
         risks=["Very far from the brief."]),
]


def _world(r: dict) -> dict:
    H = r["H"]
    sc4 = r["sc4"]
    lines = r.get("lines") or [H[0], H[2]]
    tv = r.get("tv") or ["Open on the journey, not the destination.", "A small moment on board.", "The weekend arrives early.", f"Super: {H[0]}"]
    scenes = r.get("scenes") or dict(story=sc4[1], poster=sc4[0], seat=sc4[2], email=sc4[3])
    return {
        "palette": r["pal"], "type": r["type"], "headlines": dict(zip(("wq", "wl", "sq", "sl"), H)), "lines": lines,
        "tv": [{"scene": s, "text": t} for s, t in zip(sc4, tv)],
        "radio": [{"voice": v, "text": t} for v, t in (r.get("radio") or [("SFX", "A departure chime."), ("VO", H[2]), ("VO", f"Linea. {H[0]} Weekend returns from 29 euro.")])],
        "social": r.get("social") or H[2], "seat": r.get("seat") or H[0], "crm": r.get("crm") or [H[0], "Weekend returns from 29 euro."],
        "music": r.get("music") or "A sound brief is still to be written.", "sonic": r.get("sonic") or "A sound brief is still to be written.",
        "refs": r.get("refs") or ["A reference is still to be chosen."], "not": r.get("no") or ["A 'not this' note is still to be written."],
        "scenes": scenes, "dial": dict(zip(("tone", "energy", "register", "brand"), r["dial"]))}


def _pictures(r: dict, w: dict) -> list[dict]:
    out = []
    for i, f in enumerate(w["tv"]):
        out.append({"id": f"pic_{r['key']}_tv{i + 1}", "touchpoint": "tv", "scene": f["scene"], "kind": "sketch"})
    for tp in ("story", "poster", "seat", "email"):
        out.append({"id": f"pic_{r['key']}_{tp}", "touchpoint": tp, "scene": w["scenes"][tp], "kind": "sketch"})
    return out


def _checks(r: dict) -> list[dict]:
    k = r["key"][:6]
    derived = [c for c in r["ev"] if c.startswith("fi_") and c in ("fi_NOTALK003", "fi_FARE00007", "fi_SPONT0009")]
    cks = [{"id": f"ck_{k}1", "kind": "proposition", "status": "ok", "text": "One thought, and it says the weekend starts when you sit down.", "cite": ["brief:smp"]},
           {"id": f"ck_{k}2", "kind": "mandatory", "status": "warn" if r.get("mandatory_warn") else "ok",
            "text": "Close to the no-anti-car mandate: the motorway is the character, never the car." if r.get("mandatory_warn") else "Keeps the weekend return fare and never turns on the car.",
            "cite": ["brief:mandatories"]},
           {"id": f"ck_{k}3", "kind": "evidence", "status": "warn" if derived else ("ok" if r["ev"] else "fail"),
            "text": "Rests on a finding the agent derived; nobody has verified it." if derived else ("Rests on checked evidence." if r["ev"] else "Rests on no evidence."),
            "cite": r["ev"][:3]},
           {"id": f"ck_{k}4", "kind": "judge", "status": "ok", "text": f"The blind judge ranked it number {r['rank']}."}]
    if r.get("rival_warn"):
        cks.append({"id": f"ck_{k}5", "kind": "rival", "status": "warn", "text": "A rival line is near this thought; own it with the two-hour journey."})
    return cks


def _territory(r: dict) -> dict:
    t = {"id": r["id"], "name": r["name"], "thought": r["thought"], "why": r["why"], "mood": "", "references": [], "risks": r["risks"],
         "sketch": r["thought"], "tension": r["why"], "tier": r["tier"], "band": contract.band_of(r["d"]), "distance": r["d"], "crew": r["crew"],
         "origin": {"kind": "crew", "from": [r["crew"]]}, "state": r["state"], "status": r["status"], "evidence": r["ev"], "ready": r["state"] == "developed"}
    if r.get("kill_reason"):
        t["kill_reason"] = r["kill_reason"]
    if r["state"] == "developed":
        w = _world(r)
        t["world"] = w
        t["marks"] = dict(zip(("fit", "ownable", "risk"), r["marks"]))
        dims = dict(zip(("fit", "truth", "ownability", "distinct", "travel", "fame", "assets"), r["blind"]))
        t["blind"] = {"total": sum(r["blind"]), "of": 35, "by_dimension": dims, "advisory": True}
        t["rank"] = r["rank"]
        t["checks"] = _checks(r)
        t["pictures"] = _pictures(r, w)
    return t


def _found_only(t: dict) -> dict:
    t = copy.deepcopy(t)
    t["state"] = "found"
    t["ready"] = False
    for k in ("world", "marks", "blind", "rank", "checks", "pictures"):
        t.pop(k, None)
    return t


def facts() -> dict:
    rows = []
    for i, (fid, key, text, unit) in enumerate(FACTS):
        rows.append({"id": fid, "entity": "brand/linea", "key": key, "value": text, "unit": unit, "as_of": "2026-10-01", "retrieved_at": "2026-11-10",
                     "sources": [f"src_linea{i + 1:02d}"], "confidence": "high", "licence": "open", "status": "active", "decision": f"d_PIN{i + 1:05d}",
                     "pinned_at": "2026-11-10T12:00:00Z", "pin_reason": "Evidence for the weekend brief.", "version": 1,
                     "origin": f"fact://brand/linea/{key}@1"})
    return {"facts": rows}


def findings() -> dict:
    rows = []
    for i, (fid, text, cites, status) in enumerate(FINDINGS):
        r = {"id": fid, "statement": text, "cites": cites, "method": "synthesis", "status": status, "derived_by": "synthesis@1", "confidence": "medium",
             "derived_at": "2026-11-12T12:00:00Z", "decision": f"d_FIND{i + 1:04d}"}
        if status == "verified":
            r["verification"] = {"decision": "d_VERIFY001", "by": "human:Shrey", "at": "2026-11-12T15:00:00Z"}
        rows.append(r)
    return {"findings": rows}


def final() -> dict:
    terr = [_territory(r) for r in ROUTES]
    by_crew: dict[str, list] = {}
    for t in terr:
        by_crew.setdefault(t["crew"], []).append(t)
    way = {
        "cr_core": [(.1, "Read the proposition", "brief:smp"), (.2, "Kept: arriving tired is the worst part", "f_TIRED0418"), (.34, "Checked the fare and the times", "f_ROUTE0412")],
        "cr_feel": [(.14, "Nobody talks in the car", "fi_NOTALK003"), (.3, "Tone: warm, never preachy", "brief:tone_world_assets"), (.5, "The trip itself is a highlight", "x_FORUM0001")],
        "cr_opposite": [(.12, "Mandatory: no anti-car tone", "brief:mandatories"), (.3, "One person does every drive", "f_DRIVER0431"), (.55, "Rivals all show the destination", "fi_RIVALS005")],
        "cr_adjacent": [(.2, "Meal kits sell the hour back", "x_MEALKIT004"), (.4, "Audiobooks make dead time the best", "x_AUDIOB0005"), (.58, "Most trips are decided on a Friday", "f_BOOK00447")],
        "cr_outside": [(.26, "Lounges: the holiday starts here", "x_LOUNGE0003"), (.5, "Theme parks: the queue is the ride", "x_THEMEPK009"), (.66, "Cruise: you're there when you board", None)]}
    turn = {"cr_core": "Stayed on the proposition. Every turn away from it was a job for another agent.",
            "cr_feel": "Followed the finding about family time, then kept going until the sentiment risked getting sweet.",
            "cr_opposite": "Turned hard away from warmth, and away from mocking drivers. It found the comedy in the driver's job, not the car.",
            "cr_adjacent": "Borrowed devices from categories that sell time and moments, then brought each one back to the train.",
            "cr_outside": "Went furthest from the brief on purpose. One route came back usable; one is out in an unproven gap."}
    exps = []
    for cid, *_ in CREW:
        exps.append({"id": "ex_" + cid[3:], "crew": cid, "state": "back", "insights": [i[0] for i in INSIGHTS if i[5]],
                     "way": [dict(at=a, text=t, **({"cite": c} if c else {})) for a, t, c in way[cid]], "turn": turn[cid],
                     "routes": [{"territory_id": t["id"], "distance": t["distance"]} for t in by_crew.get(cid, [])]})
    live_dev = [t["id"] for t in terr if t["state"] == "developed"]
    green = [("t_started", [], "verified"), ("t_sunday", [], "verified"), ("t_passenger", ["fi_NOTALK003"], "sent_flagged")]
    greenlit = [{"territory_id": i, "by": "Shrey", "at": GREEN_AT, "rests_on_derived": d, "derived_resolution": r} for i, d, r in green]
    chosen = [g[0] for g in green]
    return {
        "schema_version": 1, "title": "Linea: Weekend by Rail",
        "upstream": {BRIEF_ID: BRIEF, RESEARCH_ID: {"campaign": {"name": "Linea: Weekend by Rail"}}},
        "finds": [{"id": i, "kind": k, "text": t, "source": s, "date": d, "quote_checked": True, "lookup": lq, "in_play": True} for i, k, t, s, d, lq in FINDS],
        "focus": {"sources": [{"id": f"brief:{k}", "in_play": True} for k in ("smp", "insight", "audience", "desired_response", "mandatories", "tone_world_assets")]
                  + [{"id": f[0], "in_play": True} for f in FACTS]
                  + [{"id": f[0], "in_play": f[0] != "fi_FARE00007"} for f in FINDINGS] + [{"id": f[0], "in_play": True} for f in FINDS],
                  "insights": [dict(id=i, kind=k, text=t, evidence=e, strength=s, ticked=tk, by=by, rank=n + 1,
                                    **({"derived": True} if any(c in ("fi_NOTALK003", "fi_FARE00007", "fi_SPONT0009") for c in e) else {}))
                               for n, (i, k, t, e, s, tk, by) in enumerate(INSIGHTS)]},
        "journey": [{"key": k, "day": d, "where": w} for k, d, w in JOURNEY],
        "crew": [{"id": i, "direction": d, "role": r, "name": n, "short": s, "heading": h, "angle": a, "colour": c} for i, d, r, n, s, h, a, c in CREW],
        "expeditions": exps, "territories": terr,
        "spread": {"threshold": 0.12, "close": [], "gaps": []},
        "greenlit": greenlit,
        "asks": [{"id": "ask_passenger", "kind": "derived_evidence", "territory_id": "t_passenger", "ids": ["fi_NOTALK003"], "status": "answered", "answer": "send_flagged",
                  "by": "Shrey", "at": GREEN_AT, "text": "Passenger Seat rests on a finding the agent derived and nobody has verified. Verify it, or send it flagged?"}],
        "actions": [{"id": "act_spread1", "agent": "review", "kind": "spread_fix", "at": "2026-11-18T09:40:00Z", "territory_ids": ["t_sunday", "t_small"], "undone": False,
                     "text": "Two routes sat close together; Sunday Night, Sorted was moved outward."},
                    {"id": "act_gap1", "agent": "review", "kind": "sent_agent", "at": "2026-11-18T09:41:00Z", "undone": False,
                     "text": "Nobody had explored far outside the brief, so an agent was sent there."}],
        "lookups": [{"id": "lq_forum", "q": "Do people describe the train journey itself as part of the holiday?", "status": "done", "by": "Napkin, to back up a finding",
                     "found": ["x_FORUM0001", "x_COMPAR0002"], "at": "2026-11-18T09:20:00Z"},
                    {"id": "lq_cases", "q": "Which other categories sell time given back, or the journey as the treat?", "status": "done", "by": "Napkin, from the insights",
                     "found": ["x_LOUNGE0003", "x_MEALKIT004", "x_AUDIOB0005", "x_THEMEPK009"], "at": "2026-11-18T09:24:00Z"},
                    {"id": "lq_table", "q": "Can families book table seats on weekend trains?", "status": "ask", "by": "Napkin, for a route that promises a table"}],
        "notes": [{"id": "nt_crew", "agent": "strategy", "at": "2026-11-18T09:35:00Z", "text": "The crew came back: 5 agents, 11 routes."},
                  {"id": "nt_rival", "agent": "review", "at": "2026-11-18T09:52:00Z", "text": "Departure Lounge is close to a rival line. It is kept, with the risk written on it.", "cite": ["fi_RIVALS005"]}],
        "sends": [{"id": "snd_deck", "to": "deck-maker", "territory_ids": chosen, "not_chosen": [i for i in live_dev if i not in chosen], "by": "Shrey", "at": SEND_AT, "status": "sent"},
                  {"id": "snd_prod", "to": "production-tool", "territory_ids": ["t_started"], "not_chosen": [], "by": "Shrey", "at": SEND_AT, "status": "not_built"}],
        "review": {"sensitive": {"required": False, "status": "not_needed"}},
        "run": {"state": "done", "stage": "send", "gate": None,
                "stages": [{"id": s, "name": n, "status": "done"} for s, n in (("pick", "Pick"), ("explore", "Explore"), ("develop", "Develop"), ("greenlight", "Greenlight"), ("send", "Send"))],
                "approvals": {"pick": {"by": "Shrey", "at": PICK_AT, "decision": "approve"}, "greenlight": {"by": "Shrey", "at": GREEN_AT, "decision": "approve"}},
                "decisions": [{"gate": "pick", "kind": "approve", "by": "Shrey", "at": PICK_AT}, {"gate": "greenlight", "kind": "approve", "by": "Shrey", "at": GREEN_AT}],
                "calls": {"model": 31, "lookups": 4},
                "done": {"summary": "11 routes, 8 developed, 3 greenlit and sent to Deck Studio.", "routes": 11, "greenlit": 3, "sent": 3}}}


def _gate(blocked: list[dict]) -> dict:
    return {"id": "greenlight", "n": 2, "of": 2, "agent": "approval", "dex": "Greenlight the routes worth making.", "checks": [], "blocked_by": blocked}


def _at_greenlight(d: dict) -> dict:
    d = copy.deepcopy(d)
    for k in ("sends", "asks"):
        d[k] = []
    d["run"].update({"state": "gate", "stage": "greenlight", "gate": _gate([]), "agent": {"key": "approval", "activity": "human"}})
    d["run"].pop("done")
    d["run"]["approvals"].pop("greenlight")
    d["run"]["decisions"] = d["run"]["decisions"][:1]
    d["run"]["stages"] = [dict(s, status="done" if s["id"] in ("pick", "explore", "develop") else ("now" if s["id"] == "greenlight" else "next")) for s in d["run"]["stages"]]
    return d


def states(d: dict) -> dict[str, dict]:
    out = {}
    # pick: step 1 open
    p = copy.deepcopy(d)
    p.update({"crew": [], "expeditions": [], "territories": [], "greenlit": [], "asks": [], "actions": [], "sends": [], "notes": [], "lookups": [], "finds": []})
    p["focus"]["sources"] = [s for s in p["focus"]["sources"] if not s["id"].startswith("x_")]
    for ins in p["focus"]["insights"]:
        ins["evidence"] = [c for c in ins["evidence"] if not c.startswith("x_")]
    p["focus"]["insights"] = [i for i in p["focus"]["insights"] if i["evidence"] or i["by"] != "engine"]
    p["spread"] = {"threshold": 0.12, "close": [], "gaps": []}
    p["run"] = {"state": "gate", "stage": "pick", "gate": {"id": "pick", "n": 1, "of": 2, "agent": "strategy", "dex": "Tick the insights the crew should explore.", "checks": [], "blocked_by": []},
                "stages": [{"id": s, "name": n, "status": "now" if s == "pick" else "next"} for s, n in (("pick", "Pick"), ("explore", "Explore"), ("develop", "Develop"), ("greenlight", "Greenlight"), ("send", "Send"))],
                "approvals": {}, "decisions": [], "agent": {"key": "strategy", "activity": "human"}, "calls": {"model": 2, "lookups": 0}}
    out["pick"] = p
    # explore_running
    e = copy.deepcopy(d)
    landed = {"t_started", "t_sitdown", "t_sunday", "t_passenger", "t_mixtape"}
    e["territories"] = [_found_only(t) for t in e["territories"] if t["id"] in landed]
    for t in e["territories"]:
        t.pop("rank", None)
    for x in e["expeditions"]:
        x["routes"] = [r for r in x["routes"] if r["territory_id"] in landed]
        x["state"] = "back" if x["crew"] in ("cr_core",) else "running"
        if x["state"] == "running":
            x["turn"] = ""
    e.update({"greenlit": [], "asks": [], "actions": [], "sends": [], "notes": []})
    e["run"] = {"state": "building", "stage": "explore", "gate": None, "agent": {"key": "strategy", "activity": "work", "step_index": 2, "step_total": 5},
                "stages": [dict(s, status="done" if s["id"] == "pick" else ("now" if s["id"] == "explore" else "next")) for s in d["run"]["stages"]],
                "approvals": {"pick": d["run"]["approvals"]["pick"]}, "decisions": d["run"]["decisions"][:1], "calls": {"model": 9, "lookups": 4}}
    out["explore_running"] = e
    # greenlight states
    g = _at_greenlight(d)
    g["greenlit"] = []
    g["run"]["gate"] = _gate([{"kind": "nothing_picked", "text": "Pick at least one route to send."}])
    out["greenlight_open"] = g
    g = _at_greenlight(d)
    g["greenlit"] = [x for x in g["greenlit"] if x["territory_id"] != "t_sunday"]
    for x in g["greenlit"]:
        if x["territory_id"] == "t_passenger":
            x["derived_resolution"] = "pending"
    g["asks"] = [{"id": "ask_passenger", "kind": "derived_evidence", "territory_id": "t_passenger", "ids": ["fi_NOTALK003"], "status": "open",
                  "text": "Passenger Seat rests on a finding the agent derived and nobody has verified. Verify it, or send it flagged?"}]
    g["run"]["gate"] = _gate([{"kind": "derived_evidence", "ids": ["t_passenger"], "text": "Passenger Seat rests on a finding nobody has verified."}])
    out["greenlight_derived_pending"] = g
    g = _at_greenlight(d)
    g["greenlit"] = [x for x in g["greenlit"] if x["territory_id"] == "t_started"]
    g["review"] = {"sensitive": {"required": True, "status": "missing"}}
    g["asks"] = [{"id": "ask_sensitive", "kind": "sensitive_review", "text": "This category needs a person to review the routes before they are sent.", "status": "open"}]
    g["run"]["gate"] = _gate([{"kind": "sensitive_review", "text": "A sensitive-topic review is needed before anything is sent."}])
    out["greenlight_sensitive_missing"] = g
    # failed_refused: a real refusal, in words
    f = _at_greenlight(d)
    bad = copy.deepcopy(f)
    bad["territories"][0]["world"]["lines"] = [f"Line {i}" for i in range(17)]
    bad["territories"][1]["crew"] = "cr_nobody"
    bad["territories"][2]["id"] = "T-3"
    ps = contract.problems(bad)
    f["run"].update({"state": "failed", "gate": None, "error": contract.refusal_error(ps, "develop"), "agent": {"key": "strategy", "activity": "error"}})
    out["failed_refused"] = f
    return out


def build() -> dict[str, dict]:
    d = final()
    files = {"data": d, "facts": facts(), "findings": findings()}
    files.update({f"states/{k}": v for k, v in states(d).items()})
    return files


def main() -> int:
    files = build()
    stale = []
    for name, obj in files.items():
        p = contract.EXAMPLE_DIR / f"{name}.json"
        text = json.dumps(obj, indent=1, ensure_ascii=False) + "\n"
        if "--check" in sys.argv:
            if not p.exists() or p.read_text() != text:
                stale.append(name)
        else:
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(text)
    if stale:
        print("stale fixtures:", ", ".join(stale), "(run python -m territory.example_build)")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
