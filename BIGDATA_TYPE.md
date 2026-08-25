# PRD — Gatra Big Data Primitive

**Status:** Draft
**Product:** Gatra Programming Language
**Feature:** Big Data Primitive
**Scope:** Big Data primitive native
**Syntax:** Method chaining menggunakan `.method()`
**Core Abstraction:** `data<T>`

---

## 1. Overview

Gatra membutuhkan primitive native untuk memproses dataset berukuran besar tanpa memperkenalkan abstraction seperti DataFrame.

Primitive utama:

```gatra
data<T>
```

`data<T>` merepresentasikan dataset yang dapat berada di memory, disk, storage, network, maupun distributed environment.

Contoh canonical:

```gatra
isi transaksi = data.baca<Transaksi>(
    "s3://data/transaksi/*.parquet"
)

isi laporan = transaksi
    .saring(.jumlah > 0)
    .pilih(.negara, .jumlah)
    .kelompok(.negara)
    .agregat({
        total: hitung()
        pendapatan: jumlah(.jumlah)
        rata_rata: rata_rata(.jumlah)
    })

laporan.tulis(
    "s3://hasil/laporan.parquet"
)
```

---

# 2. Goals

### 2.1 Primary Goals

Gatra Big Data Primitive harus:

1. Menyediakan abstraction dataset native melalui `data<T>`.
2. Memproses dataset yang lebih besar daripada RAM.
3. Menggunakan lazy execution.
4. Mendukung columnar execution.
5. Mendukung partition dan parallel execution.
6. Memiliki fondasi distributed execution.
7. Mendukung streaming dataset.
8. Tetap type-safe.
9. Memiliki syntax sederhana.
10. Menyembunyikan kompleksitas execution engine dari programmer.

### 2.2 Non-Goals

MVP **tidak bertujuan** menjadi:

- DataFrame API yang ditempelkan ke Gatra.
- SQL replacement.
- General-purpose in-memory collection.
- API yang mengekspos worker atau scheduler secara langsung.
- Abstraction yang mengharuskan programmer memahami execution engine.

---

# 3. Core Concept

## 3.1 Dataset Primitive

```gatra
data<T>
```

Contoh:

```gatra
isi pengguna: data<Pengguna>
```

Atau melalui inference:

```gatra
isi pengguna = data.baca<Pengguna>(
    "pengguna.parquet"
)
```

`data<T>` adalah **dataset**, bukan array.

---

# 4. Dataset vs Collection

Gatra membedakan collection lokal dengan dataset Big Data.

### Collection

```gatra
isi pengguna: larik<Pengguna>
```

Karakteristik:

```text
Data lokal
Memory-oriented
```

### Dataset

```gatra
isi pengguna: data<Pengguna>
```

Karakteristik:

```text
Dataset
Storage / Memory / Disk / Network
Lazy
Potentially larger than RAM
```

`data<T>` harus dapat merepresentasikan dataset yang ukurannya melebihi kapasitas RAM.

---

# 5. Dataset Source

## 5.1 Local File

```gatra
isi pengguna = data.baca<Pengguna>(
    "pengguna.parquet"
)
```

## 5.2 Multiple Files

```gatra
isi transaksi = data.baca<Transaksi>(
    "data/transaksi/*.parquet"
)
```

## 5.3 Object Storage

```gatra
isi transaksi = data.baca<Transaksi>(
    "s3://data/transaksi/*.parquet"
)
```

Storage adapter harus memungkinkan engine membaca dataset secara lazy dan melakukan optimasi seperti projection pushdown dan predicate pushdown.

---

# 6. Streaming Dataset

Untuk dataset yang tidak memiliki akhir:

```gatra
isi kejadian = data.alir<Kejadian>(
    "kafka://events"
)
```

Gatra memiliki dua kategori dataset:

```text
data<T>       → bounded
data.alir<T>  → unbounded
```

### Bounded

```text
Data → Data → Data → END
```

### Unbounded

```text
Data → Data → Data → Data → ...
```

Streaming dataset wajib mendukung backpressure dan checkpoint.

---

# 7. Field Expression

Syntax:

```gatra
.field
```

digunakan sebagai **field reference khusus Big Data expression**.

Contoh:

```gatra
pengguna
    .saring(.umur >= 18)
```

`.umur` berarti:

```text
field "umur" dari setiap record
```

Bukan:

```gatra
pengguna.umur
```

Field reference hanya valid dalam context expression dataset.

Contoh:

```gatra
pengguna
    .saring(.umur >= 18)
    .pilih(.nama, .umur)
    .kelompok(.negara)
```

Compiler menerjemahkan:

```text
.umur
.nama
.negara
```

menjadi column expressions.

---

# 8. Transformation API

## 8.1 Filter

```gatra
.saring()
```

Contoh:

```gatra
isi dewasa = pengguna
    .saring(.umur >= 18)
```

Multiple condition:

```gatra
isi hasil = pengguna
    .saring(.umur >= 18)
    .saring(.aktif == benar)
```

Semantics:

```text
data<T>
    ↓
Filter Expression
    ↓
data<T>
```

---

## 8.2 Projection

```gatra
.pilih()
```

Contoh:

```gatra
isi ringkas = pengguna
    .pilih(.id, .nama, .umur)
```

Projection menghasilkan dataset dengan schema baru.

```text
data<Pengguna>
    ↓
pilih()
    ↓
data<Ringkas>
```

Runtime wajib mendukung **projection pushdown** apabila storage memungkinkan.

---

## 8.3 Transform

```gatra
.ubah()
```

Contoh:

```gatra
isi nama = pengguna
    .ubah(.nama)
```

Transform object:

```gatra
isi ringkas = pengguna
    .ubah({
        nama: .nama
        umur: .umur
    })
```

Semantics:

```text
data<A>
    ↓
ubah()
    ↓
data<B>
```

---

# 9. Analytical API

## 9.1 Grouping

```gatra
.kelompok()
```

Contoh:

```gatra
isi kelompok = transaksi
    .kelompok(.negara)
```

Grouping dapat menyebabkan shuffle pada distributed execution.

---

## 9.2 Aggregation

```gatra
.agregat()
```

Contoh:

```gatra
isi laporan = transaksi
    .kelompok(.negara)
    .agregat({
        total: hitung()
        pendapatan: jumlah(.jumlah)
        rata_rata: rata_rata(.jumlah)
    })
```

Aggregation dasar:

```text
hitung()
jumlah()
rata_rata()
minimum()
maksimum()
```

Runtime dapat melakukan:

```text
Local Aggregate
    ↓
Shuffle
    ↓
Final Aggregate
```

---

## 9.3 Join

```gatra
.gabung()
```

Contoh:

```gatra
isi hasil = transaksi
    .gabung(
        pengguna,
        pada: .pengguna_id == .id
    )
```

Jenis join:

```gatra
.gabung.dalam()
.gabung.kiri()
.gabung.kanan()
.gabung.penuh()
```

Runtime dapat memilih algoritma berdasarkan statistik:

```text
Hash Join
Broadcast Join
Sort-Merge Join
Partitioned Join
```

---

## 9.4 Sorting

```gatra
.urutkan()
```

Ascending:

```gatra
isi hasil = pengguna
    .urutkan(.umur)
```

Descending:

```gatra
isi hasil = pengguna
    .urutkan(.umur, menurun)
```

Dataset yang lebih besar daripada RAM harus menggunakan external sort dan spill-to-disk.

---

# 10. Execution API

## 10.1 Partition

```gatra
.bagi()
```

Berdasarkan field:

```gatra
isi hasil = pengguna
    .bagi(.negara)
```

Berdasarkan jumlah:

```gatra
isi hasil = pengguna
    .bagi(16)
```

Partition digunakan untuk:

- parallel execution;
- distributed execution;
- data locality;
- shuffle reduction.

---

## 10.2 Parallel

```gatra
.paralel()
```

Contoh:

```gatra
isi hasil = transaksi
    .paralel(8)
    .saring(.jumlah > 0)
```

Angka `8` adalah **execution hint**, bukan jaminan jumlah thread.

Runtime tetap menentukan resource aktual.

---

## 10.3 Distributed

```gatra
.terdistribusi()
```

Contoh:

```gatra
isi hasil = transaksi
    .terdistribusi()
    .saring(.jumlah > 0)
    .kelompok(.negara)
    .agregat({
        total: hitung()
    })
```

Developer tidak perlu mengelola worker secara langsung.

---

# 11. Streaming Execution

## 11.1 Window

```gatra
.jendela()
```

Contoh:

```gatra
isi hasil = kejadian
    .jendela(5.menit)
    .agregat({
        total: hitung()
    })
```

Event-time:

```gatra
isi hasil = kejadian
    .jendela({
        durasi: 5.menit
        berdasarkan: .waktu
    })
```

---

## 11.2 Backpressure

Pipeline streaming:

```text
Source
  ↓
Buffer
  ↓
Processor
  ↓
Sink
```

Jika processor lebih lambat daripada source:

```text
Source
  ← Backpressure
```

Tujuannya mencegah pertumbuhan memory yang tidak terbatas.

---

# 12. Materialization

## 12.1 Limit

```gatra
.ambil()
```

Contoh:

```gatra
isi sampel = pengguna
    .ambil(100)
```

Digunakan untuk mengambil subset dataset.

---

## 12.2 Collect

```gatra
.kumpulkan()
```

Contoh:

```gatra
isi hasil = pengguna
    .saring(.aktif == benar)
    .ambil(100)
    .kumpulkan()
```

`kumpulkan()` merupakan boundary antara:

```text
data<T>
    ↓
Local Data
```

Runtime/compiler harus memberikan proteksi apabila hasil materialisasi berpotensi melebihi kapasitas memory.

---

# 13. Output

## 13.1 Write

```gatra
.tulis()
```

Contoh:

```gatra
laporan.tulis(
    "laporan.parquet"
)
```

Object storage:

```gatra
laporan.tulis(
    "s3://hasil/laporan/"
)
```

`kumpulkan()` dan `tulis()` merupakan execution boundary yang menyebabkan lazy execution dijalankan.

---

# 14. Statistics

```gatra
.statistik()
```

Contoh:

```gatra
isi info = transaksi.statistik()
```

Minimal statistics:

```text
baris
ukuran
partisi
nilai_minimum
nilai_maksimum
nilai_kosong
cardinality
```

Statistics digunakan optimizer untuk menentukan physical execution plan.

---

# 15. Lazy Execution

Pipeline:

```gatra
isi hasil = transaksi
    .saring(.jumlah > 100)
    .pilih(.negara, .jumlah)
    .kelompok(.negara)
```

Pipeline di atas **tidak langsung dieksekusi**.

Gatra membangun:

```text
Logical Plan
    ↓
Optimizer
    ↓
Physical Plan
```

Execution terjadi ketika mencapai execution boundary:

```gatra
hasil.tulis("hasil.parquet")
```

atau:

```gatra
hasil.kumpulkan()
```

---

# 16. Query Optimizer

Optimizer wajib mendukung:

```text
Predicate Pushdown
Projection Pushdown
Partition Pruning
Operator Fusion
Aggregation Optimization
Join Optimization
```

Contoh:

```gatra
transaksi
    .saring(.jumlah > 100)
    .pilih(.negara, .jumlah)
```

Tidak boleh selalu dieksekusi sebagai:

```text
Read All Columns
    ↓
Read All Rows
    ↓
Filter
    ↓
Projection
```

Jika storage mendukung optimasi, engine harus melakukan:

```text
Read Required Columns
    ↓
Predicate Pushdown
    ↓
Result
```

---

# 17. Columnar Execution

`data<T>` harus mendukung columnar representation.

Contoh:

```text
jumlah:
[100, 250, 300, 500, ...]
```

bukan bergantung pada representasi row-oriented:

```text
Transaksi
Transaksi
Transaksi
Transaksi
```

Tujuan:

- vectorized execution;
- SIMD;
- cache locality;
- memory efficiency;
- high throughput.

---

# 18. Spill-to-Disk

Intermediate data tidak boleh bergantung sepenuhnya pada RAM.

Ketika memory mencapai limit:

```text
Memory
  ↓
Limit
  ↓
Spill
  ↓
Disk
```

Contoh operasi:

```gatra
transaksi
    .urutkan(.jumlah)
```

harus tetap dapat bekerja ketika dataset lebih besar daripada memory.

---

# 19. Fault Tolerance

Distributed dataset harus mendukung:

```text
Retry
Checkpoint
Recovery
```

Jika worker gagal:

```text
Worker
  ↓
FAIL
  ↓
Scheduler
  ↓
Retry Partition
  ↓
Worker lain
```

Runtime harus mampu melanjutkan execution tanpa mengubah semantics program.

---

# 20. Consistent Semantics

Pipeline:

```gatra
transaksi
    .saring(.jumlah > 0)
    .kelompok(.negara)
    .agregat({
        total: hitung()
    })
```

harus memiliki semantics yang sama pada:

```text
1 worker
4 worker
16 worker
100 worker
```

Runtime bebas mengubah execution plan tanpa mengubah hasil yang secara semantik diharapkan program.

---

# 21. API Surface MVP

API Big Data primitive harus tetap kecil.

### Source

```text
data.baca()
data.alir()
```

### Transformation

```text
.saring()
.ubah()
.pilih()
```

### Analytical

```text
.kelompok()
.agregat()
.gabung()
.urutkan()
```

### Execution

```text
.bagi()
.paralel()
.terdistribusi()
```

### Streaming

```text
.jendela()
```

### Materialization

```text
.ambil()
.kumpulkan()
```

### Metadata

```text
.statistik()
```

### Output

```text
.tulis()
```

---

# 22. Canonical Syntax

Syntax resmi yang direkomendasikan:

```gatra
isi transaksi = data.baca<Transaksi>(
    "s3://data/transaksi/*.parquet"
)

isi laporan = transaksi
    .saring(.jumlah > 0)
    .pilih(
        .negara,
        .jumlah
    )
    .kelompok(.negara)
    .agregat({
        total: hitung()
        pendapatan: jumlah(.jumlah)
        rata_rata: rata_rata(.jumlah)
    })

laporan.tulis(
    "s3://hasil/laporan.parquet"
)
```

Streaming:

```gatra
isi kejadian = data.alir<Kejadian>(
    "kafka://events"
)

kejadian
    .saring(.jenis == "pembayaran")
    .jendela(5.menit)
    .agregat({
        total: hitung()
        nilai: jumlah(.jumlah)
    })
    .tulis("s3://hasil/pembayaran/")
```

---

# 23. Syntax Rules

Big Data syntax mengikuti pola:

```text
dataset
    .operasi(argument)
    .operasi(argument)
    .operasi(argument)
```

Field reference:

```text
.nama
.umur
.negara
.jumlah
```

Rules:

1. Tidak menggunakan `|>`.
2. Semua operasi menggunakan `.method()`.
3. Field reference menggunakan `.field`.
4. `.field` hanya valid dalam Big Data expression context.
5. Method chaining dapat dilakukan tanpa intermediate variable.
6. Dataset tetap bersifat lazy sampai execution boundary.

---

# 24. Runtime Architecture

```text
                    Gatra
                      │
                      ▼
                   data<T>
                      │
                      ▼
              Logical Dataset
                      │
                      ▼
                Logical Plan
                      │
                      ▼
                  Optimizer
                      │
                      ▼
                Physical Plan
                      │
             ┌────────┼────────┐
             ▼        ▼        ▼
           Local   Parallel Distributed
             │        │        │
             └────────┼────────┘
                      ▼
                 Data Engine
                      │
             ┌────────┼────────┐
             ▼        ▼        ▼
         Columnar    SIMD    Storage
```

---

# 25. Node.js Runtime Architecture

Node.js tetap menjadi core runtime Gatra.

Namun V8 **bukan tempat utama pemrosesan Big Data**.

Arsitektur:

```text
Gatra
  ↓
Gatra Compiler / Runtime
  ↓
Node.js / V8
  ↓
FFI / N-API
  ↓
Native Big Data Engine
```

Node.js bertanggung jawab atas:

- runtime;
- async I/O;
- networking;
- module ecosystem;
- orchestration.

Native Big Data Engine bertanggung jawab atas:

- columnar memory;
- vectorized execution;
- aggregation;
- sorting;
- partition;
- shuffle;
- spill-to-disk;
- SIMD.

---

# 26. Recommended Native Engine

Arsitektur implementasi yang direkomendasikan:

```text
Gatra Source
     ↓
Gatra Compiler / Runtime
     ↓
Node.js / V8
     ↓
FFI / N-API
     ↓
Rust Big Data Engine
     ↓
┌─────────────────────────────┐
│ Columnar Memory             │
│ Vectorized Execution        │
│ Parallel Execution          │
│ SIMD                        │
│ Hash Join                   │
│ Aggregation                 │
│ Sort                        │
│ Spill-to-Disk               │
│ Parquet                     │
└─────────────────────────────┘
```

Node.js berfungsi sebagai orchestration/runtime layer, sedangkan workload Big Data yang CPU- dan memory-intensive dipindahkan ke native engine.

---

# 27. Roadmap

## Phase 1 — Dataset

```text
data<T>
data.baca()
.tulis()
```

## Phase 2 — Lazy Processing

```text
.saring()
.ubah()
.pilih()
```

## Phase 3 — Analytics

```text
.kelompok()
.agregat()
.gabung()
.urutkan()
```

## Phase 4 — Columnar Engine

```text
Columnar
Vectorization
Memory Management
Spill-to-Disk
```

## Phase 5 — Parallel

```text
.bagi()
.paralel()
```

## Phase 6 — Streaming

```text
data.alir()
.jendela()
Backpressure
Checkpoint
```

## Phase 7 — Distributed

```text
.terdistribusi()
Scheduler
Worker
Shuffle
Retry
Recovery
```

---

# 28. Acceptance Criteria

## Primitive

- [ ] `data<T>` tersedia sebagai primitive.
- [ ] `data<T>` dapat merepresentasikan dataset yang lebih besar daripada RAM.
- [ ] `data<T>` bersifat lazy.
- [ ] `data<T>` mendukung bounded dataset.
- [ ] `data.alir<T>` mendukung unbounded dataset.

## Syntax

- [ ] Tidak menggunakan `|>`.
- [ ] Semua operasi menggunakan `.method()`.
- [ ] Field reference menggunakan `.field`.
- [ ] Field reference hanya berlaku dalam Big Data expression.
- [ ] Method chaining dapat dilakukan tanpa intermediate variable.

## Processing

- [ ] `.saring()`
- [ ] `.ubah()`
- [ ] `.pilih()`
- [ ] `.kelompok()`
- [ ] `.agregat()`
- [ ] `.gabung()`
- [ ] `.urutkan()`

## Execution

- [ ] `.bagi()`
- [ ] `.paralel()`
- [ ] `.terdistribusi()`
- [ ] Columnar execution.
- [ ] Vectorized execution.
- [ ] Spill-to-disk.
- [ ] Lazy logical plan.
- [ ] Physical plan optimizer.

## Storage

- [ ] Parquet read.
- [ ] Parquet write.
- [ ] Local file.
- [ ] Object storage.

## Streaming

- [ ] `data.alir()`
- [ ] `.jendela()`
- [ ] Backpressure.
- [ ] Checkpoint.

## Reliability

- [ ] Retry.
- [ ] Recovery.
- [ ] Distributed execution memiliki semantics yang konsisten.

---

# 29. Design Principles

Gatra Big Data Primitive **bukan DataFrame API yang ditempelkan ke bahasa**.

Model fundamental:

```text
                 data<T>
                    │
                    ▼
             Logical Dataset
                    │
                    ▼
             Lazy Operations
                    │
                    ▼
              Query Planner
                    │
                    ▼
                Optimizer
                    │
                    ▼
           Columnar Data Engine
                    │
          ┌─────────┼─────────┐
          ▼         ▼         ▼
        Local    Parallel  Distributed
```

Developer hanya berinteraksi dengan dataset dan operasi sederhana.

Kompleksitas seperti:

- partitioning;
- scheduling;
- vectorization;
- memory management;
- shuffle;
- join strategy;
- spill;
- worker;
- recovery;

ditangani oleh runtime dan data engine.

---

# 30. Final Definition

`data<T>` adalah **native Big Data primitive Gatra**.

`.field` adalah **field expression khusus dataset**.

`.method()` adalah **API operasi dataset**.

Method chaining hanya membangun **execution plan**, bukan langsung menjalankan processing.

Execution terjadi pada boundary seperti:

```gatra
.tulis()
```

atau:

```gatra
.kumpulkan()
```

Arsitektur akhirnya:

```text
Gatra Syntax
     ↓
data<T>
     ↓
Logical Dataset
     ↓
Lazy Operations
     ↓
Query Planner
     ↓
Optimizer
     ↓
Native Columnar Engine
     ↓
Local / Parallel / Distributed
```

Node.js tugasnya apa?

Node.js/V8:

Gatra parser
Gatra runtime
Module system
Async I/O
Networking
API
Orchestration

Rust:

Filter
Projection
Aggregation
Join
Sort
Group By
Partition
Shuffle
Columnar execution
SIMD
Memory management
Spill

Dengan demikian Gatra mempertahankan syntax yang sederhana dan mudah dibaca, tetapi memiliki fondasi runtime yang dapat berkembang dari pemrosesan lokal hingga Big Data distributed execution.
