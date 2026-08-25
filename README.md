# Gatra

> Bahasa pemrograman statically-typed dengan sintaks Bahasa Indonesia, dikompilasi ke JavaScript murni.

Dokumen ini fokus ke dua hal: **cara pakai** Gatra, dan **cara kerjanya di belakang layar**. Untuk pengantar bahasa, contoh kode per fitur, dan tutorial bertahap, lihat [PANDUAN_BELAJAR.md](PANDUAN_BELAJAR.md).

---

# 🚀 Cara Pakai

### Instalasi

```bash
git clone <url-repository>
cd gatra
npm install
```

### Mulai proyek baru

```bash
gatra buat proyek-saya
cd proyek-saya
gatra jalankan utama.gatra
```

`gatra buat` juga menerima `--arch` untuk memilih template: `sederhana` (default), `modular`, `clean`, `hexagonal`, atau `microservice`.

### Belajar sintaksnya

Semua contoh ada di `examples/belajar/`, disusun bertahap dari dasar sampai fitur paling lanjut — jalankan langsung dengan:

```bash
gatra jalankan examples/belajar/<nama_file>.gatra
```

Daftar lengkap file beserta kode dan penjelasannya ada di [PANDUAN_BELAJAR.md](PANDUAN_BELAJAR.md).

### Perintah CLI

Daftar lengkap juga selalu bisa dilihat langsung lewat `gatra bantuan`.

```bash
# Proyek
gatra buat [nama] [--arch <arsitektur>]      # Inisialisasi proyek baru
                                              #   --arch: sederhana | modular | clean | hexagonal | microservice
gatra info                                   # Info proyek (baca gatra.toml)

# Pengembangan
gatra kembangkan [file]                      # Mode dev (watch + restart otomatis)
gatra jalankan <file>                        # Kompilasi dan jalankan file .gatra
gatra uji [file]                             # Jalankan blok 'uji' (proyek jika tanpa argumen)
gatra periksa <file>                         # Analisis statis (linter)
gatra rapikan <file> [--tulis]               # Format kode (stdout, atau --tulis untuk menimpa file)

# Build
gatra bangun <file> [output] [--samar]       # Kompilasi satu file ke .js
gatra bundel <entry> [output] [--samar]      # Bundle semua dependensi ke satu file .js
gatra bangun-proyek <dir> [dist] [--samar]   # Kompilasi seluruh proyek
gatra bersihkan [dir]                        # Hapus artefak build (dist/, .gatra/, .cache/)

# Analisis
gatra graf [file] [--format json|mermaid]    # Dependency graph
gatra jelaskan <file> [fungsi]               # Klasifikasi CPU-bound/I-O-bound & strategi paralelisasi
gatra ukur <file>                            # Benchmark waktu kompilasi & eksekusi
gatra dokter                                 # Diagnostik environment (Node, npm, dll)

# Sistem
gatra versi                                  # Tampilkan versi compiler
gatra bantuan                                # Tampilkan bantuan
```

`--samar` menghasilkan kode yang disamarkan (identifier dienkripsi, string diubah ke unicode) — berguna kalau mau distribusikan hasil build tanpa source `.gatra`-nya.

### Dependensi & konfigurasi proyek

Gatra tidak punya package manager sendiri — dependensi tetap dikelola lewat `npm install`/`npm update`/`npm uninstall` seperti biasa. Konfigurasi per-proyek (nama, versi, arsitektur, entry point, output build) disimpan di `gatra.toml`, dibaca oleh perintah seperti `gatra info`, `gatra bangun-proyek`, dan `gatra bersihkan`.

---

# ⚙️ Arsitektur & Cara Kerja

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

### Struktur compiler (`src/`)

Tiap tahap di pipeline di atas punya folder sendiri, dan di sekitarnya ada beberapa modul pendukung yang dipakai lintas tahap:

```text
src/
├── lexer/        pemecah token — juga tempat kamus keyword Bahasa Indonesia (keywords.js)
├── parser/       penyusun AST dari token, plus pesan galat sintaks yang ramah (errors.js)
├── ast/          definisi bentuk/tipe node AST (dipakai bareng oleh semua tahap lain)
├── typechecker/  validasi tipe, visibility, dan Concurrency Safety (symbol-table.js, type-errors.js)
├── codegen/      AST → kode JavaScript, plus obfuscator.js untuk mode `--samar`
├── runtime/      scheduler.js — bounded worker pool untuk 'fungsi paralel' (Automatic Concurrency)
├── module/       resolusi 'impor' lokal & aturan visibility gaya Go (resolver.js, visibility.js)
├── package/      pendaftaran & pesan galat seputar package/modul (package-registry.js)
├── linter/       analisis statis untuk 'gatra periksa'
├── formatter/    perapi gaya kode untuk 'gatra rapikan'
└── cli/          entry point 'gatra' + semua perintahnya (gatra.js, config.js, graph.js, explain.js)
```

Semua tahap ini murni fungsi/kelas biasa yang dipanggil berurutan — tidak ada state tersembunyi atau proses terpisah, kecuali dua jalur eksekusi khusus di bawah.

### Jalur eksekusi

`gatra jalankan` memilih salah satu dari tiga jalur, tergantung isi file:

- **CommonJS (default)** — dijalankan lewat `vm.Script` di dalam proses Node yang sama (sandbox in-process). Ini jalur untuk kode Gatra biasa.
- **ES Module** — begitu hasil kompilasi mengandung `import`/`export` (misalnya karena pakai `impor ... dari "..."` atau `paket`), Gatra otomatis menulis file `.js` sementara dan menjalankannya lewat proses Node terpisah (`node file.js`), karena `import`/`export` adalah sintaks ES Module asli yang tidak bisa dieksekusi lewat `vm.Script` biasa.
- **`fungsi paralel` (Automatic Concurrency)** — juga ditulis ke file sementara dan dijalankan lewat proses Node terpisah, karena worker pool-nya butuh file asli untuk `new Worker(path)`, dan kode yang dihasilkan pakai `return` di level atas (buat skip efek samping program sendiri saat file yang sama dijalankan ulang di dalam worker) — sesuatu yang cuma valid di file asli, bukan di `vm.Script`. Lihat `Automatic_Concurrency.md`.

### Kenapa Gatra secepat JavaScript

Gatra **sama cepatnya** dengan JavaScript tulisan tangan. Ini bukan klaim — konsekuensi langsung dari cara kerjanya di atas: Gatra cuma menerjemahkan sintaks ke kode JS yang setara sebelum dijalankan. Tidak ada interpreter tambahan, tidak ada lapisan abstraksi di runtime, tidak ada VM sendiri — V8 menjalankan hasil kompilasinya persis seperti menjalankan JavaScript biasa.

### Automatic Concurrency: scheduler & Concurrency Safety

`fungsi paralel` (lihat contoh di [PANDUAN_BELAJAR.md](PANDUAN_BELAJAR.md#27_paralel_dan_konkurensigatra)) tidak langsung berarti "selalu jalan di thread terpisah". Tiap panggilan lewat runtime scheduler (`src/runtime/scheduler.js`):

- Panggilan pertama (cold start) jalan langsung di Event Loop — jalur paling murah selama belum terbukti mahal.
- Kalau rata-rata durasi eksekusi fungsi itu lewat ambang tertentu, panggilan berikutnya otomatis dialihkan ke **worker pool** (dibatasi sejumlah core CPU, maksimal 8). Keputusan ini dievaluasi ulang tiap panggilan, bukan status permanen — begitu beban turun lagi, panggilan berikutnya balik ke Event Loop.
- Kalau worker pool dan antreannya penuh, tugas tetap dijalankan inline — beban di scheduler tidak pernah membuat program berhenti, cuma kehilangan sedikit optimasi.

Supaya "otomatis" ini tetap aman, `typechecker/` melakukan beberapa pemeriksaan statis saat kompilasi (bagian dari `Automatic_Concurrency.md`, Fase 0):

- **Ownership/move-checking** — variabel yang dikirim ke `fungsi paralel` dianggap "dipindah" (moved); memakainya lagi sesudahnya adalah galat kompilasi.
- **Closure capture check** — `fungsi paralel` tidak boleh membaca variabel dari luar fungsinya, karena kalau panggilan itu dieskalasi ke worker, file dijalankan ulang dari awal dan tidak pernah sampai ke deklarasi variabel itu.
- **Worker transfer validation** — struktur yang dikirim ke `fungsi paralel` harus data murni (tidak boleh punya method), karena method/class tidak selamat melewati batas worker.
- **`tanpa_periksa(...)`** — escape hatch eksplisit kalau developer yakin suatu penggunaan aman, tapi tetap harus terlihat jelas di kode, tidak ada "unsafe" yang tersembunyi.

Detail lengkap fase dan rencana lanjutannya ada di `Automatic_Concurrency.md`.
