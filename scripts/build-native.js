'use strict';

// Auto-builds the native-engine/ Rust addon on `npm install` (see the
// "postinstall" script in package.json), so users never have to `cd
// native-engine && npm run build` by hand. Best-effort and always
// non-fatal — the whole system already works with pure JS (see
// src/runtime/native-bridge.js) when this addon isn't present, so a
// missing/broken Rust toolchain must never fail `npm install`.
//
// Deliberately doesn't shell out to `napi build` / @napi-rs/cli (an extra
// npm package + its own postinstall download) — plain `cargo build
// --release` plus a rename of the platform's shared-library output is
// enough for a local build. Also skipped entirely when a matching prebuilt
// binary (.github/workflows/native-engine.yml, committed under
// native-engine/) already covers this exact platform+arch(+libc) — see
// platformTarget() below and native-engine/index.js, which both load
// whichever gatra-native-engine.<target>.node they find first.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const NATIVE_DIR = path.join(__dirname, '..', 'native-engine');
const { platformTarget, isMusl } = require(path.join(NATIVE_DIR, 'platform-target.js'));

const TARGET = platformTarget();
const OUT_NODE = path.join(NATIVE_DIR, `gatra-native-engine.${TARGET}.node`);

function log(msg) {
  console.log(`[gatra] ${msg}`);
}

function hasCargo() {
  const result = spawnSync('cargo', ['--version'], { stdio: 'ignore' });
  return !result.error && result.status === 0;
}

// crate-type=cdylib output filename for crate "gatra-native-engine"
// (Cargo turns '-' into '_' for the library file name) on this platform.
function candidateLibNames() {
  if (process.platform === 'win32') return ['gatra_native_engine.dll'];
  if (process.platform === 'darwin') return ['libgatra_native_engine.dylib'];
  return ['libgatra_native_engine.so']; // linux and other ELF unixes
}

function main() {
  if (fs.existsSync(OUT_NODE)) {
    log(`native-engine: gatra-native-engine.${TARGET}.node already built, skipping.`);
    return;
  }
  // A CI-provided prebuilt for this exact target also satisfies it —
  // nothing to build.
  if (fs.readdirSync(NATIVE_DIR).some(f => f === `gatra-native-engine.${TARGET}.node`)) {
    log(`native-engine: prebuilt gatra-native-engine.${TARGET}.node found, skipping build.`);
    return;
  }

  if (!hasCargo()) {
    log('native-engine: no Rust toolchain (cargo) found and no prebuilt binary for this platform — skipping native build.');
    log('native-engine: Gatra works fully without it (pure-JS fallback); install Rust and run `npm install` again to enable it.');
    return;
  }

  log(`native-engine: building for ${TARGET} (cargo build --release)...`);
  // musl's default target-feature set is fully static, which silently
  // drops cdylib output ("dropping unsupported crate type `cdylib`") —
  // opt back into a dynamic build so the addon actually gets produced.
  const env = isMusl() ? { ...process.env, RUSTFLAGS: `${process.env.RUSTFLAGS || ''} -C target-feature=-crt-static`.trim() } : process.env;
  const result = spawnSync('cargo', ['build', '--release'], {
    cwd: NATIVE_DIR,
    stdio: 'inherit',
    env,
  });

  if (result.error || result.status !== 0) {
    log('native-engine: build failed — continuing without it (pure-JS fallback still works).');
    return;
  }

  const releaseDir = path.join(NATIVE_DIR, 'target', 'release');
  const found = candidateLibNames()
    .map(name => path.join(releaseDir, name))
    .find(p => fs.existsSync(p));

  if (!found) {
    log(`native-engine: build succeeded but no output found in ${releaseDir} — continuing without it.`);
    return;
  }

  fs.copyFileSync(found, OUT_NODE);
  log(`native-engine: built ${path.relative(process.cwd(), OUT_NODE)}`);
}

main();
