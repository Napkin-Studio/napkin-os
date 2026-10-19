"""The deck contract in code: slide types, word budgets, statuses, claim bases (ADR 0016).

Kept in one module so the schema file, the assembler, the validators and the renderer agree.
"""

#: Every slide type the renderer has a layout for, with the word budget for the slide's
#: on-screen text (title excluded). Budgets follow the agency rule of thumb that a presented
#: slide carries one idea and is read in under ~20 seconds (see docs/deck-maker/PLAN.md §3).
SLIDE_TYPES = {
    "title":            {"words": 25,  "section": "Opening"},
    "objective":        {"words": 50,  "section": "Objective"},
    "brief_restated":   {"words": 90,  "section": "Your brief"},
    "scoring":          {"words": 90,  "section": "Your brief"},
    "criterion_answer": {"words": 150, "section": "Our answers"},
    "real_question":    {"words": 40,  "section": "The real question"},
    "chart":            {"words": 50,  "section": "The real question"},
    "insight":          {"words": 70,  "section": "Insight"},
    "audience":         {"words": 90,  "section": "Insight"},
    "proposition":      {"words": 80,  "section": "Proposition"},
    "territory":        {"words": 90,  "section": "Territories"},
    "territory_choice": {"words": 90,  "section": "Territories"},
    "idea":             {"words": 60,  "section": "The idea"},
    "execution":        {"words": 80,  "section": "The work"},
    "channel_roles":    {"words": 110, "section": "How it runs"},
    "innovation":       {"words": 100, "section": "How it runs"},
    "guardrails":       {"words": 120, "section": "How it runs"},
    "process":          {"words": 100, "section": "How it runs"},
    "measurement":      {"words": 110, "section": "Measurement"},
    "measurement_plan": {"words": 110, "section": "Measurement"},
    "timeline":         {"words": 80,  "section": "Timeline and investment"},
    "investment":       {"words": 90,  "section": "Timeline and investment"},
    "team":             {"words": 90,  "section": "Team and work"},
    "credentials":      {"words": 90,  "section": "Team and work"},
    "next_step":        {"words": 50,  "section": "Next step"},
    "appendix":         {"words": 25,  "section": "Appendix"},
    # investor (seed) decks: one point per slide, so tighter budgets
    "problem":          {"words": 60,  "section": "The problem"},
    "why_now":          {"words": 60,  "section": "Why now"},
    "solution":         {"words": 60,  "section": "Solution"},
    "product":          {"words": 70,  "section": "Product"},
    "market":           {"words": 60,  "section": "Market"},
    "business_model":   {"words": 60,  "section": "Business model"},
    "traction":         {"words": 80,  "section": "Traction"},
    "what_we_know":     {"words": 70,  "section": "What we know"},
    "competition":      {"words": 80,  "section": "Competition"},
    "gtm":              {"words": 70,  "section": "Go to market"},
    "financials":       {"words": 60,  "section": "Financials"},
    "upside":           {"words": 70,  "section": "Upside"},
    "founders":         {"words": 100, "section": "Team"},
    "ask":              {"words": 70,  "section": "The ask"},
    "risks":            {"words": 90,  "section": "Risks"},
    "close":            {"words": 30,  "section": "Close"},
    "conflicts":        {"words": 220, "section": "Appendix"},
    "questions":        {"words": 140, "section": "Appendix"},
    "requirement_trace": {"words": 220, "section": "Appendix"},
    "appendix_sources": {"words": 260, "section": "Appendix"},
}

#: Where a slide's content came from. ``needs_human`` puts a DRAFT watermark on the whole deck.
STATUSES = ("from_source", "drafted", "needs_human")

#: What a claim rests on. A claim with no refs must be one of the last three.
CLAIM_BASES = ("sourced", "creative", "opinion", "proposal")

#: Ref prefixes a claim may carry (Contract 5 §2.1 plus the deck's own two).
#:   f_   research pin            fi_  research finding
#:   doc: a client document figure or passage (doc:<doc key>#<locator>)
#:   brief: a brief field path (brief:insight, brief:objectives.behavioural)
#:   req: a requirement id (r_..)
#:   prompt: the n-th sentence (1-based) of the person's prompt (refs.prompt_sentences)
#:   answer: the person's answer to an intake question (answer:<qid>)
REF_PREFIXES = ("f_", "fi_", "doc:", "brief:", "req:", "prompt:", "answer:")

#: A deck built from only a prompt, or a prompt and documents, has thin evidence (ADR 0028).
THIN_TIERS = ("prompt", "prompt+documents")
#: thin_evidence warns when more than this share of the presented slides cite nothing.
THIN_EVIDENCE_SHARE = 0.5
#: A deck built from a prompt alone, or a prompt and documents with very little text, is a SKETCH (ADR 0028,
#: DECK-CRAFT-PLAN 5.1): at most SKETCH_MAX_SLIDES presented, and its cover says so. Data, not code: a prompt-only
#: tier is always a sketch; ``prompt+documents`` is one when the documents hold under SKETCH_DOC_CHARS characters
#: in all (about one page of text: a note, not a pack). Napkin defaults, not sourced figures.
SKETCH_MAX_SLIDES = 10
SKETCH_DOC_CHARS = 1500
#: The fixed label a sketch's cover carries (a small fixed label like DRAFT: no input words, no invention).
SKETCH_LABEL = "SKETCH · built from a short prompt: to check and extend before use"

#: A stated limit on the presentation, read from the prompt, answers, brief and documents (assemble.stated_limit).
#: A presentation of N minutes is held to N // MINUTES_PER_SLIDE slides (the pitch rule of thumb: about two minutes
#: a slide) and never fewer than MIN_STATED_SLIDES; a limit outside LIMIT_BOUNDS slides is read as not a deck limit.
MINUTES_PER_SLIDE = 2
MIN_STATED_SLIDES = 5
LIMIT_BOUNDS = (3, 60)
#: When a deck is held to a limit below its length, these slide types leave the presented story for the backup first,
#: in this order, one at a time (the last of a type first); a type not listed here is never moved (the response map, the
#: team, the money, the insight, the idea and the real question are not here, nor are routes the client asked to see; the
#: last three are a last resort; so are competition, measurement_plan and risks at the very end). Nothing is reworded.
TRIM_ORDER = ("process", "guardrails", "timeline", "innovation", "chart", "execution", "channel_roles", "upside", "gtm", "product",
              "credentials", "audience", "competition", "measurement_plan", "measurement", "risks")

#: List prices in USD per million tokens, (input, output), for the cost the CLI transport does not report. An ESTIMATE
#: from tokens (stages._call). A real usd the transport provides wins.
PRICE_PER_MTOK = {"claude-opus-5-5": (5.0, 25.0), "claude-sonnet-5-5": (3.0, 15.0)}
USD_BASIS = "estimate: tokens x list price (spec.PRICE_PER_MTOK), cache tokens at 0.1x and 1.25x input; not a billed amount"


#: Prompt-cache tokens are priced against the input price: a read at this share, a write at this multiple.
CACHE_READ_SHARE, CACHE_WRITE_MULT = 0.1, 1.25


def estimate_usd(model: str, tokens_in: int, tokens_out: int, cache_read: int = 0, cache_creation: int = 0) -> float:
    """Estimated dollars for one model's tokens at spec.PRICE_PER_MTOK; 0.0 for a model not in the table. Cache reads and
    writes are priced at CACHE_READ_SHARE and CACHE_WRITE_MULT of the input price. ``model`` may name several (a comma
    list from a summed stage): the dearest listed one prices the lot, so an estimate is never low."""
    prices = [PRICE_PER_MTOK[m.strip()] for m in str(model or "").split(",") if m.strip() in PRICE_PER_MTOK]
    if not prices:
        return 0.0
    pin, pout = max(prices, key=lambda p: p[1])
    billed_in = (tokens_in or 0) + (cache_read or 0) * CACHE_READ_SHARE + (cache_creation or 0) * CACHE_WRITE_MULT
    return round(billed_in / 1e6 * pin + (tokens_out or 0) / 1e6 * pout, 4)


#: Slide types that cannot be written well without a kind of evidence, and what to say when it is missing
#: (intake.gap_report). ``need`` names a test in intake.HAS: figure, audience, competitor, budget.
SLIDE_EVIDENCE = {
    "agency": {
        "measurement": ("figure", "no figure to measure against: nothing in the prompt, documents, brief or research states one"),
        "chart": ("figure", "no figure to chart: nothing in the inputs states one"),
        "audience": ("audience", "no audience evidence: the audience is empty or only proposed"),
        "insight": ("audience", "no audience evidence to ground an insight"),
        "channel_roles": ("budget", "no budget or scope given to size the channels against"),
        "investment": ("budget", "no budget given"),
    },
    "investor": {
        "traction": ("figure", "no traction figure in the inputs"),
        "market": ("figure", "no market figure in the inputs"),
        "financials": ("figure", "no financial figure in the inputs"),
        "competition": ("competitor", "no competitor evidence in the inputs"),
        "ask": ("budget", "no amount or use of funds in the inputs"),
    },
}

#: Parts a model must never invent (Sai's rule, kickoff §3): rendered as labelled placeholders. Never invented, not
#: never filled: the person's own answers to the supply cards (intake.SUPPLY_CARDS, cited answer:<qid>) and their attached
#: documents, traced to a doc ref, fill them (assemble._fill_human_only; ADR 0023, 0028).
HUMAN_ONLY_TYPES = ("team", "credentials", "investment", "next_step")

PLACEHOLDER_PREFIX = "Proposed (not given by the client):"

#: Who a render is for. ``review`` shows agency notes, marked as such; ``client`` drops blocks
#: marked ``internal`` and fails the gate on any text below (validate: internal_leak).
AUDIENCES = ("review", "client")

#: Text that must never reach a client: pipeline ids, stand-in and gate labels, open items.
INTERNAL_PATTERNS = (
    (r"\b(?:t|r|fi|f|d|src)_[A-Za-z0-9_]{3,}\b", "an internal id"),
    (r"STAND-IN", "a stand-in label"),
    (r"\bGate \d\b", "a pipeline gate"),
    (r"(?i)\bto confirm\b", "an open 'to confirm'"),
    (r"\[Agency\]", "the agency name placeholder"),
)

#: What an illustrative quote says under itself (a quote with no ref is never shown as a verbatim).
ILLUSTRATIVE_QUOTE = "Illustrative line, not a verbatim."

#: The insight slide built from three candidate insights (DECK-CRAFT-PLAN 3.3): the truth is the deck's own claim, said
#: in three lines (people..., but..., so...), with the evidence beside it as supporting lines. Two fixed labels say what the
#: truth rests on; they hold no input words (like ILLUSTRATIVE_QUOTE and the DRAFT mark).
INSIGHT_LABEL = "Our insight, drawn from the evidence below."
INSIGHT_LABEL_UNSOURCED = "Our insight: a proposal, with no input behind it yet."
#: The four yes/no tests the insight judge answers per candidate, and the answer that passes each. ``generic`` asks whether
#: the line could be said about any client in the category (yes fails it); the others pass on yes. A paraphrase that holds
#: a number, or reads as "X% of people do Y", fails the candidate whatever the tests say (assemble.judge_verdicts).
INSIGHT_TESTS = {"generic": "no", "human_tension": "yes", "specific": "yes", "follows": "yes"}
#: What marks a tension (the second line) and an implication (the third line) of the three-line form (validate: insight_shape).
TENSION_WORDS = r"\b(?:but|yet|while|even though|still|instead)\b"
IMPLICATION_START = r"^\s*(?:so|which means)\b"
#: The idea statement's word limit is its slide's budget (SLIDE_TYPES["idea"]); more than this many channel words reads as a channel list.
IDEA_MAX_CHANNEL_WORDS = 1

#: Scored-criterion concepts -> slide types that answer them (validate: criteria_map), in match
#: order. ``mention``: such a slide must also say that word, for concepts a slide type does not
#: carry by itself. ``only``: a part naming it is about that alone (a team part that lists "media
#: planning resources" is about people, not media). "innovation" has no slide type yet, so it is
#: always reported until one is added.
CRITERIA_HOME = (
    # (pattern, home slide types, mention, only)
    (r"team|personnel|organogram|\bCVs?\b", ("team",), None, True),
    (r"price|hourly rates|added value", ("investment",), None, True),
    (r"objectives?|outcomes", ("brief_restated", "measurement"), None, False),
    (r"communications challenges|environment", ("real_question", "chart"), None, False),
    (r"audience|segmentation|targeting", ("audience",), None, False),
    (r"insight", ("insight",), None, False),
    (r"campaign strategy", ("real_question", "proposition"), None, False),
    (r"creative development|creative process|messaging", ("proposition", "idea"), None, False),
    (r"platform", ("idea",), None, False),
    (r"media planning|buying|optimisation", ("channel_roles",), None, False),
    (r"measurement|reporting|evaluation", ("measurement", "measurement_plan"), None, False),
    (r"innovation", ("innovation",), None, False),
    (r"responsible|sensitive", ("guardrails",), None, False),
    (r"accessib", ("guardrails", "execution", "channel_roles"), "accessib", False),
)

def shown_blocks(s: dict, audience: str = "review") -> list:
    """The blocks a slide shows to an audience: internal notes dropped for a client and labelled
    for a review; an unsourced (illustrative) quote followed by its label. Shared by renderers."""
    out = []
    for b in s["blocks"]:
        if b.get("internal"):
            if audience == "client":
                continue
            b = {**b, "text": "Internal note: " + str(b.get("text", ""))}
        out.append(b)
        if b["kind"] == "quote" and not b.get("refs") and str(b.get("text", "")).strip():
            out.append({"kind": "small", "text": ILLUSTRATIVE_QUOTE, "basis": "meta"})
    return out


#: Channel words in an execution's title -> the frame its copy is shown in (render_web) and the
#: copy limits it is held to (validate: copy_spec).
FRAMES = (("phone", ("social", "instagram", "tiktok", "snapchat", "stories", "reels")),
          ("search", ("search",)), ("audio", ("audio", "radio", "podcast", "spotify")),
          ("poster", ("outdoor", "ooh", "billboard", "poster", "transit", "6-sheet", "six-sheet")))


def frame_for(title: str) -> str | None:
    """The channel frame for an execution, from its title (None: no frame, no channel limits)."""
    t = title.lower()
    return next((f for f, words in FRAMES if any(w in t for w in words)), None)


#: Copy limits per frame. Search: Google Ads responsive search ads show headlines of up to 30
#: characters and descriptions of up to 90 (a platform limit). Poster and audio: agency rules of
#: thumb, not sourced figures (a line read whole at distance; about 2.5 spoken words a second).
COPY_LIMITS = {"search_headline_chars": 30, "search_chars": 90, "poster_words": 7, "audio_words_per_sec": 2.5}

#: Budget spread (validate: budget_spread). An agency rule of thumb, not a sourced figure: under
#: SMALL_BUDGET_EUR (gross) more than MAX_PAID_CHANNELS paid channels spreads too thin to work.
#: Channel-role rows naming donated space, organic, the client's own team, or an option "if budget
#: allows" are not in the core paid plan.
SMALL_BUDGET_EUR = 250_000
MAX_PAID_CHANNELS = 3
UNPAID_CHANNEL = r"(?i)donated|charity-rate|organic|own team|in-house|if budget allows|optional"


#: Deck formats. ``pitch`` (default): the agency pitch, a presented story of at most PITCH_MAX
#: slides (about two minutes each, inside a 30-minute core of an hour's slot), then an Appendix
#: divider and the backup. ``full``: every slide in story order, for a leave-behind or as the
#: basis of a written response.
FORMATS = ("pitch", "full")
PITCH_MAX = 18
#: In a pitch these go behind the divider: the brief read back, the client's own criteria map, the
#: routes not chosen, process and the open questions. Only the first chart and PITCH_EXECUTIONS executions are
#: presented; an execution marked optional goes to the appendix first.
PITCH_APPENDIX_TYPES = ("brief_restated", "scoring", "territory", "territory_choice", "process", "questions", "conflicts")
#: Charts presented in a pitch: the first, plus any the fit judge found supported, up to this many.
PITCH_CHARTS = 2
#: Slide types whose titles are labels by convention (a channel, a territory name, the line itself).
LABEL_TITLE_TYPES = ("title", "idea", "execution", "territory", "appendix", "requirement_trace", "appendix_sources")
PITCH_EXECUTIONS = 3
OPTIONAL = r"(?i)\bif budget allows\b|\boptional\b"
#: Pairs merged into one presented slide in a pitch: (kept, merged into it, the merged title).
PITCH_MERGES = (("team", "credentials", "The team you would work with, and work like this we have done"),
                ("investment", "next_step", "Investment, and what we would like to agree today"))


def norm_text(t) -> str:
    """Lower-case words only, single-spaced: the one form message lines and slides are compared in."""
    import re
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s]", " ", str(t).lower())).strip()


def message_parts(line: str) -> list:
    """The substance of a mandated message's line: split by line, ' / ' and sentence; annotations in
    brackets and speaker labels (DECLAN:) dropped; parts of three words or more, in norm_text form."""
    import re
    raw = re.split(r"\s/\s|\n|(?<=[.!?:])\s+", re.sub(r"\([^)]*\)", " ", str(line)))
    parts = [norm_text(re.sub(r"^\s*[A-Za-z][A-Za-z ]{0,29}:\s*", "", x)) for x in raw]
    return [x for x in parts if len(x.split()) >= 3]


#: Deck kinds: an agency's response to a client brief, or a company's investor (seed) pitch.
KINDS = ("agency", "investor")
INVESTOR_TYPES = ("objective", "problem", "why_now", "solution", "product", "market", "business_model", "traction", "what_we_know",
                  "competition", "gtm", "financials", "upside", "founders", "ask", "risks", "close")
#: A brief mandatory -> the investor slide types that answer it (first pattern that matches).
INVESTOR_HOME = ((r"market|sizing|tam\b|cagr", ("market",)), (r"business model|revenue mechanic|pricing", ("business_model",)),
                 (r"competit|white space|positioning", ("competition",)), (r"use[- ]of[- ]funds|raise|round|runway", ("ask",)),
                 (r"team|founder|credential", ("founders",)), (r"risk", ("risks",)),
                 (r"truthful|misleading|guarantee|promise|forward-looking", ("risks", "financials")),
                 (r"traction|proof|evidence", ("traction",)), (r"product|demo", ("product",)), (r"problem", ("problem",)))


#: Every validator check (validate.run), by name: a profile's ``strict`` map may name only these.
CHECKS = ("numbers_trace", "numbers_uncited", "unverified_fig", "rejected_used", "proposed_used", "unknown_ref", "bare_claim",
          "word_budget", "empty_slot", "placeholder", "requirement_map", "banned_phrase", "watch_word", "message_carried",
          "action_title", "repeated_line", "copy_number", "pitch_length", "rule_broken", "source_required", "internal_leak",
          "quote_source", "criteria_map", "imagery", "copy_spec", "budget_spread", "thin_evidence", "claim_fit", "objective_quant",
          "insight_shape", "idea_single", "chain_links", "weight_share")

#: Deck types (profiles/<id>.yaml, deck.profiles): what a deck is for decides its spine, stages, strictness and guidance.
#: ``DEFAULT_TYPE`` is what a skipped type question falls back to.
DECK_TYPES = ("agency_pitch", "tender_response", "investor_seed", "credentials")
DEFAULT_TYPE = "agency_pitch"

#: The red team (stage red_team, DECK-CRAFT-PLAN 4.2): the most objections kept, the kinds of objection it may raise, and the
#: change each may suggest. Only ``wording`` and ``order`` on an existing presented slide are ever applied by code.
RED_TEAM_MAX = 6
RED_TEAM_KINDS = ("ask_unanswered", "objective_unclear", "claim_unsupported", "risk_unaddressed", "price_unclear")
RED_TEAM_CHANGES = ("wording", "order", "placeholder", "ask")
#: Slide types a red-team order change never moves (the cover and the objective stay where the build put them).
RED_TEAM_FIXED = ("title", "objective")


#: Tender written answers, one model call per scored criterion (DECK-CRAFT-PLAN item 9, NAPKIN-EDGE 3 and its weight-aware
#: allocation). A criterion's word budget is its weight's share of ANSWER_WORDS_TOTAL (a Napkin default, not a sourced figure),
#: never under ANSWER_WORDS_MIN, and never past the buyer's own page or word limit for it (WORDS_PER_PAGE turns pages into words).
ANSWER_WORDS_TOTAL = 600
ANSWER_WORDS_MIN = 40
WORDS_PER_PAGE = 450
#: weight_share (validate): a criterion holding at least this share of the total weight is "heavily weighted", and is warned
#: when its share of the presented words falls under WEIGHT_SHARE_FLOOR of its weight share (under half).
HEAVY_WEIGHT_SHARE = 0.25
WEIGHT_SHARE_FLOOR = 0.5
#: In a pitch, a slide of a type that answers a scored criterion which has a written answer (a ``criterion_answer`` slide) goes behind the
#: Appendix divider, because the answer is that criterion's presented slide (the derived deck). These types always stay presented.
ANSWER_KEEPS = ("title", "scoring", "objective", "criterion_answer", "appendix", "next_step")
