#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { spawnSync } = require("child_process");
const os = require("os");

const { tokenize } = require("../lexer/lexer");
const { parse } = require("../parser/parser");
const { typecheck } = require("../typechecker/typechecker");
const { ownershipCheck } = require("../ownership/ownership-checker");
const { irNormalize } = require("../ir/ir-normalizer");
const { generate } = require("../codegen/codegen");
const { obfuscate } = require("../codegen/obfuscator");
const { detectGrammar } = require("../lexer/keywords");
const { lint } = require("../linter/linter");
const { format } = require("../formatter/formatter");
const { startServer } = require("../lsp/server");

// ── Compiler pipeline ─────────────────────────────────────────────────────────

function compile(source, opts) {
  const grammar = detectGrammar(source);
  const tokens = tokenize(source);
  const ast = parse(tokens);
  typecheck(ast, grammar);
  ownershipCheck(ast, grammar);
  irNormalize(ast);
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

function runEsm(sourceFile, js, _sourceCode) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gatra_"));
  const sourceDir = path.dirname(path.resolve(sourceFile));

  try {
    const localMgRe = /from ("\.\.?\/[^"]+\.gatra")/g;
    let finalJs = js;

    for (const match of js.matchAll(localMgRe)) {
      const quoted = match[1];
      const mgRelPath = quoted.slice(1, -1);
      const mgAbsPath = path.resolve(sourceDir, mgRelPath);

      if (!fs.existsSync(mgAbsPath)) {
        console.error(`ModulTidakDitemukan: '${mgAbsPath}' tidak ada`);
        process.exit(1);
      }

      const mgSrc = fs.readFileSync(mgAbsPath, "utf8");
      let mgJs;
      try {
        mgJs = compile(mgSrc);
      } catch (err) {
        console.error(formatError(err, mgSrc, mgAbsPath));
        process.exit(1);
      }

      const tmpMjs = path.join(tmpDir, path.basename(mgAbsPath, ".gatra") + ".js");
      fs.writeFileSync(tmpMjs, mgJs, "utf8");
      finalJs = finalJs
        .split(`from ${quoted}`)
        .join(`from ${JSON.stringify(tmpMjs)}`);
    }

    const mainMjs = path.join(tmpDir, "main.js");
    fs.writeFileSync(mainMjs, finalJs, "utf8");

    const result = spawnSync(process.execPath, [mainMjs], { stdio: "inherit" });
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

  for (const m of source.matchAll(/impor\s+\w+\s+dari\s+"(\.\.?\/[^"]+\.gatra)"/g)) {
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
      js = compile(source);
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
    js = compile(source);
  } catch (err) {
    console.error(formatError(err, source, filePath));
    process.exit(1);
  }

  try {
    if (js.includes("import ") || js.includes("export ")) {
      runEsm(filePath, js, source);
    } else {
      const ctx = vm.createContext({
        console,
        process,
        require,
        __filename: path.resolve(filePath),
        __dirname: path.dirname(path.resolve(filePath)),
      });
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
    js = compile(source, { includeTests: true });
  } catch (err) {
    console.error(formatError(err, source, filePath));
    process.exit(1);
  }

  try {
    if (js.includes("import ") || js.includes("export ")) {
      runEsm(filePath, js, source);
    } else {
      const ctx = vm.createContext({
        console,
        process,
        require,
        __filename: path.resolve(filePath),
        __dirname: path.dirname(path.resolve(filePath)),
      });
      new vm.Script(js, { filename: filePath }).runInContext(ctx);
    }
  } catch (err) {
    console.error(`RuntimeError: ${err.message}`);
    process.exit(1);
  }
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
  for (const match of source.matchAll(/impor\s+\w+\s+dari\s+"(\.\.?\/[^"]+\.gatra)"/g)) {
    const depAbs = path.resolve(srcDir, match[1]);
    buildWithDeps(depAbs, outDir, samar, seen);
  }

  let js;
  try {
    js = compile(source);
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
      let js = compile(source);
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

// ── Pengelola Paket ───────────────────────────────────────────────────────────
// MVP: tidak ada registry Gatra sendiri — 'pasang'/'perbarui'/'hapus' membungkus
// npm secara langsung, konsisten dengan prinsip "JavaScript adalah fondasi"
// (bagian 37) dan ekosistem Node.js yang sudah dipakai Gatra.

function cmdInit(name) {
  if (!name) {
    console.error("Error: nama proyek tidak ditentukan. Contoh: gatra mulai proyek-saya");
    process.exit(1);
  }
  const dir = path.resolve(name);
  if (fs.existsSync(dir)) {
    console.error(`Error: '${name}' sudah ada.`);
    process.exit(1);
  }

  fs.mkdirSync(dir, { recursive: true });

  const mod = `nama: ${name}\nversi: 0.1.0\n`;
  fs.writeFileSync(path.join(dir, "gatra.mod"), mod, "utf8");

  const utama = `fungsi utama() {\n  cetak("Halo, ${name}!")\n}\n\nutama()\n`;
  fs.writeFileSync(path.join(dir, "utama.gatra"), utama, "utf8");

  console.log(`  ✓  Proyek '${name}' dibuat`);
  console.log(`\ncd ${name}\ngatra jalankan utama.gatra`);
}

function runNpm(npmArgs) {
  const result = spawnSync("npm", npmArgs, { stdio: "inherit" });
  if (result.error) {
    console.error(`Error: gagal menjalankan npm — ${result.error.message}`);
    process.exit(1);
  }
  process.exit(result.status ?? 0);
}

function cmdInstall(pkgs) {
  runNpm(pkgs.length > 0 ? ["install", ...pkgs] : ["install"]);
}

function cmdUpdate(pkgs) {
  runNpm(pkgs.length > 0 ? ["update", ...pkgs] : ["update"]);
}

function cmdUninstall(pkgs) {
  if (pkgs.length === 0) {
    console.error("Error: nama paket tidak ditentukan. Contoh: gatra hapus lodash");
    process.exit(1);
  }
  runNpm(["uninstall", ...pkgs]);
}

function cmdClean() {
  const dist = path.resolve("dist");
  if (fs.existsSync(dist)) {
    fs.rmSync(dist, { recursive: true, force: true });
    console.log(`  ✓  '${path.relative(process.cwd(), dist)}' dihapus`);
  } else {
    console.log("  ✓  tidak ada artefak build untuk dibersihkan");
  }
}

function cmdVersion() {
  console.log("Gatra v0.1.0");
}

function cmdHelp() {
  console.log(`Gatra — Bahasa pemrograman yang dikompilasi ke JavaScript

Penggunaan:
  gatra mulai <nama>                           Buat proyek baru
  gatra jalankan <file>                        Kompilasi dan jalankan file .gatra
  gatra bangun <file> [output] [--samar]       Kompilasi satu file ke .js
  gatra bundel <entry> [output] [--samar]      Bundle semua dependensi ke satu file .js
  gatra bangun-proyek <dir> [dist] [--samar]   Kompilasi seluruh proyek
  gatra uji <file>                             Jalankan blok 'uji' dalam file
  gatra periksa <file>                         Analisis statis (linter)
  gatra rapikan <file> [--tulis]                Format kode (cetak ke stdout, atau --tulis untuk menimpa file)
  gatra pasang [paket...]                      Pasang dependensi npm (npm install)
  gatra perbarui [paket...]                    Perbarui dependensi npm (npm update)
  gatra hapus <paket...>                       Hapus dependensi npm (npm uninstall)
  gatra bersihkan                              Hapus artefak build (dist/)
  gatra lsp                                    Jalankan Gatra Language Server (stdio, diagnostics)
  gatra versi                                  Tampilkan versi compiler
  gatra bantuan                                Tampilkan bantuan ini

Opsi:
  --samar   Hasilkan kode yang disamarkan (identifier dienkripsi, string diubah ke unicode)

Contoh:
  gatra jalankan halo.gatra
  gatra bangun paket_matematika.gatra
  gatra bundel paket_utama.gatra
  gatra bundel paket_utama.gatra dist/app.js
  gatra bundel paket_utama.gatra dist/app.js --samar
  gatra bangun-proyek src/ dist/
  gatra bangun-proyek src/ dist/ --samar
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
  case "uji":
    if (!args[0]) {
      console.error("Error: file tidak ditentukan.");
      process.exit(1);
    }
    cmdTest(args[0]);
    break;

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

  case "init":
  case "mulai":
    cmdInit(args[0]);
    break;

  case "install":
  case "pasang":
    cmdInstall(args);
    break;

  case "update":
  case "perbarui":
    cmdUpdate(args);
    break;

  case "uninstall":
  case "hapus":
    cmdUninstall(args);
    break;

  case "clean":
  case "bersihkan":
    cmdClean();
    break;

  case "lsp":
    startServer();
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
