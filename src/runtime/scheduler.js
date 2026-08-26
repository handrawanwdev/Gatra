'use strict';

// Automatic Concurrency runtime (Automatic_Concurrency.md) — Phase 0: bounded
// worker pool + adaptive cost-based dispatch for `fungsi paralel` functions.
// No ownership/move-checking and no matching-engine single-owner model yet
// (both deferred — see the doc's own phased framing). What IS real here:
//
//   - Every call to a `paralel` fn goes through jalankan() below, which
//     decides Event Loop vs Worker Pool per call, based on that function's
//     own recent execution history (§3 Cost-Based Scheduler, §4 Adaptive
//     Runtime Profiling) — cold calls run inline; once the running average
//     crosses THRESHOLD_MS, later calls escalate to a worker, and if the
//     average drops back down, calls demote back to inline (reversible,
//     re-evaluated every call — no separate "mode" to get stuck in).
//   - The worker pool is bounded by CPU core count (§5) and workers are
//     reused, never one-thread-per-call (spawnWorker() below only runs when
//     the pool has room; runTask()/drainQueue() reuse free workers).
//   - The task queue in front of the pool is bounded too (§6 Backpressure);
//     once it's full, the task just runs inline instead of blocking or
//     growing unboundedly — a scheduling-path failure is never allowed to
//     become a correctness failure, only a missed optimization (same
//     philosophy as native-engine's old data<T> fallback: the fast path is
//     load-bearing for speed, never for correctness).
//
// How a worker actually runs the function: codegen (see codegen.js's
// `parallelFns` handling) makes the *whole compiled program* re-run inside
// each worker via `new Worker(modulePath)` — real workers require a real
// file on disk, which is why cli/gatra.js routes any program using
// `paralel` through a temp-file + subprocess run instead of the normal
// in-process vm.Script path (vm.Script parses as a script, not a function
// body, so the top-level `if (!isMainThread) { ...; return; }` guard the
// codegen emits — needed to skip the program's own main-thread side effects
// inside the worker — would be a syntax error there; a real required/spawned
// file wraps the module in a function, where a top-level `return` is legal).
// Only *function* declarations are reachable that way (JS fully hoists
// `function` — unlike `let`/`class` — so they're callable even though the
// worker returns before "reaching" their textual line), which is why a
// `paralel` fn must stick to its own parameters and other top-level
// functions/plain-data structs — never another top-level `isi` binding.

const os = require('os');
const { Worker } = require('worker_threads');

const MAX_WORKERS   = Math.max(1, Math.min(os.cpus().length, 8));
const MAX_QUEUE      = MAX_WORKERS * 2;
const THRESHOLD_MS   = 15;   // §4 example: ~2-4ms stays on the Event Loop, ~90-120ms escalates
const MIN_SAMPLES    = 2;    // don't escalate off a single cold-start sample
const EMA_ALPHA      = 0.5;  // recent runs matter more, but one outlier can't flip the decision alone

// '${modulePath}::${fnName}' -> { count, avgMs }. Keying by function name
// alone used to let two unrelated 'fungsi paralel' declarations that happen
// to share a name — in different files — silently pollute each other's cost
// history: a cheap function co-located (by name only) with an expensive one
// could get escalated to the Worker Pool it never earned, or vice versa. The
// module path is already threaded through every call site for pool lookup
// (getPool() below) — reusing it here as part of the stats key costs
// nothing and makes each 'paralel' function's history genuinely its own.
const stats = new Map();

function now() { return Number(process.hrtime.bigint() / 1000000n); }

function statKey(modulePath, fnName) { return `${modulePath}::${fnName}`; }

function getStats(key) {
  let s = stats.get(key);
  if (!s) { s = { count: 0, avgMs: 0 }; stats.set(key, s); }
  return s;
}

function recordDuration(key, ms) {
  const s = getStats(key);
  s.avgMs = s.count === 0 ? ms : (EMA_ALPHA * ms + (1 - EMA_ALPHA) * s.avgMs);
  s.count++;
}

function shouldUseWorker(key) {
  const s = getStats(key);
  return s.count >= MIN_SAMPLES && s.avgMs > THRESHOLD_MS;
}

// Any failure to actually get a worker to run the task (queue full, worker
// crashed, args weren't structured-cloneable, ...) — jalankan() catches
// exactly this type and falls back to running inline. A rejection that is
// NOT this type is the function's own thrown error, relayed from the worker,
// and must propagate for real.
class WorkerDispatchError extends Error {}

const pools = new Map(); // modulePath -> pool

function getPool(modulePath) {
  let pool = pools.get(modulePath);
  if (!pool) {
    pool = { workers: [], free: [], queue: [], nextMsgId: 1, pending: new Map() };
    pools.set(modulePath, pool);
  }
  return pool;
}

function spawnWorker(modulePath, pool) {
  const worker = new Worker(modulePath);
  worker.on('message', (msg) => {
    const task = pool.pending.get(msg.id);
    pool.pending.delete(msg.id);
    worker.__gatraPendingId = null;
    pool.free.push(worker);
    // Idle again — let the process exit on this worker's account once
    // nothing else (including any in-flight 'jalankan' await) is keeping it
    // alive. runTask() ref()s it right back the moment it's given new work.
    worker.unref();
    drainQueue(modulePath, pool);
    if (!task) return;
    if (msg.ok) task.resolve(msg.value);
    else task.reject(new Error(msg.error));
  });
  worker.on('error', (err) => {
    const id = worker.__gatraPendingId;
    if (id != null) {
      const task = pool.pending.get(id);
      pool.pending.delete(id);
      if (task) task.reject(new WorkerDispatchError(String(err && err.message || err)));
    }
    pool.workers = pool.workers.filter(w => w !== worker);
    pool.free = pool.free.filter(w => w !== worker);
    // UC-11 (Worker Crash): a crashed worker was never a free worker for
    // drainQueue to hand tasks to, so without this, anything already sitting
    // in pool.queue would just wait forever for a worker that's gone — the
    // pool has room again (workers.length just dropped below MAX_WORKERS)
    // but nothing would notice until some unrelated *new* call happened to
    // come in through dispatchToWorker(). Recover the queue right here
    // instead of leaving it stuck.
    drainQueue(modulePath, pool);
  });
  // Registering the 'message' listener above re-refs the worker's message
  // port even if unref() ran first — unref() has to come after, or a still
  // (very much fresh, not-yet-given-work) worker keeps a one-shot CLI
  // process alive forever.
  worker.unref();
  return worker;
}

function runTask(pool, worker, task) {
  const id = pool.nextMsgId++;
  worker.__gatraPendingId = id;
  pool.pending.set(id, task);
  // A worker with a task in flight must keep the process alive even though
  // it's idle-unref'd the rest of the time — otherwise Node can decide
  // there's nothing left to wait for and exit before the reply ever arrives
  // (the awaited 'jalankan' Promise would then just hang forever, unnoticed,
  // because the process is already gone).
  worker.ref();
  try {
    worker.postMessage({ id, fn: task.fnName, args: task.args });
  } catch (e) {
    // Structured-clone failure (e.g. a class instance / function in args) —
    // a plumbing problem, not the task's own logic, so it's a
    // WorkerDispatchError: jalankan() will fall back to running inline.
    pool.pending.delete(id);
    worker.__gatraPendingId = null;
    pool.free.push(worker);
    worker.unref();
    task.reject(new WorkerDispatchError(String(e && e.message || e)));
  }
}

// Hands queued tasks to free workers, and — unlike the old version — also
// spawns fresh workers for them when the pool has room but nobody's free.
// Without that, a queue drained only by reusing already-free workers would
// stall forever the moment every current worker is busy or has just crashed
// (see the 'error' handler above): the pool would have capacity again, but
// nothing would ever act on it.
function drainQueue(modulePath, pool) {
  while (pool.queue.length > 0 && (pool.free.length > 0 || pool.workers.length < MAX_WORKERS)) {
    if (pool.free.length > 0) {
      runTask(pool, pool.free.pop(), pool.queue.shift());
    } else {
      const w = spawnWorker(modulePath, pool);
      pool.workers.push(w);
      runTask(pool, w, pool.queue.shift());
    }
  }
}

function dispatchToWorker(modulePath, fnName, args) {
  return new Promise((resolve, reject) => {
    const pool = getPool(modulePath);
    const task = { fnName, args, resolve, reject };
    if (pool.free.length > 0) {
      runTask(pool, pool.free.pop(), task);
    } else if (pool.workers.length < MAX_WORKERS) {
      const w = spawnWorker(modulePath, pool);
      pool.workers.push(w);
      runTask(pool, w, task);
    } else if (pool.queue.length < MAX_QUEUE) {
      pool.queue.push(task);
    } else {
      reject(new WorkerDispatchError('worker pool and queue both full'));
    }
  });
}

// The single entry point every 'paralel' call site compiles to. `localFn` is
// the real (possibly async) compiled function, called directly for the
// inline path — never round-tripped through a worker unless the cost model
// actually decided to.
async function jalankan(fnName, localFn, modulePath, args) {
  const key = statKey(modulePath, fnName);
  const useWorker = shouldUseWorker(key);
  const t0 = now();
  let result;
  if (useWorker) {
    try {
      result = await dispatchToWorker(modulePath, fnName, args);
    } catch (e) {
      if (e instanceof WorkerDispatchError) {
        result = await localFn(...args); // scheduling-path failure — never a correctness failure
      } else {
        throw e; // the function's own error — must propagate
      }
    }
  } else {
    result = await localFn(...args);
  }
  recordDuration(key, now() - t0);
  return result;
}

module.exports = {
  jalankan, THRESHOLD_MS, MAX_WORKERS, MAX_QUEUE,
  // Exposed only for tests/test.js's crash-recovery regression test — the
  // pool/queue live below dispatchToWorker()'s per-call Promise and aren't
  // otherwise reachable from outside this module.
  _internals: { getPool, dispatchToWorker, WorkerDispatchError, getStats, statKey },
};
