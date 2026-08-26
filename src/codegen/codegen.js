'use strict';

const path = require('path');
const { NodeType: N } = require('../ast/nodes');
const { isPublicName } = require('../module/visibility');
const { resolveLocalPath, getModuleExports } = require('../module/resolver');
const { isBuiltinModule } = require('../module/external-interop');

// fungsi paralel — runtime scheduler for Automatic_Concurrency.md's Phase 0
// (bounded worker pool + adaptive cost-based dispatch). Same "real, testable
// file, not an inlined prelude string" reasoning as the runtime module used
// to have for the (since-removed) data<T> primitive.
const SCHEDULER_RUNTIME_PATH = path.resolve(__dirname, '../runtime/scheduler.js');

// tunggu expr batas N detik — Promise.race antara expr dan timer yang me-reject.
const BATAS_PRELUDE = `function __gatra_batas(ms) {
  return new Promise((_, tolak) => setTimeout(() => tolak(new Error('Timeout')), ms));
}`;

// Recursively scans an AST (or any plain object/array) for an AWAIT_EXPR
// that uses 'batas' (timeoutMs set) — only then is the prelude needed.
function usesTimeout(node) {
  if (!node || typeof node !== 'object') return false;
  if (Array.isArray(node)) return node.some(usesTimeout);
  if (node.type === N.AWAIT_EXPR && node.timeoutMs != null) return true;
  return Object.keys(node).some(k => k !== 'type' && usesTimeout(node[k]));
}

// hasil<T,E> — berhasil(v)/gagal(e) hanya membungkus nilainya dengan tag,
// dibongkar lewat 'cocok'.
const HASIL_PRELUDE = `function __gatra_berhasil(nilai) { return { __tag: 'berhasil', nilai }; }
function __gatra_gagal(galat) { return { __tag: 'gagal', galat }; }`;

// Recursively scans an AST (or any plain object/array) for a zero/one-arg
// call to 'berhasil'/'gagal' (identifier callee) — only then is the
// hasil<T,E> prelude needed.
function usesHasil(node) {
  if (!node || typeof node !== 'object') return false;
  if (Array.isArray(node)) return node.some(usesHasil);
  if (node.type === N.CALL_EXPR && typeof node.callee === 'object' &&
      node.callee.type === N.IDENTIFIER && (node.callee.name === 'berhasil' || node.callee.name === 'gagal')) {
    return true;
  }
  if (node.type === N.MATCH_RESULT_STMT) return true;
  return Object.keys(node).some(k => k !== 'type' && usesHasil(node[k]));
}

// Go-style visibility (PascalCase-public) extended to every non-local module
// — Node builtins get it for free (their real member list is exhaustive, so
// the typechecker bakes the real name straight into each MEMBER_EXPR — see
// genMemberExpr()'s '_realMember'), but a namespace-style import of an npm
// package needs a runtime proxy: static analysis of an arbitrary package's
// source (external-interop.js) is only ever a best-effort hint, never
// trusted enough to rewrite the call at compile time.
const PASCAL_PROXY_PRELUDE = `function __gatra_pascal_proxy__(mod, moduleLabel) {
  // A CJS package's real 'module.exports' object always lands at
  // 'mod.default' under Node's ESM/CJS interop, unconditionally — but only
  // properties cjs-module-lexer can statically see get synthesized directly
  // onto 'mod' itself (a dynamically-assigned export, e.g. built in a loop,
  // won't be). Checking both finds a real member either way; a pure-ESM
  // package (no 'default' at all, or one that isn't itself an object) just
  // resolves everything straight off 'mod'.
  function cari(nama) {
    if (mod && typeof mod === 'object' && nama in mod) return { ada: true, sumber: mod };
    const isi = mod && mod.default;
    if (isi && typeof isi === 'object' && nama in isi) return { ada: true, sumber: isi };
    return { ada: false, sumber: null };
  }
  return new Proxy(mod, {
    get(target, prop, receiver) {
      if (typeof prop !== 'string') return Reflect.get(target, prop, receiver);
      if (!/^[A-Z]/.test(prop)) {
        if (cari(prop).ada) {
          const saran = prop.charAt(0).toUpperCase() + prop.slice(1);
          throw new Error('\`' + prop + '\` bukan anggota public dari modul \`' + moduleLabel + '\`.\\nGunakan \`' + moduleLabel + '.' + saran + '()\`.');
        }
        return Reflect.get(target, prop, receiver);
      }
      let hasil = cari(prop);
      let nama  = prop;
      if (!hasil.ada) {
        nama  = prop.charAt(0).toLowerCase() + prop.slice(1);
        hasil = cari(nama);
      }
      if (!hasil.ada) throw new Error('\`' + prop + '\` tidak ditemukan di modul \`' + moduleLabel + '\`');
      const nilai = hasil.sumber[nama];
      return typeof nilai === 'function' ? nilai.bind(hasil.sumber) : nilai;
    }
  });
}`;

// Same Go-style visibility, for 'impor { Nama } dari "modul-eksternal"' —
// resolved once at binding time rather than a static destructure/aliased
// import, for the same "best-effort hint, not a trusted rewrite" reason.
const RESOLVE_NAMED_PRELUDE = `function __gatra_resolve_named__(mod, nama, moduleLabel) {
  // Same 'mod' vs 'mod.default' story as __gatra_pascal_proxy__ above — see
  // its comment.
  function cari(n) {
    if (mod && typeof mod === 'object' && n in mod) return mod;
    const isi = mod && mod.default;
    if (isi && typeof isi === 'object' && n in isi) return isi;
    return null;
  }
  let sumber = cari(nama);
  let asli   = nama;
  if (!sumber) {
    asli   = nama.charAt(0).toLowerCase() + nama.slice(1);
    sumber = cari(asli);
  }
  if (!sumber) throw new Error('\`' + nama + '\` tidak ditemukan di modul \`' + moduleLabel + '\`');
  return sumber[asli];
}`;

function usesPascalProxy(ast) {
  return ast.body.some(s => s.type === N.PACKAGE_IMPORT && !s.names &&
    !s.source.startsWith('.') && !isBuiltinModule(s.source));
}

function usesResolveNamed(ast) {
  return ast.body.some(s => s.type === N.PACKAGE_IMPORT && s.names && !s.source.startsWith('.'));
}

// ke_teks/ke_angka/ke_bilangan/ke_pecahan/ke_byte/ke_logika — konversi tipe
// eksplisit. Nama fungsi Gatra → nama helper runtime (__gatra_ke_*).
const KONVERSI_FNS = {
  ke_teks:     '__gatra_ke_teks',
  ke_angka:    '__gatra_ke_angka',
  ke_bilangan: '__gatra_ke_bilangan',
  ke_pecahan:  '__gatra_ke_pecahan',
  ke_byte:     '__gatra_ke_byte',
  ke_logika:   '__gatra_ke_logika',
  // keTeks/keLarik/gabung — conversion & sequence operations (lihat
  // typechecker.js untuk kenapa ketiganya tidak tumpang tindih). 'keTeks'
  // sengaja dipetakan ke helper yang SAMA dengan 'ke_teks' — dua nama Gatra,
  // satu perilaku (Value -> Teks), tidak ada alasan menduplikasi logikanya.
  keTeks:      '__gatra_ke_teks',
  keLarik:     '__gatra_ke_larik',
  gabung:      '__gatra_gabung',
};

// ke_teks: String(v) apa adanya. ke_angka/ke_pecahan: Number(v) (parse teks
// numerik, koersi logika 0/1). ke_bilangan/ke_byte: dipangkas ke bilangan
// bulat ('bilangan' tanpa batas, 'byte' dibungkus ke rentang 0-255 lewat
// modulo, konsisten dgn overflow byte gaya Go, bukan clamp). ke_logika:
// hanya string literal "benar" (persis, gaya Gatra) yang jadi true — string
// lain (termasuk "salah") sengaja false, bukan Boolean(v) JS biasa yang
// menganggap string non-kosong apapun truthy.
// __gatra_ke_larik: Array.from() materializes ANY JS-iterable (larik, teks,
// Map, Set, iterator/generator mentah) into a real, concrete array — this is
// the only one of the three that actually allocates a new Larik, and only
// when called (never implicitly by keTeks/gabung).
//
// __gatra_gabung: join langsung dengan for-of, TANPA lewat Array.from/larik
// antara — jalan sama persis di larik maupun iterator/generator lazy
// (dikonsumsi satu-satu, tidak pernah butuh seluruh isinya sekaligus ada di
// memori sebagai larik). String(item) dipakai per elemen, bukan
// Array.prototype.join punya JS, karena inputnya belum tentu sebuah larik.
const KONVERSI_PRELUDE = `function __gatra_ke_teks(v) { return String(v); }
function __gatra_ke_angka(v) { return Number(v); }
function __gatra_ke_bilangan(v) { return Math.trunc(Number(v)); }
function __gatra_ke_pecahan(v) { return Number(v); }
function __gatra_ke_byte(v) { return ((Math.trunc(Number(v)) % 256) + 256) % 256; }
function __gatra_ke_logika(v) { return typeof v === 'string' ? v === 'benar' : Boolean(v); }
function __gatra_ke_larik(it) { return Array.from(it); }
function __gatra_gabung(it, pemisah) {
  let __hasil = '';
  let __pertama = true;
  for (const __item of it) {
    if (!__pertama) __hasil += pemisah;
    __hasil += String(__item);
    __pertama = false;
  }
  return __hasil;
}`;

// Recursively scans an AST for a call to one of KONVERSI_FNS (identifier
// callee) — only then is the conversion prelude needed.
function usesKonversi(node) {
  if (!node || typeof node !== 'object') return false;
  if (Array.isArray(node)) return node.some(usesKonversi);
  if (node.type === N.CALL_EXPR && typeof node.callee === 'object' &&
      node.callee.type === N.IDENTIFIER && KONVERSI_FNS[node.callee.name]) {
    return true;
  }
  return Object.keys(node).some(k => k !== 'type' && usesKonversi(node[k]));
}

// Metode bawaan yang ditanam ke prototype JS asli (String/Number/Boolean/
// Array/Object) — bukan modul yang perlu di-'impor', jalan otomatis di
// SEMUA nilai teks/angka/logika/larik/objek begitu dipakai (lihat
// TIPE_DATA_METHOD_NAMES di bawah untuk deteksi pemakaian). Sama-sama
// 'number' di JS untuk angka/bilangan/pecahan/byte, jadi method numeriknya
// nempel di satu tempat (Number.prototype) — tidak bisa dibedakan lagi
// antara bilangan vs byte di titik runtime. enumerable:false supaya aman
// dari for-in/JSON.stringify/spread di seluruh proses.
const TIPE_DATA_PRELUDE = `(function () {
  var __tanam = function (proto, nama, fn) {
    Object.defineProperty(proto, nama, { value: fn, writable: true, configurable: true, enumerable: false });
  };

  __tanam(String.prototype, 'Panjang', function () { return this.length; });
  __tanam(String.prototype, 'Kosong', function () { return this.length === 0; });
  __tanam(String.prototype, 'Besar', function () { return this.toUpperCase(); });
  __tanam(String.prototype, 'Kecil', function () { return this.toLowerCase(); });
  __tanam(String.prototype, 'KeAngka', function () { return Number(this); });
  __tanam(String.prototype, 'KeBilangan', function () { return Math.trunc(Number(this)); });
  __tanam(String.prototype, 'KePecahan', function () { return parseFloat(this); });
  __tanam(String.prototype, 'Bersihkan', function () { return this.trim(); });
  __tanam(String.prototype, 'Ulangi', function (n) { return this.repeat(n); });
  __tanam(String.prototype, 'BalikkanTeks', function () { return this.split('').reverse().join(''); });
  __tanam(String.prototype, 'Sensor', function (depan, belakang, karakter) {
    depan = depan === undefined ? 2 : depan;
    belakang = belakang === undefined ? 2 : belakang;
    karakter = karakter === undefined ? '*' : karakter;
    if (this.length <= depan + belakang) return karakter.repeat(this.length);
    return this.slice(0, depan) + karakter.repeat(this.length - depan - belakang) + this.slice(this.length - belakang);
  });

  __tanam(Number.prototype, 'KeTeks', function () { return String(this); });
  __tanam(Number.prototype, 'Genap', function () { return this % 2 === 0; });
  __tanam(Number.prototype, 'Ganjil', function () { return this % 2 !== 0; });
  __tanam(Number.prototype, 'Bulatkan', function () { return Math.round(this); });
  __tanam(Number.prototype, 'Positif', function () { return this > 0; });
  __tanam(Number.prototype, 'ValidByte', function () { return this >= 0 && this <= 255; });
  __tanam(Number.prototype, 'Batasi', function (min, max) { return Math.min(Math.max(this, min), max); });
  __tanam(Number.prototype, 'Antara', function (min, max) { return this >= min && this <= max; });

  __tanam(Boolean.prototype, 'Balik', function () { return !this; });
  __tanam(Boolean.prototype, 'KeTeks', function () { return String(this); });

  __tanam(Array.prototype, 'Jumlah', function () { return this.reduce(function (total, n) { return total + n; }, 0); });
  __tanam(Array.prototype, 'Kosong', function () { return this.length === 0; });
  __tanam(Array.prototype, 'Tambah', function (nilai) { return this.concat([nilai]); });
  __tanam(Array.prototype, 'Petakan', function (callback) {
    return this.reduce(function (hasil, item) {
      var kunci = callback(item);
      if (!hasil[kunci]) hasil[kunci] = [];
      hasil[kunci].push(item);
      return hasil;
    }, {});
  });

  __tanam(Array.prototype, 'Bagian', function (ukuran) {
    ukuran = ukuran === undefined ? 1 : ukuran;
    if (ukuran <= 0) return [];
    var hasil = [];
    for (var i = 0; i < this.length; i += ukuran) {
      hasil.push(this.slice(i, i + ukuran));
    }
    return hasil;
  });

  __tanam(Array.prototype, 'Pisahkan', function (predikat) {
    var benar = [];
    var salah = [];
    for (var i = 0; i < this.length; i++) {
      if (predikat(this[i])) {
        benar.push(this[i]);
      } else {
        salah.push(this[i]);
      }
    }
    return [benar, salah];
  });

  __tanam(Array.prototype, 'Urutkan', function (selektor, arah) {
    arah = arah === undefined ? 'naik' : arah;
    return this.slice().sort(function (a, b) {
      var nilaiA = selektor(a);
      var nilaiB = selektor(b);
      if (nilaiA < nilaiB) return arah === 'turun' ? 1 : -1;
      if (nilaiA > nilaiB) return arah === 'turun' ? -1 : 1;
      return 0;
    });
  });

  __tanam(Array.prototype, 'BuatUnik', function (selektor) {
    var terlihat = new Set();
    var hasil = [];
    for (var i = 0; i < this.length; i++) {
      var kunci = selektor(this[i]);
      if (!terlihat.has(kunci)) {
        terlihat.add(kunci);
        hasil.push(this[i]);
      }
    }
    return hasil;
  });

  __tanam(Array.prototype, 'Acak', function () {
    if (this.length === 0) return undefined;
    return this[Math.floor(Math.random() * this.length)];
  });

  __tanam(Array.prototype, 'AcakSebanyak', function (jumlah) {
    if (jumlah <= 0) return [];
    var hasil = this.slice();
    for (var i = hasil.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = hasil[i];
      hasil[i] = hasil[j];
      hasil[j] = tmp;
    }
    return hasil.slice(0, Math.min(jumlah, hasil.length));
  });

  __tanam(Array.prototype, 'Rata', function (selektor) {
    if (this.length === 0) return 0;
    var jumlah = this.reduce(function (total, item) { return total + (selektor ? selektor(item) : item); }, 0);
    return jumlah / this.length;
  });
  __tanam(Array.prototype, 'Maksimum', function (selektor) {
    if (this.length === 0) return undefined;
    var terbaik = this[0];
    var nilaiTerbaik = selektor ? selektor(terbaik) : terbaik;
    for (var i = 1; i < this.length; i++) {
      var nilai = selektor ? selektor(this[i]) : this[i];
      if (nilai > nilaiTerbaik) { terbaik = this[i]; nilaiTerbaik = nilai; }
    }
    return terbaik;
  });
  __tanam(Array.prototype, 'Minimum', function (selektor) {
    if (this.length === 0) return undefined;
    var terbaik = this[0];
    var nilaiTerbaik = selektor ? selektor(terbaik) : terbaik;
    for (var i = 1; i < this.length; i++) {
      var nilai = selektor ? selektor(this[i]) : this[i];
      if (nilai < nilaiTerbaik) { terbaik = this[i]; nilaiTerbaik = nilai; }
    }
    return terbaik;
  });
  __tanam(Array.prototype, 'Pertama', function () { return this.length ? this[0] : undefined; });
  __tanam(Array.prototype, 'Terakhir', function () { return this.length ? this[this.length - 1] : undefined; });
  __tanam(Array.prototype, 'Hitung', function (predikat) { return this.filter(predikat).length; });
  __tanam(Array.prototype, 'Datar', function (kedalaman) { return this.flat(kedalaman === undefined ? 1 : kedalaman); });
  __tanam(Array.prototype, 'Potong', function (n) { return this.slice(0, n); });
  __tanam(Array.prototype, 'Lewati', function (n) { return this.slice(n); });
  __tanam(Array.prototype, 'SemuaCocok', function (predikat) { return this.every(predikat); });
  __tanam(Array.prototype, 'AdaCocok', function (predikat) { return this.some(predikat); });

  __tanam(Object.prototype, 'PunyaKunci', function (kunci) { return Object.prototype.hasOwnProperty.call(this, kunci); });
  __tanam(Object.prototype, 'AmbilAtauDefault', function (kunci, cadangan) { var v = this[kunci]; return v == null ? cadangan : v; });
  __tanam(Object.prototype, 'Salin', function () { return Object.assign({}, this); });
  __tanam(Object.prototype, 'Gabung', function (objekLain) { return Object.assign({}, this, objekLain); });
  __tanam(Object.prototype, 'Kunci', function () { return Object.keys(this); });
  __tanam(Object.prototype, 'Nilai', function () { return Object.values(this); });
})();`;

// Nama method yang di atas ditanam ke prototype — dipakai usesTipeData()
// buat cek pemakaian nyata (member-call 'x.Nama(...)') sebelum nyuntik
// prelude, biar program yang tidak pernah pakai fitur ini tidak ikut
// mem-patch prototype global secara diam-diam.
const TIPE_DATA_METHOD_NAMES = new Set([
  'Panjang', 'Kosong', 'Besar', 'Kecil', 'KeAngka', 'KeBilangan', 'KePecahan',
  'Bersihkan', 'Ulangi', 'BalikkanTeks', 'Sensor',
  'KeTeks', 'Genap', 'Ganjil', 'Bulatkan', 'Positif', 'ValidByte', 'Batasi', 'Antara',
  'Balik', 'Jumlah', 'Tambah', 'Petakan', 'Bagian', 'Pisahkan', 'Urutkan', 'BuatUnik',
  'Acak', 'AcakSebanyak', 'Rata', 'Maksimum', 'Minimum', 'Pertama', 'Terakhir',
  'Hitung', 'Datar', 'Potong', 'Lewati', 'SemuaCocok', 'AdaCocok',
  'PunyaKunci', 'AmbilAtauDefault', 'Salin', 'Gabung', 'Kunci', 'Nilai',
]);

// Recursively scans an AST for a member-call (x.Nama(...)) whose member name
// matches one of TIPE_DATA_METHOD_NAMES — only then is the prototype-patch
// prelude needed. A struct with its OWN receiver method of the same name
// (e.g. user's own 'fungsi (a Akun) Tambah(...)') would also match here —
// harmless false positive, since the prelude only adds prototype methods
// that a same-named instance method on a real class always shadows anyway.
function usesTipeData(node) {
  if (!node || typeof node !== 'object') return false;
  if (Array.isArray(node)) return node.some(usesTipeData);
  if (node.type === N.CALL_EXPR && typeof node.callee === 'object' &&
      node.callee.type === N.MEMBER_EXPR && TIPE_DATA_METHOD_NAMES.has(node.callee.member)) {
    return true;
  }
  return Object.keys(node).some(k => k !== 'type' && usesTipeData(node[k]));
}

// @Nama(...) on a struct/method/param — emitted the same way `tsc
// --experimentalDecorators --emitDecoratorMetadata` does, since that's the
// exact calling convention NestJS's DI container (Reflect.getMetadata
// ('design:paramtypes', ...)) and its param decorators (@Body/@Param/@Query)
// require. Native stage-3 '@decorator' syntax can't do this — it has no
// parameter-decorator support at all.
const DECORATE_PRELUDE = `var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
  var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
  if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
  else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
  return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
  return function (target, key) { decorator(target, key, paramIndex); };
};
var __metadata = (this && this.__metadata) || function (metadataKey, metadataValue) {
  if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(metadataKey, metadataValue);
};`;

// Recursively scans for any non-empty 'decorators' array — struct, receiver
// method, or method param can all carry one.
function usesDecorators(node) {
  if (!node || typeof node !== 'object') return false;
  if (Array.isArray(node)) return node.some(usesDecorators);
  if (Array.isArray(node.decorators) && node.decorators.length > 0) return true;
  return Object.keys(node).some(k => k !== 'type' && usesDecorators(node[k]));
}

// design:paramtypes entries — maps a Gatra type string to the JS value tsc
// would emit for it (primitive wrapper, a real local class, or Object as the
// fallback for anything it can't represent, e.g. arrays/unknown).
const DESIGN_TYPE_PRIMS = {
  number: 'Number', int: 'Number', float: 'Number', byte: 'Number',
  string: 'String', bool: 'Boolean',
};

class CodeGenerator {
  constructor(opts = {}) {
    this.depth        = 0;
    this.filePath      = opts.filePath || null;
    this.isPackage     = false; // true when a PackageDeclaration is present
    // Forces export emission even without 'paket' — set by callers compiling
    // a file specifically because another file imports from it (runEsm's
    // dependency pass, bundel, bangun-proyek). A plain entry-point compile
    // (gatra jalankan/uji on the file the user actually runs) leaves this
    // false so ordinary scripts don't grow stray 'export' and keep using the
    // fast vm.Script sandbox path instead of spawning a real Node subprocess.
    this.emitExports  = !!opts.emitExports;
    this.matchCounter  = 0;
    this.measureCounter = 0;
    this.withCounter   = 0;
    this.extImportCounter = 0; // unique holder var per external named import (genPackageImport)
    this.withStack     = []; // active 'dengan'/'ubah' IIFE param names — innermost last
    this.includeTests  = !!opts.includeTests; // 'gatra uji' compiles with tests active
    this.structMethods = new Map(); // struct name → [receiver FnDecl, ...], collected up front by genProgram
    this.structDecls   = new Map(); // struct name → its StructDecl node, collected up front by genProgram
    this.parallelFns   = new Set(); // names of top-level 'fungsi paralel' declarations, collected up front by genProgram
  }

  ind() { return '  '.repeat(this.depth); }

  generate(node) {
    switch (node.type) {
      case N.PROGRAM:         return this.genProgram(node);
      case N.PACKAGE_DECL:    return ''; // metadata — no JS output
      case N.PACKAGE_IMPORT:  return this.genPackageImport(node);
      case N.VAR_DECL:       return this.genVarDecl(node);
      case N.FN_DECL:        return this.genFnDecl(node);
      case N.STRUCT_DECL:    return this.genStructDecl(node);
      case N.IF_STMT:        return this.genIfStmt(node);
      case N.LOOP_STMT:      return this.genLoopStmt(node);
      case N.WHILE_STMT:     return this.genWhileStmt(node);
      case N.TRY_STMT:       return this.genTryStmt(node);
      case N.RETURN_STMT:    return this.genReturnStmt(node);
      case N.BLOCK:          return this.genBlock(node);
      case N.EXPR_STMT:      return this.genExprStmt(node);
      case N.ASSIGN_EXPR:    return this.genAssignExpr(node);
      case N.BINARY_EXPR:    return this.genBinaryExpr(node);
      case N.UNARY_EXPR:     return this.genUnaryExpr(node);
      case N.CALL_EXPR:      return this.genCallExpr(node);
      case N.MEMBER_EXPR:    return this.genMemberExpr(node);
      case N.INDEX_EXPR:     return this.genIndexExpr(node);
      case N.STRUCT_INIT:    return this.genStructInit(node);
      case N.ARRAY_LITERAL:  return this.genArrayLiteral(node);
      case N.AWAIT_EXPR:     return this.genAwaitExpr(node);
      case N.FUNC_EXPR:      return this.genFuncExpr(node);
      case N.NULL_LITERAL:      return 'null';
      case N.OBJECT_LITERAL:    return this.genObjectLiteral(node);
      case N.OBJECT_TRANSFORM_EXPR: return this.genObjectTransformExpr(node);
      case N.TEMPLATE_EXPR:     return this.genTemplateExpr(node);
      case N.DESTRUCTURE_DECL:  return this.genDestructureDecl(node);
      case N.SPREAD_ELEMENT:    return this.genSpreadElement(node);
      case N.TERNARY_EXPR:      return this.genTernaryExpr(node);
      case N.NAMED_ARG:         return this.generate(node.value);
      case N.BREAK_STMT:        return 'break';
      case N.CONTINUE_STMT:     return 'continue';
      case N.TYPE_ALIAS_DECL:   return ''; // metadata — no JS output
      case N.MATCH_STMT:        return this.genMatchStmt(node);
      case N.MATCH_RESULT_STMT: return this.genMatchResultStmt(node);
      case N.TEST_DECL:         return this.genTestDecl(node);
      case N.MEASURE_STMT:      return this.genMeasureStmt(node);
      case N.ASSERT_STMT:       return this.genAssertStmt(node);
      case N.JS_BLOCK_STMT:     return node.code.trim();
      case N.IDENTIFIER:
        if (this.withStack.length > 0) return `${this.withStack[this.withStack.length - 1]}.${node.name}`;
        return node.name;
      case N.NUMBER_LITERAL: return String(node.value);
      case N.STRING_LITERAL: return JSON.stringify(node.value);
      case N.BOOL_LITERAL:   return String(node.value);
      case N.REGEX_LITERAL:  return `/${node.pattern}/${node.flags}`;
      default:
        throw new Error(`CodeGen: unknown node type '${node.type}'`);
    }
  }

  // ── Statements ──────────────────────────────────────────────────────────────

  genProgram(node) {
    this.isPackage = node.body.some(s => s.type === N.PACKAGE_DECL);

    // Pre-scan for receiver methods (fungsi (h Hewan) sapa() {...}) so a
    // struct's class body can include methods declared anywhere in the file,
    // not just ones appearing above the struct — this generator otherwise
    // streams statements top-to-bottom in one pass.
    for (const stmt of node.body) {
      if (stmt.type === N.FN_DECL && stmt.receiver) {
        const list = this.structMethods.get(stmt.receiver.type) || [];
        list.push(stmt);
        this.structMethods.set(stmt.receiver.type, list);
      }
      if (stmt.type === N.STRUCT_DECL) {
        this.structDecls.set(stmt.name, stmt);
      }
      if (stmt.type === N.FN_DECL && stmt.isParallel) {
        this.parallelFns.add(stmt.name);
      }
      // A named import of a struct that has receiver methods in its OWN
      // module needs those methods known here too — genStructInit() below
      // decides 'new Name(...)' vs a bare object literal purely from
      // this.structMethods, and an imported struct's methods live in a
      // different file's own FN_DECL-with-receiver scan, never this one's.
      if (stmt.type === N.PACKAGE_IMPORT && stmt.names && this.filePath && stmt.source.startsWith('.')) {
        const localPath = resolveLocalPath(this.filePath, stmt.source);
        if (localPath) {
          let exportsMap = null;
          try { exportsMap = getModuleExports(localPath); } catch (e) { /* best-effort */ }
          if (exportsMap) {
            for (const name of stmt.names) {
              const entry = exportsMap.get(name);
              if (entry && entry.kind === 'struct' && entry.methods && entry.methods.length > 0) {
                this.structMethods.set(name, entry.methods);
              }
            }
          }
        }
      }
    }

    const lines = [];

    // Imports must come before the parallel guard below: a 'fungsi paralel'
    // body is free to reference an imported package (Concurrency Safety only
    // restricts capturing an outer 'isi' binding — see inferIdentifier() in
    // typechecker.js), so the worker replaying this same file needs that
    // 'const x = require(...)' already initialized before its guard returns.
    // A require() isn't hoisted the way a top-level 'function' declaration
    // is, so this one has to run for real, in order, ahead of the return.
    for (const stmt of node.body) {
      if (stmt.type === N.PACKAGE_IMPORT) {
        lines.push(this.genPackageImport(stmt));
      }
    }

    // In a worker (see genParallelGuard()'s comment), this is a top-level
    // 'return' that skips every other line below it — any prelude emitted
    // after this one would still run pointlessly in a worker (the program's
    // own top-level side effects, ultimately), so nothing but the imports
    // above gets to jump ahead of it.
    if (this.parallelFns.size > 0) lines.push(this.genParallelGuard());

    if (usesTimeout(node)) lines.push(BATAS_PRELUDE);
    if (usesHasil(node)) lines.push(HASIL_PRELUDE);
    if (usesPascalProxy(node)) lines.push(PASCAL_PROXY_PRELUDE);
    if (usesResolveNamed(node)) lines.push(RESOLVE_NAMED_PRELUDE);
    if (usesKonversi(node)) lines.push(KONVERSI_PRELUDE);
    if (usesDecorators(node)) lines.push(DECORATE_PRELUDE);
    if (usesTipeData(node)) lines.push(TIPE_DATA_PRELUDE);

    const testDecls = node.body.filter(s => s.type === N.TEST_DECL);
    if (this.includeTests && testDecls.length > 0) {
      lines.push('const __gatra_uji_daftar = [];');
    }

    // Emit all other statements (skip PACKAGE_DECL and PACKAGE_IMPORT; skip
    // TEST_DECL entirely unless compiling for 'gatra uji')
    for (const stmt of node.body) {
      if (stmt.type === N.PACKAGE_DECL || stmt.type === N.PACKAGE_IMPORT) continue;
      if (stmt.type === N.TEST_DECL && !this.includeTests) continue;
      if (stmt.type === N.FN_DECL && stmt.receiver) continue; // emitted inline as part of its struct's class
      lines.push(this.genTopStmt(stmt));
    }

    if (this.includeTests && testDecls.length > 0) {
      lines.push(`(async () => {
  let __gatra_lulus = 0, __gatra_gagal = 0;
  for (const [label, fn] of __gatra_uji_daftar) {
    try {
      await fn();
      __gatra_lulus++;
      console.log('  \\u2713 ' + label);
    } catch (e) {
      __gatra_gagal++;
      console.log('  \\u2717 ' + label);
      console.log('    ' + e.message);
    }
  }
  console.log('\\nHasil: ' + __gatra_lulus + ' lulus, ' + __gatra_gagal + ' gagal');
  if (__gatra_gagal > 0) process.exit(1);
})();`);
    }

    return lines.join('\n');
  }

  // Every 'fungsi paralel' declaration stays a plain top-level 'function'
  // (fully hoisted in JS — unlike 'let'/'class' — so it's callable from this
  // handler even though the worker branch returns before "reaching" its
  // textual line). On the main thread this whole block is a no-op (the
  // condition is false); in a worker (see scheduler.js's big comment for why
  // a worker even runs this same file at all) it sets up the one thing a
  // worker actually does — answer { fn, args } messages — then returns
  // before any of the program's own top-level side effects run.
  genParallelGuard() {
    const names = [...this.parallelFns];
    const fnsObj = names.join(', ');
    return `const { isMainThread: __gatra_isMainThread__, parentPort: __gatra_parentPort__ } = require('worker_threads');
if (!__gatra_isMainThread__ && __gatra_parentPort__) {
  __gatra_parentPort__.on('message', async (__gatra_msg__) => {
    try {
      const __gatra_fns__ = { ${fnsObj} };
      const __gatra_result__ = await __gatra_fns__[__gatra_msg__.fn](...__gatra_msg__.args);
      __gatra_parentPort__.postMessage({ id: __gatra_msg__.id, ok: true, value: __gatra_result__ });
    } catch (__gatra_err__) {
      __gatra_parentPort__.postMessage({ id: __gatra_msg__.id, ok: false, error: String((__gatra_err__ && __gatra_err__.message) || __gatra_err__) });
    }
  });
  return;
}
const __gatra_scheduler__ = require(${JSON.stringify(SCHEDULER_RUNTIME_PATH)});`;
  }

  // A pure-data struct (no methods, no decorator) never gets a runtime
  // binding on the exporting side (genTopStmt's STRUCT_DECL case) — its
  // literal compiles straight to a plain object, never referencing the
  // struct's name (see genStructInit). Importing such a name would either
  // be a SyntaxError (ESM: "does not provide an export named ...") or a
  // silent 'undefined' (CJS destructuring), so it's dropped here instead;
  // its TYPE usage elsewhere (a bare 'Nama'/'Nama[]' annotation) still
  // typechecks fine without any import (see inferIdentifier/consumeType —
  // type names aren't resolved against the symbol table).
  filterRuntimeImportNames(node) {
    if (!node.names || !this.filePath || !node.source.startsWith('.')) return node.names;
    const localPath = resolveLocalPath(this.filePath, node.source);
    if (!localPath) return node.names;
    let exportsMap = null;
    try { exportsMap = getModuleExports(localPath); } catch (e) { return node.names; }
    return node.names.filter(name => {
      const entry = exportsMap.get(name);
      if (!entry || entry.kind !== 'struct') return true;
      const hasMethods   = entry.methods && entry.methods.length > 0;
      const hasDecorator = !!(entry.decl.decorators && entry.decl.decorators.length > 0);
      return hasMethods || hasDecorator;
    });
  }

  genPackageImport(node) {
    // A file with any 'fungsi paralel' decl must stay plain CommonJS end to
    // end: the worker guard (genParallelGuard()) needs a top-level 'return',
    // which is a SyntaxError in an ES module — and Node treats any 'import'
    // in the file as proof it's one (auto-reparsed as ESM even from a .js
    // extension). require() carries the exact same runtime semantics here
    // (same require() the worker guard itself already uses) with none of
    // that module-system baggage.
    const isExternal = !node.source.startsWith('.');
    const isBuiltin  = isExternal && isBuiltinModule(node.source);
    const src        = JSON.stringify(node.source);

    if (this.parallelFns.size > 0) {
      if (node.names) {
        const names = this.filterRuntimeImportNames(node);
        if (!names.length) return '';
        if (!isExternal) return `const { ${names.join(', ')} } = require(${src});`;
        const holder = `__gatra_extmod_${this.extImportCounter++}__`;
        return `const ${holder} = require(${src});\n` + this.genResolvedNamedImports(holder, names, node.source);
      }
      const raw = `require(${src})`;
      if (isExternal && !isBuiltin) {
        return `const ${node.localName} = __gatra_pascal_proxy__(${raw}, ${src});`;
      }
      return `const ${node.localName} = ${raw};`;
    }
    if (node.names) {
      const names = this.filterRuntimeImportNames(node);
      if (!names.length) return '';
      if (!isExternal) return `import { ${names.join(', ')} } from ${src};`;
      const holder = `__gatra_extmod_${this.extImportCounter++}__`;
      return `import * as ${holder} from ${src};\n` + this.genResolvedNamedImports(holder, names, node.source);
    }
    if (isExternal && !isBuiltin) {
      const holder = `__gatra_extmod_${this.extImportCounter++}__`;
      return `import * as ${holder} from ${src};\nconst ${node.localName} = __gatra_pascal_proxy__(${holder}, ${src});`;
    }
    return `import * as ${node.localName} from ${src};`;
  }

  // 'impor { Nama1, Nama2 } dari "modul-eksternal"' — every requested name
  // resolved through __gatra_resolve_named__ (see its prelude comment) so
  // the real PascalCase-vs-lowercase member name is settled at runtime,
  // never guessed from a best-effort static scan.
  genResolvedNamedImports(modExpr, names, source) {
    const src = JSON.stringify(source);
    return names
      .map(n => `const ${n} = __gatra_resolve_named__(${modExpr}, ${JSON.stringify(n)}, ${src});`)
      .join('\n');
  }

  genTopStmt(node) {
    const ind = this.ind();
    // Go-style visibility: a top-level fn/struct/var is only emitted with
    // 'export' when the file is a package ('paket' declared) AND its name
    // starts with an uppercase letter. No export/ekspor keyword needed.
    const exported = (this.isPackage || this.emitExports) && node.name && isPublicName(node.name);
    switch (node.type) {
      case N.STRUCT_DECL: {
        // A class-decorated struct compiles to 'let X = class {...}; ...;
        // X = __decorate(...);' — 'export' prefixes just the first line
        // fine, since ESM export bindings are live: the later reassignment
        // is still visible to importers.
        //
        // A pure-data struct (no methods, no decorator) compiles to a doc
        // comment only (see genStructDecl) — zero runtime representation —
        // so there is nothing to export even when its name is public;
        // genPackageImport() mirrors this and never imports such a name.
        const hasMethods    = (this.structMethods.get(node.name) || []).length > 0;
        const hasDecorator  = !!(node.decorators && node.decorators.length > 0);
        const structExported = exported && (hasMethods || hasDecorator);
        return ind + (structExported ? 'export ' : '') + this.generate(node);
      }
      case N.FN_DECL:
        return ind + (exported ? 'export ' : '') + this.generate(node);
      case N.VAR_DECL:
        return ind + (exported ? 'export ' : '') + this.generate(node) + ';';
      case N.IF_STMT:
      case N.LOOP_STMT:
      case N.WHILE_STMT:
      case N.TRY_STMT:
      case N.MATCH_STMT:
      case N.MATCH_RESULT_STMT:
      case N.TEST_DECL:
      case N.MEASURE_STMT:
      case N.ASSERT_STMT:
      case N.JS_BLOCK_STMT:
        return ind + this.generate(node);
      default:
        return ind + this.generate(node) + ';';
    }
  }

  genBlockStmt(node) {
    const ind = this.ind();
    switch (node.type) {
      case N.FN_DECL:
      case N.STRUCT_DECL:
      case N.IF_STMT:
      case N.LOOP_STMT:
      case N.WHILE_STMT:
      case N.TRY_STMT:
      case N.MATCH_STMT:
      case N.MATCH_RESULT_STMT:
      case N.TEST_DECL:
      case N.MEASURE_STMT:
      case N.ASSERT_STMT:
      case N.JS_BLOCK_STMT:
        return ind + this.generate(node);
      default:
        return ind + this.generate(node) + ';';
    }
  }

  genVarDecl(node) {
    return `let ${node.name} = ${this.generate(node.value)}`;
  }

  genParams(params) {
    return params.map(p => {
      if (p.rest) return `...${p.name}`;
      return p.default ? `${p.name} = ${this.generate(p.default)}` : p.name;
    }).join(', ');
  }

  genFnDecl(node) {
    const async_ = node.isAsync ? 'async ' : '';
    const params = this.genParams(node.params);
    const body   = this.genBlockBody(node.body);
    return `${async_}function ${node.name}(${params}) {\n${body}\n${this.ind()}}`;
  }

  genAwaitExpr(node) {
    if (node.timeoutMs != null) {
      return `await Promise.race([${this.generate(node.expr)}, __gatra_batas(${node.timeoutMs})])`;
    }
    return `await ${this.generate(node.expr)}`;
  }

  genFuncExpr(node) {
    // A nested function/arrow has its own scope — don't rewrite its own
    // identifiers against an enclosing 'dengan'/'ubah' source.
    const savedWithStack = this.withStack;
    this.withStack = [];

    const params = this.genParams(node.params);
    let out;
    if (node.isArrow) {
      out = node.exprBody
        ? `(${params}) => (${this.generate(node.exprBody)})`
        : `(${params}) => {\n${this.genBlockBody(node.body)}\n${this.ind()}}`;
    } else {
      const async_ = node.isAsync ? 'async ' : '';
      out = `${async_}function(${params}) {\n${this.genBlockBody(node.body)}\n${this.ind()}}`;
    }

    this.withStack = savedWithStack;
    return out;
  }

  genObjectTransformExpr(node) {
    const sourceJs = this.generate(node.source); // resolved in the OUTER with-context
    const param = `__dengan${this.withCounter++}`;
    this.withStack.push(param);
    const props = node.fields.map(f => `${f.name}: ${this.generate(f.value)}`).join(', ');
    this.withStack.pop();
    const spread = node.spread ? `...${param}, ` : '';
    return `((${param}) => ({ ${spread}${props} }))(${sourceJs})`;
  }

  genTryStmt(node) {
    const tryBody = this.genBlockBody(node.tryBlock);
    let out = `try {\n${tryBody}\n${this.ind()}}`;

    if (node.catchBlock) {
      const catchBody = this.genBlockBody(node.catchBlock);
      out += ` catch (${node.catchParam}) {\n${catchBody}\n${this.ind()}}`;
    }

    if (node.finallyBlock) {
      const finallyBody = this.genBlockBody(node.finallyBlock);
      out += ` finally {\n${finallyBody}\n${this.ind()}}`;
    }

    return out;
  }

  genStructDecl(node) {
    const methods = this.structMethods.get(node.name) || [];
    // A class-level decorator (@Injectable/@Controller) switches the struct
    // to a positional, DI-callable constructor. That's independent of
    // whether any individual *method* also carries a decorator (@Get() etc.)
    // — a method/param can be decorated without the class itself being so.
    const classDecorated   = !!(node.decorators && node.decorators.length > 0);
    const methodsDecorated = methods.some(m =>
      (m.decorators && m.decorators.length > 0) ||
      m.params.some(p => p.decorators && p.decorators.length > 0)
    );

    // Pure data struct (no methods, no decorator anywhere) — type-only, emitted as a comment.
    if (!classDecorated && methods.length === 0) {
      const fields = node.fields.map(f => `${f.name}: ${f.type}`).join(', ');
      return `// struct ${node.name} { ${fields} }`;
    }

    // A struct with methods (or a class-level decorator, even with none)
    // needs a real runtime shape — compiles to a plain JS class. A
    // class-decorated struct's constructor takes its fields positionally
    // (what a DI container calls 'new X(dep1, dep2)' with); otherwise it
    // keeps the ergonomic single options-object constructor for struct-literal init.
    this.depth++;
    const ind = this.ind();
    const ctorLine = classDecorated ? this.genPositionalCtor(node) : `${ind}constructor(o) { Object.assign(this, o); }`;
    const methodLines = methods.map(m => this.genReceiverMethod(m)).join('\n\n');
    this.depth--;

    const classBody = methodLines ? `${ctorLine}\n\n${methodLines}` : ctorLine;
    const classSrc   = `class ${node.name} {\n${classBody}\n${this.ind()}}`;

    if (!classDecorated && !methodsDecorated) return classSrc;
    return this.genDecoratedStruct(node, classSrc, methods, classDecorated);
  }

  genPositionalCtor(node) {
    const ind = this.ind();
    const params = node.fields.map(f => f.name).join(', ');
    this.depth++;
    const assigns = node.fields.map(f => `${this.ind()}this.${f.name} = ${f.name};`).join('\n');
    this.depth--;
    return `${ind}constructor(${params}) {\n${assigns}\n${ind}}`;
  }

  // Emits the tsc --experimentalDecorators --emitDecoratorMetadata shape:
  // one __decorate(...) call per decorated method (folding in that method's
  // __param(...) wrappers for decorated params), and — only when the struct
  // itself carries a class-level decorator — a final __decorate(...) call
  // applying those decorators plus constructor design:paramtypes metadata
  // (what NestJS's DI container reads to auto-resolve providers by type).
  // Without a class-level decorator there's no reassignment, so the class
  // stays a plain 'class X {...}' declaration; with one, it becomes
  // 'let X = class {...}; ...; X = __decorate(...)' so the __decorate result
  // can replace the binding.
  genDecoratedStruct(node, classSrc, methods, classDecorated) {
    const ind = this.ind();
    const lines = [classDecorated ? `${ind}let ${node.name} = ${classSrc};` : `${ind}${classSrc}`];

    for (const m of methods) {
      const entries = (m.decorators || []).map(d => this.genDecoratorCall(d));
      m.params.forEach((p, i) => {
        for (const d of (p.decorators || [])) {
          entries.push(`__param(${i}, ${this.genDecoratorCall(d)})`);
        }
      });
      if (entries.length === 0) continue;
      const entriesSrc = entries.map(e => `${ind}  ${e}`).join(',\n');
      lines.push(`${ind}__decorate([\n${entriesSrc}\n${ind}], ${node.name}.prototype, ${JSON.stringify(m.name)}, null);`);
    }

    if (classDecorated) {
      const classEntries = node.decorators.map(d => this.genDecoratorCall(d));
      const paramTypes = node.fields.map(f => this.resolveDesignType(f.type)).join(', ');
      classEntries.push(`__metadata("design:paramtypes", [${paramTypes}])`);
      const classEntriesSrc = classEntries.map(e => `${ind}  ${e}`).join(',\n');
      lines.push(`${ind}${node.name} = __decorate([\n${classEntriesSrc}\n${ind}], ${node.name});`);
    }

    return lines.join('\n');
  }

  genDecoratorCall(d) {
    const args = d.args.map(a => this.generate(a)).join(', ');
    return `${d.name}(${args})`;
  }

  // Gatra type string → what tsc would emit for design:paramtypes: a
  // primitive wrapper, a reference to a local struct that's a real class
  // (methods or its own decorator), or Object as the fallback.
  resolveDesignType(t) {
    if (t.endsWith('?'))  t = t.slice(0, -1);
    if (t.endsWith('[]')) return 'Array';
    if (DESIGN_TYPE_PRIMS[t]) return DESIGN_TYPE_PRIMS[t];
    if (this.structIsClass(t)) return t;
    return 'Object';
  }

  structIsClass(name) {
    if (this.structMethods.get(name)?.length > 0) return true;
    const decl = this.structDecls.get(name);
    return !!(decl && decl.decorators && decl.decorators.length > 0);
  }

  genReceiverMethod(node) {
    const ind    = this.ind();
    const async_ = node.isAsync ? 'async ' : '';
    const params = this.genParams(node.params);

    this.depth++;
    const bindLine = `${this.ind()}const ${node.receiver.name} = this;`;
    const body     = [bindLine, ...node.body.body.map(stmt => this.genBlockStmt(stmt))].join('\n');
    this.depth--;

    return `${ind}${async_}${node.name}(${params}) {\n${body}\n${ind}}`;
  }

  genIfStmt(node) {
    const cond = this.generate(node.condition);
    const then = this.genBlockBody(node.consequent);
    let out = `if (${cond}) {\n${then}\n${this.ind()}}`;
    if (node.alternate) {
      if (node.alternate.type === N.IF_STMT) {
        out += ` else ${this.genIfStmt(node.alternate)}`;
      } else {
        const alt = this.genBlockBody(node.alternate);
        out += ` else {\n${alt}\n${this.ind()}}`;
      }
    }
    return out;
  }

  genLoopStmt(node) {
    const body = this.genBlockBody(node.body);
    if (node.loopType === 'range') {
      const start = this.generate(node.start);
      const end   = this.generate(node.end);
      return `for (let ${node.iter} = ${start}; ${node.iter} < ${end}; ${node.iter}++) {\n${body}\n${this.ind()}}`;
    }
    // for-of
    const src = this.generate(node.source);
    return `for (const ${node.iter} of ${src}) {\n${body}\n${this.ind()}}`;
  }

  genWhileStmt(node) {
    const cond = this.generate(node.condition);
    const body = this.genBlockBody(node.body);
    return `while (${cond}) {\n${body}\n${this.ind()}}`;
  }

  genReturnStmt(node) {
    if (node.value === null) return 'return';
    return `return ${this.generate(node.value)}`;
  }

  genBlock(node) {
    const body = this.genBlockBody(node);
    return `{\n${body}\n${this.ind()}}`;
  }

  genBlockBody(block) {
    this.depth++;
    const lines = block.body.map(stmt => this.genBlockStmt(stmt));
    this.depth--;
    return lines.join('\n');
  }

  genExprStmt(node) {
    return this.generate(node.expr);
  }

  // ── Expressions ─────────────────────────────────────────────────────────────

  genAssignExpr(node) {
    return `${this.generate(node.target)} = ${this.generate(node.value)}`;
  }

  genBinaryExpr(node) {
    const l = this.generate(node.left);
    const r = this.generate(node.right);
    return `(${l} ${node.op} ${r})`;
  }

  genUnaryExpr(node) {
    return `${node.op}${this.generate(node.operand)}`;
  }

  genCallExpr(node) {
    const args = node.args.map(a => this.generate(a)).join(', ');

    // Built-in hasil<T,E> constructors — checked on the raw callee (before
    // any 'dengan'/'ubah' identifier rewriting) so `berhasil(x)` always
    // means the constructor, never a with-source member.
    if (typeof node.callee === 'object' && node.callee.type === N.IDENTIFIER) {
      if (node.callee.name === 'berhasil') return `__gatra_berhasil(${args})`;
      if (node.callee.name === 'gagal')    return `__gatra_gagal(${args})`;

      // tanpa_periksa(expr) — Concurrency Safety's 'unsafe' escape hatch
      // (typechecker.js's checkMoveSafety()/inferIdentifier() are what
      // actually give it meaning, at compile time); a pure no-op identity
      // wrapper at runtime.
      if (node.callee.name === 'tanpa_periksa') return `(${args})`;

      // ke_teks/ke_angka/dst — konversi tipe eksplisit, lihat KONVERSI_FNS.
      if (KONVERSI_FNS[node.callee.name]) return `${KONVERSI_FNS[node.callee.name]}(${args})`;

      // fungsi paralel — every call goes through the scheduler instead of a
      // plain call, so it can decide Event Loop vs Worker Pool per call
      // (Automatic_Concurrency.md). Always Promise-returning; a 'tunggu' the
      // Gatra source wrote around this call is handled entirely by the
      // ordinary AWAIT_EXPR codegen wrapping this expression, not here.
      if (this.parallelFns.has(node.callee.name)) {
        const name = node.callee.name;
        return `__gatra_scheduler__.jalankan(${JSON.stringify(name)}, ${name}, __filename, [${args}])`;
      }
    }

    // Resolve callee
    let callee;
    if (typeof node.callee === 'string') {
      callee = node.callee;
    } else {
      callee = this.generate(node.callee);
    }

    // Built-in print
    if (callee === '__print__') {
      return `console.log(${args})`;
    }

    return `${callee}(${args})`;
  }

  genMemberExpr(node) {
    const op = node.optional ? '?.' : '.';
    // '5.Genap()' adalah SyntaxError di JS (titik dibaca sebagai bagian
    // literal desimal) — bungkus kurung otomatis untuk objek berupa angka
    // literal langsung, sama seperti kalau ditulis manual '(5).Genap()'.
    // Parser Gatra sendiri tidak punya node grouping (tanda kurung sumber
    // sudah "transparan"/dibuang di AST), jadi kurung ini murni kebutuhan
    // sintaks JS keluaran, bukan niat penulis sumber.
    const objSrc = this.generate(node.object);
    const needsParens = node.object.type === N.NUMBER_LITERAL;
    // '_realMember' is set by the typechecker when this is a PascalCase
    // access on a Node builtin mapped onto a real lowercase/camelCase member
    // (e.g. 'os.Platform' -> 'os.platform') — emit a call to the real,
    // untouched Node API instead of the Gatra-facing PascalCase spelling.
    const member = node._realMember || node.member;
    return `${needsParens ? `(${objSrc})` : objSrc}${op}${member}`;
  }

  genIndexExpr(node) {
    return `${this.generate(node.object)}[${this.generate(node.index)}]`;
  }

  genStructInit(node) {
    const declNode = this.structDecls.get(node.name);
    // A decorated struct's constructor takes fields positionally (see
    // genPositionalCtor) — reorder the literal's values to match the
    // struct's declared field order regardless of what order they were
    // written in here.
    if (declNode && declNode.decorators && declNode.decorators.length > 0) {
      const byName = new Map(node.fields.map(f => [f.name, f.value]));
      const args = declNode.fields.map(f => this.generate(byName.get(f.name))).join(', ');
      return `new ${node.name}(${args})`;
    }

    const props = node.fields.map(f => `${f.name}: ${this.generate(f.value)}`).join(', ');
    // A struct with receiver methods (but no decorator) compiles to a real
    // class too (see genStructDecl) — its literal must go through 'new' to
    // get the prototype's methods; a plain data struct stays a bare object.
    if (this.structMethods.get(node.name)?.length > 0) {
      return `new ${node.name}({ ${props} })`;
    }
    return `{ ${props} }`;
  }

  genArrayLiteral(node) {
    const elems = node.elements.map(e => this.generate(e)).join(', ');
    return `[${elems}]`;
  }

  genObjectLiteral(node) {
    if (node.fields.length === 0) return '{}';
    const props = node.fields.map(f => {
      if (f.spread) return `...${this.generate(f.value)}`;
      return `${f.name}: ${this.generate(f.value)}`;
    }).join(', ');
    return `{ ${props} }`;
  }

  genTemplateExpr(node) {
    const body = node.parts.map(p => {
      if (p.kind === 'text') return p.value.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
      return '${' + this.generate(p.expr) + '}';
    }).join('');
    return '`' + body + '`';
  }

  genDestructureDecl(node) {
    if (node.kind === 'object') {
      const bindings = node.bindings.map(b => b.prop === b.name ? b.name : `${b.prop}: ${b.name}`).join(', ');
      return `let { ${bindings} } = ${this.generate(node.value)}`;
    }
    const bindings = node.bindings.map(b => b.name).join(', ');
    return `let [${bindings}] = ${this.generate(node.value)}`;
  }

  genSpreadElement(node) {
    return `...${this.generate(node.value)}`;
  }

  genTestDecl(node) {
    const body = this.genBlockBody(node.body);
    return `__gatra_uji_daftar.push([${JSON.stringify(node.label)}, async () => {\n${body}\n${this.ind()}}]);`;
  }

  genMeasureStmt(node) {
    const tmp = `__ukur${this.measureCounter++}`;
    this.depth++;
    const ind1     = this.ind();
    const startLine = `${ind1}const ${tmp} = performance.now();`;
    const tryBody   = this.genBlockBody(node.body);
    const finallyLine = `${ind1}  console.log(${JSON.stringify(node.label)} + ': ' + Math.round(performance.now() - ${tmp}) + 'ms');`;
    this.depth--;
    return `{\n${startLine}\n${ind1}try {\n${tryBody}\n${ind1}} finally {\n${finallyLine}\n${ind1}}\n${this.ind()}}`;
  }

  genAssertStmt(node) {
    const exprJs = this.generate(node.expr);
    const pesan  = exprJs.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    return `if (!(${exprJs})) { throw new Error('Pastikan gagal: ${pesan}'); }`;
  }

  genMatchStmt(node) {
    const tmp  = `__cocok${this.matchCounter++}`;
    const disc = this.generate(node.discriminant);
    let out = `const ${tmp} = ${disc};\n${this.ind()}`;

    node.cases.forEach((c, i) => {
      const test = this.generate(c.test);
      this.depth++;
      const bodyLine = this.genBlockStmt(c.body);
      this.depth--;
      out += `${i === 0 ? 'if' : 'else if'} (${tmp} === ${test}) {\n${bodyLine}\n${this.ind()}} `;
    });

    if (node.defaultCase) {
      this.depth++;
      const bodyLine = this.genBlockStmt(node.defaultCase);
      this.depth--;
      out += `else {\n${bodyLine}\n${this.ind()}}`;
    }

    return out.trimEnd();
  }

  genMatchResultStmt(node) {
    const tmp  = `__cocok${this.matchCounter++}`;
    const disc = this.generate(node.discriminant);
    let out = `const ${tmp} = ${disc};\n${this.ind()}`;

    const parts = [];
    if (node.okArm) {
      this.depth++;
      const bindLine = `${this.ind()}const ${node.okArm.binding} = ${tmp}.nilai;`;
      const bodyLine = this.genBlockStmt(node.okArm.body);
      this.depth--;
      parts.push(`if (${tmp}.__tag === 'berhasil') {\n${bindLine}\n${bodyLine}\n${this.ind()}}`);
    }
    if (node.errArm) {
      this.depth++;
      const bindLine = `${this.ind()}const ${node.errArm.binding} = ${tmp}.galat;`;
      const bodyLine = this.genBlockStmt(node.errArm.body);
      this.depth--;
      parts.push(`if (${tmp}.__tag === 'gagal') {\n${bindLine}\n${bodyLine}\n${this.ind()}}`);
    }

    return out + parts.join(' ');
  }

  genTernaryExpr(node) {
    return `(${this.generate(node.condition)} ? ${this.generate(node.consequent)} : ${this.generate(node.alternate)})`;
  }
}

function generate(ast, opts) {
  return new CodeGenerator(opts).generate(ast);
}

module.exports = { CodeGenerator, generate };
