'use strict';

// JS built-ins and keywords that must NOT be renamed
const PRESERVE = new Set([
  // JS keywords
  'const','let','var','function','return','if','else','for','while','do',
  'switch','case','break','continue','new','delete','typeof','instanceof',
  'in','of','void','throw','try','catch','finally','class','extends',
  'super','this','import','export','default','from','async','await',
  // Literals
  'true','false','null','undefined','NaN','Infinity',
  // Globals
  'console','log','warn','error','process','require','module','exports',
  '__filename','__dirname','arguments','globalThis',
  // Common built-in constructors / objects
  'Math','Object','Array','String','Number','Boolean','Symbol','BigInt',
  'Promise','Error','Function','RegExp','Date','Map','Set','WeakMap',
  'WeakSet','JSON','Buffer','URL','URLSearchParams','structuredClone',
  // Node built-in module names (kept so import paths are untouched)
  'crypto','fs','path','os','http','https','net','url','util','stream',
  'events','child_process','readline','zlib','assert','vm','timers',
]);

function obfuscate(js) {
  // ── Step 1: Lift string literals to placeholders ───────────────────────────
  // Use \x00<digits>\x00 — no letters, so identifier-rename step won't touch it.
  const strings = [];
  let code = js.replace(/"((?:[^"\\]|\\.)*)"/g, (match) => {
    const idx = strings.length;
    strings.push(match);
    return `\x00${idx}\x00`;
  });

  // ── Step 2: Collect user-defined identifiers ───────────────────────────────
  const seen = new Set();
  for (const m of code.matchAll(/\b([a-zA-Z_$][a-zA-Z0-9_$]*)\b/g)) {
    const w = m[1];
    if (!PRESERVE.has(w)) seen.add(w);
  }

  // ── Step 3: Build rename map → _0xNNN ─────────────────────────────────────
  let counter = 0;
  const remap = new Map();
  for (const id of seen) {
    remap.set(id, `_0x${(counter++).toString(16).padStart(3, '0')}`);
  }

  // ── Step 4: Rename identifiers ────────────────────────────────────────────
  code = code.replace(/\b([a-zA-Z_$][a-zA-Z0-9_$]*)\b/g,
    m => remap.has(m) ? remap.get(m) : m
  );

  // ── Step 5: Restore strings as unicode-escaped literals ───────────────────
  code = code.replace(/\x00(\d+)\x00/g, (_, i) => {
    const raw     = strings[+i];
    const content = raw.slice(1, -1); // strip surrounding quotes
    const encoded = [...content].map(c =>
      `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`
    ).join('');
    return `"${encoded}"`;
  });

  // ── Step 6: Strip comments & minify whitespace ────────────────────────────
  code = code
    .replace(/\/\/[^\n]*/g, '')                          // line comments
    .replace(/\/\*[\s\S]*?\*\//g, '')                    // block comments
    .replace(/\n+/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *([\{\}\[\]\(\);,]) */g, '$1')
    .replace(/ *([=+\-*/%<>!&|^~?:]) */g, '$1')
    .replace(/; /g, ';')
    .trim();

  return code;
}

module.exports = { obfuscate };
