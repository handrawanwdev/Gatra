# Gatra

> **Bahasa pemrograman dengan sintaks Bahasa Indonesia.**

Gatra adalah bahasa pemrograman **statically typed** yang dirancang untuk membuat pemrograman terasa lebih sederhana, natural, dan mudah dipahami.

Gatra menggunakan sintaks Bahasa Indonesia, tetapi tetap memanfaatkan kekuatan dan luasnya ekosistem JavaScript.

```text
Sederhana bahasanya.
Bersih kodenya.
Luas ekosistemnya.
```

---

## Kenapa Gatra?

Bahasa pemrograman modern memiliki kemampuan yang sangat besar, tetapi sintaksnya sering kali terasa jauh dari bahasa yang digunakan sehari-hari.

Gatra mencoba membuat kode lebih dekat dengan cara kita memahami instruksi.

Daripada:

```javascript
const name = "Gatra";

if (version === 1) {
  console.log("Versi pertama");
} else {
  console.log("Versi lain");
}
```

Gatra menggunakan:

```gatra
isi nama: teks = "Gatra"
isi versi: angka = 1

jika (versi == 1) {
    cetak("Versi pertama")
} lain {
    cetak("Versi lain")
}
```

Tujuannya bukan sekadar menerjemahkan keyword bahasa pemrograman.

Gatra ingin membangun pengalaman pemrograman yang terasa **lebih familiar, jelas, dan mudah dibaca**.

---

## Filosofi Gatra

Gatra dibangun berdasarkan beberapa prinsip sederhana.

### Bahasa yang mudah dipahami

Kode seharusnya dapat dibaca tanpa harus menghafalkan terlalu banyak istilah asing.

```gatra
jika pengguna.aktif {
    cetak("Selamat datang")
}
```

Kode dapat dibaca seperti instruksi.

---

### Tetap serius untuk membangun software

Mudah dibaca bukan berarti sederhana secara kemampuan.

Gatra dirancang untuk mendukung pengembangan aplikasi nyata dengan:

- Static typing
- Type inference
- Struktur data
- Fungsi
- Module
- Error handling
- Pattern matching
- dan kemampuan modern lainnya

---

### Memanfaatkan ekosistem yang sudah ada

Gatra tidak ingin developer harus meninggalkan ekosistem JavaScript yang sudah sangat luas.

Gatra dapat memanfaatkan package dan library JavaScript yang sudah tersedia.

Dengan begitu, developer mendapatkan pengalaman bahasa baru tanpa kehilangan ekosistem yang sudah mereka kenal.

---

# ✨ Fitur

### 🇮🇩 Sintaks Bahasa Indonesia

Keyword utama menggunakan Bahasa Indonesia sehingga kode terasa lebih natural bagi developer Indonesia.

```gatra
isi nama: teks = "Handrawan"

jika nama == "Handrawan" {
    cetak("Halo!")
}
```

---

### 🔒 Static Typing

Gatra menggunakan static typing untuk membantu menangkap kesalahan lebih awal.

```gatra
isi umur: angka = 25
isi nama: teks = "Gatra"
```

Tipe juga dapat diinferensikan ketika tidak ditulis secara eksplisit.

---

### 🧩 Ekosistem JavaScript

Gatra tetap berada dekat dengan JavaScript.

Developer dapat memanfaatkan library dan package yang sudah tersedia di ekosistem JavaScript dan npm.

Artinya, Gatra tidak mengharuskan developer membangun semuanya dari awal.

---

### 🎯 Error Handling yang Jelas

Gatra menyediakan pendekatan eksplisit untuk menangani hasil operasi yang dapat berhasil maupun gagal.

Konsep seperti:

```text
hasil<T, E>
```

membuat alur error lebih jelas dan mudah ditelusuri.

---

### 🔀 Pattern Matching

Gatra menyediakan `cocok` untuk menangani beberapa kemungkinan nilai dengan cara yang lebih terstruktur.

Hal ini membuat kode yang memiliki banyak kondisi menjadi lebih mudah dibaca.

---

# ⚙️ Cara Kerja Gatra

Gatra **bukan** bahasa yang punya interpreter atau VM sendiri. Gatra adalah **compiler yang menerjemahkan kode `.gatra` menjadi JavaScript biasa**, lalu JavaScript itu yang dijalankan oleh Node.js (V8).

```
kode .gatra
    ↓  lexer      (pecah jadi token)
    ↓  parser     (susun jadi AST)
    ↓  typechecker (validasi tipe, visibility, dll)
    ↓  codegen    (AST → kode JavaScript)
kode .js
    ↓
Node.js (V8)
```

Karena keluarannya JavaScript murni, semua yang bisa dilakukan JavaScript/Node.js bisa dilakukan dari Gatra — termasuk `impor` package dari npm atau modul bawaan Node (`node:http`, `node:fs`, dst), bukan cuma untuk file `.gatra` lokal.

### Jalur eksekusi

`gatra jalankan` memilih salah satu dari tiga jalur, tergantung isi file:

- **CommonJS (default)** — dijalankan lewat `vm.Script` di dalam proses Node yang sama (sandbox in-process). Ini jalur untuk kode Gatra biasa.
- **ES Module** — begitu hasil kompilasi mengandung `import`/`export` (misalnya karena pakai `impor ... dari "..."` atau `paket`), Gatra otomatis menulis file `.js` sementara dan menjalankannya lewat proses Node terpisah (`node file.js`), karena `import`/`export` adalah sintaks ES Module asli yang tidak bisa dieksekusi lewat `vm.Script` biasa.
- **`fungsi paralel` (Automatic Concurrency)** — juga ditulis ke file sementara dan dijalankan lewat proses Node terpisah, karena worker pool-nya butuh file asli untuk `new Worker(path)`, dan kode yang dihasilkan pakai `return` di level atas (buat skip efek samping program sendiri saat file yang sama dijalankan ulang di dalam worker) — sesuatu yang cuma valid di file asli, bukan di `vm.Script`. Lihat `Automatic_Concurrency.md`.

### Kenapa Gatra secepat JavaScript

Gatra **sama cepatnya** dengan JavaScript tulisan tangan. Ini bukan klaim — konsekuensi langsung dari cara kerjanya di atas: Gatra cuma menerjemahkan sintaks ke kode JS yang setara sebelum dijalankan. Tidak ada interpreter tambahan, tidak ada lapisan abstraksi di runtime, tidak ada VM sendiri — V8 menjalankan hasil kompilasinya persis seperti menjalankan JavaScript biasa.

---

# 🧑‍💻 Contoh

Program sederhana:

```gatra
isi nama: teks = "Gatra"

cetak("Halo, ", nama)
```

Fungsi:

```gatra
fungsi tambah(a: angka, b: angka): angka {
    kembali a + b
}

isi hasil = tambah(10, 20)

cetak(hasil)
```

Struktur:

```gatra
struktur Pengguna {
    Nama: teks
    umur: angka
}

isi pengguna = Pengguna {
    Nama: "Budi",
    umur: 25
}

cetak(pengguna.Nama)
```

Kode Gatra dirancang agar dapat dibaca dengan cepat bahkan ketika kita baru pertama kali melihatnya.

---

# 🌱 Untuk Siapa?

Gatra ditujukan untuk siapa saja yang ingin mempelajari atau membangun software dengan bahasa yang lebih dekat dengan Bahasa Indonesia.

### Pemula

Gatra dapat menjadi pintu masuk untuk memahami konsep pemrograman tanpa harus langsung berhadapan dengan banyak istilah sintaks berbahasa Inggris.

### Developer

Developer yang sudah terbiasa dengan JavaScript atau TypeScript dapat menggunakan konsep yang familiar sambil mendapatkan pengalaman dengan sintaks Gatra.

### Pendidikan

Gatra dapat digunakan sebagai media pembelajaran pemrograman dengan bahasa yang lebih dekat dengan bahasa sehari-hari.

### Eksperimen Bahasa

Gatra juga merupakan eksperimen tentang bagaimana sebuah bahasa pemrograman dapat dirancang dengan Bahasa Indonesia sebagai bagian utama dari sintaksnya.

---

# 📚 Roadmap Belajar Gatra

Semua contoh di bawah ada di `examples/belajar/` — jalankan langsung dengan `gatra jalankan examples/belajar/<nama_file>.gatra` dari root proyek. Urutan berikut disusun bertahap, dari dasar sampai fitur paling lanjut.

### Tahap 1 — Dasar Bahasa

| File | Materi |
|---|---|
| `01_variabel.gatra` | Variabel: `isi`, `ubah`, dan inferensi tipe |
| `02_tipe_data.gatra` | Sistem tipe: dasar, opsional, dan `apa_saja` |
| `03_operator.gatra` | Operator aritmatika, perbandingan, logika, dan ternary |
| `04_fungsi.gatra` | Fungsi: parameter, tipe kembalian, default, dan `balik`/`keluar` |
| `05_kontrol_alur.gatra` | `jika`/`lain`/`lain jika`, dan `pilih`/`kasus`/`lain` |
| `06_perulangan.gatra` | `untuk` (range & for-of), `selama`, `berhenti`, `lanjut` |

### Tahap 2 — Struktur Data

| File | Materi |
|---|---|
| `07_struktur.gatra` | Struktur: deklarasi, inisialisasi, akses field, nested, `buat` |
| `08_larik_dan_peta.gatra` | Larik (array) dan Peta (map) |
| `09_teks_interpolasi.gatra` | f-string: interpolasi teks |
| `10_objek_dan_destrukturisasi.gatra` | Literal objek, spread, destrukturisasi |

### Tahap 3 — Fungsi Lanjutan, Method, dan Visibility

| File | Materi |
|---|---|
| `11_fungsi_lanjutan.gatra` | Fungsi anonim, disimpan di variabel, dan sebagai argumen |
| `25_metode.gatra` | Method ber-receiver, gaya Go — `fungsi (h Hewan) sapa()` |
| `26_visibility.gatra` + `26_visibility_modul.gatra` | Visibility identifier gaya Go, termasuk lintas modul |

### Tahap 4 — Error Handling & Pattern Matching

| File | Materi |
|---|---|
| `13_penanganan_galat.gatra` | `coba`/`tangkap`/`akhirnya` |
| `23_hasil_pattern_matching.gatra` | `hasil<T, E>` + `berhasil`/`gagal` + `cocok` |

### Tahap 5 — Tipe & Modul

| File | Materi |
|---|---|
| `14_tipe_alias_dan_ekspor.gatra` | `tipe` (alias tipe) dan visibility (ekspor) |

### Tahap 6 — Asinkron & Observability

| File | Materi |
|---|---|
| `15_asinkron.gatra` | `asinkron`/`tunggu` (async/await) |
| `21_batas_waktu.gatra` | `tunggu expr batas N detik` (timeout untuk Promise) |
| `24_ukur_timing.gatra` | `ukur "label" { ... }` — observability/timing |

### Tahap 7 — Interop JavaScript & Transformasi Data

| File | Materi |
|---|---|
| `20_fondasi_javascript.gatra` | Fondasi kompatibilitas JavaScript — indexing, arrow function, `?.`, `??`, rest params, `javascript{}` escape hatch |
| `22_transformasi_objek.gatra` | `dengan` (transformasi) dan `ubah` (pembaruan immutable) |

### Tahap 8 — Testing Bawaan Bahasa

| File | Materi |
|---|---|
| `19_pengujian.gatra` | `uji`/`pastikan` (pengujian bawaan bahasa) |

### Tahap 9 — Automatic Concurrency (paling lanjut)

| File | Materi |
|---|---|
| `27_paralel_dan_konkurensi.gatra` | `fungsi paralel` — bounded worker pool + adaptive cost-based dispatch, plus Concurrency Safety (ownership/move-checking, closure capture, worker transfer validation, escape hatch `tanpa_periksa`) — Fase 0 dari `Automatic_Concurrency.md` |

---

# 🚀 Mulai Menggunakan Gatra

Untuk mencoba Gatra:

```bash
git clone <url-repository>
cd gatra
npm install
```

Kemudian:

```bash
gatra buat proyek-saya
cd proyek-saya
gatra jalankan utama.gatra
```

### Perintah CLI lainnya

```bash
gatra jalankan <file>                        # Kompilasi dan jalankan file .gatra
gatra bangun <file> [output] [--samar]       # Kompilasi satu file ke .js
gatra bundel <entry> [output] [--samar]      # Bundle semua dependensi ke satu file .js
gatra bangun-proyek <dir> [dist] [--samar]   # Kompilasi seluruh proyek
gatra uji <file>                             # Jalankan blok 'uji' dalam file
gatra periksa <file>                         # Analisis statis (linter)
gatra rapikan <file> [--tulis]               # Format kode (stdout, atau --tulis untuk menimpa file)
gatra versi                                  # Tampilkan versi compiler
gatra bantuan                                # Tampilkan bantuan
```

Gatra tidak punya package manager sendiri — pakai `npm install`/`npm update`/`npm uninstall` langsung untuk dependensi.

# 🤝 Kontribusi

Gatra adalah proyek terbuka.

Ide, diskusi, eksperimen, laporan bug, dan kontribusi kode sangat diterima.

Jika kamu tertarik dengan bahasa pemrograman, compiler, JavaScript, atau ingin melihat bagaimana bahasa pemrograman dengan sintaks Bahasa Indonesia berkembang, silakan ikut berkontribusi.

---

# Gatra

**Pemrograman dengan bahasa yang kita pahami.**

_Sederhana bahasanya. Bersih kodenya. Luas ekosistemnya._
