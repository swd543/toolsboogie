//! JSON processing: format / minify with exact error positions.
//!
//! `serde_json` with the `preserve_order` feature keeps object keys in
//! document order; the optional `sort_keys` flag re-orders objects
//! alphabetically (recursively) before serializing.

use serde::Serialize;
use serde_json::{Map, Value};
use wasm_bindgen::prelude::*;

/// Recursively sort object keys (stable, by key string).
///
/// Works on both serde_json `Map` implementations (BTreeMap without
/// `preserve_order`, IndexMap with it) via the common trait surface.
fn sort_in_place(value: &mut Value) {
    match value {
        Value::Object(map) => {
            let keys: Vec<String> = map.keys().cloned().collect();
            let mut rest: Vec<(String, Value)> = keys
                .into_iter()
                .filter_map(|k| map.remove(&k).map(|v| (k, v)))
                .collect();
            rest.sort_by(|a, b| a.0.cmp(&b.0));
            let mut sorted = Map::new();
            for (k, mut v) in rest {
                sort_in_place(&mut v);
                sorted.insert(k, v);
            }
            *map = sorted;
        }
        Value::Array(items) => {
            for v in items.iter_mut() {
                sort_in_place(v);
            }
        }
        _ => {}
    }
}

/// Parse, pretty-print or minify. The host-testable core returns plain
/// `String` errors (the wasm wrapper maps them to `JsError`).
fn format_core(input: &str, indent: u32, sort_keys: bool) -> Result<String, String> {
    let mut value: Value = serde_json::from_str(input)
        .map_err(|e| format!("Invalid JSON: {e}"))?;
    if sort_keys {
        sort_in_place(&mut value);
    }
    if indent == 0 {
        return serde_json::to_string(&value).map_err(|e| e.to_string());
    }
    let mut buf: Vec<u8> = Vec::new();
    let indent_bytes = " ".repeat(indent as usize).into_bytes();
    let formatter = serde_json::ser::PrettyFormatter::with_indent(&indent_bytes);
    let mut ser = serde_json::Serializer::with_formatter(&mut buf, formatter);
    value.serialize(&mut ser).map_err(|e| e.to_string())?;
    String::from_utf8(buf).map_err(|e| e.to_string())
}

/// Pretty-print JSON. `indent` in spaces (0 = minified).
#[wasm_bindgen(js_name = jsonFormat)]
pub fn json_format(input: &str, indent: u32, sort_keys: bool) -> Result<String, JsError> {
    format_core(input, indent, sort_keys).map_err(|e| JsError::new(&e))
}

/// Compact one-line JSON (also validates).
#[wasm_bindgen(js_name = jsonMinify)]
pub fn json_minify(input: &str) -> Result<String, JsError> {
    format_core(input, 0, false).map_err(|e| JsError::new(&e))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pretty_preserves_key_order() {
        let out = json_format(r#"{"b":1,"a":{"y":2,"x":3}}"#, 2, false).unwrap();
        assert_eq!(out, "{\n  \"b\": 1,\n  \"a\": {\n    \"y\": 2,\n    \"x\": 3\n  }\n}");
    }

    #[test]
    fn pretty_sorts_keys_recursively() {
        let out = json_format(r#"{"b":1,"a":{"y":2,"x":[3, {"q":1,"p":0}]}}"#, 2, true).unwrap();
        assert_eq!(
            out,
            "{\n  \"a\": {\n    \"x\": [\n      3,\n      {\n        \"p\": 0,\n        \"q\": 1\n      }\n    ],\n    \"y\": 2\n  },\n  \"b\": 1\n}"
        );
    }

    #[test]
    fn minify_compacts() {
        assert_eq!(
            json_minify(r#"{"a" : [ 1 , 2 ]}"#).unwrap(),
            r#"{"a":[1,2]}"#
        );
    }

    #[test]
    fn error_carries_position() {
        let err = format_core("{\n  \"a\": ", 2, false).unwrap_err();
        assert!(
            err.contains("line 2"),
            "expected a positioned error, got: {err}"
        );
    }

    #[test]
    fn roundtrip_is_stable() {
        let input = r#"{"s":"ünïcode ✓", "n": -1.5e3, "null": null, "flag": true}"#;
        let once = format_core(input, 2, false).unwrap();
        let twice = format_core(&once, 2, false).unwrap();
        assert_eq!(once, twice);
    }
}
