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
  'ekspor':   'export',   // export modifier before 'fungsi'
  'cocok':    'match',    // match/switch statement
  'kasus':    'case',     // arm inside 'cocok'
  'berhenti': 'break',    // break out of loop
  'lanjut':   'continue', // continue to next iteration
  'buat':     'new',      // optional prefix before struct init
  'tipe':     'type',     // type alias declaration
  'uji':      'test',     // test block: uji "label" { ... }
  'pastikan': 'assert',   // assertion inside a test (or anywhere)
  'jalankan': 'spawn',    // pekerja call (expr) OR concurrency terstruktur block (stmt)
  'tugas':    'task',     // tugas expr() — spawn a concurrent async task
  'pekerja':  'worker',   // modifier before 'fungsi' — runs on a real OS thread
  'pilih':    'select',   // select over multiple 'saluran'
};

// Maps type keyword → canonical internal type
const TYPE_MAP = {
  'logika':  'bool',
  'angka':   'number',
  'bilangan':'number',  // integer — dialiaskan ke 'number' (belum ada tipe int terpisah)
  'pecahan': 'number',  // float — dialiaskan ke 'number' (belum ada tipe float terpisah)
  'byte':    'number',  // dialiaskan ke 'number'
  'teks':    'string',
  'tiada':   'void',
  'apapun':  'unknown', // escape hatch: any JS value, no type checking
  'larik':   'array',   // ditulis sebagai larik<T> — didesugar ke T[] oleh parser
  'peta':    'map',     // ditulis sebagai peta<K, V> — direpresentasikan sebagai objek JS biasa
};

function detectGrammar(_source) {
  return 'id';
}

module.exports = { KEYWORD_MAP, TYPE_MAP, detectGrammar };
