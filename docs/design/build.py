#!/usr/bin/env python3
"""Builds the static design proposal in this folder. Run: python3 docs/design/build.py

The pages are plain HTML on one stylesheet (napkin.css). No script runs in them.
J001 is shown de-identified: the client is "Client A", an Irish whiskey brand.
The agency is a placeholder, "Agency", with a burnt orange block in its logo.
"""
from pathlib import Path

OUT = Path(__file__).parent

DOORS = {
    "planning": ("Planning", "Aoife", ["Brief", "Research", "Territories", "Client brains", "Presentations"],
                 ["Ideas (read only)", "Case study builder (read only)"]),
    "creative-director": ("Creative", "Dara", ["Ideas", "Ready for review", "Judge scores", "Approved work", "Direction notes"],
                          ["Brief (read and sign)", "Presentations", "Traffic board (read only)"]),
    "account-service": ("Account service", "Niamh", ["Clients", "Live jobs", "Approvals", "Scope and estimates", "Presentations"],
                        ["Case study builder", "Job memory", "Compliance night watch"]),
    "management": ("Management", "Conor", ["Agency dashboard", "Live jobs", "Time and money", "Clients", "Traffic board"],
                   ["Presentations", "Agency Brain (read only)"]),
}
DOOR_LINKS = {"Brief": "brief-gate.html", "Agency dashboard": "dashboard.html", "Territories": "visual-brief.html",
              "Ready for review": "visual-brief.html", "Approvals": "client-confirm.html"}
NEEDS = {
    "planning": [
        ("J001 brief has no measurable objective. One question is ready for Client A.", "Due today", "Ask the client", "brief-gate.html"),
        ("Research for J001 finished. 14 findings, 3 to verify.", "Due Thursday", "Open research", "#"),
        ("Client A changed the launch date on J001.", "Due Friday", "See what changed", "#"),
    ],
    "creative-director": [
        ("J001 visual brief, version 2, is ready for you.", "Due today", "Review version 2", "visual-brief.html"),
        ("J001 brief passed the gate. It needs your signature.", "Due tomorrow", "Read and sign", "brief-gate.html"),
    ],
    "account-service": [
        ("Client A has not confirmed the J001 brief. Sent 2 days ago.", "Due today", "Send a reminder", "client-confirm.html"),
        ("J001 has no approval route yet.", "Due Thursday", "Name the approvers", "#"),
        ("J001 hours are at 61% of budget.", "No deadline", "Open the job", "dashboard.html"),
    ],
    "management": [
        ("J001 has waited 2 days on the client.", "Due today", "Open the job", "dashboard.html"),
    ],
}


def top(person="Aoife", today="5 h 40"):
    return f"""<header class="top">
  <a class="mark" href="o.html" aria-label="The O: map of the agency"><i></i>AGENCY</a>
  <div class="bar" role="search">Find a job, a brief or a person <kbd>Cmd K</kbd></div>
  <a class="chip" href="timesheet-day.html">Today {today}</a>
  <button class="textbtn" type="button">Ask Nap</button>
</header>"""


def page(name, title, body, mode="white", person="Aoife", with_top=True):
    html = f"""<!doctype html>
<html lang="en" data-mode="{mode}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title} · Napkin OS design proposal</title>
<link rel="stylesheet" href="napkin.css">
</head>
<body>
{top(person) if with_top else ""}
{body}
</body>
</html>
"""
    assert "—" not in html, name
    (OUT / name).write_text(html)


def home(key, mode="white", suffix=""):
    dept, person, doors, more = DOORS[key]
    needs = NEEDS[key]
    doors_html = "\n".join(f'    <a class="door" href="{DOOR_LINKS.get(d, "#")}">{d}</a>' for d in doors)
    more_html = "\n".join(f'    <a href="#">{m}</a>' for m in more)
    rows = []
    for i, (what, when, action, href) in enumerate(needs):
        cls = "btn primary" if i == 0 else "btn"
        rows.append(f'    <li><span class="what">{what}</span><span class="when">{when}</span><a class="{cls}" href="{href}">{action}</a></li>')
    n = len(needs)
    count = f'<span class="count">{n}</span> ' + ("thing needs you" if n == 1 else "things need you")
    body = f"""<main class="page gap6">
  <div class="gap3">
    <p class="where"><span>{dept}</span><span>/</span><b>Home</b></p>
    <h1 class="t34">Good morning, {person}.</h1>
    <p class="mid">{count}. The next deadline is today, on J001.</p>
  </div>
  <section class="gap4" aria-labelledby="needs">
    <h2 class="label" id="needs">Needs you</h2>
    <ul class="needs">
{chr(10).join(rows)}
    </ul>
  </section>
  <section class="gap4" aria-labelledby="doors">
    <h2 class="label" id="doors">Your doors</h2>
    <nav class="doors">
{doors_html}
    </nav>
  </section>
  <section class="gap3" aria-labelledby="more">
    <h2 class="label" id="more">More tools</h2>
    <nav class="more">
{more_html}
    </nav>
  </section>
</main>"""
    page(f"home-{key}{suffix}.html", f"{dept} home", body, mode=mode, person=person)


# The O
def the_o():
    depts = [("Planning", "home-planning.html", True), ("Creative", "home-creative-director.html", False),
             ("Account service", "home-account-service.html", False), ("Management", "home-management.html", False),
             ("Production", "#", False)]
    circles = []
    for i, (name, href, here) in enumerate(depts):
        cls = "door here" if here else "door"
        cur = ' aria-current="true"' if here else ""
        circles.append(f'    <a class="{cls}" style="--a:{i * 72}deg" href="{href}"{cur}>{name}</a>')
    body = f"""<main class="page gap6">
  <div class="gap3">
    <p class="where"><b>The O</b></p>
    <h1 class="t34">Where do you want to go?</h1>
    <p class="mid">Your own department is marked. You land in your home, not here.</p>
  </div>
  <nav class="o" aria-label="Departments">
    <div class="logo"><i></i>AGENCY</div>
{chr(10).join(circles)}
  </nav>
  <section class="gap3" aria-labelledby="others" style="text-align:center">
    <h2 class="label" id="others">Other departments</h2>
    <nav class="others"><a href="#">Clients</a><a href="#">Agency Brain</a></nav>
  </section>
</main>"""
    page("o.html", "The O", body)


def brief_gate():
    gate = [
        ("One proposition", "The whiskey that waits for you.", "pass"),
        ("One insight", "People do not want more time. They want permission to stop.", "pass"),
        ("One measurable objective", "The brief says grow consideration. It gives no number and no date.", "open"),
        ("Feel or do", "Feel unhurried. Choose it for the first drink of the evening.", "pass"),
        ("What would make this famous", "A bar that closes its doors for one song.", "pass"),
        ("How we will know", "Consideration among 25 to 40, tracked monthly, against the March baseline.", "pass"),
    ]
    rows = "\n".join(f'      <li><span class="label">{k}</span><span>{v}</span><span class="state {s}"></span></li>' for k, v, s in gate)
    body = f"""<main class="page">
  <p class="where"><span>Planning</span><span>/</span><span>J001 Client A</span><span>/</span><b>Brief gate</b></p>
  <div class="cols">
    <div class="gap5">
      <div class="gap3">
        <h1 class="t34">Brief, version 3</h1>
        <p class="mid"><span class="count">5 of 6</span> gate items passed. Territories stay closed until the brief passes and Client A confirms it.</p>
      </div>
      <ul class="rows">
{rows}
      </ul>
    </div>
    <aside class="gap5">
      <section class="gap3 note">
        <h2 class="label">One question for Client A</h2>
        <p class="t21">What number should consideration reach, and by when?</p>
        <p class="mid">From the brief check: the objective is vague. Evidence: "grow consideration among younger drinkers".</p>
        <a class="btn" href="client-confirm.html">Ask the client</a>
      </section>
      <section>
        <button class="btn dashed" type="button" aria-disabled="true">Sign version 3</button>
        <p class="reason">One gate item is missing. Signing locks this version.</p>
      </section>
      <section class="gap3">
        <h2 class="label">History</h2>
        <p>Version 2, signed by Aoife on 3 Nov. <a href="#">Compare with version 3</a></p>
        <p class="mid">Drafted by the brief crew on Sonnet 5.5. Edited by Aoife, 6 changes.</p>
      </section>
    </aside>
  </div>
</main>"""
    page("brief-gate.html", "Brief gate", body)


def visual_brief():
    body = """<main class="page">
  <p class="where"><span>Creative</span><span>/</span><span>J001 Client A</span><span>/</span><b>Visual brief</b></p>
  <div class="cols">
    <article class="sheet gap5">
      <div class="gap3">
        <p class="label">Territory 2 of 4 · chosen by Aoife</p>
        <h1 class="t55">Permission to stop</h1>
        <p class="t21 read">The evening does not start until something tells you the day is over. This whiskey is that signal.</p>
      </div>
      <div class="ph" style="aspect-ratio: 16 / 9">Reference frame. A rectangle, never a circle.</div>
      <dl class="rows">
        <div><dt class="label">Proposition</dt><dd>The whiskey that waits for you.</dd><dd></dd></div>
        <div><dt class="label">Tone</dt><dd>Unhurried. Dry. Never nostalgic.</dd><dd></dd></div>
        <div><dt class="label">Must show</dt><dd>The 70 cl bottle, label forward. Age statement readable.</dd><dd></dd></div>
        <div><dt class="label">Never show</dt><dd>Anyone who looks under 25. Driving. Sport.</dd><dd></dd></div>
      </dl>
    </article>
    <aside class="gap5">
      <section class="gap3">
        <h2 class="label">Version 2</h2>
        <p>Answers brief version 3, signed and confirmed by Client A.</p>
        <p><a href="brief-gate.html">Why does this exist? Open the brief line</a></p>
      </section>
      <section>
        <button class="btn primary" type="button">Approve version 2</button>
        <p class="reason">Approval locks this exact version. A later change makes version 3.</p>
      </section>
      <section class="gap3">
        <h2 class="label">After you approve</h2>
        <p><span class="locked">Locked</span></p>
        <p class="mid">The stamp names the version and you. Stills, film and radio open from here.</p>
      </section>
    </aside>
  </div>
</main>"""
    page("visual-brief.html", "Visual brief approval", body, person="Dara")


def client_confirm():
    body = """<main class="client gap5">
  <header class="gap3">
    <p class="mark"><i></i>AGENCY</p>
    <p class="label">For Client A · J001 · Brief, version 3</p>
    <h1 class="t34">Please confirm this brief</h1>
    <p class="mid">You do not need an account. This link is yours, and it expires on 11 December.</p>
  </header>
  <section class="gap4">
    <div class="gap3"><h2 class="label">What we are solving</h2><p class="t21">Younger drinkers respect the brand and do not choose it.</p></div>
    <div class="gap3"><h2 class="label">The one thing to say</h2><p class="t21">The whiskey that waits for you.</p></div>
    <div class="gap3"><h2 class="label">How we will know it worked</h2><p class="t21">Consideration among 25 to 40 reaches 31% by June, from 24% in March.</p></div>
    <div class="gap3"><h2 class="label">Budget and date</h2><p>As agreed on 28 October. Launch in the week of 2 March.</p></div>
    <p><a href="#">Read the full brief, 2 pages</a></p>
    <p class="mid">Drafted with AI and edited by Aoife at Agency. Signed by Aoife and Dara.</p>
  </section>
  <div class="stick">
    <button class="btn primary" type="button">Confirm this brief</button>
    <button class="btn" type="button">Ask for changes</button>
  </div>
</main>"""
    page("client-confirm.html", "Client confirmation link", body, with_top=False)


def dashboard():
    tiles = [
        ("Live jobs by stage", "1 in Brief", "J001 Client A. Waiting for the client to confirm."),
        ("At risk", "0", "No job is past a deadline."),
        ("Hours against budget", "61%", "J001: 73 of 120 hours confirmed."),
        ("Days waiting on client", "2", "J001 brief, sent on 9 November."),
        ("Work scoring 27 or more", "No scores yet", "Judge starts in Phase 2."),
        ("Results against objectives", "No results yet", "J001 has not launched."),
    ]
    t = "\n".join(f'    <section class="tile gap3"><h2 class="label">{a}</h2><a class="n" href="#">{b}</a><p class="mid">{c}</p></section>' for a, b, c in tiles)
    body = f"""<main class="page gap6">
  <div class="gap3">
    <p class="where"><span>Management</span><span>/</span><b>Agency dashboard</b></p>
    <h1 class="t34">This week</h1>
    <p class="mid">One live job. Every number opens the job behind it.</p>
  </div>
  <div class="tiles">
{t}
  </div>
</main>"""
    page("dashboard.html", "Agency dashboard", body, person="Conor")


def timesheet():
    lines = [
        ("2 h 10", "J001 Client A · Brief", "Built from 3 work sessions and 6 edits you made."),
        ("1 h 30", "J001 Client A · Research", "Built from 1 work session and 3 findings you verified."),
        ("0 h 45", "Agency · Planning meeting", "You added this by hand."),
    ]
    rows = "\n".join(f'      <li><span>{h}</span><span>{j}<br><span class="mid">{b}</span></span><a href="#">Change</a></li>' for h, j, b in lines)
    body = f"""<main class="page">
  <p class="where"><span>Planning</span><span>/</span><b>Today</b></p>
  <div class="cols">
    <div class="gap5">
      <div class="gap3">
        <h1 class="t34">Tuesday 11 November</h1>
        <p class="mid">Drafted from your own work in Napkin OS. Nothing is sent until you confirm.</p>
      </div>
      <ul class="day">
{rows}
      <li class="gapline"><span>1 h 15</span><span>Not accounted for, 14:00 to 15:15.<br><span class="mid">Best guess: J001 Client A · Brief. You had it open before and after.</span></span><a href="#">Use this guess</a></li>
      </ul>
    </div>
    <aside class="gap5">
      <section>
        <button class="btn primary" type="button">Confirm today, 5 h 40</button>
        <p class="reason">One tap. You can change a confirmed day until Friday.</p>
      </section>
      <section class="gap3">
        <h2 class="label">What is captured</h2>
        <p>Work sessions inside Napkin OS: on. <a href="timesheet-consent.html">Change</a></p>
        <p class="mid">No keystrokes, no screen capture. Your corrections are private to you.</p>
      </section>
    </aside>
  </div>
</main>"""
    page("timesheet-day.html", "Timesheet day view", body)
    body2 = """<main class="page">
  <p class="where"><span>Planning</span><span>/</span><b>Today</b></p>
  <div class="gap5 read">
    <div class="gap3">
      <h1 class="t34">Should Napkin OS draft your timesheet?</h1>
      <p class="t21">If you say yes, it notes which job you have open and for how long. That is all. It drafts your day from that, and you confirm it.</p>
    </div>
    <ul class="gap3">
      <li>Nothing is captured until you say yes.</li>
      <li>No keystrokes, no screen capture, no hidden tracking.</li>
      <li>Your manager never sees your corrections.</li>
      <li>If you say no, you fill in your day by hand. Nothing else changes.</li>
    </ul>
    <div class="btnrow">
      <button class="btn primary" type="button">Yes, draft my day</button>
      <button class="btn" type="button">No, I will fill it in</button>
    </div>
  </div>
</main>"""
    page("timesheet-consent.html", "Timesheet consent", body2)


def index():
    items = [
        ("o.html", "The O", "The map. The agency logo at the centre, five department circles, the rest as text."),
        ("home-planning.html", "Planning home", "Needs you, five doors, More tools."),
        ("home-creative-director.html", "Creative director home", ""),
        ("home-account-service.html", "Account service home", ""),
        ("home-management.html", "Management home", ""),
        ("brief-gate.html", "Brief gate", "Six gate items, one question for the client, a dashed primary with its reason."),
        ("visual-brief.html", "Visual brief approval", "One page. The creative director approves one exact version."),
        ("client-confirm.html", "Client confirmation link", "Drawn for a phone. No account."),
        ("dashboard.html", "Agency dashboard", "Six tiles as plain numbers. J001 only."),
        ("timesheet-day.html", "Timesheet day view", "A pre-filled day, one gap, one tap."),
        ("timesheet-consent.html", "Timesheet consent", "Shown once, before anything is captured."),
        ("home-planning-black.html", "Planning home, Black mode", "The one Black mode sample."),
    ]
    li = "\n".join(f'    <li><a href="{h}">{t}</a><span class="mid">{d}</span></li>' for h, t, d in items)
    body = f"""<main class="page gap5">
  <div class="gap3 read">
    <p class="label">Napkin OS · Discovery · 11 November 2026</p>
    <h1 class="t34">Design proposal</h1>
    <p>Static pages for Laurence to judge. Open each at 390 and 1440 px wide. White mode, with one Black sample. J001 is shown de-identified as Client A. The agency logo and its accent are placeholders.</p>
    <p class="mid">Screenshots at both widths are in shots/. The checks are in CHECKS.md.</p>
  </div>
  <ul class="index">
{li}
  </ul>
</main>"""
    page("index.html", "Index", body, with_top=False)


if __name__ == "__main__":
    for k in DOORS:
        home(k)
    home("planning", mode="black", suffix="-black")
    the_o(); brief_gate(); visual_brief(); client_confirm(); dashboard(); timesheet(); index()
    print("built", len(list(OUT.glob("*.html"))), "pages")
