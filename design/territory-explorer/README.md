# Territory Explorer: the design (mock)

The clickable prototype and walkthrough for `features/territory-explorer.clan`
(status `exploring`, awaiting the owner's approval). All brands, people and
figures in it are **fabricated example data** (Linea, weekend rail in Ireland).

- `prototype.html`: open it in a browser. It is self-contained: the shared agent
  engine (`app/templates/shared/agent-sphere`, MPL-2.0) is inlined for the role
  spheres; fonts load from Google Fonts. It opens on the brief, then the
  research, then "Continue in Territory Explorer".
- `walkthrough/three-steps.mp4`: the captioned walkthrough (3.5 min, no sound).
- `walkthrough/*.jpg`: the stills, in order.

## The flow: three steps, three decisions

1. **Pick what to work on.** The brief and research arrive read, the category
   scan runs in the background, and insights come ranked by evidence strength
   with the top ones ticked. The planner ticks or adds insights, then Explore.
2. **The crew explores.** Agents set off on their own on different headings:
   close to the core (Strategy), towards warmth (Idea), the opposite pole
   (Copy), next door (Research), far outside (Synthesis). A compass shows each
   trail from the brief, what it picked up (cited) and where its routes landed.
   Look-ups run as needed (no cap yet; spend is logged). The Review agent fixes
   the spread itself, with Undo. Landscape, whitespace, other categories and the
   planner's own ideas are tabs here, not steps. Steering is optional.
3. **Review and greenlight.** Every route comes back developed (a campaign
   world across a weekend, lines, checks, blind rank). The planner greenlights
   as many as are worth making and sends them to production (Deck Studio or the
   production tool).

The Booth (as in production-tool, `features/booth.clan`) holds the agents'
notes and asks. A person is asked only when a greenlit route rests on a derived
finding, or something is close to a mandatory.

The design itself (problem, approaches, risks, contracts, tests, rollout, open
questions) is in the feature record: `scripts/feature show territory-explorer`.

## Fonts in this copy

Each territory has its own typeface in the design. This committed copy uses only
fonts already cleared in `licences/fonts.toml` (Newsreader for the serif faces,
Geist Extra Bold for the bold display face), because Fraunces, Archivo Black,
DM Serif Display, Instrument Serif and Caveat are not in it yet. They are all
SIL OFL 1.1 on Google Fonts; adding them needs a person's licence approval
(an open question in the feature record). The walkthrough video and stills show
the intended faces.
