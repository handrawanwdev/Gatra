'use strict';

// Static data-dependency graph among 'fungsi paralel' call sites within one
// linear scope (the top-level program, or a single function body) — the
// piece 'automatic parallelism' actually needs to be safe: knowing WHICH
// calls could genuinely run independently vs which ones must stay ordered
// because one produces data the other consumes.
//
// This is deliberately NOT general points-to/interprocedural alias analysis
// (that's undecidable in the general case, full stop — no compiler "solves"
// it, they approximate). What's tracked, precisely:
//
//   - RAW (read-after-write): call B's arguments reference a variable that
//     call A's result was just assigned to ('isi x = tunggu A(...)' then
//     later 'B(x)').
//   - Shared access: two calls whose arguments resolve (through direct
//     one-hop aliases, same rule as typechecker.js's checkMoveSafety) to the
//     same underlying identifier — same-var-twice, the exact pattern
//     checkMoveSafety already rejects at compile time when it isn't properly
//     re-sequenced. Surfaced here too so the graph reflects the real
//     dependency even where the type system's own error already blocks the
//     unsafe form; the graph is what a scheduler (or a human) checks BEFORE
//     deciding two calls are safe to treat as independent.
//
// Two calls with NO edge between them touch disjoint data as far as this
// analysis can tell — genuinely safe to run concurrently. Two calls with an
// edge must execute in program order (which Gatra's own 'tunggu' semantics
// already enforce for any code that actually compiles) — this module's job
// is making that property visible and checkable, not enforcing it a second
// time.

const { NodeType: N } = require('../ast/nodes');

function resolveAlias(aliases, name) {
  const seen = new Set();
  while (aliases.has(name) && !seen.has(name)) {
    seen.add(name);
    name = aliases.get(name);
  }
  return name;
}

function collectReads(node, aliases, reads) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const n of node) collectReads(n, aliases, reads); return; }
  if (node.type === N.IDENTIFIER) { reads.add(resolveAlias(aliases, node.name)); return; }
  for (const k of Object.keys(node)) {
    if (k !== 'type') collectReads(node[k], aliases, reads);
  }
}

// Unwraps 'tunggu expr [batas N detik]' to find a direct call to a known
// 'fungsi paralel' — returns the CALL_EXPR node, or null.
function findParallelCall(node, parallelFns) {
  if (!node || typeof node !== 'object') return null;
  if (node.type === N.AWAIT_EXPR) return findParallelCall(node.expr, parallelFns);
  if (node.type === N.CALL_EXPR && node.callee && node.callee.type === N.IDENTIFIER &&
      parallelFns.has(node.callee.name)) {
    return node;
  }
  return null;
}

// Builds the graph for one flat statement list (top-level body, or a single
// function's body) — call sites nested in blocks (jika/selama/dst.) are
// still collected in program order, same conservative flattening
// checkMoveSafety already uses for the same reason (a branch that didn't run
// still counts, so a false dependency edge beats a missed real one).
function buildDependencyGraph(stmts, parallelFns) {
  const calls = [];    // { id, line, col, callee, args: [names], writes: name|null }
  const aliases = new Map();

  function recordCall(callNode, writesTo) {
    const reads = new Set();
    for (const a of callNode.args) collectReads(a, aliases, reads);
    calls.push({
      id: calls.length,
      line: callNode.line,
      col: callNode.col,
      callee: callNode.callee.name,
      reads,
      writes: writesTo,
    });
  }

  // Statement dispatch AND generic "find a bare call anywhere" both go
  // through this one function — a top-level 'EXPR_STMT' wrapping an
  // 'ASSIGN_EXPR' (the normal shape of 'x = tunggu proses(x)' as a
  // standalone statement) falls through to the generic recursion at the
  // bottom, which then walks into '.expr' and correctly re-dispatches to the
  // ASSIGN_EXPR case below — so the write target is never lost by handling
  // EXPR_STMT as a special case that doesn't know about assignments.
  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { for (const n of node) walk(n); return; }
    if (node.type === N.FN_DECL) return; // nested/other functions get their own independent graph

    if (node.type === N.VAR_DECL) {
      const call = findParallelCall(node.value, parallelFns);
      if (call) recordCall(call, node.name);
      else if (node.value) walk(node.value);

      if (node.value && node.value.type === N.IDENTIFIER) aliases.set(node.name, resolveAlias(aliases, node.value.name));
      else aliases.delete(node.name);
      return;
    }

    if (node.type === N.ASSIGN_EXPR) {
      const writesTo = node.target.type === N.IDENTIFIER ? node.target.name : null;
      const call = findParallelCall(node.value, parallelFns);
      if (call) recordCall(call, writesTo);
      else walk(node.value);

      if (writesTo) {
        if (node.value.type === N.IDENTIFIER) aliases.set(writesTo, resolveAlias(aliases, node.value.name));
        else aliases.delete(writesTo);
      } else {
        walk(node.target);
      }
      return;
    }

    // A bare paralel call reached generically — no assignment target
    // wrapping it (a standalone statement, or nested inside some other
    // expression like an argument) — so writes:null.
    const bareCall = findParallelCall(node, parallelFns);
    if (bareCall) { recordCall(bareCall, null); return; }

    for (const k of Object.keys(node)) {
      if (k !== 'type') walk(node[k]);
    }
  }

  for (const s of stmts) walk(s);

  const edges = [];
  for (let j = 0; j < calls.length; j++) {
    for (let i = 0; i < j; i++) {
      if (calls[i].writes && calls[j].reads.has(calls[i].writes)) {
        edges.push({ from: calls[i].id, to: calls[j].id, reason: 'raw', via: calls[i].writes });
        continue;
      }
      let shared = null;
      for (const r of calls[j].reads) {
        if (calls[i].reads.has(r)) { shared = r; break; }
      }
      if (shared) edges.push({ from: calls[i].id, to: calls[j].id, reason: 'shared', via: shared });
    }
  }

  return {
    calls: calls.map(c => ({ id: c.id, line: c.line, col: c.col, callee: c.callee, writes: c.writes })),
    edges,
  };
}

// One graph per scope in the file: the top-level program body, plus each
// declared function's own body (nested functions never see an outer scope's
// calls — same isolation checkMoveSafety already relies on).
function analyzeDependencies(ast) {
  const parallelFns = new Set();
  for (const s of ast.body) {
    if (s.type === N.FN_DECL && s.isParallel) parallelFns.add(s.name);
  }
  if (parallelFns.size === 0) return [];

  const scopes = [];
  const topLevel = buildDependencyGraph(ast.body, parallelFns);
  if (topLevel.calls.length > 0) scopes.push({ scope: null, ...topLevel });

  for (const s of ast.body) {
    if (s.type === N.FN_DECL && s.body) {
      const g = buildDependencyGraph(s.body.body, parallelFns);
      if (g.calls.length > 0) scopes.push({ scope: s.name, ...g });
    }
  }

  return scopes;
}

module.exports = { analyzeDependencies, buildDependencyGraph };
