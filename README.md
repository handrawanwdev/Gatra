# Gatra

**Bahasa pemrograman statically-typed bersyntax Bahasa Indonesia, dikompilasi ke JavaScript dan berjalan di atas Node.js.**

> Sederhana bahasanya. Bersih kodenya. Luas ekosistemnya.

Gatra tidak membuat runtime, VM, garbage collector, atau package manager sendiri — kode Gatra dikompilasi menjadi JavaScript biasa lalu dijalankan Node.js, sehingga tetap kompatibel penuh dengan seluruh ekosistem npm.

```
Gatra → Lexer → Parser → Type Checker → JavaScript Generator → Node.js
```

Dokumen spesifikasi lengkap bahasa ada di [`PRD.md`](./PRD.md), dan primitive Big Data (`data<T>`) ada di [`BIGDATA_TYPE.md`](./BIGDATA_TYPE.md).

---

## Fitur singkat

- Static typing dengan inferensi tipe, keyword bahasa dalam Bahasa Indonesia (`isi`, `fungsi`, `jika`, `untuk`, `struktur`, dst.)
- Kompilasi langsung ke JavaScript yang mudah dibaca — bukan bytecode/VM tersendiri
- Interop penuh dengan paket npm (`impor ... dari "express"`)
- Visibility gaya Go (huruf besar = publik, huruf kecil = internal) — tanpa keyword `export`/`public`
- `hasil<T, E>` (result type) + `cocok` (pattern matching) untuk error handling eksplisit
- Linter dan formatter bawaan (`gatra periksa`, `gatra rapikan`)
- Primitive Big Data (`data<T>`) dengan lazy execution plan, opsional dipercepat lewat native engine Rust

---

## Prasyarat

| Kebutuhan | Versi | Wajib? |
|---|---|---|
| [Node.js](https://nodejs.org) | 18 LTS ke atas | Ya |
| npm | ikut bawaan Node.js | Ya |
| [Rust](https://www.rust-lang.org/tools/install) (`cargo`) | edisi 2021 ke atas | Tidak — opsional, lihat di bawah |

Gatra murni berjalan di atas Node.js — tidak perlu instalasi lain. Rust cuma dibutuhkan kalau `npm install` tidak menemukan binary native prebuilt yang cocok untuk platform kamu (lihat bagian **Native engine** di bawah); tanpa Rust sekalipun, fitur `data<T>` tetap jalan penuh lewat fallback JavaScript murni, cuma tanpa percepatan native.

---

## Native engine (opsional, cross-platform)

`data<T>` (lihat [`BIGDATA_TYPE.md`](./BIGDATA_TYPE.md)) punya dua operasi yang bisa dipercepat lewat native engine Rust (`native-engine/`): `.kelompok()`+`.agregat()` (group-by + aggregate), dan bentuk sederhana `.saring(.field OP literal)`. Ini murni opsional — semua operasi tetap benar dan lengkap lewat fallback JavaScript (`src/runtime/dataset.js`) kalau native engine tidak aktif.

Binary native prebuilt sudah disertakan di repo ini untuk:

| Platform | Target |
|---|---|
| Linux x64 (glibc) | `linux-x64-gnu` |
| Linux x64 (musl, mis. Alpine) | `linux-x64-musl` |
| Linux ARM64 (glibc) | `linux-arm64-gnu` |
| Linux ARM64 (musl) | `linux-arm64-musl` |

`npm install` otomatis mendeteksi platform kamu (`native-engine/platform-target.js`, termasuk deteksi glibc vs musl lewat `process.report`) dan langsung memakai binary yang cocok — tidak ada langkah tambahan.

**Windows dan macOS** belum punya binary prebuilt yang ikut ter-commit (butuh toolchain resmi tiap platform — MSVC untuk Windows, Xcode untuk macOS — yang tidak bisa di-cross-compile dari Linux). Ada dua cara mengaktifkannya di platform itu:

1. **Lewat CI** (direkomendasikan) — workflow [`​.github/workflows/native-engine.yml`](./.github/workflows/native-engine.yml) sudah disiapkan: build native di runner Windows/macOS asli (`windows-latest`, `macos-13` Intel, `macos-14` Apple Silicon) lalu commit hasilnya balik ke `native-engine/`. Jalankan sekali lewat tab Actions (workflow_dispatch) di GitHub setelah repo ini di-push ke sana, atau otomatis tiap ada perubahan di `native-engine/**`.
2. **Build lokal** — kalau Rust ter-install di komputar Windows/macOS kamu, `npm install` akan mem-build sendiri (`scripts/build-native.js`) tanpa langkah manual tambahan.

Tanpa keduanya, Windows/macOS tetap 100% fungsional lewat fallback JavaScript — cuma tanpa percepatan native untuk dua operasi di atas.

---

## Instalasi

Gatra belum dipublikasikan ke npm registry — jalankan dari source:

```bash
git clone <url-repo-ini> gatra
cd gatra
npm install
```

`npm install` otomatis:
1. Memasang dependensi Node.js.
2. Mencoba mem-build native engine Rust (`scripts/build-native.js`) — kalau `cargo` tidak ditemukan di PATH, langkah ini otomatis dilewati dengan notice, dan `npm install` tetap berhasil.

Tidak ada langkah manual tambahan yang dibutuhkan setelah `npm install` selesai.

### Menjalankan CLI

Tanpa instalasi global, panggil langsung lewat `node`:

```bash
node src/cli/gatra.js bantuan
```

Atau, supaya bisa memanggil `gatra` langsung dari mana saja di komputer ini:

```bash
npm link
gatra bantuan
```

(`npm link` membuat symlink global `gatra` yang mengarah ke `src/cli/gatra.js` di clone ini — cukup dijalankan sekali. Lepas lagi dengan `npm unlink -g gatra` kalau perlu.)

---

## Quick start

```bash
gatra buat proyek-saya
cd proyek-saya
gatra jalankan utama.gatra
```

`gatra buat` membuat folder proyek baru berisi `package.json` dan `utama.gatra` contoh ("Halo, proyek-saya!"). `gatra jalankan` mengompilasi lalu langsung menjalankannya di Node.js — tanpa perlu langkah build terpisah.

### Contoh kode

```gatra
isi nama: teks = "Gatra"
isi versi: angka = 1

cetak("Halo, Dunia!")
cetak("Nama bahasa: ", nama)

jika (versi == 1) {
    cetak("Versi pertama")
} lain {
    cetak("Versi lain")
}
```

Lebih banyak contoh berjenjang (dari dasar sampai lanjut) ada di [`examples/belajar/`](./examples/belajar).

---

## Perintah CLI

| Perintah | Keterangan |
|---|---|
| `gatra buat <nama>` | Buat proyek baru |
| `gatra jalankan <file>` | Kompilasi dan langsung jalankan file `.gatra` |
| `gatra bangun <file> [output] [--samar]` | Kompilasi satu file ke `.js` |
| `gatra bundel <entry> [output] [--samar]` | Bundle seluruh dependensi ke satu file `.js` |
| `gatra bangun-proyek <dir> [dist] [--samar]` | Kompilasi seluruh proyek |
| `gatra uji <file>` | Jalankan blok `uji "..." { ... }` di dalam file |
| `gatra periksa <file>` | Analisis statis (linter) |
| `gatra rapikan <file> [--tulis]` | Format kode — cetak ke stdout, atau `--tulis` untuk menimpa file |
| `gatra versi` | Tampilkan versi compiler |
| `gatra bantuan` | Tampilkan bantuan ini |

Flag `--samar` menghasilkan kode yang disamarkan (identifier dienkripsi, string diubah ke unicode).

Gatra tidak punya package manager sendiri — dependensi npm dikelola langsung lewat `npm install`/`npm update`/`npm uninstall` seperti biasa.

---

## Menjalankan test suite

```bash
npm test
```

Menjalankan seluruh test compiler (lexer → parser → typechecker → codegen → runtime) di `tests/test.js`.

---

## Struktur proyek

```
src/
  lexer/        tokenizer + kamus keyword Bahasa Indonesia
  parser/       AST parser
  typechecker/  static type checking
  codegen/      generator JavaScript
  formatter/    'gatra rapikan'
  linter/       'gatra periksa'
  module/       resolusi impor lokal + visibility gaya Go
  runtime/      runtime pendukung (mis. data<T>, lihat BIGDATA_TYPE.md)
  cli/          entry point 'gatra'
native-engine/  native engine Rust opsional (N-API), lihat Prasyarat di atas
examples/       contoh kode, termasuk seri belajar di examples/belajar/
tests/          test suite (npm test)
```

## Lisensi

MIT
