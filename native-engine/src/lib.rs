//! Native Big Data engine for Gatra's `data<T>` primitive.
//!
//! MVP scope only: two operations whose arguments are fully structural (no
//! arbitrary JS closures crossing the N-API boundary) get a native fast
//! path — `.kelompok()` + `.agregat()` (group-by + aggregate) and the
//! "`.field OP literal`" shape of `.saring()`. Everything else (arbitrary
//! predicates, `.ubah()` transforms, `.gabung()` conditions) stays JS-only,
//! since those compile to real closures Rust can't execute.
//!
//! Rows cross the boundary as JSON strings rather than mapped napi types —
//! simplest possible ABI for a heterogeneous, schema-erased `data<T>` row,
//! and it keeps this crate a plain function library (see `aggregate`/
//! `filter_simple` below) that `cargo test` can exercise directly without
//! going through N-API or Node at all.

#![deny(clippy::all)]

use napi::bindgen_prelude::*;
use napi_derive::napi;
use serde_json::{Map, Value};
use std::collections::BTreeMap;

#[derive(serde::Deserialize)]
pub struct AggSpecEntry {
    #[serde(rename = "fn")]
    func: String,
    field: Option<String>,
}

#[derive(serde::Deserialize)]
pub struct FilterDesc {
    field: String,
    op: String,
    value: Value,
}

fn group_key(row: &Map<String, Value>, group_fields: &[String]) -> String {
    group_fields
        .iter()
        .map(|f| serde_json::to_string(row.get(f).unwrap_or(&Value::Null)).unwrap_or_default())
        .collect::<Vec<_>>()
        .join("\u{0}")
}

fn as_f64(v: &Value) -> Option<f64> {
    v.as_f64()
}

fn compute_agg(func: &str, field: Option<&str>, rows: &[&Map<String, Value>]) -> Value {
    let vals: Vec<f64> = match field {
        Some(f) => rows
            .iter()
            .filter_map(|r| r.get(f).and_then(as_f64))
            .collect(),
        None => Vec::new(),
    };
    match func {
        "hitung" => Value::from(rows.len() as f64),
        "jumlah" => Value::from(vals.iter().sum::<f64>()),
        "rata_rata" => {
            if vals.is_empty() {
                Value::from(0.0)
            } else {
                Value::from(vals.iter().sum::<f64>() / vals.len() as f64)
            }
        }
        "minimum" => vals
            .iter()
            .cloned()
            .fold(None, |acc: Option<f64>, x| Some(acc.map_or(x, |a| a.min(x))))
            .map(Value::from)
            .unwrap_or(Value::Null),
        "maksimum" => vals
            .iter()
            .cloned()
            .fold(None, |acc: Option<f64>, x| Some(acc.map_or(x, |a| a.max(x))))
            .map(Value::from)
            .unwrap_or(Value::Null),
        other => panic!("Fungsi agregat tidak dikenal: {other}"),
    }
}

/// Group `rows` by `group_fields` and compute `spec`'s aggregate functions
/// per group (`hitung`/`jumlah`/`rata_rata`/`minimum`/`maksimum` —
/// An empty `group_fields` means one global group.
pub fn aggregate(rows: &[Value], group_fields: &[String], spec: &BTreeMap<String, AggSpecEntry>) -> Vec<Value> {
    let mut groups: BTreeMap<String, (Map<String, Value>, Vec<&Map<String, Value>>)> = BTreeMap::new();

    let row_objs: Vec<&Map<String, Value>> = rows.iter().filter_map(|r| r.as_object()).collect();

    if row_objs.is_empty() && group_fields.is_empty() {
        // Global aggregate over zero rows still yields exactly one group.
        groups.insert(String::new(), (Map::new(), Vec::new()));
    }

    for row in &row_objs {
        let key = group_key(row, group_fields);
        let entry = groups.entry(key).or_insert_with(|| {
            let key_row: Map<String, Value> = group_fields
                .iter()
                .map(|f| (f.clone(), row.get(f).cloned().unwrap_or(Value::Null)))
                .collect();
            (key_row, Vec::new())
        });
        entry.1.push(row);
    }

    groups
        .into_values()
        .map(|(key_row, group_rows)| {
            let mut out = key_row;
            for (name, agg) in spec {
                out.insert(
                    name.clone(),
                    compute_agg(&agg.func, agg.field.as_deref(), &group_rows),
                );
            }
            Value::Object(out)
        })
        .collect()
}

fn compare(a: &Value, b: &Value, op: &str) -> bool {
    let ord = if let (Some(x), Some(y)) = (a.as_f64(), b.as_f64()) {
        x.partial_cmp(&y)
    } else if let (Some(x), Some(y)) = (a.as_str(), b.as_str()) {
        Some(x.cmp(y))
    } else {
        None
    };

    match op {
        "==" => a == b,
        "!=" => a != b,
        ">" => matches!(ord, Some(std::cmp::Ordering::Greater)),
        "<" => matches!(ord, Some(std::cmp::Ordering::Less)),
        ">=" => matches!(ord, Some(std::cmp::Ordering::Greater) | Some(std::cmp::Ordering::Equal)),
        "<=" => matches!(ord, Some(std::cmp::Ordering::Less) | Some(std::cmp::Ordering::Equal)),
        other => panic!("Operator tidak dikenal: {other}"),
    }
}

/// `.saring(.field OP literal)` fast path
pub fn filter_simple(rows: &[Value], desc: &FilterDesc) -> Vec<Value> {
    rows.iter()
        .filter(|row| {
            row.as_object()
                .and_then(|o| o.get(&desc.field))
                .map(|v| compare(v, &desc.value, &desc.op))
                .unwrap_or(false)
        })
        .cloned()
        .collect()
}

#[napi]
pub fn agregat_native(rows_json: String, group_fields_json: String, spec_json: String) -> Result<String> {
    let rows: Vec<Value> = serde_json::from_str(&rows_json)
        .map_err(|e| Error::from_reason(format!("rows_json invalid: {e}")))?;
    let group_fields: Vec<String> = serde_json::from_str(&group_fields_json)
        .map_err(|e| Error::from_reason(format!("group_fields_json invalid: {e}")))?;
    let spec: BTreeMap<String, AggSpecEntry> = serde_json::from_str(&spec_json)
        .map_err(|e| Error::from_reason(format!("spec_json invalid: {e}")))?;

    let out = aggregate(&rows, &group_fields, &spec);
    serde_json::to_string(&out).map_err(|e| Error::from_reason(format!("failed to serialize result: {e}")))
}

#[napi]
pub fn saring_native(rows_json: String, desc_json: String) -> Result<String> {
    let rows: Vec<Value> = serde_json::from_str(&rows_json)
        .map_err(|e| Error::from_reason(format!("rows_json invalid: {e}")))?;
    let desc: FilterDesc = serde_json::from_str(&desc_json)
        .map_err(|e| Error::from_reason(format!("desc_json invalid: {e}")))?;

    let out = filter_simple(&rows, &desc);
    serde_json::to_string(&out).map_err(|e| Error::from_reason(format!("failed to serialize result: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn aggregate_groups_and_sums() {
        let rows = vec![
            json!({ "negara": "ID", "jumlah": 100 }),
            json!({ "negara": "ID", "jumlah": 50 }),
            json!({ "negara": "US", "jumlah": 10 }),
        ];
        let mut spec = BTreeMap::new();
        spec.insert("total".to_string(), AggSpecEntry { func: "hitung".to_string(), field: None });
        spec.insert("pendapatan".to_string(), AggSpecEntry { func: "jumlah".to_string(), field: Some("jumlah".to_string()) });

        let out = aggregate(&rows, &["negara".to_string()], &spec);
        assert_eq!(out.len(), 2);
        let id = out.iter().find(|r| r["negara"] == "ID").unwrap();
        assert_eq!(id["total"].as_f64(), Some(2.0));
        assert_eq!(id["pendapatan"].as_f64(), Some(150.0));
    }

    #[test]
    fn filter_simple_gt() {
        let rows = vec![json!({ "jumlah": 100 }), json!({ "jumlah": -5 })];
        let desc = FilterDesc { field: "jumlah".to_string(), op: ">".to_string(), value: json!(0) };
        let out = filter_simple(&rows, &desc);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0]["jumlah"], 100);
    }
}
