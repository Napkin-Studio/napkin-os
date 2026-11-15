# Napkin Brain: what this agency has decided

This document is a **brain**: pages of lines, each line pointing at a decision a person made in a job document. There is one brain per client and one for the agency. A client's brain holds only that client's work. Nothing in it is written by a model unless a person approves it.

The document's data:
- `vault`: `kind` (`agency` or `client`) and, for a client's brain, `client`.
- `pages`: by slug. A page has a `type` (decision, idea, outcome, lesson, client, person, tool, job), a `title`, a `summary` of 20 words or fewer, an `owner_role`, `links` to other pages, and `lines`.
- `sources`: for each source document, where the last read stopped.
- `proposals`: lines waiting for an owner's approval.

Rules the brain and any agent keep:
- **Cite every line.** A line names the document and the decision it comes from. No source, no line.
- **A derived line holds no words from a source.** It stores an id, a rule, its cites and slots, where a slot is an id, an enum word, a date or a number. The sentence is made when the page is read, from the cited decision, through what Napkin's systems may read. A part marked confidential is not read, and so it leaves every page the moment it is marked.
- **Never rewrite history.** When a fact changes, the old line is marked superseded with the date and a link to the line that replaced it, and the new line is added. No line is edited or deleted.
- **A curated line is a person's.** It holds that person's own words and who approved it. A derived line is never touched by a curator, and a curated line is never touched by the ingest.
- **Verified is computed, never stored.** A line is verified only while the client has accepted the version its decision sits on.
- **Nothing scores a person.** A person's page says what that person decided or owns. It holds no counts, no lateness and no rankings.
- **No figure of money anywhere**, and nothing from outside the agency's own documents and public facts.
- Every write names an agent and an action.

The page you see is static. The pages of lines come with the host's ingest and reader, and the screens follow.
