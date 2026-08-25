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
- Big Data primitive
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

### 📊 Big Data

Gatra juga dirancang dengan perhatian terhadap pengolahan data dalam jumlah besar.

Primitive:

```text
data<T>
```

menjadi fondasi untuk pengolahan data menggunakan pendekatan yang lebih deklaratif dan dapat dioptimalkan.

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

# 🤝 Kontribusi

Gatra adalah proyek terbuka.

Ide, diskusi, eksperimen, laporan bug, dan kontribusi kode sangat diterima.

Jika kamu tertarik dengan bahasa pemrograman, compiler, JavaScript, atau ingin melihat bagaimana bahasa pemrograman dengan sintaks Bahasa Indonesia berkembang, silakan ikut berkontribusi.

---

# Gatra

**Pemrograman dengan bahasa yang kita pahami.**

_Sederhana bahasanya. Bersih kodenya. Luas ekosistemnya._
