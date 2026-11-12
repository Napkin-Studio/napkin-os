// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! The page an app frame loads (features/doc-open-direct.clan).
//!
//! An app's human view ([`crate::Session::human_html`]) is not yet a page the
//! frame can run: the shell's edit bridge goes in at its last `</body>`, a bare
//! fragment gets a page around it, the colour scheme is stamped on `<html>` so
//! a light reader sees no dark flash, the dogfood build's listener goes in
//! when it records, and the frame is told how to reach the host. [`compose`]
//! does all of it, the same way for every host:
//!
//!   * the web (napkin-web `/s/{token}/document`): served over HTTP at the
//!     frame's token URL; the page's literal `clan://` bases are rewritten to
//!     it and a fetch shim goes first in `<head>` ([`Reach::Origin`]);
//!   * the desktop (`clan://localhost/document`): `clan://` is a real scheme,
//!     nothing to rewrite ([`Reach::Scheme`]);
//!   * the device (the WebAssembly host, frame loaded from `srcdoc`): no
//!     server, so a CSP goes first and an rpc shim routes every `clan://` call
//!     through the shell ([`Reach::Device`]).
//!
//! This used to be TypeScript in the shell (AppRuntime's `prepared`, each
//! host's `prepareAppHtml`), and the web shell posted the whole page back to
//! the server for the frame to fetch. `tests/frame_golden.rs` holds this
//! composer to the pages that TypeScript made, byte for byte.
//!
//! The scripts themselves are browser code and live with the shell, linted
//! there (`app/src/shell/bridge/*.js`); they are compiled in from there.
//! Pure string work: no filesystem, no network — wasm32-clean.

/// Which edit bridge the page gets: the document's `render_model`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RenderModel {
    /// A template app's view (`view.source == "app"`): the structured bridge,
    /// which writes the data layer.
    Authored,
    /// AI-generated HTML: the contenteditable bridge, which patches the view.
    Legacy,
}

impl RenderModel {
    /// `authored` or `legacy`, as [`crate::OpenResult::render_model`] says it.
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "authored" => Some(Self::Authored),
            "legacy" => Some(Self::Legacy),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Authored => "authored",
            Self::Legacy => "legacy",
        }
    }
}

/// The shell's colour scheme, stamped on `<html data-color-scheme>`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Theme {
    Light,
    Dark,
}

impl Theme {
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "light" => Some(Self::Light),
            "dark" => Some(Self::Dark),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Light => "light",
            Self::Dark => "dark",
        }
    }
}

/// How the frame reaches the host's `clan://` routes.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Reach {
    /// `clan://` is a real scheme (the desktop): the page is left as it is.
    Scheme,
    /// Over HTTP at this URL, the frame's token base (`https://host/s/{token}`).
    Origin(String),
    /// No server (the device host): the frame posts each call to the shell.
    Device,
}

/// What a page is composed for. Everything but the view itself.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FrameOptions {
    pub model: RenderModel,
    /// The dogfood build records, and the person has agreed: add the frame listener.
    pub capture: bool,
    pub theme: Theme,
    pub reach: Reach,
}

impl FrameOptions {
    /// Read `model`, `capture` and `theme` from a query string
    /// (`model=authored&capture=1&theme=dark`); anything else in it (`v`) is
    /// ignored. A missing or unknown model is `model`, a missing theme light,
    /// and capture is on only for `capture=1`.
    pub fn from_query(query: &str, model: RenderModel, reach: Reach) -> Self {
        let mut opts = Self {
            model,
            capture: false,
            theme: Theme::Light,
            reach,
        };
        for pair in query.split('&') {
            let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
            match k {
                "model" => opts.model = RenderModel::parse(v).unwrap_or(model),
                "capture" => opts.capture = v == "1",
                "theme" => opts.theme = Theme::parse(v).unwrap_or(Theme::Light),
                _ => {}
            }
        }
        opts
    }
}

/// The page the frame loads: `human_html` composed for `opts`.
pub fn compose(human_html: &str, opts: &FrameOptions) -> String {
    let script = match opts.model {
        RenderModel::Authored => script_body(STRUCTURED_EDIT_BRIDGE),
        RenderModel::Legacy => script_body(LEGACY_EDIT_BRIDGE),
    };
    let mut bridge = format!("<script>{script}</script>");
    if opts.capture {
        bridge.push_str("<script data-dogfood-capture>");
        bridge.push_str(script_body(FRAME_CAPTURE));
        bridge.push_str("</script>");
    }

    // Cmd or Ctrl K is listened for from the top of the page, before the app's own scripts and the bridge run.
    let early = format!("<script>{}</script>", script_body(BAR_KEY_FORWARDER));

    let page = if is_full_doc(human_html) {
        // At the LAST </body>: an app's inline script may hold '</body>' in a
        // string literal (an HTML-export builder), and the bridge spliced
        // there is a syntax error that kills the app's whole script.
        let with_bridge = match last_body_close(human_html) {
            Some(at) => [&human_html[..at], &bridge, &human_html[at..]].concat(),
            None => [human_html, &bridge].concat(),
        };
        // Just inside the first <head> (or <html>): the page's own, before any script of the app's that could
        // hold the text.
        inject_first(&with_bridge, &early)
    } else {
        // After the charset, which the browser wants in the first 1024 bytes.
        let head = FRAGMENT_HEAD.replacen(
            "<meta charset=\"UTF-8\">",
            &format!("<meta charset=\"UTF-8\">\n  {early}"),
            1,
        );
        [&head, human_html, "\n  ", &bridge, "\n</body>\n</html>"].concat()
    };

    // In the markup as well as posted after load: the message comes after the
    // first paint, and a light reader should not see a dark flash first.
    let themed = stamp_theme(page, opts.theme);

    match &opts.reach {
        Reach::Scheme => themed,
        Reach::Origin(origin) => {
            // Apps compute their API base once, at parse time, from a scheme
            // the browser does not have: the two forms it can take are
            // rewritten, and fetch patched for anything built later.
            let rewritten = themed
                .replace("http://clan.localhost", origin)
                .replace("clan://localhost", origin);
            let base = serde_json::to_string(origin).unwrap_or_else(|_| "\"\"".into());
            let shim = format!(
                "<script>{}</script>",
                script_body(WEB_SHIM).replacen("\"__CLAN_ORIGIN__\"", &base, 1)
            );
            inject_first(&rewritten, &shim)
        }
        Reach::Device => {
            let shim = format!("<script>{}</script>", script_body(DEVICE_SHIM));
            with_policy(&inject_first(&themed, &shim))
        }
    }
}

/// What a frame on the device may reach: its inline code, the assets the shim
/// turns into blobs and the typeface the templates ask Google for. The frame
/// is sandboxed without `allow-same-origin` already; this stops the app's own
/// scripts sending the document anywhere. It does not stop a script
/// navigating its own frame; no browser ships a directive for that yet.
pub const FRAME_CSP: &str = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src data: https://fonts.gstatic.com; img-src data: blob:; media-src data: blob:; frame-src blob: data:; connect-src 'none'; form-action 'none'; base-uri 'none'";

const STRUCTURED_EDIT_BRIDGE: &str =
    include_str!("../../../app/src/shell/bridge/structuredEditBridge.js");
const LEGACY_EDIT_BRIDGE: &str = include_str!("../../../app/src/shell/bridge/legacyEditBridge.js");
const FRAME_CAPTURE: &str = include_str!("../../../app/src/shell/bridge/frameCapture.js");
const BAR_KEY_FORWARDER: &str = include_str!("../../../app/src/shell/bridge/barKeyForwarder.js");
const WEB_SHIM: &str = include_str!("../../../app/src/shell/bridge/webShim.js");
const DEVICE_SHIM: &str = include_str!("../../../app/src/shell/bridge/deviceShim.js");

/// The page a bare fragment is put in, up to the fragment: the studio's paper,
/// ink and type (the values of the shell's tokens, which do not cross into the
/// frame).
const FRAGMENT_HEAD: &str = r##"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400..800&display=swap">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html { scroll-behavior: smooth; }
    /* A bare fragment gets the studio's paper, ink and type (the values of
       the shell's tokens, which do not cross into the frame). */
    :root { color-scheme: light; --paper: #FFFFFF; --ink: #14161B; --line: #D6DAE2; }
    html[data-color-scheme="dark"] { color-scheme: dark; --paper: #0F1114; --ink: #F2F3F5; --line: #2A2F38; }
    body {
      background: var(--paper);
      color: var(--ink);
      font-family: 'Geist', 'Helvetica Neue', Arial, sans-serif;
      font-size: 15px;
      line-height: 1.65;
      -webkit-font-smoothing: antialiased;
    }
    ::-webkit-scrollbar { width: 6px; }
    ::-webkit-scrollbar-thumb { background: var(--line); border-radius: 3px; }
  </style>
</head>
<body>
  "##;

/// A bridge file without its leading `//` lines (the licence and the note on
/// what it is): the rest goes into the page exactly as written.
fn script_body(file: &'static str) -> &'static str {
    let mut rest = file;
    while rest.starts_with("//") {
        rest = match rest.find('\n') {
            Some(nl) => &rest[nl + 1..],
            None => "",
        };
    }
    rest
}

/// JavaScript's `\s`: what the shell's regular expressions skipped.
fn js_space(c: char) -> bool {
    matches!(
        c,
        '\t' | '\n' | '\u{0B}' | '\u{0C}' | '\r' | ' ' | '\u{A0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200A}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202F}'
                | '\u{205F}'
                | '\u{3000}'
                | '\u{FEFF}'
    )
}

fn starts_with_ci(s: &str, prefix: &str) -> bool {
    s.len() >= prefix.len() && s.as_bytes()[..prefix.len()].eq_ignore_ascii_case(prefix.as_bytes())
}

/// A whole page (`<!doctype html` or `<html` first), not a fragment.
fn is_full_doc(html: &str) -> bool {
    let s = html.trim_start_matches(js_space);
    if starts_with_ci(s, "<html") {
        return true;
    }
    if !starts_with_ci(s, "<!doctype") {
        return false;
    }
    let after = &s["<!doctype".len()..];
    let name = after.trim_start_matches(js_space);
    name.len() < after.len() && starts_with_ci(name, "html")
}

/// Where the last `</body>` starts, in any case.
fn last_body_close(html: &str) -> Option<usize> {
    const CLOSE: &[u8] = b"</body>";
    let b = html.as_bytes();
    (0..=b.len().checked_sub(CLOSE.len())?)
        .rev()
        .find(|&i| b[i..i + CLOSE.len()].eq_ignore_ascii_case(CLOSE))
}

/// The first `<{name}` tag (`<head`, `<html`; not `<header`): where it starts
/// and just past its `>`. None when there is none, or no `>` after it.
fn find_tag(html: &str, open: &str) -> Option<(usize, usize)> {
    let b = html.as_bytes();
    let n = open.len();
    let start = (0..b.len().saturating_sub(n - 1)).find(|&i| {
        b[i..i + n].eq_ignore_ascii_case(open.as_bytes())
            && !matches!(b.get(i + n), Some(c) if c.is_ascii_alphanumeric() || *c == b'_')
    })?;
    let gt = html[start + n..].find('>')? + start + n;
    Some((start, gt + 1))
}

/// `<html …>` with `data-color-scheme` added, unless the page set its own.
fn stamp_theme(page: String, theme: Theme) -> String {
    let Some((start, end)) = find_tag(&page, "<html") else {
        return page;
    };
    let attrs = &page[start + "<html".len()..end - 1];
    if attrs.to_ascii_lowercase().contains("data-color-scheme=") {
        return page;
    }
    format!(
        "{}<html{attrs} data-color-scheme=\"{}\">{}",
        &page[..start],
        theme.as_str(),
        &page[end..]
    )
}

/// Put a script ahead of every script the app has: straight after `<head>`,
/// else after `<html>`, else first. Apps fetch on parse, not on
/// DOMContentLoaded, so a shim at `</body>` would install itself too late.
fn inject_first(html: &str, script: &str) -> String {
    match find_tag(html, "<head").or_else(|| find_tag(html, "<html")) {
        Some((_, at)) => [&html[..at], script, &html[at..]].concat(),
        None => [script, html].concat(),
    }
}

/// The CSP first of all, since a meta policy governs only what is parsed after
/// it; after the doctype, so the page is not thrown into quirks mode.
fn with_policy(html: &str) -> String {
    let meta = format!("<meta http-equiv=\"Content-Security-Policy\" content=\"{FRAME_CSP}\">");
    let lead = html.len() - html.trim_start_matches(js_space).len();
    if starts_with_ci(&html[lead..], "<!doctype") {
        if let Some(gt) = html[lead..].find('>') {
            let at = lead + gt + 1;
            return [&html[..at], &meta, &html[at..]].concat();
        }
    }
    [&meta, html].concat()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn opts(model: RenderModel, capture: bool, theme: Theme, reach: Reach) -> FrameOptions {
        FrameOptions {
            model,
            capture,
            theme,
            reach,
        }
    }

    fn plain() -> FrameOptions {
        opts(RenderModel::Authored, false, Theme::Light, Reach::Scheme)
    }

    #[test]
    fn the_bridge_goes_in_at_the_last_body_close() {
        let html =
            "<!doctype html><html><body><script>var s='</body>';</script><p>x</p></BODY></html>";
        let page = compose(html, &plain());
        let bridge = page.find("window.__clan_structured_bridge").unwrap();
        assert!(
            bridge > page.find("var s='</body>'").unwrap(),
            "not in the script's string"
        );
        assert!(bridge < page.rfind("</BODY>").unwrap());
        assert!(
            page.contains("var s='</body>';</script>"),
            "the app's script is untouched"
        );
    }

    #[test]
    fn a_page_with_no_body_close_gets_the_bridge_at_the_end() {
        let page = compose("<html><p>open", &plain());
        assert!(page.ends_with("</script>"));
        assert!(page.starts_with("<html data-color-scheme=\"light\"><script>\n(function() {"));
        assert!(page.contains("<p>open<script>"));
    }

    #[test]
    fn a_fragment_gets_a_page_around_it() {
        let page = compose("<p data-adf-id=\"a\">Hi</p>", &plain());
        assert!(page.starts_with("<!DOCTYPE html>\n<html lang=\"en\" data-color-scheme=\"light\">"));
        assert!(page.contains("<body>\n  <p data-adf-id=\"a\">Hi</p>\n  <script>"));
        assert!(page.ends_with("</script>\n</body>\n</html>"));
    }

    #[test]
    fn leading_space_and_case_still_make_a_whole_page() {
        assert!(is_full_doc("\u{FEFF}\n <!DOCTYPE   HTML>"));
        assert!(is_full_doc("  <HTML lang=en>"));
        assert!(!is_full_doc("<!doctypehtml>"));
        assert!(!is_full_doc("<section><html></html></section>"));
    }

    #[test]
    fn authored_and_legacy_get_their_own_bridge() {
        let a = compose("<html><body></body></html>", &plain());
        let l = compose(
            "<html><body></body></html>",
            &opts(RenderModel::Legacy, false, Theme::Light, Reach::Scheme),
        );
        assert!(a.contains("__clan_structured_bridge") && !a.contains("__clan_bridge_listening"));
        assert!(l.contains("__clan_bridge_listening") && !l.contains("__clan_structured_bridge"));
        assert!(
            !a.contains("This Source Code Form"),
            "the licence lines stay in the file"
        );
    }

    #[test]
    fn capture_adds_the_frame_listener_only_when_on() {
        let html = "<html><body></body></html>";
        let off = compose(html, &plain());
        let on = compose(
            html,
            &opts(RenderModel::Authored, true, Theme::Light, Reach::Scheme),
        );
        assert!(!off.contains("data-dogfood-capture"));
        assert!(on.contains("<script data-dogfood-capture>(function(){\nvar nameOf="));
        assert!(on.contains("clan:interaction"));
    }

    #[test]
    fn the_theme_is_stamped_once_and_never_over_the_pages_own() {
        let dark = compose(
            "<html lang=en><body></body></html>",
            &opts(RenderModel::Authored, false, Theme::Dark, Reach::Scheme),
        );
        assert!(dark.starts_with("<html lang=en data-color-scheme=\"dark\">"));
        let own = compose(
            "<HTML Data-Color-Scheme=\"light\"><body></body></HTML>",
            &opts(RenderModel::Authored, false, Theme::Dark, Reach::Scheme),
        );
        assert!(own.starts_with("<HTML Data-Color-Scheme=\"light\">"));
        let header = compose("<htmlx><html><body></body></html>", &plain());
        assert!(
            header.starts_with("<!DOCTYPE")
                || header.contains("<html data-color-scheme=\"light\">")
        );
    }

    #[test]
    fn the_web_rewrites_clan_bases_and_puts_its_shim_first() {
        let origin = "https://napkin.example/s/tok".to_string();
        let html = "<!doctype html><html><head><title>t</title></head><body><img src=\"clan://localhost/assets/a.png\"><script>fetch('http://clan.localhost/x')</script></body></html>";
        let page = compose(
            html,
            &opts(
                RenderModel::Authored,
                false,
                Theme::Light,
                Reach::Origin(origin.clone()),
            ),
        );
        assert!(!page.contains("clan://localhost") && !page.contains("http://clan.localhost/x"));
        assert!(page.contains("src=\"https://napkin.example/s/tok/assets/a.png\""));
        let head = page.find("<head>").unwrap() + "<head>".len();
        assert!(page[head..]
            .starts_with("<script>(function(){\n  var BASE=\"https://napkin.example/s/tok\";"));
    }

    #[test]
    fn the_desktop_page_keeps_its_clan_scheme() {
        let page = compose(
            "<html><head></head><body><img src=\"clan://localhost/a\"></body></html>",
            &plain(),
        );
        assert!(page.contains("clan://localhost/a"));
        assert!(!page.contains("var BASE="));
    }

    #[test]
    fn the_device_page_starts_with_its_policy_after_the_doctype() {
        let d = opts(RenderModel::Authored, false, Theme::Light, Reach::Device);
        let page = compose("<!DOCTYPE html><html><head></head><body></body></html>", &d);
        assert!(page.starts_with(&format!("<!DOCTYPE html><meta http-equiv=\"Content-Security-Policy\" content=\"{FRAME_CSP}\"><html")));
        assert!(
            page.contains("<head><script>(function(){\n  var f=window.fetch, seq=0, pending={};")
        );
        let bare = compose("<html><body></body></html>", &d);
        assert!(bare.starts_with("<meta http-equiv=\"Content-Security-Policy\""));
    }

    #[test]
    fn the_query_names_the_options_and_defaults_to_the_documents_model() {
        let o = FrameOptions::from_query(
            "model=legacy&capture=1&theme=dark&v=abc",
            RenderModel::Authored,
            Reach::Scheme,
        );
        assert_eq!(
            o,
            opts(RenderModel::Legacy, true, Theme::Dark, Reach::Scheme)
        );
        let d = FrameOptions::from_query("", RenderModel::Legacy, Reach::Device);
        assert_eq!(
            d,
            opts(RenderModel::Legacy, false, Theme::Light, Reach::Device)
        );
        let junk = FrameOptions::from_query(
            "model=x&capture=yes&theme=blue",
            RenderModel::Authored,
            Reach::Scheme,
        );
        assert_eq!(junk, plain());
    }

    #[test]
    fn script_bodies_lose_only_their_leading_comment_lines() {
        assert_eq!(script_body("// a\n// b\n\n(x)\n// c\n"), "\n(x)\n// c\n");
        assert_eq!(script_body("(x)"), "(x)");
    }
}
