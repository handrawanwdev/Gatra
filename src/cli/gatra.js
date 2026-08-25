#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { spawnSync, spawn } = require("child_process");
const os = require("os");

const { tokenize } = require("../lexer/lexer");
const { parse } = require("../parser/parser");
const { typecheck } = require("../typechecker/typechecker");
const { generate } = require("../codegen/codegen");
const { obfuscate } = require("../codegen/obfuscator");
const { detectGrammar } = require("../lexer/keywords");
const { lint } = require("../linter/linter");
const { format } = require("../formatter/formatter");
const { loadConfig, stringifyToml } = require("./config");
const { buildGraph, findCycles, renderText: renderGraphText, renderJson: renderGraphJson, renderMermaid: renderGraphMermaid } = require("./graph");
const { analyzeFile } = require("./explain");

const GATRA_VERSION = "0.1.0";

// Globals a vm.createContext() sandbox does NOT inherit from the host
// process automatically — needed by generated code that isn't routed
// through runEsm() (e.g. 'ukur' uses performance.now(), 'batas' uses
// setTimeout()).
function baseVmGlobals(filePath) {
  return {
    console,
    process,
    require,
    performance,
    setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
    __filename: path.resolve(filePath),
    __dirname: path.dirname(path.resolve(filePath)),
  };
}

// ── Compiler pipeline ─────────────────────────────────────────────────────────

function compile(source, opts) {
  const grammar = detectGrammar(source);
  const tokens = tokenize(source);
  const ast = parse(tokens);
  typecheck(ast, grammar, { filePath: opts && opts.filePath });
  return generate(ast, opts);
}

// Rewrite local .gatra import paths → .js in generated JS output
function rewriteMgImports(js) {
  return js.replace(/from ("\.\.?\/[^"]+)\.gatra"/g, 'from $1.js"');
}

function formatError(err, source, filePath) {
  const name = err.name || "Error";

  if (!err.line) {
    return `${name}: ${err.message}`;
  }

  const loc = filePath
    ? `${filePath}:${err.line}:${err.col}`
    : `baris ${err.line}:${err.col}`;
  const lineNum = String(err.line);
  const pad = " ".repeat(lineNum.length);

  let srcLine = "";
  if (source) {
    srcLine = source.split("\n")[err.line - 1] || "";
  }

  const col = Math.max(1, err.col || 1);
  const caret = " ".repeat(col - 1) + "^";

  let out = `${name}: ${err.message}\n`;
  out += `  --> ${loc}\n`;
  out += `${pad} |\n`;
  out += `${lineNum} | ${srcLine}\n`;
  out += `${pad} | ${caret}`;

  if (err.hint) {
    out += `\n${pad} = bantuan: ${err.hint}`;
  }

  return out;
}

// ── ES Module runner ──────────────────────────────────────────────────────────

const LOCAL_MG_IMPORT_RE = /from ("\.\.?\/[^"]+\.gatra")/g;
// Matches a local .gatra import in *source* (not compiled JS) — same shape
// buildWithDeps() below uses to walk 'gatra bangun's dependency graph.
const LOCAL_MG_SOURCE_RE = /impor\s+(?:\{[^}]*\}|\w+)\s+dari\s+"(\.\.?\/[^"]+\.gatra)"/g;

function runEsm(sourceFile, js, _sourceCode) {
  const entryAbs   = path.resolve(sourceFile);
  const sourceDir  = path.dirname(entryAbs);
  // Compiled output runs from inside sourceDir (not os.tmpdir()) so bare
  // npm-package imports ('impor { X } dari "paket-npm"') resolve against
  // the real project's node_modules the way Node normally walks up parent
  // directories looking for one — a systemwide temp dir has no ancestor
  // node_modules to find. Removed in the 'finally' below either way.
  const tmpDir = fs.mkdtempSync(path.join(sourceDir, ".gatra_tmp_"));

  try {
    const seen = new Set();

    // A local .gatra import can itself import further local .gatra files —
    // walk that dependency graph depth-first (mirrors buildWithDeps() for
    // 'gatra bangun') and write each compiled dependency at the SAME
    // relative position under tmpDir that it has under sourceDir. Mirroring
    // the tree (instead of flattening into one dir, or rewriting each
    // specifier to an absolute file:// URL) means every file's own relative
    // 'from "./x.gatra"' specifiers keep resolving correctly after just a
    // .gatra → .js extension swap, at any import depth, without having to
    // rewrite the path text itself.
    function compileLocalDep(absPath) {
      if (seen.has(absPath)) return;
      seen.add(absPath);

      if (!fs.existsSync(absPath)) {
        console.error(`ModulTidakDitemukan: '${absPath}' tidak ada`);
        process.exit(1);
      }

      const src = fs.readFileSync(absPath, "utf8");
      let depJs;
      try {
        depJs = compile(src, { filePath: absPath, emitExports: true });
      } catch (err) {
        console.error(formatError(err, src, absPath));
        process.exit(1);
      }
      depJs = rewriteMgImports(depJs);

      for (const m of src.matchAll(LOCAL_MG_SOURCE_RE)) {
        compileLocalDep(path.resolve(path.dirname(absPath), m[1]));
      }

      const outPath = path.join(tmpDir, path.relative(sourceDir, absPath).replace(/\.gatra$/, ".js"));
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, depJs, "utf8");
    }

    for (const match of js.matchAll(LOCAL_MG_IMPORT_RE)) {
      compileLocalDep(path.resolve(sourceDir, match[1].slice(1, -1)));
    }

    const mainMjs = path.join(tmpDir, "main.js");
    fs.writeFileSync(mainMjs, rewriteMgImports(js), "utf8");

    const result = spawnSync(process.execPath, [mainMjs], { stdio: "inherit" });
    if (result.status !== 0) process.exit(result.status ?? 1);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ── 'fungsi paralel' runner ──────────────────────────────────────────────────
//
// A program using 'fungsi paralel' (Automatic_Concurrency.md) can't run
// through the normal vm.Script sandbox above: the codegen emits a top-level
// 'return' (skipping the program's own side effects when this same file gets
// re-run inside a worker — see scheduler.js/codegen.js's genParallelGuard()
// comments for the full story), and a top-level 'return' is a SyntaxError in
// vm.Script (parsed as a plain script, not wrapped in a function) but legal
// in a real required/spawned file (wrapped in the CommonJS module function).
// Workers also need a real file path to load via `new Worker(path)` in the
// first place. So: write to a real temp file and spawn a real Node process,
// same shape as runEsm() above but without its ES-module-specific import
// rewriting (this is plain CJS — 'impor' already compiles to a real
// require() call here, nothing to rewrite).
function usesParallelScheduler(js) {
  return js.includes("require('worker_threads')");
}

function runViaFile(sourceFile, js) {
  const sourceDir = path.dirname(path.resolve(sourceFile));
  const tmpDir = fs.mkdtempSync(path.join(sourceDir, ".gatra_tmp_"));
  try {
    const mainJs = path.join(tmpDir, "main.js");
    fs.writeFileSync(mainJs, js, "utf8");
    const result = spawnSync(process.execPath, [mainJs], { stdio: "inherit" });
    if (result.status !== 0) process.exit(result.status ?? 1);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ── Project build helpers ─────────────────────────────────────────────────────

function findMgFiles(dir) {
  const files = [];
  const skip = new Set(["node_modules", "dist", ".git"]);
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...findMgFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(".gatra")) {
      files.push(full);
    }
  }
  return files;
}

// ── Bundler ───────────────────────────────────────────────────────────────────

// Safe JS identifier for a module: _mod_paket_matematika
function modVar(absPath) {
  return "_mod_" + path.basename(absPath, ".gatra").replace(/[^a-zA-Z0-9_]/g, "_");
}

// Post-order (deps first) topological walk.
function collectOrder(absPath, visited = new Set(), order = []) {
  if (visited.has(absPath)) return order;
  visited.add(absPath);

  if (!fs.existsSync(absPath)) {
    console.error(`Error: File tidak ditemukan: ${absPath}`);
    process.exit(1);
  }

  const source = fs.readFileSync(absPath, "utf8");
  const srcDir = path.dirname(absPath);

  for (const m of source.matchAll(/impor\s+(?:\{[^}]*\}|\w+)\s+dari\s+"(\.\.?\/[^"]+\.gatra)"/g)) {
    collectOrder(path.resolve(srcDir, m[1]), visited, order);
  }

  order.push({ absPath, source });
  return order;
}

function cmdBundle(entryFile, outFile, samar) {
  const entryAbs = path.resolve(entryFile);
  if (!fs.existsSync(entryAbs)) {
    console.error(`Error: File tidak ditemukan: ${entryFile}`);
    process.exit(1);
  }

  const order = collectOrder(entryAbs);
  const chunks = [];

  for (const { absPath, source } of order) {
    let js;
    try {
      js = compile(source, { filePath: absPath, emitExports: true });
    } catch (err) {
      console.error(formatError(err, source, absPath));
      process.exit(1);
    }

    const srcDir = path.dirname(absPath);
    const isEntry = absPath === entryAbs;

    // Replace local .gatra imports → module var references
    js = js.replace(/import \* as (\w+) from "(\.[^"]+)";\n?/g, (_, alias, src) => {
      const depAbs = path.resolve(srcDir, src.replace(/\.gatra$/, "") + ".gatra");
      return `const ${alias} = ${modVar(depAbs)};\n`;
    });

    // Replace external imports → require() for CJS compatibility in bundle
    js = js.replace(/import \* as (\w+) from "([^".][^"]*)";\n?/g, (_, alias, pkg) => {
      return `const ${alias} = require(${JSON.stringify(pkg)});\n`;
    });

    if (isEntry) {
      // Entry: strip any stray export keywords, append as-is
      js = js.replace(/^export /gm, "");
      chunks.push(js);
    } else {
      // Dep module: wrap in IIFE, expose exports via return object
      const exportNames = [];
      for (const m of js.matchAll(/^export function (\w+)/gm)) exportNames.push(m[1]);
      for (const m of js.matchAll(/^export (?:let|const|var) (\w+)/gm)) exportNames.push(m[1]);

      js = js.replace(/^export /gm, "");
      const ret = exportNames.length
        ? `  return { ${exportNames.join(", ")} };`
        : "";

      chunks.push(`const ${modVar(absPath)} = (() => {\n${js}\n${ret}\n})();`);
    }
  }

  let bundle = chunks.join("\n\n");
  if (samar) bundle = obfuscate(bundle);

  const dest = path.resolve(outFile || path.basename(entryAbs, ".gatra") + ".bundle.js");
  fs.writeFileSync(dest, bundle, "utf8");
  console.log(`  ✓  bundle → ${path.relative(process.cwd(), dest)}`);
}

// ── Commands ──────────────────────────────────────────────────────────────────

function cmdRun(filePath) {
  if (!fs.existsSync(filePath)) {
    console.error(`Error: File not found: ${filePath}`);
    process.exit(1);
  }

  const source = fs.readFileSync(filePath, "utf8");

  let js;
  try {
    js = compile(source, { filePath });
  } catch (err) {
    console.error(formatError(err, source, filePath));
    process.exit(1);
  }

  try {
    if (js.includes("import ") || js.includes("export ")) {
      runEsm(filePath, js, source);
    } else if (usesParallelScheduler(js)) {
      runViaFile(filePath, js);
    } else {
      const ctx = vm.createContext(baseVmGlobals(filePath));
      new vm.Script(js, { filename: filePath }).runInContext(ctx);
    }
  } catch (err) {
    console.error(`RuntimeError: ${err.message}`);
    process.exit(1);
  }
}

function cmdLint(filePath) {
  if (!fs.existsSync(filePath)) {
    console.error(`Error: File tidak ditemukan: ${filePath}`);
    process.exit(1);
  }

  const source = fs.readFileSync(filePath, "utf8");

  let ast;
  try {
    ast = parse(tokenize(source));
  } catch (err) {
    console.error(formatError(err, source, filePath));
    process.exit(1);
  }

  const findings = lint(ast);
  if (findings.length === 0) {
    console.log(`  ✓  ${filePath} — tidak ada temuan`);
    return;
  }

  for (const f of findings) {
    console.log(`${filePath}:${f.line}:${f.col}  [${f.rule}]  ${f.message}`);
  }
  console.log(`\n${findings.length} temuan`);
  process.exit(1);
}

function cmdFormat(filePath, write) {
  if (!fs.existsSync(filePath)) {
    console.error(`Error: File tidak ditemukan: ${filePath}`);
    process.exit(1);
  }

  const source = fs.readFileSync(filePath, "utf8");

  let formatted;
  try {
    formatted = format(source);
  } catch (err) {
    console.error(formatError(err, source, filePath));
    process.exit(1);
  }

  if (write) {
    fs.writeFileSync(filePath, formatted, "utf8");
    console.log(`  ✓  ${filePath} dirapikan`);
  } else {
    process.stdout.write(formatted);
  }
}

function cmdTest(filePath) {
  if (!fs.existsSync(filePath)) {
    console.error(`Error: File tidak ditemukan: ${filePath}`);
    process.exit(1);
  }

  const source = fs.readFileSync(filePath, "utf8");

  let js;
  try {
    js = compile(source, { includeTests: true, filePath });
  } catch (err) {
    console.error(formatError(err, source, filePath));
    process.exit(1);
  }

  try {
    if (js.includes("import ") || js.includes("export ")) {
      runEsm(filePath, js, source);
    } else if (usesParallelScheduler(js)) {
      runViaFile(filePath, js);
    } else {
      const ctx = vm.createContext(baseVmGlobals(filePath));
      new vm.Script(js, { filename: filePath }).runInContext(ctx);
    }
  } catch (err) {
    console.error(`RuntimeError: ${err.message}`);
    process.exit(1);
  }
}

// Runs 'gatra uji' project-wide: every .gatra file under the test directory
// (gatra.toml's [test].directory, default "tests"), each as its own child
// process (reuses cmdTest's already-correct single-file pipeline instead of
// re-implementing ESM/parallel-scheduler dispatch here), aggregating the
// per-file "Hasil: N lulus, M gagal" line each run already prints.
function cmdTestProject(dir) {
  const resolvedDir = path.resolve(dir);
  if (!fs.existsSync(resolvedDir)) {
    console.log(`Tidak ada direktori tes '${dir}' — lewati.`);
    return;
  }

  const files = findMgFiles(resolvedDir);
  if (files.length === 0) {
    console.log(`Tidak ada file .gatra ditemukan di '${dir}'`);
    return;
  }

  let totalLulus = 0, totalGagal = 0, hadUnparsedError = false;

  for (const file of files) {
    console.log(path.relative(process.cwd(), file));
    const res = spawnSync(process.execPath, [__filename, "uji", file], { encoding: "utf8" });
    process.stdout.write(res.stdout || "");
    process.stderr.write(res.stderr || "");

    const m = (res.stdout || "").match(/Hasil: (\d+) lulus, (\d+) gagal/);
    if (m) {
      totalLulus += parseInt(m[1], 10);
      totalGagal += parseInt(m[2], 10);
    } else if (res.status !== 0) {
      hadUnparsedError = true;
    }
    console.log("");
  }

  console.log(`Total: ${totalLulus} lulus, ${totalGagal} gagal`);
  if (totalGagal > 0 || hadUnparsedError) process.exit(1);
}

// Compile a .gatra file and all its local .gatra dependencies recursively.
function buildWithDeps(filePath, outDir, samar, seen = new Set()) {
  const absPath = path.resolve(filePath);
  if (seen.has(absPath)) return;
  seen.add(absPath);

  if (!fs.existsSync(absPath)) {
    console.error(`Error: File tidak ditemukan: ${absPath}`);
    process.exit(1);
  }

  const source  = fs.readFileSync(absPath, "utf8");
  const srcDir  = path.dirname(absPath);
  const destDir = outDir ? path.resolve(outDir) : srcDir;

  // Compile deps first (depth-first)
  for (const match of source.matchAll(/impor\s+(?:\{[^}]*\}|\w+)\s+dari\s+"(\.\.?\/[^"]+\.gatra)"/g)) {
    const depAbs = path.resolve(srcDir, match[1]);
    buildWithDeps(depAbs, outDir, samar, seen);
  }

  let js;
  try {
    js = compile(source, { filePath: absPath, emitExports: true });
    js = rewriteMgImports(js);
    if (samar) js = obfuscate(js);
  } catch (err) {
    console.error(formatError(err, source, absPath));
    process.exit(1);
  }

  fs.mkdirSync(destDir, { recursive: true });
  const destFile = path.join(destDir, path.basename(absPath, ".gatra") + ".js");
  fs.writeFileSync(destFile, js, "utf8");
  console.log(
    `  ✓  ${path.relative(process.cwd(), absPath)}  →  ${path.relative(process.cwd(), destFile)}`,
  );
}

function cmdBuild(filePath, outPath, samar) {
  if (!fs.existsSync(filePath)) {
    console.error(`Error: File tidak ditemukan: ${filePath}`);
    process.exit(1);
  }
  buildWithDeps(filePath, outPath || null, samar);
}

function cmdBuildProject(srcDir, outDir, samar) {
  if (!fs.existsSync(srcDir)) {
    console.error(`Error: Direktori tidak ditemukan: ${srcDir}`);
    process.exit(1);
  }

  const resolvedSrc = path.resolve(srcDir);
  const resolvedOut = path.resolve(outDir || path.join(resolvedSrc, "dist"));

  const mgFiles = findMgFiles(resolvedSrc);

  if (mgFiles.length === 0) {
    console.error(`Tidak ada file .gatra ditemukan di '${resolvedSrc}'`);
    process.exit(1);
  }

  console.log(`Mengompilasi ${mgFiles.length} file → '${resolvedOut}'${samar ? ' [--samar]' : ''}\n`);

  const errors   = [];
  const compiled = [];

  for (const file of mgFiles) {
    const source = fs.readFileSync(file, "utf8");
    try {
      let js = compile(source, { filePath: file, emitExports: true });
      js = rewriteMgImports(js);
      if (samar) js = obfuscate(js);
      compiled.push({ file, js });
    } catch (err) {
      errors.push({ file, err, source });
    }
  }

  for (const { file, err, source } of errors) {
    console.error(formatError(err, source, file));
    console.error("");
  }

  if (errors.length > 0) {
    console.error(`Build gagal: ${errors.length} error`);
    process.exit(1);
  }

  for (const { file, js } of compiled) {
    const rel     = path.relative(resolvedSrc, file);
    const outFile = path.join(resolvedOut, rel.replace(/\.gatra$/, ".js"));
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, js, "utf8");
    console.log(`  ✓  ${rel}  →  ${path.relative(process.cwd(), outFile)}`);
  }

  console.log(`\nSelesai: ${compiled.length} file dikompilasi`);
}

// ── Bersihkan (clean) ────────────────────────────────────────────────────────

function cmdClean(targetDir) {
  const base = path.resolve(targetDir || ".");
  const cfg  = loadConfig(base);

  const targets = new Set(["dist", ".gatra", ".cache"]);
  if (cfg && cfg.toml && cfg.toml.build && cfg.toml.build.output) {
    targets.add(cfg.toml.build.output);
  }

  let removed = 0;
  for (const t of targets) {
    const full = path.join(base, t);
    if (fs.existsSync(full)) {
      fs.rmSync(full, { recursive: true, force: true });
      console.log(`  ✓  dihapus: ${path.relative(process.cwd(), full) || t}`);
      removed++;
    }
  }

  if (removed === 0) {
    console.log("Tidak ada artifact untuk dibersihkan.");
  }
}

// ── Dokter (doctor) ──────────────────────────────────────────────────────────

function cmdDoctor() {
  console.log("Gatra Doctor\n");

  const rows = [];
  let problems = 0;

  rows.push(["Gatra", true, GATRA_VERSION]);

  const nodeVersion = process.version;
  const nodeMajor   = parseInt(nodeVersion.slice(1), 10);
  const nodeOk      = nodeMajor >= 18;
  rows.push(["Node.js", nodeOk, nodeVersion]);
  if (!nodeOk) problems++;

  let npmVersion = null;
  try {
    const res = spawnSync("npm", ["--version"], { encoding: "utf8" });
    if (res.status === 0) npmVersion = res.stdout.trim();
  } catch (_e) { /* npm not on PATH */ }
  rows.push(["npm", !!npmVersion, npmVersion || "Tidak ditemukan"]);
  if (!npmVersion) problems++;

  const cfg = loadConfig(process.cwd());
  if (!cfg) {
    rows.push(["gatra.toml", false, "Tidak ditemukan"]);
    problems++;
  } else if (!cfg.toml) {
    rows.push(["gatra.toml", false, "Invalid"]);
    problems++;
  } else {
    rows.push(["gatra.toml", true, "Valid"]);
  }

  const pkgOk = fs.existsSync(path.join(process.cwd(), "package.json"));
  rows.push(["package.json", pkgOk, pkgOk ? "Ada" : "Tidak ditemukan"]);
  if (!pkgOk) problems++;

  const nameWidth = Math.max(...rows.map(([n]) => n.length));
  for (const [name, ok, detail] of rows) {
    const mark = ok ? "✓" : "✗";
    console.log(`${mark}  ${name.padEnd(nameWidth)}  ${detail}`);
  }

  console.log("");
  if (problems === 0) {
    console.log("Environment siap.");
  } else {
    console.log(`${problems} masalah ditemukan.`);
    process.exit(1);
  }
}

// ── Info proyek ───────────────────────────────────────────────────────────────

function cmdInfo() {
  const cfg = loadConfig(process.cwd());
  if (!cfg || !cfg.toml) {
    console.error("Error: gatra.toml tidak ditemukan. Jalankan 'gatra buat' untuk membuat proyek baru.");
    process.exit(1);
  }

  const proj  = cfg.toml.project || {};
  const build = cfg.toml.build || {};

  console.log("Proyek\n");
  console.log(`  Nama:          ${proj.name || "-"}`);
  console.log(`  Versi:         ${proj.version || "-"}`);
  console.log(`  Arsitektur:    ${proj.architecture || "-"}`);
  console.log(`  Entry:         ${proj.entry || "-"}`);
  console.log(`  Runtime:       Node.js`);
  console.log(`  Target:        JavaScript`);
  console.log("");
  console.log("Build\n");
  console.log(`  Source:        ${build.source || "-"}`);
  console.log(`  Output:        ${build.output || "-"}`);
}

// ── Dev (watch + restart) ────────────────────────────────────────────────────

function cmdDev(entryArg) {
  const cfg   = loadConfig(process.cwd());
  const entry = entryArg || (cfg && cfg.toml && cfg.toml.project && cfg.toml.project.entry);

  if (!entry) {
    console.error("Error: file entry tidak ditentukan (dan tidak ada gatra.toml). Contoh: gatra kembangkan src/utama.gatra");
    process.exit(1);
  }

  const entryAbs = path.resolve(entry);
  if (!fs.existsSync(entryAbs)) {
    console.error(`Error: File tidak ditemukan: ${entry}`);
    process.exit(1);
  }

  const watchRoot = (cfg && cfg.toml && cfg.toml.build && cfg.toml.build.source)
    ? path.resolve(cfg.dir, cfg.toml.build.source)
    : path.dirname(entryAbs);

  console.log(`Gatra Dev — memantau '${path.relative(process.cwd(), watchRoot) || "."}'\n`);

  let child = null;
  let debounceTimer = null;

  function stopChild() {
    if (child) {
      child.removeAllListeners("exit");
      child.kill();
      child = null;
    }
  }

  // Reuses the already-correct 'gatra jalankan' pipeline (ESM deps, parallel
  // scheduler, formatted errors) in a child process rather than
  // re-implementing dependency compilation here — 'restart' just means
  // kill-and-respawn that child.
  function startChild() {
    stopChild();
    console.log(`▶  gatra jalankan ${path.relative(process.cwd(), entryAbs)}\n`);
    child = spawn(process.execPath, [__filename, "jalankan", entryAbs], { stdio: "inherit" });
    child.on("exit", (code, signal) => {
      if (signal) return; // killed by us for a restart
      if (code !== 0) console.log(`\n(proses keluar dengan kode ${code})`);
      console.log("\nMenunggu perubahan...");
    });
  }

  function scheduleRestart(filename) {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      console.log(`\nFile berubah: ${filename} — kompilasi ulang...\n`);
      startChild();
    }, 150);
  }

  const watchers = [];
  const SKIP_DIRS = new Set(["node_modules", "dist", ".git", ".cache"]);

  function watchDir(dir) {
    if (!fs.existsSync(dir)) return;
    watchers.push(fs.watch(dir, (_eventType, filename) => {
      if (filename && filename.endsWith(".gatra")) scheduleRestart(filename);
    }));
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && !SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".gatra_")) {
        watchDir(path.join(dir, entry.name));
      }
    }
  }
  watchDir(watchRoot);

  process.on("SIGINT", () => {
    for (const w of watchers) w.close();
    stopChild();
    process.exit(0);
  });

  startChild();
}

// ── Graph (dependency graph) ─────────────────────────────────────────────────

function cmdGraph(entryArg, format) {
  const cfg   = loadConfig(process.cwd());
  const entry = entryArg || (cfg && cfg.toml && cfg.toml.project && cfg.toml.project.entry);

  if (!entry) {
    console.error("Error: file entry tidak ditentukan. Contoh: gatra graf src/utama.gatra");
    process.exit(1);
  }

  const entryAbs = path.resolve(entry);
  if (!fs.existsSync(entryAbs)) {
    console.error(`Error: File tidak ditemukan: ${entry}`);
    process.exit(1);
  }

  const nodes = buildGraph(entryAbs);
  const cwd   = process.cwd();

  if (format === "json") {
    console.log(renderGraphJson(nodes, cwd));
  } else if (format === "mermaid") {
    console.log(renderGraphMermaid(nodes, cwd));
  } else {
    console.log(renderGraphText(nodes, entryAbs, cwd));
    const cycles = findCycles(nodes, entryAbs);
    if (cycles.length > 0) {
      console.log("");
      for (const cycle of cycles) {
        console.log("⚠  circular dependency: " + cycle.map(p => path.relative(cwd, p)).join(" → "));
      }
    }
  }
}

// ── Explain (compiler analysis) ──────────────────────────────────────────────

function cmdExplain(filePath, fnFilter) {
  if (!fs.existsSync(filePath)) {
    console.error(`Error: File tidak ditemukan: ${filePath}`);
    process.exit(1);
  }

  const source = fs.readFileSync(filePath, "utf8");

  let analyses;
  try {
    analyses = analyzeFile(source);
  } catch (err) {
    console.error(formatError(err, source, filePath));
    process.exit(1);
  }

  if (fnFilter) analyses = analyses.filter(a => a.name === fnFilter);

  if (analyses.length === 0) {
    console.log(fnFilter ? `Fungsi '${fnFilter}' tidak ditemukan di ${filePath}` : `Tidak ada fungsi ditemukan di ${filePath}`);
    return;
  }

  analyses.forEach((a, i) => {
    if (i > 0) console.log("");
    console.log(`Fungsi: ${a.name}\n`);
    console.log("Klasifikasi\n");
    console.log(`  CPU-bound:       ${a.cpuBound ? "Ya" : "Tidak"}`);
    console.log(`  I/O-bound:       ${a.ioBound ? "Ya" : "Tidak"}`);
    console.log(`  Async:           ${a.isAsync ? "Ya" : "Tidak"}`);
    console.log(`  Parallelizable:  ${a.parallelizable ? "Ya" : "Tidak"}`);

    if (a.dependencies.length > 0) {
      console.log("\nDependensi\n");
      for (const d of a.dependencies) console.log(`  ${d}`);
    }

    console.log("\nEksekusi\n");
    console.log(`  Runtime:   Node.js`);
    console.log(`  Strategi:  ${a.strategy}`);
  });
}

// ── Bench (compiler + runtime performance) ───────────────────────────────────

function cmdBench(filePath) {
  if (!fs.existsSync(filePath)) {
    console.error(`Error: File tidak ditemukan: ${filePath}`);
    process.exit(1);
  }

  const source  = fs.readFileSync(filePath, "utf8");
  const grammar = detectGrammar(source);

  const tParse0 = performance.now();
  let ast;
  try {
    ast = parse(tokenize(source));
  } catch (err) {
    console.error(formatError(err, source, filePath));
    process.exit(1);
  }
  const tParse1 = performance.now();

  try {
    typecheck(ast, grammar, { filePath });
  } catch (err) {
    console.error(formatError(err, source, filePath));
    process.exit(1);
  }
  const tAnalysis1 = performance.now();

  generate(ast, { filePath });
  const tGen1 = performance.now();

  const parseMs    = tParse1 - tParse0;
  const analysisMs = tAnalysis1 - tParse1;
  const genMs       = tGen1 - tAnalysis1;
  const totalMs      = tGen1 - tParse0;

  console.log("Gatra Benchmark\n");
  console.log("Kompilasi\n");
  console.log(`  Parse:        ${parseMs.toFixed(1)} ms`);
  console.log(`  Analisis:     ${analysisMs.toFixed(1)} ms`);
  console.log(`  Generasi:     ${genMs.toFixed(1)} ms`);
  console.log(`  Total:        ${totalMs.toFixed(1)} ms`);
  console.log("");

  // Node.js process-startup baseline, so the entry's own run time below can
  // be read against it — 'jalankan' below still includes recompiling the
  // file (this reuses the normal run pipeline instead of a bench-only
  // one), so it's reported as compile+execution together, not isolated.
  const tStartup0 = Date.now();
  spawnSync(process.execPath, ["-e", '""']);
  const startupMs = Date.now() - tStartup0;

  const tRun0 = Date.now();
  spawnSync(process.execPath, [__filename, "jalankan", filePath], { stdio: "ignore" });
  const runMs = Date.now() - tRun0;

  console.log("Runtime\n");
  console.log(`  Startup Node.js:            ${startupMs} ms`);
  console.log(`  Jalankan (kompilasi+eksekusi): ${runMs} ms`);
}

// ── Pengelola Paket ───────────────────────────────────────────────────────────
// Gatra v0.1 tidak punya package manager sendiri (Non-Goal) — proyek baru
// langsung pakai package.json/npm/node_modules standar Node.js.

const ARCH_TYPES = ["sederhana", "modular", "clean", "hexagonal", "microservice"];

function writeProjectFile(dir, relPath, content) {
  const full = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf8");
}

function pkgJson(name, extra = {}) {
  return JSON.stringify({ name, version: "0.1.0", type: "module", ...extra }, null, 2) + "\n";
}

// Tiap builder balikin { "path/relatif.ext": "isi file" } — dipakai contoh
// domain 'Pengguna' yang sama di semua arsitektur biar gampang dibandingkan
// satu sama lain.
const ARCH_BUILDERS = {
  sederhana(name) {
    return {
      "package.json": pkgJson(name, { scripts: { start: "gatra jalankan utama.gatra" } }),
      "utama.gatra": `fungsi utama() {\n  cetak("Halo, ${name}!")\n}\n\nutama()\n`,
    };
  },

  // Modular: satu folder per fitur (modul) di src/modul/<nama>/ — model +
  // layanan (business logic) + controller (presentasi) sefolder, gampang
  // nambah modul baru tanpa nyentuh modul lain.
  // Catatan desain: tiap "layanan"/"controller" di sini modul FUNGSI (gaya
  // Go — namespace impor 'impor x dari "..."' lalu 'x.Nama(...)'), bukan
  // struct+receiver-method. Method lintas file belum didukung Gatra (tabel
  // method di typechecker cuma diisi dari deklarasi 'fungsi (r T) ...' di
  // FILE YANG SAMA — struct yang diimpor cuma bawa field, method-nya
  // ketinggalan); fungsi biasa lintas file sudah kebukti jalan (lihat
  // examples/paket_utama.gatra + paket_matematika.gatra).
  //
  // 'Pengguna' juga sengaja gak diimpor lintas file: struct tanpa method
  // dikompile jadi komentar dok (nol representasi runtime — literalnya
  // langsung jadi object literal di tiap pemakaian), jadi belum ada apa pun
  // buat diimpor. Anotasi tipe ('daftar: Pengguna[]') tetap valid tanpa
  // deklarasi lokal; struct-literal ('Pengguna { ... }') tetap butuh
  // deklarasinya ada di FILE YANG SAMA, makanya dobel di pengguna.model.gatra
  // (dokumentasi) dan di sini (dipakai beneran).
  modular(name) {
    return {
      "package.json": pkgJson(name, { scripts: { start: "gatra jalankan src/utama.gatra" } }),

      "src/modul/pengguna/pengguna.model.gatra":
`// pengguna.model.gatra — model domain modul 'pengguna'

struktur Pengguna {
  id: teks
  nama: teks
}
`,

      "src/modul/pengguna/pengguna.layanan.gatra":
`// pengguna.layanan.gatra — business logic modul 'pengguna'

fungsi Semua(daftar: Pengguna[]): Pengguna[] {
  balik daftar
}

fungsi Satu(daftar: Pengguna[], id: teks): Pengguna? {
  untuk p dalam daftar {
    jika p.id == id {
      balik p
    }
  }
  balik kosong
}
`,

      "src/modul/pengguna/pengguna.controller.gatra":
`// pengguna.controller.gatra — lapisan presentasi modul 'pengguna'

impor layanan dari "./pengguna.layanan.gatra"

fungsi Semua(daftar: Pengguna[]): Pengguna[] {
  balik layanan.Semua(daftar)
}

fungsi Satu(daftar: Pengguna[], id: teks): Pengguna? {
  balik layanan.Satu(daftar, id)
}
`,

      "src/utama.gatra":
`// utama.gatra — entry point, merakit modul 'pengguna'
//
// Struktur modular: tiap fitur punya folder sendiri di src/modul/<nama>/,
// nambah fitur baru = nambah folder modul baru, gak nyentuh yang lain.

impor controller dari "./modul/pengguna/pengguna.controller.gatra"

struktur Pengguna {
  id: teks
  nama: teks
}

fungsi utama() {
  isi daftar = [
    Pengguna { id: "1", nama: "Andi" },
    Pengguna { id: "2", nama: "Budi" }
  ]

  cetak(controller.Semua(daftar))
  cetak(controller.Satu(daftar, "2"))
}

utama()
`,
    };
  },

  // Clean Architecture: domain (entitas, nol dependensi) → aplikasi (use
  // case, cuma bergantung ke domain) → infrastruktur (implementasi nyata,
  // juga cuma bergantung ke domain) → presentasi (controller). Cuma
  // src/utama.gatra (composition root) yang boleh kenal ke-4 lapisan.
  // 'Pengguna' didekralasikan lokal di tiap file yang beneran mengonstruksi
  // literalnya (repositori) — bukan diimpor dari domain/entitas/, karena
  // struct tanpa method dikompile jadi komentar dok (nol representasi
  // runtime, belum ada apa pun buat diimpor); lihat catatan lebih lengkap
  // di ARCH_BUILDERS.modular di atas.
  clean(name) {
    return {
      "package.json": pkgJson(name, { scripts: { start: "gatra jalankan src/utama.gatra" } }),

      "src/domain/entitas/pengguna.gatra":
`// pengguna.gatra — entitas domain (lapisan Domain)
// Nol dependensi ke lapisan lain — aturan paling inti Clean Architecture.

struktur Pengguna {
  id: teks
  nama: teks
}
`,

      "src/aplikasi/layanan/pengguna_layanan.gatra":
`// pengguna_layanan.gatra — use case (lapisan Aplikasi)
// Cuma bergantung ke Domain — data (Pengguna[]) dikirim lewat parameter,
// jadi lapisan ini gak perlu tahu datanya datang dari mana (database asli,
// memori, API luar, dst — itu urusan Infrastruktur). Tipe 'Pengguna' dipakai
// cuma sebagai anotasi di sini (gak dikonstruksi), jadi valid tanpa struct
// itu dideklarasikan lokal.

fungsi CariSatu(daftar: Pengguna[], id: teks): Pengguna? {
  untuk p dalam daftar {
    jika p.id == id {
      balik p
    }
  }
  balik kosong
}
`,

      "src/infrastruktur/penyimpanan/pengguna_repositori.gatra":
`// pengguna_repositori.gatra — lapisan Infrastruktur
// Masih in-memory di sini — ganti isi Semua() ke query database/API asli
// buat produksi, Domain & Aplikasi sama sekali gak perlu berubah.
//
// 'pengguna' (huruf kecil) di bawah murni internal buat file ini — nama
// diawali huruf kecil = gak diekspor (visibility gaya Go), yang penting di
// sini karena file ini sendiri diimpor oleh src/utama.gatra: kalau namanya
// 'Pengguna' (besar), codegen coba 'export'-nya juga — tapi struct tanpa
// method dikompile jadi komentar dok (nol representasi runtime), jadi
// exportnya nabrak sintaks. Bentuknya tetap sama dengan Pengguna di
// domain/entitas/pengguna.gatra, cuma beda nama binding.

struktur pengguna {
  id: teks
  nama: teks
}

fungsi Semua(): pengguna[] {
  balik [
    pengguna { id: "1", nama: "Andi" },
    pengguna { id: "2", nama: "Budi" }
  ]
}
`,

      "src/presentasi/pengguna_controller.gatra":
`// pengguna_controller.gatra — lapisan Presentasi
// Nerjemahin request luar jadi panggilan ke use case (Aplikasi).

impor layanan dari "../aplikasi/layanan/pengguna_layanan.gatra"

fungsi CariSatu(daftar: Pengguna[], id: teks): Pengguna? {
  balik layanan.CariSatu(daftar, id)
}
`,

      "src/utama.gatra":
`// utama.gatra — composition root
// Satu-satunya tempat ke-4 lapisan (domain/aplikasi/infrastruktur/
// presentasi) ketemu dan dirakit jadi satu.

impor repositori dari "./infrastruktur/penyimpanan/pengguna_repositori.gatra"
impor controller dari "./presentasi/pengguna_controller.gatra"

fungsi utama() {
  isi daftar = repositori.Semua()
  cetak(controller.CariSatu(daftar, "2"))
}

utama()
`,
    };
  },

  // Hexagonal (Ports & Adapters): domain di tengah (model + use case), port/
  // mendokumentasikan kontrak masuk & keluar, adapter/ isi implementasi
  // nyatanya. Gatra belum punya interface asli, jadi file di port/ itu
  // dokumentasi kontrak (komentar) — bukan dipaksa lewat sistem tipe;
  // gantinya adapter cukup punya fungsi dengan bentuk yang sama.
  // 'Pengguna' juga didekralasikan lokal di tiap file yang beneran
  // mengonstruksi literalnya, bukan diimpor dari domain/ — sama alasannya
  // dengan ARCH_BUILDERS.modular di atas.
  hexagonal(name) {
    return {
      "package.json": pkgJson(name, { scripts: { start: "gatra jalankan src/utama.gatra" } }),

      "src/domain/pengguna.gatra":
`// pengguna.gatra — model inti (Domain)

struktur Pengguna {
  id: teks
  nama: teks
}
`,

      "src/domain/pengguna_layanan.gatra":
`// pengguna_layanan.gatra — logika inti / use case (Domain)
// Cuma tahu bentuk data (Pengguna), gak tahu itu dari database/API/memori
// — data dikirim lewat parameter oleh adapter masuk yang manggil ini.

fungsi CariSatu(daftar: Pengguna[], id: teks): Pengguna? {
  untuk p dalam daftar {
    jika p.id == id {
      balik p
    }
  }
  balik kosong
}
`,

      "src/port/keluar/pengguna_repositori_port.gatra":
`// pengguna_repositori_port.gatra — kontrak PORT KELUAR (outbound port)
//
// Dokumentasi kontrak, bukan interface yang dipaksa compiler (Gatra belum
// punya interface asli): tiap adapter keluar (lihat src/adapter/keluar/*)
// diharapkan punya fungsi 'Semua(): Pengguna[]' dengan bentuk ini.
`,

      "src/port/masuk/pengguna_port.gatra":
`// pengguna_port.gatra — kontrak PORT MASUK (inbound port)
//
// Dokumentasi kontrak: tiap adapter masuk (lihat src/adapter/masuk/*)
// diharapkan manggil pengguna_layanan.CariSatu(daftar, id) buat masuk ke
// domain, gak peduli protokolnya HTTP/CLI/message queue/dst.
`,

      "src/adapter/keluar/memori/pengguna_repositori_memori.gatra":
`// pengguna_repositori_memori.gatra — ADAPTER KELUAR (outbound adapter)
// Implementasi in-memory dari kontrak di port/keluar/. Ganti isi Semua()
// ini ke database/API asli buat produksi — domain & port gak perlu berubah.
//
// 'pengguna' (huruf kecil) di bawah murni internal buat file ini (visibility
// gaya Go: huruf kecil = gak diekspor) — lihat catatan yang sama di
// ARCH_BUILDERS.clean di atas soal kenapa itu perlu di sini.

struktur pengguna {
  id: teks
  nama: teks
}

fungsi Semua(): pengguna[] {
  balik [
    pengguna { id: "1", nama: "Andi" },
    pengguna { id: "2", nama: "Budi" }
  ]
}
`,

      "src/adapter/masuk/http/pengguna_controller.gatra":
`// pengguna_controller.gatra — ADAPTER MASUK (inbound adapter) sisi HTTP
// Nerjemahin request luar jadi panggilan ke domain — ganti ke adapter
// masuk lain (CLI, message queue, dst) tanpa nyentuh domain.

impor layanan dari "../../../domain/pengguna_layanan.gatra"

fungsi CariSatu(daftar: Pengguna[], id: teks): Pengguna? {
  balik layanan.CariSatu(daftar, id)
}
`,

      "src/utama.gatra":
`// utama.gatra — composition root
// Satu-satunya tempat domain, port, dan adapter (masuk & keluar) dirakit.

impor repositori dari "./adapter/keluar/memori/pengguna_repositori_memori.gatra"
impor controller dari "./adapter/masuk/http/pengguna_controller.gatra"

fungsi utama() {
  isi daftar = repositori.Semua()
  cetak(controller.CariSatu(daftar, "2"))
}

utama()
`,
    };
  },

  // Microservice: tiap layanan di services/<nama>/ independen — package.json
  // & runtime sendiri, deploy terpisah. Layanan TIDAK saling impor kode
  // langsung (beda proses); bersama/ cuma referensi kontrak/DTO buat
  // di-copy ke layanan yang butuh, bukan diimpor lintas-layanan.
  microservice(name) {
    return {
      "package.json": JSON.stringify({ name, private: true, workspaces: ["services/*"] }, null, 2) + "\n",

      "services/gerbang-api/package.json": pkgJson(`${name}-gerbang-api`, { scripts: { start: "gatra jalankan utama.gatra" } }),
      "services/gerbang-api/utama.gatra":
`// utama.gatra — gerbang-api (API Gateway)
// Titik masuk tunggal ke semua layanan lain di services/* — tambah routing
// ke layanan lain (mis. layanan-pengguna) sesuai kebutuhan.

fungsi utama() {
  cetak("gerbang-api jalan — arahin request ke layanan yang sesuai (mis. layanan-pengguna)")
}

utama()
`,

      "services/layanan-pengguna/package.json": pkgJson(`${name}-layanan-pengguna`, { scripts: { start: "gatra jalankan utama.gatra" } }),
      "services/layanan-pengguna/utama.gatra":
`// utama.gatra — layanan-pengguna
// Layanan independen: package.json & runtime sendiri, deploy terpisah dari
// layanan lain. Bentuk data yang dipakai lintas-layanan ada di
// bersama/kontrak/ — di-copy ke sini, bukan diimpor relatif lintas-layanan.

struktur Pengguna {
  id: teks
  nama: teks
}

isi daftarPengguna = [
  Pengguna { id: "1", nama: "Andi" },
  Pengguna { id: "2", nama: "Budi" }
]

fungsi utama() {
  cetak("layanan-pengguna jalan")
  cetak(daftarPengguna)
}

utama()
`,

      "bersama/kontrak/pengguna_kontrak.gatra":
`// pengguna_kontrak.gatra — kontrak/DTO bersama
//
// Di arsitektur microservice, layanan TIDAK saling impor kode langsung
// (tiap services/* independen — beda proses, beda deploy). File di sini
// cuma referensi bentuk data yang disepakati antar layanan; kalau layanan
// lain butuh bentuk yang sama, copy strukturnya ke layanan itu sendiri.

struktur Pengguna {
  id: teks
  nama: teks
}
`,
    };
  },
};

function cmdInit(name, arch = "sederhana") {
  if (!name) {
    console.error("Error: nama proyek tidak ditentukan. Contoh: gatra buat proyek-saya");
    process.exit(1);
  }
  if (!ARCH_TYPES.includes(arch)) {
    console.error(`Error: --arch '${arch}' tidak dikenal. Pilihan: ${ARCH_TYPES.join(", ")}`);
    process.exit(1);
  }
  const dir = path.resolve(name);
  if (fs.existsSync(dir)) {
    console.error(`Error: '${name}' sudah ada.`);
    process.exit(1);
  }

  fs.mkdirSync(dir, { recursive: true });

  const entry = arch === "sederhana" ? "utama.gatra"
    : arch === "microservice" ? "services/layanan-pengguna/utama.gatra"
    : "src/utama.gatra";

  const buildSource = arch === "sederhana" ? "."
    : arch === "microservice" ? "services"
    : "src";

  const files = ARCH_BUILDERS[arch](name);
  files["gatra.toml"] = stringifyToml({
    project: { name, version: "0.1.0", architecture: arch, entry },
    build:   { source: buildSource, output: "dist", target: "node" },
    test:    { directory: "tests" },
    format:  { indent: 2 },
  });

  const paths = Object.keys(files).sort();
  for (const relPath of paths) {
    writeProjectFile(dir, relPath, files[relPath]);
  }

  console.log(`  ✓  Proyek '${name}' dibuat [--arch ${arch}]\n`);
  for (const relPath of paths) console.log(`    ${relPath}`);
  console.log(`\ncd ${name}\ngatra jalankan ${entry}`);
}

function cmdVersion() {
  console.log(`Gatra ${GATRA_VERSION}`);
  console.log(`Compiler: ${GATRA_VERSION}`);
  console.log(`Target: JavaScript`);
  console.log(`Runtime: Node.js`);
}

function cmdHelp() {
  console.log(`Gatra — Bahasa pemrograman yang dikompilasi ke JavaScript

PENGGUNAAN

  gatra buat [nama]                            Inisialisasi proyek Gatra
  gatra buat [nama] --arch sederhana           Project sederhana
  gatra buat [nama] --arch modular             Modular architecture
  gatra buat [nama] --arch clean               Clean architecture
  gatra buat [nama] --arch hexagonal           Hexagonal architecture
  gatra buat [nama] --arch microservice        Microservice architecture
  gatra info                                   Info proyek (baca gatra.toml)

PENGEMBANGAN
  gatra kembangkan [file]                      Mode development (watch + restart)
  gatra jalankan <file>                        Kompilasi dan jalankan file
  gatra uji [file]                             Jalankan pengujian (proyek jika tanpa file)
  gatra periksa <file>                         Analisis statis
  gatra rapikan <file> [--tulis]                Format kode

BUILD
  gatra bangun <file> [output] [--samar]       Kompilasi file ke JavaScript
  gatra bundel <entry> [output] [--samar]      Bundle dependensi ke satu file
  gatra bangun-proyek <dir> [dist] [--samar]   Kompilasi seluruh proyek
  gatra bersihkan [dir]                        Hapus dist/, .gatra/, .cache/

ANALISIS
  gatra graf [file] [--format json|mermaid]    Dependency graph
  gatra jelaskan <file> [fungsi]                Analisis compiler per fungsi
  gatra ukur <file>                             Benchmark compilasi & runtime
  gatra dokter                                  Diagnostic environment

SISTEM
  gatra versi                                  Tampilkan versi compiler
  gatra bantuan                                Tampilkan bantuan

Gatra tidak punya package manager sendiri — pakai npm langsung
(npm install, npm update, npm uninstall) untuk dependensi.

Opsi:
  --samar   Hasilkan kode yang disamarkan (identifier dienkripsi, string diubah ke unicode)
  --arch    Struktur folder proyek baru: sederhana (default) | modular | clean | hexagonal | microservice

Contoh:
  gatra buat toko-online --arch clean
  gatra jalankan halo.gatra
  gatra kembangkan
  gatra bangun paket_matematika.gatra
  gatra bundel paket_utama.gatra
  gatra bundel paket_utama.gatra dist/app.js
  gatra bundel paket_utama.gatra dist/app.js --samar
  gatra bangun-proyek src/ dist/
  gatra bangun-proyek src/ dist/ --samar
  gatra graf src/utama.gatra --format mermaid
  gatra jelaskan src/utama.gatra
  gatra ukur src/utama.gatra
`);
}

// ── Entry point ───────────────────────────────────────────────────────────────

const [, , cmd, ...args] = process.argv;

switch (cmd) {
  case "run":
  case "jalankan":
    if (!args[0]) {
      console.error("Error: file tidak ditentukan.");
      process.exit(1);
    }
    cmdRun(args[0]);
    break;

  case "build":
  case "bangun": {
    const samar    = args.includes("--samar");
    const fileArgs = args.filter(a => !a.startsWith("--"));
    if (!fileArgs[0]) {
      console.error("Error: file tidak ditentukan.");
      process.exit(1);
    }
    cmdBuild(fileArgs[0], fileArgs[1] || null, samar);
    break;
  }

  case "bundle":
  case "bundel": {
    const samar    = args.includes("--samar");
    const fileArgs = args.filter(a => !a.startsWith("--"));
    if (!fileArgs[0]) {
      console.error("Error: file entry tidak ditentukan.");
      process.exit(1);
    }
    cmdBundle(fileArgs[0], fileArgs[1] || null, samar);
    break;
  }

  case "build-project":
  case "bangun-proyek": {
    const samar    = args.includes("--samar");
    const fileArgs = args.filter(a => !a.startsWith("--"));
    if (!fileArgs[0]) {
      console.error("Error: direktori tidak ditentukan.");
      process.exit(1);
    }
    cmdBuildProject(fileArgs[0], fileArgs[1] || null, samar);
    break;
  }

  case "test":
  case "uji": {
    if (args[0]) {
      cmdTest(args[0]);
    } else {
      const cfg = loadConfig(process.cwd());
      const testDir = (cfg && cfg.toml && cfg.toml.test && cfg.toml.test.directory) || "tests";
      cmdTestProject(testDir);
    }
    break;
  }

  case "lint":
  case "periksa":
    if (!args[0]) {
      console.error("Error: file tidak ditentukan.");
      process.exit(1);
    }
    cmdLint(args[0]);
    break;

  case "format":
  case "rapikan": {
    const write = args.includes("--tulis") || args.includes("-w");
    const fileArgs = args.filter(a => !a.startsWith("-"));
    if (!fileArgs[0]) {
      console.error("Error: file tidak ditentukan.");
      process.exit(1);
    }
    cmdFormat(fileArgs[0], write);
    break;
  }

  case "create":
  case "buat": {
    const archIdx = args.indexOf("--arch");
    const arch    = archIdx !== -1 ? args[archIdx + 1] : "sederhana";
    const fileArgs = archIdx === -1 ? args : args.filter((_, i) => i !== archIdx && i !== archIdx + 1);
    cmdInit(fileArgs[0], arch);
    break;
  }

  case "dev":
  case "kembangkan":
    cmdDev(args[0]);
    break;

  case "clean":
  case "bersihkan":
    cmdClean(args[0]);
    break;

  case "doctor":
  case "dokter":
    cmdDoctor();
    break;

  case "info":
    cmdInfo();
    break;

  case "graph":
  case "graf": {
    const fmtIdx  = args.indexOf("--format");
    const fmt     = fmtIdx !== -1 ? args[fmtIdx + 1] : null;
    const fileArgs = fmtIdx === -1 ? args : args.filter((_, i) => i !== fmtIdx && i !== fmtIdx + 1);
    cmdGraph(fileArgs[0] || null, fmt);
    break;
  }

  case "explain":
  case "jelaskan":
    if (!args[0]) {
      console.error("Error: file tidak ditentukan.");
      process.exit(1);
    }
    cmdExplain(args[0], args[1] || null);
    break;

  case "bench":
  case "ukur":
    if (!args[0]) {
      console.error("Error: file tidak ditentukan.");
      process.exit(1);
    }
    cmdBench(args[0]);
    break;

  case "version":
  case "versi":
    cmdVersion();
    break;

  case "help":
  case "bantuan":
  case undefined:
    cmdHelp();
    break;

  default:
    console.error(
      `Perintah tidak dikenal: '${cmd}'\nJalankan 'gatra bantuan' untuk info.`,
    );
    process.exit(1);
}
