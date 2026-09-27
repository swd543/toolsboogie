//! YAML processing: format, and YAML ↔ JSON conversion.
//!
//! Built on `serde_yaml` (libyaml): parses full YAML 1.1 into a
//! `serde_json::Value` (insertion order preserved) and re-serializes.
//! Comments are not preserved — this is a formatter, not a comment-aware
//! editor (documented in the UI).

use serde_json::Value;
use wasm_bindgen::prelude::*;

fn map_err(e: serde_yaml::Error) -> String {
    let msg = e.to_string();
    // Multi-document input: libyaml stops at the first document; make the
    // limitation explicit instead of a cryptic mark error.
    if msg.contains("more than one document") {
        return "Multi-document YAML is not supported — one document per file.".to_string();
    }
    format!("Invalid YAML: {msg}")
}

fn parse_core(input: &str) -> Result<Value, String> {
    serde_yaml::from_str(input).map_err(map_err)
}

/// Re-format a YAML document (validates; output is 2-space block style).
#[wasm_bindgen(js_name = yamlFormat)]
pub fn yaml_format(input: &str) -> Result<String, JsError> {
    yaml_format_core(input).map_err(|e| JsError::new(&e))
}

fn yaml_format_core(input: &str) -> Result<String, String> {
    let value = parse_core(input)?;
    serde_yaml::to_string(&value).map_err(|e| e.to_string())
}

/// Convert a YAML document to pretty JSON.
#[wasm_bindgen(js_name = yamlToJson)]
pub fn yaml_to_json(input: &str) -> Result<String, JsError> {
    yaml_to_json_core(input).map_err(|e| JsError::new(&e))
}

fn yaml_to_json_core(input: &str) -> Result<String, String> {
    let value = parse_core(input)?;
    serde_json::to_string_pretty(&value).map_err(|e| e.to_string())
}

/// Convert JSON to YAML (pretty or minified JSON input).
#[wasm_bindgen(js_name = jsonToYaml)]
pub fn json_to_yaml(input: &str) -> Result<String, JsError> {
    json_to_yaml_core(input).map_err(|e| JsError::new(&e))
}

fn json_to_yaml_core(input: &str) -> Result<String, String> {
    let value: Value = serde_json::from_str(input)
        .map_err(|e| format!("Invalid JSON: {e}"))?;
    serde_yaml::to_string(&value).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn format_roundtrip() {
        let input = "name: boogie\nitems:\n  - one\n  - two\nnested:\n  a: 1\n";
        let out = yaml_format_core(input).unwrap();
        assert!(out.contains("name: boogie"));
        assert!(out.contains("a: 1"));
        // re-formatting stable output must not change it
        assert_eq!(yaml_format_core(&out).unwrap(), out);
    }

    #[test]
    fn yaml_to_json_converts() {
        let out = yaml_to_json_core("a: 1\nb:\n  c: true\nlist:\n  - x\n  - y\n").unwrap();
        let v: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["a"], 1);
        assert_eq!(v["b"]["c"], true);
        assert_eq!(v["list"][0], "x");
        assert_eq!(v["list"][1], "y");
    }

    #[test]
    fn json_to_yaml_converts() {
        let out = json_to_yaml_core(r#"{"a": 1, "list": ["x", "y"]}"#).unwrap();
        assert!(out.starts_with("a: 1"));
        assert!(out.contains("- x"));
        // and back again
        let back: Value = serde_json::from_str(&yaml_to_json_core(&out).unwrap()).unwrap();
        assert_eq!(back["a"], 1);
        assert_eq!(back["list"][1], "y");
    }

    #[test]
    fn error_is_friendly() {
        let err = yaml_format_core("a: [unclosed").unwrap_err();
        assert!(
            err.to_lowercase().contains("yaml"),
            "got: {err}"
        );
    }

    #[test]
    fn multi_document_is_rejected_clearly() {
        let err = yaml_format_core("a: 1\n---\nb: 2\n").unwrap_err();
        assert!(err.contains("Multi-document"), "got: {err}");
    }

    #[test]
    fn strings_stay_strings() {
        // YAML 1.1 quirks: plain scalars that look numeric become numbers,
        // quoted ones stay strings — the conversion must respect quoting.
        let out = yaml_to_json_core("n: 1\ns: \"1\"\n").unwrap();
        let v: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(v["n"], 1);
        assert_eq!(v["s"], "1");
    }
}
