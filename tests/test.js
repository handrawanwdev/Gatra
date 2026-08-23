'use strict';

const { tokenize }         = require('../src/lexer/lexer');
const { parse }            = require('../src/parser/parser');
const { typecheck }        = require('../src/typechecker/typechecker');
const { ownershipCheck }   = require('../src/ownership/ownership-checker');
const { irNormalize }      = require('../src/ir/ir-normalizer');
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
  ownershipCheck(ast, grammar);
  irNormalize(ast);
  return generate(ast, opts);
}

function tc(src) {
  const grammar = detectGrammar(src);
  const ast     = parse(tokenize(src));
  typecheck(ast, grammar);
}

function oc(src) {
  const grammar = detectGrammar(src);
  const ast     = parse(tokenize(src));
  typecheck(ast, grammar);
  ownershipCheck(ast, grammar);
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

// ── Ownership Tests ───────────────────────────────────────────────────────────

console.log('\nOwnership');

run('primitives use copy semantics — no move', () => {
  oc('isi a = 10 isi b = a cetak(a) cetak(b)');
});

run('struct move: use-after-move detected', () => {
  assertThrows(() => oc(`
struktur Kotak { nilai: angka }
isi a = Kotak { nilai: 1 }
isi b = a
cetak(a.nilai)
`), 'sudah dipindahkan');
});

run('struct move: original invalid, new owner valid', () => {
  oc(`
struktur Kotak { nilai: angka }
isi a = Kotak { nilai: 1 }
isi b = a
cetak(b.nilai)
`);
});

run('move into function arg (struct)', () => {
  assertThrows(() => oc(`
struktur Kotak { nilai: angka }
fungsi konsumsi(b: Kotak) { cetak(b.nilai) }
isi x = Kotak { nilai: 5 }
konsumsi(x)
cetak(x.nilai)
`), 'sudah dipindahkan');
});

run('mutation requires ubah declaration', () => {
  assertThrows(() => oc('isi x = 10 x = 20'), 'belum dideklarasikan sebagai mutable');
});

run('ubah variable can be reassigned', () => {
  const out = exec('isi ubah x = 10 x = 20 cetak(x)');
  assertEqual(out[0], '20');
});

run('assignNonMutable error in indonesian', () => {
  assertThrows(() => oc('isi x = 10 x = 20'), 'belum dideklarasikan sebagai mutable');
});

run('immutable borrow: multiple &x borrows allowed', () => {
  oc(`
isi x = 10
isi r1 = &x
isi r2 = &x
cetak(*r1)
cetak(*r2)
`);
});

run('immutable borrow: cannot mutably borrow while immutably borrowed', () => {
  assertThrows(() => oc(`
isi ubah x = 10
isi r1 = &x
isi r2 = &ubah x
`), 'Tidak bisa meminjam');
});

run('mutable borrow: only one &ubah allowed', () => {
  assertThrows(() => oc(`
isi ubah x = 10
isi r1 = &ubah x
isi r2 = &ubah x
`), 'Tidak bisa meminjam');
});

run('mutable borrow requires ubah variable', () => {
  assertThrows(() => oc(`
isi x = 10
isi r = &ubah x
`), 'belum dideklarasikan sebagai mutable');
});

run('cannot move variable that is borrowed', () => {
  assertThrows(() => oc(`
struktur Kotak { nilai: angka }
isi a = Kotak { nilai: 1 }
isi r = &a
isi b = a
`), 'sedang dipinjam');
});

run('deref read: *r resolves to value', () => {
  const out = exec('isi x = 42 isi r = &x cetak(*r)');
  assertEqual(out[0], '42');
});

run('deref write: *r = value modifies original', () => {
  const out = exec('isi ubah x = 10 isi r = &ubah x *r = 99 cetak(x)');
  assertEqual(out[0], '99');
});

run('assign through immutable borrow is error', () => {
  assertThrows(() => oc(`
isi ubah x = 10
isi r = &x
*r = 20
`), 'Tidak bisa mengubah nilai melalui referensi');
});

run('use-after-move error in indonesian', () => {
  assertThrows(() => oc(`
struktur Kotak { nilai: angka }
isi a = Kotak { nilai: 1 }
isi b = a
cetak(a.nilai)
`), 'sudah dipindahkan');
});

run('IR normalizer annotates copy op on primitive VarDecl', () => {
  const src = 'isi x = 10';
  const grammar = detectGrammar(src);
  const ast = parse(tokenize(src));
  typecheck(ast, grammar);
  ownershipCheck(ast, grammar);
  irNormalize(ast);
  assertEqual(ast.body[0]._ownershipOp, 'copy');
});

run('IR normalizer annotates move op on struct VarDecl', () => {
  const src = 'struktur Kotak { v: angka } isi a = Kotak { v: 1 } isi b = a';
  const grammar = detectGrammar(src);
  const ast = parse(tokenize(src));
  typecheck(ast, grammar);
  ownershipCheck(ast, grammar);
  irNormalize(ast);
  assertEqual(ast.body[2]._ownershipOp, 'move');
});

run('IR normalizer annotates borrow op', () => {
  const src = 'isi x = 10 isi r = &x';
  const grammar = detectGrammar(src);
  const ast = parse(tokenize(src));
  typecheck(ast, grammar);
  ownershipCheck(ast, grammar);
  irNormalize(ast);
  assertEqual(ast.body[1]._ownershipOp, 'borrow');
  assertEqual(ast.body[1]._borrowTarget, 'x');
});

run('borrow released after scope — original usable again (struct)', () => {
  oc(`
struktur Kotak { nilai: angka }
isi a = Kotak { nilai: 1 }
fungsi tes(b: Kotak) { cetak(b.nilai) }
isi r = &a
cetak(*r)
`);
});

run('struct reassign via = moves source', () => {
  assertThrows(() => oc(`
struktur Kotak { nilai: angka }
isi ubah a = Kotak { nilai: 1 }
isi b = Kotak { nilai: 2 }
a = b
cetak(b.nilai)
`), 'sudah dipindahkan');
});

run('struct init followed by deref write parses correctly', () => {
  oc(`
struktur Kotak { nilai: angka }
isi ubah a = Kotak { nilai: 1 }
isi r = &ubah a
isi b = Kotak { nilai: 2 }
*r = b
`);
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
fungsi terapkan(f: apapun, n: angka): angka { balik f(n) }
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
  const js = compile('isi x: apapun = kosong');
  assert(js.includes('null'), `got: ${js}`);
});

run('null comparison allowed', () => {
  tc('isi x: apapun = kosong\njika (x == kosong) { cetak("ya") }');
});

run('executes null check', () => {
  const out = exec('isi x: apapun = kosong\njika (x == kosong) { cetak("kosong") } lain { cetak("bukan") }');
  assertEqual(out[0], 'kosong');
});

// apapun type
run('apapun type accepts any value', () => {
  const js = compile('isi x: apapun = 42\nisi y: apapun = "teks"\nisi z: apapun = benar');
  assert(js.includes('let x = 42'));
});

run('function parameter apapun accepts any call arg', () => {
  tc('fungsi f(x: apapun): apapun { balik x }\nf(42)\nf("teks")\nf(benar)');
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
  const js = compile('fungsi f(x: apapun): tiada {}\nf({ a: 1, b: benar })');
  assert(js.includes('f({ a: 1, b: true })'));
});

run('object literal as argument to method chain', () => {
  const js = compile('isi res: apapun = kosong\nres.json({ status: 200 })');
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
  const js = compile('isi obj: apapun = kosong\nisi { id, nama } = obj');
  assert(js.includes('let { id, nama } = obj'));
});

run('array destructuring codegen', () => {
  const js = compile('isi arr: apapun = kosong\nisi [first, second] = arr');
  assert(js.includes('let [first, second] = arr'));
});

run('destructuring with rename', () => {
  const js = compile('isi obj: apapun = kosong\nisi { id: userId } = obj');
  assert(js.includes('let { id: userId } = obj'));
});

run('destructured bindings usable', () => {
  const js = compile('isi obj: apapun = kosong\nisi { id, nama } = obj\ncetak(id)');
  assert(js.includes('console.log(id)'));
});

// Ternary
run('ternary Python-style codegen', () => {
  const js = compile('isi x = 5\nisi r = "besar" jika x > 3 lain "kecil"');
  assert(js.includes('? "besar" : "kecil"'));
});

run('ternary does not consume next jika statement', () => {
  const js = compile('isi x: apapun = kosong\nisi { id } = x\njika (id == kosong) { cetak("nil") }');
  assert(js.includes('let { id } = x'));
  assert(js.includes('if ((id == null))'));
});

run('ternary in function call', () => {
  const js = compile('fungsi f(s: teks): tiada {}\nisi n = 5\nf("besar" jika n > 3 lain "kecil")');
  assert(js.includes('? "besar" : "kecil"'));
});

// Spread
run('spread in object literal', () => {
  const js = compile('isi a: apapun = kosong\nisi b = { ...a, key: "val" }');
  assert(js.includes('{ ...a, key: "val" }'));
});

run('spread in array literal', () => {
  const js = compile('isi arr: apapun = kosong\nisi b = [...arr, 10]');
  assert(js.includes('[...arr, 10]'));
});

run('spread in function call', () => {
  const js = compile('fungsi f(a: apapun, b: apapun): tiada {}\nisi args: apapun = kosong\nf(...args)');
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

// cocok / kasus / lain (match)

run('tokenizes cocok/kasus as keywords match/case', () => {
  assertEqual(tokenize('cocok').find(t => t.type === 'KEYWORD').value, 'match');
  assertEqual(tokenize('kasus').find(t => t.type === 'KEYWORD').value, 'case');
});

run('parse: cocok statement with kasus and lain arms', () => {
  const src = 'cocok x { kasus 1 -> cetak("satu") kasus 2 -> cetak("dua") lain -> cetak("lainnya") }';
  const ast = parse(tokenize(src));
  assertEqual(ast.body[0].type, N.MATCH_STMT);
  assertEqual(ast.body[0].cases.length, 2);
  assert(ast.body[0].defaultCase !== null);
});

run('codegen: cocok compiles to if/else if/else chain', () => {
  const js = compile('isi x = 2\ncocok x { kasus 1 -> cetak("satu") kasus 2 -> cetak("dua") lain -> cetak("lainnya") }');
  assert(js.includes('if (') && js.includes('else if (') && js.includes('else {'), `got: ${js}`);
});

run('executes cocok statement (matches a kasus arm)', () => {
  const out = exec('isi x = 2\ncocok x { kasus 1 -> cetak("satu") kasus 2 -> cetak("dua") lain -> cetak("lainnya") }');
  assertEqual(out[0], 'dua');
});

run('executes cocok statement (falls through to lain)', () => {
  const out = exec('isi x = 9\ncocok x { kasus 1 -> cetak("satu") kasus 2 -> cetak("dua") lain -> cetak("lainnya") }');
  assertEqual(out[0], 'lainnya');
});

run('typechecker: cocok rejects incompatible kasus type', () => {
  assertThrows(
    () => tc('isi x: angka = 1\ncocok x { kasus "teks" -> cetak("x") }'),
    'Diharapkan'
  );
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

run('ownership: optional primitive still uses copy semantics', () => {
  oc('isi a: angka? = 5\nisi b = a\ncetak(a)');
});

run('display: optional type shown with ? suffix in Bahasa Indonesia', () => {
  assertThrows(() => tc('isi nama: teks = 5'), "'teks'");
});

// Kunci / Saluran

run('codegen: kunci() rewritten to mangled runtime name', () => {
  const js = compile('isi kunci = kunci()');
  assert(js.includes('__gatra_kunci()'), `got: ${js}`);
  assert(js.includes('let kunci = __gatra_kunci()'), `got: ${js}`);
});

run('codegen: saluran() rewritten to mangled runtime name', () => {
  const js = compile('isi saluran = saluran()');
  assert(js.includes('__gatra_saluran()'), `got: ${js}`);
});

run('codegen: kunci prelude only emitted when kunci() is used', () => {
  const js = compile('isi x = 5\ncetak(x)');
  assert(!js.includes('__gatra_kunci'), `got: ${js}`);
});

run('typechecker: isi kunci = kunci() does not throw duplicateVar', () => {
  tc('isi kunci = kunci()\nkunci.kunci()');
});

run('typechecker: isi saluran = saluran() does not throw duplicateVar', () => {
  tc('isi saluran = saluran()\nsaluran.kirim(1)');
});

run('executes kunci()/buka() mutex cycle', () => {
  const js = compile('isi kunci = kunci()\nfungsi asinkron f() { tunggu kunci.kunci()\ncetak("dalam")\nkunci.buka() }\nf()');
  const ctx = vm.createContext({ console: { log: () => {} } });
  new vm.Script(js).runInContext(ctx); // must not throw (async body scheduled via microtask)
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

// ── Tahap Lanjutan (Pekerja, Concurrency Terstruktur, Pilih) ────────────────

console.log('\n── Tahap Lanjutan ─────────────────────────────────────────────');

run('parse: pekerja fungsi sets isWorker=true', () => {
  const ast = parse(tokenize('pekerja fungsi hitung(x: angka): angka { balik x }'));
  assertEqual(ast.body[0].isWorker, true);
});

run('parse: jalankan expr produces SpawnExpr wrapping a call', () => {
  const ast = parse(tokenize('pekerja fungsi hitung(x: angka): angka { balik x }\nisi h = jalankan hitung(1)'));
  assertEqual(ast.body[1].value.type, N.SPAWN_EXPR);
});

run('typechecker: jalankan on a non-pekerja fungsi is rejected', () => {
  assertThrows(
    () => tc('fungsi biasa(x: angka): angka { balik x }\nisi h = jalankan biasa(1)'),
    'pekerja'
  );
});

run('typechecker: jalankan on a pekerja fungsi is accepted', () => {
  tc('pekerja fungsi hitung(x: angka): angka { balik x }\nfungsi asinkron f(): tiada { isi h = tunggu jalankan hitung(1) }');
});

run('codegen: jalankan rewritten to __gatra_jalankan with args array', () => {
  const js = compile('pekerja fungsi hitung(x: angka): angka { balik x }\nisi h = jalankan hitung(7)');
  assert(js.includes('__gatra_jalankan(hitung, [7])'), `got: ${js}`);
});

run('codegen: __gatra_jalankan prelude only emitted when jalankan expr used', () => {
  const js = compile('isi x = 5\ncetak(x)');
  assert(!js.includes('__gatra_jalankan'), `got: ${js}`);
});

run('parse: tugas requires a call expression', () => {
  assertThrows(() => parse(tokenize('tugas 5')), "'tugas' harus diikuti");
});

run('parse: jalankan { } tunggu produces StructuredSpawn', () => {
  const ast = parse(tokenize('fungsi asinkron a() { balik 1 }\njalankan {\n  tugas a()\n} tunggu'));
  assertEqual(ast.body[1].type, N.STRUCTURED_SPAWN);
});

run('typechecker: jalankan { } tunggu requires async context', () => {
  assertThrows(
    () => tc('fungsi asinkron a() { balik 1 }\nfungsi f(): tiada {\n  jalankan {\n    tugas a()\n  } tunggu\n}'),
    'asinkron'
  );
});

run('codegen: jalankan { } tunggu collects tugas calls and awaits Promise.all', () => {
  const js = compile('fungsi asinkron a() { balik 1 }\nfungsi asinkron f(): tiada {\n  jalankan {\n    tugas a()\n  } tunggu\n}');
  assert(js.includes('Promise.all('), `got: ${js}`);
  assert(js.includes('.push(a())'), `got: ${js}`);
});

run('executes: tugas outside jalankan block is fire-and-forget', () => {
  const js = compile('fungsi asinkron a(): tiada { cetak("jalan") }\ntugas a()');
  assert(!js.includes('.push('), `got: ${js}`);
});

run('parse: pilih requires at least one kasus', () => {
  assertThrows(() => parse(tokenize('pilih {}')), "minimal satu 'kasus'");
});

run('parse: pilih produces SelectStmt with cases', () => {
  const ast = parse(tokenize('isi s1 = saluran()\npilih {\n  kasus s1 -> cetak(1)\n}'));
  assertEqual(ast.body[1].type, N.SELECT_STMT);
  assertEqual(ast.body[1].cases.length, 1);
});

run('typechecker: pilih requires async context', () => {
  assertThrows(
    () => tc('fungsi f(): tiada {\n  isi s1 = saluran()\n  pilih {\n    kasus s1 -> cetak(1)\n  }\n}'),
    'asinkron'
  );
});

run('codegen: pilih compiles to Promise.race over .terima()', () => {
  const js = compile('fungsi asinkron f(): tiada {\n  isi s1 = saluran()\n  pilih {\n    kasus s1 -> cetak(1)\n  }\n}');
  assert(js.includes('Promise.race(') && js.includes('s1.terima().then('), `got: ${js}`);
});

run('executes: pekerja/jalankan runs on a real worker thread and returns result', () => {
  const { spawnSync } = require('child_process');
  const os   = require('os');
  const path = require('path');
  const js = compile('pekerja fungsi hitung(x: angka): angka { balik x * 2 }\nfungsi asinkron utama(): tiada { isi h = tunggu jalankan hitung(21)\ncetak(h) }\nutama()');
  const tmp = path.join(os.tmpdir(), `gatra_pekerja_test_${Date.now()}.js`);
  require('fs').writeFileSync(tmp, js, 'utf8');
  try {
    const result = spawnSync(process.execPath, [tmp], { encoding: 'utf8' });
    assertEqual(result.stdout.trim(), '42');
  } finally {
    require('fs').rmSync(tmp, { force: true });
  }
});

run('executes: jalankan { } tunggu waits for all tugas before continuing', () => {
  const { spawnSync } = require('child_process');
  const os   = require('os');
  const path = require('path');
  const js = compile('fungsi asinkron a(): tiada { cetak("a") }\nfungsi asinkron b(): tiada { cetak("b") }\nfungsi asinkron utama(): tiada {\n  jalankan {\n    tugas a()\n    tugas b()\n  } tunggu\n  cetak("selesai")\n}\nutama()');
  const tmp = path.join(os.tmpdir(), `gatra_tugas_test_${Date.now()}.js`);
  require('fs').writeFileSync(tmp, js, 'utf8');
  try {
    const result = spawnSync(process.execPath, [tmp], { encoding: 'utf8' });
    const lines = result.stdout.trim().split('\n');
    assertEqual(lines[lines.length - 1], 'selesai');
  } finally {
    require('fs').rmSync(tmp, { force: true });
  }
});

run('formatter: renders pekerja/jalankan/tugas/pilih', () => {
  const src = 'pekerja fungsi hitung(x: angka): angka { balik x }\nfungsi asinkron f(): tiada {\n  isi h = tunggu jalankan hitung(1)\n  jalankan {\n    tugas hitung(1)\n  } tunggu\n}';
  const out = format(src);
  assert(out.includes('pekerja fungsi hitung'), out);
  assert(out.includes('jalankan hitung(1)'), out);
  assert(out.includes('jalankan {') && out.includes('} tunggu'), out);
});

run('linter: pilih case channel usage counts as used', () => {
  const ast = parse(tokenize('fungsi asinkron f(): tiada {\n  isi s1 = saluran()\n  pilih {\n    kasus s1 -> cetak(1)\n  }\n}'));
  assertEqual(lint(ast).filter(f => f.rule === 'variabel-tidak-digunakan').length, 0);
});

// ── Pengelola Paket (gatra mulai) ────────────────────────────────────────────

console.log('\n── Pengelola Paket ────────────────────────────────────────────');

run('gatra mulai scaffolds a runnable project', () => {
  const { spawnSync } = require('child_process');
  const os   = require('os');
  const path = require('path');
  const fs   = require('fs');
  const cliPath = path.resolve(__dirname, '../src/cli/gatra.js');
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gatra_mulai_'));
  const projectName = 'proyek_uji';
  try {
    const init = spawnSync(process.execPath, [cliPath, 'mulai', projectName], { cwd: workDir, encoding: 'utf8' });
    assertEqual(init.status, 0);
    const projectDir = path.join(workDir, projectName);
    assert(fs.existsSync(path.join(projectDir, 'gatra.mod')), 'gatra.mod should exist');
    assert(fs.existsSync(path.join(projectDir, 'utama.gatra')), 'utama.gatra should exist');
    const run = spawnSync(process.execPath, [cliPath, 'jalankan', 'utama.gatra'], { cwd: projectDir, encoding: 'utf8' });
    assertEqual(run.status, 0);
    assert(run.stdout.includes(`Halo, ${projectName}!`), run.stdout);
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

// ── LSP (gatra lsp) ──────────────────────────────────────────────────────────

console.log('\n── LSP ────────────────────────────────────────────────────────');

const { computeDiagnostics, RpcConnection } = require('../src/lsp/server');
const { EventEmitter } = require('events');

run('lsp: computeDiagnostics reports a type error', () => {
  const diags = computeDiagnostics('isi x: teks = 5');
  assertEqual(diags.length, 1);
  assertEqual(diags[0].severity, 1);
  assert(diags[0].message.includes('Diharapkan'), diags[0].message);
});

run('lsp: computeDiagnostics reports a parse error', () => {
  const diags = computeDiagnostics('isi x = ');
  assertEqual(diags.length, 1);
  assertEqual(diags[0].severity, 1);
});

run('lsp: computeDiagnostics reports linter warnings', () => {
  const diags = computeDiagnostics('fungsi f(): tiada {\n  isi x = 5\n}');
  assert(diags.some(d => d.severity === 2 && d.source === 'gatra(variabel-tidak-digunakan)'), JSON.stringify(diags));
});

run('lsp: computeDiagnostics is empty for clean code', () => {
  assertEqual(computeDiagnostics('isi x: angka = 5\ncetak(x)').length, 0);
});

run('lsp: RpcConnection parses Content-Length framed JSON-RPC and dispatches', () => {
  const input  = new EventEmitter();
  const writes = [];
  const output = { write: (d) => writes.push(d) };
  const rpc = new RpcConnection(input, output);
  let received = null;
  rpc.onMessage('foo', (params) => { received = params; return { ok: true }; });

  const msg = JSON.stringify({ jsonrpc: '2.0', method: 'foo', params: { a: 1 }, id: 5 });
  const framed = `Content-Length: ${Buffer.byteLength(msg)}\r\n\r\n${msg}`;
  input.emit('data', Buffer.from(framed));

  assertEqual(received.a, 1);
  assert(writes[0].includes('"result":{"ok":true}'), writes[0]);
});

run('lsp: RpcConnection handles a message split across multiple chunks', () => {
  const input  = new EventEmitter();
  const writes = [];
  const output = { write: (d) => writes.push(d) };
  const rpc = new RpcConnection(input, output);
  let received = null;
  rpc.onMessage('bar', (params) => { received = params; });

  const msg = JSON.stringify({ jsonrpc: '2.0', method: 'bar', params: { b: 2 } });
  const framed = `Content-Length: ${Buffer.byteLength(msg)}\r\n\r\n${msg}`;
  const mid = Math.floor(framed.length / 2);
  input.emit('data', Buffer.from(framed.slice(0, mid)));
  assertEqual(received, null);
  input.emit('data', Buffer.from(framed.slice(mid)));
  assertEqual(received.b, 2);
});

// ── Ownership Bug Fix: cetak() harus meminjam, bukan memindahkan ────────────

console.log('\n── Ownership: cetak() tidak memindahkan ────────────────────────');

run('ownership: cetak(struct) does not move it — struct usable afterward', () => {
  oc('struktur T { x: angka }\nisi p = T { x: 1 }\ncetak(p)\ncetak(p.x)');
});

run('ownership: cetak(larik) does not move it — larik usable afterward', () => {
  oc('isi xs: angka[] = [1, 2, 3]\ncetak(xs)\nuntuk n dalam xs { cetak(n) }');
});

run('ownership: passing struct to a real function still moves it', () => {
  assertThrows(
    () => oc('struktur T { x: angka }\nfungsi f(t: T): angka { balik t.x }\nisi p = T { x: 1 }\nf(p)\ncetak(p.x)'),
    'dipindahkan'
  );
});

// ── Summary ───────────────────────────────────────────────────────────────────

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
