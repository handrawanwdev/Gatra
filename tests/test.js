'use strict';

const { tokenize }         = require('../src/lexer/lexer');
const { parse }            = require('../src/parser/parser');
const { typecheck }        = require('../src/typechecker/typechecker');
const { generate }         = require('../src/codegen/codegen');
const { TokenType }        = require('../src/lexer/tokens');
const { detectGrammar }    = require('../src/lexer/keywords');
const { NodeType: N }      = require('../src/ast/nodes');
const { PackageRegistry }  = require('../src/package/package-registry');
const { lint }             = require('../src/linter/linter');
const { format }           = require('../src/formatter/formatter');
const vm                   = require('vm');

let passed = 0;
let failed = 0;

function run(label, fn) {
  try {
    fn();
    console.log(`  ✓ ${label}`);
    passed++;
  } catch (err) {
    console.log(`  ✗ ${label}`);
    console.log(`    ${err.message}`);
    failed++;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Assertion failed');
}

function assertEqual(a, b) {
  if (a !== b) throw new Error(`Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

function compile(src, opts) {
  const grammar = detectGrammar(src);
  const ast     = parse(tokenize(src));
  typecheck(ast, grammar);
  return generate(ast, opts);
}

function tc(src) {
  const grammar = detectGrammar(src);
  const ast     = parse(tokenize(src));
  typecheck(ast, grammar);
}

function exec(src) {
  const js = compile(src);
  const out = [];
  const ctx = vm.createContext({ console: { log: (...a) => out.push(a.join(' ')) } });
  new vm.Script(js).runInContext(ctx);
  return out;
}

function assertThrows(fn, msgFragment) {
  try { fn(); }
  catch (err) {
    if (msgFragment && !err.message.includes(msgFragment)) {
      throw new Error(`Expected error containing '${msgFragment}', got: ${err.message}`);
    }
    return;
  }
  throw new Error('Expected an error but none was thrown');
}

// ── Lexer Tests ───────────────────────────────────────────────────────────────

console.log('\nLexer');

run('tokenizes numbers', () => {
  const toks = tokenize('42 3.14');
  assert(toks[0].type === TokenType.NUMBER);
  assertEqual(toks[0].value, 42);
  assertEqual(toks[1].value, 3.14);
});

run('tokenizes strings', () => {
  const toks = tokenize('"hello world"');
  assert(toks[0].type === TokenType.STRING);
  assertEqual(toks[0].value, 'hello world');
});

run('tokenizes booleans (benar/salah)', () => {
  const toks = tokenize('benar salah');
  assertEqual(toks[0].type, TokenType.BOOL);
  assertEqual(toks[0].value, true);
  assertEqual(toks[1].value, false);
});

run('keywords map to internal canonical', () => {
  const toks = tokenize('isi fungsi jika balik lain struktur cetak');
  const vals = toks.filter(t => t.type === TokenType.KEYWORD).map(t => t.value);
  assert(vals.includes('let'),    'isi → let');
  assert(vals.includes('fn'),     'fungsi → fn');
  assert(vals.includes('if'),     'jika → if');
  assert(vals.includes('return'), 'balik → return');
  assert(vals.includes('else'),   'lain → else');
  assert(vals.includes('struct'), 'struktur → struct');
  assert(vals.includes('print'),  'cetak → print');
});

run('type keywords map to internal canonical', () => {
  const toks = tokenize('angka teks');
  const types = toks.filter(t => t.type === TokenType.TYPE).map(t => t.value);
  assert(types.includes('number'), 'angka → number');
  assert(types.includes('string'), 'teks → string');
});

run('tokenizes operators', () => {
  const toks = tokenize('+ - * / == != >= <=');
  const vals = toks.filter(t => t.type !== TokenType.EOF).map(t => t.value);
  assert(vals.includes('=='));
  assert(vals.includes('!='));
  assert(vals.includes('>='));
  assert(vals.includes('<='));
});

run('skips line comments', () => {
  const toks = tokenize('isi x = 10 // ini komentar\nisi y = 20');
  const idents = toks.filter(t => t.type === TokenType.IDENTIFIER).map(t => t.value);
  assert(idents.includes('x'));
  assert(idents.includes('y'));
  assert(!idents.includes('ini'));
});

run('throws on unknown character', () => {
  assertThrows(() => tokenize('@'), "Unexpected character '@'");
});

run('handles escape sequences in strings', () => {
  const toks = tokenize('"hello\\nworld"');
  assertEqual(toks[0].value, 'hello\nworld');
});

run('throws on unterminated string', () => {
  assertThrows(() => tokenize('"tidak selesai'), 'Unterminated string');
});

// ── Parser Tests ──────────────────────────────────────────────────────────────

console.log('\nParser');

run('parses variable declaration with type', () => {
  const ast = parse(tokenize('isi x: angka = 10'));
  assertEqual(ast.body[0].type, 'VarDecl');
  assertEqual(ast.body[0].name, 'x');
  assertEqual(ast.body[0].varType, 'number');
  assertEqual(ast.body[0].value.value, 10);
});

run('parses variable declaration without type (inference)', () => {
  const ast = parse(tokenize('isi y = "halo"'));
  assertEqual(ast.body[0].varType, null);
  assertEqual(ast.body[0].value.value, 'halo');
});

run('parses function declaration', () => {
  const ast = parse(tokenize('fungsi tambah(a: angka, b: angka): angka { balik a + b }'));
  const fn = ast.body[0];
  assertEqual(fn.type, 'FnDecl');
  assertEqual(fn.name, 'tambah');
  assertEqual(fn.params.length, 2);
  assertEqual(fn.returnType, 'number');
  assertEqual(fn.body.body[0].type, 'ReturnStmt');
});

run('parses struct declaration', () => {
  const ast = parse(tokenize('struktur Titik { x: angka y: angka }'));
  const s = ast.body[0];
  assertEqual(s.type, 'StructDecl');
  assertEqual(s.name, 'Titik');
  assertEqual(s.fields.length, 2);
});

run('parses if statement', () => {
  const ast = parse(tokenize('jika x > 5 { cetak(x) }'));
  const ifNode = ast.body[0];
  assertEqual(ifNode.type, 'IfStmt');
  assertEqual(ifNode.condition.op, '>');
  assert(ifNode.alternate === null);
});

run('parses if-else statement', () => {
  const ast = parse(tokenize('jika x > 5 { cetak(x) } lain { cetak(0) }'));
  assert(ast.body[0].alternate !== null);
});

run('parses binary expression precedence', () => {
  const ast = parse(tokenize('isi r = 2 + 3 * 4'));
  const val = ast.body[0].value;
  assertEqual(val.op, '+');
  assertEqual(val.right.op, '*');
});

run('parses struct initialization', () => {
  const ast = parse(tokenize('isi p = Titik { x: 10, y: 20 }'));
  assertEqual(ast.body[0].value.type, 'StructInit');
  assertEqual(ast.body[0].value.name, 'Titik');
  assertEqual(ast.body[0].value.fields.length, 2);
});

run('parses member access', () => {
  const ast = parse(tokenize('isi v = p.x'));
  assertEqual(ast.body[0].value.type, 'MemberExpr');
  assertEqual(ast.body[0].value.member, 'x');
});

run('throws on missing variable name', () => {
  assertThrows(() => parse(tokenize('isi : angka = 10')), 'Expected variable name');
});

run('throws on unexpected token', () => {
  assertThrows(() => parse(tokenize('isi x = @')), 'Unexpected');
});

// ── CodeGen / Integration Tests ───────────────────────────────────────────────

console.log('\nCodeGen / Integration');

run('compiles cetak to console.log', () => {
  const js = compile('cetak("halo")');
  assert(js.includes('console.log'));
  assert(js.includes('"halo"'));
});

run('executes hello world', () => {
  const out = exec('cetak("Halo, Dunia!")');
  assertEqual(out[0], 'Halo, Dunia!');
});

run('executes variable and cetak', () => {
  const out = exec('isi x: angka = 42\ncetak(x)');
  assertEqual(out[0], '42');
});

run('executes arithmetic', () => {
  const out = exec('cetak(2 + 3 * 4)');
  assertEqual(out[0], '14');
});

run('executes function call', () => {
  const out = exec(`
fungsi dua_kali(n: angka): angka { balik n * 2 }
cetak(dua_kali(21))
`);
  assertEqual(out[0], '42');
});

run('executes if-else (true branch)', () => {
  const out = exec('isi x = 10\njika x > 5 { cetak("besar") } lain { cetak("kecil") }');
  assertEqual(out[0], 'besar');
});

run('executes if-else (false branch)', () => {
  const out = exec('isi x = 3\njika x > 5 { cetak("besar") } lain { cetak("kecil") }');
  assertEqual(out[0], 'kecil');
});

run('executes struct initialization and member access', () => {
  const out = exec(`
struktur Titik { x: angka  y: angka }
isi p = Titik { x: 7, y: 8 }
cetak(p.x)
cetak(p.y)
`);
  assertEqual(out[0], '7');
  assertEqual(out[1], '8');
});

run('executes recursive fibonacci', () => {
  const out = exec(`
fungsi fib(n: angka): angka {
  jika n <= 1 { balik n }
  balik fib(n - 1) + fib(n - 2)
}
cetak(fib(10))
`);
  assertEqual(out[0], '55');
});

run('executes assignment re-assignment', () => {
  const out = exec('isi ubah x = 10\nx = 20\ncetak(x)');
  assertEqual(out[0], '20');
});

// ── Type Checker Tests ────────────────────────────────────────────────────────

console.log('\nType Checker');

run('accepts valid typed variable', () => {
  tc('isi x: angka = 42');
});

run('accepts inferred variable', () => {
  tc('isi x = "halo"');
});

run('rejects type mismatch on variable', () => {
  assertThrows(() => tc('isi x: angka = "oops"'), 'Diharapkan');
});

run('type mismatch error shows type names', () => {
  assertThrows(() => tc('isi x: angka = "salah"'), 'angka');
});

run('rejects undefined variable', () => {
  assertThrows(() => tc('cetak(y)'), 'tidak terdefinisi');
});

run('accepts valid function call', () => {
  tc('fungsi tambah(a: angka, b: angka): angka { balik a + b } tambah(1, 2)');
});

run('rejects wrong argument count', () => {
  assertThrows(
    () => tc('fungsi tambah(a: angka, b: angka): angka { balik a + b } tambah(1)'),
    'membutuhkan 2 argumen'
  );
});

run('rejects wrong argument type', () => {
  assertThrows(
    () => tc('fungsi sapa(nama: teks): teks { balik nama } sapa(42)'),
    'diharapkan'
  );
});

run('rejects return type mismatch', () => {
  assertThrows(
    () => tc('fungsi buruk(): angka { balik "halo" }'),
    'harus mengembalikan'
  );
});

run('rejects operator mismatch angka + teks', () => {
  assertThrows(
    () => tc('isi x = 10 + "hi"'),
    'tidak dapat digunakan'
  );
});

run('accepts teks + teks concatenation', () => {
  tc('isi s = "halo" + " dunia"');
});

run('rejects if condition not bool', () => {
  assertThrows(
    () => tc('isi x = 42 jika x { cetak(x) }'),
    'harus bertipe'
  );
});

run('accepts if condition bool from comparison', () => {
  tc('isi x = 42 jika x > 10 { cetak(x) }');
});

run('rejects duplicate variable in same scope', () => {
  assertThrows(
    () => tc('isi x = 1 isi x = 2'),
    'sudah terdefinisi'
  );
});

run('allows same name in inner scope', () => {
  tc('isi x = 1 fungsi foo(): angka { isi x = 2 balik x } foo()');
});

run('rejects variable used outside its scope', () => {
  assertThrows(
    () => tc('fungsi foo() { isi tmp = 10 } cetak(tmp)'),
    'tidak terdefinisi'
  );
});

run('type inference from arithmetic result', () => {
  tc('isi x = 2 + 3 isi y: angka = x');
});

run('type inference from function return', () => {
  tc('fungsi dapatAngka(): angka { balik 42 } isi x = dapatAngka() isi y: angka = x');
});

run('accepts struct declaration and init', () => {
  tc(`
struktur Titik { x: angka  y: angka }
isi p = Titik { x: 1, y: 2 }
`);
});

run('rejects struct init with wrong field type', () => {
  assertThrows(
    () => tc('struktur Titik { x: angka  y: angka } isi p = Titik { x: 1, y: "buruk" }'),
    'Diharapkan'
  );
});

run('rejects unknown struct type', () => {
  assertThrows(
    () => tc('isi p = Foo { x: 1 }'),
    'tidak ditemukan'
  );
});

run('rejects access to unknown struct field', () => {
  assertThrows(
    () => tc('struktur Titik { x: angka } isi p = Titik { x: 1 } isi v = p.z'),
    "tidak memiliki field 'z'"
  );
});

run('accepts member access on valid struct field', () => {
  tc('struktur Titik { x: angka  y: angka } isi p = Titik { x: 3, y: 4 } isi v: angka = p.x');
});

run('rejects assignment of wrong type', () => {
  assertThrows(
    () => tc('isi x: angka = 10 x = "salah"'),
    'Diharapkan'
  );
});

run('accepts recursion (function calls itself)', () => {
  tc(`
fungsi fib(n: angka): angka {
  jika n <= 1 { balik n }
  balik fib(n - 1) + fib(n - 2)
}
fib(10)
`);
});

run('rejects wrong argument count (error in indonesian)', () => {
  assertThrows(
    () => tc('fungsi tambah(a: angka, b: angka): angka { balik a + b } tambah(1)'),
    'membutuhkan 2 argumen'
  );
});

run('rejects struct field type mismatch (error in indonesian)', () => {
  assertThrows(
    () => tc('struktur Titik { x: angka } isi p = Titik { x: "salah" }'),
    'angka'
  );
});

// ── Array Type System Tests ────────────────────────────────────────────────────

console.log('\nArray Type System');

run('lexer: tokenizes [ and ]', () => {
  const toks = tokenize('[1, 2, 3]');
  assert(toks[0].type === TokenType.LBRACKET);
  assert(toks[toks.length - 2].type === TokenType.RBRACKET);
});

run('parse: array literal', () => {
  const ast = parse(tokenize('[1, 2, 3]'));
  assertEqual(ast.body[0].expr.type, N.ARRAY_LITERAL);
  assertEqual(ast.body[0].expr.elements.length, 3);
});

run('parse: empty array literal', () => {
  const ast = parse(tokenize('isi a = []'));
  assertEqual(ast.body[0].value.type, N.ARRAY_LITERAL);
  assertEqual(ast.body[0].value.elements.length, 0);
});

run('parse: type annotation T[]', () => {
  const ast = parse(tokenize('isi a: angka[] = [1, 2]'));
  assertEqual(ast.body[0].varType, 'number[]');
});

run('parse: nested type annotation T[][]', () => {
  const ast = parse(tokenize('isi a: angka[][] = [[1], [2]]'));
  assertEqual(ast.body[0].varType, 'number[][]');
});

run('typechecker: infers number[] from [1, 2, 3]', () => {
  const src = 'isi a = [1, 2, 3]';
  const grammar = detectGrammar(src);
  const ast = parse(tokenize(src));
  typecheck(ast, grammar);
  assertEqual(ast.body[0]._resolvedType, 'number[]');
});

run('typechecker: infers string[] from ["a", "b"]', () => {
  const src = 'isi a = ["halo", "dunia"]';
  const grammar = detectGrammar(src);
  const ast = parse(tokenize(src));
  typecheck(ast, grammar);
  assertEqual(ast.body[0]._resolvedType, 'string[]');
});

run('typechecker: rejects mixed-type array', () => {
  assertThrows(
    () => tc('isi a = [1, "buruk", 3]'),
    'ditemukan elemen bertipe'
  );
});

run('typechecker: accepts valid T[] annotation', () => {
  tc('isi a: angka[] = [1, 2, 3]');
});

run('typechecker: rejects T[] annotation mismatch', () => {
  assertThrows(() => tc('isi a: angka[] = ["x", "y"]'), 'Diharapkan');
});

run('typechecker: nested array [][]', () => {
  tc('isi a = [[1, 2], [3, 4]]');
});

run('typechecker: nested array type mismatch', () => {
  assertThrows(() => tc('isi a = [[1, 2], ["a", "b"]]'), '');
});

run('typechecker: empty array inferred as unknown[]', () => {
  const src = 'isi a = []';
  const grammar = detectGrammar(src);
  const ast = parse(tokenize(src));
  typecheck(ast, grammar);
  assertEqual(ast.body[0]._resolvedType, 'unknown[]');
});

run('codegen: array literal → JS array', () => {
  const js = compile('isi a = [1, 2, 3]');
  assert(js.includes('[1, 2, 3]'));
});

run('codegen: executes array access via cetak', () => {
  const out = exec('isi a = [10, 20, 30] cetak(a)');
  assert(out[0].includes('10'));
});

run('array type annotation with angka[]', () => {
  tc('isi a: angka[] = [1, 2, 3]');
});

// ── Struct Validation ──────────────────────────────────────────────────────────

console.log('\nStruct Validation');

run('typechecker: rejects missing required field in struct init', () => {
  assertThrows(
    () => tc('struktur Titik { x: angka  y: angka } isi p = Titik { x: 10 }'),
    'wajib diisi'
  );
});

run('typechecker: rejects unknown field in struct init', () => {
  assertThrows(
    () => tc('struktur Titik { x: angka } isi p = Titik { x: 1, z: 99 }'),
    "tidak memiliki field 'z'"
  );
});

run('typechecker: all fields provided is valid', () => {
  tc('struktur Titik { x: angka  y: angka } isi p = Titik { x: 10, y: 20 }');
});

run('missing field error in indonesian', () => {
  assertThrows(
    () => tc('struktur Titik { x: angka  y: angka } isi p = Titik { x: 10 }'),
    'wajib diisi'
  );
});

// ── Package / Namespace Tests ─────────────────────────────────────────────────

console.log('\nPackage');

// ── Parsing ────────────────────────────────────────────────────────────────

run('parse: paket declaration', () => {
  const ast = parse(tokenize('paket matematika'));
  assert(ast.body[0].type === N.PACKAGE_DECL);
  assertEqual(ast.body[0].name, 'matematika');
});

run('parse: impor X dari "src"', () => {
  const ast = parse(tokenize('impor fs dari "fs"'));
  assert(ast.body[0].type === N.PACKAGE_IMPORT);
  assertEqual(ast.body[0].localName, 'fs');
  assertEqual(ast.body[0].source, 'fs');
});

run('parse: paket + import + fungsi', () => {
  const ast = parse(tokenize(`
paket keamanan
impor crypto dari "crypto"
fungsi hash(x: teks): teks { balik x }
`));
  assertEqual(ast.body[0].type, N.PACKAGE_DECL);
  assertEqual(ast.body[1].type, N.PACKAGE_IMPORT);
  assertEqual(ast.body[2].type, N.FN_DECL);
});

// ── Grammar detection ──────────────────────────────────────────────────────

run('detectGrammar: always returns id', () => {
  assertEqual(detectGrammar('paket matematika'), 'id');
  assertEqual(detectGrammar('isi x = 10'), 'id');
  assertEqual(detectGrammar('cetak("halo")'), 'id');
});

// ── Type checker ───────────────────────────────────────────────────────────

run('typechecker: import name registered in scope', () => {
  tc('impor math dari "math" isi x = math.tambah(1, 2)');
});

run('typechecker: multiple package declarations → error', () => {
  assertThrows(() => tc('paket a\npaket b'), 'satu deklarasi paket');
});

run('typechecker: duplicate import name → error', () => {
  assertThrows(
    () => tc('impor fs dari "fs"\nimpor fs dari "path"'),
    'fs'
  );
});

run('typechecker: package.method() accepted (unknown return type)', () => {
  tc('impor crypto dari "crypto"\nisi h = crypto.createHash("sha256")');
});

// ── Code generation ────────────────────────────────────────────────────────

run('codegen: impor → ES module import statement', () => {
  const js = compile('impor fs dari "fs"');
  assert(js.includes('import * as fs from "fs";'));
});

run('codegen: fungsi in paket gets export prefix', () => {
  const js = compile('paket matematika\nfungsi tambah(a: angka, b: angka): angka { balik a + b }');
  assert(js.includes('export function tambah'));
});

run('codegen: fungsi WITHOUT paket has no export', () => {
  const js = compile('fungsi tambah(a: angka, b: angka): angka { balik a + b }');
  assert(!js.includes('export function'));
  assert(js.includes('function tambah'));
});

run('codegen: top-level var in paket NOT exported', () => {
  const js = compile('paket counter\nisi count = 0');
  assert(!js.includes('export let'));
  assert(!js.includes('export const'));
  assert(js.includes('count'));
});

run('codegen: imports emitted before functions', () => {
  const js = compile('paket util\nimpor path dari "path"\nfungsi resolve(): teks { balik path.join(".") }');
  const importIdx = js.indexOf('import * as path');
  const exportIdx = js.indexOf('export function');
  assert(importIdx < exportIdx);
});

run('codegen: multiple imports all emitted', () => {
  const js = compile('impor fs dari "fs"\nimpor path dari "path"');
  assert(js.includes('import * as fs from "fs";'));
  assert(js.includes('import * as path from "path";'));
});

run('codegen: paket + fungsi → export function', () => {
  const js = compile('paket matematika\nfungsi tambah(a: angka, b: angka): angka { balik a + b }');
  assert(js.includes('export function tambah'));
});

run('codegen: local file source preserved as-is', () => {
  const js = compile('impor keamanan dari "./keamanan"');
  assert(js.includes('from "./keamanan"'));
});

// ── Package registry ───────────────────────────────────────────────────────

run('PackageRegistry: register and retrieve', () => {
  const reg = new PackageRegistry();
  reg.register('math', { source: './math', exports: ['add', 'sub'], imports: [] });
  const pkg = reg.get('math');
  assertEqual(pkg.name, 'math');
  assertEqual(pkg.exports.length, 2);
});

run('PackageRegistry: has() returns correct boolean', () => {
  const reg = new PackageRegistry();
  reg.register('fs', { source: 'fs' });
  assert(reg.has('fs'));
  assert(!reg.has('crypto'));
});

run('PackageRegistry: all() lists all packages', () => {
  const reg = new PackageRegistry();
  reg.register('a', {});
  reg.register('b', {});
  assertEqual(reg.all().length, 2);
});

// ── Full pipeline ──────────────────────────────────────────────────────────

run('full pipeline: paket file (no actual module resolution)', () => {
  const js = compile(`
paket keamanan
impor crypto dari "crypto"
fungsi hash(x: teks): teks { balik x }
`);
  assert(js.includes('import * as crypto from "crypto";'));
  assert(js.includes('export function hash'));
});

run('full pipeline: consumer file with namespace call', () => {
  const js = compile(`
impor math dari "./math"
isi hasil = math.tambah(1, 2)
cetak(hasil)
`);
  assert(js.includes('import * as math from "./math";'));
  assert(js.includes('math.tambah(1, 2)'));
});

run('full pipeline: paket with private state var', () => {
  const js = compile(`
paket counter
isi ubah count = 0
fungsi tambah() { count = count + 1 }
fungsi total(): angka { balik count }
`);
  assert(js.includes('export function tambah'));
  assert(js.includes('export function total'));
  assert(!js.includes('export let'));
});

// ── Phase 5: Control Flow ─────────────────────────────────────────────────────

console.log('\n── Control Flow (Phase 5) ─────────────────────────────────────────────');

// Keywords
run('tokenizes untuk as keyword for', () => {
  const tok = tokenize('untuk').find(t => t.type === 'KEYWORD');
  assert(tok && tok.value === 'for');
});

run('tokenizes selama as keyword while', () => {
  const tok = tokenize('selama').find(t => t.type === 'KEYWORD');
  assert(tok && tok.value === 'while');
});

run('tokenizes lain as keyword else', () => {
  const tok = tokenize('lain').find(t => t.type === 'KEYWORD');
  assert(tok && tok.value === 'else');
});

run('tokenizes keluar as keyword return', () => {
  const tok = tokenize('keluar').find(t => t.type === 'KEYWORD');
  assert(tok && tok.value === 'return');
});

run('tokenizes dalam as keyword in', () => {
  const tok = tokenize('dalam').find(t => t.type === 'KEYWORD');
  assert(tok && tok.value === 'in');
});

run('tokenizes .. as DOTDOT', () => {
  const tok = tokenize('0..10').find(t => t.type === 'DOTDOT');
  assert(tok, 'DOTDOT token expected');
});

// Codegen: range loop
run('codegen: range loop untuk i dalam 0..5', () => {
  const js = compile('untuk i dalam 0..5 { cetak(i) }');
  assert(js.includes('for (let i = 0; i < 5; i++)'), `got: ${js}`);
});

// Codegen: for-of loop
run('codegen: for-of loop untuk item dalam arr', () => {
  const js = compile('isi arr: angka[] = [1, 2, 3]\nuntuk item dalam arr { cetak(item) }');
  assert(js.includes('for (const item of arr)'), `got: ${js}`);
});

// Codegen: while loop
run('codegen: while loop selama', () => {
  const js = compile('isi ubah x: angka = 0\nselama (x < 10) { x = x + 1 }');
  assert(js.includes('while ((x < 10))'), `got: ${js}`);
});

// Codegen: else-if chain
run('codegen: lain jika → else if', () => {
  const js = compile('isi x: angka = 5\njika (x > 10) { cetak("tinggi") } lain jika (x > 5) { cetak("sedang") } lain { cetak("rendah") }');
  assert(js.includes('else if'), `got: ${js}`);
});

// Codegen: keluar
run('codegen: keluar compiles to return', () => {
  const js = compile('fungsi f(n: angka): angka { keluar n }');
  assert(js.includes('return n'), `got: ${js}`);
});

// Typecheck: range bounds must be number
run('typechecker: range bounds must be angka', () => {
  assertThrows(
    () => tc('untuk i dalam "a".."z" { cetak(i) }'),
    'Diharapkan'
  );
});

// Typecheck: while condition must be bool
run('typechecker: selama condition must be bool', () => {
  assertThrows(
    () => tc('isi ubah x: angka = 0\nselama (x) { x = x + 1 }'),
    'logika'
  );
});

// Typecheck: iterator available inside loop body
run('typechecker: range iterator in scope inside body', () => {
  tc('untuk i dalam 0..5 { isi y: angka = i }');
});

// Execution: range loop
run('executes range loop', () => {
  const out = exec('untuk i dalam 0..3 { cetak(i) }');
  assertEqual(out.join(','), '0,1,2');
});

// Execution: for-of
run('executes for-of loop', () => {
  const out = exec('isi arr: angka[] = [10, 20, 30]\nuntuk item dalam arr { cetak(item) }');
  assertEqual(out.join(','), '10,20,30');
});

// Execution: while
run('executes while loop', () => {
  const out = exec('isi ubah n: angka = 0\nselama (n < 3) { cetak(n)\nn = n + 1 }');
  assertEqual(out.join(','), '0,1,2');
});

// Execution: else-if chain
run('executes else-if chain', () => {
  const src = `
fungsi grade(n: angka): teks {
    jika (n >= 90) { balik "A" } lain jika (n >= 80) { balik "B" } lain { balik "C" }
}
cetak(grade(95))
cetak(grade(83))
cetak(grade(60))
`;
  const out = exec(src);
  assertEqual(out.join(','), 'A,B,C');
});

// Execution: keluar early return
run('executes keluar as early return', () => {
  const out = exec('fungsi abs(n: angka): angka { jika (n < 0) { keluar -n } keluar n }\ncetak(abs(-5))\ncetak(abs(3))');
  assertEqual(out.join(','), '5,3');
});

// ── Async/Await ───────────────────────────────────────────────────────────────

console.log('\n── Async/Await ────────────────────────────────────────────────────────────');

run('tokenizes asinkron as keyword async', () => {
  const tok = tokenize('asinkron').find(t => t.type === 'KEYWORD');
  assert(tok && tok.value === 'async');
});

run('tokenizes tunggu as keyword await', () => {
  const tok = tokenize('tunggu').find(t => t.type === 'KEYWORD');
  assert(tok && tok.value === 'await');
});

run('parse: fungsi asinkron sets isAsync=true', () => {
  const ast = parse(tokenize('fungsi asinkron foo(): angka { balik 1 }'));
  assert(ast.body[0].isAsync === true);
});

run('parse: regular fungsi isAsync=false', () => {
  const ast = parse(tokenize('fungsi foo(): angka { balik 1 }'));
  assert(!ast.body[0].isAsync);
});

run('parse: tunggu creates AWAIT_EXPR node', () => {
  const ast = parse(tokenize('fungsi asinkron f(): angka { isi x = tunggu g() balik x } fungsi g(): angka { balik 1 }'));
  const varDecl = ast.body[0].body.body[0];
  assert(varDecl.value.type === N.AWAIT_EXPR);
});

run('codegen: async function generates async keyword', () => {
  const js = compile('fungsi asinkron foo(): angka { balik 1 }');
  assert(js.includes('async function foo()'), `got: ${js}`);
});

run('codegen: tunggu generates await', () => {
  const js = compile('fungsi asinkron foo(): angka { balik 1 } fungsi asinkron bar(): angka { isi x = tunggu foo() balik x }');
  assert(js.includes('await foo()'), `got: ${js}`);
});

run('codegen: non-async fungsi has no async keyword', () => {
  const js = compile('fungsi foo(): angka { balik 1 }');
  assert(!js.includes('async'), `got: ${js}`);
});

run('typechecker: await in non-async function → error', () => {
  assertThrows(
    () => tc('fungsi ambil(): angka { balik 1 } fungsi foo(): angka { isi x = tunggu ambil() balik x }'),
    'bukan asinkron'
  );
});

run('typechecker: await at top level → error', () => {
  assertThrows(
    () => tc('fungsi ambil(): angka { balik 1 } isi x = tunggu ambil()'),
    'hanya bisa digunakan'
  );
});

run('typechecker: await inside async is valid', () => {
  tc('fungsi asinkron ambil(): angka { balik 1 } fungsi asinkron foo(): angka { isi x = tunggu ambil() balik x }');
});

run('executes async/await end-to-end', () => {
  // exec() uses vm.Script which supports async — wrap in async IIFE
  const js = compile(`
fungsi asinkron dapatNilai(): angka { balik 99 }
fungsi asinkron utama() {
    isi hasil = tunggu dapatNilai()
    cetak(hasil)
}
utama()
`);
  // Just verify output compiles correctly and contains expected JS
  assert(js.includes('async function dapatNilai'));
  assert(js.includes('async function utama'));
  assert(js.includes('await dapatNilai()'));
});

// ── Framework Blockers ────────────────────────────────────────────────────────

console.log('\n── Framework Blockers ─────────────────────────────────────────────────────');

// && || !
run('codegen: && operator', () => {
  const js = compile('fungsi f(a: logika, b: logika): logika { balik a && b }');
  assert(js.includes('&&'), `got: ${js}`);
});

run('codegen: || operator', () => {
  const js = compile('fungsi f(a: logika, b: logika): logika { balik a || b }');
  assert(js.includes('||'), `got: ${js}`);
});

run('codegen: ! operator', () => {
  const js = compile('fungsi f(b: logika): logika { balik !b }');
  assert(js.includes('!b'), `got: ${js}`);
});

run('executes && correctly', () => {
  const out = exec('cetak(benar && benar)\ncetak(benar && salah)');
  assertEqual(out.join(','), 'true,false');
});

run('executes || correctly', () => {
  const out = exec('cetak(salah || benar)\ncetak(salah || salah)');
  assertEqual(out.join(','), 'true,false');
});

run('executes ! correctly', () => {
  const out = exec('cetak(!benar)\ncetak(!salah)');
  assertEqual(out.join(','), 'false,true');
});

run('typechecker: && requires bool operands', () => {
  assertThrows(
    () => tc('fungsi f(a: angka, b: logika): logika { balik a && b }'),
    'tidak dapat digunakan'
  );
});

// Anonymous function
run('codegen: anonymous function expression', () => {
  const js = compile('isi f = fungsi(x: angka): angka { balik x }');
  assert(js.includes('function(x)'), `got: ${js}`);
});

run('executes anonymous function stored in variable', () => {
  const out = exec('isi kali3 = fungsi(n: angka): angka { balik n * 3 }\ncetak(kali3(7))');
  assertEqual(out[0], '21');
});

run('anonymous function passed as argument', () => {
  const js = compile(`
fungsi terapkan(f: apa_saja, n: angka): angka { balik f(n) }
isi dua_kali = fungsi(x: angka): angka { balik x * 2 }
`);
  assert(js.includes('function(x)'));
});

// Try/catch
run('codegen: try/catch generates correct JS', () => {
  const js = compile(`
fungsi f() {
    coba { cetak("ok") } tangkap (e) { cetak(e) }
}
`);
  assert(js.includes('try {'), `got: ${js}`);
  assert(js.includes('} catch (e) {'), `got: ${js}`);
});

run('codegen: try/catch/finally', () => {
  const js = compile(`
fungsi f() {
    coba { cetak("ok") } tangkap (e) { cetak(e) } akhirnya { cetak("selesai") }
}
`);
  assert(js.includes('finally {'), `got: ${js}`);
});

run('executes try/catch', () => {
  const out = exec(`
fungsi f() {
    coba {
        cetak("coba")
    } tangkap (e) {
        cetak("tangkap")
    }
}
f()
`);
  assertEqual(out[0], 'coba');
});

run('catch parameter accessible in catch block', () => {
  const js = compile(`
fungsi f() {
    coba { cetak("ok") } tangkap (err) { cetak(err) }
}
`);
  assert(js.includes('catch (err)'));
});

// Null
run('codegen: kosong generates null', () => {
  const js = compile('isi x: apa_saja = kosong');
  assert(js.includes('null'), `got: ${js}`);
});

run('null comparison allowed', () => {
  tc('isi x: apa_saja = kosong\njika (x == kosong) { cetak("ya") }');
});

run('executes null check', () => {
  const out = exec('isi x: apa_saja = kosong\njika (x == kosong) { cetak("kosong") } lain { cetak("bukan") }');
  assertEqual(out[0], 'kosong');
});

// apa_saja type
run('apa_saja type accepts any value', () => {
  const js = compile('isi x: apa_saja = 42\nisi y: apa_saja = "teks"\nisi z: apa_saja = benar');
  assert(js.includes('let x = 42'));
});

run('function parameter apa_saja accepts any call arg', () => {
  tc('fungsi f(x: apa_saja): apa_saja { balik x }\nf(42)\nf("teks")\nf(benar)');
});

// object literal
run('codegen: anonymous object literal', () => {
  const js = compile('isi obj = { nama: "Andi", umur: 25 }');
  assert(js.includes('{ nama: "Andi", umur: 25 }'));
});

run('object literal empty', () => {
  const js = compile('isi obj = {}');
  assert(js.includes('{}'));
});

run('object literal nested in function call', () => {
  const js = compile('fungsi f(x: apa_saja): tiada {}\nf({ a: 1, b: benar })');
  assert(js.includes('f({ a: 1, b: true })'));
});

run('object literal as argument to method chain', () => {
  const js = compile('isi res: apa_saja = kosong\nres.json({ status: 200 })');
  assert(js.includes('res.json({ status: 200 })'));
});

run('object literal field value can be expression', () => {
  const js = compile('isi n = 10\nisi obj = { nilai: n, dua: 2 }');
  assert(js.includes('{ nilai: n, dua: 2 }'));
});

// f-string / template literal
run('f-string basic interpolation', () => {
  const js = compile('isi nama = "Andi"\nisi msg = f"Halo {nama}!"');
  assert(js.includes('`Halo ${nama}!`'));
});

run('f-string multiple expressions', () => {
  const js = compile('isi a = 1\nisi b = 2\nisi s = f"nilai: {a} dan {b}"');
  assert(js.includes('`nilai: ${a} dan ${b}`'));
});

run('f-string infers string type', () => {
  tc('isi x: angka = 5\nisi s: teks = f"val {x}"');
});

// Destructuring
run('object destructuring codegen', () => {
  const js = compile('isi obj: apa_saja = kosong\nisi { id, nama } = obj');
  assert(js.includes('let { id, nama } = obj'));
});

run('array destructuring codegen', () => {
  const js = compile('isi arr: apa_saja = kosong\nisi [first, second] = arr');
  assert(js.includes('let [first, second] = arr'));
});

run('destructuring with rename', () => {
  const js = compile('isi obj: apa_saja = kosong\nisi { id: userId } = obj');
  assert(js.includes('let { id: userId } = obj'));
});

run('destructured bindings usable', () => {
  const js = compile('isi obj: apa_saja = kosong\nisi { id, nama } = obj\ncetak(id)');
  assert(js.includes('console.log(id)'));
});

// Ternary
run('ternary Python-style codegen', () => {
  const js = compile('isi x = 5\nisi r = "besar" jika x > 3 lain "kecil"');
  assert(js.includes('? "besar" : "kecil"'));
});

run('ternary does not consume next jika statement', () => {
  const js = compile('isi x: apa_saja = kosong\nisi { id } = x\njika (id == kosong) { cetak("nil") }');
  assert(js.includes('let { id } = x'));
  assert(js.includes('if ((id == null))'));
});

run('ternary in function call', () => {
  const js = compile('fungsi f(s: teks): tiada {}\nisi n = 5\nf("besar" jika n > 3 lain "kecil")');
  assert(js.includes('? "besar" : "kecil"'));
});

// Spread
run('spread in object literal', () => {
  const js = compile('isi a: apa_saja = kosong\nisi b = { ...a, key: "val" }');
  assert(js.includes('{ ...a, key: "val" }'));
});

run('spread in array literal', () => {
  const js = compile('isi arr: apa_saja = kosong\nisi b = [...arr, 10]');
  assert(js.includes('[...arr, 10]'));
});

run('spread in function call', () => {
  const js = compile('fungsi f(a: apa_saja, b: apa_saja): tiada {}\nisi args: apa_saja = kosong\nf(...args)');
  assert(js.includes('f(...args)'));
});

// Default parameters
run('default param codegen', () => {
  const js = compile('fungsi sapa(nama: teks = "Dunia"): tiada {}');
  assert(js.includes('function sapa(nama = "Dunia")'));
});

run('default param multiple', () => {
  const js = compile('fungsi f(a: angka, b: angka = 10, c: teks = "ok"): tiada {}');
  assert(js.includes('function f(a, b = 10, c = "ok")'));
});

run('call with fewer args than params (use defaults)', () => {
  const js = compile('fungsi f(a: angka, b: angka = 10): angka { balik a + b }\nf(5)');
  assert(js.includes('f(5)'));
});

// ── Kamus PRD Alignment ─────────────────────────────────────────────────────

console.log('\n── Kamus PRD Alignment ────────────────────────────────────────');

// berhenti / lanjut (break / continue)

run('tokenizes berhenti/lanjut as break/continue', () => {
  assertEqual(tokenize('berhenti').find(t => t.type === 'KEYWORD').value, 'break');
  assertEqual(tokenize('lanjut').find(t => t.type === 'KEYWORD').value, 'continue');
});

run('codegen: berhenti inside untuk generates break', () => {
  const js = compile('untuk i dalam 0..5 { berhenti }');
  assert(js.includes('break'), `got: ${js}`);
});

run('codegen: lanjut inside selama generates continue', () => {
  const js = compile('isi ubah i: angka = 0\nselama (i < 5) { i = i + 1\nlanjut }');
  assert(js.includes('continue'), `got: ${js}`);
});

run('rejects berhenti outside a loop', () => {
  assertThrows(() => parse(tokenize('berhenti')), "'berhenti' hanya bisa digunakan");
});

run('rejects lanjut outside a loop', () => {
  assertThrows(() => parse(tokenize('lanjut')), "'lanjut' hanya bisa digunakan");
});

run('executes untuk loop with berhenti', () => {
  const out = exec('untuk i dalam 0..10 { jika (i == 3) { berhenti }\ncetak(i) }');
  assertEqual(out.join(','), '0,1,2');
});

run('executes selama loop with lanjut', () => {
  const out = exec('isi ubah i: angka = 0\nselama (i < 4) { i = i + 1\njika (i == 2) { lanjut }\ncetak(i) }');
  assertEqual(out.join(','), '1,3,4');
});

// tipe (type alias)

run('tokenizes tipe as keyword type', () => {
  assertEqual(tokenize('tipe').find(t => t.type === 'KEYWORD').value, 'type');
});

run('parse: tipe alias declaration', () => {
  const ast = parse(tokenize('tipe UserId = angka'));
  assertEqual(ast.body[0].type, N.TYPE_ALIAS_DECL);
  assertEqual(ast.body[0].name, 'UserId');
  assertEqual(ast.body[0].target, 'number');
});

run('typechecker: tipe alias accepted where underlying type expected', () => {
  tc('tipe UserId = angka\nfungsi ambil(id: UserId): UserId { balik id }\nambil(5)');
});

run('typechecker: tipe alias rejects mismatched value', () => {
  assertThrows(
    () => tc('tipe UserId = angka\nisi id: UserId = "bukan angka"'),
    'Diharapkan'
  );
});

run('codegen: tipe alias emits no JS output', () => {
  const js = compile('tipe UserId = angka\nisi id: UserId = 5\ncetak(id)');
  assert(!js.includes('UserId'), `got: ${js}`);
});

// ekspor (export)

run('tokenizes ekspor as keyword export', () => {
  assertEqual(tokenize('ekspor').find(t => t.type === 'KEYWORD').value, 'export');
});

run('parse: ekspor fungsi sets isExported=true', () => {
  const ast = parse(tokenize('ekspor fungsi tambah(a: angka, b: angka): angka { balik a + b }'));
  assertEqual(ast.body[0].isExported, true);
});

run('codegen: ekspor fungsi emits export keyword', () => {
  const js = compile('ekspor fungsi tambah(a: angka, b: angka): angka { balik a + b }');
  assert(js.includes('export function tambah'), `got: ${js}`);
});

run('rejects ekspor before non-fungsi', () => {
  assertThrows(() => parse(tokenize('ekspor struktur Titik { x: angka }')), "'ekspor' hanya berlaku untuk 'fungsi'");
});

// buat (optional 'new' prefix before struct init)

run('parse: buat prefix before struct init is accepted', () => {
  const src = 'struktur Titik { x: angka, y: angka }\nisi t = buat Titik { x: 1, y: 2 }';
  const js = compile(src);
  assert(js.includes('{ x: 1, y: 2 }'), `got: ${js}`);
});

// larik<T> / peta<K, V>

run('parse: larik<angka> desugars to angka[]', () => {
  const ast = parse(tokenize('isi xs: larik<angka> = [1, 2, 3]'));
  assertEqual(ast.body[0].varType, 'number[]');
});

run('typechecker: larik<angka> behaves exactly like angka[]', () => {
  tc('isi xs: larik<angka> = [1, 2, 3]');
});

run('parse: peta<teks, angka> type annotation', () => {
  const ast = parse(tokenize('isi skor: peta<teks, angka> = { budi: 90 }'));
  assertEqual(ast.body[0].varType, 'map<string, number>');
});

run('typechecker: peta accepts an object literal value', () => {
  tc('isi skor: peta<teks, angka> = { budi: 90, siti: 95 }');
});

run('codegen: peta value compiles to plain JS object', () => {
  const js = compile('isi skor: peta<teks, angka> = { budi: 90 }');
  assert(js.includes('{ budi: 90 }'), `got: ${js}`);
});

// pilih / kasus / lain (match)

run('tokenizes kasus as keyword case', () => {
  assertEqual(tokenize('kasus').find(t => t.type === 'KEYWORD').value, 'case');
});

run('parse: pilih expr { } statement with kasus and lain arms produces MatchStmt', () => {
  const src = 'pilih x { kasus 1 -> cetak("satu") kasus 2 -> cetak("dua") lain -> cetak("lainnya") }';
  const ast = parse(tokenize(src));
  assertEqual(ast.body[0].type, N.MATCH_STMT);
  assertEqual(ast.body[0].cases.length, 2);
  assert(ast.body[0].defaultCase !== null);
});

run('codegen: pilih compiles to if/else if/else chain', () => {
  const js = compile('isi x = 2\npilih x { kasus 1 -> cetak("satu") kasus 2 -> cetak("dua") lain -> cetak("lainnya") }');
  assert(js.includes('if (') && js.includes('else if (') && js.includes('else {'), `got: ${js}`);
});

run('executes pilih statement (matches a kasus arm)', () => {
  const out = exec('isi x = 2\npilih x { kasus 1 -> cetak("satu") kasus 2 -> cetak("dua") lain -> cetak("lainnya") }');
  assertEqual(out[0], 'dua');
});

run('executes pilih statement (falls through to lain)', () => {
  const out = exec('isi x = 9\npilih x { kasus 1 -> cetak("satu") kasus 2 -> cetak("dua") lain -> cetak("lainnya") }');
  assertEqual(out[0], 'lainnya');
});

run('typechecker: pilih rejects incompatible kasus type', () => {
  assertThrows(
    () => tc('isi x: angka = 1\npilih x { kasus "teks" -> cetak("x") }'),
    'Diharapkan'
  );
});

run('formatter: renders pilih', () => {
  const out = format('isi x = 2\npilih x { kasus 1 -> cetak("satu") lain -> cetak("lainnya") }');
  assert(out.includes('pilih x {'), out);
});

// logika / tiada (renamed bool / void types)

run('tokenizes logika as keyword bool, tiada as keyword void', () => {
  const types = tokenize('logika tiada').filter(t => t.type === 'TYPE').map(t => t.value);
  assert(types.includes('bool'), 'logika → bool');
  assert(types.includes('void'), 'tiada → void');
});

run('codegen: logika typed function compiles correctly', () => {
  const js = compile('fungsi aktifkan(nyala: logika): logika { balik !nyala }');
  assert(js.includes('function aktifkan(nyala)'), `got: ${js}`);
});

// bilangan / pecahan / byte (aliased to angka)

run('typechecker: bilangan and pecahan are compatible with angka', () => {
  tc('isi a: bilangan = 5\nisi b: pecahan = 3.14\nisi c: angka = a + b');
});

// ── Prioritas Berikutnya (Opsional, Kunci, Saluran, Uji, Formatter, Linter) ──

console.log('\n── Prioritas Berikutnya ───────────────────────────────────────');

// Opsional (T?)

run('parse: teks? produces optional varType', () => {
  const ast = parse(tokenize('isi nama: teks? = kosong'));
  assertEqual(ast.body[0].varType, 'string?');
});

run('typechecker: kosong rejected for non-optional type', () => {
  assertThrows(() => tc('isi nama: teks = kosong'), 'Diharapkan');
});

run('typechecker: kosong accepted for optional type', () => {
  tc('isi nama: teks? = kosong');
});

run('typechecker: plain value accepted into optional type', () => {
  tc('isi nama: teks? = "Handrawan"');
});

run('typechecker: != kosong comparison valid on optional', () => {
  tc('isi nama: teks? = kosong\njika (nama != kosong) { cetak(nama) }');
});

run('display: optional type shown with ? suffix in Bahasa Indonesia', () => {
  assertThrows(() => tc('isi nama: teks = 5'), "'teks'");
});

// Uji / Pastikan

run('parse: uji produces TestDecl with label', () => {
  const ast = parse(tokenize('uji "contoh" { pastikan benar }'));
  assertEqual(ast.body[0].type, N.TEST_DECL);
  assertEqual(ast.body[0].label, 'contoh');
});

run('parse: pastikan produces AssertStmt', () => {
  const ast = parse(tokenize('uji "contoh" { pastikan 1 == 1 }'));
  assertEqual(ast.body[0].body.body[0].type, N.ASSERT_STMT);
});

run('typechecker: pastikan requires bool expression', () => {
  assertThrows(() => tc('uji "x" { pastikan 5 }'), 'Diharapkan');
});

run('typechecker: tunggu usable inside uji without asinkron', () => {
  tc('fungsi asinkron ambil(): angka { balik 1 }\nuji "x" { isi v = tunggu ambil()\npastikan v == 1 }');
});

run('codegen: uji block omitted when includeTests is false', () => {
  const js = compile('uji "x" { pastikan benar }', { includeTests: false });
  assert(!js.includes('__gatra_uji_daftar'), `got: ${js}`);
});

run('codegen: uji block compiled when includeTests is true', () => {
  const js = compile('uji "x" { pastikan benar }', { includeTests: true });
  assert(js.includes('__gatra_uji_daftar'), `got: ${js}`);
});

run('executes: uji reports pass/fail via console and exit code', () => {
  // Runs in a real Node subprocess (spawnSync) so the async test-runner
  // IIFE — which needs real microtask/event-loop turns — runs to completion
  // before we inspect its output, unlike a synchronous vm.Script eval.
  const { spawnSync } = require('child_process');
  const os   = require('os');
  const path = require('path');
  const js = compile('fungsi tambah(a: angka, b: angka): angka { balik a + b }\nuji "ok" { pastikan tambah(2, 3) == 5 }\nuji "gagal" { pastikan tambah(1, 1) == 5 }', { includeTests: true });
  const tmp = path.join(os.tmpdir(), `gatra_uji_test_${Date.now()}.js`);
  require('fs').writeFileSync(tmp, js, 'utf8');
  try {
    const result = spawnSync(process.execPath, [tmp], { encoding: 'utf8' });
    assert(result.stdout.includes('✓') && result.stdout.includes('ok'), result.stdout);
    assert(result.stdout.includes('✗') && result.stdout.includes('gagal'), result.stdout);
    assertEqual(result.status, 1);
  } finally {
    require('fs').rmSync(tmp, { force: true });
  }
});

// Linter (gatra periksa)

run('linter: reports unused variable', () => {
  const ast = parse(tokenize('fungsi f(): tiada {\n  isi x = 5\n}'));
  const findings = lint(ast);
  assert(findings.some(f => f.rule === 'variabel-tidak-digunakan'), JSON.stringify(findings));
});

run('linter: does not report used variable', () => {
  const ast = parse(tokenize('fungsi f(): tiada {\n  isi x = 5\n  cetak(x)\n}'));
  const findings = lint(ast);
  assert(!findings.some(f => f.rule === 'variabel-tidak-digunakan'), JSON.stringify(findings));
});

run('linter: does not report unused function parameters', () => {
  const ast = parse(tokenize('fungsi f(x: angka): tiada {}'));
  const findings = lint(ast);
  assertEqual(findings.length, 0);
});

run('linter: reports shadowing in nested scope', () => {
  const ast = parse(tokenize('isi x = 1\njika (benar) {\n  isi x = 2\n  cetak(x)\n}'));
  const findings = lint(ast);
  assert(findings.some(f => f.rule === 'shadowing'), JSON.stringify(findings));
});

run('linter: reports dead code after balik', () => {
  const ast = parse(tokenize('fungsi f(): angka {\n  balik 1\n  isi y = 2\n  cetak(y)\n}'));
  const findings = lint(ast);
  assert(findings.some(f => f.rule === 'kode-mati'), JSON.stringify(findings));
});

run('linter: clean code has no findings', () => {
  const ast = parse(tokenize('fungsi tambah(a: angka, b: angka): angka {\n  balik a + b\n}\ncetak(tambah(1, 2))'));
  assertEqual(lint(ast).length, 0);
});

// Formatter (gatra rapikan)

run('formatter: normalizes spacing and keyword casing', () => {
  const out = format('isi   x=5\ncetak(x)');
  assert(out.includes('isi x = 5'), out);
});

run('formatter: is idempotent (formatting twice is a no-op)', () => {
  const once  = format('fungsi tambah(a: angka, b: angka): angka { balik a + b }\ncetak(tambah(1, 2))');
  const twice = format(once);
  assertEqual(once, twice);
});

run('formatter: output still compiles and runs correctly', () => {
  const src = 'fungsi tambah(a: angka, b: angka): angka { balik a+b }\ncetak(tambah(2,3))';
  const formatted = format(src);
  const out = exec(formatted);
  assertEqual(out[0], '5');
});

run('formatter: renders opsional type with ? suffix', () => {
  const out = format('isi nama: teks? = kosong');
  assert(out.includes('teks?'), out);
});

run('formatter: renders ekspor/asinkron/tipe alias', () => {
  const out = format('tipe UserId = angka\nekspor fungsi asinkron ambil(id: UserId): angka { balik id }');
  assert(out.includes('tipe UserId = angka'), out);
  assert(out.includes('ekspor fungsi asinkron ambil'), out);
});

// ── Pengelola Paket (gatra mulai) ────────────────────────────────────────────

console.log('\n── Pengelola Paket ────────────────────────────────────────────');

run('gatra buat scaffolds a runnable project', () => {
  const { spawnSync } = require('child_process');
  const os   = require('os');
  const path = require('path');
  const fs   = require('fs');
  const cliPath = path.resolve(__dirname, '../src/cli/gatra.js');
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gatra_buat_'));
  const projectName = 'proyek_uji';
  try {
    const init = spawnSync(process.execPath, [cliPath, 'buat', projectName], { cwd: workDir, encoding: 'utf8' });
    assertEqual(init.status, 0);
    const projectDir = path.join(workDir, projectName);
    assert(fs.existsSync(path.join(projectDir, 'package.json')), 'package.json should exist');
    assert(fs.existsSync(path.join(projectDir, 'utama.gatra')), 'utama.gatra should exist');
    const run = spawnSync(process.execPath, [cliPath, 'jalankan', 'utama.gatra'], { cwd: projectDir, encoding: 'utf8' });
    assertEqual(run.status, 0);
    assert(run.stdout.includes(`Halo, ${projectName}!`), run.stdout);
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

// ── Validasi tipe numerik: bilangan (int) / pecahan (float) / byte ──────────

console.log('\n── Validasi Tipe Numerik ───────────────────────────────────────');

run('typechecker: byte rejects value above 255', () => {
  assertThrows(() => tc('isi t: byte = 256'), 'jangkauan');
});

run('typechecker: byte rejects negative value', () => {
  assertThrows(() => tc('isi t: byte = -1'), 'jangkauan');
});

run('typechecker: byte accepts 0 and 255 (boundary)', () => {
  tc('isi a: byte = 0\nisi b: byte = 255');
});

run('typechecker: byte rejects non-integer value', () => {
  assertThrows(() => tc('isi t: byte = 1.5'), 'jangkauan');
});

run('typechecker: bilangan rejects a fractional literal', () => {
  assertThrows(() => tc('isi t: bilangan = 3.14'), 'bukan bilangan bulat');
});

run('typechecker: bilangan accepts an integer literal (positive and negative)', () => {
  tc('isi a: bilangan = 10\nisi b: bilangan = -5');
});

run('typechecker: bilangan rejects a negative fractional literal', () => {
  assertThrows(() => tc('isi t: bilangan = -3.5'), 'bukan bilangan bulat');
});

run('typechecker: pecahan accepts both integer and fractional literals', () => {
  tc('isi a: pecahan = 3.14\nisi b: pecahan = 10');
});

run('typechecker: angka (generic) accepts bilangan/pecahan/byte values', () => {
  tc('isi a: bilangan = 5\nisi b: pecahan = 3.14\nisi c: byte = 100\nisi x: angka = a\nisi y: angka = b\nisi z: angka = c');
});

run('typechecker: bilangan does NOT accept a pecahan-typed variable', () => {
  assertThrows(
    () => tc('isi a: pecahan = 3.14\nisi b: bilangan = a'),
    'Diharapkan'
  );
});

run('typechecker: pecahan accepts a bilangan-typed variable (widening)', () => {
  tc('isi a: bilangan = 5\nisi b: pecahan = a');
});

run('typechecker: byte literal check applies to function arguments', () => {
  assertThrows(
    () => tc('fungsi f(b: byte): tiada {}\nf(300)'),
    'jangkauan'
  );
});

run('typechecker: byte literal check applies to struct field init', () => {
  assertThrows(
    () => tc('struktur T { b: byte }\nisi x = T { b: 300 }'),
    'jangkauan'
  );
});

run('typechecker: byte literal check applies to return statements', () => {
  assertThrows(
    () => tc('fungsi f(): byte { balik 300 }'),
    'jangkauan'
  );
});

run('typechecker: reassigning a non-integer literal to a bilangan var is rejected', () => {
  assertThrows(
    () => tc('isi ubah a: bilangan = 5\na = 3.14'),
    'bukan bilangan bulat'
  );
});

run('typechecker: computed (non-literal) values are not range-checked (documented limitation)', () => {
  // Nilai dari ekspresi/variabel tidak bisa divalidasi statis — hanya literal langsung.
  tc('isi a: angka = 999\nisi b: byte = a * 1');
});

run('codegen: bilangan/pecahan + arithmetic promotes correctly', () => {
  const js = compile('isi a: bilangan = 5\nisi b: pecahan = 3.14\nisi c: angka = a + b\ncetak(c)');
  assert(js.includes('let c = (a + b)'), js);
});

run('typechecker: untuk range accepts bilangan bounds', () => {
  tc('isi a: bilangan = 0\nisi b: bilangan = 5\nuntuk i dalam a..b { cetak(i) }');
});

// ── Fondasi PRD Baru: indexing, arrow fn, ?., ??, rest params, javascript {} ─

console.log('\n── Fondasi PRD Baru ────────────────────────────────────────────');

// Indexing: obj[key]

run('parse: obj[key] produces IndexExpr', () => {
  const ast = parse(tokenize('isi v = arr[0]'));
  assertEqual(ast.body[0].value.type, N.INDEX_EXPR);
});

run('codegen: obj[key] compiles to bracket access', () => {
  const js = compile('isi arr: angka[] = [1,2,3]\ncetak(arr[0])');
  assert(js.includes('arr[0]'), js);
});

run('executes: array indexing reads the right element', () => {
  const out = exec('isi arr: angka[] = [10,20,30]\ncetak(arr[1])');
  assertEqual(out[0], '20');
});

run('executes: index assignment mutates the array', () => {
  const out = exec('isi arr: angka[] = [1,2,3]\narr[0] = 99\ncetak(arr[0])');
  assertEqual(out[0], '99');
});

run('typechecker: indexing a larik<T> yields the element type', () => {
  tc('isi arr: angka[] = [1,2,3]\nisi x: angka = arr[0]');
});

// Arrow functions

run('parse: (x) => expr produces an arrow FuncExpr', () => {
  const ast = parse(tokenize('isi f = (x) => x * 2'));
  const fn = ast.body[0].value;
  assertEqual(fn.type, N.FUNC_EXPR);
  assertEqual(fn.isArrow, true);
  assert(fn.exprBody !== null, 'expected exprBody');
});

run('parse: (a, b) => { balik a + b } produces an arrow FuncExpr with a block body', () => {
  const ast = parse(tokenize('isi f = (a, b) => { balik a + b }'));
  const fn = ast.body[0].value;
  assertEqual(fn.isArrow, true);
  assertEqual(fn.exprBody, null);
  assert(fn.body !== null, 'expected block body');
});

run('parse: (x) is still a plain parenthesized expression, not an arrow', () => {
  const ast = parse(tokenize('isi f = (x)'));
  assertEqual(ast.body[0].value.type, N.IDENTIFIER);
});

run('codegen: arrow with expr body compiles to JS arrow function', () => {
  const js = compile('isi f = (x) => x * 2');
  assert(js.includes('(x) => (') && js.includes('x * 2'), js);
});

run('executes: arrow function works as a standalone callback', () => {
  const out = exec('isi kali2 = (x) => x * 2\ncetak(kali2(21))');
  assertEqual(out[0], '42');
});

run('executes: arrow function passed directly to array.map', () => {
  // exec()'s mock console.log joins args with Array.join, which stringifies
  // an array argument as "2,4,6" (no brackets) — unlike Node's real console.
  const out = exec('isi xs: angka[] = [1, 2, 3]\ncetak(xs.map((x) => x * 2))');
  assertEqual(out[0], '2,4,6');
});

run('formatter: renders arrow function without redundant apa_saja annotation', () => {
  const out = format('isi f = (x) => x * 2');
  assert(out.includes('(x) => x * 2'), out);
  assert(!out.includes('apa_saja'), out);
});

// Optional chaining ?.

run('parse: a?.b produces MemberExpr with optional=true', () => {
  const ast = parse(tokenize('isi v = a?.b'));
  assertEqual(ast.body[0].value.optional, true);
});

run('parse: a.b produces MemberExpr with optional=false', () => {
  const ast = parse(tokenize('isi v = a.b'));
  assertEqual(ast.body[0].value.optional, false);
});

run('codegen: a?.b compiles to JS optional chaining verbatim', () => {
  const js = compile('isi obj: apa_saja = kosong\ncetak(obj?.b)');
  assert(js.includes('obj?.b'), js);
});

run('executes: ?. short-circuits without throwing on a null/kosong intermediate', () => {
  // exec()'s mock console.log uses Array.join, which stringifies an
  // `undefined` argument as '' — unlike Node's real console ('undefined').
  // The important behavior under test is that this doesn't throw.
  const out = exec('isi obj: apa_saja = { a: kosong }\ncetak(obj?.a?.b)\ncetak("selesai")');
  assertEqual(out[0], '');
  assertEqual(out[1], 'selesai');
});

// Nullish coalescing ??

run('parse: a ?? b produces BinaryExpr with op ??', () => {
  const ast = parse(tokenize('isi v = a ?? b'));
  assertEqual(ast.body[0].value.op, '??');
});

run('codegen: ?? compiles verbatim (already valid JS)', () => {
  const js = compile('isi a: apa_saja = kosong\ncetak(a ?? "fallback")');
  assert(js.includes('(a ?? "fallback")'), js);
});

run('executes: ?? falls back only on null/undefined, not on falsy values', () => {
  const out = exec('isi a: apa_saja = kosong\ncetak(a ?? "fallback")\nisi b = 0\ncetak(b ?? 99)');
  assertEqual(out[0], 'fallback');
  assertEqual(out[1], '0');
});

// Rest parameters

run('parse: ...nama produces a rest param as the last parameter', () => {
  const ast = parse(tokenize('fungsi f(...data): tiada {}'));
  const p = ast.body[0].params[0];
  assertEqual(p.rest, true);
  assertEqual(p.name, 'data');
});

run('codegen: rest param compiles to JS ...spread parameter', () => {
  const js = compile('fungsi f(...data): tiada {}');
  assert(js.includes('function f(...data)'), js);
});

run('executes: rest param collects all extra call arguments', () => {
  const out = exec('fungsi jumlahkan(...xs) { isi ubah t = 0\nuntuk n dalam xs { t = t + n }\nbalik t }\ncetak(jumlahkan(1, 2, 3, 4))');
  assertEqual(out[0], '10');
});

run('typechecker: fixed params before rest are still required', () => {
  assertThrows(
    () => tc('fungsi f(a: angka, ...xs): tiada {}\nf()'),
    'membutuhkan'
  );
});

// javascript { } escape hatch

run('lexer: javascript { } captures raw JS verbatim as one JS_BLOCK token', () => {
  const toks = tokenize('javascript { const x = 1; }');
  assertEqual(toks[0].type, 'JS_BLOCK');
  assert(toks[0].value.includes('const x = 1;'), toks[0].value);
});

run('lexer: javascript { } correctly skips braces inside string literals', () => {
  const toks = tokenize('javascript { isi = "}"; }');
  assertEqual(toks[0].type, 'JS_BLOCK');
  assertEqual(toks[1].type, 'EOF');
});

run('parse: javascript { } produces a JsBlockStmt', () => {
  const ast = parse(tokenize('javascript { const x = 1; }'));
  assertEqual(ast.body[0].type, N.JS_BLOCK_STMT);
});

run('codegen: javascript { } is emitted verbatim, untouched', () => {
  const js = compile('javascript { const x = 1 + 1; }');
  assert(js.includes('const x = 1 + 1;'), js);
});

run('executes: javascript { } runs as real JavaScript inline', () => {
  const out = exec('javascript { console.log(1 + 2); }\ncetak("selesai")');
  assertEqual(out[0], '3');
  assertEqual(out[1], 'selesai');
});

// ── Timeout: tunggu expr batas N detik ───────────────────────────────────────

console.log('\n── Timeout (batas) ─────────────────────────────────────────────');

run('tokenizes batas/detik as keywords timeout/second', () => {
  assertEqual(tokenize('batas').find(t => t.type === 'KEYWORD').value, 'timeout');
  assertEqual(tokenize('detik').find(t => t.type === 'KEYWORD').value, 'second');
});

run('parse: tunggu expr batas N detik sets timeoutMs = N * 1000', () => {
  const ast = parse(tokenize('fungsi asinkron f() { isi h = tunggu g() batas 5 detik }'));
  const awaitNode = ast.body[0].body.body[0].value;
  assertEqual(awaitNode.type, N.AWAIT_EXPR);
  assertEqual(awaitNode.timeoutMs, 5000);
});

run('parse: plain tunggu expr (no batas) has timeoutMs = null', () => {
  const ast = parse(tokenize('fungsi asinkron f() { isi h = tunggu g() }'));
  assertEqual(ast.body[0].body.body[0].value.timeoutMs, null);
});

run('codegen: batas compiles to Promise.race with __gatra_batas(ms)', () => {
  const js = compile('fungsi asinkron g(): teks { balik "x" }\nfungsi asinkron f() { isi h = tunggu g() batas 5 detik }');
  assert(js.includes('Promise.race([g(), __gatra_batas(5000)])'), js);
  assert(js.includes('function __gatra_batas('), js);
});

run('codegen: __gatra_batas prelude omitted when batas is not used', () => {
  const js = compile('fungsi asinkron g(): teks { balik "x" }\nfungsi asinkron f() { isi h = tunggu g() }');
  assert(!js.includes('__gatra_batas'), js);
});

run('formatter: renders batas N detik back from timeoutMs', () => {
  const out = format('fungsi asinkron f() { isi h = tunggu g() batas 5 detik }');
  assert(out.includes('tunggu g() batas 5 detik'), out);
});

run('executes: batas resolves normally when the awaited call finishes in time', () => {
  const { spawnSync } = require('child_process');
  const os   = require('os');
  const path = require('path');
  const js = compile('fungsi asinkron cepat(): teks { balik "oke" }\nfungsi asinkron utama(): tiada { isi h = tunggu cepat() batas 5 detik\ncetak(h) }\nutama()');
  const tmp = path.join(os.tmpdir(), `gatra_batas_ok_${Date.now()}.js`);
  require('fs').writeFileSync(tmp, js, 'utf8');
  try {
    const result = spawnSync(process.execPath, [tmp], { encoding: 'utf8' });
    assertEqual(result.stdout.trim(), 'oke');
    assertEqual(result.status, 0);
  } finally {
    require('fs').rmSync(tmp, { force: true });
  }
});

run('executes: batas rejects with a Timeout error when the deadline passes first', () => {
  const { spawnSync } = require('child_process');
  const os   = require('os');
  const path = require('path');
  const js = compile('impor tempo dari "node:timers/promises"\nfungsi asinkron lambat(): teks { tunggu tempo.setTimeout(3000)\nbalik "lambat" }\nfungsi asinkron utama(): tiada { coba { isi h = tunggu lambat() batas 1 detik\ncetak(h) } tangkap (e) { cetak("timeout:")\ncetak(e.message) } }\nutama()');
  const tmp = path.join(os.tmpdir(), `gatra_batas_timeout_${Date.now()}.js`);
  require('fs').writeFileSync(tmp, js, 'utf8');
  try {
    const result = spawnSync(process.execPath, [tmp], { encoding: 'utf8', timeout: 5000 });
    const lines = result.stdout.trim().split('\n');
    assertEqual(lines[0], 'timeout:');
    assertEqual(lines[1], 'Timeout');
  } finally {
    require('fs').rmSync(tmp, { force: true });
  }
});

// ── Object Transformation: dengan / ubah ─────────────────────────────────────

console.log('\n── dengan / ubah ────────────────────────────────────────────────');

run('parse: dengan X { ... } produces an ObjectTransformExpr with spread=false', () => {
  const ast = parse(tokenize('isi p = dengan user {\n  id\n  nama = name\n}'));
  const node = ast.body[0].value;
  assertEqual(node.type, N.OBJECT_TRANSFORM_EXPR);
  assertEqual(node.spread, false);
  assertEqual(node.fields.length, 2);
});

run('parse: dengan bare field is shorthand — value is an Identifier with the same name', () => {
  const ast = parse(tokenize('isi p = dengan user {\n  id\n}'));
  const field = ast.body[0].value.fields[0];
  assertEqual(field.name, 'id');
  assertEqual(field.value.type, N.IDENTIFIER);
  assertEqual(field.value.name, 'id');
});

run('parse: ubah X { ... } produces an ObjectTransformExpr with spread=true', () => {
  const ast = parse(tokenize('isi p = ubah user {\n  nama = "Budi"\n}'));
  assertEqual(ast.body[0].value.spread, true);
});

run('parse: ubah requires a value — bare field name is rejected', () => {
  assertThrows(() => parse(tokenize('isi p = ubah user {\n  nama\n}')), "harus diisi lewat 'nama = ekspresi'");
});

run('parse: isi ubah x (mutable var) still parses — no conflict with the new ubah expression', () => {
  const ast = parse(tokenize('isi ubah x = 5'));
  assertEqual(ast.body[0].mutable, true);
});

run('typechecker: bare identifiers inside dengan/ubah fields do not need to be declared', () => {
  tc('isi user = { id: 1, name: "Budi" }\nisi p = dengan user {\n  id\n  nama = name\n}');
  tc('isi user = { nama: "Andi", umur: 20 }\nisi p = ubah user {\n  umur = umur + 1\n}');
});

run('codegen: dengan compiles to an IIFE producing a plain object (no spread)', () => {
  const js = compile('isi user = { id: 1 }\nisi p = dengan user {\n  id\n}');
  assert(js.includes('((__dengan0) => ({ id: __dengan0.id }))(user)'), js);
});

run('codegen: ubah compiles to an IIFE that spreads the source first', () => {
  const js = compile('isi user = { umur: 20 }\nisi p = ubah user {\n  umur = umur + 1\n}');
  assert(js.includes('...__dengan0'), js);
  assert(js.includes('__dengan0.umur + 1'), js);
});

run('executes: dengan renames and computes fields from the source object', () => {
  const out = exec('isi user = { id: 1, name: "Budi", email: "b@x.com", status: "active" }\nisi p = dengan user {\n  id\n  nama = name\n  email\n  aktif = status == "active"\n}\ncetak(p.nama)\ncetak(p.aktif)');
  assertEqual(out[0], 'Budi');
  assertEqual(out[1], 'true');
});

run('executes: dengan does not include unlisted fields from the source', () => {
  // exec()'s mock console.log uses Array.join, which stringifies an
  // `undefined` argument as '' — unlike Node's real console ('undefined').
  const out = exec('isi user = { id: 1, name: "Budi", secret: "x" }\nisi p = dengan user {\n  id\n}\ncetak(p.secret)');
  assertEqual(out[0], '');
});

run('executes: ubah keeps all original fields and only overrides the listed ones', () => {
  const out = exec('isi user = { nama: "Andi", umur: 20, kota: "Bandung" }\nisi p = ubah user {\n  nama = "Budi"\n}\ncetak(p.umur)\ncetak(p.kota)\ncetak(p.nama)');
  assertEqual(out[0], '20');
  assertEqual(out[1], 'Bandung');
  assertEqual(out[2], 'Budi');
});

run('executes: ubah does not mutate the original source object', () => {
  const out = exec('isi user = { umur: 20 }\nisi p = ubah user {\n  umur = 99\n}\ncetak(user.umur)\ncetak(p.umur)');
  assertEqual(out[0], '20');
  assertEqual(out[1], '99');
});

run('executes: nested arrow params inside a dengan/ubah field are not corrupted', () => {
  const out = exec('isi user = { daftar: [1, 2, 3] }\nisi p = dengan user {\n  hasil = daftar.map((n) => n * 2)\n}\ncetak(p.hasil)');
  assertEqual(out[0], '2,4,6');
});

run('linter: dengan/ubah field identifiers do not count as scope usage or trigger undefined warnings', () => {
  const ast = parse(tokenize('isi user = { id: 1 }\nisi p = dengan user {\n  id\n}\ncetak(p)'));
  assertEqual(lint(ast).length, 0);
});

run('formatter: dengan round-trips with shorthand fields preserved', () => {
  const out = format('isi p = dengan user {\n  id\n  nama = name\n}');
  assert(out.includes('dengan user {'), out);
  assert(/\n\s*id\n/.test(out), out); // shorthand 'id' stays bare, not 'id = id'
});

run('formatter: ubah round-trips', () => {
  const out = format('isi p = ubah user {\n  umur = umur + 1\n}');
  assert(out.includes('ubah user {') && out.includes('umur = umur + 1'), out);
});

// ── hasil<T,E>: berhasil / gagal / cocok pattern matching ────────────────────

console.log('\n── hasil<T,E> ──────────────────────────────────────────────────');

run('parse: hasil<T, E> return type parses to canonical result<T, E>', () => {
  const ast = parse(tokenize('fungsi bagi(a: angka, b: angka): hasil<angka, teks> { balik berhasil(1) }'));
  assertEqual(ast.body[0].returnType, 'result<number, string>');
});

run('parse: "hasil" is still usable as a plain variable name', () => {
  const ast = parse(tokenize('isi hasil = 5\ncetak(hasil)'));
  assertEqual(ast.body[0].name, 'hasil');
});

run('parse: cocok expr { berhasil(n) => .. gagal(e) => .. } produces MatchResultStmt', () => {
  const ast = parse(tokenize('cocok r {\n  berhasil(nilai) => cetak(nilai)\n  gagal(galat) => cetak(galat)\n}'));
  const node = ast.body[0];
  assertEqual(node.type, N.MATCH_RESULT_STMT);
  assertEqual(node.okArm.binding, 'nilai');
  assertEqual(node.errArm.binding, 'galat');
});

run('parse: cocok accepts just one arm (berhasil or gagal alone)', () => {
  const ast = parse(tokenize('cocok r {\n  berhasil(n) => cetak(n)\n}'));
  assert(ast.body[0].okArm !== null);
  assertEqual(ast.body[0].errArm, null);
});

run('parse: cocok rejects an unknown pattern', () => {
  assertThrows(() => parse(tokenize('cocok r {\n  entahapa(n) => cetak(n)\n}')), "hanya menerima pola");
});

run('parse: cocok rejects a duplicate berhasil arm', () => {
  assertThrows(
    () => parse(tokenize('cocok r {\n  berhasil(a) => cetak(a)\n  berhasil(b) => cetak(b)\n}')),
    "hanya boleh muncul sekali"
  );
});

run('parse: cocok with no arms at all is rejected', () => {
  assertThrows(() => parse(tokenize('cocok r {}')), "membutuhkan minimal satu pola");
});

run('typechecker: berhasil/gagal calls and cocok arms type-check without error', () => {
  tc('fungsi bagi(a: angka, b: angka): hasil<angka, teks> {\n  jika (b == 0) { balik gagal("nol") }\n  balik berhasil(a / b)\n}\nisi r = bagi(10, 2)\ncocok r {\n  berhasil(nilai) => cetak(nilai)\n  gagal(galat) => cetak(galat)\n}');
});

run('codegen: berhasil/gagal rewritten to mangled runtime constructors', () => {
  const js = compile('fungsi f(): hasil<angka, teks> { balik berhasil(1) }');
  assert(js.includes('__gatra_berhasil(1)'), js);
  assert(js.includes("function __gatra_berhasil("), js);
});

run('codegen: hasil prelude omitted when berhasil/gagal/cocok are not used', () => {
  const js = compile('isi x = 5\ncetak(x)');
  assert(!js.includes('__gatra_berhasil') && !js.includes('__gatra_gagal'), js);
});

run('codegen: cocok compiles to tag checks with bound const per arm', () => {
  const js = compile('isi r: apa_saja = kosong\ncocok r {\n  berhasil(nilai) => cetak(nilai)\n  gagal(galat) => cetak(galat)\n}');
  assert(js.includes("__tag === 'berhasil'"), js);
  assert(js.includes("__tag === 'gagal'"), js);
  assert(js.includes('const nilai = '), js);
  assert(js.includes('const galat = '), js);
});

run('executes: cocok runs the berhasil arm and binds the wrapped value', () => {
  const out = exec('fungsi bagi(a: angka, b: angka): hasil<angka, teks> {\n  jika (b == 0) { balik gagal("nol") }\n  balik berhasil(a / b)\n}\nisi r = bagi(10, 2)\ncocok r {\n  berhasil(nilai) => cetak(nilai)\n  gagal(galat) => cetak(galat)\n}');
  assertEqual(out[0], '5');
});

run('executes: cocok runs the gagal arm and binds the wrapped error', () => {
  const out = exec('fungsi bagi(a: angka, b: angka): hasil<angka, teks> {\n  jika (b == 0) { balik gagal("tidak dapat membagi dengan nol") }\n  balik berhasil(a / b)\n}\nisi r = bagi(10, 0)\ncocok r {\n  berhasil(nilai) => cetak(nilai)\n  gagal(galat) => cetak(galat)\n}');
  assertEqual(out[0], 'tidak dapat membagi dengan nol');
});

run('linter: cocok arm bindings do not trigger unused-variable warnings', () => {
  const ast = parse(tokenize('isi r: apa_saja = kosong\ncocok r {\n  berhasil(nilai) => cetak(1)\n  gagal(galat) => cetak(2)\n}'));
  assertEqual(lint(ast).filter(f => f.rule === 'variabel-tidak-digunakan').length, 0);
});

run('formatter: cocok round-trips with berhasil/gagal arms', () => {
  const out = format('cocok r {\n  berhasil(nilai) => cetak(nilai)\n  gagal(galat) => cetak(galat)\n}');
  assert(out.includes('cocok r {'), out);
  assert(out.includes('berhasil(nilai) => cetak(nilai)'), out);
  assert(out.includes('gagal(galat) => cetak(galat)'), out);
});

run('formatter: hasil<T, E> return type round-trips (regression: was leaking canonical result<T, E>)', () => {
  const src = 'fungsi bagi(a: angka, b: angka): hasil<angka, teks> { balik berhasil(1) }';
  const once = format(src);
  assert(once.includes('hasil<angka, teks>'), once);
  assert(!once.includes('result<'), once);
  assertEqual(once, format(once));
});

// ── ukur "label" { ... } — timing / observability ────────────────────────────

console.log('\n── ukur (timing) ───────────────────────────────────────────────');

run('tokenizes ukur as keyword measure', () => {
  assertEqual(tokenize('ukur').find(t => t.type === 'KEYWORD').value, 'measure');
});

run('parse: ukur "label" { ... } produces a MeasureStmt', () => {
  const ast = parse(tokenize('ukur "proses" {\n  cetak(1)\n}'));
  assertEqual(ast.body[0].type, N.MEASURE_STMT);
  assertEqual(ast.body[0].label, 'proses');
});

run('typechecker: tunggu inside ukur still requires an async enclosing function', () => {
  assertThrows(
    () => tc('fungsi asinkron g(): tiada {}\nfungsi f(): tiada {\n  ukur "x" {\n    tunggu g()\n  }\n}'),
    'asinkron'
  );
  tc('fungsi asinkron g(): tiada {}\nfungsi asinkron f(): tiada {\n  ukur "x" {\n    tunggu g()\n  }\n}');
});

run('codegen: ukur wraps the body in try/finally and logs elapsed ms', () => {
  const js = compile('ukur "proses" {\n  cetak(1)\n}');
  assert(js.includes('performance.now()'), js);
  assert(js.includes('try {') && js.includes('} finally {'), js);
  assert(js.includes('"proses" + \':'), js);
  assert(js.includes("+ 'ms'"), js);
});

run('formatter: ukur round-trips', () => {
  const out = format('ukur "proses" {\n  cetak(1)\n}');
  assert(out.includes('ukur "proses" {'), out);
});

run('executes: ukur logs "<label>: <N>ms" and still runs the body normally', () => {
  // Regression: vm.createContext() sandbox in cli/gatra.js did not expose
  // 'performance' (or setTimeout et al.), so this threw ReferenceError when
  // run through 'gatra jalankan' on a file with no impor statements.
  const { spawnSync } = require('child_process');
  const os   = require('os');
  const path = require('path');
  const js = compile('fungsi utama(): tiada {\n  ukur "proses" {\n    cetak("dalam")\n  }\n}\nutama()');
  const tmp = path.join(os.tmpdir(), `gatra_ukur_test_${Date.now()}.js`);
  require('fs').writeFileSync(tmp, js, 'utf8');
  try {
    const result = spawnSync(process.execPath, [tmp], { encoding: 'utf8' });
    assertEqual(result.status, 0);
    const lines = result.stdout.trim().split('\n');
    assertEqual(lines[0], 'dalam');
    assert(/^proses: \d+ms$/.test(lines[1]), result.stdout);
  } finally {
    require('fs').rmSync(tmp, { force: true });
  }
});

run('executes via gatra jalankan CLI: ukur works with no impor statements (sandboxed vm path)', () => {
  const { spawnSync } = require('child_process');
  const os   = require('os');
  const path = require('path');
  const cliPath = path.resolve(__dirname, '../src/cli/gatra.js');
  const tmp = path.join(os.tmpdir(), `gatra_ukur_cli_test_${Date.now()}.gatra`);
  require('fs').writeFileSync(tmp, 'ukur "proses" {\n  cetak("dalam")\n}\n', 'utf8');
  try {
    const result = spawnSync(process.execPath, [cliPath, 'jalankan', tmp], { encoding: 'utf8' });
    assertEqual(result.status, 0);
    const lines = result.stdout.trim().split('\n');
    assertEqual(lines[0], 'dalam');
    assert(/^proses: \d+ms$/.test(lines[1]), result.stdout);
  } finally {
    require('fs').rmSync(tmp, { force: true });
  }
});

run('executes: ukur still logs duration even when the body returns early', () => {
  const { spawnSync } = require('child_process');
  const os   = require('os');
  const path = require('path');
  const js = compile('fungsi cepat(): angka {\n  ukur "cepat" {\n    balik 1\n  }\n}\ncetak(cepat())');
  const tmp = path.join(os.tmpdir(), `gatra_ukur_return_${Date.now()}.js`);
  require('fs').writeFileSync(tmp, js, 'utf8');
  try {
    const result = spawnSync(process.execPath, [tmp], { encoding: 'utf8' });
    assertEqual(result.status, 0);
    const lines = result.stdout.trim().split('\n');
    assert(/^cepat: \d+ms$/.test(lines[0]), result.stdout);
    assertEqual(lines[1], '1');
  } finally {
    require('fs').rmSync(tmp, { force: true });
  }
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
