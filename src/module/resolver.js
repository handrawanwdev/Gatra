'use strict';

const fs   = require('fs');
const path = require('path');

const { tokenize }   = require('../lexer/lexer');
const { parse }       = require('../parser/parser');
const { NodeType: N } = require('../ast/nodes');
const { isPublicName } = require('./visibility');

// absPath (with extension resolved) -> Map(name -> { kind, public, decl })
const exportsCache = new Map();

// Resolves a relative import source ("./matematika" or "./matematika.gatra")
// to an absolute .gatra path. Returns null for bare specifiers (npm/node
// packages) — those aren't local modules we can inspect.
function resolveLocalPath(fromFile, source) {
  if (!source.startsWith('.')) return null;
  const base = path.resolve(path.dirname(fromFile), source);
  if (fs.existsSync(base)) return base;
  if (fs.existsSync(base + '.gatra')) return base + '.gatra';
  return base.endsWith('.gatra') ? base : base + '.gatra';
}

// Parses a local .gatra module and returns its top-level declared names —
// used to check Go-style visibility (capitalized = public) for
// 'impor { Nama } dari "..."' and namespace member access.
function getModuleExports(absPath) {
  if (exportsCache.has(absPath)) return exportsCache.get(absPath);

  const src = fs.readFileSync(absPath, 'utf8');
  const ast = parse(tokenize(src));
  const map = new Map();

  for (const stmt of ast.body) {
    let name = null, kind = null;
    switch (stmt.type) {
      case N.FN_DECL:          name = stmt.name; kind = 'fn';     break;
      case N.STRUCT_DECL:      name = stmt.name; kind = 'struct'; break;
      case N.TYPE_ALIAS_DECL:  name = stmt.name; kind = 'type';   break;
      case N.VAR_DECL:         name = stmt.name; kind = 'var';    break;
      default: continue;
    }
    map.set(name, { kind, public: isPublicName(name), decl: stmt });
  }

  exportsCache.set(absPath, map);
  return map;
}

module.exports = { resolveLocalPath, getModuleExports };
