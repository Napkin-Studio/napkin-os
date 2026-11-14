// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at https://mozilla.org/MPL/2.0/.

//! An agency logo uploaded from the People page, made safe before it is kept
//! (features/agency-looks-admin.clan).
//!
//! Two steps. [`active_content`] refuses outright a file that carries anything
//! that could run or reach out (script, `on*=` handlers, `foreignObject`, an
//! `href` that is not `#local` or is `javascript:`, `<!ENTITY>`, `<!DOCTYPE>`),
//! saying what and on which line. [`sanitise_svg`] is then a line-for-line
//! port of the shell's `app/src/shell/agency/svgSanitise.ts` `sanitiseSvg`:
//! only shapes and their flat fills survive, coordinates to two decimals. The
//! two must agree byte for byte (the preview is the TS one, the stored file
//! this one), so the port keeps the TS's regular expressions, JavaScript's
//! notion of whitespace, `\d`, `\b` and `\w` (ASCII), `Math.round` (halves
//! up) and `Number#toString`. `app/tests/fixtures/svg/` is the shared corpus:
//! `<name>.out.svg` is what the TS makes of `<name>.svg`, and the tests here
//! hold this port to it.

use std::collections::HashMap;
use std::sync::LazyLock;

use regex::Regex;

/// The largest file taken as sent.
pub const RAW_MAX: usize = 200 * 1024;
/// The largest logo kept, once cleaned.
pub const CLEAN_MAX: usize = 48 * 1024;
/// The most shapes a kept logo may have.
pub const SHAPES_MAX: usize = 2_000;

/// JavaScript's `\s`: WhiteSpace and LineTerminator (not U+0085, which Rust's `\s` has).
const WS: &str = r"\t\n\x0B\x0C\r \x{A0}\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}\x{FEFF}";

fn is_js_ws(c: char) -> bool {
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

/// `String.prototype.trim`.
fn js_trim(s: &str) -> &str {
    s.trim_matches(is_js_ws)
}

fn re(p: &str) -> Regex {
    Regex::new(&p.replace("WS", WS)).expect("a valid pattern")
}

/// A literal name matched in any ASCII case (JavaScript's `i` flag without `u`).
fn any_case(name: &str) -> String {
    name.chars()
        .map(|c| {
            if c.is_ascii_alphabetic() {
                format!("[{}{}]", c.to_ascii_lowercase(), c.to_ascii_uppercase())
            } else {
                regex::escape(&c.to_string())
            }
        })
        .collect()
}

const SHAPES: &[(&str, &[&str])] = &[
    ("path", &["d", "fill-rule", "clip-rule"]),
    ("rect", &["x", "y", "width", "height", "rx", "ry"]),
    ("circle", &["cx", "cy", "r"]),
    ("ellipse", &["cx", "cy", "rx", "ry"]),
    ("polygon", &["points"]),
];

const DROP: &[&str] = &[
    "script",
    "style",
    "defs",
    "clipPath",
    "mask",
    "pattern",
    "symbol",
    "foreignObject",
    "metadata",
    "title",
    "desc",
    "linearGradient",
    "radialGradient",
    "filter",
    "marker",
    "a",
    "use",
    "image",
    "text",
];

/// Names a plain JavaScript object answers through its prototype: `SHAPES[name]`
/// is a function for these, and the TS throws iterating it. Kept so both refuse.
const PROTO_NAMES: &[&str] = &[
    "constructor",
    "hasOwnProperty",
    "isPrototypeOf",
    "propertyIsEnumerable",
    "toLocaleString",
    "toString",
    "valueOf",
];

static COMMENT: LazyLock<Regex> = LazyLock::new(|| re(r"<!--(?s:.)*?-->"));
static PI: LazyLock<Regex> = LazyLock::new(|| re(r"<\?(?s:.)*?\?>"));
static CDATA: LazyLock<Regex> = LazyLock::new(|| re(r"<!\[CDATA\[(?s:.)*?\]\]>"));
static DOCTYPE: LazyLock<Regex> = LazyLock::new(|| re(&format!("<!{}[^>]*>", any_case("DOCTYPE"))));
static DROPS: LazyLock<Vec<(Regex, Regex)>> = LazyLock::new(|| {
    DROP.iter()
        .map(|el| {
            let n = any_case(el);
            (
                re(&format!(r"<{n}(?-u:\b)[^>]*/>")),
                re(&format!(r"<{n}(?-u:\b)(?s:.)*?</{n}[WS]*>")),
            )
        })
        .collect()
});
static ROOT: LazyLock<Regex> =
    LazyLock::new(|| re(&format!(r"<{}(?-u:\b)[^>]*>", any_case("svg"))));
static TAG: LazyLock<Regex> = LazyLock::new(|| re(r"<(/?)([a-zA-Z]+)(?-u:\b)([^>]*?)(/?)>"));
static ATTR: LazyLock<Regex> =
    LazyLock::new(|| re(r#"([A-Za-z0-9_:-]+)[WS]*=[WS]*("([^"]*)"|'([^']*)')"#));
static NUM: LazyLock<Regex> =
    LazyLock::new(|| re(r"-?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][-+]?[0-9]+)?"));
static PATH_DATA: LazyLock<Regex> = LazyLock::new(|| re(r"^[MmLlHhVvCcSsQqTtAaZz0-9.,WS+eE-]*$"));
static POINTS: LazyLock<Regex> = LazyLock::new(|| re(r"^[0-9.,WS eE+-]*$"));
static PLAIN_NUM: LazyLock<Regex> = LazyLock::new(|| re(r"^-?(?:[0-9]+\.?[0-9]*|\.[0-9]+)$"));
static COLOUR: LazyLock<Regex> =
    LazyLock::new(|| re(r"^(#[0-9a-f]{3}|#[0-9a-f]{6}|black|white|none)$"));
static SPLIT_VB: LazyLock<Regex> = LazyLock::new(|| re(r"[WS,]+"));
static RUN_WS: LazyLock<Regex> = LazyLock::new(|| re(r"[WS]+"));
static DECIMAL: LazyLock<Regex> =
    LazyLock::new(|| re(r"^[+-]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$"));
static RECOLOUR: LazyLock<Regex> = LazyLock::new(|| re(r##"fill="#[0-9a-fA-F]{3,6}""##));

/// `Number(string)`.
fn js_number(s: &str) -> f64 {
    let t = js_trim(s);
    if t.is_empty() {
        return 0.0;
    }
    match t {
        "Infinity" | "+Infinity" => return f64::INFINITY,
        "-Infinity" => return f64::NEG_INFINITY,
        _ => {}
    }
    for (prefix, radix) in [
        ("0x", 16),
        ("0X", 16),
        ("0o", 8),
        ("0O", 8),
        ("0b", 2),
        ("0B", 2),
    ] {
        if let Some(digits) = t.strip_prefix(prefix) {
            if digits.is_empty() || !digits.chars().all(|c| c.is_digit(radix)) {
                return f64::NAN;
            }
            return digits.chars().fold(0.0, |n, c| {
                n * radix as f64 + c.to_digit(radix).unwrap() as f64
            });
        }
    }
    if !DECIMAL.is_match(t) {
        return f64::NAN;
    }
    t.parse().unwrap_or(f64::NAN)
}

/// `Math.round`: the nearest integer, halves toward +∞.
fn js_round(x: f64) -> f64 {
    if !x.is_finite() {
        return x;
    }
    let f = x.floor();
    if x - f >= 0.5 {
        f + 1.0
    } else {
        f
    }
}

/// `String(number)`.
fn js_string(v: f64) -> String {
    if v.is_nan() {
        return "NaN".into();
    }
    if v.is_infinite() {
        return if v > 0.0 { "Infinity" } else { "-Infinity" }.into();
    }
    if v == 0.0 {
        return "0".into();
    }
    let a = v.abs();
    if !(1e-6..1e21).contains(&a) {
        let e = format!("{v:e}");
        return match e.split_once('e') {
            Some((m, x)) if !x.starts_with('-') => format!("{m}e+{x}"),
            _ => e,
        };
    }
    format!("{v}")
}

fn round(n: &str) -> String {
    let v = js_round(js_number(n) * 100.0) / 100.0;
    if v == 0.0 {
        return "0".into();
    }
    js_string(v)
}

/// Numbers to two decimals, kept apart where rounding would run two together.
fn round_all(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = String::with_capacity(s.len());
    let mut last = 0;
    for m in NUM.find_iter(s) {
        out.push_str(&s[last..m.start()]);
        let v = round(m.as_str());
        let off = m.start();
        if off > 0
            && (bytes[off - 1].is_ascii_digit() || bytes[off - 1] == b'.')
            && !v.starts_with('-')
        {
            out.push(' ');
        }
        out.push_str(&v);
        last = m.end();
    }
    out.push_str(&s[last..]);
    js_trim(&RUN_WS.replace_all(&out, " ")).to_string()
}

fn attrs(tag: &str) -> HashMap<String, String> {
    let mut out = HashMap::new();
    for c in ATTR.captures_iter(tag) {
        let v = c.get(3).or_else(|| c.get(4)).map_or("", |m| m.as_str());
        out.insert(c[1].to_string(), v.to_string());
    }
    out
}

/// A colour the logo can carry; anything else (url(), currentColor, var()) is not kept.
fn colour_of(v: Option<&String>) -> Option<String> {
    let v = v.filter(|v| !v.is_empty())?;
    let c = js_trim(v).to_lowercase();
    if !COLOUR.is_match(&c) {
        return None;
    }
    Some(match c.as_str() {
        "black" => "#000000".into(),
        "white" => "#ffffff".into(),
        _ => c,
    })
}

/// Why the sanitiser would not make a logo of a file (the TS's messages).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Unusable(pub &'static str);

/// The TS's comment, PI, CDATA, DOCTYPE and dropped-element passes.
fn stripped(src: &str) -> String {
    let mut s = COMMENT.replace_all(src, "").into_owned();
    s = PI.replace_all(&s, "").into_owned();
    s = CDATA.replace_all(&s, "").into_owned();
    s = DOCTYPE.replace_all(&s, "").into_owned();
    for (selfclosing, pair) in DROPS.iter() {
        s = selfclosing.replace_all(&s, "").into_owned();
        s = pair.replace_all(&s, "").into_owned();
    }
    s
}

/// The logo's shapes and fills, flat, and how many shapes; refuses a file with
/// no `<svg>`, no viewBox or no shape to draw. Byte-identical to `sanitiseSvg`.
pub fn sanitise_counted(src: &str) -> Result<(String, usize), Unusable> {
    let s = stripped(src);
    let root = ROOT.find(&s).ok_or(Unusable("not an svg"))?;
    let ra = attrs(root.as_str());
    let vb_text = ra.get("viewBox").map_or("", String::as_str);
    let vb: Vec<f64> = SPLIT_VB.split(js_trim(vb_text)).map(js_number).collect();
    if vb.len() != 4 || vb.iter().any(|n| !n.is_finite()) {
        return Err(Unusable("svg has no viewBox"));
    }
    let root_fill = colour_of(ra.get("fill"));
    let mut shapes: Vec<String> = Vec::new();
    let mut stack: Vec<Option<String>> = Vec::new();
    for m in TAG.captures_iter(&s) {
        let close = !m[1].is_empty();
        let name = &m[2];
        let rest = &m[3];
        let selfclose = !m[4].is_empty();
        if name == "g" {
            if close {
                stack.pop();
            } else if !selfclose {
                stack.push(colour_of(attrs(rest).get("fill")));
            }
            continue;
        }
        let Some((_, allowed)) = SHAPES.iter().find(|(n, _)| *n == name) else {
            if !close && PROTO_NAMES.contains(&name) {
                return Err(Unusable("allowed is not iterable"));
            }
            continue;
        };
        if close {
            continue;
        }
        let a = attrs(rest);
        let inherited = stack
            .iter()
            .rev()
            .find_map(|f| f.clone())
            .or_else(|| root_fill.clone())
            .unwrap_or_else(|| "#000000".into());
        let fill = colour_of(a.get("fill")).unwrap_or(inherited);
        if fill == "none" {
            continue;
        }
        let mut parts: Vec<String> = Vec::new();
        for k in allowed.iter() {
            let Some(v) = a.get(*k) else { continue };
            match *k {
                "d" => {
                    if PATH_DATA.is_match(v) {
                        parts.push(format!("d=\"{}\"", round_all(v)));
                    }
                }
                "fill-rule" | "clip-rule" => {
                    if v == "evenodd" || v == "nonzero" {
                        parts.push(format!("{k}=\"{v}\""));
                    }
                }
                "points" => {
                    if POINTS.is_match(v) {
                        parts.push(format!("points=\"{}\"", round_all(v)));
                    }
                }
                _ => {
                    let t = js_trim(v);
                    if PLAIN_NUM.is_match(t) {
                        parts.push(format!("{k}=\"{}\"", round(t)));
                    }
                }
            }
        }
        if name == "path" && !parts.iter().any(|p| p.starts_with("d=")) {
            continue;
        }
        shapes.push(format!("<{name} fill=\"{fill}\" {}/>", parts.join(" ")));
    }
    if shapes.is_empty() {
        return Err(Unusable("svg has no shapes"));
    }
    let r: Vec<String> = vb.iter().map(|n| round(&js_string(*n))).collect();
    let (x, y, w, h) = (&r[0], &r[1], &r[2], &r[3]);
    Ok((
        format!(
            "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"{x} {y} {w} {h}\" width=\"{w}\" height=\"{h}\">{}</svg>",
            shapes.concat()
        ),
        shapes.len(),
    ))
}

/// `sanitiseSvg`: the logo's shapes and fills, flat.
pub fn sanitise_svg(src: &str) -> Result<String, Unusable> {
    sanitise_counted(src).map(|(s, _)| s)
}

/// `recolourSvg`: the same logo in one colour (a wordmark's copy for the other ground).
pub fn recolour_svg(svg: &str, fill: &str) -> String {
    let with = format!("fill=\"{}\"", fill.to_lowercase());
    RECOLOUR
        .replace_all(svg, regex::NoExpand(&with))
        .into_owned()
}

/// Something in a file that could run or reach out, and the line it is on.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Found {
    pub what: String,
    pub line: usize,
}

static A_TAG: LazyLock<Regex> = LazyLock::new(|| re(r"<([A-Za-z_][A-Za-z0-9_:.-]*)([^>]*)>"));
static ENTITY: LazyLock<Regex> = LazyLock::new(|| re(&format!("<!{}", any_case("ENTITY"))));
static DOCTYPE_OPEN: LazyLock<Regex> = LazyLock::new(|| re(&format!("<!{}", any_case("DOCTYPE"))));
static ON_ATTR: LazyLock<Regex> =
    LazyLock::new(|| re(r#"(?:^|[WS"'/])([oO][nN][A-Za-z][A-Za-z0-9_.:-]*)[WS]*="#));
static HREF: LazyLock<Regex> = LazyLock::new(|| {
    re(
        r#"(?:^|[WS"'/])(?:[A-Za-z0-9_.-]+:)?[hH][rR][eE][fF][WS]*=[WS]*(?:"([^"]*)"|'([^']*)'|([^WS>"']+))"#,
    )
});

fn line_at(src: &str, at: usize) -> usize {
    1 + src.as_bytes()[..at].iter().filter(|b| **b == b'\n').count()
}

/// Everything in `src` that could run or reach out: script and foreignObject
/// elements, `on*=` handlers, an href that is not `#local` (or is
/// `javascript:`), entity declarations and DOCTYPEs. Comments are not read
/// (the sanitiser deletes them, by the same rule); everything else is.
/// In the order they appear.
pub fn active_content(src: &str) -> Vec<Found> {
    // Comments blanked to spaces (newlines kept) so lines still count true.
    let text = COMMENT.replace_all(src, |c: &regex::Captures| {
        c[0].chars()
            .map(|ch| if ch == '\n' { '\n' } else { ' ' })
            .collect::<String>()
    });
    let mut found: Vec<(usize, String)> = Vec::new();
    for m in DOCTYPE_OPEN.find_iter(&text) {
        found.push((m.start(), "DOCTYPE".into()));
    }
    for m in ENTITY.find_iter(&text) {
        found.push((m.start(), "ENTITY declaration".into()));
    }
    for t in A_TAG.captures_iter(&text) {
        let at = t.get(0).unwrap().start();
        let name = &t[1];
        let local = name.rsplit(':').next().unwrap_or(name).to_ascii_lowercase();
        if local == "script" {
            found.push((at, "script".into()));
        } else if local == "foreignobject" {
            found.push((at, "foreignObject".into()));
        }
        let rest = t.get(2).unwrap();
        for a in ON_ATTR.captures_iter(rest.as_str()) {
            let g = a.get(1).unwrap();
            found.push((
                rest.start() + g.start(),
                format!("event handler {}", g.as_str()),
            ));
        }
        for h in HREF.captures_iter(rest.as_str()) {
            let v = h.get(1).or_else(|| h.get(2)).or_else(|| h.get(3)).unwrap();
            let plain: String = v
                .as_str()
                .chars()
                .filter(|c| !c.is_whitespace() && !c.is_control())
                .collect();
            let pos = rest.start() + h.get(0).unwrap().start();
            if plain.to_ascii_lowercase().starts_with("javascript:") {
                found.push((pos, "javascript: link".into()));
            } else if !plain.is_empty() && !plain.starts_with('#') {
                let shown: String = plain.chars().take(80).collect();
                found.push((pos, format!("external link {shown}")));
            }
        }
    }
    found.sort_by_key(|(at, _)| *at);
    found
        .into_iter()
        .map(|(at, what)| Found {
            what,
            line: line_at(&text, at),
        })
        .collect()
}

/// A logo the server will keep, with what cleaning took out.
#[derive(Debug, Clone)]
pub struct Cleaned {
    pub svg: String,
    pub shapes: usize,
    /// Elements in the file that are not kept (`defs`, `text`, `linearGradient`, ...), in order.
    pub dropped: Vec<String>,
    /// What may make the kept logo look different from the file.
    pub warnings: Vec<String>,
}

/// Why an upload was not kept.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Refused {
    /// Bigger than a limit: what, and the limit in bytes or shapes.
    TooBig(String),
    /// Active content, with where.
    Active(Vec<Found>),
    /// Not a logo the sanitiser can use (no viewBox, no shapes, not UTF-8).
    Unusable(String),
}

const KEPT: &[&str] = &["svg", "g", "path", "rect", "circle", "ellipse", "polygon"];

static ANY_TAG: LazyLock<Regex> = LazyLock::new(|| re(r"<([A-Za-z_][A-Za-z0-9_:.-]*)"));
static TRANSFORM: LazyLock<Regex> = LazyLock::new(|| re(r"[WS]transform[WS]*="));
static STROKE: LazyLock<Regex> =
    LazyLock::new(|| re(r#"[WS]stroke[WS]*=[WS]*["']([^"']*)["']|stroke[WS]*:[WS]*([^;"'}]*)"#));
static URL_FILL: LazyLock<Regex> = LazyLock::new(|| re(r#"fill[WS]*(?:=[WS]*["']|:)[WS]*url\("#));
static CLASS: LazyLock<Regex> = LazyLock::new(|| re(r"[WS]class[WS]*="));

fn notes(src: &str) -> (Vec<String>, Vec<String>) {
    let text = COMMENT.replace_all(src, "");
    let mut dropped: Vec<String> = Vec::new();
    for c in ANY_TAG.captures_iter(&text) {
        let n = &c[1];
        if !KEPT.contains(&n) && !dropped.iter().any(|d| d == n) {
            dropped.push(n.to_string());
        }
    }
    let mut warnings = Vec::new();
    if TRANSFORM.is_match(&text) {
        warnings.push("Transforms are dropped, so shapes in a moved or scaled group may shift. Flatten transforms before exporting.".to_string());
    }
    let stroked = STROKE.captures_iter(&text).any(|c| {
        let v = c
            .get(1)
            .or_else(|| c.get(2))
            .map_or("", |m| m.as_str())
            .trim();
        !v.is_empty() && v != "none"
    });
    if stroked {
        warnings.push("Strokes are dropped. Outline strokes before exporting.".to_string());
    }
    if dropped.iter().any(|d| d == "text" || d == "tspan") {
        warnings
            .push("Live text is dropped. Convert text to outlines before exporting.".to_string());
    }
    if URL_FILL.is_match(&text)
        || dropped
            .iter()
            .any(|d| d.ends_with("Gradient") || d == "pattern")
    {
        warnings.push("Gradient and pattern fills become flat colours.".to_string());
    }
    if CLASS.is_match(&text) && dropped.iter().any(|d| d == "style") {
        warnings.push("Fills set in a stylesheet (class=) are not read: those shapes take their group's fill, or black. Export with fills as attributes.".to_string());
    }
    (dropped, warnings)
}

/// An uploaded file to the logo kept: within [`RAW_MAX`], no active content,
/// sanitised, then within [`CLEAN_MAX`] and [`SHAPES_MAX`].
pub fn clean_upload(raw: &[u8]) -> Result<Cleaned, Refused> {
    if raw.len() > RAW_MAX {
        return Err(Refused::TooBig(format!(
            "The file is {} KB; logos up to {} KB are taken.",
            raw.len().div_ceil(1024),
            RAW_MAX / 1024
        )));
    }
    let src = std::str::from_utf8(raw).map_err(|_| {
        Refused::Unusable("The file is not text (UTF-8), so it is not an SVG.".into())
    })?;
    let found = active_content(src);
    if !found.is_empty() {
        return Err(Refused::Active(found));
    }
    let (svg, shapes) = sanitise_counted(src).map_err(|Unusable(why)| {
        Refused::Unusable(
            match why {
                "not an svg" => "This is not an SVG: there is no <svg> element.",
                "svg has no viewBox" => "The SVG has no viewBox, so it cannot be sized. Export it with a viewBox (artboard) set.",
                "svg has no shapes" => "The SVG has no shapes with a fill left once cleaned. Outline text and strokes, then export again.",
                _ => "The SVG could not be read.",
            }
            .to_string(),
        )
    })?;
    if svg.len() > CLEAN_MAX {
        return Err(Refused::TooBig(format!(
            "Cleaned, the logo is {} KB; up to {} KB is kept. Simplify the paths and export again.",
            svg.len().div_ceil(1024),
            CLEAN_MAX / 1024
        )));
    }
    if shapes > SHAPES_MAX {
        return Err(Refused::TooBig(format!(
            "The logo has {shapes} shapes; up to {SHAPES_MAX} are kept. Merge shapes and export again."
        )));
    }
    let (dropped, warnings) = notes(src);
    Ok(Cleaned {
        svg,
        shapes,
        dropped,
        warnings,
    })
}

/// `encodeURIComponent`.
pub fn encode_uri_component(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 3);
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&b) {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

/// A logo as the shell takes it: `data:image/svg+xml,` and the SVG, as palette.ts `svgUri` writes it.
pub fn svg_uri(svg: &str) -> String {
    format!("data:image/svg+xml,{}", encode_uri_component(svg))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numbers_print_and_round_as_javascript_does() {
        for (n, want) in [
            ("0.125", "0.13"),
            ("-0.125", "-0.12"),
            ("1.005", "1"),
            ("-0.001", "0"),
            ("1e2", "100"),
            ("1.5E-3", "0"),
            ("10.0", "10"),
            ("123456789.987654", "123456789.99"),
            ("1e25", "1e+25"),
            ("2.675", "2.68"),
        ] {
            assert_eq!(round(n), want, "{n}");
        }
        assert_eq!(js_number(""), 0.0);
        assert_eq!(js_number("0x10"), 16.0);
        assert!(js_number("inf").is_nan());
        assert!(js_number("1_0").is_nan());
        assert_eq!(js_string(0.1 + 0.2), "0.30000000000000004");
        assert_eq!(js_string(1.5e-7), "1.5e-7");
        assert_eq!(round_all("M.5.5.25"), "M0.5 0.5 0.25");
    }

    #[test]
    fn recolour_and_uri_match_the_shell() {
        assert_eq!(
            recolour_svg(
                r##"<path fill="#ABC" d="M0"/><rect fill="#000000"/>"##,
                "#FFFFFF"
            ),
            r##"<path fill="#ffffff" d="M0"/><rect fill="#ffffff"/>"##
        );
        assert_eq!(
            svg_uri("<a b='c'>#é"),
            "data:image/svg+xml,%3Ca%20b%3D'c'%3E%23%C3%A9"
        );
    }
}
