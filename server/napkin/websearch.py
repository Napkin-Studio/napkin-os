"""The research port in process: `napkin.research/1` (peripherals.md §2) without
a research service. Tavily searches; when Tavily fails, Amazon Nova's web
grounding on Bedrock finds the sources and the pages are read here.

  search(query, lens, market, ...) -> {sources: [{id, url, publisher, title,
      retrieved_at, published_at?, excerpts: [quote]}], trace: {backend, queries, ...}}

The same shape `ResearchPort` returns, so nothing above the port changes.

How a search runs:
  1. Tavily, advanced depth: ranked results, each with up to three passages
     relevant to the question and the page's own text (`include_raw_content`),
     in one call. No page is fetched here.
     Nova (the failover): Nova 2 Lite answers the question with web grounding;
     only its cited URLs are kept, and each page is fetched and read here.
  2. Tavily's passages are split into sentences, and only the sentences the
     page itself holds are kept (its passages are stitched from several
     places and carry captions and menus).
  3. One model call (purpose `research_select`, routed like any other) picks
     the sources worth citing, names the publisher, picks the numbered
     sentences that bear on the question and says the publication date only
     when the page states it. It never writes a Tavily quote; (Nova) it copies
     from the page text it was given.
  4. Neighbouring sentences make one quote when the page has them together;
     a copied quote is checked against the page, words and figures in order,
     formatting aside, and only what the page says is kept.

No facts, confidence or tiers (§2.2): the middleware derives those, and checks
every figure it extracts against the quotes. Any failure is a ResearchError,
so the unit becomes a gap, never an empty success; `sources: []` is honest.
"""

from __future__ import annotations

import datetime as _dt
import hashlib
import html.parser
import io
import logging
import re
import unicodedata
from urllib.parse import urlsplit, urlunsplit

import httpx

from .model import ModelError, Usage
from .research import ResearchError

log = logging.getLogger("napkin.websearch")

TAVILY_URL = "https://api.tavily.com/search"
TAVILY_CREDIT_USD = 0.008          # pay as you go; an advanced search is 2 credits
NOVA_MODEL = "us.amazon.nova-2-lite-v1:0"
NOVA_REGION = "us-east-1"          # web grounding runs in US regions only

MAX_QUERY = 400                    # Tavily's own limit is on the long side of this
MAX_EXCERPTS = 5
MAX_QUOTE = 1500
HEAD_CHARS = 1200                  # the top of a page, where a publication date usually is
PAGE_CHARS = 9000                  # what the model reads of a fetched page (Nova path)
FETCH_BYTES = 4_000_000
FETCH_TIMEOUT = 20.0

# What each lens looks for (campaign-clan.md §7), to steer the choice.
LENSES = {
    "market_structure": "size and value of the category, volumes, growth, market shares, the main players, "
                        "channel and segment splits",
    "brands_positioning": "how the brand and its competitors position themselves, claims, price tiers, launches "
                          "and campaigns",
    "consumer_culture": "who buys the category and why, attitudes, barriers, motivations, demographics, trends",
    "category_codes": "the visual, verbal and tonal conventions of the category's communication",
    "rhythm_moments": "seasonality, buying cycles, calendar moments, sales peaks, events that move the category",
    "media_spend": "advertising spend in the category, media mix, share of voice, channel trends",
    "regulation_clearance": "laws, advertising codes, mandatory claims or disclosures, grants and incentives",
    "effectiveness_evidence": "published case studies, effectiveness awards and papers, measured campaign results",
}

# Posts on these are not citable sources, and Tavily gives no page text for them.
SOCIAL = ["facebook.com", "linkedin.com", "reddit.com", "x.com", "twitter.com", "instagram.com",
          "tiktok.com", "youtube.com", "pinterest.com", "quora.com"]

# Tavily's `country` boosts one country's results; it takes the English name.
COUNTRIES = {
    "IE": "ireland", "GB": "united kingdom", "US": "united states", "DE": "germany", "FR": "france",
    "ES": "spain", "IT": "italy", "NL": "netherlands", "BE": "belgium", "PT": "portugal", "AT": "austria",
    "CH": "switzerland", "SE": "sweden", "NO": "norway", "DK": "denmark", "FI": "finland", "PL": "poland",
    "CZ": "czech republic", "GR": "greece", "AU": "australia", "NZ": "new zealand", "CA": "canada",
    "IN": "india", "SG": "singapore", "AE": "united arab emirates", "ZA": "south africa", "JP": "japan",
}

SELECT_SYSTEM = """You choose web sources for one research question in one market. You do not \
analyse or conclude: another system takes facts from the passages you keep.

For each candidate you are given its URL, title, numbered sentences from the page and the \
top of the page (or, for some, the page text). Keep the candidates worth citing, best first:
- prefer primary sources (statistics offices, regulators, government, company filings, annual \
reports, official press releases), then industry bodies and trade press, then reputable news; \
skip forums, content farms, pages that only restate others, and anything off the market: \
a source about other countries counts only for the passages that state this market's own \
figures, and fewer sources are better than off-market ones;
- keep only sentences that bear on the question: figures, dates, named rules, stated positions, \
and the sentences that state the period a figure describes; never menus, headers, captions, \
calls to action or links to other articles;
- `publisher` is the organisation behind the page (e.g. "Central Statistics Office");
- `published_at` (YYYY-MM-DD) only when the text you were given states when the page was \
published or last updated; otherwise leave it out. Never guess it.
For a candidate with numbered sentences, give the numbers to keep in `lines` (neighbouring \
numbers become one quote). For one with page text and no numbered sentences, copy 1 to 3 \
short passages (under 400 characters each) into \
`quotes` EXACTLY as written: no paraphrase, no ellipses joining separate places, no added words.
Keeping nothing is a valid answer."""

SELECT_SCHEMA = {
    "type": "object", "additionalProperties": False, "required": ["sources"],
    "properties": {"sources": {"type": "array", "items": {
        "type": "object", "additionalProperties": False, "required": ["n", "publisher"],
        "properties": {
            "n": {"type": "integer", "description": "the candidate's number"},
            "publisher": {"type": "string"},
            "lines": {"type": "array", "items": {"type": "integer"}},
            "quotes": {"type": "array", "items": {"type": "string"}},
            "published_at": {"type": "string", "description": "YYYY-MM-DD, only if stated"},
        }}}},
}


def today() -> str:
    return _dt.datetime.now(_dt.timezone.utc).date().isoformat()


def _clean(s: str) -> str:
    return " ".join(unicodedata.normalize("NFC", s or "").split())


_IMAGE = re.compile(r"!\[([^\]]*)\]\([^)]*\)")   # an image counts as its caption
_SENTENCE = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9\"'“‘(€£$])")
_LINK = re.compile(r"\[([^\]]*)\]\([^)]*\)")
_WORD = re.compile(r"[^\W_]+(?:[.,:/'][^\W_]+)*%?")


def _plain(s: str) -> str:
    """For checking a quote against a page: its words and numbers, in order.
    Formatting (markdown marks, tables, image and link targets, spacing) does
    not count; every word and figure does, contiguous and in the same order."""
    s = unicodedata.normalize("NFKC", s or "").replace("’", "'").replace("‘", "'")
    s = _LINK.sub(r"\1", _IMAGE.sub(r" \1 ", s)).lower()
    return " " + " ".join(_WORD.findall(s)) + " "


def _page(raw: str) -> str:
    """A page for checking quotes against: its words with image captions and
    without them (a quote may or may not carry one), as two texts no match
    can span ("|" is never part of a word)."""
    if not (raw or "").strip():
        return ""
    bare = _plain(_IMAGE.sub(" ", raw))
    return _plain(raw) + "|" + bare


def tidy(s: str) -> str:
    """A quote as the page reads, without its markdown: headings, emphasis,
    images, link targets and table rules go; the words stay as written."""
    s = _LINK.sub(r"\1", _IMAGE.sub(r" \1 ", s or ""))
    lines = []
    for line in s.splitlines():
        line = re.sub(r"^\s{0,3}#{1,6}\s*", "", line)
        if re.fullmatch(r"[\s|:\-]*", line):
            continue
        line = re.sub(r"\*\*|__|`", "", line).strip(" |")
        lines.append(" | ".join(c.strip() for c in line.split("|")) if "|" in line else line)
    return _clean(" ".join(lines))


def _fit(s: str) -> str:
    """A quote within MAX_QUOTE: cut at the last sentence end that fits (a
    contiguous piece of the same text), at a word when no sentence ends."""
    if len(s) <= MAX_QUOTE:
        return s
    head = s[:MAX_QUOTE]
    end = max(head.rfind(". "), head.rfind("? "), head.rfind("! "), head.rfind(".\n"))
    if end >= MAX_QUOTE // 3:
        return head[:end + 1]
    return head.rsplit(" ", 1)[0]


LINE_CHARS = 600                   # one sentence shown to the model, at most
CANDIDATE_CHARS = 5000             # all of one candidate's sentences shown, at most


def lines_of(c: dict) -> list[tuple[int, str]]:
    """A Tavily candidate's passages as sentences the page holds, numbered for
    the model: (passage index, sentence). Menus and other page furniture are on
    the page too, but the model does not pick them; sentences Tavily's passage
    has and the page does not are left out. No page text: Tavily's passage is
    its claim about the URL (§2.2), and its sentences are shown as they are."""
    page = _page(c["page"])
    out, total = [], 0
    for at, passage in enumerate(c["passages"]):
        # the page's own lines first (a menu or heading has no full stop), then sentences
        pieces = [s for line in passage.splitlines() for s in _SENTENCE.split(tidy(line))]
        for sentence in pieces:
            sentence = sentence.strip()
            if len(_plain(sentence).split()) < 3 or (page.strip() and _plain(sentence) not in page):
                continue
            if len(sentence) > LINE_CHARS:
                sentence = sentence[:LINE_CHARS].rsplit(" ", 1)[0]
            if total + len(sentence) > CANDIDATE_CHARS:
                return out
            out.append((at, sentence))
            total += len(sentence)
    return out


def on_page(text: str, page: str) -> list[str]:
    """The parts of `text` that are on the page (`page` is `_plain` of it):
    each unbroken run of its sentences the page holds in the same order is
    one quote. A passage stitched from several places, or with words of its
    own, gives only what the page says."""
    if _plain(text) in page:
        return [text]
    runs, run = [], []
    for sentence in _SENTENCE.split(text):
        if run and _plain(" ".join(run + [sentence])) in page:
            run.append(sentence)
        elif _plain(sentence).strip() and _plain(sentence) in page:
            if run:
                runs.append(" ".join(run))
            run = [sentence]
        else:
            if run:
                runs.append(" ".join(run))
            run = []
    if run:
        runs.append(" ".join(run))
    # a lone heading or a few words is not a quote
    return [r for r in runs if len(_plain(r).split()) >= 6]


def normalise_url(url) -> str | None:
    if not isinstance(url, str) or not url.strip() or any(c.isspace() for c in url.strip()):
        return None
    try:
        p = urlsplit(url.strip())
        host = p.hostname
    except ValueError:
        return None
    if p.scheme.lower() not in ("http", "https") or not host:
        return None
    path = p.path or "/"
    if len(path) > 1:
        path = path.rstrip("/")
    return urlunsplit((p.scheme.lower(), p.netloc.lower(), path, p.query, ""))


def valid_date(s, text: str) -> str | None:
    """A real date, not in the future, whose year the given text shows."""
    if not isinstance(s, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", s.strip()):
        return None
    try:
        d = _dt.date.fromisoformat(s.strip())
    except ValueError:
        return None
    if d > _dt.date.fromisoformat(today()) or str(d.year) not in (text or ""):
        return None
    return d.isoformat()


class _Text(html.parser.HTMLParser):
    SKIP = {"script", "style", "noscript", "svg", "head", "nav", "footer", "form"}
    BLOCK = {"p", "div", "br", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "section", "article", "table"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out, self.skip, self.title, self._in_title = [], 0, "", False

    def handle_starttag(self, tag, attrs):
        if tag in self.SKIP:
            self.skip += 1
        if tag == "title":
            self._in_title = True
        if tag in self.BLOCK:
            self.out.append("\n")

    def handle_endtag(self, tag):
        if tag in self.SKIP and self.skip:
            self.skip -= 1
        if tag == "title":
            self._in_title = False

    def handle_data(self, data):
        if self._in_title:
            self.title += data
        elif not self.skip:
            self.out.append(data)


def html_text(body: str) -> tuple[str, str]:
    p = _Text()
    try:
        p.feed(body)
    except Exception:  # a broken page reads as far as it parsed
        pass
    text = "\n".join(" ".join(line.split()) for line in "".join(p.out).splitlines())
    return _clean(p.title), re.sub(r"\n{2,}", "\n", text).strip()


def pdf_text(data: bytes) -> str:
    from pypdf import PdfReader
    reader = PdfReader(io.BytesIO(data))
    return "\n".join((page.extract_text() or "") for page in reader.pages[:30]).strip()


class WebResearch:
    """`napkin.research/1` in process. `tavily_key` None: Nova only; `nova`
    False: Tavily only. `model_port` picks and checks; `nova_client` and
    `transport` replace the Bedrock client and the HTTP transport in tests."""

    def __init__(self, model_port, tavily_key: str | None, *, nova: bool = True, nova_region: str = NOVA_REGION,
                 nova_model: str = NOVA_MODEL, timeout: float = 120.0, transport=None, nova_client=None):
        if not tavily_key and not nova:
            raise ValueError("web research needs a Tavily key, Nova, or both")
        self.model_port, self.tavily_key, self.nova = model_port, tavily_key, nova
        self.nova_region, self.nova_model, self.timeout = nova_region, nova_model, timeout
        self._http = httpx.Client(timeout=timeout, transport=transport, follow_redirects=True,
                                  headers={"User-Agent": "NapkinResearch/1 (+https://napkin.ie)"})
        self._nova_client = nova_client

    # ------------------------------------------------------------ the port

    def search(self, query: str, lens: str, market: str, entity: str | None = None, category: str | None = None,
               max_sources: int = 6, attribution: dict | None = None) -> dict:
        q = _clean(query)[:MAX_QUERY]
        if not q:
            raise ResearchError("research needs a question")
        market = (market or "").strip().upper()
        backend, credits, failed = None, 0, None
        if self.tavily_key:
            try:
                cands, credits = self._tavily(q, market, max_sources)
                backend = "tavily"
            except ResearchError as e:
                if not self.nova:
                    raise
                failed = str(e)
                log.warning("tavily failed (%s): Nova grounding instead", e)
        if backend is None:
            try:
                cands = self._nova_candidates(q, lens, market)
            except ResearchError as e:
                raise ResearchError(f"{failed}; then {e}" if failed else str(e)) from None
            backend = "nova-grounding"
        retrieved = today()
        usage = Usage()
        sources, drops = self._select(q, lens, market, cands, max_sources, retrieved, usage)
        trace = {"backend": backend, "queries": [q],
                 "model": next(iter(usage.by_model), None),
                 "cost_usd": round(credits * TAVILY_CREDIT_USD, 4) if backend == "tavily" else None,
                 "cached": False, "candidates": len(cands), "dropped": drops,
                 "tokens": {"input": usage.input_tokens, "output": usage.output_tokens}}
        if failed:
            trace["failover"] = failed
        return {"sources": sources, "trace": trace}

    # ------------------------------------------------------------ Tavily

    def _tavily(self, q: str, market: str, max_sources: int) -> tuple[list[dict], int]:
        body = {"query": q, "search_depth": "advanced", "topic": "general", "chunks_per_source": 3,
                "max_results": max(8, min(20, max_sources * 2)), "include_raw_content": "markdown",
                "include_answer": False, "include_images": False, "exclude_domains": SOCIAL}
        if market in COUNTRIES:
            body["country"] = COUNTRIES[market]
        try:
            r = self._http.post(TAVILY_URL, json=body, headers={"Authorization": f"Bearer {self.tavily_key}"})
        except httpx.TimeoutException as e:
            raise ResearchError(f"Tavily timed out after {self.timeout:.0f}s") from e
        except httpx.HTTPError as e:
            raise ResearchError(f"Tavily unreachable ({type(e).__name__})") from e
        if r.status_code != 200:
            detail = ""
            try:
                d = r.json().get("detail")
                detail = d.get("error") if isinstance(d, dict) else str(d or "")
            except Exception:
                pass
            raise ResearchError(f"Tavily returned {r.status_code}{': ' + detail[:200] if detail else ''}")
        try:
            out = r.json()
        except ValueError as e:
            raise ResearchError("Tavily returned a body that is not JSON") from e
        results = out.get("results") if isinstance(out, dict) else None
        if not isinstance(results, list):
            raise ResearchError("Tavily returned no results list")
        cands = []
        for res in results:
            if not isinstance(res, dict):
                continue
            url = normalise_url(res.get("url"))
            if not url:
                continue
            content = res.get("content") or ""
            passages = [p.strip() for p in re.split(r"\s*\[\.\.\.\]\s*|\s*\.\.\.\s*\n", content) if p.strip()]
            cands.append({"url": url, "title": _clean(res.get("title")) or url,
                          "passages": passages[:3], "page": res.get("raw_content") or ""})
        credits = 2
        usage = out.get("usage") if isinstance(out.get("usage"), dict) else {}
        if isinstance(usage.get("credits"), (int, float)):
            credits = usage["credits"]
        return cands, credits

    # ------------------------------------------------------------ Nova

    def _nova(self):
        if self._nova_client is None:
            import botocore.config
            import botocore.session
            self._nova_client = botocore.session.get_session().create_client(
                "bedrock-runtime", region_name=self.nova_region,
                config=botocore.config.Config(read_timeout=self.timeout, retries={"max_attempts": 2}))
        return self._nova_client

    def _nova_candidates(self, q: str, lens: str, market: str) -> list[dict]:
        if not self.nova:
            raise ResearchError("no web search is configured")
        ask = (f"{q}\n\nMarket: {COUNTRIES.get(market, market)}. Looking for: {LENSES.get(lens, lens)}. "
               "Search the web and answer briefly, citing primary sources (statistics offices, regulators, "
               "company reports) where they exist, with the most recent figures and the period they describe.")
        try:
            resp = self._nova().converse(
                modelId=self.nova_model, messages=[{"role": "user", "content": [{"text": ask}]}],
                toolConfig={"tools": [{"systemTool": {"name": "nova_grounding"}}]},
                inferenceConfig={"maxTokens": 1200})
        except Exception as e:
            raise ResearchError(f"Nova grounding failed ({type(e).__name__}: {str(e)[:200]})") from None
        urls: list[str] = []
        for block in ((resp.get("output") or {}).get("message") or {}).get("content") or []:
            for cit in ((block.get("citationsContent") or {}).get("citations") or []):
                u = normalise_url(((cit.get("location") or {}).get("web") or {}).get("url"))
                if u and u not in urls:
                    urls.append(u)
        cands = []
        for u in urls[:10]:
            got = self._fetch(u)
            if got:
                cands.append(got)
        return cands

    def _fetch(self, url: str) -> dict | None:
        try:
            with self._http.stream("GET", url, timeout=FETCH_TIMEOUT) as r:
                if r.status_code != 200:
                    return None
                data = b""
                for chunk in r.iter_bytes():
                    data += chunk
                    if len(data) > FETCH_BYTES:
                        break
                kind = r.headers.get("content-type", "").lower()
                encoding = r.encoding or "utf-8"
        except httpx.HTTPError:
            return None
        try:
            if "pdf" in kind or url.lower().endswith(".pdf") or data[:5] == b"%PDF-":
                title, text = "", pdf_text(data)
            else:
                title, text = html_text(data.decode(encoding, errors="replace"))
        except Exception:
            return None
        if len(text) < 200:
            return None
        return {"url": url, "title": title or url, "passages": [], "page": text}

    # ------------------------------------------------------------ choosing and checking

    def _select(self, q, lens, market, cands, max_sources, retrieved, usage) -> tuple[list[dict], dict]:
        drops = {"not_chosen": 0, "quote_not_on_page": 0, "trimmed_to_page": 0, "no_quotes": 0}
        if not cands:
            return [], drops
        shown = []
        for i, c in enumerate(cands, 1):
            item = {"n": i, "url": c["url"], "title": c["title"]}
            if c["passages"]:
                c["lines"] = lines_of(c)
                item["lines"] = [{"i": j, "text": t} for j, (_, t) in enumerate(c["lines"], 1)]
                item["top_of_page"] = c["page"][:HEAD_CHARS]
            else:
                c["lines"] = []
                item["page_text"] = c["page"][:PAGE_CHARS]
            shown.append(item)
        payload = {"question": q, "lens": lens, "looking_for": LENSES.get(lens, ""), "market": market,
                   "today": retrieved, "at_most": max_sources, "candidates": shown}
        try:
            out = self.model_port.call("research_select", SELECT_SYSTEM, payload, SELECT_SCHEMA, usage=usage,
                                       attribution="research")
        except ModelError as e:
            raise ResearchError(f"choosing sources failed ({e.kind})") from None
        sources, seen = [], set()
        for pick in out.get("sources") or []:
            n = pick.get("n")
            if not isinstance(n, int) or not 1 <= n <= len(cands) or n in seen:
                continue
            seen.add(n)
            c = cands[n - 1]
            page = _page(c["page"])
            quotes: list[str] = []
            # Tavily: the chosen lines, neighbours in one passage joined into one quote
            # when the page has them together (lines are on the page already).
            run, last = [], None
            for k in sorted({k for k in pick.get("lines") or [] if isinstance(k, int)
                             and 1 <= k <= len(c["lines"])}):
                at, text = c["lines"][k - 1]
                joined = " ".join(run + [text])
                if run and last == (at, k - 1) and (not page.strip() or _plain(joined) in page):
                    run.append(text)
                else:
                    if run:
                        quotes.append(_fit(" ".join(run)))
                    run = [text]
                last = (at, k)
            if run:
                quotes.append(_fit(" ".join(run)))
            # Nova: what the model copied from the page text, checked here
            for text in [x for x in pick.get("quotes") or [] if isinstance(x, str)]:
                text = tidy(text)
                if not text:
                    continue
                # A Tavily passage with no page text to check it against is Tavily's
                # claim about the URL, as a research service's quote is (§2.2).
                parts = on_page(text, page) if page.strip() else [text]
                if not parts:
                    drops["quote_not_on_page"] += 1
                elif parts != [text]:
                    drops["trimmed_to_page"] += 1
                for part in parts:
                    part = _fit(part)
                    if part and part not in quotes:
                        quotes.append(part)
            if not quotes:
                drops["no_quotes"] += 1
                continue
            src = {"id": "src_" + hashlib.sha256(c["url"].encode()).hexdigest()[:16], "url": c["url"],
                   "publisher": _clean(pick.get("publisher")) or (urlsplit(c["url"]).hostname or ""),
                   "title": c["title"], "retrieved_at": retrieved,
                   "published_at": valid_date(pick.get("published_at"), c["page"][:PAGE_CHARS] + " " +
                                              " ".join(c["passages"])),
                   "excerpts": quotes[:MAX_EXCERPTS]}
            sources.append(src)
            if len(sources) >= max_sources:
                break
        drops["not_chosen"] = len(cands) - len(seen)
        return sources, drops


def web_research(settings, model_port) -> WebResearch:
    """The port NAPKIN_RESEARCH_WEB names (config.py)."""
    mode = settings.research_web
    if mode not in ("tavily", "tavily-only", "nova"):
        raise SystemExit(f"NAPKIN_RESEARCH_WEB must be tavily, tavily-only or nova, not {mode!r}")
    if mode != "nova" and not settings.tavily_api_key:
        raise SystemExit(f"NAPKIN_RESEARCH_WEB={mode} needs NAPKIN_TAVILY_API_KEY")
    return WebResearch(model_port, settings.tavily_api_key if mode != "nova" else None,
                       nova=mode != "tavily-only", nova_region=settings.nova_region, nova_model=settings.nova_model,
                       timeout=min(settings.research_timeout, 180.0))
