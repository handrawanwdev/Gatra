# GATRA v0.1

### **Bahasa Pemrograman Indonesia Sederhana untuk Ekosistem JavaScript**

> **Sederhana bahasanya. Bersih kodenya. Luas ekosistemnya.**

---

# 1. Ringkasan

**Gatra** adalah bahasa pemrograman statically typed dengan syntax Bahasa Indonesia yang dikompilasi menjadi JavaScript dan berjalan langsung di Node.js.

Gatra dirancang dengan satu prinsip:

> **Gatra menyederhanakan cara menulis kode, bukan membatasi kemampuan JavaScript.**

```text
Gatra
  ↓
Parser
  ↓
Type Checker
  ↓
JavaScript Generator
  ↓
JavaScript
  ↓
Node.js
  ↓
npm / Framework / Library
```

Gatra **tidak membuat runtime, VM, garbage collector, package manager, atau ecosystem sendiri**.

---

# 2. Tujuan Produk

Gatra bertujuan membuat pengembangan aplikasi Node.js:

- lebih mudah dibaca
- lebih sedikit boilerplate
- lebih mudah dipelajari
- lebih mudah dirawat
- lebih aman dari error tipe
- memiliki error handling yang jelas
- tetap kompatibel dengan ecosystem JavaScript

Target utama:

```text
Kesederhanaan Gatra
        +
Static Type
        +
Clean Code
        +
JavaScript Compatibility
        =
Gatra
```

---

# 3. Prinsip Desain

## 3.1 Sederhana

Gatra hanya menyediakan konsep yang benar-benar diperlukan.

Tidak membuat fitur hanya karena bahasa lain memilikinya.

---

## 3.2 Satu Cara Utama

Jika sebuah pekerjaan memiliki pola umum, Gatra menyediakan satu syntax utama.

Tujuannya mengurangi:

```text
syntax berbeda
      ↓
coding style berbeda
      ↓
maintenance sulit
```

---

## 3.3 JavaScript Native

Jika JavaScript sudah memiliki kemampuan tersebut, Gatra menggunakannya.

Contoh:

```text
Promise       → Promise JavaScript
Array         → Array JavaScript
Object        → Object JavaScript
Map           → Map JavaScript
Class         → Class JavaScript
Error         → Error JavaScript
Buffer        → Buffer Node.js
Stream        → Stream Node.js
```

Tidak ada:

```text
GatraPromise
GatraArray
GatraObject
GatraRuntime
```

---

## 3.4 Clean Code First

Syntax Gatra harus menghasilkan kode yang:

- pendek
- eksplisit
- konsisten
- mudah dibaca
- mudah diuji
- mudah direfactor

---

## 3.5 JavaScript Tidak Boleh Terblokir

Jika Gatra belum memiliki syntax untuk fitur tertentu, developer tetap dapat menggunakan JavaScript.

```gatra
javascript {
    const hasil = library.fitur_baru()
}
```

---

# 4. Target Compatibility

Gatra tidak mengejar:

> **100% syntax JavaScript.**

Gatra mengejar:

> **100% kemampuan yang dapat digunakan dari JavaScript/Node.js.**

Artinya developer harus dapat menggunakan:

```text
JavaScript
Node.js
npm
ESM
CommonJS
TypeScript Declaration
Framework
Library
Native API
Web API
```

dari Gatra.

---

# 5. Syntax Dasar

## Variabel

```gatra
isi nama: teks = "Budi"

isi umur: angka = 20

isi aktif = benar
```

Type inference:

```gatra
isi nama = "Budi"
isi umur = 20
```

---

# 6. Tipe Dasar

Gatra menyediakan tipe sederhana:

```text
teks
angka
logika
bigint
byte
larik
peta
objek
fungsi
kosong
apa_saja
```

### `apa_saja`

Digunakan untuk JavaScript API yang dinamis.

```gatra
isi data: apa_saja = library.dinamis()
```

Penggunaan `apa_saja` dapat menghasilkan warning dari compiler.

---

# 7. Struktur Data

## Struktur

```gatra
struktur Pengguna {
    id: angka
    nama: teks
    email: teks
}
```

Penggunaan:

```gatra
isi pengguna = Pengguna {
    id: 1
    nama: "Budi"
    email: "budi@email.com"
}
```

Compiler menghasilkan JavaScript native.

---

# 8. Object JavaScript

Object biasa tetap tersedia:

```gatra
isi pengguna = {
    nama: "Budi"
    umur: 20
}
```

Akses:

```gatra
cetak(pengguna.nama)
```

Dynamic property:

```gatra
isi kunci = "nama"

cetak(pengguna[kunci])
```

---

# 9. Fungsi

```gatra
fungsi tambah(a: angka, b: angka): angka {
    balik a + b
}
```

Fungsi dapat digunakan sebagai callback:

```gatra
isi hasil = daftar.map(fungsi(x) {
    balik x * 2
})
```

---

# 10. Arrow Function

Untuk callback pendek:

```gatra
isi hasil = daftar.map((x) => x * 2)
```

Gatra mempertahankan syntax JavaScript yang memang sudah jelas.

---

# 11. Control Flow

```gatra
jika umur >= 18 {
    cetak("Dewasa")
} lain {
    cetak("Belum dewasa")
}
```

Loop:

```gatra
untuk pengguna dalam daftar {
    cetak(pengguna.nama)
}
```

While:

```gatra
selama aktif {
    proses()
}
```

---

# 12. Class

Class Gatra dipetakan langsung ke JavaScript Class.

```gatra
kelas Pengguna {

    nama: teks

    konstruk(nama: teks) {
        ini.nama = nama
    }

    sapa() {
        cetak("Halo " + ini.nama)
    }
}
```

Target:

```javascript
class Pengguna {
  constructor(nama) {
    this.nama = nama;
  }

  sapa() {
    console.log("Halo " + this.nama);
  }
}
```

Gatra harus mendukung:

- constructor
- method
- static
- extends
- super
- getter
- setter
- private field
- inheritance

---

# 13. Generic Sederhana

Generic hanya digunakan untuk kebutuhan type safety.

```gatra
struktur hasil<T, E> {
    nilai: T
    galat: E
}
```

Contoh:

```gatra
hasil<Pengguna, Galat>
```

Gatra **tidak mendukung type-level programming kompleks** pada v0.1.

---

# 14. Interface

Untuk mendeskripsikan bentuk object/library JavaScript:

```gatra
antarmuka Pengguna {
    id: angka
    nama: teks
}
```

Interface hanya digunakan oleh compiler dan tidak menghasilkan runtime object.

---

# 15. Union Type

```gatra
tipe Status = "aktif" | "nonaktif"
```

Digunakan untuk type checking.

---

# 16. Error Handling

Gatra menggunakan model:

```text
Rust
  +
Go
  ↓
hasil<T,E>
```

Error normal diperlakukan sebagai nilai.

---

# 17. Result

```gatra
hasil<angka, teks>
```

Berisi:

```text
berhasil(nilai)
gagal(error)
```

Contoh:

```gatra
fungsi bagi(a: angka, b: angka): hasil<angka, teks> {

    jika b == 0 {
        gagal "tidak dapat membagi dengan nol"
    }

    balik berhasil(a / b)
}
```

---

# 18. Error Propagation

Operator:

```text
?
```

Contoh:

```gatra
fungsi ambil_nama(id: angka): hasil<teks, Galat> {

    isi pengguna = ambil_pengguna(id)?

    balik berhasil(pengguna.nama)
}
```

Jika gagal, error otomatis diteruskan.

---

# 19. Error Handling Eksplisit

Untuk pola Go-style:

```gatra
isi pengguna, galat = ambil_pengguna(id)

jika galat != kosong {
    balik gagal(galat)
}
```

---

# 20. Exception JavaScript

Gatra tetap mendukung exception native JavaScript.

```gatra
coba {
    isi data = JSON.parse(teks)
} tangkap galat {
    cetak(galat)
}
```

Throw:

```gatra
lempar Error("Data tidak valid")
```

Fatal:

```gatra
panik("Konfigurasi rusak")
```

---

# 21. Async / Await

Menggunakan Promise native JavaScript.

```gatra
fungsi ambil_pengguna(id: angka) async {

    isi pengguna = tunggu database.ambil(id)

    balik pengguna
}
```

Tidak ada:

```text
GatraPromise
GatraFuture
GatraAsyncRuntime
```

---

# 22. JavaScript Interoperability

Gatra harus dapat menggunakan:

```text
Object
Array
Function
Class
Promise
Map
Set
Date
RegExp
Error
Symbol
BigInt
Proxy
Reflect
Buffer
Stream
EventEmitter
```

langsung.

---

# 23. Object Compatibility

Wajib mendukung:

```text
property
dynamic property
computed property
getter
setter
prototype
inheritance
property descriptor
```

---

# 24. Function Compatibility

Wajib mendukung:

```text
callback
closure
this
bind
call
apply
rest
spread
default parameter
optional parameter
```

---

# 25. Destructuring

Object:

```gatra
isi { nama, umur } = pengguna
```

Array:

```gatra
isi [pertama, kedua] = angka
```

---

# 26. Spread / Rest

```gatra
isi pengguna_baru = {
    ...pengguna
    aktif: benar
}
```

Function:

```gatra
fungsi gabung(...data) {
    ...
}
```

---

# 27. Optional Chaining

```gatra
isi nama = pengguna?.profil?.nama
```

---

# 28. Nullish Coalescing

```gatra
isi nama = pengguna.nama ?? "Tidak diketahui"
```

---

# 29. Iterator

Gatra harus dapat menggunakan:

```text
Iterator
Iterable
AsyncIterator
AsyncIterable
Generator
AsyncGenerator
yield
for await
```

menggunakan mekanisme JavaScript native.

---

# 30. JavaScript Built-in

Gatra tidak mengimplementasikan ulang:

```text
Object
Array
Map
Set
WeakMap
WeakSet
Date
RegExp
Promise
Error
JSON
Math
Reflect
Proxy
Symbol
BigInt
ArrayBuffer
SharedArrayBuffer
DataView
TypedArray
```

---

# 31. Module

Gatra menggunakan module JavaScript.

```gatra
impor Pengguna dari "./pengguna.gatra"
```

Export:

```gatra
ekspor fungsi tambah(a: angka, b: angka): angka {
    balik a + b
}
```

---

# 32. ESM

Support:

```text
import
export
default export
named export
dynamic import()
```

---

# 33. CommonJS

Support:

```text
require()
module.exports
exports
```

Compiler dapat menghasilkan ESM atau CommonJS berdasarkan konfigurasi project.

---

# 34. npm

Gatra menggunakan npm.

```bash
npm install express
npm install @nestjs/core
npm install prisma
```

Tidak ada package manager Gatra pada v0.1.

Tetap menggunakan:

```text
package.json
package-lock.json
node_modules
```

---

# 35. `.d.ts`

Compiler harus membaca TypeScript declaration:

```text
*.d.ts
```

Minimal memahami:

```text
interface
type
generic
union
intersection
optional property
readonly
tuple
function type
class
module
namespace
```

Tujuannya agar Gatra dapat menggunakan library npm yang sudah ada.

---

# 36. Decorator

Gatra mendukung decorator untuk framework JavaScript/TypeScript.

```gatra
@Controller("/pengguna")
kelas PenggunaController {

    @Get()
    fungsi semua() {
        ...
    }
}
```

Target utama:

```text
NestJS
TypeORM
class-validator
dependency injection
```

---

# 37. Node.js API

Gatra langsung menggunakan Node.js.

Contoh:

```gatra
impor fs dari "node:fs/promises"

isi data = tunggu fs.readFile("data.json", "utf8")
```

Tidak membuat:

```text
gatra/fs
gatra/http
gatra/crypto
```

---

# 38. Node.js API Compatibility

Gatra harus dapat menggunakan API:

```text
node:fs
node:http
node:https
node:path
node:url
node:crypto
node:stream
node:events
node:buffer
node:util
node:os
node:process
node:worker_threads
node:child_process
node:net
node:tls
node:dns
node:timers
node:zlib
node:readline
node:assert
node:perf_hooks
```

---

# 39. Web API

Gatra menggunakan Web API yang tersedia di Node.js:

```text
fetch
Request
Response
Headers
FormData
Blob
URL
URLSearchParams
WebSocket
AbortController
AbortSignal
ReadableStream
WritableStream
TransformStream
```

---

# 40. Stream

Gatra harus kompatibel dengan:

```text
Readable
Writable
Duplex
Transform
ReadableStream
WritableStream
TransformStream
```

Tanpa membuat implementation stream sendiri.

---

# 41. Event System

```gatra
impor { EventEmitter } dari "node:events"

isi event = EventEmitter()

event.on("data", fungsi(data) {
    cetak(data)
})
```

Menggunakan EventEmitter native Node.js.

---

# 42. Worker

Worker Node.js dapat digunakan melalui interop:

```text
worker_threads
Worker
MessageChannel
MessagePort
SharedArrayBuffer
Atomics
```

Tidak membuat runtime concurrency baru pada v0.1.

---

# 43. JavaScript Escape Hatch

Ini adalah **fitur compatibility paling penting**.

```gatra
javascript {
    const hasil = library.fitur_baru()
}
```

Jika Node.js atau npm mempunyai fitur baru:

```text
Fitur JavaScript baru
        ↓
Belum didukung syntax Gatra
        ↓
javascript {}
        ↓
Tetap bisa digunakan
```

---

# 44. Source Map

Compiler wajib menghasilkan:

```text
.gatra
   ↓
.js
   ↓
.map
```

Error Node.js harus dapat dikembalikan ke:

```text
file.gatra
baris
kolom
```

---

# 45. Compiler Pipeline

```text
                 Gatra Source
                      │
                    Lexer
                      │
                    Parser
                      │
                     AST
                      │
                Type Checker
                      │
               Error Checker
                      │
              JavaScript IR
                      │
             JavaScript Generator
                      │
                  Source Map
                      │
                  JavaScript
                      │
                   Node.js
```

Compiler tidak membuat VM.

---

# 46. Arsitektur Compiler

```text
gatra/
├── lexer/
├── parser/
├── ast/
├── checker/
├── types/
├── result/
├── interop/
├── js/
├── codegen/
├── sourcemap/
├── formatter/
├── linter/
├── cli/
└── tests/
```

Tidak ada:

```text
runtime/
vm/
gc/
scheduler/
package-manager/
```

---

# 47. Formatter

Gatra memiliki formatter resmi:

```bash
gatra rapikan
```

Tujuan:

```text
Kode konsisten
      ↓
Review mudah
      ↓
Refactor mudah
      ↓
Maintenance mudah
```

Tidak memberikan banyak pilihan style.

---

# 48. Linter

Linter mendeteksi:

- penggunaan `apa_saja` berlebihan
- variabel tidak digunakan
- unreachable code
- error yang tidak ditangani
- shadowing
- pola kode buruk
- import tidak digunakan
- kompleksitas berlebihan

---

# 49. CLI

```bash
gatra buat
gatra jalankan
gatra bangun
gatra periksa
gatra rapikan
gatra uji
```

Contoh:

```bash
gatra jalankan utama.gatra
```

---

# 50. Testing

Gatra dapat menggunakan Node.js Test Runner.

```gatra
uji "penjumlahan" {

    pastikan tambah(2, 3) == 5
}
```

Selain itu kompatibel dengan:

```text
Node Test Runner
Vitest
Jest
Mocha
```

---

# 51. Framework Compatibility

Target validasi:

### Backend

```text
Express
Fastify
Hono
Koa
NestJS
```

### Database

```text
Prisma
Drizzle
TypeORM
Sequelize
```

### Validation

```text
Zod
class-validator
```

### Realtime

```text
Socket.IO
ws
```

### Queue

```text
BullMQ
```

Gatra tidak membuat adapter khusus.

---

# 52. Build Ecosystem

Gatra harus dapat bekerja bersama:

```text
npm
package.json
Vite
esbuild
Rollup
Webpack
Rspack
SWC
```

Compiler Gatra menghasilkan JavaScript standar sehingga tool tersebut dapat digunakan sebagai bagian pipeline.

---

# 53. Clean Code Rules

Gatra v0.1 menerapkan aturan:

### Rule 1

**Sedikit keyword.**

### Rule 2

**Tidak ada syntax alternatif yang tidak diperlukan.**

### Rule 3

**Gunakan JavaScript native jika sudah cukup.**

### Rule 4

**Error bisnis menggunakan `hasil<T,E>`.**

### Rule 5

**Exception digunakan untuk exceptional condition dan interop JavaScript.**

### Rule 6

**Hindari `apa_saja` jika type dapat diketahui.**

### Rule 7

**Formatter resmi menentukan style.**

### Rule 8

**Compiler harus menghasilkan JavaScript yang mudah dibaca.**

### Rule 9

**Tidak membuat abstraction runtime tanpa alasan kuat.**

### Rule 10

**Setiap fitur baru harus memiliki alasan maintainability.**

---

# 54. Performance

Target project kecil:

```text
Compile        < 300 ms
Type Check     < 150 ms
```

Generated JavaScript:

> Harus sedekat mungkin dengan performa JavaScript ekuivalen.

Tidak boleh ada runtime overhead besar hanya karena menggunakan Gatra.

---

# 55. MVP Gatra v0.1

## Core

- [ ] Syntax Bahasa Indonesia
- [ ] Variable
- [ ] Function
- [ ] Struct
- [ ] Object
- [ ] Array
- [ ] Class
- [ ] Control flow
- [ ] Module

## Type

- [ ] Static type
- [ ] Type inference
- [ ] Generic sederhana
- [ ] Interface
- [ ] Union
- [ ] `apa_saja`

## Error

- [ ] `hasil<T,E>`
- [ ] `berhasil`
- [ ] `gagal`
- [ ] `?`
- [ ] `coba`
- [ ] `tangkap`
- [ ] `lempar`
- [ ] `panik`

## JavaScript

- [ ] Promise
- [ ] async/await
- [ ] callback
- [ ] closure
- [ ] this
- [ ] destructuring
- [ ] spread/rest
- [ ] optional chaining
- [ ] nullish coalescing
- [ ] iterator
- [ ] generator
- [ ] JavaScript escape hatch

## Compatibility

- [ ] ESM
- [ ] CommonJS
- [ ] npm
- [ ] `.d.ts`
- [ ] Node.js API
- [ ] Web API
- [ ] Decorator
- [ ] Stream
- [ ] EventEmitter
- [ ] Worker interop

## Tooling

- [ ] CLI
- [ ] Formatter
- [ ] Linter
- [ ] Source map
- [ ] Test runner

---

# 56. Non-Goals

Gatra v0.1 **tidak** membuat:

```text
❌ Runtime sendiri
❌ VM
❌ GC
❌ Package manager
❌ Registry
❌ HTTP framework
❌ ORM
❌ Database driver
❌ Promise implementation
❌ Event system
❌ Stream implementation
❌ Concurrency runtime
❌ Borrow checker
❌ Ownership system
❌ Macro system
❌ Operator overloading
❌ Type-level programming kompleks
```

---

# 57. Acceptance Criteria

Gatra v0.1 harus mampu menjalankan aplikasi nyata:

```text
npm install express
        ↓
npm install zod
        ↓
npm install prisma
        ↓
buat aplikasi.gatra
        ↓
import library
        ↓
gunakan static type
        ↓
gunakan Promise
        ↓
gunakan Node.js API
        ↓
gunakan framework
        ↓
compile
        ↓
JavaScript
        ↓
Node.js
```

Tanpa:

```text
gatra-express
gatra-prisma
gatra-zod
gatra-node
```

---

# 58. Compatibility Test Suite

Gatra wajib memiliki test suite untuk menguji:

```text
JavaScript Primitive
Object
Array
Function
Class
Promise
Async
Generator
Iterator
ESM
CommonJS
npm
Node API
Web API
Stream
EventEmitter
Worker
Decorator
.d.ts
Dynamic import
Proxy
Reflect
Symbol
BigInt
Buffer
TypedArray
```

Prinsip:

> **Setiap kemampuan JavaScript yang gagal diakses Gatra dianggap sebagai compatibility bug.**

---

# 59. Roadmap

## v0.1 — Core

```text
Syntax Indonesia
       ↓
Static Type
       ↓
Struct
       ↓
Function
       ↓
Class
       ↓
Result/Error
       ↓
JavaScript Interop
       ↓
JavaScript Compiler
       ↓
Node.js
       ↓
npm
```

## v0.2 — Developer Experience

```text
Formatter
 ↓
Linter
 ↓
LSP
 ↓
Debugger
 ↓
IDE
```

## v0.3 — Ecosystem

```text
.d.ts
 ↓
Decorator
 ↓
Framework
 ↓
Build tooling
 ↓
Compatibility Suite
```

## v0.4+

Eksperimen fitur safety:

```text
Ownership
Borrowing
Concurrency
```

**Hanya jika tidak merusak kesederhanaan Gatra.**

---

# 60. Arsitektur Final

```text
                         ┌──────────────┐
                         │    GATRA     │
                         └──────┬───────┘
                                │
                        Bahasa Indonesia
                                │
                         Static Type
                                │
                         Clean Syntax
                                │
                       Error sebagai Nilai
                                │
                        JavaScript Interop
                                │
                 ┌──────────────┴──────────────┐
                 │                             │
           Gatra Syntax                  JavaScript
                 │                             │
                 └──────────────┬──────────────┘
                                ↓
                           JavaScript
                                ↓
                             Node.js
                                ↓
                              npm
                                │
             ┌──────────────────┼──────────────────┐
             ↓                  ↓                  ↓
         Framework           Library            Tooling
             │                  │                  │
       ┌─────┼─────┐      ┌─────┼─────┐      ┌───┼────┐
       ↓     ↓     ↓      ↓     ↓     ↓      ↓   ↓    ↓
    Express Nest Fastify Prisma Zod Socket  Vite Jest esbuild
```

---

# 61. Filosofi

Gatra harus:

> **Kecil di dalam, besar di luar.**

```text
                GATRA
                  │
          ┌───────┴───────┐
          ↓               ↓
       Sedikit          Banyak
       konsep          kemampuan
          │               │
          ↓               ↓
      Clean Code      JavaScript
          │             Ecosystem
          └───────┬───────┘
                  ↓
            Mudah dirawat
```

Gatra tidak bertujuan menjadi bahasa paling powerful.

Gatra bertujuan menjadi bahasa yang:

> **cukup sederhana untuk dipahami dalam satu jam, cukup bersih untuk dirawat bertahun-tahun, dan cukup kompatibel untuk menggunakan dunia JavaScript tanpa batas buatan bahasa.**

### Slogan Gatra v0.1

> **Gatra — sederhana bahasanya, bersih kodenya, luas dunianya.**
