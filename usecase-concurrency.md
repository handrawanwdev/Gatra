Bisa. Saya sarankan dibuat sebagai **Use Case & Acceptance Criteria** supaya jelas mana yang harus diperbaiki dan kapan dianggap selesai.

# Gatra Concurrency Safety — Use Case & Acceptance Criteria

## Tujuan

Memastikan Gatra memiliki concurrency model yang:

- aman secara default
- sederhana digunakan
- mencegah race condition dan lost-update
- mendukung parallelism secara otomatis
- mempertahankan deterministic execution
- memiliki bounded resource usage
- tidak memaksa developer mengelola thread secara manual

---

## UC-01 — Read × Read

**Masalah**

Saat ini setiap data yang dikirim ke fungsi paralel dianggap `moved`, sehingga data yang hanya dibaca tidak dapat digunakan oleh beberapa task.

```gatra
isi data = ambilData()

A(data)
B(data)
C(data)
```

Saat ini:

```text
A(data) → moved
B(data) → usedAfterMove ❌
C(data) → usedAfterMove ❌
```

**Perbaikan**

Compiler harus membedakan akses **read-only** dengan ownership transfer.

```text
Read × Read
     ↓
Parallel
     ↓
Allowed
```

**Acceptance Criteria**

- Data read-only dapat digunakan oleh beberapa task secara parallel.
- Tidak dianggap `move`.
- Tidak membutuhkan `tanpa_periksa()`.
- Tidak membutuhkan alias workaround.
- Compiler tetap menolak concurrent mutation.

**Status Accepted:** ☐

---

# UC-02 — Read × Write

**Masalah**

Data sedang dibaca oleh task lain tetapi ada task yang mencoba mengubahnya.

```text
A → read(data)
B → write(data)
```

**Perbaikan**

Compiler/runtime harus mencegah concurrent read/write terhadap resource yang sama.

Target:

```text
Read + Write
      ↓
Reject atau Serialize
```

**Acceptance Criteria**

- Concurrent read/write tidak boleh menghasilkan race condition.
- Compiler menolak jika konflik dapat diketahui secara statis.
- Runtime dapat melakukan serialization jika ownership model mengharuskannya.
- Tidak boleh terjadi silent data race.

**Status Accepted:** ☐

---

# UC-03 — Write × Write

**Masalah**

Dua task memodifikasi resource yang sama.

```text
A → write(data)
B → write(data)
```

Potensi:

```text
lost-update
race-condition
inconsistent-state
```

**Perbaikan**

Mutation harus exclusive.

```text
Write
 ↓
Exclusive Owner
```

**Acceptance Criteria**

- Dua worker tidak boleh memodifikasi resource yang sama secara bersamaan.
- Compiler/runtime harus memastikan exclusive mutation.
- Tidak boleh membutuhkan mutex manual untuk kasus single-owner.
- Tidak boleh terjadi lost-update.

**Status Accepted:** ☐

---

# UC-04 — Ownership Move

**Masalah**

Data yang dikirim sebagai ownership transfer masih digunakan oleh owner sebelumnya.

```gatra
isi data = buatData()

proses(data)

cetak(data)
```

**Perbaikan**

Ownership berpindah secara eksplisit pada semantic level.

```text
Owner A
   │
   │ move
   ▼
Owner B
```

**Acceptance Criteria**

- Setelah move, owner sebelumnya tidak dapat menggunakan data.
- Compiler menghasilkan `usedAfterMove`.
- Tidak boleh terjadi double ownership.
- Tidak membutuhkan runtime lock.

**Status Accepted:** ☐

---

# UC-05 — Same Resource

**Masalah**

Beberapa transaksi terhadap resource yang sama dapat menyebabkan lost-update.

```text
Account 123
 ├── Tx A
 ├── Tx B
 └── Tx C
```

**Perbaikan**

Gunakan **Single-Owner Resource**.

```text
Account 123
     ↓
Single Owner
     ↓
Queue
     ↓
Sequential
```

**Acceptance Criteria**

- Semua mutation terhadap resource/key yang sama masuk ke owner yang sama.
- Mutation diproses sequential.
- Ordering ditentukan secara deterministic.
- Tidak ada concurrent mutation pada resource yang sama.
- Tidak terjadi lost-update.

**Status Accepted:** ☐

---

# UC-06 — Different Resource

**Masalah**

Serialization global akan menghilangkan keuntungan concurrency.

```text
Account A
Account B
Account C
```

tidak boleh semuanya menunggu satu worker.

**Perbaikan**

Resource berbeda dapat diproses parallel.

```text
Account A → Owner A
Account B → Owner B
Account C → Owner C

A ─┐
B ─┼→ Parallel
C ─┘
```

**Acceptance Criteria**

- Resource berbeda dapat dieksekusi secara parallel.
- Resource yang sama tetap sequential.
- Tidak ada global lock yang tidak diperlukan.
- Throughput meningkat seiring jumlah resource independen.

**Status Accepted:** ☐

---

# UC-07 — CPU-Heavy

**Masalah**

CPU-intensive task dapat memblokir Event Loop.

```text
CPU-heavy
   ↓
Event Loop
   ↓
Other requests blocked
```

**Perbaikan**

Scheduler mengarahkan workload CPU-heavy ke bounded Worker Pool.

```text
CPU-heavy
    ↓
Worker Pool
```

**Acceptance Criteria**

- CPU-heavy task tidak menyebabkan Event Loop blocking yang signifikan.
- Worker Pool digunakan secara otomatis.
- Developer tidak perlu membuat thread.
- Jumlah worker tetap bounded.
- Scheduler mempertimbangkan execution cost.

**Status Accepted:** ☐

---

# UC-08 — CPU-Light

**Masalah**

Task kecil tidak seharusnya selalu dikirim ke worker karena scheduling/transfer overhead dapat lebih mahal daripada eksekusinya.

**Perbaikan**

```text
CPU-light
    ↓
Event Loop
```

jika:

```text
worker overhead > parallelism benefit
```

**Acceptance Criteria**

- Task kecil dapat tetap dijalankan di Event Loop.
- Scheduler mempertimbangkan scheduling overhead.
- Tidak terjadi worker spawning untuk setiap task.
- Tidak ada context-switch berlebihan.

**Status Accepted:** ☐

---

# UC-09 — Critical Deterministic Workload

**Masalah**

Workload seperti matching engine membutuhkan ordering deterministik.

```text
Order A
Order B
Order C
```

Tidak boleh menjadi:

```text
A → C → B
```

karena scheduler berubah.

**Perbaikan**

```text
Critical + Deterministic
        ↓
Single Owner
        ↓
Sequential
```

**Acceptance Criteria**

- Ordering selalu deterministic.
- Critical workload tidak dipindahkan secara sembarangan ke Worker Pool.
- Scheduler tidak boleh mengubah semantic ordering.
- Matching engine dapat mempertahankan price-time priority.

**Status Accepted:** ☐

---

# UC-10 — Queue Penuh

**Masalah**

Infinite queue dapat menyebabkan memory exhaustion.

```text
Tasks
 ↓
∞ Queue
 ↓
Memory exhaustion
```

**Perbaikan**

```text
Tasks
 ↓
Bounded Queue
 ↓
Worker Pool
```

Ketika penuh:

```text
wait / throttle / reject
```

**Acceptance Criteria**

- Queue memiliki kapasitas maksimum.
- Tidak boleh terjadi infinite queue growth.
- Sistem memiliki backpressure.
- Policy saat queue penuh harus deterministic.
- Memory usage tetap bounded.

**Status Accepted:** ☐

---

# UC-11 — Worker Crash

**Masalah**

Worker dapat crash ketika sedang memiliki ownership terhadap resource.

```text
Resource
   ↓
Worker A
   ↓
CRASH
```

**Perbaikan**

Runtime harus mampu melakukan recovery.

```text
Resource
   ↓
Owner recovery
   ↓
Worker B
```

**Acceptance Criteria**

- Ownership dapat dipulihkan.
- Task yang belum committed tidak hilang.
- Task tidak dieksekusi dua kali tanpa idempotency guarantee.
- Queue/state dapat dipulihkan.
- Runtime tidak meninggalkan resource dalam kondisi permanently locked.

**Status Accepted:** ☐

---

# UC-12 — Database Mutation

**Masalah**

Ownership Gatra hanya melindungi state yang dikelola runtime.

Database tetap dapat mengalami:

```text
Service A → UPDATE
Service B → UPDATE
```

**Perbaikan**

Database mutation harus menggunakan mekanisme consistency yang sesuai.

```text
Gatra
 ↓
Transaction / Atomic Operation
 ↓
Database
```

**Acceptance Criteria**

- Gatra tidak mengklaim ownership memory sebagai database transaction safety.
- Mutation kritis menggunakan transaction/atomic operation/locking strategy yang sesuai.
- Lost-update pada database harus dicegah.
- Retry tidak menyebabkan duplicate mutation.
- Operation kritis mendukung idempotency bila diperlukan.

**Status Accepted:** ☐

---

# UC-13 — Closure Capture

**Masalah**

Variable yang ditangkap closure dapat menjadi shared mutable state.

```gatra
isi counter = 0

paralel {
    counter += 1
}
```

**Perbaikan**

Compiler harus menganalisis captured variable.

```text
Closure Capture
      ↓
Ownership / Mutation Check
```

**Acceptance Criteria**

- Immutable capture dapat dilakukan secara aman.
- Mutable capture tidak boleh menyebabkan data race.
- Compiler menolak unsafe concurrent capture.
- Ownership transfer tetap berlaku pada closure.
- `tanpa_periksa()` menjadi explicit unsafe escape hatch.

**Status Accepted:** ☐

---

# UC-14 — Immutable Large Data

**Masalah**

Data besar yang hanya dibaca tidak seharusnya di-copy berkali-kali.

Contoh:

```text
100 MB Config
     │
 ┌───┼────┐
 ↓   ↓    ↓
 W1  W2   W3
```

Tidak ideal:

```text
100 MB × 3
```

**Perbaikan**

Gunakan shared immutable access.

```text
Immutable Data
      │
 ┌────┼────┐
 ↓    ↓    ↓
 W1   W2   W3
 READ READ READ
```

**Acceptance Criteria**

- Immutable data dapat dibaca oleh banyak worker.
- Tidak perlu melakukan full copy untuk setiap worker.
- Tidak dapat dimutasi melalui shared read access.
- Lifetime/resource ownership tetap aman.
- Memory usage tidak meningkat secara linear hanya karena jumlah reader.

**Status Accepted:** ☐

---

# Final Acceptance Matrix

| #     | Use Case               | Expected Behavior                 |
| ----- | ---------------------- | --------------------------------- |
| UC-01 | Read × Read            | **Parallel**                      |
| UC-02 | Read × Write           | **Reject / Serialize**            |
| UC-03 | Write × Write          | **Exclusive**                     |
| UC-04 | Move                   | **Ownership Transfer**            |
| UC-05 | Same Resource          | **Sequential / Single Owner**     |
| UC-06 | Different Resource     | **Parallel**                      |
| UC-07 | CPU-heavy              | **Worker Pool**                   |
| UC-08 | CPU-light              | **Event Loop**                    |
| UC-09 | Critical Deterministic | **Single Owner**                  |
| UC-10 | Queue Full             | **Backpressure**                  |
| UC-11 | Worker Crash           | **Recovery**                      |
| UC-12 | DB Mutation            | **Transaction / Atomicity**       |
| UC-13 | Closure Capture        | **Safety Check**                  |
| UC-14 | Immutable Large Data   | **Shared Read Without Full Copy** |

### Prinsip akhir yang sebaiknya dijadikan acceptance utama

```text
READ
 → boleh parallel

WRITE
 → harus exclusive

MOVE
 → ownership berpindah

SAME KEY
 → sequential

DIFFERENT KEY
 → parallel

CPU HEAVY
 → Worker Pool

CPU LIGHT
 → Event Loop

CRITICAL + DETERMINISTIC
 → Single Owner

QUEUE FULL
 → Backpressure

WORKER CRASH
 → Recovery

DATABASE
 → Transaction / Atomicity

CLOSURE CAPTURE
 → Ownership Check

IMMUTABLE LARGE DATA
 → Shared Read
```

Dengan matrix ini, **jangan dulu menganggap Gatra “aman” sebelum setiap UC punya implementasi + test yang membuktikan acceptance criteria-nya**.
