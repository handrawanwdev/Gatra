'use strict';

// 'gatra graph' — walks local .gatra imports from an entry file and renders
// the dependency tree as text/json/mermaid. Deliberately regex-based (same
// pattern gatra.js's collectOrder()/buildWithDeps() already use to walk
// local imports) rather than a full parse — this only needs import edges,
// not the AST.

const fs   = require('fs');
const path = require('path');

const IMPORT_RE = /impor\s+(?:\{[^}]*\}|\w+)\s+dari\s+"(\.\.?\/[^"]+\.gatra)"/g;

// absPath -> { imports: absPath[], missing: bool }
function buildGraph(entryAbs) {
  const nodes = new Map();

  function visit(absPath) {
    if (nodes.has(absPath)) return;

    if (!fs.existsSync(absPath)) {
      nodes.set(absPath, { imports: [], missing: true });
      return;
    }

    const source = fs.readFileSync(absPath, 'utf8');
    const dir    = path.dirname(absPath);
    const imports = [];
    for (const m of source.matchAll(IMPORT_RE)) {
      imports.push(path.resolve(dir, m[1]));
    }

    nodes.set(absPath, { imports, missing: false });
    for (const dep of imports) visit(dep);
  }

  visit(entryAbs);
  return nodes;
}

// DFS with an explicit recursion stack — any import that points back at a
// node already on the stack closes a cycle.
function findCycles(nodes, entryAbs) {
  const cycles  = [];
  const stack   = [];
  const onStack = new Set();
  const visited = new Set();

  function dfs(node) {
    stack.push(node);
    onStack.add(node);
    visited.add(node);

    for (const dep of (nodes.get(node) || { imports: [] }).imports) {
      if (onStack.has(dep)) {
        const idx = stack.indexOf(dep);
        cycles.push(stack.slice(idx).concat(dep));
      } else if (!visited.has(dep)) {
        dfs(dep);
      }
    }

    stack.pop();
    onStack.delete(node);
  }

  dfs(entryAbs);
  return cycles;
}

function renderText(nodes, entryAbs, cwd) {
  const rel = (p) => path.relative(cwd, p) || path.basename(p);
  const lines = [];

  function render(node, prefix, isLast, ancestry) {
    const circular = ancestry.includes(node);
    const label = rel(node) + (circular ? '  (circular)' : (nodes.get(node) || {}).missing ? '  (tidak ditemukan)' : '');
    lines.push(ancestry.length === 0 ? label : prefix + (isLast ? '└── ' : '├── ') + label);
    if (circular) return;

    const imports = (nodes.get(node) || { imports: [] }).imports;
    const childPrefix = ancestry.length === 0 ? '' : prefix + (isLast ? '    ' : '│   ');
    imports.forEach((dep, i) => {
      render(dep, childPrefix, i === imports.length - 1, ancestry.concat(node));
    });
  }

  render(entryAbs, '', true, []);
  return lines.join('\n');
}

function renderJson(nodes, cwd) {
  const rel = (p) => path.relative(cwd, p);
  const out = [];
  for (const [absPath, info] of nodes) {
    out.push({ file: rel(absPath), imports: info.imports.map(rel), missing: !!info.missing });
  }
  return JSON.stringify(out, null, 2);
}

function renderMermaid(nodes, cwd) {
  const rel = (p) => path.relative(cwd, p);
  const lines = ['graph TD'];
  for (const [absPath, info] of nodes) {
    for (const dep of info.imports) {
      lines.push(`  ${JSON.stringify(rel(absPath))} --> ${JSON.stringify(rel(dep))}`);
    }
  }
  return lines.join('\n');
}

module.exports = { buildGraph, findCycles, renderText, renderJson, renderMermaid };
