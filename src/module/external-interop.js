'use strict';

// Go-style visibility (visibility.js) applied uniformly to EVERY non-local
// module — Node builtins ('os', 'fs', ...) and npm packages alike — not just
// a special case for core modules. Gatra source always writes the PascalCase
// form ('os.Platform()', 'lodash.Map()'); Gatra maps that back onto the
// real (untouched) camelCase/lowercase export at the interop layer.
//
// Node builtins are 100% safe to introspect directly (require() a core
// module has no side effects worth worrying about, and is exactly what the
// program would do anyway) — getBuiltinMembers() below does that and returns
// the *complete, authoritative* member set.
//
// A third-party npm package is a different story: requiring it at compile
// time would execute arbitrary top-level code (native bindings, network/FS
// side effects, environment assumptions, ESM-only packages that can't even
// be require()'d). getNpmPackageMembers() below never executes the package —
// it resolves the real entry file path (require.resolve() is pure path
// resolution, no execution) and *statically scans its source text* for
// common export patterns. This is inherently best-effort: it catches plain
// hand-written CommonJS/ESM exports, and comes back null (unknown) for
// anything it can't confidently read (bundled/minified output, dynamic
// exports, re-export chains, ...). A null result is NOT a failure — callers
// treat it as "let the runtime adapter decide" (see codegen.js's
// __gatra_pascal_proxy__/__gatra_resolve_named__), so correctness never
// depends on the scan succeeding, only early compile-time errors do.

const Module = require('module');
const fs     = require('fs');
const path   = require('path');
const { isPublicName } = require('./visibility');

const builtinSet = new Set(Module.builtinModules);

// 'node:os' and 'os' name the same builtin — normalize away the prefix so
// both spellings resolve identically.
function normalizeBuiltinName(source) {
  return source.startsWith('node:') ? source.slice(5) : source;
}

function isBuiltinModule(source) {
  return builtinSet.has(normalizeBuiltinName(source));
}

// Own enumerable member names of a real Node builtin — the complete,
// authoritative set. Never throws (defensive only; core modules always load).
function getBuiltinMembers(source) {
  const name = normalizeBuiltinName(source);
  if (!builtinSet.has(name)) return null;
  try {
    return new Set(Object.keys(require(name)));
  } catch (e) {
    return null;
  }
}

// Best-effort, execution-free export scan of a JS source file's text. Covers
// the common hand-written shapes on both module systems; anything fancier
// (bundlers, transpiler output, computed/dynamic exports) simply won't match
// and the caller falls back to the runtime adapter — never a wrong answer,
// just an unconfirmed one.
function scanStaticExports(sourceText) {
  const names = new Set();

  // CommonJS: exports.foo = ... / module.exports.foo = ...
  for (const m of sourceText.matchAll(/\b(?:module\.)?exports\.([A-Za-z_$][\w$]*)\s*=/g)) {
    names.add(m[1]);
  }
  // CommonJS: module.exports = { foo, bar: baz, ... }
  const meq = sourceText.match(/module\.exports\s*=\s*{([^}]*)}/);
  if (meq) {
    for (const part of meq[1].split(',')) {
      const key = part.split(':')[0].trim();
      if (/^[A-Za-z_$][\w$]*$/.test(key)) names.add(key);
    }
  }
  // CommonJS: Object.defineProperty(exports, "foo", ...)
  for (const m of sourceText.matchAll(/Object\.defineProperty\(\s*exports\s*,\s*["']([A-Za-z_$][\w$]*)["']/g)) {
    names.add(m[1]);
  }
  // ESM: export function foo / export const foo / export class Foo / export async function foo
  for (const m of sourceText.matchAll(/\bexport\s+(?:async\s+function\*?|function\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g)) {
    names.add(m[1]);
  }
  // ESM: export { foo, bar as baz }
  for (const m of sourceText.matchAll(/\bexport\s*{([^}]*)}/g)) {
    for (const part of m[1].split(',')) {
      const asMatch = part.match(/\bas\s+([A-Za-z_$][\w$]*)\s*$/);
      const name = asMatch ? asMatch[1] : part.trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
    }
  }

  return names.size > 0 ? names : null;
}

// Resolve an npm package's real entry file (path resolution only — never
// executes it) and statically scan it. Null on any failure: not installed,
// ESM-only (require.resolve can't see it), unreadable, or nothing recognized.
function getNpmPackageMembers(source, fromFilePath) {
  try {
    const opts     = fromFilePath ? { paths: [path.dirname(fromFilePath)] } : undefined;
    const resolved = require.resolve(source, opts);
    const text     = fs.readFileSync(resolved, 'utf8');
    return scanStaticExports(text);
  } catch (e) {
    return null;
  }
}

// Real member set for any non-relative import specifier — builtin or npm.
// Null means "not confidently known" (npm-only outcome; builtins are always
// either a real Set or, in principle, unloadable which also comes back
// null) — callers must treat null as "defer to the runtime adapter", not
// as an error.
function getExternalMembers(source, fromFilePath) {
  if (isBuiltinModule(source)) return getBuiltinMembers(source);
  return getNpmPackageMembers(source, fromFilePath);
}

// The one Go-style-visibility decision, shared by both namespace member
// access (mod.Foo) and named-import (impor { Foo } dari "mod") checks:
//   { violation: true }  — a real, lowercase/camelCase member was accessed
//                          under its raw JS name; must be rejected.
//   { real: <string> }   — confidently resolves to this real member name
//                          (equal to `name` itself if no translation needed).
//   { real: null }       — not confirmed either way (unrecognized name, or
//                          the module's exports aren't statically known) —
//                          stay lax at compile time; the runtime adapter is
//                          the actual authority for this one.
function classifyExternalAccess(members, name) {
  if (members && members.has(name)) {
    return isPublicName(name) ? { real: name } : { violation: true };
  }
  if (!isPublicName(name) || !members) return { real: null };
  const lowered = name.charAt(0).toLowerCase() + name.slice(1);
  return members.has(lowered) ? { real: lowered } : { real: null };
}

// 'platform' -> 'Platform' — the PascalCase form Gatra source is written
// against for a real lowercase/camelCase member.
function toPublicName(realMember) {
  return realMember.charAt(0).toUpperCase() + realMember.slice(1);
}

module.exports = {
  isBuiltinModule,
  getExternalMembers,
  classifyExternalAccess,
  toPublicName,
};
