'use strict';

class OwnershipError extends Error {
  constructor(name, message, line, col, hint) {
    super(message);
    this.name = name;
    this.line = line;
    this.col  = col;
    this.hint = hint || null;
  }
}

function makeOwnershipErrors(grammar) {
  const isID    = grammar === 'id';
  const errName = isID ? 'KesalahanKepemilikan' : 'OwnershipError';
  const e = (msg, line, col, hint) => new OwnershipError(errName, msg, line, col, hint);

  return {
    // R2/R3 — use after move
    useAfterMove(name, movedLine, movedCol, line, col) {
      const msg  = isID
        ? `'${name}' sudah dipindahkan dan tidak dapat digunakan`
        : `'${name}' has been moved and cannot be used`;
      const hint = isID
        ? `'${name}' dipindahkan di baris ${movedLine}, kolom ${movedCol}`
        : `'${name}' was moved at line ${movedLine}, column ${movedCol}`;
      return e(msg, line, col, hint);
    },

    // R7 — move while borrowed
    moveWhileBorrowed(name, line, col) {
      const msg = isID
        ? `Tidak bisa memindahkan '${name}' saat sedang dipinjam`
        : `Cannot move '${name}' while it is borrowed`;
      return e(msg, line, col);
    },

    // R8 — mutation requires ubah
    assignNonMutable(name, line, col) {
      const msg  = isID
        ? `Tidak bisa mengubah '${name}' — belum dideklarasikan sebagai mutable`
        : `Cannot assign to '${name}' — not declared as mutable`;
      const hint = isID
        ? `ubah 'isi ${name}' menjadi 'isi ubah ${name}'`
        : `change 'let ${name}' to 'let mut ${name}'`;
      return e(msg, line, col, hint);
    },

    // R6 — immutable + mutable borrow conflict
    mutBorrowConflict(name, line, col) {
      const msg = isID
        ? `Tidak bisa meminjam '${name}' sebagai mutable saat masih dipinjam`
        : `Cannot borrow '${name}' as mutable while it is already borrowed`;
      return e(msg, line, col);
    },

    // R5 — two mutable borrows
    doubleMutBorrow(name, firstLine, firstCol, line, col) {
      const msg  = isID
        ? `Tidak bisa meminjam '${name}' sebagai mutable lebih dari sekali`
        : `Cannot borrow '${name}' as mutable more than once`;
      const hint = isID
        ? `pinjaman mutable pertama di baris ${firstLine}, kolom ${firstCol}`
        : `first mutable borrow at line ${firstLine}, column ${firstCol}`;
      return e(msg, line, col, hint);
    },

    // R5 — mutable borrow on non-mutable variable
    borrowNonMutable(name, line, col) {
      const msg  = isID
        ? `Tidak bisa meminjam '${name}' sebagai mutable — belum dideklarasikan sebagai mutable`
        : `Cannot borrow '${name}' as mutable — it is not declared as mutable`;
      const hint = isID
        ? `tambahkan 'ubah' pada deklarasi: 'isi ubah ${name}'`
        : `declare '${name}' as mutable: 'let mut ${name}'`;
      return e(msg, line, col, hint);
    },

    // R4 — assign through immutable ref
    assignThroughImmutableRef(refName, line, col) {
      const msg  = isID
        ? `Tidak bisa mengubah nilai melalui referensi tidak dapat diubah '${refName}'`
        : `Cannot assign through immutable reference '${refName}'`;
      const hint = isID
        ? `gunakan '&ubah' untuk membuat pinjaman yang dapat diubah`
        : `use '&mut' to create a mutable borrow`;
      return e(msg, line, col, hint);
    },

    // deref of non-reference
    derefNonRef(name, line, col) {
      const msg = isID
        ? `'${name}' bukan sebuah referensi — tidak bisa di-dereference`
        : `'${name}' is not a reference — cannot dereference`;
      return e(msg, line, col);
    },
  };
}

module.exports = { makeOwnershipErrors, OwnershipError };
