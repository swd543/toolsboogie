//! Unified data conversion: JSON / YAML / TOML / INI / XML to each other.
//!
//! Everything is normalized through `serde_json::Value` (insertion order
//! preserved via `preserve_order`), so the matrix is five parsers and five
//! renderers. Formats have honest limitations that surface as explicit
//! errors instead of silent data loss, controlled by the `nullPolicy`
//! option (fail / skip / emptyString):
//!
//! * **TOML and XML have no `null`** - by default converting a value that
//!   contains nulls fails and lists the offending key paths; `skip` drops
//!   the keys, `emptyString` writes them as empty strings.
//! * **INI is string-only and flat** - one level of sections, scalar values;
//!   arrays are rejected, deeper nesting is rejected with a message.
//! * **XML** uses an xml2js-style convention (`@` attributes, `#text`,
//!   empty element = null) - see `xml_data`.
//!
//! YAML output can deduplicate repeated blocks with anchors/merge keys
//! (`anchors: true`, the default) - see `anchor_yaml`.
//!
//! `detect_format` tries the strictest formats first (JSON, TOML, XML when
//! the text starts with `<`, INI only when a `[section]` header is
//! present, YAML last) and reports the first format that parses; the UI
//! always allows a manual override.

use crate::anchor_yaml;
use crate::xml_data;
use ini::Ini;
use serde::Serialize;
use serde_json::{Map, Value};
use wasm_bindgen::prelude::*;

const FORMATS: [&str; 5] = ["json", "yaml", "toml", "ini", "xml"];

/// How nulls are handled when rendering to a format that has no null.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum NullPolicy {
    Fail,
    Skip,
    EmptyString,
}

impl NullPolicy {
    fn parse(s: &str) -> Self {
        match s {
            "skip" => Self::Skip,
            "emptyString" | "empty_string" | "empty" => Self::EmptyString,
            _ => Self::Fail,
        }
    }
}

#[derive(Debug, Clone)]
struct Opts {
    /// JSON indentation in spaces (0 = minified).
    indent: u32,
    sort_keys: bool,
    /// YAML output: deduplicate repeated blocks with anchors/merge keys.
    anchors: bool,
    /// XML output: single-line (no indentation or newlines).
    minify: bool,
    null_policy: NullPolicy,
}

impl Default for Opts {
    fn default() -> Self {
        Opts {
            indent: 2,
            sort_keys: false,
            anchors: true,
            minify: false,
            null_policy: NullPolicy::Fail,
        }
    }
}

/// Parse the small per-target options object
/// (`{"indent":2,"sortKeys":true,"anchors":true,"minify":false,"nullPolicy":"fail"}`).
/// Defaults: 2-space indent, document key order, anchors on, nulls fail.
fn parse_opts(raw: &str) -> Opts {
    let v: Value = match serde_json::from_str(raw) {
        Ok(v) => v,
        Err(_) => return Opts::default(),
    };
    let indent = v
        .get("indent")
        .and_then(|x| x.as_u64())
        .unwrap_or(2)
        .min(8) as u32;
    let sort_keys = v
        .get("sortKeys")
        .or_else(|| v.get("sort_keys"))
        .and_then(|x| x.as_bool())
        .unwrap_or(false);
    let anchors = v
        .get("anchors")
        .and_then(|x| x.as_bool())
        .unwrap_or(true);
    let minify = v
        .get("minify")
        .and_then(|x| x.as_bool())
        .unwrap_or(false);
    let null_policy = v
        .get("nullPolicy")
        .or_else(|| v.get("null_policy"))
        .and_then(|x| x.as_str())
        .map(NullPolicy::parse)
        .unwrap_or(NullPolicy::Fail);
    Opts { indent, sort_keys, anchors, minify, null_policy }
}

/// First format that parses `input`, or an empty string when none do.
#[wasm_bindgen(js_name = detectFormat)]
pub fn detect_format(input: &str) -> String {
    let t = input.trim();
    if t.is_empty() {
        return String::new();
    }
    if serde_json::from_str::<Value>(t).is_ok() {
        return "json".into();
    }
    if toml::from_str::<toml::Value>(t).is_ok() {
        return "toml".into();
    }
    if t.starts_with('<') && xml_data::xml_to_value(t).is_ok() {
        return "xml".into();
    }
    let has_section_header = t
        .lines()
        .any(|l| {
            let s = l.trim();
            s.starts_with('[') && s.ends_with(']') && s.len() > 1
        });
    if has_section_header && Ini::load_from_str(t).is_ok() {
        return "ini".into();
    }
    if serde_yaml::from_str::<Value>(t).is_ok() {
        return "yaml".into();
    }
    String::new()
}

/// YAML 1.1 merge keys: a `<<` entry maps to a mapping, or a list of
/// mappings, whose keys are inherited where the node does not define its
/// own. Own keys win; within a list, earlier items win.
pub(crate) fn resolve_merge_keys(v: &mut Value) -> Result<(), String> {
    match v {
        Value::Object(m) => {
            for child in m.values_mut() {
                resolve_merge_keys(child)?;
            }
            if let Some(base) = m.remove("<<") {
                merge_into(m, base)?;
            }
            Ok(())
        }
        Value::Array(items) => {
            for child in items.iter_mut() {
                resolve_merge_keys(child)?;
            }
            Ok(())
        }
        _ => Ok(()),
    }
}

fn merge_into(target: &mut Map<String, Value>, base: Value) -> Result<(), String> {
    match base {
        Value::Object(map) => {
            merge_map(target, &map)
        }
        Value::Array(list) => {
            // earlier items win -> apply later ones first
            for item in list.iter().rev() {
                match item {
                    Value::Object(map) => merge_map(target, map)?,
                    other => {
                        return Err(format!(
                            "Invalid YAML merge key `<<`: expected a mapping or a list of mappings, got {other:?}."
                        ))
                    }
                }
            }
            Ok(())
        }
        other => Err(format!(
            "Invalid YAML merge key `<<`: expected a mapping or a list of mappings, got {other:?}."
        )),
    }
}

fn merge_map(target: &mut Map<String, Value>, base: &Map<String, Value>) -> Result<(), String> {
    for (k, val) in base {
        if !target.contains_key(k) {
            target.insert(k.clone(), val.clone());
        }
    }
    Ok(())
}

/// Parse one document into the shared JSON value tree.
fn parse_to_value(input: &str, from: &str) -> Result<Value, String> {
    match from {
        "json" => serde_json::from_str(input).map_err(|e| format!("Invalid JSON: {e}")),
        "yaml" => {
            let v: Value = serde_yaml::from_str(input).map_err(|e| {
                let msg = e.to_string();
                if msg.contains("more than one document") {
                    "Multi-document YAML is not supported - one document per file.".to_string()
                } else {
                    format!("Invalid YAML: {msg}")
                }
            })?;
            // serde_yaml resolves anchors/aliases but not merge keys; apply
            // YAML 1.1 `<<` semantics (own keys win, earlier list items win).
            let mut v = v;
            resolve_merge_keys(&mut v)?;
            Ok(v)
        },
        "toml" => {
            let v: toml::Value = toml::from_str(input).map_err(|e| format!("Invalid TOML: {e}"))?;
            toml_to_json(&v)
        }
        "ini" => {
            let ini = Ini::load_from_str(input).map_err(|e| format!("Invalid INI: {e}"))?;
            Ok(ini_to_json(&ini))
        }
        "xml" => xml_data::xml_to_value(input).map_err(|e| format!("Invalid XML: {e}")),
        other => Err(format!("Unknown source format: {other}")),
    }
}

/// TOML -> JSON. Dates are rendered as their textual form; everything else
/// maps 1:1.
fn toml_to_json(v: &toml::Value) -> Result<Value, String> {
    use toml::Value as T;
    Ok(match v {
        T::String(s) => Value::String(s.clone()),
        T::Integer(i) => Value::Number((*i).into()),
        T::Float(f) => serde_json::Number::from_f64(*f).map_or(Value::Null, Value::Number),
        T::Boolean(b) => Value::Bool(*b),
        T::Datetime(d) => Value::String(d.to_string()),
        T::Array(items) => {
            let mut out = Vec::with_capacity(items.len());
            for item in items {
                out.push(toml_to_json(item)?);
            }
            Value::Array(out)
        }
        T::Table(map) => {
            let mut m = Map::new();
            for (k, item) in map {
                m.insert(k.clone(), toml_to_json(item)?);
            }
            Value::Object(m)
        }
    })
}

/// INI -> JSON. The (section-less) general section becomes top-level keys;
/// every value is a string, exactly as INI stores it.
fn ini_to_json(ini: &Ini) -> Value {
    let mut m = Map::new();
    for (section, props) in ini.iter() {
        let section = section.unwrap_or_default();
        for (key, value) in props.iter() {
            let v = Value::String(value.to_string());
            if section.is_empty() {
                m.insert(key.to_string(), v);
            } else {
                let sec = m
                    .entry(section.to_string())
                    .or_insert_with(|| Value::Object(Map::new()));
                if let Value::Object(inner) = sec {
                    inner.insert(key.to_string(), v);
                }
            }
        }
    }
    Value::Object(m)
}

/// Recursively sort object keys (mirror of the JSON formatter behaviour).
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

fn render_json(value: &Value, opts: &Opts) -> Result<String, String> {
    if opts.indent == 0 {
        return serde_json::to_string(value).map_err(|e| e.to_string());
    }
    let mut buf: Vec<u8> = Vec::new();
    let indent_bytes = " ".repeat(opts.indent as usize).into_bytes();
    let formatter = serde_json::ser::PrettyFormatter::with_indent(&indent_bytes);
    let mut ser = serde_json::Serializer::with_formatter(&mut buf, formatter);
    value.serialize(&mut ser).map_err(|e| e.to_string())?;
    String::from_utf8(buf).map_err(|e| e.to_string())
}

/// Collect the JSON paths of every null (TOML cannot represent them).
fn null_paths(value: &Value, path: &str, out: &mut Vec<String>) {
    match value {
        Value::Null => out.push(path.to_string()),
        Value::Object(map) => {
            for (k, v) in map {
                null_paths(v, &format!("{path}.{k}"), out);
            }
        }
        Value::Array(items) => {
            for (i, v) in items.iter().enumerate() {
                null_paths(v, &format!("{path}[{i}]"), out);
            }
        }
        _ => {}
    }
}

/// JSON value -> TOML document. Null handling follows the caller's policy
/// (fail lists the key paths); a non-object top level is rejected (a TOML
/// document is a table).
fn render_toml(value: &Value, policy: NullPolicy) -> Result<String, String> {
    let value = apply_null_policy(value, policy)?;
    let t = json_to_toml(&value)?;
    toml::to_string(&t).map_err(|e| format!("TOML output error: {e}"))
}

/// Apply the null policy: `fail` validates, `skip` prunes, `emptyString`
/// substitutes empty strings. JSON/YAML keep nulls natively and ignore it.
fn apply_null_policy(value: &Value, policy: NullPolicy) -> Result<Value, String> {
    match policy {
        NullPolicy::Fail => {
            let mut nulls = Vec::new();
            null_paths(value, "$", &mut nulls);
            if !nulls.is_empty() {
                return Err(format!(
                    "The target format has no null value. Remove or replace: {}",
                    nulls.join(", ")
                ));
            }
            Ok(value.clone())
        }
        _ => Ok(strip_nulls(value, policy)),
    }
}

fn strip_nulls(v: &Value, policy: NullPolicy) -> Value {
    match v {
        Value::Object(m) => {
            let mut out: Map<String, Value> = Map::new();
            for (k, item) in m {
                let nv = strip_nulls(item, policy);
                if policy == NullPolicy::Skip && nv.is_null() {
                    continue;
                }
                out.insert(k.clone(), nv);
            }
            Value::Object(out)
        }
        Value::Array(items) => {
            let mut out = Vec::with_capacity(items.len());
            for item in items {
                let nv = strip_nulls(item, policy);
                if policy == NullPolicy::Skip && nv.is_null() {
                    continue;
                }
                out.push(nv);
            }
            Value::Array(out)
        }
        Value::Null if policy == NullPolicy::EmptyString => Value::String(String::new()),
        other => other.clone(),
    }
}

fn json_to_toml(v: &Value) -> Result<toml::Value, String> {
    use toml::Value as T;
    Ok(match v {
        Value::String(s) => T::String(s.clone()),
        Value::Bool(b) => T::Boolean(*b),
        Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                T::Integer(i)
            } else if let Some(u) = n.as_u64() {
                T::Integer(i64::try_from(u).map_err(|e| format!("Number too large for TOML: {e}"))?)
            } else {
                let f = n.as_f64().unwrap_or(0.0);
                if f.is_finite() {
                    T::Float(f)
                } else {
                    return Err("TOML has no NaN/Infinity value.".to_string());
                }
            }
        }
        Value::Array(items) => {
            let mut out = Vec::with_capacity(items.len());
            for item in items {
                out.push(json_to_toml(item)?);
            }
            T::Array(out)
        }
        Value::Object(map) => {
            let mut t = toml::Table::new();
            for (k, item) in map {
                t.insert(k.clone(), json_to_toml(item)?);
            }
            T::Table(t)
        }
        Value::Null => unreachable!("nulls are rejected before this point"),
    })
}

/// JSON value -> INI document. One level of sections, scalar values only.
fn render_ini(value: &Value, policy: NullPolicy) -> Result<String, String> {
    let value = apply_null_policy(value, policy)?;
    let root = value
        .as_object()
        .ok_or_else(|| "INI needs a top-level object (sections and key=value pairs).".to_string())?;
    let mut ini = Ini::new();
    for (key, v) in root {
        match v {
            Value::Object(inner) => {
                let mut section = ini.with_section(Some(key));
                for (k, item) in inner {
                    let s = scalar_text(item, &format!("[{key}] {k}"))?;
                    section.set(k, s.as_str());
                }
            }
            scalar => {
                let s = scalar_text(scalar, key)?;
                ini.with_general_section().set(key, s.as_str());
            }
        }
    }
    let mut buf: Vec<u8> = Vec::new();
    ini.write_to(&mut buf).map_err(|e| format!("INI output error: {e}"))?;
    String::from_utf8(buf).map_err(|e| e.to_string())
}

/// INI stores plain text: stringify scalars, reject arrays with the key.
/// (Nulls are handled by the caller's null policy before this runs.)
fn scalar_text(v: &Value, key: &str) -> Result<String, String> {
    Ok(match v {
        Value::String(s) => s.clone(),
        Value::Number(n) => n.to_string(),
        Value::Bool(b) => b.to_string(),
        Value::Null => return Err(format!("INI cannot store null at {key}.")),
        Value::Array(_) => return Err(format!("INI cannot store arrays at {key}.")),
        Value::Object(_) => {
            return Err(format!(
                "INI supports one level of sections; {key} is nested too deep."
            ))
        }
    })
}

/// Convert a document from one format to another.
///
/// `from`/`to` are `json`, `yaml`, `toml`, `ini` or `xml`; `options_json`
/// is a small JSON object
/// (`{"indent":2,"sortKeys":true,"anchors":true,"minify":false,"nullPolicy":"fail"}`)
/// with per-target options.
pub fn data_convert_core(input: &str, from: &str, to: &str, options_json: &str) -> Result<String, String> {
    if !FORMATS.contains(&from) || !FORMATS.contains(&to) {
        return Err(format!("Unknown format (expected one of: {FORMATS:?})."));
    }
    let value = parse_to_value(input, from)?;
    let opts = parse_opts(options_json);
    let value = if opts.sort_keys {
        let mut v = value;
        sort_in_place(&mut v);
        v
    } else {
        value
    };
    match to {
        "json" => render_json(&value, &opts),
        "yaml" => {
            if opts.anchors {
                Ok(anchor_yaml::emit(&value))
            } else {
                serde_yaml::to_string(&value).map_err(|e| format!("YAML output error: {e}"))
            }
        }
        "toml" => render_toml(&value, opts.null_policy),
        "ini" => render_ini(&value, opts.null_policy),
        "xml" => render_xml(&value, opts.null_policy, opts.minify),
        _ => Ok(String::new()),
    }
}

/// JSON value -> XML document; nulls follow the caller's policy.
fn render_xml(value: &Value, policy: NullPolicy, minify: bool) -> Result<String, String> {
    let value = apply_null_policy(value, policy)?;
    if minify {
        xml_data::value_to_xml_min(&value)
    } else {
        xml_data::value_to_xml(&value)
    }
}

/// WASM entry point for `data_convert_core`.
#[wasm_bindgen(js_name = dataConvert)]
pub fn data_convert(input: &str, from: &str, to: &str, options_json: &str) -> Result<String, JsError> {
    data_convert_core(input, from, to, options_json).map_err(|e| JsError::new(&e))
}

/// Parse-check one document without converting. `from` may be `"auto"`
/// (the format is detected first). Resolves to a one-line structure summary
/// ("object · 4 keys") when valid; rejects with the parse error otherwise.
pub fn validate_core(input: &str, from: &str) -> Result<String, String> {
    let from = if from == "auto" {
        let f = detect_format(input);
        if f.is_empty() {
            return Err("Could not detect a format. Pick one in the From menu.".to_string());
        }
        f
    } else {
        from.to_string()
    };
    let v = parse_to_value(input, &from)?;
    Ok(value_summary(&v))
}

/// WASM entry point for `validate_core`.
#[wasm_bindgen(js_name = validateData)]
pub fn validate_data(input: &str, from: &str) -> Result<String, JsError> {
    validate_core(input, from).map_err(|e| JsError::new(&e))
}

/// One-line shape of a parsed tree, for the validator readout.
fn value_summary(v: &Value) -> String {
    match v {
        Value::Object(m) => format!("object · {} keys", m.len()),
        Value::Array(items) => format!("array · {} items", items.len()),
        Value::Null => "null".to_string(),
        Value::String(_) => "string".to_string(),
        Value::Number(_) => "number".to_string(),
        Value::Bool(_) => "boolean".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn conv(input: &str, from: &str, to: &str) -> Result<String, String> {
        data_convert_core(input, from, to, "{}")
    }

    fn conv_opts(input: &str, from: &str, to: &str, opts: &str) -> Result<String, String> {
        data_convert_core(input, from, to, opts)
    }

    const JSON: &str = r#"{
  "app": "demo",
  "debug": false,
  "port": 8080,
  "db": { "host": "localhost", "pool": 5 },
  "features": ["alpha", "beta"]
}"#;

    #[test]
    fn json_to_yaml_and_back() {
        let y = conv(JSON, "json", "yaml").unwrap();
        assert!(y.contains("app: demo"));
        assert!(y.contains("port: 8080"));
        assert!(y.contains("- alpha"));
        let back = conv(&y, "yaml", "json").unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(&back).unwrap(),
            serde_json::from_str::<Value>(JSON).unwrap()
        );
    }
    #[test]
    fn json_to_toml() {
        let t = conv(JSON, "json", "toml").unwrap();
        assert!(t.contains("app = \"demo\""));
        assert!(t.contains("debug = false"));
        assert!(t.contains("port = 8080"));
        assert!(t.contains("[db]"));
        assert!(t.contains("host = \"localhost\""));
        assert!(t.contains("features = [\"alpha\", \"beta\"]"));
        let back = conv(&t, "toml", "json").unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(&back).unwrap(),
            serde_json::from_str::<Value>(JSON).unwrap()
        );
    }

    #[test]
    fn toml_dates_become_strings() {
        let t = "d = 1979-05-27T07:32:00Z\n";
        let j = conv(t, "toml", "json").unwrap();
        assert!(j.contains("1979-05-27T07:32:00Z"));
    }

    #[test]
    fn toml_null_is_rejected_with_paths() {
        let e = conv(r#"{"a": {"b": null}, "c": [null]}"#, "json", "toml").unwrap_err();
        assert!(e.contains("a.b"), "error lists paths: {e}");
        assert!(e.contains("c[0]"), "error lists paths: {e}");
    }

    #[test]
    fn toml_rejects_non_object_top_level() {
        assert!(conv("[1, 2]", "json", "toml").is_err());
        assert!(conv("\"hi\"", "json", "toml").is_err());
    }

    #[test]
    fn json_to_ini() {
        let input = r#"{"mode": "test", "db": {"host": "localhost", "port": 5432}}"#;
        let i = conv(input, "json", "ini").unwrap();
        assert!(i.contains("mode=test"));
        assert!(i.contains("[db]"));
        assert!(i.contains("host=localhost"));
        assert!(i.contains("port=5432"));
        let back = conv(&i, "ini", "json").unwrap();
        let v: Value = serde_json::from_str(&back).unwrap();
        assert_eq!(v["db"]["host"], "localhost");
        // INI values are strings by nature - the round-trip keeps them as such.
        assert_eq!(v["db"]["port"], "5432");
        assert_eq!(v["mode"], "test");
    }

    #[test]
    fn ini_rejects_arrays_nulls_and_deep_nesting() {
        assert!(conv(r#"{"a": [1]}"#, "json", "ini").is_err());
        assert!(conv(r#"{"a": null}"#, "json", "ini").is_err());
        assert!(conv(r#"{"a": {"b": {"c": 1}}}"#, "json", "ini").is_err());
        assert!(conv("[1, 2]", "json", "ini").is_err());
    }

    #[test]
    fn null_policy_skip_and_emptystring() {
        let input = r#"{"a": 1, "n": null, "o": {"keep": true, "gone": null}}"#;
        // skip: nulls and their keys disappear from targets that lack null
        let toml = conv_opts(input, "json", "toml", r#"{"nullPolicy":"skip"}"#).unwrap();
        assert!(!toml.contains("n"), "skip drops nulls: {toml}");
        assert!(!toml.contains("gone"), "skip drops nested nulls: {toml}");
        assert!(toml.contains("a = 1"));
        let ini = conv_opts(input, "json", "ini", r#"{"nullPolicy":"skip"}"#).unwrap();
        assert!(!ini.contains("n="), "skip in ini: {ini}");
        // emptyString: nulls become empty strings
        let toml = conv_opts(input, "json", "toml", r#"{"nullPolicy":"emptyString"}"#).unwrap();
        assert!(toml.contains("n = \"\""), "emptyString in toml: {toml}");
        // fail (default): still rejects with paths
        assert!(conv(input, "json", "toml").is_err());
        // JSON/YAML keep nulls regardless of policy
        let json = conv_opts(input, "json", "json", r#"{"nullPolicy":"skip"}"#).unwrap();
        assert!(json.contains("null"), "json keeps nulls: {json}");
        let y = conv_opts(input, "json", "yaml", r#"{"nullPolicy":"skip"}"#).unwrap();
        assert!(y.contains("null"), "yaml keeps nulls: {y}");
    }

    #[test]
    fn xml_round_trip_and_detect() {
        let xml = "<config id=\"c1\"><name>boogie</name><port>9000</port></config>";
        assert_eq!(detect_format(xml), "xml");
        let json = conv(xml, "xml", "json").unwrap();
        assert!(json.contains("\"@id\": \"c1\""), "attrs map to @: {json}");
        assert!(json.contains("boogie"));
        // back to XML (top-level object becomes the `root` element itself)
        let xml2 = conv(&json, "json", "xml").unwrap();
        assert!(xml2.contains("<root id=\"c1\">"), "round trip: {xml2}");
        // repeated children become arrays in JSON
        let xml3 = "<list><item>a</item><item>b</item></list>";
        let j3 = conv(xml3, "xml", "json").unwrap();
        assert!(j3.contains("[\"a\", \"b\"]") || (j3.contains("\"a\"") && j3.contains("\"b\"")), "array: {j3}");
    }

    #[test]
    fn full_matrix_each_format_to_each() {
        // A document that every format can represent: flat scalars + one section.
        let src = r#"{"name": "boogie", "on": true, "port": 9000, "db": {"host": "localhost"}}"#;
        let fmts = ["json", "yaml", "toml", "ini", "xml"];
        for f in fmts {
            let parsed = conv(src, "json", f).unwrap();
            assert!(!parsed.is_empty(), "{f} output empty");
            // and back to json, checking the scalar survives
            let back = conv(&parsed, f, "json").unwrap();
            let v: Value = serde_json::from_str(&back).unwrap();
            assert_eq!(v["name"], "boogie", "round trip through {f}");
            match f {
                // INI and XML store plain text; numbers come back as strings.
                "ini" | "xml" => assert_eq!(v["port"].as_str(), Some("9000"), "round trip through {f}"),
                _ => assert_eq!(v["port"], 9000, "round trip through {f}"),
            }
        }
    }

    #[test]
    fn yaml_to_ini_and_toml() {
        let y = "title: demo\nnested:\n  key: value\n";
        assert!(conv(y, "yaml", "toml").unwrap().contains("title = \"demo\""));
        assert!(conv(y, "yaml", "ini").unwrap().contains("title=demo"));
    }

    #[test]
    fn ini_to_yaml_and_toml() {
        let i = "[server]\nhost = localhost\nport = 8080\n";
        let y = conv(i, "ini", "yaml").unwrap();
        assert!(y.contains("host: localhost"));
        let t = conv(i, "ini", "toml").unwrap();
        assert!(t.contains("host = \"localhost\""));
    }

    #[test]
    fn detect_format_orders_strict_first() {
        assert_eq!(detect_format("{\"a\": 1}"), "json");
        assert_eq!(detect_format("a = 1\n[db]\nhost = \"x\"\n"), "toml");
        assert_eq!(detect_format("[db]\nhost = x y\n"), "ini"); // multi-word value is not TOML
        assert_eq!(detect_format("<root><a>1</a></root>"), "xml");
        assert_eq!(detect_format("a: 1\nb:\n  - x\n"), "yaml");
        assert_eq!(detect_format("hello"), "yaml"); // plain scalar
        assert_eq!(detect_format(""), "");
        assert_eq!(detect_format("{\n  oops: ["), "");
    }

    #[test]
    fn same_format_round_trip_validates() {
        assert!(conv(JSON, "json", "json").is_ok());
        assert!(conv("a: 1\n", "yaml", "yaml").is_ok());
        assert!(conv(JSON, "toml", "json").is_err()); // wrong source format
    }

    #[test]
    fn json_options_indent_and_sort() {
        let opts = r#"{"indent": 4, "sortKeys": true}"#;
        let out = data_convert_core(
            r#"{"b": 1, "a": {"y": 1, "x": [3, 1]}}"#,
            "json",
            "json",
            opts,
        )
        .unwrap();
        assert!(out.starts_with("{\n    \"a\""), "sorted + 4-space indent: {out}");
        assert!(out.contains("[\n            3"), "arrays indented too: {out}");
        let min = data_convert_core(r#"{"a": 1}"#, "json", "json", r#"{"indent": 0}"#).unwrap();
        assert_eq!(min, r#"{"a":1}"#);
    }

    #[test]
    fn yaml_anchors_are_dereferenced_in_every_output() {
        let y = "defaults: &d\n  host: localhost\n  port: 8080\nprod:\n  <<: *d\n  port: 9090\n";
        let json = conv(y, "yaml", "json").unwrap();
        assert!(json.contains("localhost"), "{json}");
        // The anchor/alias syntax must not leak into any output format.
        let toml = conv(y, "yaml", "toml").unwrap();
        assert!(toml.contains("[prod]"));
        assert!(!toml.contains('*'), "aliases leak: {toml}");
        let ini = conv(y, "yaml", "ini").unwrap();
        assert!(ini.contains("[prod]"));
        assert!(!ini.contains('*'), "aliases leak: {ini}");
        let yam = data_convert_core(y, "yaml", "yaml", r#"{"anchors": false}"#).unwrap();
        assert!(!yam.contains('*') && !yam.contains('&'), "aliases leak: {yam}");
        // Merged keys resolve: prod inherits host and keeps its own port.
        let v: Value = serde_json::from_str(&json).unwrap();
        assert_eq!(v["prod"]["host"], "localhost");
        assert_eq!(v["prod"]["port"], 9090);
    }

    #[test]
    fn sort_keys_applies_to_every_output_format() {
        let input = r#"{"b": 1, "a": {"y": 1, "x": 2}}"#;
        let opts = r#"{"sortKeys": true}"#;
        let yaml = data_convert_core(input, "json", "yaml", opts).unwrap();
        assert!(yaml.find("a:").unwrap() < yaml.find("b:").unwrap(), "{yaml}");
        let toml = data_convert_core(input, "json", "toml", opts).unwrap();
        // TOML puts scalar keys before table headers; inside the table, keys are sorted.
        assert!(toml.find("x =").unwrap() < toml.find("y =").unwrap(), "{toml}");
        let ini = data_convert_core(r#"{"z": {"b": 1, "a": 2}, "m": 3}"#, "json", "ini", opts).unwrap();
        assert!(ini.find("a=").unwrap() < ini.find("b=").unwrap(), "{ini}");
    }

    #[test]
    fn unknown_format_errors() {
        assert!(data_convert_core("{}", "json", "nope2", "{}").is_err());
        assert!(data_convert_core("{}", "nope", "json", "{}").is_err());
    }

    #[test]
    fn xml_minify_option_collapses_output() {
        let input = r#"{"app": "demo", "db": {"host": "localhost"}}"#;
        let pretty = data_convert_core(input, "json", "xml", "{}").unwrap();
        assert!(pretty.contains('\n'), "default xml is pretty: {pretty}");
        let min =
            data_convert_core(input, "json", "xml", r#"{"minify": true}"#).unwrap();
        assert!(!min.contains('\n'), "minified xml is one line: {min}");
        assert!(min.starts_with("<?xml"), "{min}");
        // both parse back to the same tree
        let a = xml_data::xml_to_value(&pretty).unwrap();
        let b = xml_data::xml_to_value(&min).unwrap();
        assert_eq!(a, b);
    }

    #[test]
    fn validate_reports_shape_or_error() {
        let ok = validate_core(r#"{"a": 1, "b": [1, 2]}"#, "json").unwrap();
        assert!(ok.starts_with("object"), "{ok}");
        assert!(validate_core("a: 1", "auto").is_ok(), "auto detects yaml");
        let bad = validate_core("{nope", "json").unwrap_err();
        assert!(bad.contains("Invalid JSON"), "bad: {bad}");
        let undetect = validate_core("a: b: c", "auto").unwrap_err();
        assert!(undetect.contains("Could not detect"), "undetect: {undetect}");
        assert!(validate_core("{}", "nope").is_err(), "unknown from format");
    }
}
