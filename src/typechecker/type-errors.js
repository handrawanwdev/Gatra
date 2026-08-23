'use strict';

class TypeCheckError extends Error {
  constructor(name, message, line, col) {
    super(message);
    this.name = name;
    this.line = line;
    this.col  = col;
  }
}

// Display name for a type in the target grammar
function displayType(type, isID) {
  if (!isID) return type;
  const map = { number: 'angka', string: 'teks', bool: 'logika', void: 'tiada', unknown: 'tidak diketahui', null: 'kosong' };
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
  const e    = (name, msg, line, col) => new TypeCheckError(name, msg, line, col);

  return {
    typeMismatch(expected, got, line, col) {
      const msg = isID
        ? `Diharapkan '${dt(expected)}', ditemukan '${dt(got)}'`
        : `Expected '${expected}', got '${got}'`;
      return e('TypeError', msg, line, col);
    },

    undefinedVar(name, line, col) {
      const msg = isID
        ? `'${name}' tidak terdefinisi`
        : `'${name}' is not defined`;
      return e('ReferenceError', msg, line, col);
    },

    duplicateVar(name, line, col) {
      const msg = isID
        ? `'${name}' sudah terdefinisi di scope ini`
        : `'${name}' is already defined in this scope`;
      return e('ScopeError', msg, line, col);
    },

    notAFunction(name, line, col) {
      const msg = isID
        ? `'${name}' bukan sebuah fungsi`
        : `'${name}' is not a function`;
      return e('TypeError', msg, line, col);
    },

    wrongArgCount(name, expected, got, line, col) {
      const msg = isID
        ? `${fn(name)} membutuhkan ${expected} argumen, ditemukan ${got}`
        : `${fn(name)} expects ${expected} argument${expected !== 1 ? 's' : ''}, got ${got}`;
      return e('CallError', msg, line, col);
    },

    wrongArgType(name, index, expected, got, line, col) {
      const msg = isID
        ? `Argumen ke-${index + 1} dari '${name}' diharapkan '${dt(expected)}', ditemukan '${dt(got)}'`
        : `Argument ${index + 1} of '${name}' expects '${expected}', got '${got}'`;
      return e('TypeError', msg, line, col);
    },

    returnTypeMismatch(name, expected, got, line, col) {
      const msg = isID
        ? `${fn(name)} harus mengembalikan '${dt(expected)}', ditemukan '${dt(got)}'`
        : `${fn(name)} must return '${expected}', got '${got}'`;
      return e('TypeError', msg, line, col);
    },

    operatorMismatch(op, left, right, line, col) {
      const msg = isID
        ? `Operator '${op}' tidak dapat digunakan pada '${dt(left)}' dan '${dt(right)}'`
        : `Cannot apply '${op}' to '${left}' and '${right}'`;
      return e('TypeError', msg, line, col);
    },

    ifNotBool(got, line, col) {
      const kw  = isID ? 'jika' : 'if';
      const msg = isID
        ? `Kondisi '${kw}' harus bertipe 'logika', ditemukan '${dt(got)}'`
        : `Condition of '${kw}' must be 'bool', got '${got}'`;
      return e('TypeError', msg, line, col);
    },

    unknownType(name, line, col) {
      const msg = isID
        ? `Tipe '${name}' tidak ditemukan`
        : `Type '${name}' is not defined`;
      return e('TypeError', msg, line, col);
    },

    unknownField(structName, field, line, col) {
      const msg = isID
        ? `Struktur '${structName}' tidak memiliki field '${field}'`
        : `Struct '${structName}' has no field '${field}'`;
      return e('TypeError', msg, line, col);
    },

    memberOnNonStruct(typeName, field, line, col) {
      const msg = isID
        ? `Tipe '${dt(typeName)}' tidak memiliki field '${field}'`
        : `Type '${typeName}' has no field '${field}'`;
      return e('TypeError', msg, line, col);
    },

    missingField(structName, fieldName, line, col) {
      const msg = isID
        ? `Field '${fieldName}' wajib diisi pada '${structName}'`
        : `Missing required field '${fieldName}' in '${structName}'`;
      return e('TypeError', msg, line, col);
    },

    arrayTypeMismatch(expected, got, line, col) {
      const msg = isID
        ? `Array berisi '${dt(expected)}', ditemukan elemen bertipe '${dt(got)}'`
        : `Array<${expected}> cannot contain ${got}`;
      return e('TypeError', msg, line, col);
    },

    awaitOutsideAsync(line, col) {
      const msg = isID
        ? `'tunggu' hanya bisa digunakan di dalam fungsi asinkron`
        : `'await' can only be used inside an async function`;
      return e('SyntaxError', msg, line, col);
    },

    notAWorkerFn(name, line, col) {
      const msg = isID
        ? `${fn(name)} bukan fungsi pekerja — tandai dengan 'pekerja fungsi' agar bisa dipakai 'jalankan'`
        : `${fn(name)} is not a worker function — mark it with 'pekerja fungsi' to use 'jalankan'`;
      return e('TypeError', msg, line, col);
    },

    awaitInNonAsync(fnName, line, col) {
      const msg = isID
        ? `fungsi '${fnName}' bukan asinkron — tambahkan 'asinkron' pada deklarasi`
        : `function '${fnName}' is not async — add 'async' to its declaration`;
      return e('SyntaxError', msg, line, col);
    },
  };
}

module.exports = { makeErrors, TypeCheckError };
