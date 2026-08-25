'use strict';

// Computes the same "<os>-<arch>[-<libc>]" tag napi-rs's own generated
// per-platform packages use, so prebuilt binaries and local builds
// (scripts/build-native.js) can coexist under distinct filenames:
// gatra-native-engine.<target>.node — see index.js.

// process.report.getReport().header.glibcVersionRuntime is only present
// when the running Node binary is linked against glibc — absent on musl
// (e.g. Alpine). No extra dependency needed to tell them apart.
function isMusl() {
  if (process.platform !== 'linux') return false;
  try {
    const report = process.report && process.report.getReport();
    if (report && report.header && report.header.glibcVersionRuntime) return false;
  } catch (e) {
    // process.report can be disabled by flag; fall through to the musl
    // assumption below rather than crash.
  }
  return true;
}

function platformTarget() {
  const arch = process.arch; // 'x64', 'arm64', ...
  switch (process.platform) {
    case 'linux':  return `linux-${arch}-${isMusl() ? 'musl' : 'gnu'}`;
    case 'darwin': return `darwin-${arch}`;
    case 'win32':  return `win32-${arch}-msvc`;
    default:       return `${process.platform}-${arch}`;
  }
}

module.exports = { platformTarget, isMusl };
