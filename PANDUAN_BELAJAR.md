# Panduan Belajar Gatra

Dokumen ini membahas seluruh contoh di [`examples/belajar/`](examples/belajar/) satu per satu — kode lengkapnya, dan penjelasan bagian-bagian pentingnya. Disusun bertahap dari dasar bahasa sampai fitur paling lanjut (Automatic Concurrency). Untuk instalasi, perintah CLI, dan arsitektur compiler, lihat [`README.md`](README.md).

Semua contoh bisa langsung dicoba dari root proyek:

```bash
gatra jalankan examples/belajar/<nama_file>.gatra
```

Khusus file yang isinya blok `uji`, jalankan dengan `gatra uji` (lihat bagian file itu masing-masing).

---

## Daftar Isi

- **Tahap 1 — Dasar Bahasa**: [01](#01_variabelgatra) · [02](#02_tipe_datagatra) · [03](#03_operatorgatra) · [04](#04_fungsigatra) · [05](#05_kontrol_alurgatra) · [06](#06_perulangangatra)
- **Tahap 2 — Struktur Data**: [07](#07_strukturgatra) · [08](#08_larik_dan_petagatra) · [09](#09_teks_interpolasigatra) · [10](#10_objek_dan_destrukturisasigatra)
- **Tahap 3 — Fungsi Lanjutan, Method, Visibility**: [11](#11_fungsi_lanjutangatra) · [25](#25_metodegatra) · [26](#26_visibilitygatra--26_visibility_modulgatra)
- **Tahap 4 — Error Handling & Pattern Matching**: [13](#13_penanganan_galatgatra) · [23](#23_hasil_pattern_matchinggatra)
- **Tahap 5 — Tipe & Modul**: [14](#14_tipe_alias_dan_eksporgatra)
- **Tahap 6 — Asinkron & Observability**: [15](#15_asinkrongatra) · [21](#21_batas_waktugatra) · [24](#24_ukur_timinggatra)
- **Tahap 7 — Interop JavaScript & Transformasi Data**: [20](#20_fondasi_javascriptgatra) · [22](#22_transformasi_objekgatra)
- **Tahap 8 — Testing Bawaan Bahasa**: [19](#19_pengujiangatra)
- **Tahap 9 — Automatic Concurrency**: [27](#27_paralel_dan_konkurensigatra)

---

## Tahap 1 — Dasar Bahasa

### `01_variabel.gatra`

📄 [`examples/belajar/01_variabel.gatra`](examples/belajar/01_variabel.gatra)

File paling awal — cara mendeklarasikan variabel, dan bedanya variabel biasa dengan variabel yang boleh diubah.

```gatra
// 01_variabel.gatra — Variabel: isi, ubah, dan inferensi tipe

// 'isi' mendeklarasikan variabel. Tipe boleh eksplisit atau diinferensi.
isi nama: teks = "Handrawan"
isi umur: angka = 25
isi aktif: logika = benar

// Tanpa anotasi tipe — compiler menginferensi dari nilainya.
isi kota = "Jakarta"     // teks
isi tinggi = 172         // angka

cetak(nama)
cetak(umur)
cetak(aktif)
cetak(kota)
cetak(tinggi)

// Variabel biasa ('isi' tanpa 'ubah') tidak boleh ditimpa ulang.
// Untuk variabel yang nilainya bisa berubah, pakai 'isi ubah'.
isi ubah penghitung: angka = 0
penghitung = penghitung + 1
penghitung = penghitung + 1
cetak("penghitung:")
cetak(penghitung)
```

**Yang perlu diperhatikan:**

- `isi nama: teks = "Handrawan"` — deklarasi dengan tipe eksplisit. Sekali diisi, `nama` tidak bisa ditimpa lagi.
- `isi kota = "Jakarta"` — tanpa anotasi tipe sama sekali; compiler menginferensi `kota` bertipe `teks` langsung dari nilainya.
- `isi ubah penghitung: angka = 0` — kata `ubah` inilah yang membuat variabel boleh diisi ulang. Tanpa itu, baris `penghitung = penghitung + 1` galat kompilasi.
- Default di Gatra itu **immutable**, kebalikan dari `let`/`var` JavaScript yang defaultnya bebas diubah. Developer harus sengaja menulis `ubah` kalau memang perlu.

---

### `02_tipe_data.gatra`

📄 [`examples/belajar/02_tipe_data.gatra`](examples/belajar/02_tipe_data.gatra)

Menunjukkan seluruh tipe dasar yang dipunyai Gatra, plus dua tipe khusus: `apa_saja` (escape hatch tanpa pengecekan tipe) dan `T?` (opsional, bisa `kosong`).

```gatra
// 02_tipe_data.gatra — Sistem tipe: dasar, opsional, dan apa_saja

// Tipe dasar
isi t1: teks = "halo"
isi ubah t2: angka = 42          // generik — menerima bilangan, pecahan, byte
isi t3: bilangan = 10       // harus bilangan bulat — 'bilangan = 3.14' GALAT saat kompilasi
isi t4: pecahan = 3.14      // boleh bulat maupun desimal
isi t5: logika = benar
isi t6: byte = 255          // bilangan bulat 0-255 — 'byte = 256' GALAT saat kompilasi
t2 = 31
cetak(t1)
cetak(t2)
cetak(t3)
cetak(t4)
cetak(t5)
cetak(t6)
cetak(t2)

// 'apa_saja' — escape hatch tanpa pemeriksaan tipe (dipakai untuk data dari luar)
isi bebas: apa_saja = "boleh apa saja"
cetak(bebas)

// Opsional (T?) — cara aman merepresentasikan "mungkin tidak ada nilai".
// Hanya tipe opsional yang boleh diisi 'kosong'.
fungsi cariKota(id: angka): teks? {
  jika (id == 1) {
    balik "Jakarta"
  }
  balik kosong
}

isi hasil = cariKota(1)
jika (hasil != kosong) {
  cetak("Ditemukan:")
  cetak(hasil)
} lain {
  cetak("Tidak ditemukan")
}

isi kosongkan = cariKota(99)
jika (kosongkan == kosong) {
  cetak("Sesuai dugaan: kosong")
}

// tiada — tipe kembalian fungsi yang tidak mengembalikan apa-apa
fungsi catat(pesan: teks): tiada {
  cetak(pesan)
}
catat("dicatat")
```

**Yang perlu diperhatikan:**

- Empat tipe angka: `angka` (generik, menerima apa saja yang numerik), `bilangan` (harus bulat), `pecahan` (boleh desimal), `byte` (0-255). `t3: bilangan = 3.14` atau `t6: byte = 256` akan galat *saat kompilasi*, bukan saat dijalankan.
- `teks?` artinya "teks, atau `kosong`". Hanya variabel bertipe opsional (`T?`) yang boleh diisi `kosong` — variabel `teks` biasa tidak boleh.
- `apa_saja` mematikan pengecekan tipe sepenuhnya untuk variabel itu — cocok untuk data yang datang dari luar (hasil parse JSON, response API, dll) yang bentuknya belum pasti.
- `tiada` setara `void` — fungsi yang dipanggil untuk efek sampingnya saja (di sini: `cetak`), bukan untuk nilai baliknya.

---

### `03_operator.gatra`

📄 [`examples/belajar/03_operator.gatra`](examples/belajar/03_operator.gatra)

Kumpulan operator: aritmatika, perbandingan, logika, unary minus, dan bentuk ternary yang terbaca seperti kalimat.

```gatra
// 03_operator.gatra — Operator aritmatika, perbandingan, logika, dan ternary

isi a = 10
isi b = 3

// Aritmatika: + - * /
cetak(a + b)
cetak(a - b)
cetak(a * b)
cetak(a / b)

// Perbandingan: > < >= <= == !=
cetak(a > b)
cetak(a < b)
cetak(a >= 10)
cetak(a <= 9)
cetak(a == 10)
cetak(a != b)

// Logika: && || !
isi x = benar
isi y = salah
cetak(x && y)
cetak(x || y)
cetak(!x)

// Unary minus
isi negatif = -a
cetak(negatif)

// Ternary gaya Python: nilai jika kondisi lain alternatif
isi umur = 20
isi status = "dewasa" jika umur >= 18 lain "anak"
cetak(status)

// String concatenation dengan '+'
isi salam = "Halo, " + "Dunia!"
cetak(salam)
```

**Yang perlu diperhatikan:**

- Operator aritmatika/perbandingan/logika sama persis simbolnya dengan bahasa mainstream lain (`+ - * / > < >= <= == != && || !`) — cuma operand-nya yang bisa berupa keyword Indonesia (`benar`/`salah`).
- Ternary Gatra terbaca seperti kalimat: `"dewasa" jika umur >= 18 lain "anak"` — dibaca "dewasa kalau umur >= 18, kalau tidak anak". Ini gaya Python (`x if cond else y`), bukan gaya `cond ? x : y` ala C/JavaScript.
- `+` di antara dua `teks` melakukan concatenation, bukan penjumlahan — konsisten dengan overloading `+` di kebanyakan bahasa lain.

---

### `04_fungsi.gatra`

📄 [`examples/belajar/04_fungsi.gatra`](examples/belajar/04_fungsi.gatra)

Fokus ke fungsi: parameter dengan nilai default, dua cara mengakhiri fungsi (`balik`/`keluar`), dan rekursi.

```gatra
// 04_fungsi.gatra — Fungsi: parameter, tipe kembalian, default, dan balik/keluar

fungsi tambah(a: angka, b: angka): angka {
  balik a + b
}
cetak(tambah(2, 3))

// Parameter dengan nilai default
fungsi sapa(nama: teks = "Dunia"): teks {
  balik "Halo, " + nama
}
cetak(sapa())
cetak(sapa("Handrawan"))

// 'keluar' adalah alias 'balik' untuk early return
fungsi absolut(n: angka): angka {
  jika (n < 0) {
    keluar -n
  }
  balik n
}
cetak(absolut(-7))
cetak(absolut(7))

// Fungsi rekursif
fungsi faktorial(n: angka): angka {
  jika (n <= 1) {
    balik 1
  }
  balik n * faktorial(n - 1)
}
cetak(faktorial(5))

// Fungsi tanpa nilai kembali eksplisit (void / 'tiada')
fungsi cetakGaris(): tiada {
  cetak("----------")
}
cetakGaris()
```

**Yang perlu diperhatikan:**

- `nama: teks = "Dunia"` — parameter dengan nilai default, dipakai kalau argumennya tidak diisi (`sapa()` tanpa argumen).
- `balik` dan `keluar` fungsinya identik (keduanya "return") — `keluar` biasanya dipakai untuk penekanan gaya "early exit dari kondisi", tapi compiler memperlakukannya sama persis dengan `balik`.
- Rekursi (`faktorial`) bekerja normal — fungsi boleh memanggil dirinya sendiri selama nama sudah dideklarasikan.

---

### `05_kontrol_alur.gatra`

📄 [`examples/belajar/05_kontrol_alur.gatra`](examples/belajar/05_kontrol_alur.gatra)

Dua cara bercabang di Gatra: `jika/lain jika/lain` untuk kondisi boolean berantai, dan `pilih/kasus/lain` untuk mencocokkan satu nilai terhadap beberapa kemungkinan.

```gatra
// 05_kontrol_alur.gatra — jika/lain/lain jika, dan pilih/kasus/lain

isi nilai = 75

jika (nilai >= 90) {
  cetak("A")
} lain jika (nilai >= 80) {
  cetak("B")
} lain jika (nilai >= 70) {
  cetak("C")
} lain {
  cetak("D")
}

// 'pilih' dengan ekspresi — pencocokan nilai (mirip switch), kompile ke if/else if/else
isi hari = 3

pilih hari {
  kasus 1 -> cetak("Senin")
  kasus 2 -> cetak("Selasa")
  kasus 3 -> cetak("Rabu")
  kasus 4 -> cetak("Kamis")
  kasus 5 -> cetak("Jumat")
  lain -> cetak("Akhir pekan")
}

// 'pilih' juga bisa mencocokkan teks
isi peran = "admin"

pilih peran {
  kasus "admin" -> cetak("Akses penuh")
  kasus "editor" -> cetak("Akses edit")
  lain -> cetak("Akses terbatas")
}
```

**Yang perlu diperhatikan:**

- `jika/lain jika/lain` dipakai untuk kondisi yang butuh perbandingan (`>=`, `<`, dst) — bukan sekadar mencocokkan satu nilai persis.
- `pilih ... kasus ... lain` cocok dipakai kalau yang dibandingkan adalah satu nilai terhadap beberapa kemungkinan tetap (angka *atau* teks, seperti dua contoh di atas) — di balik layar tetap dikompilasi jadi rantai if/else biasa, bukan `switch` JavaScript.
- `lain` di dalam `pilih` wajib ada kalau ingin menangani kasus yang tidak tercantum (di contoh: hari di luar 1-5 dianggap "Akhir pekan").

---

### `06_perulangan.gatra`

📄 [`examples/belajar/06_perulangan.gatra`](examples/belajar/06_perulangan.gatra)

Semua bentuk perulangan: range, iterasi larik, kondisi (`selama`), dan kontrol alurnya (`berhenti`/`lanjut`).

```gatra
// 06_perulangan.gatra — untuk (range & for-of), selama, berhenti, lanjut

// 'untuk' dengan rentang: awal..akhir (akhir eksklusif)
untuk i dalam 0..5 {
  cetak(i)
}

// 'untuk' dengan iterasi larik (for-of)
isi buah: teks[] = ["apel", "jeruk", "mangga"]
untuk item dalam buah {
  cetak(item)
}

// 'selama' — perulangan dengan kondisi
isi ubah n: angka = 0
selama (n < 3) {
  cetak("selama:")
  cetak(n)
  n = n + 1
}

// 'berhenti' — keluar dari perulangan lebih awal
untuk i dalam 0..10 {
  jika (i == 4) {
    berhenti
  }
  cetak(i)
}

// 'lanjut' — lompat ke iterasi berikutnya
untuk i dalam 0..5 {
  jika (i == 2) {
    lanjut
  }
  cetak(i)
}
```

**Yang perlu diperhatikan:**

- `0..5` adalah rentang eksklusif di ujung akhir — hasilnya `0, 1, 2, 3, 4`, bukan sampai `5`.
- `untuk item dalam buah` adalah bentuk for-of: `item` langsung berisi elemen larik, bukan indeksnya.
- `selama` (while) butuh kondisi yang dievaluasi ulang tiap putaran — variabel `n` di sini harus dideklarasikan dengan `ubah` karena diisi ulang di dalam loop.
- `berhenti` = `break`, `lanjut` = `continue` — sama persis perilakunya dengan bahasa lain.

---

## Tahap 2 — Struktur Data

### `07_struktur.gatra`

📄 [`examples/belajar/07_struktur.gatra`](examples/belajar/07_struktur.gatra)

Cara mendefinisikan tipe data sendiri lewat `struktur`, termasuk struktur bersarang dan pemakaiannya sebagai parameter/nilai-balik fungsi.

```gatra
// 07_struktur.gatra — Struktur: deklarasi, inisialisasi, akses field, nested, 'buat'

struktur Titik {
  x: angka
  y: angka
}

// Inisialisasi biasa
isi p1 = Titik { x: 3, y: 4 }
cetak(p1)
cetak(p1.x)
cetak(p1.y)

// 'buat' adalah awalan opsional sebelum inisialisasi struktur (mirip 'new')
isi p2 = buat Titik { x: 0, y: 0 }
cetak(p2)

// Struktur bersarang — komposisi, bukan pewarisan (Gatra tidak punya class)
struktur Alamat {
  kota: teks
  kodePos: angka
}

struktur Pengguna {
  nama: teks
  alamat: Alamat
}

isi user = Pengguna {
  nama: "Handrawan",
  alamat: Alamat { kota: "Jakarta", kodePos: 12345 }
}
cetak(user.nama)
cetak(user.alamat.kota)

// Struktur sebagai parameter dan nilai kembali fungsi
fungsi jarakKuadrat(p: Titik): angka {
  balik p.x * p.x + p.y * p.y
}
cetak(jarakKuadrat(p1))
```

**Yang perlu diperhatikan:**

- `Titik { x: 3, y: 4 }` dan `buat Titik { x: 0, y: 0 }` menghasilkan hal yang sama persis — `buat` hanyalah gula sintaksis opsional, mirip `new` di bahasa lain, boleh dipakai atau tidak sesuai selera.
- Gatra tidak punya `kelas`/pewarisan. Struktur bersarang (`Pengguna` punya field `alamat: Alamat`) adalah cara Gatra melakukan komposisi.
- Struktur bisa jadi tipe parameter (`p: Titik`) dan tipe kembalian fungsi seperti tipe primitif biasa.

---

### `08_larik_dan_peta.gatra`

📄 [`examples/belajar/08_larik_dan_peta.gatra`](examples/belajar/08_larik_dan_peta.gatra)

Dua struktur data koleksi: larik (array) dengan dua sintaks tipe yang setara, dan peta (map) berbasis objek.

```gatra
// 08_larik_dan_peta.gatra — Larik (array) dan Peta (map)

// Larik dengan sintaks kurung siku T[]
isi nilai: angka[] = [95, 82, 76, 88, 91]
cetak(nilai)

// Larik dengan sintaks generik larik<T> — setara persis dengan T[]
isi nama: larik<teks> = ["Ana", "Budi", "Citra"]
cetak(nama)

// Larik bersarang (matriks)
isi matriks: angka[][] = [[1, 2, 3], [4, 5, 6]]
cetak(matriks)

// Larik kosong lalu diisi via fungsi
fungsi buatRentang(a: angka, b: angka, c: angka): angka[] {
  balik [a, b, c]
}
cetak(buatRentang(10, 20, 30))

// Iterasi larik (lihat juga 06_perulangan.gatra)
untuk n dalam nilai {
  cetak(n)
}

// Peta<K, V> — direpresentasikan sebagai objek JavaScript biasa
isi skor: peta<teks, angka> = { budi: 90, siti: 95, ana: 88 }
cetak(skor)
cetak(skor.budi)
cetak(skor.siti)

// Peta tanpa anotasi tipe eksplisit (inferensi via literal objek)
isi konfigurasi = { host: "localhost", port: 8080, aktif: benar }
cetak(konfigurasi)
```

**Yang perlu diperhatikan:**

- `angka[]` dan `larik<angka>` adalah dua cara menulis tipe yang sama persis — parser mendesugar `larik<T>` jadi `T[]`, jadi pilih saja mana yang terasa lebih nyaman.
- `angka[][]` = larik dari larik angka (matriks), sesuai kebiasaan penulisan tipe array bersarang.
- `peta<teks, angka>` di-representasikan sebagai objek JavaScript biasa saat dikompilasi — field-nya diakses lewat dot notation (`skor.budi`) sama seperti field struktur.

---

### `09_teks_interpolasi.gatra`

📄 [`examples/belajar/09_teks_interpolasi.gatra`](examples/belajar/09_teks_interpolasi.gatra)

f-string — cara menyisipkan nilai variabel atau ekspresi langsung ke dalam teks, tanpa concatenation manual.

```gatra
// 09_teks_interpolasi.gatra — f-string: interpolasi teks

isi nama = "Handrawan"
isi umur = 25

// f"..." — ekspresi di dalam { } disisipkan ke teks
isi pesan = f"Nama saya {nama}, umur {umur} tahun"
cetak(pesan)

// Ekspresi apapun boleh di dalam { }, termasuk pemanggilan fungsi
fungsi kuadrat(n: angka): angka {
  balik n * n
}
cetak(f"Kuadrat dari 5 adalah {kuadrat(5)}")

// Beberapa interpolasi sekaligus
isi a = 10
isi b = 20
cetak(f"{a} + {b} = {a + b}")
```

**Yang perlu diperhatikan:**

- Awalan `f` sebelum tanda kutip (`f"..."`) menandai string sebagai f-string — tanpa awalan itu, `{ }` di dalam string diperlakukan sebagai teks biasa, bukan interpolasi.
- Isi `{ }` boleh berupa ekspresi apa pun: variabel, pemanggilan fungsi (`kuadrat(5)`), bahkan operasi aritmatika (`a + b`) — bukan cuma nama variabel polos.

---

### `10_objek_dan_destrukturisasi.gatra`

📄 [`examples/belajar/10_objek_dan_destrukturisasi.gatra`](examples/belajar/10_objek_dan_destrukturisasi.gatra)

Literal objek anonim, spread untuk larik/objek, dan destrukturisasi — semuanya terasa familiar buat yang sudah biasa dengan JavaScript modern.

```gatra
// 10_objek_dan_destrukturisasi.gatra — Literal objek, spread, destrukturisasi

// Literal objek anonim
isi titik = { x: 1, y: 2 }
cetak(titik)

// Objek kosong
isi kosongan = {}
cetak(kosongan)

// Spread — menyalin field dari objek/larik lain
isi dasar = { host: "localhost", port: 8080 }
isi override = { ...dasar, port: 9090 }
cetak(override)

isi angka1: angka[] = [1, 2, 3]
isi gabungan = [...angka1, 4, 5]
cetak(gabungan)

// Destrukturisasi objek
isi pengguna = { id: 1, nama: "Ana", aktif: benar }
isi { id, nama } = pengguna
cetak(id)
cetak(nama)

// Destrukturisasi objek dengan penamaan ulang (rename)
isi { nama: namaPengguna } = pengguna
cetak(namaPengguna)

// Destrukturisasi larik
isi pasangan: angka[] = [100, 200]
isi [pertama, kedua] = pasangan
cetak(pertama)
cetak(kedua)
```

**Yang perlu diperhatikan:**

- `{ ...dasar, port: 9090 }` menyalin semua field `dasar` lalu menimpa `port` — pola ini sangat umum untuk membuat objek baru tanpa memodifikasi objek asal.
- `isi { id, nama } = pengguna` langsung membuat dua variabel baru (`id`, `nama`) dari field objek `pengguna` — tidak perlu menulis `pengguna.id` berulang-ulang.
- `isi { nama: namaPengguna } = pengguna` — bentuk rename saat destrukturisasi, field `nama` diambil tapi disimpan dengan nama variabel `namaPengguna`.

---

## Tahap 3 — Fungsi Lanjutan, Method, dan Visibility

### `11_fungsi_lanjutan.gatra`

📄 [`examples/belajar/11_fungsi_lanjutan.gatra`](examples/belajar/11_fungsi_lanjutan.gatra)

Fungsi sebagai nilai — disimpan ke variabel, dikirim sebagai argumen ke fungsi lain, dan dipanggil dengan jumlah argumen dinamis lewat spread.

```gatra
// 11_fungsi_lanjutan.gatra — Fungsi anonim, disimpan di variabel, dan sebagai argumen

// Fungsi anonim disimpan ke variabel
isi kali = fungsi(a: angka, b: angka): angka {
  balik a * b
}
cetak(kali(3, 4))

// Fungsi anonim langsung dipakai sebagai argumen
fungsi terapkan(a: angka, b: angka, operasi: apa_saja): angka {
  balik operasi(a, b)
}
cetak(terapkan(10, 5, fungsi(a: angka, b: angka): angka { balik a + b }))
cetak(terapkan(10, 5, fungsi(a: angka, b: angka): angka { balik a - b }))

// Fungsi dengan argumen jumlah variabel via spread
fungsi jumlahkan(a: angka, b: angka): angka {
  balik a + b
}
isi args: angka[] = [7, 8]
cetak(jumlahkan(...args))
```

**Yang perlu diperhatikan:**

- `fungsi(a: angka, b: angka): angka { ... }` tanpa nama adalah fungsi anonim — bisa langsung disimpan ke variabel (`kali`) atau dikirim langsung sebagai argumen.
- Parameter `operasi: apa_saja` di `terapkan` dipakai karena Gatra belum punya sintaks tipe khusus untuk "sebuah fungsi" sebagai tipe parameter — jadi dilonggarkan lewat `apa_saja`.
- `jumlahkan(...args)` menyebarkan isi larik `args` jadi argumen-argumen terpisah, sama seperti spread argumen di JavaScript.

---

### `25_metode.gatra`

📄 [`examples/belajar/25_metode.gatra`](examples/belajar/25_metode.gatra)

Cara Gatra "menempelkan" perilaku ke struktur tanpa `class` — method ber-receiver, gaya Go.

```gatra
// 25_metode.gatra — method ber-receiver, gaya Go — 'fungsi (h Hewan) sapa()'
//
// Gatra tidak punya 'kelas'. Perilaku dipasang pada 'struktur' lewat fungsi
// terpisah yang punya receiver: fungsi (nama TipeStruktur) namaMetode(...).
// Tidak ada pewarisan — komposisi dipakai lewat field struktur biasa.
//
// Di balik layar, struktur yang punya metode dikompilasi ke class JS asli
// (constructor menyalin field, tiap metode jadi method) — supaya tetap bisa
// dipakai sebagai target decorator framework (mis. NestJS @Controller/@Injectable).

struktur Hewan {
  nama: teks
}

fungsi (h Hewan) sapa(): tiada {
  cetak(h.nama + " bersuara.")
}

struktur Akun {
  saldo: angka
}

fungsi (a Akun) tampilkan(): tiada {
  cetak("Saldo:", a.saldo)
}

fungsi (a Akun) tambah(jumlah: angka): Akun {
  balik Akun { saldo: a.saldo + jumlah }
}

// Komposisi, bukan pewarisan — Kucing "punya" Hewan lewat field biasa.
struktur Kucing {
  hewan: Hewan
  ras: teks
}

fungsi (k Kucing) sapa(): tiada {
  k.hewan.sapa()
  cetak(k.ras)
}

fungsi utama(): tiada {
  isi hewan = Hewan { nama: "Milo" }
  hewan.sapa()

  isi akun = buat Akun { saldo: 100 }
  akun.tampilkan()
  isi akunBaru = akun.tambah(50)
  akunBaru.tampilkan()

  isi kucing = Kucing { hewan: Hewan { nama: "Tom" }, ras: "Persia" }
  kucing.sapa()
}

utama()
```

**Yang perlu diperhatikan:**

- `fungsi (h Hewan) sapa()` — `(h Hewan)` di sini adalah *receiver*: `h` menjadi nama untuk mengakses instance `Hewan` di dalam method (setara `this`/`self`), `sapa` nama methodnya. Sintaks ini persis meniru cara Go menempelkan method ke tipe.
- Tidak ada pewarisan sama sekali — `Kucing` "memiliki" perilaku `Hewan.sapa()` dengan menyimpan `Hewan` sebagai field (`hewan: Hewan`) lalu memanggilnya secara eksplisit (`k.hewan.sapa()`), bukan lewat `extends`.
- `tambah(jumlah: angka): Akun` mengembalikan `Akun` yang baru, bukan mengubah `a.saldo` di tempat — pola ini menjaga struktur tetap immutable.

---

### `26_visibility.gatra` + `26_visibility_modul.gatra`

📄 [`examples/belajar/26_visibility.gatra`](examples/belajar/26_visibility.gatra) · [`examples/belajar/26_visibility_modul.gatra`](examples/belajar/26_visibility_modul.gatra)

Dua file sekaligus untuk menunjukkan visibility (public/private) antar modul — aturannya murni dari huruf awal nama, gaya Go, tanpa keyword `export`/`public`/`private`.

**`26_visibility_modul.gatra`** (modul yang diimpor):

```gatra
// 26_visibility_modul.gatra — modul contoh untuk visibility gaya Go
//
// Tidak butuh 'paket' agar bisa diimpor — 'gatra jalankan' pada modul lain
// yang mengimpornya akan mengompilasi file ini dan meng-export identifier
// publiknya secara otomatis.

fungsi Tambah(a: angka, b: angka): angka {
  balik a + b
}

fungsi validasi(a: angka): logika {
  balik a > 0
}
```

**`26_visibility.gatra`** (yang mengimpor):

```gatra
// 26_visibility.gatra — Visibility identifier gaya Go
//
// Aturan:
//   - Huruf awal BESAR pada nama fungsi/struktur/variabel level modul
//     = publik/terekspor (bisa diimpor modul lain).
//   - Huruf awal kecil = internal/tidak terekspor.
//   - Tidak ada keyword public/private/export khusus — murni dari huruf awal.
//
// 'impor { Nama } dari "path"' mengimpor identifier tertentu secara langsung
// (bukan lewat namespace). Compiler memvalidasi visibility saat kompilasi.

impor { Tambah } dari "./26_visibility_modul.gatra"

cetak(Tambah(10, 20))

// Baris berikut GAGAL dikompilasi kalau di-uncomment, karena 'validasi'
// huruf awalnya kecil (internal) di 26_visibility_modul.gatra:
//
//   impor { validasi } dari "./26_visibility_modul.gatra"
//
// Error yang dihasilkan:
//
//   GALAT AKSES
//   `validasi` tidak dapat diakses dari modul ini.
//   Identifier dengan huruf awal kecil bersifat internal.

// Bentuk namespace ('impor ns dari "path"') juga menegakkan aturan yang sama:
impor modul dari "./26_visibility_modul.gatra"
cetak(modul.Tambah(1, 2))
// modul.validasi(10) — juga GALAT AKSES kalau dipanggil
```

**Yang perlu diperhatikan:**

- `Tambah` (huruf awal besar) otomatis publik dan bisa diimpor; `validasi` (huruf awal kecil) internal dan akan galat kompilasi kalau dipaksa diimpor.
- Tidak perlu keyword `paket` di modul yang diimpor — `gatra jalankan` di sisi pengimpor otomatis mengompilasi file yang diimpor dan meng-export identifier publiknya.
- Dua gaya impor tersedia: `impor { Tambah } dari "path"` (impor identifier langsung) dan `impor modul dari "path"` (impor sebagai namespace, diakses lewat `modul.Tambah`) — keduanya menegakkan aturan visibility yang sama.

---

## Tahap 4 — Error Handling & Pattern Matching

### `13_penanganan_galat.gatra`

📄 [`examples/belajar/13_penanganan_galat.gatra`](examples/belajar/13_penanganan_galat.gatra)

Penanganan galat gaya try/catch/finally klasik: `coba`/`tangkap`/`akhirnya`.

```gatra
// 13_penanganan_galat.gatra — coba/tangkap/akhirnya

fungsi bagi(a: angka, b: angka): angka {
  jika (b == 0) {
    balik 0
  }
  balik a / b
}

coba {
  cetak(bagi(10, 2))
  cetak("blok coba selesai tanpa galat")
} tangkap (e) {
  cetak("terjadi galat:")
  cetak(e)
}

// 'akhirnya' selalu dijalankan, galat atau tidak
coba {
  cetak("mencoba sesuatu")
} tangkap (e) {
  cetak("galat ditangkap")
} akhirnya {
  cetak("selesai, apapun hasilnya")
}

// 'coba' boleh dipakai hanya dengan 'akhirnya' saja (tanpa 'tangkap')
coba {
  cetak("blok tanpa tangkap")
} akhirnya {
  cetak("akhirnya tetap jalan")
}
```

**Yang perlu diperhatikan:**

- `coba { ... } tangkap (e) { ... }` — pemetaan langsung dari `try/catch`, `e` menampung objek galat yang terlempar.
- `akhirnya` selalu dijalankan, baik blok `coba` berhasil maupun galat — cocok untuk cleanup yang wajib jalan.
- `coba { ... } akhirnya { ... }` tanpa `tangkap` sah-sah saja — dipakai kalau memang tidak perlu menangani galatnya di situ, cuma perlu jaminan blok `akhirnya` tetap jalan.

---

### `23_hasil_pattern_matching.gatra`

📄 [`examples/belajar/23_hasil_pattern_matching.gatra`](examples/belajar/23_hasil_pattern_matching.gatra)

Pendekatan eksplisit untuk operasi yang bisa berhasil atau gagal — `hasil<T, E>`, dua konstruktor bawaan `berhasil`/`gagal`, dan `cocok` untuk membongkarnya.

```gatra
// 23_hasil_pattern_matching.gatra — hasil<T,E> + berhasil/gagal + 'cocok'
//
// 'hasil<T,E>' bukan generic asli (belum ada di Gatra) — dua varian bawaan:
// berhasil(nilai) dan gagal(galat), dibongkar lewat 'cocok'.

fungsi bagi(a: angka, b: angka): hasil<angka, teks> {
  jika (b == 0) {
    balik gagal("tidak dapat membagi dengan nol")
  }
  balik berhasil(a / b)
}

isi hasilBagus = bagi(10, 2)
cocok hasilBagus {
  berhasil(nilai) => cetak(nilai)
  gagal(galat) => cetak(galat)
}

isi hasilBuruk = bagi(10, 0)
cocok hasilBuruk {
  berhasil(nilai) => cetak(nilai)
  gagal(galat) => cetak(galat)
}

// 'cocok' boleh cuma satu pola kalau yang lain memang tidak relevan
fungsi asinkron ambilData(): hasil<teks, teks> {
  balik berhasil("data berhasil diambil")
}

fungsi asinkron utama(): tiada {
  isi r = tunggu ambilData()
  cocok r {
    berhasil(data) => cetak(data)
  }
}

utama()
```

**Yang perlu diperhatikan:**

- `hasil<angka, teks>` sebagai tipe kembalian berarti fungsi itu mengembalikan salah satu dari dua kemungkinan: `berhasil(angka)` atau `gagal(teks)` — dipaksa eksplisit sejak tanda tangan fungsi, tidak menunggu exception terlempar saat runtime.
- `cocok ... { berhasil(nilai) => ... gagal(galat) => ... }` membongkar nilai `hasil<T,E>` sekaligus mem-bind isinya ke variabel lokal (`nilai`/`galat`) — mirip pattern matching di bahasa fungsional.
- `hasil<T,E>` di sini adalah dua varian bawaan bahasa, bukan generic user-definable — catatan di komentar file ini sendiri menegaskan Gatra belum punya generic asli di luar konstruk ini.

---

## Tahap 5 — Tipe & Modul

### `14_tipe_alias_dan_ekspor.gatra`

📄 [`examples/belajar/14_tipe_alias_dan_ekspor.gatra`](examples/belajar/14_tipe_alias_dan_ekspor.gatra)

Membuat nama baru untuk tipe yang sudah ada (`tipe`), dan pengingat aturan visibility yang sama dengan Tahap 3.

```gatra
// 14_tipe_alias_dan_ekspor.gatra — 'tipe' (alias tipe) dan visibility (ekspor)

// 'tipe' membuat nama baru untuk tipe yang sudah ada
tipe UserId = angka
tipe Nama = teks

fungsi ambilPengguna(id: UserId): Nama {
  balik "Pengguna-" + f"{id}"
}
cetak(ambilPengguna(7))

// Visibility gaya Go, bukan keyword: huruf awal BESAR pada nama fungsi/
// struktur/variabel level modul = publik/terekspor (bisa diimpor modul
// lain lewat 'impor { TambahDua } dari "./14_tipe_alias_dan_ekspor"'), huruf
// awal kecil = internal (lihat examples/paket_matematika.gatra +
// paket_utama.gatra untuk contoh impor lintas-modul penuh).
fungsi TambahDua(n: angka): angka {
  balik n + 2
}
cetak(TambahDua(40))

// tipe alias untuk tipe opsional
tipe Mungkin = teks?

fungsi cari(ketemu: logika): Mungkin {
  jika (ketemu) {
    balik "ditemukan"
  }
  balik kosong
}
cetak(cari(benar))
cetak(cari(salah))
```

**Yang perlu diperhatikan:**

- `tipe UserId = angka` tidak membuat tipe baru secara struktural — `UserId` tetap `angka` di balik layar, ini murni nama alias supaya tanda tangan fungsi lebih bercerita (`id: UserId` lebih jelas maksudnya daripada `id: angka`).
- Alias bisa dibuat untuk tipe opsional juga: `tipe Mungkin = teks?`.
- Aturan visibility (huruf besar = publik) berlaku sama untuk nama fungsi apa pun di level modul, termasuk fungsi yang memakai tipe alias sebagai parameternya.

---

## Tahap 6 — Asinkron & Observability

### `15_asinkron.gatra`

📄 [`examples/belajar/15_asinkron.gatra`](examples/belajar/15_asinkron.gatra)

Dasar async/await Gatra: `asinkron` menandai fungsi, `tunggu` menunggu hasilnya.

```gatra
// 15_asinkron.gatra — asinkron/tunggu (async/await)

fungsi asinkron ambilData(): angka {
  balik 42
}

fungsi asinkron utama(): tiada {
  isi hasil = tunggu ambilData()
  cetak("hasil:")
  cetak(hasil)
}

utama()

// Beberapa 'tunggu' berurutan di dalam satu fungsi asinkron
fungsi asinkron langkahDemiLangkah(): tiada {
  isi a = tunggu ambilData()
  isi b = tunggu ambilData()
  cetak(a + b)
}
langkahDemiLangkah()
```

**Yang perlu diperhatikan:**

- `fungsi asinkron` dikompilasi langsung jadi `async function` JavaScript, dan `tunggu` jadi `await` — pemetaan satu-satu, tidak ada semantik tambahan.
- `tunggu` cuma boleh dipakai di dalam fungsi `asinkron` (atau di dalam `uji`, lihat Tahap 8) — dipanggil di luar itu galat kompilasi.
- Dua `tunggu` berurutan (`langkahDemiLangkah`) berjalan sekuensial, satu demi satu — bukan paralel (untuk itu, lihat `27_paralel_dan_konkurensi.gatra` di Tahap 9).

---

### `21_batas_waktu.gatra`

📄 [`examples/belajar/21_batas_waktu.gatra`](examples/belajar/21_batas_waktu.gatra)

Menambahkan batas waktu (timeout) ke sebuah ekspresi `tunggu`, tanpa harus menulis `Promise.race` manual.

```gatra
// 21_batas_waktu.gatra — 'tunggu expr batas N detik' (timeout untuk Promise)
//
// Kompile ke: Promise.race([expr, __gatra_batas(N * 1000)])

impor tempo dari "node:timers/promises"

fungsi asinkron ambilCepat(): teks {
  balik "selesai dengan cepat"
}

fungsi asinkron ambilLambat(): teks {
  tunggu tempo.setTimeout(3000)
  balik "akhirnya selesai (3 detik)"
}

fungsi asinkron utama(): tiada {
  // Selesai sebelum batas — hasil normal
  isi cepat = tunggu ambilCepat() batas 5 detik
  cetak(cepat)

  // Lebih lambat dari batas — batas menang, ditangkap sebagai galat
  coba {
    isi lambat = tunggu ambilLambat() batas 1 detik
    cetak(lambat)
  } tangkap (e) {
    cetak("gagal:")
    cetak(e.message)
  }
}

utama()
```

**Yang perlu diperhatikan:**

- `tunggu ekspresi batas N detik` dikompilasi jadi `Promise.race([ekspresi, timer_N_detik])` — siapa pun yang selesai duluan yang menang.
- Kalau batas waktunya yang menang duluan, hasilnya adalah galat (`Error: Timeout`) yang bisa ditangkap normal lewat `coba/tangkap`, seperti galat lainnya.
- `impor tempo dari "node:timers/promises"` menunjukkan Gatra bisa langsung mengimpor modul bawaan Node.js, bukan cuma file `.gatra` lokal.

---

### `24_ukur_timing.gatra`

📄 [`examples/belajar/24_ukur_timing.gatra`](examples/belajar/24_ukur_timing.gatra)

Observability bawaan bahasa — mengukur durasi eksekusi sebuah blok kode tanpa menulis `performance.now()` manual.

```gatra
// 24_ukur_timing.gatra — 'ukur "label" { ... }' — observability/timing
//
// Cetak durasi eksekusi blok ke konsol: "label: Nms". Tetap tercetak
// walau blok 'balik' lebih awal atau melempar galat (dibungkus try/finally).

fungsi asinkron prosesLambat(): tiada {
  isi ubah t: angka = 0
  untuk i dalam 0..10000000 {
    t = t + 1
  }
}

fungsi asinkron utama(): tiada {
  ukur "proses lambat" {
    tunggu prosesLambat()
  }
  cetak("selesai")
}

utama()
```

**Yang perlu diperhatikan:**

- `ukur "label" { ... }` mencetak durasi eksekusi blok itu ke konsol (`label: Nms`) tanpa kode tambahan apa pun dari developer.
- Pengukuran ini dibungkus `try/finally` di balik layar — durasinya tetap tercetak walau blok di dalamnya `balik` lebih awal atau melempar galat, bukan cuma di jalur "sukses".
- Bisa membungkus ekspresi `tunggu` biasa seperti contoh di atas — cocok untuk mengukur operasi asinkron yang lambat.

---

## Tahap 7 — Interop JavaScript & Transformasi Data

### `20_fondasi_javascript.gatra`

📄 [`examples/belajar/20_fondasi_javascript.gatra`](examples/belajar/20_fondasi_javascript.gatra)

File paling "JavaScript" di antara semua contoh — menunjukkan fitur-fitur familiar (indexing, arrow function, `?.`, `??`, rest params) plus escape hatch `javascript { }` untuk kasus yang belum ada sintaksnya di Gatra.

```gatra
// 20_fondasi_javascript.gatra — Fondasi kompatibilitas JavaScript
// indexing, arrow function, ?., ??, rest params, javascript{} escape hatch

// Indexing: obj[key] / larik[i]
isi skor: angka[] = [95, 82, 76]
cetak(skor[0])
skor[0] = 100
cetak(skor[0])

isi kunciNama = "nama"
isi pengguna = { nama: "Budi", umur: 20 }
cetak(pengguna[kunciNama])

// Arrow function — bentuk pendek untuk callback
isi kuadrat = (x) => x * x
cetak(kuadrat(6))

isi daftar: angka[] = [1, 2, 3, 4]
cetak(daftar.map((x) => x * 2))

// Arrow function dengan blok tubuh
isi jumlahkanDua = (a, b) => {
  isi hasil = a + b
  balik hasil
}
cetak(jumlahkanDua(10, 20))

// Optional chaining — akses aman ke properti yang mungkin tidak ada
isi profil: apa_saja = { alamat: { kota: "Jakarta" } }
cetak(profil?.alamat?.kota)
cetak(profil?.telepon?.nomor)

// Nullish coalescing — nilai cadangan hanya jika kosong/undefined
isi namaPengguna: apa_saja = kosong
cetak(namaPengguna ?? "Tanpa Nama")

isi jumlahLogin = 0
cetak(jumlahLogin ?? 99)

// Rest parameter — kumpulkan argumen berlebih jadi larik
fungsi gabung(...bagian) {
  isi ubah hasil = ""
  untuk b dalam bagian {
    hasil = hasil + b
  }
  balik hasil
}
cetak(gabung("a", "b", "c"))

// javascript { } — escape hatch untuk fitur JS yang belum ada syntax-nya
javascript {
  console.log("langsung dari blok javascript {}");
}
cetak("kembali ke Gatra")
```

**Yang perlu diperhatikan:**

- `daftar.map((x) => x * 2)` menunjukkan larik Gatra punya akses langsung ke method array JavaScript (`map`, dan method bawaan lain) — bukan tipe koleksi custom yang terpisah dari dunia JS.
- `profil?.alamat?.kota` (optional chaining) berhenti dengan aman dan menghasilkan `kosong`/`undefined` kalau ada bagian rantai yang tidak ada, bukan melempar galat.
- `namaPengguna ?? "Tanpa Nama"` (nullish coalescing) hanya memakai nilai cadangan kalau `namaPengguna` betul-betul `kosong`/`undefined` — beda dari `||` yang juga menganggap `0`/`""` sebagai "kosong" (`jumlahLogin ?? 99` tetap mencetak `0`, bukan `99`).
- `javascript { ... }` menyisipkan kode JavaScript mentah apa adanya — dipakai kalau ada API/fitur Node.js yang belum punya sintaks Gatra-nya sendiri. Di dalam blok ini, aturan tipe dan sintaks Indonesia Gatra tidak berlaku.

---

### `22_transformasi_objek.gatra`

📄 [`examples/belajar/22_transformasi_objek.gatra`](examples/belajar/22_transformasi_objek.gatra)

Dua cara membuat objek baru dari objek lama tanpa memodifikasinya — `dengan` (bentuk objek baru, field bebas dipilih) dan `ubah` (pembaruan immutable, field lain otomatis dipertahankan).

```gatra
// 22_transformasi_objek.gatra — 'dengan' (transformasi) dan 'ubah' (pembaruan immutable)

isi user = {
  id: 1,
  name: "Budi",
  email: "budi@email.com",
  status: "active"
}

// dengan X { ... } — bentuk objek baru dari X, field boleh diganti nama
// dan dihitung ulang. Field yang tidak disebut TIDAK ikut ke hasil.
isi pengguna = dengan user {
  id
  nama = name
  email
  aktif = status == "active"
}
cetak(pengguna)

// ubah X { field = expr ... } — { ...X, field: expr, ... }
// semua field asli tetap ada, cuma yang disebut yang berubah.
isi profil = { nama: "Andi", umur: 20, kota: "Bandung" }
isi profilBaru = ubah profil {
  nama = "Budi"
  umur = umur + 1
}
cetak(profil)
cetak(profilBaru)
```

**Yang perlu diperhatikan:**

- `dengan user { id \n nama = name \n email \n aktif = status == "active" }` membuat objek **baru dari nol** — field `status` milik `user` yang asli tidak disebut, jadi tidak ikut ke `pengguna`. Field bisa ditulis apa adanya (`id`, `email`) atau dihitung ulang dengan nama baru (`nama = name`, `aktif = status == "active"`).
- `ubah profil { nama = "Budi" \n umur = umur + 1 }` justru sebaliknya — semua field `profil` yang asli tetap ada di hasil, cuma `nama` dan `umur` yang ditimpa. Setara `{ ...profil, nama: "Budi", umur: profil.umur + 1 }`.
- `profil` di baris terakhir tetap tidak berubah (`profilBaru` adalah objek terpisah) — kedua konstruk ini immutable, tidak memodifikasi objek sumbernya.
- Perhatikan `ubah` di sini artinya beda dengan `ubah` di `isi ubah x = ...` (Tahap 1) — kata yang sama, dua makna berbeda tergantung konteks pemakaiannya.

---

## Tahap 8 — Testing Bawaan Bahasa

### `19_pengujian.gatra`

📄 [`examples/belajar/19_pengujian.gatra`](examples/belajar/19_pengujian.gatra)

Testing sebagai bagian dari bahasa itu sendiri, bukan library eksternal — `uji` mendefinisikan kasus uji, `pastikan` adalah assertion-nya.

```gatra
// 19_pengujian.gatra — uji/pastikan (pengujian bawaan bahasa)
//
// Jalankan dengan: gatra uji examples/belajar/19_pengujian.gatra
// (blok 'uji' TIDAK ikut jalan lewat 'gatra jalankan' biasa)

fungsi tambah(a: angka, b: angka): angka {
  balik a + b
}

fungsi faktorial(n: angka): angka {
  jika (n <= 1) {
    balik 1
  }
  balik n * faktorial(n - 1)
}

uji "penjumlahan dasar" {
  pastikan tambah(2, 3) == 5
}

uji "penjumlahan dengan nol" {
  pastikan tambah(5, 0) == 5
}

uji "faktorial dari 5 adalah 120" {
  pastikan faktorial(5) == 120
}

// Bisa memakai 'tunggu' langsung di dalam 'uji' tanpa perlu 'asinkron'
fungsi asinkron ambilAngka(): angka {
  balik 10
}

uji "tunggu di dalam uji" {
  isi hasil = tunggu ambilAngka()
  pastikan hasil == 10
}
```

**Yang perlu diperhatikan:**

- Blok `uji "label" { ... }` **tidak** ikut jalan lewat `gatra jalankan` biasa — harus dijalankan lewat `gatra uji examples/belajar/19_pengujian.gatra` supaya benar-benar dieksekusi.
- `pastikan ekspresi` adalah assertion: kalau `ekspresi` bernilai `salah`, kasus uji itu dianggap gagal.
- Blok `uji` bersifat implicitly async — `tunggu` boleh langsung dipakai di dalamnya tanpa perlu menandai bloknya dengan `asinkron` terlebih dahulu.

---

## Tahap 9 — Automatic Concurrency

### `27_paralel_dan_konkurensi.gatra`

📄 [`examples/belajar/27_paralel_dan_konkurensi.gatra`](examples/belajar/27_paralel_dan_konkurensi.gatra)

Contoh paling lanjut di seluruh roadmap — cara Gatra menjalankan fungsi CPU-berat secara paralel otomatis (`fungsi paralel`), lengkap dengan pemeriksaan keamanan yang dilakukan compiler supaya "otomatis"-nya tidak berujung race condition. Detail lengkap mekanismenya ada di [`Automatic_Concurrency.md`](Automatic_Concurrency.md).

```gatra
// 27_paralel_dan_konkurensi.gatra — 'fungsi paralel' (Automatic Concurrency)
// + Concurrency Safety (ownership/move-checking, closure capture, worker
// transfer validation). Lihat Automatic_Concurrency.md. Fase 0: scheduler
// (bounded worker pool + adaptive cost-based dispatch) dan 4 dari 9 analisis
// statis yang diminta (move/use-after-move, closure capture, worker
// transfer, escape hatch eksplisit). BELUM ada borrow/lifetime checking atau
// general mutable-aliasing analysis di luar itu, dan belum ada model
// single-owner buat matching engine — itu butuh sistem tipe reference/
// lifetime penuh, di luar cakupan fase ini.
//
// Developer cukup tulis 'fungsi paralel', tanpa bikin thread/worker manual.
// Setiap panggilan lewat scheduler runtime (src/runtime/scheduler.js), yang
// mutusin Event Loop atau Worker Pool PER PANGGILAN berdasarkan histori
// durasi eksekusi fungsi itu sendiri — bukan aturan statis "CPU task selalu
// ke worker".

fungsi paralel jumlahkan(n: angka): angka {
  isi ubah total = 0
  isi ubah i = 0
  selama i < n {
    total = total + i
    i = i + 1
  }
  balik total
}

struktur Pesanan {
  jumlah: angka
}

fungsi paralel prosesPesanan(p: Pesanan): angka {
  balik p.jumlah * 2
}

// Closure capture: 'fungsi paralel' TIDAK BOLEH memakai variabel dari luar
// — worker menjalankan ulang file ini dari awal dan gak pernah sampai ke
// baris yang mendeklarasikan variabel itu (lihat komentar genParallelGuard()
// di codegen.js). Baris di bawah akan GALAT compile time kalau di-uncomment:
//
//   isi diskon = 0.1
//   fungsi paralel hitungDiskon(harga: angka): angka {
//     balik harga - (harga * diskon)   // SyntaxError: 'diskon' dari luar tidak boleh dipakai
//   }
//
// Perbaikannya: kirim 'diskon' sebagai parameter, bukan tangkap dari luar.
fungsi paralel hitungDiskonBenar(harga: angka, diskon: angka): angka {
  balik harga - (harga * diskon)
}

fungsi asinkron utama(): tiada {
  // ── Automatic Concurrency: adaptive scheduling ──────────────────────────

  // Panggilan pertama: cold start — belum ada histori, jadi jalan di Event
  // Loop dulu (jalur paling murah selama belum kebukti mahal).
  isi hasilKecil = tunggu jumlahkan(1000)
  cetak(f"jumlahkan(1000) = {hasilKecil}")

  // Panggilan berat berulang: begitu rata-rata durasi ngelewatin ambang
  // (THRESHOLD_MS di scheduler.js), panggilan BERIKUTNYA otomatis lompat ke
  // Worker Pool — programmer gak nulis apa pun buat itu, cuma 'tunggu
  // jumlahkan(...)' polos, persis kayak manggil fungsi asinkron biasa.
  isi ubah i = 0
  selama i < 4 {
    isi hasil = tunggu jumlahkan(2000000000)
    cetak(f"jumlahkan(2000000000) run {i} = {hasil}")
    i = i + 1
  }

  // Adaptive: begitu beban balik ringan, rata-rata durasi turun lagi di
  // bawah ambang, dan panggilan berikutnya otomatis balik ke Event Loop —
  // keputusan itu dievaluasi ulang tiap panggilan, bukan status permanen.
  isi hasilRingan = tunggu jumlahkan(100)
  cetak(f"jumlahkan(100) setelah beban berat = {hasilRingan}")

  // ── Concurrency Safety: ownership transfer ──────────────────────────────

  // Mengirim 'p' ke prosesPesanan() memindahkan (moves) kepemilikannya ke
  // worker/scheduler — 'p' tidak boleh dipakai lagi setelah itu di scope
  // yang sama. Baris ini akan GALAT kalau di-uncomment:
  //
  //   isi p = Pesanan { jumlah: 10 }
  //   tunggu prosesPesanan(p)
  //   cetak(p)   // TypeError: 'p' sudah dipindah (moved) ke 'fungsi paralel' sebelumnya
  //
  // Escape hatch eksplisit (Unsafe Gatra) kalau programmer yakin aman —
  // terlihat jelas di source, bukan diam-diam diizinkan:
  isi p = Pesanan { jumlah: 10 }
  tunggu prosesPesanan(p)
  cetak(f"dibaca lagi lewat tanpa_periksa: {tanpa_periksa(p).jumlah}")

  // ── Concurrency Safety: closure capture ─────────────────────────────────

  isi hasilDiskon = tunggu hitungDiskonBenar(100, 0.1)
  cetak(f"hitungDiskonBenar(100, 0.1) = {hasilDiskon}")
}
utama()
```

**Yang perlu diperhatikan:**

- `fungsi paralel jumlahkan(...)` — cukup tambah kata `paralel`, tidak ada kode thread/worker manual. Scheduler (`src/runtime/scheduler.js`) yang memutuskan tiap panggilan jalan di Event Loop atau di Worker Pool, berdasarkan histori durasi eksekusi fungsi itu sendiri, dievaluasi ulang tiap kali dipanggil (bukan status permanen).
- **Ownership/move-checking**: `p` yang dikirim ke `prosesPesanan(p)` dianggap "dipindah" (moved) — memakainya lagi setelah itu galat kompilasi, kecuali dibungkus eksplisit dengan `tanpa_periksa(p)` seperti di baris terakhir contoh ownership di atas.
- **Closure capture check**: `fungsi paralel` sama sekali tidak boleh membaca variabel dari luar fungsinya (seperti `diskon` di komentar) — karena kalau panggilan itu dieskalasi ke worker, file dijalankan ulang dari awal dan tidak pernah sampai ke baris yang mendeklarasikan variabel tersebut. Solusinya: kirim sebagai parameter (`hitungDiskonBenar(harga, diskon)`), bukan ditangkap dari closure.
- File ini sendiri jujur mengakui keterbatasannya di komentar pembuka: baru 4 dari 9 analisis statis yang direncanakan di `Automatic_Concurrency.md`, belum ada borrow/lifetime checking penuh atau model single-owner untuk kasus seperti matching engine.

---

## Ringkasan Kata Kunci

Tabel cepat semua kata kunci Gatra yang muncul di contoh-contoh di atas, untuk referensi:

| Kata kunci Gatra | Padanan konsep umum |
|---|---|
| `isi` / `isi ubah` | deklarasi variabel (immutable / mutable) |
| `fungsi` / `balik` / `keluar` | function / return / early return |
| `jika` / `lain jika` / `lain` | if / else if / else |
| `pilih` / `kasus` / `lain` | switch / case / default |
| `untuk ... dalam` / `selama` | for-of & range-for / while |
| `berhenti` / `lanjut` | break / continue |
| `struktur` / `buat` | tipe data custom (struct) / `new` (opsional, no-op) |
| `fungsi (x T) metode()` | method ber-receiver, gaya Go |
| `coba` / `tangkap` / `akhirnya` | try / catch / finally |
| `hasil<T,E>` / `berhasil` / `gagal` / `cocok` | Result type & pattern matching |
| `tipe` | type alias |
| `impor` / `dari` / `paket` | import / from / package |
| `asinkron` / `tunggu` | async / await |
| `... batas N detik` | timeout untuk Promise (`Promise.race`) |
| `ukur "label" { }` | timing/observability blok kode |
| `uji` / `pastikan` | test block / assertion |
| `dengan` / `ubah` (transform objek) | bentuk objek baru / pembaruan immutable |
| `javascript { }` | escape hatch kode JavaScript mentah |
| `fungsi paralel` / `tanpa_periksa` | Automatic Concurrency / unsafe escape hatch |
| `ke_teks` / `ke_angka` / `ke_bilangan` / `ke_pecahan` / `ke_byte` / `ke_logika` | konversi tipe eksplisit |

---

Kembali ke [README.md](README.md) untuk gambaran umum bahasa, arsitektur compiler, dan daftar perintah CLI.
