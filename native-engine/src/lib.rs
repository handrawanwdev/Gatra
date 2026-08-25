//! Native Big Data engine for Gatra's `data<T>` primitive.
//!
//! Implements Phase 0 of `Automatic_Parallel_Execution.md` (§32.1):
//! row-based (`serde_json::Value` per row) parallel execution via a rayon
//! thread pool, still synchronous over N-API (Phase 1 is async — not done
//! here). Two operations whose arguments are fully structural (no arbitrary
//! JS closures crossing the FFI boundary) get this native path —
//! `.kelompok()` + `.agregat()` (group-by + aggregate) and the
//! "`.field OP literal`" shape of `.saring()`.
//!
//! FFI shape follows §10/§29.7 ("Plan Over Calls"): rows cross the boundary
//! once per call as a JSON batch, never per-row — `dataset.js` decides
//! *whether* to call in here at all (its own cost estimator keeps small
//! datasets on V8, since text-encode overhead isn't worth it below a few
//! thousand rows), and how many `workers` to request. `aggregate()`/
//! `filter_simple()` below are plain functions taking that row slice plus
//! a worker count — `cargo test` exercises them directly (see
//! `aggregate_matches_across_worker_counts`, the §25 semantic-guarantee
//! check), no N-API/Node involved.

#![deny(clippy::all)]

use napi::bindgen_prelude::*;
use napi_derive::napi;
use rayon::prelude::*;
use rayon::ThreadPoolBuilder;
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

/// Runs `f` inside a scoped rayon thread pool sized to `workers` (§12
/// Automatic Thread Pool). Falls back to running `f` on the calling thread
/// if the pool can't be built (e.g. `workers` conflicts with an
/// already-running global pool) — a worker-count hint is never allowed to
/// turn into a hard failure (§19: hint, not a guarantee).
pub fn run_with_pool<T: Send, F: FnOnce() -> T + Send>(workers: usize, f: F) -> T {
    match ThreadPoolBuilder::new().num_threads(workers.max(1)).build() {
        Ok(pool) => pool.install(f),
        Err(_) => f(),
    }
}

fn as_f64(v: &Value) -> Option<f64> {
    v.as_f64()
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

/// `.saring(.field OP literal)` fast path — partitioned across `workers`
/// rayon threads (§4 Scan → Partition → parallel filter → merge; the
/// "merge" here is just rayon's own `collect()` over the parallel
/// iterator).
pub fn filter_simple(rows: &[Value], desc: &FilterDesc, workers: usize) -> Vec<Value> {
    run_with_pool(workers, || {
        rows.par_iter()
            .filter(|row| {
                row.as_object()
                    .and_then(|o| o.get(&desc.field))
                    .map(|v| compare(v, &desc.value, &desc.op))
                    .unwrap_or(false)
            })
            .cloned()
            .collect()
    })
}

#[derive(Clone)]
struct NumAcc {
    sum: f64,
    count: u64,
    min: Option<f64>,
    max: Option<f64>,
}

impl NumAcc {
    fn new() -> Self {
        NumAcc { sum: 0.0, count: 0, min: None, max: None }
    }
    fn push(&mut self, v: f64) {
        self.sum += v;
        self.count += 1;
        self.min = Some(self.min.map_or(v, |m| m.min(v)));
        self.max = Some(self.max.map_or(v, |m| m.max(v)));
    }
    fn merge(&mut self, other: &NumAcc) {
        self.sum += other.sum;
        self.count += other.count;
        if let Some(m) = other.min {
            self.min = Some(self.min.map_or(m, |x| x.min(m)));
        }
        if let Some(m) = other.max {
            self.max = Some(self.max.map_or(m, |x| x.max(m)));
        }
    }
}

fn group_key(row: &Map<String, Value>, group_fields: &[String]) -> String {
    group_fields
        .iter()
        .map(|f| serde_json::to_string(row.get(f).unwrap_or(&Value::Null)).unwrap_or_default())
        .collect::<Vec<_>>()
        .join("\u{0}")
}

type GroupTable = BTreeMap<String, (Map<String, Value>, u64, Vec<NumAcc>)>;

/// One partition's local group-by (§4 "Local Aggregate") — never sees the
/// other partitions, so no locking/synchronization needed until the merge
/// step in `aggregate()`.
fn local_aggregate(rows: &[Value], group_fields: &[String], agg_fields: &[String]) -> GroupTable {
    let mut groups: GroupTable = BTreeMap::new();
    for row in rows {
        let Some(obj) = row.as_object() else { continue };
        let key = group_key(obj, group_fields);
        let entry = groups.entry(key).or_insert_with(|| {
            let key_row: Map<String, Value> = group_fields
                .iter()
                .map(|f| (f.clone(), obj.get(f).cloned().unwrap_or(Value::Null)))
                .collect();
            (key_row, 0, agg_fields.iter().map(|_| NumAcc::new()).collect())
        });
        entry.1 += 1;
        for (i, f) in agg_fields.iter().enumerate() {
            if let Some(v) = obj.get(f).and_then(as_f64) {
                entry.2[i].push(v);
            }
        }
    }
    groups
}

fn compute_from_acc(func: &str, count: u64, acc: Option<&NumAcc>) -> Value {
    match func {
        "hitung" => Value::from(count as f64),
        "jumlah" => Value::from(acc.map_or(0.0, |a| a.sum)),
        "rata_rata" => Value::from(acc.filter(|a| a.count > 0).map_or(0.0, |a| a.sum / a.count as f64)),
        "minimum" => acc.and_then(|a| a.min).map(Value::from).unwrap_or(Value::Null),
        "maksimum" => acc.and_then(|a| a.max).map(Value::from).unwrap_or(Value::Null),
        other => panic!("Fungsi agregat tidak dikenal: {other}"),
    }
}

/// Group `rows` by `group_fields` and compute `spec`'s aggregate functions
/// per group, split across `workers` rayon threads: §4/§11's
/// Scan → Partition → [local aggregate per core] → Merge → Result.
/// An empty `group_fields` means one global group.
pub fn aggregate(
    rows: &[Value],
    group_fields: &[String],
    spec: &BTreeMap<String, AggSpecEntry>,
    workers: usize,
) -> Vec<Value> {
    let mut agg_fields: Vec<String> = Vec::new();
    for agg in spec.values() {
        if let Some(f) = &agg.field {
            if !agg_fields.contains(f) {
                agg_fields.push(f.clone());
            }
        }
    }

    if rows.is_empty() {
        if group_fields.is_empty() {
            // Global aggregate over zero rows still yields exactly one group.
            let mut out = Map::new();
            for (name, agg) in spec {
                out.insert(name.clone(), compute_from_acc(&agg.func, 0, None));
            }
            return vec![Value::Object(out)];
        }
        return vec![];
    }

    let chunk_size = rows.len().div_ceil(workers.max(1)).max(1);
    let chunks: Vec<&[Value]> = rows.chunks(chunk_size).collect();

    let partials: Vec<GroupTable> = run_with_pool(workers, || {
        chunks
            .par_iter()
            .map(|chunk| local_aggregate(chunk, group_fields, &agg_fields))
            .collect()
    });

    let mut merged: GroupTable = BTreeMap::new();
    for partial in partials {
        for (key, (key_row, count, accs)) in partial {
            let entry = merged.entry(key).or_insert_with(|| {
                (key_row, 0, agg_fields.iter().map(|_| NumAcc::new()).collect())
            });
            entry.1 += count;
            for (i, a) in accs.iter().enumerate() {
                entry.2[i].merge(a);
            }
        }
    }

    merged
        .into_values()
        .map(|(key_row, count, accs)| {
            let mut out = key_row;
            for (name, agg) in spec {
                let acc = agg.field.as_ref().and_then(|f| {
                    agg_fields.iter().position(|x| x == f).map(|i| &accs[i])
                });
                out.insert(name.clone(), compute_from_acc(&agg.func, count, acc));
            }
            Value::Object(out)
        })
        .collect()
}

#[napi]
pub fn agregat_native(
    rows_json: String,
    group_fields_json: String,
    spec_json: String,
    workers: u32,
) -> Result<String> {
    let rows: Vec<Value> = serde_json::from_str(&rows_json)
        .map_err(|e| Error::from_reason(format!("rows_json invalid: {e}")))?;
    let group_fields: Vec<String> = serde_json::from_str(&group_fields_json)
        .map_err(|e| Error::from_reason(format!("group_fields_json invalid: {e}")))?;
    let spec: BTreeMap<String, AggSpecEntry> = serde_json::from_str(&spec_json)
        .map_err(|e| Error::from_reason(format!("spec_json invalid: {e}")))?;

    let out = aggregate(&rows, &group_fields, &spec, workers as usize);
    serde_json::to_string(&out).map_err(|e| Error::from_reason(format!("failed to serialize result: {e}")))
}

#[napi]
pub fn saring_native(rows_json: String, desc_json: String, workers: u32) -> Result<String> {
    let rows: Vec<Value> = serde_json::from_str(&rows_json)
        .map_err(|e| Error::from_reason(format!("rows_json invalid: {e}")))?;
    let desc: FilterDesc = serde_json::from_str(&desc_json)
        .map_err(|e| Error::from_reason(format!("desc_json invalid: {e}")))?;

    let out = filter_simple(&rows, &desc, workers as usize);
    serde_json::to_string(&out).map_err(|e| Error::from_reason(format!("failed to serialize result: {e}")))
}

/// Fused `.saring()` + `.kelompok()` + `.agregat()` — one N-API round trip
/// instead of two (`saring_native` then `agregat_native`), so the filtered
/// intermediate never leaves Rust to get re-stringified/re-parsed just to
/// come straight back in for the next call (§29.7 "Plan Over Calls").
/// `dataset.js` picks this path only when a `.saring()` is immediately
/// followed by `.kelompok()` + `.agregat()` in the op chain.
#[napi]
pub fn saring_agregat_native(
    rows_json: String,
    desc_json: String,
    group_fields_json: String,
    spec_json: String,
    workers: u32,
) -> Result<String> {
    let rows: Vec<Value> = serde_json::from_str(&rows_json)
        .map_err(|e| Error::from_reason(format!("rows_json invalid: {e}")))?;
    let desc: FilterDesc = serde_json::from_str(&desc_json)
        .map_err(|e| Error::from_reason(format!("desc_json invalid: {e}")))?;
    let group_fields: Vec<String> = serde_json::from_str(&group_fields_json)
        .map_err(|e| Error::from_reason(format!("group_fields_json invalid: {e}")))?;
    let spec: BTreeMap<String, AggSpecEntry> = serde_json::from_str(&spec_json)
        .map_err(|e| Error::from_reason(format!("spec_json invalid: {e}")))?;

    let filtered = filter_simple(&rows, &desc, workers as usize);
    let out = aggregate(&filtered, &group_fields, &spec, workers as usize);
    serde_json::to_string(&out).map_err(|e| Error::from_reason(format!("failed to serialize result: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn spec_hitung_jumlah_rata() -> BTreeMap<String, AggSpecEntry> {
        let mut spec = BTreeMap::new();
        spec.insert("total".to_string(), AggSpecEntry { func: "hitung".to_string(), field: None });
        spec.insert("pendapatan".to_string(), AggSpecEntry { func: "jumlah".to_string(), field: Some("jumlah".to_string()) });
        spec.insert("rata_rata".to_string(), AggSpecEntry { func: "rata_rata".to_string(), field: Some("jumlah".to_string()) });
        spec
    }

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

        let out = aggregate(&rows, &["negara".to_string()], &spec, 4);
        assert_eq!(out.len(), 2);
        let id = out.iter().find(|r| r["negara"] == "ID").unwrap();
        assert_eq!(id["total"].as_f64(), Some(2.0));
        assert_eq!(id["pendapatan"].as_f64(), Some(150.0));
    }

    #[test]
    fn filter_simple_gt() {
        let rows = vec![json!({ "jumlah": 100 }), json!({ "jumlah": -5 })];
        let desc = FilterDesc { field: "jumlah".to_string(), op: ">".to_string(), value: json!(0) };
        let out = filter_simple(&rows, &desc, 4);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0]["jumlah"], 100);
    }

    /// §25 Semantic Guarantee: partition count must never change the
    /// answer, only how it's computed.
    #[test]
    fn aggregate_matches_across_worker_counts() {
        let negara = ["ID", "US", "SG", "JP", "IN"];
        let rows: Vec<Value> = (0..50_000)
            .map(|i| {
                json!({
                    "negara": negara[i % negara.len()],
                    "jumlah": ((i * 37) % 1000) as f64 - 500.0,
                })
            })
            .collect();
        let spec = spec_hitung_jumlah_rata();

        let mut baseline: Vec<Value> = aggregate(&rows, &["negara".to_string()], &spec, 1);
        baseline.sort_by(|a, b| a["negara"].as_str().cmp(&b["negara"].as_str()));

        for workers in [2usize, 4, 8, 16] {
            let mut out = aggregate(&rows, &["negara".to_string()], &spec, workers);
            out.sort_by(|a, b| a["negara"].as_str().cmp(&b["negara"].as_str()));
            assert_eq!(out, baseline, "workers={workers} produced a different result than workers=1");
        }
    }

    /// §25 Semantic Guarantee, filter side.
    #[test]
    fn filter_matches_across_worker_counts() {
        let rows: Vec<Value> = (0..50_000).map(|i| json!({ "jumlah": (i % 200) as f64 - 100.0 })).collect();
        let desc = FilterDesc { field: "jumlah".to_string(), op: ">".to_string(), value: json!(0) };

        let baseline = filter_simple(&rows, &desc, 1);
        for workers in [2usize, 4, 8, 16] {
            assert_eq!(filter_simple(&rows, &desc, workers), baseline, "workers={workers} differed from workers=1");
        }
    }

    /// The fused saring+kelompok+agregat path (`saring_agregat_native`'s
    /// underlying logic) must equal calling `filter_simple()` then
    /// `aggregate()` separately — fusing the FFI calls must never change
    /// the answer, only how many round trips it takes to get there.
    #[test]
    fn filter_then_aggregate_matches_separate_calls() {
        let negara = ["ID", "US", "SG", "JP", "IN"];
        let rows: Vec<Value> = (0..20_000)
            .map(|i| {
                json!({
                    "negara": negara[i % negara.len()],
                    "jumlah": ((i * 13) % 1000) as f64 - 400.0,
                })
            })
            .collect();
        let desc = FilterDesc { field: "jumlah".to_string(), op: ">".to_string(), value: json!(0) };
        let spec = spec_hitung_jumlah_rata();

        let mut fused = {
            let filtered = filter_simple(&rows, &desc, 4);
            aggregate(&filtered, &["negara".to_string()], &spec, 4)
        };
        let mut separate = {
            let filtered = filter_simple(&rows, &desc, 1);
            aggregate(&filtered, &["negara".to_string()], &spec, 1)
        };
        fused.sort_by(|a, b| a["negara"].as_str().cmp(&b["negara"].as_str()));
        separate.sort_by(|a, b| a["negara"].as_str().cmp(&b["negara"].as_str()));
        assert_eq!(fused, separate);
    }
}
