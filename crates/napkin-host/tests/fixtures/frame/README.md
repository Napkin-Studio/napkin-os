# Frame composition golden

The pages the shell composed for an app frame before the composition moved to
`napkin_host::frame::compose` (features/doc-open-direct.clan). `expected.json`
holds the SHA-256 and length of each page; `tests/frame_golden.rs` composes the
same inputs in Rust and asks for the same bytes.

- `research.html.gz`, `brief.html.gz`: the human view of the Research Tool's
  example document and of Brief Maker, as `Session::human_html` served them.
- `fragment.html`: a legacy view with no `<html>` (the shell's wrapper).
- `edge.html`: leading space, upper-case tags, a scheme already stamped, and a
  `</body>` inside a script string.
- `nobody.html`: a page with no `</body>` and no `<body>`.

Each input is composed for every host's last pass (web: the `clan://` rewrite
and fetch shim for origin `https://napkin.test/s/no-token`; desktop: none;
device: the CSP and the rpc shim), render model, dogfood capture and theme.

Generated once, by `app/scripts/frame-golden.mjs` at the commit that added
this directory, from the TypeScript composition as it then stood. The
TypeScript is gone; these hashes are the record of what it made.
