'use strict';

class PackageError extends Error {
  constructor(name, message, line, col, hint) {
    super(message);
    this.name = name;
    this.line = line;
    this.col  = col;
    this.hint = hint || null;
  }
}

function makePackageErrors(grammar) {
  const isID = grammar === 'id';
  const e = (msg, line, col, hint) => new PackageError('PackageError', msg, line, col, hint);

  return {
    multipleDeclarations(line, col) {
      const msg = isID
        ? 'Hanya satu deklarasi paket diperbolehkan dalam satu file'
        : 'Only one package declaration allowed per file';
      return e(msg, line, col);
    },

    notFound(name, source, line, col) {
      const msg = isID
        ? `Paket '${name}' tidak ditemukan di '${source}'`
        : `Package '${name}' not found at '${source}'`;
      return e(msg, line, col);
    },

    duplicateImport(name, line, col) {
      const msg = isID
        ? `Import '${name}' sudah dideklarasikan`
        : `Import '${name}' already declared`;
      return e(msg, line, col);
    },
  };
}

module.exports = { makePackageErrors, PackageError };
