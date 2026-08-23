'use strict';

// Maps source keyword (Bahasa Indonesia only) → canonical internal value
// Kosakata mengikuti Kamus Bahasa Gatra (PRD bagian 7).
const KEYWORD_MAP = {
  'isi':      'let',
  'fungsi':   'fn',
  'balik':    'return',
  'keluar':   'return',   // alias — early exit
  'jika':     'if',
  'lain':     'else',
  'struktur': 'struct',
  'cetak':    'print',
  'benar':    'true',
  'salah':    'false',
  'ubah':     'mut',
  'paket':    'package',
  'impor':    'import',
  'dari':     'from',
  'untuk':    'for',      // loop
  'selama':   'while',    // while loop
  'dalam':    'in',       // loop iterator keyword
  'asinkron': 'async',    // async function modifier
  'tunggu':   'await',    // await expression
  'coba':     'try',      // try block
  'tangkap':  'catch',    // catch block
  'akhirnya': 'finally',  // finally block
  'kosong':   'null',     // null literal
  'kasus':    'case',     // arm inside 'pilih'
  'berhenti': 'break',    // break out of loop
  'lanjut':   'continue', // continue to next iteration
  'buat':     'new',      // optional prefix before struct init
  'tipe':     'type',     // type alias declaration
  'uji':      'test',     // test block: uji "label" { ... }
  'pastikan': 'assert',   // assertion inside a test (or anywhere)
  'pilih':    'select',   // pilih expr { kasus val -> ... lain -> ... } (pencocokan nilai)
  'batas':    'timeout',  // tunggu expr batas N detik
  'detik':    'second',   // satuan waktu untuk 'batas'
  'dengan':   'with',     // dengan expr { field ... } — transformasi objek
  'cocok':    'match',    // cocok expr { berhasil(n) => ... gagal(e) => ... } — pattern match hasil<T,E>
  'ukur':     'measure',  // ukur "label" { ... } — cetak durasi eksekusi blok (observability)
  'kelas':    'class',
  'konstruk': 'constructor',
  'ini':      'this',
  'induk':    'super',
  'warisi':   'extends',   // kelas Kucing warisi Hewan { ... }
  'statis':   'static',
  'privat':   'private',
  // 'ambil' (getter) dan 'atur' (setter) SENGAJA tidak masuk di sini — kata
  // umum yang lumrah dipakai sebagai nama fungsi/variabel biasa (mis. fungsi
  // 'ambil'). Dikenali kontekstual di parser lewat lookahead 2 IDENTIFIER
  // berturut-turut di dalam badan 'kelas' (lihat classDecl() di parser.js).
  //
  // 'ekspor' TIDAK ADA LAGI — visibility sekarang murni dari huruf awal nama
  // identifier (gaya Go): huruf besar = publik/terekspor, huruf kecil =
  // internal. Tidak ada keyword export/public/private khusus. Lihat
  // src/module/visibility.js dan checkPackageImport() di typechecker.js.
};

// Maps type keyword → canonical internal type
const TYPE_MAP = {
  'logika':  'bool',
  'angka':   'number',  // numerik umum/generik — menerima bilangan, pecahan, byte
  'bilangan':'int',     // harus bilangan bulat (divalidasi utk literal langsung)
  'pecahan': 'float',   // menerima bilangan bulat maupun desimal
  'byte':    'byte',    // bilangan bulat 0-255 (divalidasi utk literal langsung)
  'teks':    'string',
  'tiada':   'void',
  'apa_saja':'unknown', // escape hatch: any JS value, no type checking (bisa warning dari linter)
  'larik':   'array',   // ditulis sebagai larik<T> — didesugar ke T[] oleh parser
  'peta':    'map',     // ditulis sebagai peta<K, V> — direpresentasikan sebagai objek JS biasa
  // 'hasil' SENGAJA tidak masuk di sini — 'hasil' tetap bisa dipakai sebagai
  // nama variabel biasa (kata umum). Sebagai tipe, 'hasil<T, E>' dikenali
  // langsung dari kata sumbernya di consumeType() (lihat parser.js).
};

function detectGrammar(_source) {
  return 'id';
}

module.exports = { KEYWORD_MAP, TYPE_MAP, detectGrammar };
