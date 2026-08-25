Rancang dan implementasikan sistem **Automatic Concurrency, CPU Scheduling, Ownership, dan Deterministic Execution** untuk bahasa pemrograman **Gatra**.

Tujuan utama:

> **Gatra harus semudah JavaScript untuk digunakan, tetapi memiliki safety, ownership, deterministic concurrency, dan performance model yang mendekati Rust.**

Sistem harus cukup general untuk aplikasi web/backend sekaligus mampu menangani **low-latency matching engine**.

## 1. Arsitektur Utama

```text
                    Gatra Source
                         │
                         ▼
                    Gatra Compiler
                 ┌───────┴───────┐
                 ▼               ▼
             Type Check    Ownership Check
                 └───────┬───────┘
                         ▼
                    Gatra Runtime
                         │
                         ▼
                     Scheduler
                    /         \
                   /           \
              I/O / Light    CPU / Heavy
                  │               │
                  ▼               ▼
              Event Loop      Worker Pool
                                  │
                         Ownership / Transfer
                                  │
                                  ▼
                              CPU Cores
```

Scheduler harus otomatis menentukan execution path tanpa mengharuskan developer membuat thread secara manual.

---

# 2. Automatic Scheduling

Developer cukup menulis fungsi normal:

```gatra
fungsi proses(data) {
    ...
}
```

Runtime menentukan apakah pekerjaan tersebut:

```text
I/O / lightweight
        ↓
   Event Loop
```

atau:

```text
CPU-intensive
        ↓
   Worker Pool
```

Developer tidak wajib mengatur:

- thread creation
- worker creation
- thread count
- thread join
- CPU affinity

---

# 3. Cost-Based Scheduler

Jangan menggunakan aturan sederhana:

```text
CPU task → Worker Pool
```

Scheduler harus mempertimbangkan:

```text
CPU time
Execution duration
Event-loop blocking
Input size
Historical execution cost
Worker queue load
Ownership transfer cost
Scheduling overhead
```

Prinsip:

```text
Small / cheap task
→ Event Loop

Expensive CPU task
→ Worker Pool
```

Jika biaya memindahkan task ke worker lebih besar daripada manfaat parallelism, task tetap dijalankan pada Event Loop.

---

# 4. Adaptive Runtime Profiling

Runtime harus dapat mempelajari workload.

Contoh:

```text
process()
run 1 → 2 ms
run 2 → 3 ms
run 3 → 4 ms
```

Tetap:

```text
Event Loop
```

Jika kemudian:

```text
process()
run 4 → 90 ms
run 5 → 110 ms
run 6 → 120 ms
```

Runtime mengubah execution policy:

```text
process()
    ↓
Worker Pool
```

Decision harus adaptive dan dapat berubah kembali ketika workload berubah.

---

# 5. Bounded Worker Pool

Worker Pool tidak boleh membuat infinite thread.

Contoh:

```text
CPU = 8 cores

Worker Pool
├── Worker 1
├── Worker 2
├── Worker 3
├── Worker 4
├── Worker 5
├── Worker 6
└── Worker 7
```

Worker harus reusable.

Jangan menggunakan:

```text
1 request = 1 thread
```

Jumlah worker harus dikontrol runtime berdasarkan:

- CPU cores
- workload
- queue depth
- system load

---

# 6. Backpressure

CPU queue harus bounded.

```text
CPU Tasks
    │
    ▼
Bounded Queue
    │
    ▼
Worker Pool
```

Jika worker penuh:

```text
Queue
 ↓
wait / throttle / reject
```

Jangan membuat infinite queue karena dapat menyebabkan memory exhaustion.

---

# 7. Ownership Model

Data yang dikirim ke Worker Pool harus aman untuk dipindahkan.

Gunakan konsep:

```text
Owned Data
Transferable Data
Immutable Data
```

Default:

```text
Worker menerima ownership
```

Setelah ownership dipindahkan:

```gatra
tetapkan data = buatData()

proses(data)

cetak(data) // Compile Error
```

Compiler harus mendeteksi penggunaan data setelah ownership move.

---

# 8. Shared Mutable State

Jangan mengizinkan arbitrary shared mutable state antar-worker.

Default:

```text
Worker A ──X── Shared Mutable State ──X── Worker B
```

Gunakan:

```text
Main
 │
 │ ownership / message
 ▼
Worker
 │
 │ result
 ▼
Main
```

Jika shared mutable state benar-benar diperlukan, harus menggunakan primitive synchronization eksplisit.

Contoh:

```gatra
shared<Mutex<Data>>
```

Concurrency yang berbahaya harus terlihat jelas oleh developer.

---

# 9. Deterministic Execution

Gatra harus menyediakan model deterministic execution untuk workload yang membutuhkan ordering ketat.

Khususnya:

- matching engine
- financial transaction processing
- state machine
- event processing
- order processing

Jangan melakukan parallel execution apabila dapat mengubah ordering atau determinism.

---

# 10. Matching Engine Support

Matching engine harus menggunakan model **single-owner execution**.

Jangan:

```text
Order
 ↓
Scheduler
 ↓
Worker Pool
 ↓
Worker
 ↓
Shared Order Book
```

Jangan menggunakan shared mutable order book antar-worker.

Gunakan:

```text
                 Order Stream
                      │
                      ▼
                Market Router
                      │
          ┌───────────┼───────────┐
          ▼           ▼           ▼
       BTC/USD     ETH/USD      SOL/USD
          │           │            │
          ▼           ▼            ▼
      Matcher 1    Matcher 2     Matcher 3
          │           │            │
          ▼           ▼            ▼
      Order Book   Order Book    Order Book
```

Setiap Matching Core memiliki ownership penuh terhadap Order Book-nya.

---

# 11. Single-Owner Matching Core

Untuk setiap market:

```text
Matching Core
     │
     └── owns Order Book
```

Hanya Matching Core tersebut yang boleh mengubah Order Book.

Order diproses sequential berdasarkan input queue:

```text
Order 1
   ↓
Order 2
   ↓
Order 3
   ↓
Matching Core
```

Ini menjaga:

- price-time priority
- deterministic ordering
- consistency
- predictable latency

---

# 12. Parallelism Antar-Market

Parallelism tetap diperbolehkan antar-market:

```text
                  Exchange
                     │
          ┌──────────┼──────────┐
          ▼          ▼          ▼
       BTC/USD    ETH/USD    SOL/USD
          │          │          │
          ▼          ▼          ▼
      Matcher 1  Matcher 2  Matcher 3
          │          │          │
       owns book  owns book  owns book
```

Dengan demikian:

```text
Same Market
→ Sequential / Single Owner

Different Markets
→ Parallel
```

Ini harus menjadi prinsip utama matching engine.

---

# 13. Worker Pool untuk Matching Engine

Worker Pool tetap boleh digunakan untuk pekerjaan non-critical seperti:

```text
Validation
Authentication
Serialization
Persistence
Logging
Market Data
Analytics
Reporting
Background Processing
```

Tetapi jangan memindahkan critical matching loop secara otomatis ke Worker Pool jika hal tersebut menyebabkan:

- ordering berubah
- latency tidak predictable
- race condition
- shared state
- nondeterministic execution

---

# 14. Scheduler Harus Mengenali Critical Workload

Scheduler harus memiliki konsep:

```text
Normal Task
CPU Task
I/O Task
Deterministic Task
Critical Task
```

Untuk:

```text
Deterministic + Critical
```

gunakan single-owner execution.

Contoh:

```text
Order Book Matching
        ↓
Deterministic Critical
        ↓
Single Matching Core
```

Bukan:

```text
Worker Pool
```

---

# 15. Fast Path untuk Low Latency

Matching engine membutuhkan fast path.

Jangan melakukan profiling dan scheduling kompleks pada setiap order.

Gunakan:

```text
                 Order
                   │
                   ▼
             Market Router
                   │
                   ▼
            Matching Core
                   │
                   ▼
              Order Book
```

Scheduler tidak boleh menambahkan overhead besar pada critical path.

Profiling dan adaptive analysis harus dilakukan dengan overhead minimal atau secara asynchronous.

---

# 16. Compiler + Runtime

Gunakan kombinasi:

```text
Gatra Compiler
     │
     ├── Type Analysis
     ├── Ownership Analysis
     ├── Move Checking
     ├── Concurrency Safety
     └── Determinism Hints
              │
              ▼
        Gatra Runtime
              │
              ├── Scheduler
              ├── Event Loop
              ├── Worker Pool
              ├── Runtime Profiler
              ├── Cost Model
              ├── Backpressure
              └── Matching Runtime
```

Compiler memberikan informasi awal.

Runtime menangani workload yang hanya dapat diketahui ketika program berjalan.

---

# 17. Developer Experience

Developer harus dapat menulis:

```gatra
fungsi proses(data) {
    ...
}
```

dan Gatra otomatis menangani concurrency.

Untuk matching engine:

```gatra
market BTC_USD {
    orderBook = buatOrderBook()

    ketika order {
        orderBook.match(order)
    }
}
```

Developer tidak perlu mengatur:

```text
thread
worker
mutex
thread pool
CPU core
```

kecuali membutuhkan kontrol tingkat rendah.

---

# 18. Prinsip Utama Gatra

Implementasi harus mengikuti prinsip berikut:

```text
I/O
→ Event Loop

CPU-heavy
→ Worker Pool

Small CPU task
→ Event Loop jika worker overhead lebih mahal

Shared mutable state
→ Tidak diperbolehkan secara default

Ownership transfer
→ Default untuk komunikasi antar-worker

Deterministic critical workload
→ Single Owner

Same Market
→ Sequential

Different Markets
→ Parallel

Worker Pool
→ Bounded

Queue
→ Bounded + Backpressure
```

## Target Akhir

Gatra harus memberikan pengalaman:

> **Write normal code. Gatra automatically handles concurrency and CPU scheduling while preserving ownership safety and deterministic execution where required.**

Untuk aplikasi biasa, Gatra memberikan automatic concurrency.

Untuk CPU-heavy workload, Gatra menggunakan Worker Pool.

Untuk workload kritis seperti matching engine, Gatra menggunakan **single-owner deterministic execution**.

Hasil akhirnya harus menggabungkan:

```text
JavaScript
→ Ease of Use

Go
→ Simplicity

Rust
→ Ownership + Safety + Performance

Gatra
→ Automatic Concurrency + Adaptive Scheduling + Deterministic Execution
```

Fokus implementasi pada **low overhead, predictable behavior, memory safety, deterministic ordering, bounded concurrency, dan high throughput**.
