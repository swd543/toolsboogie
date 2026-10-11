//! XML <-> JSON with an explicit, documented convention (xml2js-style).
//!
//! Parsing uses quick-xml (pull events, single root required); the serializer
//! is a small deterministic writer (stable indentation, XML-escaped values).
//!
//! XML -> JSON
//! * attributes -> `@name` keys
//! * an element with no attributes and no child elements -> its (trimmed)
//!   text as a plain string
//! * mixed text (element has attributes or children) -> `#text`
//! * repeated child tags -> arrays
//! * an empty element -> null
//! * namespaced tag names are kept verbatim (no namespace resolution)
//!
//! JSON -> XML
//! * a top-level object/arrays wraps in a `root` element (XML needs one)
//! * `@`-prefixed keys become attributes, `#text` becomes text content
//! * arrays repeat the parent element name per item
//! * nulls are handled by the caller's null policy before rendering
//! * element names must be valid XML names (letters, digits, `_-:.`)

use quick_xml::events::Event;
use quick_xml::reader::Reader;
use serde_json::{Map, Value};

struct Frame {
    attrs: Vec<(String, String)>,
    text: String,
    children: Vec<(String, Value)>,
}

impl Default for Frame {
    fn default() -> Self {
        Frame { attrs: Vec::new(), text: String::new(), children: Vec::new() }
    }
}

/// Parse an XML document into a JSON value tree (single root required).
pub fn xml_to_value(input: &str) -> Result<Value, String> {
    let mut reader = Reader::from_str(input);
    let mut buf: Vec<u8> = Vec::new();
    let mut stack: Vec<(String, Frame)> = Vec::new();
    let mut roots: Vec<Value> = Vec::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => {
                if stack.is_empty() && !roots.is_empty() {
                    return Err("XML must have a single root element.".to_string());
                }
                let name = tag_name(&e)?;
                let mut frame = Frame::default();
                for attr in e.attributes() {
                    let attr = attr.map_err(|err| format!("invalid XML attribute: {err}"))?;
                    let key = String::from_utf8_lossy(attr.key.into_inner()).to_string();
                    let val = String::from_utf8_lossy(attr.value.as_ref()).to_string();
                    frame.attrs.push((key, val));
                }
                stack.push((name, frame));
            }
            Ok(Event::End(_)) => {
                let (child_name, frame) =
                    stack.pop().ok_or_else(|| "Invalid XML: unexpected </...>.".to_string())?;
                let v = finalize_frame(frame);
                match stack.last_mut() {
                    Some((_, parent)) => parent.children.push((child_name, v)),
                    None => roots.push(v),
                }
            }
            Ok(Event::Empty(e)) => {
                let name = tag_name(&e)?;
                let mut frame = Frame::default();
                for attr in e.attributes() {
                    let attr = attr.map_err(|err| format!("invalid XML attribute: {err}"))?;
                    let key = String::from_utf8_lossy(attr.key.into_inner()).to_string();
                    let val = String::from_utf8_lossy(attr.value.as_ref()).to_string();
                    frame.attrs.push((key, val));
                }
                let v = finalize_frame(frame);
                match stack.last_mut() {
                    Some((_, parent)) => parent.children.push((name, v)),
                    None => roots.push(v),
                }
            }
            Ok(Event::Text(t)) => {
                if let Some((_, frame)) = stack.last_mut() {
                    let unescaped = t.unescape().map_err(|e| format!("invalid XML entity: {e}"))?;
                    frame.text.push_str(&unescaped);
                }
            }
            Ok(Event::CData(t)) => {
                if let Some((_, frame)) = stack.last_mut() {
                    frame.text.push_str(&String::from_utf8_lossy(&*t));
                }
            }
            Ok(Event::Eof) => break,
            // declarations, comments and PIs are ignored
            Ok(_) => {}
            Err(err) => return Err(format!("invalid XML: {err}")),
        }
        buf.clear();
    }

    if roots.len() != 1 {
        return Err("XML must have exactly one root element.".to_string());
    }
    Ok(roots.remove(0))
}

fn tag_name(e: &quick_xml::events::BytesStart) -> Result<String, String> {
    let name = String::from_utf8_lossy(e.name().into_inner()).to_string();
    if is_valid_name(&name) {
        Ok(name)
    } else {
        Err(format!("invalid XML tag name: {name}"))
    }
}

/// Fold a finished element into a value per the documented convention.
fn finalize_frame(frame: Frame) -> Value {
    let text = frame.text.trim();
    if frame.attrs.is_empty() && frame.children.is_empty() {
        return if text.is_empty() { Value::Null } else { Value::String(text.to_string()) };
    }
    let mut m: Map<String, Value> = Map::new();
    for (k, v) in frame.attrs {
        m.insert(format!("@{k}"), Value::String(v));
    }
    if !text.is_empty() {
        m.insert("#text".to_string(), Value::String(text.to_string()));
    }
    // repeated tags collapse into arrays, first-seen order preserved
    let mut grouped: Vec<(String, Vec<Value>)> = Vec::new();
    for (tag, v) in frame.children {
        if let Some(entry) = grouped.iter_mut().find(|(k, _)| *k == tag) {
            entry.1.push(v);
        } else {
            grouped.push((tag, vec![v]));
        }
    }
    for (tag, vals) in grouped {
        let v = if vals.len() == 1 {
            vals.into_iter().next().expect("one value")
        } else {
            Value::Array(vals)
        };
        m.insert(tag, v);
    }
    Value::Object(m)
}

/// Render a JSON value tree as an indented XML document.
pub fn value_to_xml(value: &Value) -> Result<String, String> {
    let mut out = String::from("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
    match value {
        Value::Object(m) => render_obj(&mut out, "root", m, 0)?,
        Value::Array(items) => {
            out.push_str("<root>\n");
            for item in items {
                render_node(&mut out, "item", item, 1)?;
            }
            out.push_str("</root>\n");
        }
        scalar => {
            let t = v_to_text(scalar)?;
            out.push_str(&format!("<root>{}</root>\n", esc(&t, false)));
        }
    }
    Ok(out)
}

/// Render a JSON value tree as a minified (single-line) XML document.
pub fn value_to_xml_min(value: &Value) -> Result<String, String> {
    // The pretty output is deterministic: every line is a complete fragment,
    // so stripping the indentation and newlines yields valid minified XML
    // without touching element text (only line-leading whitespace is removed).
    let pretty = value_to_xml(value)?;
    Ok(pretty.trim_end().split('\n').map(str::trim_start).collect())
}

fn render_node(out: &mut String, name: &str, v: &Value, depth: usize) -> Result<(), String> {
    if !is_valid_name(name) {
        return Err(format!("invalid XML element name: {name}"));
    }
    match v {
        Value::Object(m) => render_obj(out, name, m, depth),
        Value::Array(items) => {
            for item in items {
                render_node(out, name, item, depth)?;
            }
            Ok(())
        }
        scalar => {
            let pad = "  ".repeat(depth);
            let t = v_to_text(scalar)?;
            if t.is_empty() {
                out.push_str(&format!("{pad}<{name} />\n"));
            } else {
                out.push_str(&format!("{pad}<{name}>{}</{name}>\n", esc(&t, false)));
            }
            Ok(())
        }
    }
}

fn render_obj(out: &mut String, name: &str, m: &Map<String, Value>, depth: usize) -> Result<(), String> {
    let mut attrs: Vec<(String, String)> = Vec::new();
    let mut text: Option<String> = None;
    let mut children: Vec<(String, Value)> = Vec::new();
    for (k, v) in m {
        if let Some(a) = k.strip_prefix('@') {
            attrs.push((a.to_string(), v_to_text(v)?));
        } else if k == "#text" {
            text = Some(v_to_text(v)?);
        } else {
            children.push((k.clone(), v.clone()));
        }
    }
    let pad = "  ".repeat(depth);
    let attrs_s = attrs
        .iter()
        .map(|(k, v)| format!(" {}=\"{}\"", esc(k, true), esc(v, true)))
        .collect::<Vec<_>>()
        .join("");

    match (&text, children.is_empty()) {
        // no text, no children -> empty element
        (None, true) => {
            out.push_str(&format!("{pad}<{name}{attrs_s}/>\n"));
        }
        // text but no children -> one-line element
        (Some(t), true) => {
            out.push_str(&format!("{pad}<{name}{attrs_s}>{}</{name}>\n", esc(t, false)));
        }
        // text and/or children -> block element (text first)
        _ => {
            out.push_str(&format!("{pad}<{name}{attrs_s}>\n"));
            if let Some(t) = text {
                out.push_str(&format!("{}{}", "  ".repeat(depth + 1), esc(&t, false)));
                out.push('\n');
            }
            for (k, item) in children {
                render_node(out, &k, &item, depth + 1)?;
            }
            out.push_str(&format!("{pad}</{name}>\n"));
        }
    }
    Ok(())
}

fn v_to_text(v: &Value) -> Result<String, String> {
    match v {
        Value::String(s) => Ok(s.clone()),
        Value::Number(n) => Ok(n.to_string()),
        Value::Bool(b) => Ok(b.to_string()),
        Value::Null => Ok(String::new()),
        _ => Err("attributes and element text need scalar values.".to_string()),
    }
}

fn is_valid_name(s: &str) -> bool {
    let mut chars = s.chars();
    match chars.next() {
        Some(c) if c.is_ascii_alphabetic() || c == '_' || c == ':' => {}
        _ => return false,
    }
    chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.' | ':'))
}

/// XML-escape text; attribute values additionally escape quotes.
fn esc(s: &str, attr: bool) -> String {
    let mut o = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => o.push_str("&amp;"),
            '<' => o.push_str("&lt;"),
            '>' => o.push_str("&gt;"),
            '"' if attr => o.push_str("&quot;"),
            '\n' if attr => o.push_str("&#10;"),
            c => o.push(c),
        }
    }
    o
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_convention() {
        let xml = r#"<root id="1">
  <title>Hi</title>
  <item a="x">one</item>
  <item a="y">two</item>
  <empty/>
  <mixed>text <b>bold</b></mixed>
</root>"#;
        let v = xml_to_value(xml).unwrap();
        assert_eq!(v["@id"], "1");
        assert_eq!(v["title"], "Hi");
        assert_eq!(v["item"][0]["@a"], "x");
        assert_eq!(v["item"][0]["#text"], "one");
        assert_eq!(v["item"][1]["#text"], "two");
        assert!(v["empty"].is_null(), "empty element -> null: {v}");
        assert_eq!(v["mixed"]["#text"], "text");
        assert_eq!(v["mixed"]["b"], "bold");
    }

    #[test]
    fn parse_errors() {
        assert!(xml_to_value("").is_err());
        assert!(xml_to_value("<a></a><b></b>").is_err()); // two roots
        assert!(xml_to_value("<a></b>").is_err()); // mismatched
        assert!(xml_to_value("<a><b></a></b>").is_err()); // nesting
    }

    #[test]
    fn render_convention() {
        // The top-level object IS the root element: attrs on `root`, the rest inside.
        let v: Value = serde_json::json!({
            "@id": "7",
            "#text": "hello",
            "child": { "k": "v" },
            "list": [1, 2]
        });
        let out = value_to_xml(&v).unwrap();
        assert!(out.contains("<root id=\"7\">"), "{out}");
        assert!(out.contains("hello"), "{out}");
        assert!(out.contains("<k>v</k>"), "{out}");
        assert!(out.matches("<list>").count() == 2, "arrays repeat: {out}");
        // round-trips back to the same tree (numbers become strings, like INI)
        let back = xml_to_value(&out).unwrap();
        assert_eq!(back["@id"], "7");
        assert_eq!(back["#text"], "hello");
        assert_eq!(back["child"]["k"], "v");
        assert_eq!(back["list"], serde_json::json!(["1", "2"]));
    }

    #[test]
    fn escaping_roundtrips() {
        let v: Value = serde_json::json!({ "s": "a & b < c > d \" e" });
        let out = value_to_xml(&v).unwrap();
        assert!(!out.contains("a & b"), "{out}");
        let back = xml_to_value(&out).unwrap();
        assert_eq!(back["s"], "a & b < c > d \" e");
    }

    #[test]
    fn top_level_scalar_and_array_wrap_in_root() {
        let s = value_to_xml(&serde_json::json!(42)).unwrap();
        assert!(s.contains("<root>42</root>"), "{s}");
        let a = value_to_xml(&serde_json::json!([1, 2])).unwrap();
        assert!(a.contains("<item>1</item>"), "{a}");
    }

    #[test]
    fn invalid_names_are_rejected() {
        assert!(value_to_xml(&serde_json::json!({ "bad name": 1 })).is_err());
    }

    #[test]
    fn minify_collapses_to_one_line() {
        let v: Value = serde_json::json!({
            "@id": "7",
            "child": { "k": "v" },
            "list": [1, 2]
        });
        let pretty = value_to_xml(&v).unwrap();
        let min = value_to_xml_min(&v).unwrap();
        assert!(!min.contains('\n'), "minified xml must be one line: {min}");
        // minified is exactly the pretty output minus indentation/newlines
        let expect: String = pretty
            .trim_end()
            .split('\n')
            .map(str::trim_start)
            .collect();
        assert_eq!(min, expect, "minify must not alter content: {min}");
        // parses back to the same tree as the pretty output
        assert_eq!(xml_to_value(&min).unwrap(), xml_to_value(&pretty).unwrap());
    }
}
