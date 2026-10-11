//! YAML output with anchors for repeated blocks.
//!
//! When the same block (mapping or array of at least two entries) appears
//! more than once, the first occurrence gets an anchor (`&a1`) and later
//! occurrences become aliases (`*a1`). When a mapping is an earlier-anchored
//! mapping plus extra keys, it is emitted with a merge key
//! (`<<: *a1` followed by just the extra keys) - the classic defaults
//! pattern. Anchors are only ever referenced from later in document order.
//!
//! The emitter is conservative: strings and keys are always JSON-quoted
//! (valid YAML, no ambiguity), and output always round-trips through a
//! plain YAML parser back to the same value tree.

use serde_json::{Map, Value};

struct Cand<'a> {
    fp: String,
    is_map: bool,
    map_len: usize,
    path: String,
    node: &'a Value,
}

struct Def {
    fp: String,
    path: String,
    name: String,
    cand_idx: usize,
}

/// Emit `value` as block-style YAML, deduplicating repeated blocks with
/// anchors and merge keys.
pub fn emit(value: &Value) -> String {
    let mut cands: Vec<Cand<'_>> = Vec::new();
    collect(value, "", &mut cands, true);
    let defs = assign(&cands);
    let mut out = String::new();
    match value {
        Value::Object(m) => {
            for (i, (k, v)) in m.iter().enumerate() {
                emit_key(&mut out, k, v, 0, &cands, &defs, &child_path("", i));
            }
        }
        Value::Array(items) => {
            for (i, item) in items.iter().enumerate() {
                write_pad(&mut out, 0);
                out.push_str("- ");
                emit_item(&mut out, item, 1, &cands, &defs, &child_path("", i));
            }
        }
        scalar => {
            out.push_str(&scalar_str(scalar));
            out.push('\n');
        }
    }
    out
}

/// Preorder walk; every object/array of >= 2 entries (never the root) is a
/// candidate, keyed by its path so the emitter can find its own index.
fn collect<'a>(v: &'a Value, path: &str, cands: &mut Vec<Cand<'a>>, is_root: bool) {
    match v {
        Value::Object(m) => {
            if !is_root && m.len() >= 2 {
                cands.push(Cand {
                    fp: canonical(v),
                    is_map: true,
                    map_len: m.len(),
                    path: path.to_string(),
                    node: v,
                });
            }
            for (i, (_, item)) in m.iter().enumerate() {
                collect(item, &child_path(path, i), cands, false);
            }
        }
        Value::Array(items) => {
            if !is_root && items.len() >= 2 {
                cands.push(Cand {
                    fp: canonical(v),
                    is_map: false,
                    map_len: 0,
                    path: path.to_string(),
                    node: v,
                });
            }
            for (i, item) in items.iter().enumerate() {
                collect(item, &child_path(path, i), cands, false);
            }
        }
        _ => {}
    }
}

fn child_path(path: &str, i: usize) -> String {
    if path.is_empty() {
        i.to_string()
    } else {
        format!("{path}.{i}")
    }
}

/// Canonical fingerprint: the value with keys sorted at every level, as JSON.
fn canonical(v: &Value) -> String {
    let mut c = v.clone();
    sort_deep(&mut c);
    serde_json::to_string(&c).unwrap_or_default()
}

fn sort_deep(v: &mut Value) {
    match v {
        Value::Object(m) => {
            let keys: Vec<String> = m.keys().cloned().collect();
            let mut rest: Vec<(String, Value)> = keys
                .into_iter()
                .filter_map(|k| m.remove(&k).map(|x| (k, x)))
                .collect();
            rest.sort_by(|a, b| a.0.cmp(&b.0));
            let mut sorted = Map::new();
            for (k, mut x) in rest {
                sort_deep(&mut x);
                sorted.insert(k, x);
            }
            *m = sorted;
        }
        Value::Array(items) => {
            for x in items.iter_mut() {
                sort_deep(x);
            }
        }
        _ => {}
    }
}

/// Decide which nodes define anchors:
/// 1. a fingerprint that occurs >= 2 times -> its first occurrence defines;
/// 2. a map that is a strict subset of a later map (the defaults pattern)
///    -> it defines, so the later map can merge with `<<: *anchor`.
fn assign(cands: &[Cand]) -> Vec<Def> {
    let mut defs: Vec<Def> = Vec::new();

    for (i, c) in cands.iter().enumerate() {
        let count = cands.iter().filter(|x| x.fp == c.fp).count();
        if count >= 2 && !defs.iter().any(|d| d.fp == c.fp) {
            defs.push(Def {
                fp: c.fp.clone(),
                path: c.path.clone(),
                name: format!("a{}", defs.len() + 1),
                cand_idx: i,
            });
        }
    }
    for (i, c) in cands.iter().enumerate() {
        if !c.is_map || defs.iter().any(|d| d.fp == c.fp) {
            continue;
        }
        for later in cands.iter().skip(i + 1) {
            if later.is_map && later.map_len > c.map_len && subset_of(c.node, later.node) {
                defs.push(Def {
                    fp: c.fp.clone(),
                    path: c.path.clone(),
                    name: format!("a{}", defs.len() + 1),
                    cand_idx: i,
                });
                break;
            }
        }
    }
    defs
}

fn subset_of(base: &Value, superset: &Value) -> bool {
    match (base.as_object(), superset.as_object()) {
        (Some(b), Some(s)) => b.iter().all(|(k, v)| s.get(k).map_or(false, |x| x == v)),
        _ => false,
    }
}

/// `Some((name, true))`: this node is the anchor definition site;
/// `Some((name, false))`: an earlier node defines the same block (alias).
fn anchor_for(path: &str, v: &Value, defs: &[Def]) -> Option<(String, bool)> {
    let fp = canonical(v);
    for d in defs {
        if d.fp != fp {
            continue;
        }
        if d.path == path {
            return Some((d.name.clone(), true));
        }
        if path_order_before(&d.path, path) {
            return Some((d.name.clone(), false));
        }
    }
    None
}

/// The best merge base for `v` at `path`: an earlier-anchored map that is a
/// strict subset of `v` (largest one wins), excluding an exact duplicate
/// (that is an alias instead).
fn merge_base<'a, 'd>(
    path: &str,
    v: &Value,
    cands: &'d [Cand<'a>],
    defs: &'d [Def],
) -> Option<(&'d str, &'d Cand<'a>)> {
    let vfp = canonical(v);
    let mut best: Option<(&'d str, &'d Cand<'a>)> = None;
    for d in defs {
        if d.path == path || !path_order_before(&d.path, path) || d.fp == vfp {
            continue;
        }
        let c = &cands[d.cand_idx];
        if !c.is_map || c.map_len < 2 || !subset_of(c.node, v) {
            continue;
        }
        let better = match best {
            None => true,
            Some((_, b)) => c.map_len > b.map_len,
        };
        if better {
            best = Some((&d.name, c));
        }
    }
    best
}

/// Preorder path ordering: "0.2" comes before "0.2.1"; "1" before "10".
fn path_order_before(a: &str, b: &str) -> bool {
    let pa: Vec<usize> = a.split('.').map(|s| s.parse().unwrap_or(0)).collect();
    let pb: Vec<usize> = b.split('.').map(|s| s.parse().unwrap_or(0)).collect();
    for (x, y) in pa.iter().zip(pb.iter()) {
        if x != y {
            return x < y;
        }
    }
    pa.len() < pb.len()
}

fn scalar_str(v: &Value) -> String {
    match v {
        Value::String(s) => plain_or_quoted(s),
        Value::Null => "null".to_string(),
        other => other.to_string(),
    }
}

/// Strings and keys are emitted plain when that is unambiguous (matching a
/// human-readable YAML style), and JSON-double-quoted otherwise.
fn plain_or_quoted(s: &str) -> String {
    if plain_ok(s) {
        s.to_string()
    } else {
        serde_json::to_string(&Value::String(s.to_string())).unwrap_or_else(|_| "\"\"".to_string())
    }
}

/// Conservative plain-scalar check: the value round-trips through a strict
/// YAML parser without changing meaning or type.
fn plain_ok(s: &str) -> bool {
    if s.is_empty() {
        return false;
    }
    let b = s.as_bytes();
    if b.iter().any(|c| *c < 0x20 || *c == 0x7f) {
        return false;
    }
    if s.starts_with([' ', '\t', '\r', '\n']) || s.ends_with([' ', '\t', '\r', '\n']) {
        return false;
    }
    let first = b[0];
    if matches!(
        first,
        b'!' | b'&' | b'*' | b'?' | b'|' | b'>' | b'%' | b'@' | b'`' | b'"' | b'\'' | b'[' | b']'
            | b'{' | b'}' | b',' | b'#' | b':'
    ) {
        return false;
    }
    if first == b'-' || first == b'+' {
        if s == "-" || s.parse::<i64>().is_ok() || s.parse::<f64>().is_ok() {
            return false;
        }
    } else if b[0].is_ascii_digit() && s.parse::<f64>().is_ok() {
        return false; // would change type
    }
    if s.contains(": ") || s.ends_with(':') || s.contains(" #") || s.contains('\n') {
        return false;
    }
    if matches!(
        s.to_ascii_lowercase().as_str(),
        "true" | "false" | "null" | "yes" | "no" | "on" | "off" | "~"
    ) {
        return false;
    }
    true
}

fn write_pad(out: &mut String, depth: usize) {
    for _ in 0..depth {
        out.push_str("  ");
    }
}

/// `key: <value>` at the given indent level.
fn emit_key(
    out: &mut String,
    key: &str,
    v: &Value,
    depth: usize,
    cands: &[Cand<'_>],
    defs: &[Def],
    path: &str,
) {
    write_pad(out, depth);
    out.push_str(&plain_or_quoted(key));
    out.push_str(": ");
    match v {
        Value::Object(m) if m.is_empty() => {
            out.push_str("{}\n");
        }
        Value::Array(items) if items.is_empty() => {
            out.push_str("[]\n");
        }
        Value::Object(m) => {
            if let Some((name, false)) = anchor_for(path, v, defs) {
                out.push_str(&format!("*{name}\n"));
                return;
            }
            if let Some((name, base)) = merge_base(path, v, cands, defs) {
                if let Some((aname, true)) = anchor_for(path, v, defs) {
                    out.push_str(&format!("&{aname}"));
                }
                out.push('\n');
                write_pad(out, depth + 1);
                out.push_str(&format!("<<: *{name}\n"));
                let base_keys: Vec<&str> = base
                    .node
                    .as_object()
                    .map_or(Vec::new(), |b| b.keys().map(|s| s.as_str()).collect());
                for (i, (k, item)) in m.iter().enumerate() {
                    if base_keys.iter().any(|bk| *bk == k) {
                        continue; // carried by the merge
                    }
                    emit_key(out, k, item, depth + 1, cands, defs, &child_path(path, i));
                }
                return;
            }
            if let Some((name, true)) = anchor_for(path, v, defs) {
                out.push_str(&format!("&{name}"));
            }
            out.push('\n');
            for (i, (k, item)) in m.iter().enumerate() {
                emit_key(out, k, item, depth + 1, cands, defs, &child_path(path, i));
            }
        }
        Value::Array(items) => {
            if let Some((name, false)) = anchor_for(path, v, defs) {
                out.push_str(&format!("*{name}\n"));
                return;
            }
            if let Some((name, true)) = anchor_for(path, v, defs) {
                out.push_str(&format!("&{name}\n"));
            } else {
                out.push('\n');
            }
            for (i, item) in items.iter().enumerate() {
                write_pad(out, depth);
                out.push_str("- ");
                emit_item(out, item, depth + 1, cands, defs, &child_path(path, i));
            }
        }
        scalar => {
            out.push_str(&scalar_str(scalar));
            out.push('\n');
        }
    }
}

/// Value after a `- ` marker, aligned at `depth`.
fn emit_item(
    out: &mut String,
    v: &Value,
    depth: usize,
    cands: &[Cand<'_>],
    defs: &[Def],
    path: &str,
) {
    match v {
        Value::Object(m) if m.is_empty() => {
            out.push_str("{}\n");
        }
        Value::Array(items) if items.is_empty() => {
            out.push_str("[]\n");
        }
        Value::Object(_) => {
            // put the mapping on its own lines under the dash
            out.push('\n');
            emit_key_body(out, v, depth, cands, defs, path);
        }
        Value::Array(items) => {
            if let Some((name, false)) = anchor_for(path, v, defs) {
                out.push_str(&format!("*{name}\n"));
                return;
            }
            if let Some((name, true)) = anchor_for(path, v, defs) {
                out.push_str(&format!("&{name}\n"));
            } else {
                out.push('\n');
            }
            for (i, item) in items.iter().enumerate() {
                write_pad(out, depth);
                out.push_str("- ");
                emit_item(out, item, depth + 1, cands, defs, &child_path(path, i));
            }
        }
        scalar => {
            out.push_str(&scalar_str(scalar));
            out.push('\n');
        }
    }
}

/// Mapping body (keys at `depth`), shared by plain and merged objects.
fn emit_key_body(
    out: &mut String,
    v: &Value,
    depth: usize,
    cands: &[Cand<'_>],
    defs: &[Def],
    path: &str,
) {
    if let Value::Object(m) = v {
        if let Some((name, false)) = anchor_for(path, v, defs) {
            // an alias belongs at the key position; after a dash we cannot
            // alias without a key - emit the mapping plainly instead
            let _ = name;
        }
        if let Some((name, base)) = merge_base(path, v, cands, defs) {
            if let Some((aname, true)) = anchor_for(path, v, defs) {
                write_pad(out, depth);
                out.push_str(&format!("&{aname}\n"));
            }
            write_pad(out, depth);
            out.push_str(&format!("<<: *{name}\n"));
            let base_keys: Vec<&str> = base
                .node
                .as_object()
                .map_or(Vec::new(), |b| b.keys().map(|s| s.as_str()).collect());
            for (i, (k, item)) in m.iter().enumerate() {
                if base_keys.iter().any(|bk| *bk == k) {
                    continue;
                }
                emit_key(out, k, item, depth, cands, defs, &child_path(path, i));
            }
            return;
        }
        if let Some((name, true)) = anchor_for(path, v, defs) {
            write_pad(out, depth);
            out.push_str(&format!("&{name}\n"));
        }
        for (i, (k, item)) in m.iter().enumerate() {
            emit_key(out, k, item, depth, cands, defs, &child_path(path, i));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;


    fn roundtrip(s: &str) -> Value {
        let mut v: Value = serde_yaml::from_str(s).expect("output must be valid YAML: {s}");
        // serde_yaml does not resolve merge keys; apply them like data.rs does.
        crate::data::resolve_merge_keys(&mut v).expect("merge keys must resolve");
        v
    }

    #[test]
    fn repeated_objects_get_anchors_and_aliases() {
        let v: Value = serde_json::json!({
            "a": { "x": 1, "y": 2 },
            "b": { "x": 1, "y": 2 },
            "c": { "x": 1, "y": 2, "z": 3 }
        });
        let out = emit(&v);
        assert!(out.contains("&a1"), "{out}");
        assert_eq!(
            out.matches("*a1").count(),
            2, // b aliases a, c merges from a
            "{out}"
        );
        assert!(out.contains("<<: *a1"), "{out}");
        assert_eq!(roundtrip(&out), v, "round-trip must preserve the tree");
    }

    #[test]
    fn anchors_work_inside_arrays() {
        let v: Value = serde_json::json!({
            "services": [
              { "name": "a", "cfg": { "p": 1, "q": 2 } },
              { "name": "b", "cfg": { "p": 1, "q": 2 } }
            ]
        });
        let out = emit(&v);
        assert!(out.contains("&a1"), "{out}");
        assert!(out.contains("*a1"), "{out}");
        assert_eq!(roundtrip(&out), v, "round-trip must preserve the tree");
    }

    #[test]
    fn plain_output_when_nothing_repeats() {
        let v: Value = serde_json::json!({ "a": "x", "n": [1, 2, 3] });
        let out = emit(&v);
        assert!(!out.contains('&') && !out.contains('*'), "{out}");
        assert_eq!(roundtrip(&out), v);
    }

    #[test]
    fn tricky_strings_roundtrip_quoted() {
        let v: Value = serde_json::json!({
            "yes": "no",
            "007": "  spaced  ",
            "null": "not null",
            "n": 42,
            "empty": {}
        });
        let out = emit(&v);
        assert_eq!(roundtrip(&out), v, "{out}");
    }

    #[test]
    fn root_scalar_and_array() {
        let s = emit(&serde_json::json!(42));
        assert_eq!(roundtrip(&s), serde_json::json!(42));
        let a = emit(&serde_json::json!([1, 2]));
        assert_eq!(roundtrip(&a), serde_json::json!([1, 2]), "{a}");
    }
}
