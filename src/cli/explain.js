'use strict';

// 'gatra explain' — static, heuristic classification of each function in a
// file: CPU-bound vs I/O-bound, async, parallelizable, and its dependencies.
// Not a real effect analysis (Gatra has none) — just leans on signals the
// language already gives us for free: the 'asinkron'/'paralel' modifiers
// (mutually-intentioned: async = event-loop I/O concurrency, paralel =
// worker-pool CPU concurrency — see runtime/scheduler.js's own framing) and
// which imported namespaces a function's body actually calls into.

const { tokenize }    = require('../lexer/lexer');
const { parse }       = require('../parser/parser');
const { NodeType: N } = require('../ast/nodes');

function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit);
    return;
  }
  if (node.type) visit(node);
  for (const key of Object.keys(node)) {
    if (key === 'type') continue;
    const val = node[key];
    if (val && typeof val === 'object') walk(val, visit);
  }
}

function analyzeFunction(fnNode, importAliases) {
  let hasAwait = false;
  const deps = new Set();

  walk(fnNode.body, (n) => {
    if (n.type === N.AWAIT_EXPR) hasAwait = true;
    if (
      n.type === N.CALL_EXPR &&
      n.callee && n.callee.type === N.MEMBER_EXPR &&
      n.callee.object && n.callee.object.type === N.IDENTIFIER &&
      importAliases.has(n.callee.object.name)
    ) {
      deps.add(n.callee.object.name);
    }
  });

  const isAsync    = !!fnNode.isAsync || hasAwait;
  const isParallel = !!fnNode.isParallel;
  const ioBound     = isAsync && !isParallel;
  const cpuBound    = !ioBound;
  const parallelizable = isParallel || (cpuBound && !isAsync);

  let strategy;
  if (isParallel)    strategy = 'Worker Pool (paralel)';
  else if (ioBound)  strategy = 'Async I/O';
  else               strategy = 'Sinkron (Event Loop)';

  return {
    name: fnNode.receiver ? `${fnNode.receiver.type}.${fnNode.name}` : fnNode.name,
    isAsync,
    isParallel,
    cpuBound,
    ioBound,
    parallelizable,
    dependencies: [...deps].sort(),
    strategy,
  };
}

// Returns an array of analyses, one per top-level function declared in the
// source (in declaration order).
function analyzeFile(source) {
  const ast = parse(tokenize(source));

  const importAliases = new Set();
  for (const stmt of ast.body) {
    if (stmt.type === N.PACKAGE_IMPORT && stmt.localName) {
      importAliases.add(stmt.localName);
    }
  }

  const fns = ast.body.filter((s) => s.type === N.FN_DECL);
  return fns.map((fn) => analyzeFunction(fn, importAliases));
}

module.exports = { analyzeFile };
