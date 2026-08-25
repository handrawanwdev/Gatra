# PRD — Gatra Automatic Parallel Execution

**Status:** Draft
**Product:** Gatra Programming Language
**Feature:** Automatic Parallel Execution
**Scope:** Runtime-managed CPU and Big Data execution
**Core Principle:** **Write Sequential, Execute Parallel**

---

# 1. Overview

Node.js secara default menjalankan JavaScript pada event loop utama. Operasi CPU-intensive yang dilakukan secara langsung dapat memblokir event loop.

Gatra harus menyembunyikan kompleksitas tersebut dari programmer.

Programmer cukup menulis kode secara sederhana dan sequential:

```gatra
isi laporan = transaksi
    .saring(.jumlah > 100)
    .kelompok(.negara)
    .agregat({
        total: hitung()
        pendapatan: jumlah(.jumlah)
    })

laporan.tulis("laporan.parquet")
```

Runtime Gatra secara otomatis menentukan bagaimana pekerjaan dieksekusi:

```text
Gatra
  ↓
Execution Planner
  ↓
Cost Estimator
  ↓
Execution Decision
  ├── V8
  ├── Node.js Async I/O
  └── Rust Native Engine
          ↓
      Thread Pool
          ↓
      Multiple CPU Cores
```

Programmer **tidak diwajibkan mengelola thread, worker, process, scheduler, atau CPU core secara manual.**

---

# 2. Goals

## 2.1 Primary Goals

Gatra Automatic Parallel Execution harus:

1. Mencegah pekerjaan CPU-intensive memblokir event loop.
2. Memindahkan pekerjaan berat ke native engine secara otomatis.
3. Memanfaatkan multiple CPU cores secara otomatis.
4. Mempertahankan syntax sequential yang sederhana.
5. Menyembunyikan kompleksitas threading dari programmer.
6. Menggunakan Rust untuk CPU-intensive execution.
7. Mendukung parallel execution untuk Big Data primitive.
8. Menjaga semantics program tetap konsisten.
9. Menyesuaikan tingkat parallelism dengan resource yang tersedia.
10. Memungkinkan runtime melakukan optimasi tanpa perubahan source code.

---

# 3. Non-Goals

Feature ini **tidak bertujuan** untuk:

- Membuat programmer mengelola thread secara manual.
- Membuat setiap operasi Gatra menjadi parallel.
- Memaksa semua pekerjaan menggunakan Rust.
- Menghilangkan Node.js event loop.
- Menjamin jumlah thread tertentu.
- Mengekspos scheduler internal sebagai API utama.
- Membuat `.paralel()` sebagai requirement untuk mendapatkan parallel execution.

---

# 4. Core Principle

Gatra menggunakan prinsip:

> **Write Sequential, Execute Parallel.**

Kode:

```gatra
isi hasil = transaksi
    .saring(.jumlah > 100)
    .kelompok(.negara)
    .agregat({
        total: hitung()
    })
```

secara semantic tetap sequential.

Namun execution engine dapat menjalankannya:

```text
Scan
  ↓
Partition
  ↓
┌──────┬──────┬──────┬──────┐
│ CPU1 │ CPU2 │ CPU3 │ CPU4 │
└──────┴──────┴──────┴──────┘
  ↓
Local Aggregate
  ↓
Merge
  ↓
Result
```

Perubahan strategi execution tidak boleh mengubah semantics program.

---

# 5. Execution Classification

Runtime harus mengklasifikasikan pekerjaan berdasarkan karakteristiknya.

## 5.1 Lightweight Execution

Contoh:

```text
String operation
Simple arithmetic
Small collection
Small object transformation
```

Dapat dijalankan oleh:

```text
V8
```

---

## 5.2 Async I/O

Contoh:

```text
HTTP request
File read
Network request
Database request
```

Dijalankan menggunakan:

```text
Node.js Async I/O
```

---

## 5.3 CPU Intensive

Contoh:

```text
Large aggregation
Large sorting
Hash join
Compression
Decompression
Large transformation
```

Diarahkan ke:

```text
Rust Native Engine
```

---

## 5.4 Big Data

Contoh:

```text
Dataset > RAM
Large Parquet scan
Columnar processing
Large group-by
Large join
Large sort
```

Diarahkan ke:

```text
Rust Big Data Engine
```

---

# 6. Automatic Execution Decision

Runtime melakukan:

```text
Operation
    ↓
Analyze
    ↓
Statistics
    ↓
Cost Estimation
    ↓
Execution Decision
```

Faktor yang dapat dipertimbangkan:

```text
Dataset size
Estimated row count
Column count
Operation complexity
Memory requirement
CPU cost
Partition count
Available CPU cores
Available memory
Storage characteristics
```

Contoh:

```text
100 rows
 ↓
Filter
 ↓
V8
```

Sedangkan:

```text
10 billion rows
 ↓
Filter
 ↓
Group
 ↓
Aggregate
 ↓
Rust Parallel Engine
```

---

# 7. Runtime Architecture

```text
                     Gatra
                       │
                       ▼
               Gatra Compiler
                       │
                       ▼
                Gatra Runtime
                       │
                       ▼
                Logical Plan
                       │
                       ▼
                 Optimizer
                       │
                       ▼
                Cost Estimator
                       │
              ┌────────┴────────┐
              ▼                 ▼
        Lightweight          Heavy Work
              │                 │
              ▼                 ▼
           Node/V8          Rust Engine
                                │
                       ┌────────┼────────┐
                       ▼        ▼        ▼
                    Threads    SIMD    Native Memory
                       │
                       ▼
                      CPU
```

---

# 8. Node.js Responsibility

Node.js tetap menjadi core runtime Gatra.

Node.js bertanggung jawab atas:

```text
Gatra Runtime
Parser / Compiler integration
Module System
Async I/O
Networking
API
Orchestration
Execution coordination
```

Node.js **tidak menjadi tempat utama untuk heavy Big Data computation.**

---

# 9. Rust Responsibility

Rust menjadi native execution engine.

Rust bertanggung jawab atas:

```text
Filter
Projection
Transformation
Aggregation
Group By
Join
Sort
Partition
Shuffle
Columnar Execution
Vectorized Execution
SIMD
Memory Management
Spill-to-Disk
Parallel Execution
```

---

# 10. FFI Boundary

Gatra menggunakan:

```text
Node.js
   ↓
N-API
   ↓
Rust
```

FFI tidak boleh digunakan untuk setiap record atau setiap operasi kecil.

### Tidak diperbolehkan

```text
Row
 ↓
FFI
 ↓
Rust

Row
 ↓
FFI
 ↓
Rust

Row
 ↓
FFI
 ↓
Rust
```

### Recommended

```text
Execution Plan
      ↓
     FFI
      ↓
Rust Engine
      ↓
Native Execution
      ↓
Result
```

Dengan demikian overhead FFI tetap rendah.

---

# 11. Execution Plan

Gatra mengubah pipeline menjadi logical plan.

Contoh:

```gatra
transaksi
    .saring(.jumlah > 100)
    .kelompok(.negara)
    .agregat({
        total: hitung()
    })
```

Menjadi:

```text
Logical Plan

SCAN transaksi
    ↓
FILTER jumlah > 100
    ↓
GROUP BY negara
    ↓
COUNT
```

Optimizer kemudian menghasilkan:

```text
Physical Plan

Parquet Scan
    ↓
Predicate Pushdown
    ↓
Partition
    ↓
Parallel Filter
    ↓
Local Aggregate
    ↓
Merge Aggregate
```

Plan dikirim ke Rust melalui FFI.

---

# 12. Automatic Thread Pool

Rust engine memiliki internal thread pool.

Runtime menentukan jumlah execution workers berdasarkan:

```text
Available CPU
Memory
Dataset size
Operation cost
System load
```

Contoh:

```text
Machine
CPU = 16 cores

Dataset
= 1 TB

Runtime
↓
Partition = 16
↓
Worker pool
↓
CPU cores utilized automatically
```

Runtime **tidak menjamin** seluruh core selalu digunakan.

Tujuannya adalah penggunaan resource yang optimal, bukan sekadar penggunaan CPU maksimum.

---

# 13. Adaptive Parallelism

Parallelism harus bersifat adaptive.

Contoh:

```text
Dataset kecil
↓
Single execution
```

```text
Dataset medium
↓
4 workers
```

```text
Dataset besar
↓
8 workers
```

```text
Dataset sangat besar
↓
16 workers
```

Jumlah tersebut hanya contoh.

Runtime bebas memilih strategi aktual.

---

# 14. Automatic Partitioning

Untuk Big Data:

```text
Dataset
   ↓
Partitioner
   ↓
P1
P2
P3
P4
...
```

Kemudian:

```text
P1 → Worker 1
P2 → Worker 2
P3 → Worker 3
P4 → Worker 4
```

Partitioning harus mempertimbangkan:

```text
Data size
Partition size
Data locality
CPU availability
Memory availability
Storage characteristics
```

---

# 15. Event Loop Protection

Heavy computation tidak boleh menyebabkan:

```text
Node.js Event Loop
        ↓
Heavy computation
        ↓
BLOCKED
```

Sebaliknya:

```text
Node.js Event Loop
        │
        │ submit
        ▼
Rust Engine
        │
        ├── Worker 1
        ├── Worker 2
        ├── Worker 3
        └── Worker 4
        │
        ▼
Result
        │
        ▼
Node.js Event Loop
```

Event loop tetap tersedia untuk:

```text
HTTP
Timer
Network
Other async operations
```

---

# 16. Memory Isolation

Heavy Big Data processing tidak boleh mematerialisasi seluruh dataset menjadi JavaScript objects.

Tidak diperbolehkan:

```text
Parquet
 ↓
Millions JS Objects
 ↓
V8 Heap
```

Recommended:

```text
Parquet
 ↓
Arrow / Columnar Memory
 ↓
Rust Native Memory
 ↓
Parallel Execution
```

Node.js hanya menerima:

```text
Metadata
Execution Result
Small Materialized Result
```

sesuai kebutuhan.

---

# 17. Automatic Spill

Jika memory tidak mencukupi:

```text
Native Memory
     ↓
Memory Limit
     ↓
Spill
     ↓
Disk
     ↓
Continue Execution
```

Contoh:

```gatra
isi hasil = transaksi
    .urutkan(.jumlah)

hasil.tulis("hasil.parquet")
```

Dataset 500 GB harus dapat diproses pada mesin dengan RAM 32 GB jika physical operation memungkinkan penggunaan external sort/spill.

---

# 18. Backpressure

Automatic parallelism tidak boleh menyebabkan producer menghasilkan data lebih cepat daripada kemampuan processor.

Pipeline:

```text
Source
  ↓
Buffer
  ↓
Parallel Workers
  ↓
Sink
```

Jika worker penuh:

```text
Source
  ↓
Backpressure
```

Runtime harus mengontrol:

```text
Queue size
Buffer size
Worker capacity
Memory limit
```

---

# 19. `.paralel()` sebagai Execution Hint

API:

```gatra
.paralel(8)
```

tidak menjadi mekanisme threading manual.

Semantics:

> Meminta runtime mempertimbangkan execution dengan concurrency sekitar 8 lane.

Runtime tetap dapat memilih:

```text
4
8
12
16
```

berdasarkan resource dan optimizer.

---

# 20. Automatic Mode

Default Gatra:

```text
Automatic Parallel Execution = ON
```

Programmer cukup:

```gatra
isi hasil = transaksi
    .saring(.jumlah > 0)
    .kelompok(.negara)
    .agregat({
        total: hitung()
    })
```

Runtime otomatis menentukan:

```text
V8
atau
Rust
atau
Rust Parallel
atau
Rust Spill
```

---

# 21. Manual Override

Advanced programmer dapat memberikan hint jika diperlukan.

Contoh:

```gatra
.paralel(8)
```

Namun API manual tidak boleh mengontrol:

```text
thread creation
thread lifecycle
worker creation
scheduler lifecycle
CPU affinity
```

Detail tersebut tetap menjadi tanggung jawab runtime.

---

# 22. Error Handling

Jika native worker mengalami error:

```text
Rust Worker
    ↓
Error
    ↓
Execution Manager
    ↓
Gatra Error
```

Error harus dapat dikembalikan ke Gatra secara aman.

Contoh:

```text
BigDataError
MemoryLimitError
StorageError
ExecutionError
PartitionError
SerializationError
```

Runtime tidak boleh menyebabkan crash Node.js hanya karena kesalahan operasi Big Data.

---

# 23. Cancellation

Program harus dapat menghentikan execution.

Concept:

```text
Execution
   ↓
Cancellation Request
   ↓
Execution Manager
   ↓
Rust Workers
   ↓
Stop Safely
   ↓
Cleanup
```

Resource yang harus dibersihkan:

```text
Memory
Temporary files
Buffers
Partitions
Worker tasks
Network connections
```

---

# 24. Observability

Runtime harus menyediakan informasi execution.

Contoh:

```gatra
hasil.jelaskan()
```

Output:

```text
Execution Plan
────────────────────
Source: transaksi.parquet

Workers: 8
Partitions: 32

Operators:
  Scan
  Filter
  GroupBy
  Aggregate

Execution:
  Parallel: yes
  SIMD: yes
  Spill: no
```

Untuk debugging performance:

```gatra
hasil.statistik()
```

dapat memberikan:

```text
rows
partitions
memory
execution_time
workers
bytes_read
bytes_written
spilled_bytes
```

---

# 25. Semantic Guarantee

Kode:

```gatra
transaksi
    .saring(.jumlah > 0)
    .kelompok(.negara)
    .agregat({
        total: hitung()
    })
```

harus memiliki semantics yang konsisten pada:

```text
1 worker
4 workers
8 workers
16 workers
```

Runtime boleh mengubah:

```text
Partition strategy
Thread count
Execution order
Physical operator
Join algorithm
Memory strategy
```

selama semantics program tetap benar.

---

# 26. API Surface

Feature ini **tidak membutuhkan API threading baru** untuk penggunaan normal.

Default:

```text
Automatic
```

Optional hint:

```text
.paralel()
```

Diagnostics:

```text
.jelaskan()
.statistik()
```

Developer tidak perlu menggunakan:

```text
.worker()
.thread()
.threadpool()
.process()
.scheduler()
```

---

# 27. Example

### Programmer

```gatra
isi transaksi = data.baca<Transaksi>(
    "s3://data/transaksi/*.parquet"
)

isi laporan = transaksi
    .saring(.jumlah > 100)
    .kelompok(.negara)
    .agregat({
        total: hitung()
        pendapatan: jumlah(.jumlah)
    })

laporan.tulis(
    "s3://hasil/laporan.parquet"
)
```

### Runtime

```text
Parse
 ↓
Logical Plan
 ↓
Optimize
 ↓
Estimate Cost
 ↓
Detect Heavy Work
 ↓
Rust Engine
 ↓
Partition
 ↓
Thread Pool
 ↓
Parallel Execution
 ↓
Merge
 ↓
Write
```

Programmer tidak perlu mengetahui detail tersebut.

---

# 28. Architecture

```text
                         GATRA
                           │
                           ▼
                  Gatra Compiler/Runtime
                           │
                           ▼
                     Logical Plan
                           │
                           ▼
                       Optimizer
                           │
                           ▼
                     Cost Estimator
                           │
              ┌────────────┴────────────┐
              │                         │
              ▼                         ▼
        Lightweight                  Heavy
              │                         │
              ▼                         ▼
           V8 / Node               N-API / FFI
                                        │
                                        ▼
                                Rust Data Engine
                                        │
                           ┌────────────┼────────────┐
                           ▼            ▼            ▼
                       Thread Pool    SIMD      Native Memory
                           │
                           ▼
                         CPU
```

---

# 29. Design Principles

### 29.1 Automatic by Default

Programmer tidak perlu mengelola parallelism.

### 29.2 Sequential Semantics

Source code tetap mudah dibaca secara sequential.

### 29.3 Native Heavy Execution

CPU-intensive workload dipindahkan ke Rust.

### 29.4 Event Loop Protection

Heavy computation tidak boleh memblokir Node.js event loop.

### 29.5 Adaptive

Runtime menentukan tingkat parallelism berdasarkan kondisi aktual.

### 29.6 Zero-Copy Where Possible

Data Big Data tidak boleh bolak-balik sebagai JavaScript object.

### 29.7 Plan Over Calls

FFI digunakan untuk execution plan/batch, bukan per-row.

### 29.8 Runtime Owns Complexity

Thread, worker, scheduler, memory dan partitioning merupakan tanggung jawab runtime.

---

# 30. Acceptance Criteria

## Automatic Execution

- [ ] Gatra otomatis mendeteksi CPU-intensive workload.
- [ ] CPU-intensive Big Data workload dapat dipindahkan ke Rust.
- [ ] Heavy computation tidak memblokir Node.js event loop.
- [ ] Runtime dapat menggunakan multiple CPU cores.
- [ ] Runtime dapat memilih jumlah worker secara otomatis.
- [ ] Runtime dapat menyesuaikan parallelism berdasarkan workload.

## Big Data

- [ ] Dataset dapat diproses secara parallel.
- [ ] Dataset tidak harus dimaterialisasi menjadi JavaScript objects.
- [ ] Native memory digunakan untuk heavy processing.
- [ ] Spill-to-disk tersedia untuk workload tertentu.
- [ ] Partitioning dapat dilakukan otomatis.

## FFI

- [ ] N-API digunakan sebagai boundary Node.js ↔ Rust.
- [ ] Execution plan dapat dikirim ke Rust.
- [ ] Tidak ada FFI call per row.
- [ ] Native result dapat dikembalikan dengan overhead minimal.

## Semantics

- [ ] Hasil tetap konsisten pada jumlah worker berbeda.
- [ ] Parallel execution tidak mengubah semantics program.
- [ ] Runtime bebas memilih physical execution strategy.

## Developer Experience

- [ ] Parallel execution aktif secara default.
- [ ] Programmer tidak wajib menggunakan `.paralel()`.
- [ ] `.paralel()` hanya menjadi execution hint.
- [ ] Programmer tidak perlu mengelola thread.
- [ ] Programmer tidak perlu mengelola worker.
- [ ] Programmer tidak perlu mengelola scheduler.

## Observability

- [ ] Execution plan dapat diperiksa.
- [ ] Worker count dapat diperiksa.
- [ ] Partition count dapat diperiksa.
- [ ] Memory usage dapat diperiksa.
- [ ] Spill usage dapat diperiksa.
- [ ] Execution time dapat diperiksa.

---

# 31. Final Architecture

```text
                         GATRA
                           │
                           ▼
                    Node.js / V8
                           │
                    Runtime Manager
                           │
                           ▼
                    Logical Dataset
                           │
                           ▼
                       Optimizer
                           │
                           ▼
                     Cost Estimator
                           │
             ┌─────────────┴─────────────┐
             │                           │
        Lightweight                   Heavy
             │                           │
             ▼                           ▼
          V8 / I/O                   N-API
                                         │
                                         ▼
                                  Rust Data Engine
                                         │
                              ┌──────────┼──────────┐
                              ▼          ▼          ▼
                           Planner    Executor    Memory
                                         │
                              ┌──────────┼──────────┐
                              ▼          ▼          ▼
                           Threads      SIMD      Spill
                              │
                              ▼
                             CPU
                              │
                              ▼
                    Arrow / Parquet / Storage
```

**Kesimpulan desain:** Gatra tidak memaksa programmer belajar concurrency. Programmer menulis kode yang sederhana dan sequential; **runtime yang bertanggung jawab mengubahnya menjadi asynchronous, parallel, vectorized, atau native execution sesuai kebutuhan.** Ini sangat cocok dengan tujuan Gatra sebagai bahasa yang sederhana di permukaan tetapi mampu menangani Big Data di bawahnya.

---

# 32. Implementation Status & Phase Roadmap

Dokumen ini (§1–31) mendeskripsikan tujuan akhir. Bagian ini mengunci **apa yang sudah nyata diimplementasikan**, dan **dependency graph** fase-fase berikutnya — supaya tiap fase lanjutan tahu persis fondasi apa yang sengaja akan dirombak, dan tidak ada fitur yang diam-diam diselipkan ke implementasi yang belum siap menampungnya.

## 32.1 Phase 0 — Parallel Execution (row-based) — **Selesai**

Row-based (masih `serde_json::Value` per baris) dan masih synchronous N-API (belum async) — sengaja dibatasi supaya tidak menyentuh semantics `data<T>` yang sudah ada.

| Bagian | Implementasi |
|---|---|
| Cost Estimator | `src/runtime/dataset.js` — `chooseWorkers()`, `NATIVE_ROW_THRESHOLD` (§6: dataset kecil tetap V8) |
| Thread pool (rayon) | `native-engine/src/lib.rs` — `aggregate()`, `filter_simple()`, `run_with_pool()` (§12) |
| Adaptive parallelism | `chooseWorkers()` menaikkan worker count berdasar jumlah baris, dibatasi jumlah core asli (§13) |
| `.paralel(n)` sebagai hint | `materialize()` di `dataset.js` — mempengaruhi worker count, tidak menjamin (§19) |
| Observability | `.jelaskan()` (execution plan) dan `.statistik()` (`execution_time_ms`, `workers`, `engine`) (§24) |
| Semantic guarantee | Hasil sama di semua worker count — dites eksplisit (`aggregate_matches_across_worker_counts` di `native-engine/src/lib.rs`) (§25) |

**Belum** disentuh oleh Phase 0: event loop protection (N-API call tetap blocking), zero-copy/native memory (data tetap masuk-keluar sebagai JSON), spill, SIMD, distributed execution.

## 32.2 Dependency graph fase berikutnya (dikunci)

```text
Parallel Execution (Phase 0 — selesai)
      ↓
Async Execution (Phase 1)
      ↓
Columnar Memory (Phase 2)
      ↓
SIMD (Phase 3)
      ↓
Out-of-Core / Spill (Phase 4)
      ↓
Distributed Execution (Phase 5)
```

Urutan ini kombinasi dua jenis dependency — **hard** (secara teknis mustahil dibalik) dan **sequencing** (keputusan supaya satu fase dikerjakan tuntas dulu sebelum fase berikut, bukan dikerjakan paralel):

| Fase | Prasyarat | Jenis dependency | Kenapa |
|---|---|---|---|
| 1. Async Execution | Phase 0 | Sequencing | Tidak wajib menunggu Phase 0 secara teknis, tapi dikunci berjalan setelahnya supaya tidak ada dua rombakan fondasi berjalan bersamaan |
| 2. Columnar Memory | Phase 1 | Sequencing | Bisa dikerjakan sebelum Phase 1 secara teknis; dikunci sesudahnya sesuai urutan di atas |
| 3. SIMD | Phase 2 | **Hard** | Butuh buffer angka contiguous (bukan `serde_json::Value` per-row) untuk divektorisasi — mustahil sebelum Phase 2 |
| 4. Out-of-Core / Spill | Phase 2 | **Hard** | Streaming/chunked read + external merge butuh batch columnar yang bisa dipotong-potong secara efisien |
| 5. Distributed Execution | Phase 1 + Phase 4 | **Hard** | Tiap worker terdistribusi butuh async coordination (Phase 1) dan kemampuan out-of-core lokal (Phase 4) — ini juga persis Phase 7 di roadmap `BIGDATA_TYPE.md` §27 |

## 32.3 Rincian tiap fase

### Phase 1 — Async Execution
- N-API `AsyncTask`/`ThreadsafeFunction` menggantikan call synchronous sekarang.
- `.kumpulkan()`, `.tulis()`, `.statistik()`, `.jelaskan()` jadi mengembalikan Promise.
- Gatra source butuh `tunggu` di boundary eksekusi dataset (§15 Event Loop Protection).
- Cancellation token masuk ke Execution Manager (§23).
- **Breaking change** — mengubah semantics `data<T>` yang sudah jalan (semua contoh/dokumentasi sekarang tidak pakai `tunggu` di sini). Diperlakukan sebagai major version, bukan diselipkan ke rilis minor.

### Phase 2 — Columnar Memory
- Representasi row-based (`serde_json::Value` per baris) diganti buffer columnar (gaya Arrow).
- Operator `.saring()`, `.agregat()`, `.gabung()`, `.urutkan()` ditulis ulang untuk beroperasi per-kolom.
- Prasyarat native memory (§16) baru benar-benar terpenuhi setelah fase ini.

### Phase 3 — SIMD
- Vektorisasi operator numerik (`jumlah`/`rata_rata`/`minimum`/`maksimum`, predicate numerik) di atas buffer columnar Phase 2.

### Phase 4 — Out-of-Core / Spill
- Streaming reader — sumber tidak lagi dibaca penuh ke memory sekaligus seperti sekarang (`readDataset()` di `dataset.js`).
- Chunk execution + format temp di disk + external merge-sort.
- Spill dipicu batas memory (§17).

### Phase 5 — Distributed Execution
- Worker/scheduler, network shuffle, retry & fault tolerance (§19–20 di `BIGDATA_TYPE.md`).
- Sama dengan Phase 7 `BIGDATA_TYPE.md` §27 — bukan scope baru, cuma penamaan ulang di roadmap ini.

## 32.4 Ground rule

Tidak ada fase di atas yang boleh mengubah semantics `data<T>` yang sudah ada (synchronous, row-based) sebelum Phase 1 secara eksplisit di-scope dan diberi versi sebagai breaking change. Cost Estimator dan parallelism berbasis rayon (Phase 0) sengaja tetap synchronous dan row-based — itu optimasi di dalam arsitektur yang sudah ada, bukan pratinjau arsitektur berikutnya.
