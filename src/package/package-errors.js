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

    // Go-style visibility: identifier exists in the module but its first
    // letter is lowercase (internal/unexported).
    accessDenied(identName, line, col) {
      const msg = isID
        ? `\`${identName}\` tidak dapat diakses dari modul ini.\nIdentifier dengan huruf awal kecil bersifat internal.`
        : `\`${identName}\` cannot be accessed from this module.\nIdentifiers starting with a lowercase letter are internal.`;
      return new PackageError('GALAT AKSES', msg, line, col);
    },

    // Go-style visibility extended to every external module — Node builtins
    // and npm packages alike (see external-interop.js): 'realMember' is a
    // real lowercase/camelCase member (e.g. 'platform' on 'os', 'map' on
    // 'lodash') accessed directly instead of through its PascalCase form.
    externalMemberNotPublic(realMember, moduleLocalName, line, col) {
      const { toPublicName } = require('../module/external-interop');
      const suggested = toPublicName(realMember);
      const msg = isID
        ? `\`${realMember}\` bukan anggota public dari modul \`${moduleLocalName}\`.\nGunakan \`${moduleLocalName}.${suggested}()\`.`
        : `\`${realMember}\` is not a public member of module \`${moduleLocalName}\`.\nUse \`${moduleLocalName}.${suggested}()\`.`;
      return new PackageError('GALAT AKSES', msg, line, col);
    },

    identifierNotFound(identName, source, line, col) {
      const msg = isID
        ? `'${identName}' tidak ditemukan di modul '${source}'`
        : `'${identName}' not found in module '${source}'`;
      return e(msg, line, col);
    },
  };
}

module.exports = { makePackageErrors, PackageError };
