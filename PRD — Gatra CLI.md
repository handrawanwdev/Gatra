# PRD — Gatra CLI

## 1. Overview

**Product:** Gatra CLI  
**Purpose:** CLI resmi untuk membuat, mengembangkan, menganalisis, mengompilasi, menguji, dan mendistribusikan aplikasi Gatra.

Gatra adalah bahasa pemrograman yang dikompilasi menjadi JavaScript dan berjalan pada runtime JavaScript yang kompatibel.

CLI harus menyediakan workflow lengkap:

```text
Create
  ↓
Develop
  ↓
Check
  ↓
Test
  ↓
Build
  ↓
Bundle
  ↓
Run / Deploy
```

---

# 2. Goals

### Primary Goals

- Menyediakan CLI yang konsisten dan mudah digunakan.
- Menyediakan project scaffolding melalui `gatra init`.
- Mendukung beberapa project architecture.
- Menyediakan development workflow dengan `gatra dev`.
- Menyediakan compiler dan bundler.
- Menyediakan testing dan static analysis.
- Menyediakan formatter.
- Menyediakan diagnostic tools.
- Menyediakan dependency dan architecture inspection.
- Mendukung konfigurasi project melalui `gatra.toml`.
- Tetap kompatibel dengan ekosistem npm.

### Non-Goals

Gatra CLI tidak membuat package manager sendiri.

Dependency JavaScript tetap dikelola menggunakan npm dan `package.json`.

---

# 3. CLI Command Structure

## Project

```bash
gatra init [nama] [--arch <arsitektur>]
gatra info
```

### `gatra init`

Membuat project Gatra baru.

```bash
gatra init
gatra init aplikasi
gatra init aplikasi --arch modular
```

Architecture awal:

```text
simple
modular
clean
```

Architecture tambahan dapat ditambahkan pada versi berikutnya.

---

# 4. Development

## `gatra dev`

Menjalankan project dalam development mode.

```bash
gatra dev
```

Behavior:

```text
File berubah
    ↓
Detect Change
    ↓
Incremental Compile
    ↓
Restart / Reload
    ↓
Application Running
```

Requirements:

- File watcher.
- Automatic recompilation.
- Error reporting.
- Restart application ketika diperlukan.
- Tidak melakukan full rebuild jika tidak diperlukan.

---

## `gatra run`

Menjalankan file Gatra.

```bash
gatra run src/main.gatra
```

Compiler akan:

```text
.gatra
  ↓
Parse
  ↓
Analyze
  ↓
Compile
  ↓
JavaScript
  ↓
Runtime
```

---

# 5. Build

## `gatra build`

Build satu file atau project berdasarkan konfigurasi.

```bash
gatra build src/main.gatra
gatra build src/main.gatra dist/app.js
```

Build harus menghasilkan JavaScript yang valid.

---

## `gatra build-project`

Build seluruh source project.

```bash
gatra build-project
```

atau:

```bash
gatra build-project src/ dist/
```

Jika `gatra.toml` tersedia, konfigurasi project digunakan sebagai default.

---

# 6. Bundle

## `gatra bundle`

Menggabungkan entry point dan dependency menjadi satu output.

```bash
gatra bundle src/main.gatra
```

Dengan output:

```bash
gatra bundle src/main.gatra dist/app.js
```

Dengan obfuscation:

```bash
gatra bundle src/main.gatra dist/app.js --samar
```

---

# 7. Testing

## `gatra test`

Menjalankan test project.

```bash
gatra test
```

Single file:

```bash
gatra test src/main.gatra
```

CLI harus menampilkan:

```text
Tests
  ✓ login
  ✓ register
  ✓ logout

3 passed
0 failed
```

---

# 8. Static Analysis

## `gatra check`

Melakukan static analysis sebelum build.

```bash
gatra check
```

Single file:

```bash
gatra check src/main.gatra
```

Analysis dapat mencakup:

- Syntax error.
- Type error.
- Unused variable.
- Invalid import.
- Dependency issue.
- Potential concurrency issue.
- Invalid architecture dependency.
- Compiler warning.

---

# 9. Formatter

## `gatra fmt`

Format source code Gatra.

```bash
gatra fmt src/main.gatra
```

Untuk menulis hasil ke file:

```bash
gatra fmt src/main.gatra --write
```

Untuk seluruh project:

```bash
gatra fmt .
```

Formatter harus deterministic sehingga hasil formatting konsisten di semua environment.

---

# 10. Clean

## `gatra clean`

Membersihkan artifact hasil compiler.

```bash
gatra clean
```

Target yang dapat dibersihkan:

```text
dist/
.gatra/
.cache/
```

Command tidak boleh menghapus source code.

---

# 11. Doctor

## `gatra doctor`

Melakukan diagnostic terhadap environment Gatra.

```bash
gatra doctor
```

Contoh output:

```text
Gatra Doctor

✓ Gatra        0.1.0
✓ Node.js      22.x
✓ npm          11.x
✓ gatra.toml   Valid
✓ Project      Valid

Environment is ready.
```

Jika terdapat masalah:

```text
Gatra Doctor

✓ Gatra        0.1.0
✗ Node.js      Not found
✓ npm          Available
✗ gatra.toml   Invalid

2 problems detected.
```

---

# 12. Project Information

## `gatra info`

Menampilkan informasi project.

```bash
gatra info
```

Output:

```text
Project

  Name:          clinic-api
  Version:       1.0.0
  Architecture:  modular
  Entry:         src/main.gatra
  Runtime:       Node.js
  Target:        JavaScript

Build

  Source:        src/
  Output:        dist/
```

---

# 13. Dependency Graph

## `gatra graph`

Menampilkan dependency graph project.

```bash
gatra graph
```

Contoh:

```text
src/main.gatra
├── user.gatra
│   ├── auth.gatra
│   └── database.gatra
└── order.gatra
    └── database.gatra
```

Output tambahan:

```bash
gatra graph --format json
gatra graph --format mermaid
```

Tujuan:

- Memahami dependency.
- Mendeteksi circular dependency.
- Membantu architecture review.
- Membantu compiler optimization.
- Membantu debugging.

---

# 14. Compiler Explanation

## `gatra explain`

Menjelaskan bagaimana compiler menganalisis program.

```bash
gatra explain src/main.gatra
```

Contoh:

```text
Function: login

Classification

  CPU-bound:       No
  I/O-bound:       Yes
  Async:           Yes
  Parallelizable:  No

Dependencies

  database
  bcrypt

Execution

  Runtime: Node.js
  Strategy: Async I/O
```

Fitur ini menjadi salah satu differentiator Gatra CLI.

---

# 15. Benchmark

## `gatra bench`

Mengukur performa compilation dan runtime.

```bash
gatra bench src/main.gatra
```

Output:

```text
Gatra Benchmark

Compilation

  Parse:        12 ms
  Analysis:      8 ms
  Generation:   17 ms
  Total:        37 ms

Runtime

  Startup:      21 ms
  Execution:     4 ms
```

Benchmark harus dapat digunakan untuk:

- Compiler performance.
- Runtime performance.
- Regression detection.
- Optimization testing.

---

# 16. Version

## `gatra version`

Menampilkan versi compiler.

```bash
gatra version
```

Contoh:

```text
Gatra 0.1.0
Compiler: 0.1.0
Target: JavaScript
Runtime: Node.js
```

---

# 17. Help

## `gatra help`

Menampilkan quick reference.

```bash
gatra help
```

Help tidak boleh terlalu panjang.

Contoh:

```text
Gatra — Bahasa pemrograman yang dikompilasi ke JavaScript

PROJECT
  gatra init [nama] [--arch <arsitektur>]
  gatra info

DEVELOPMENT
  gatra dev
  gatra run <file>
  gatra test
  gatra check
  gatra fmt <file>

BUILD
  gatra build <file>
  gatra bundle <entry>
  gatra clean

ANALYSIS
  gatra graph
  gatra explain <file>
  gatra bench <file>
  gatra doctor

SYSTEM
  gatra version
  gatra help
```

Dokumentasi lengkap berada di dokumentasi Gatra CLI.

---

# 18. Obfuscation

Gatra mendukung opsi:

```bash
--samar
```

Contoh:

```bash
gatra build app.gatra --samar
gatra bundle app.gatra dist/app.js --samar
```

Tujuan:

- Menyamarkan identifier.
- Mengubah representasi string sesuai strategi compiler.
- Menghasilkan output yang lebih sulit dibaca manusia.

Obfuscation tidak boleh dianggap sebagai mekanisme keamanan atau enkripsi data.

---

# 19. Project Configuration

Gatra menggunakan:

```text
gatra.toml
```

sebagai konfigurasi project.

Contoh:

```toml
[project]
name = "clinic-api"
version = "1.0.0"
architecture = "modular"
entry = "src/main.gatra"

[build]
source = "src"
output = "dist"
target = "node"

[test]
directory = "tests"

[format]
indent = 4
```

Pembagian tanggung jawab:

```text
package.json
    ↓
npm dependencies

gatra.toml
    ↓
Gatra project/compiler configuration
```

Gatra tidak membuat package manager sendiri.

---

# 20. Project Architecture

## Simple

```text
project/
├── src/
│   └── main.gatra
├── tests/
├── gatra.toml
├── package.json
└── README.md
```

## Modular

```text
project/
├── src/
│   ├── modules/
│   │   ├── user/
│   │   ├── auth/
│   │   └── order/
│   ├── shared/
│   └── main.gatra
├── tests/
├── gatra.toml
├── package.json
└── README.md
```

## Clean

```text
project/
├── src/
│   ├── domain/
│   ├── application/
│   ├── infrastructure/
│   └── interfaces/
├── tests/
├── gatra.toml
└── package.json
```

Architecture harus menjadi template scaffolding, bukan hanya metadata.

---

# 21. Recommended Development Workflow

```text
gatra init
     ↓
gatra dev
     ↓
gatra check
     ↓
gatra test
     ↓
gatra fmt
     ↓
gatra build
     ↓
gatra bundle
```

Production workflow:

```text
gatra clean
     ↓
gatra check
     ↓
gatra test
     ↓
gatra build
     ↓
gatra bundle
     ↓
Deploy
```

---

# 22. Command Priority

## P0 — Core CLI

```text
init
run
build
bundle
test
check
fmt
version
help
```

## P1 — Developer Experience

```text
dev
clean
doctor
info
```

## P2 — Advanced Tooling

```text
graph
explain
bench
```

---

# 23. Acceptance Criteria

### CLI

- [ ] Semua command memiliki help text.
- [ ] Invalid command menghasilkan error yang jelas.
- [ ] Invalid argument menghasilkan error yang jelas.
- [ ] Exit code mengikuti status operasi.
- [ ] CLI dapat digunakan melalui Linux, macOS, dan Windows.
- [ ] Output CLI konsisten.

### Project

- [ ] `gatra init` dapat membuat project.
- [ ] `--arch` dapat memilih architecture.
- [ ] `gatra.toml` otomatis dibuat.
- [ ] `package.json` tetap digunakan untuk npm dependencies.

### Development

- [ ] `gatra dev` mendukung file watching.
- [ ] `gatra run` menjalankan `.gatra`.
- [ ] `gatra test` menjalankan test.
- [ ] `gatra check` melakukan static analysis.
- [ ] `gatra fmt` menghasilkan formatting deterministic.

### Build

- [ ] `gatra build` menghasilkan JavaScript.
- [ ] `gatra bundle` menggabungkan dependency.
- [ ] `--samar` dapat digunakan pada build/bundle.
- [ ] `gatra clean` tidak menghapus source code.

### Diagnostics

- [ ] `gatra doctor` dapat mendeteksi environment issue.
- [ ] `gatra info` menampilkan konfigurasi project.
- [ ] `gatra graph` dapat mendeteksi dependency.
- [ ] `gatra explain` menampilkan compiler analysis.
- [ ] `gatra bench` dapat mengukur performance.

---

# 24. Final CLI

Target akhir Gatra CLI:

```text
gatra init
gatra dev
gatra run
gatra build
gatra bundle
gatra test
gatra check
gatra fmt
gatra clean
gatra doctor
gatra info
gatra graph
gatra explain
gatra bench
gatra version
gatra help
```

Dengan demikian Gatra CLI bukan hanya compiler command, tetapi menjadi **complete development toolchain** untuk seluruh lifecycle aplikasi Gatra.