'use strict';

class TypeCheckError extends Error {
  constructor(name, message, line, col, hint) {
    super(message);
    this.name = name;
    this.line = line;
    this.col  = col;
    this.hint = hint || null;
  }
}

// Display name for a type in the target grammar
function displayType(type, isID) {
  if (!isID) return type;
  const map = {
    number: 'angka', string: 'teks', bool: 'logika', void: 'tiada', unknown: 'apa_saja', null: 'kosong',
    int: 'bilangan', float: 'pecahan', byte: 'byte',
  };
  if (type.endsWith('?'))  return displayType(type.slice(0, -1), isID) + '?';
  if (type.endsWith('[]')) return displayType(type.slice(0, -2), isID) + '[]';
  return map[type] || type;
}

function displayFn(name, isID) {
  return isID ? `fungsi '${name}'` : `function '${name}'`;
}

// Returns an error-builder object scoped to a grammar ('en' or 'id')
function makeErrors(grammar) {
  const isID = grammar === 'id';
  const dt   = (t) => displayType(t, isID);
  const fn   = (n) => displayFn(n, isID);
  const e    = (name, msg, line, col, hint) => new TypeCheckError(name, msg, line, col, hint);

  return {
    typeMismatch(expected, got, line, col) {
      const msg = isID
        ? `Diharapkan '${dt(expected)}', ditemukan '${dt(got)}'`
        : `Expected '${expected}', got '${got}'`;
      const hint = isID
        ? `Cek lagi nilai yang dipakai di sini — cocokkan dengan tipe '${dt(expected)}' yang diminta, atau ubah anotasi tipenya kalau memang '${dt(got)}' yang benar.`
        : null;
      return e('TypeError', msg, line, col, hint);
    },

    undefinedVar(name, line, col) {
      const msg = isID
        ? `'${name}' tidak terdefinisi`
        : `'${name}' is not defined`;
      const hint = isID
        ? `Kalau '${name}' variabel: pastikan sudah dideklarasikan pakai 'isi' sebelum baris ini. Kalau ini fungsi/struct dari file lain: cek ejaannya, atau pastikan sudah di-'impor'.`
        : null;
      return e('ReferenceError', msg, line, col, hint);
    },

    duplicateVar(name, line, col) {
      const msg = isID
        ? `'${name}' sudah terdefinisi di scope ini`
        : `'${name}' is already defined in this scope`;
      const hint = isID
        ? `Ganti nama salah satu '${name}', atau hapus deklarasi yang dobel.`
        : null;
      return e('ScopeError', msg, line, col, hint);
    },

    notAFunction(name, line, col) {
      const msg = isID
        ? `'${name}' bukan sebuah fungsi`
        : `'${name}' is not a function`;
      const hint = isID
        ? `'${name}' kelihatannya variabel biasa (bukan fungsi) — jadi gak bisa dipanggil pakai kurung '(...)'.`
        : null;
      return e('TypeError', msg, line, col, hint);
    },

    wrongArgCount(name, expected, got, line, col) {
      const msg = isID
        ? `${fn(name)} membutuhkan ${expected} argumen, ditemukan ${got}`
        : `${fn(name)} expects ${expected} argument${expected !== 1 ? 's' : ''}, got ${got}`;
      const hint = isID
        ? `Hitung lagi argumen yang dikirim ke ${fn(name)} dan cocokkan sama deklarasi parameternya.`
        : null;
      return e('CallError', msg, line, col, hint);
    },

    wrongArgType(name, index, expected, got, line, col) {
      const msg = isID
        ? `Argumen ke-${index + 1} dari '${name}' diharapkan '${dt(expected)}', ditemukan '${dt(got)}'`
        : `Argument ${index + 1} of '${name}' expects '${expected}', got '${got}'`;
      const hint = isID
        ? `Cek lagi argumen ke-${index + 1} yang dikirim ke '${name}' — harus bertipe '${dt(expected)}'.`
        : null;
      return e('TypeError', msg, line, col, hint);
    },

    returnTypeMismatch(name, expected, got, line, col) {
      const msg = isID
        ? `${fn(name)} harus mengembalikan '${dt(expected)}', ditemukan '${dt(got)}'`
        : `${fn(name)} must return '${expected}', got '${got}'`;
      const hint = isID
        ? `Cek 'balik' di dalam ${fn(name)} — nilai yang dibalikin harus bertipe '${dt(expected)}', sesuai yang dituliskan setelah ':' di deklarasi fungsinya.`
        : null;
      return e('TypeError', msg, line, col, hint);
    },

    operatorMismatch(op, left, right, line, col) {
      const msg = isID
        ? `Operator '${op}' tidak dapat digunakan pada '${dt(left)}' dan '${dt(right)}'`
        : `Cannot apply '${op}' to '${left}' and '${right}'`;
      const hint = isID
        ? `Operator '${op}' cuma jalan buat pasangan tipe yang cocok (mis. angka dengan angka, teks dengan teks) — cek lagi tipe kedua sisinya.`
        : null;
      return e('TypeError', msg, line, col, hint);
    },

    ifNotBool(got, line, col) {
      const kw  = isID ? 'jika' : 'if';
      const msg = isID
        ? `Kondisi '${kw}' harus bertipe 'logika', ditemukan '${dt(got)}'`
        : `Condition of '${kw}' must be 'bool', got '${got}'`;
      const hint = isID
        ? `Kondisi 'jika' harus berupa perbandingan yang hasilnya benar/salah — coba tambahkan perbandingan, mis. '== ', '!=', '>', atau '<'.`
        : null;
      return e('TypeError', msg, line, col, hint);
    },

    unknownType(name, line, col) {
      const msg = isID
        ? `Tipe '${name}' tidak ditemukan`
        : `Type '${name}' is not defined`;
      const hint = isID
        ? `Cek ejaan nama tipenya — tipe bawaan Gatra: angka, teks, logika, tiada, dst. Kalau ini struct, pastikan sudah dideklarasikan (atau diimpor) sebelum dipakai.`
        : null;
      return e('TypeError', msg, line, col, hint);
    },

    unknownField(structName, field, line, col) {
      const msg = isID
        ? `Struktur '${structName}' tidak memiliki field '${field}'`
        : `Struct '${structName}' has no field '${field}'`;
      const hint = isID
        ? `Cek lagi nama field-nya (mungkin salah ketik), atau lihat deklarasi 'struktur ${structName}' buat lihat field apa aja yang ada.`
        : null;
      return e('TypeError', msg, line, col, hint);
    },

    memberOnNonStruct(typeName, field, line, col) {
      const msg = isID
        ? `Tipe '${dt(typeName)}' tidak memiliki field '${field}'`
        : `Type '${typeName}' has no field '${field}'`;
      const hint = isID
        ? `'${dt(typeName)}' bukan struct, jadi gak punya field — cek lagi variabel yang kamu akses.`
        : null;
      return e('TypeError', msg, line, col, hint);
    },

    missingField(structName, fieldName, line, col) {
      const msg = isID
        ? `Field '${fieldName}' wajib diisi pada '${structName}'`
        : `Missing required field '${fieldName}' in '${structName}'`;
      const hint = isID
        ? `Tambahkan '${fieldName}: ...' waktu bikin '${structName} { ... }'.`
        : null;
      return e('TypeError', msg, line, col, hint);
    },

    arrayTypeMismatch(expected, got, line, col) {
      const msg = isID
        ? `Array berisi '${dt(expected)}', ditemukan elemen bertipe '${dt(got)}'`
        : `Array<${expected}> cannot contain ${got}`;
      const hint = isID
        ? `Semua elemen larik harus bertipe sama — cek lagi elemen yang bertipe '${dt(got)}' itu, seharusnya '${dt(expected)}'.`
        : null;
      return e('TypeError', msg, line, col, hint);
    },

    awaitOutsideAsync(line, col) {
      const msg = isID
        ? `'tunggu' hanya bisa digunakan di dalam fungsi asinkron`
        : `'await' can only be used inside an async function`;
      const hint = isID
        ? `Tambahkan 'asinkron' ke deklarasi fungsi ini, contoh: 'fungsi asinkron namaFungsi(...)'.`
        : null;
      return e('SyntaxError', msg, line, col, hint);
    },

    invalidNumericLiteral(targetType, value, line, col) {
      const msg = isID
        ? targetType === 'byte'
          ? `Nilai '${value}' di luar jangkauan 'byte' (harus bilangan bulat 0-255)`
          : `Nilai '${value}' bukan bilangan bulat — tidak valid untuk tipe 'bilangan'`
        : targetType === 'byte'
          ? `Value '${value}' is out of range for 'byte' (must be an integer 0-255)`
          : `Value '${value}' is not an integer — invalid for type 'int'`;
      const hint = isID
        ? targetType === 'byte'
          ? `Pakai nilai 0 sampai 255, atau ganti tipe variabelnya ke 'angka'/'bilangan' kalau memang butuh rentang lebih luas.`
          : `Kalau nilainya emang punya koma/desimal, ganti tipe variabelnya ke 'pecahan'. Kalau harus bilangan bulat, bulatkan dulu nilainya.`
        : null;
      return e('TypeError', msg, line, col, hint);
    },

    decoratorNeedsReceiver(name, line, col) {
      const msg = isID
        ? `'@${name}' hanya bisa dipasang pada 'struktur' atau method ber-receiver (fungsi (x T) nama(...))`
        : `'@${name}' can only decorate a 'struktur' or a receiver method (fungsi (x T) name(...))`;
      const hint = isID
        ? `Pindahkan '@${name}' ke atas deklarasi 'struktur' atau di atas method ber-receiver, contoh: '@${name}\\nfungsi (h Hewan) sapa() { ... }'.`
        : null;
      return e('SyntaxError', msg, line, col, hint);
    },

    awaitInNonAsync(fnName, line, col) {
      const msg = isID
        ? `fungsi '${fnName}' bukan asinkron — tambahkan 'asinkron' pada deklarasi`
        : `function '${fnName}' is not async — add 'async' to its declaration`;
      const hint = isID
        ? `Ubah 'fungsi ${fnName}(...)' jadi 'fungsi asinkron ${fnName}(...)'.`
        : null;
      return e('SyntaxError', msg, line, col, hint);
    },

    paralelNeedsTopLevel(name, line, col) {
      const msg = isID
        ? `'fungsi paralel' cuma boleh di level atas (top-level) — '${name}' punya receiver`
        : `'fungsi paralel' can only be a top-level function — '${name}' has a receiver`;
      const hint = isID
        ? `Ubah '${name}' jadi fungsi biasa tanpa receiver, atau hapus modifier 'paralel' kalau memang harus jadi method.`
        : null;
      return e('SyntaxError', msg, line, col, hint);
    },

    unsafeClosureCapture(varName, fnName, line, col) {
      const msg = isID
        ? `'${varName}' dari luar tidak boleh dipakai di dalam 'fungsi paralel ${fnName}' — worker menjalankan ulang file ini dari awal dan tidak pernah sampai ke deklarasi '${varName}'. Kirim sebagai parameter, atau bungkus dengan 'tanpa_periksa(...)' kalau yakin aman`
        : `outer variable '${varName}' can't be used inside 'fungsi paralel ${fnName}' — a worker re-runs this file from scratch and never reaches '${varName}''s declaration. Pass it as a parameter instead, or wrap with 'tanpa_periksa(...)' if you're sure it's safe`;
      return e('SyntaxError', msg, line, col);
    },

    cannotReassignImmutable(varName, line, col) {
      const msg = isID
        ? `'${varName}' tidak boleh diberi nilai baru — dideklarasikan tanpa 'ubah'`
        : `'${varName}' cannot be reassigned — declared without 'ubah' (mut)`;
      const hint = isID
        ? `Tambahkan 'ubah' waktu deklarasi kalau '${varName}' memang perlu diubah nanti, contoh: 'isi ubah ${varName} = ...'.`
        : `Add 'ubah' at declaration if '${varName}' really needs to change later, e.g. 'isi ubah ${varName} = ...'.`;
      return e('TypeError', msg, line, col, hint);
    },

    usedAfterMove(varName, line, col) {
      const msg = isID
        ? `'${varName}' sudah dipindah (moved) ke 'fungsi paralel' sebelumnya — tidak boleh dipakai lagi. Kirim ulang lewat variabel baru, atau bungkus penggunaannya dengan 'tanpa_periksa(...)' kalau yakin aman`
        : `'${varName}' was already moved into a 'fungsi paralel' call earlier — it can't be used again. Reassign it to a fresh variable, or wrap this use with 'tanpa_periksa(...)' if you're sure it's safe`;
      return e('TypeError', msg, line, col);
    },

    paralelNeedsPlainData(what, name, structName, line, col) {
      const msg = isID
        ? `${what} 'fungsi paralel ${name}' bertipe '${structName}', sebuah struktur ber-method/decorator (jadi 'class' asli) — cuma data polos (angka/teks/logika/larik/peta/struktur tanpa method) yang aman dikirim ke worker`
        : `${what} of 'fungsi paralel ${name}' is '${structName}', a struct with methods/decorators (a real class) — only plain data (number/string/bool/array/map/struct-without-methods) is safe to send to a worker`;
      return e('TypeError', msg, line, col);
    },
  };
}

module.exports = { makeErrors, TypeCheckError };
