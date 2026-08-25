'use strict';

// Loads the compiled N-API addon. Tries, in order:
//   1. the prebuilt binary matching this exact platform+arch(+libc), e.g.
//      gatra-native-engine.linux-x64-gnu.node or .win32-x64-msvc.node —
//      built once per platform by .github/workflows/native-engine.yml and
//      committed here (see README "Native engine" section);
//   2. gatra-native-engine.node — the plain name a local `npm install` at
//      the repo root produces (scripts/build-native.js, current machine
//      only, needs a Rust toolchain);
//   3. anything else ending in .node found in this directory, as a last
//      resort in case platform detection guessed wrong.
// Throws if none load; the caller (src/runtime/native-bridge.js) catches
// that and runs the pure-JS fallback — this addon is a speed path only.
const fs = require('fs');
const path = require('path');
const { platformTarget } = require('./platform-target');

const preferred = `gatra-native-engine.${platformTarget()}.node`;
const dirFiles = fs.existsSync(__dirname)
  ? fs.readdirSync(__dirname).filter(f => f.endsWith('.node'))
  : [];

const candidates = [...new Set([preferred, 'gatra-native-engine.node', ...dirFiles, 'index.node'])];

let addon = null;
let lastError = null;
for (const file of candidates) {
  try {
    addon = require(path.join(__dirname, file));
    break;
  } catch (e) {
    lastError = e;
  }
}

if (!addon) {
  throw lastError || new Error(
    `gatra-native-engine: no compiled .node addon found for ${platformTarget()} — run \`npm install\` at the repo root (needs a Rust toolchain), or \`npm run build\` in native-engine/`
  );
}

module.exports = addon;
