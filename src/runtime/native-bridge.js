'use strict';

// Loads the compiled native-engine/ N-API addon when present, null otherwise.
// dataset.js always tries this first and falls back to the pure-JS
// implementation on any failure (module not built for this platform, no
// Rust toolchain available, etc) — the native engine is a performance path,
// never a correctness requirement.
let native = null;
try {
  native = require('../../native-engine');
} catch (e) {
  native = null;
}

module.exports = native;
