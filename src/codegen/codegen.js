'use strict';

const path = require('path');
const { NodeType: N } = require('../ast/nodes');
const { isPublicName } = require('../module/visibility');

// data<T> — Big Data primitive (BIGDATA_TYPE.md). The runtime lives in a
// real, testable file rather than an inlined prelude string (unlike
// BATAS_PRELUDE/HASIL_PRELUDE below) because it's sizeable and has its own
// unit tests. Required by an absolute path baked in at compile time — same
// resolution story as any other internal require in this compiler (see
// baseVmGlobals() in cli/gatra.js: require() closures resolve relative to
// where they were defined, not to the compiled file's location).
const DATASET_RUNTIME_PATH = path.resolve(__dirname, '../runtime/dataset.js');
const DATASET_PRELUDE = `const { data: __gatra_data__ } = require(${JSON.stringify(DATASET_RUNTIME_PATH)});`;

const DATASET_METHODS = new Set([
  'saring', 'pilih', 'ubah', 'kelompok', 'agregat', 'gabung', 'urutkan',
  'bagi', 'paralel', 'terdistribusi', 'jendela', 'ambil', 'kumpulkan', 'tulis', 'statistik',
]);
const DATASET_JOIN_VARIANTS = new Set(['dalam', 'kiri', 'kanan', 'penuh']);
const DATASET_AGG_FNS = new Set(['hitung', 'jumlah', 'rata_rata', 'minimum', 'maksimum']);
const DURATION_UNITS = { milidetik: 1, detik: 1000, menit: 60000, jam: 3600000, hari: 86400000 };

// Recursively scans an AST for a data.baca<T>()/data.alir<T>() dataset
// source — the one place a data<T> value can be created, so its presence is
// enough to know the runtime prelude is needed.
function usesDataset(node) {
  if (!node || typeof node !== 'object') return false;
  if (Array.isArray(node)) return node.some(usesDataset);
  if (node.type === N.CALL_EXPR && typeof node.callee === 'object' && node.callee.type === N.MEMBER_EXPR &&
      node.callee.object.type === N.IDENTIFIER && node.callee.object.name === 'data' &&
      (node.callee.member === 'baca' || node.callee.member === 'alir')) {
    return true;
  }
  return Object.keys(node).some(k => k !== 'type' && usesDataset(node[k]));
}

// tunggu expr batas N detik — Promise.race antara expr dan timer yang me-reject.
const BATAS_PRELUDE = `function __gatra_batas(ms) {
  return new Promise((_, tolak) => setTimeout(() => tolak(new Error('Timeout')), ms));
}`;

// Recursively scans an AST (or any plain object/array) for an AWAIT_EXPR
// that uses 'batas' (timeoutMs set) — only then is the prelude needed.
function usesTimeout(node) {
  if (!node || typeof node !== 'object') return false;
  if (Array.isArray(node)) return node.some(usesTimeout);
  if (node.type === N.AWAIT_EXPR && node.timeoutMs != null) return true;
  return Object.keys(node).some(k => k !== 'type' && usesTimeout(node[k]));
}

// hasil<T,E> — berhasil(v)/gagal(e) hanya membungkus nilainya dengan tag,
// dibongkar lewat 'cocok'.
const HASIL_PRELUDE = `function __gatra_berhasil(nilai) { return { __tag: 'berhasil', nilai }; }
function __gatra_gagal(galat) { return { __tag: 'gagal', galat }; }`;

// Recursively scans an AST (or any plain object/array) for a zero/one-arg
// call to 'berhasil'/'gagal' (identifier callee) — only then is the
// hasil<T,E> prelude needed.
function usesHasil(node) {
  if (!node || typeof node !== 'object') return false;
  if (Array.isArray(node)) return node.some(usesHasil);
  if (node.type === N.CALL_EXPR && typeof node.callee === 'object' &&
      node.callee.type === N.IDENTIFIER && (node.callee.name === 'berhasil' || node.callee.name === 'gagal')) {
    return true;
  }
  if (node.type === N.MATCH_RESULT_STMT) return true;
  return Object.keys(node).some(k => k !== 'type' && usesHasil(node[k]));
}

// @Nama(...) on a struct/method/param — emitted the same way `tsc
// --experimentalDecorators --emitDecoratorMetadata` does, since that's the
// exact calling convention NestJS's DI container (Reflect.getMetadata
// ('design:paramtypes', ...)) and its param decorators (@Body/@Param/@Query)
// require. Native stage-3 '@decorator' syntax can't do this — it has no
// parameter-decorator support at all.
const DECORATE_PRELUDE = `var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
  var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
  if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
  else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
  return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
  return function (target, key) { decorator(target, key, paramIndex); };
};
var __metadata = (this && this.__metadata) || function (metadataKey, metadataValue) {
  if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(metadataKey, metadataValue);
};`;

// Recursively scans for any non-empty 'decorators' array — struct, receiver
// method, or method param can all carry one.
function usesDecorators(node) {
  if (!node || typeof node !== 'object') return false;
  if (Array.isArray(node)) return node.some(usesDecorators);
  if (Array.isArray(node.decorators) && node.decorators.length > 0) return true;
  return Object.keys(node).some(k => k !== 'type' && usesDecorators(node[k]));
}

// design:paramtypes entries — maps a Gatra type string to the JS value tsc
// would emit for it (primitive wrapper, a real local class, or Object as the
// fallback for anything it can't represent, e.g. arrays/unknown).
const DESIGN_TYPE_PRIMS = {
  number: 'Number', int: 'Number', float: 'Number', byte: 'Number',
  string: 'String', bool: 'Boolean',
};

class CodeGenerator {
  constructor(opts = {}) {
    this.depth        = 0;
    this.isPackage     = false; // true when a PackageDeclaration is present
    // Forces export emission even without 'paket' — set by callers compiling
    // a file specifically because another file imports from it (runEsm's
    // dependency pass, bundel, bangun-proyek). A plain entry-point compile
    // (gatra jalankan/uji on the file the user actually runs) leaves this
    // false so ordinary scripts don't grow stray 'export' and keep using the
    // fast vm.Script sandbox path instead of spawning a real Node subprocess.
    this.emitExports  = !!opts.emitExports;
    this.matchCounter  = 0;
    this.measureCounter = 0;
    this.withCounter   = 0;
    this.withStack     = []; // active 'dengan'/'ubah' IIFE param names — innermost last
    this.dsCounter     = 0;  // fresh-name counter for data<T> record-lambda params
    this.dsStack       = []; // active data<T> record-lambda param names — innermost last
    this.includeTests  = !!opts.includeTests; // 'gatra uji' compiles with tests active
    this.structMethods = new Map(); // struct name → [receiver FnDecl, ...], collected up front by genProgram
    this.structDecls   = new Map(); // struct name → its StructDecl node, collected up front by genProgram
  }

  ind() { return '  '.repeat(this.depth); }

  generate(node) {
    switch (node.type) {
      case N.PROGRAM:         return this.genProgram(node);
      case N.PACKAGE_DECL:    return ''; // metadata — no JS output
      case N.PACKAGE_IMPORT:  return this.genPackageImport(node);
      case N.VAR_DECL:       return this.genVarDecl(node);
      case N.FN_DECL:        return this.genFnDecl(node);
      case N.STRUCT_DECL:    return this.genStructDecl(node);
      case N.IF_STMT:        return this.genIfStmt(node);
      case N.LOOP_STMT:      return this.genLoopStmt(node);
      case N.WHILE_STMT:     return this.genWhileStmt(node);
      case N.TRY_STMT:       return this.genTryStmt(node);
      case N.RETURN_STMT:    return this.genReturnStmt(node);
      case N.BLOCK:          return this.genBlock(node);
      case N.EXPR_STMT:      return this.genExprStmt(node);
      case N.ASSIGN_EXPR:    return this.genAssignExpr(node);
      case N.BINARY_EXPR:    return this.genBinaryExpr(node);
      case N.UNARY_EXPR:     return this.genUnaryExpr(node);
      case N.CALL_EXPR:      return this.genCallExpr(node);
      case N.MEMBER_EXPR:    return this.genMemberExpr(node);
      case N.INDEX_EXPR:     return this.genIndexExpr(node);
      case N.STRUCT_INIT:    return this.genStructInit(node);
      case N.ARRAY_LITERAL:  return this.genArrayLiteral(node);
      case N.AWAIT_EXPR:     return this.genAwaitExpr(node);
      case N.FUNC_EXPR:      return this.genFuncExpr(node);
      case N.NULL_LITERAL:      return 'null';
      case N.OBJECT_LITERAL:    return this.genObjectLiteral(node);
      case N.OBJECT_TRANSFORM_EXPR: return this.genObjectTransformExpr(node);
      case N.TEMPLATE_EXPR:     return this.genTemplateExpr(node);
      case N.DESTRUCTURE_DECL:  return this.genDestructureDecl(node);
      case N.SPREAD_ELEMENT:    return this.genSpreadElement(node);
      case N.TERNARY_EXPR:      return this.genTernaryExpr(node);
      case N.FIELD_EXPR:        return this.genFieldExpr(node);
      case N.NAMED_ARG:         return this.generate(node.value);
      case N.BREAK_STMT:        return 'break';
      case N.CONTINUE_STMT:     return 'continue';
      case N.TYPE_ALIAS_DECL:   return ''; // metadata — no JS output
      case N.MATCH_STMT:        return this.genMatchStmt(node);
      case N.MATCH_RESULT_STMT: return this.genMatchResultStmt(node);
      case N.TEST_DECL:         return this.genTestDecl(node);
      case N.MEASURE_STMT:      return this.genMeasureStmt(node);
      case N.ASSERT_STMT:       return this.genAssertStmt(node);
      case N.JS_BLOCK_STMT:     return node.code.trim();
      case N.IDENTIFIER:
        if (this.withStack.length > 0) return `${this.withStack[this.withStack.length - 1]}.${node.name}`;
        return node.name;
      case N.NUMBER_LITERAL: return String(node.value);
      case N.STRING_LITERAL: return JSON.stringify(node.value);
      case N.BOOL_LITERAL:   return String(node.value);
      default:
        throw new Error(`CodeGen: unknown node type '${node.type}'`);
    }
  }

  // ── Statements ──────────────────────────────────────────────────────────────

  genProgram(node) {
    this.isPackage = node.body.some(s => s.type === N.PACKAGE_DECL);

    // Pre-scan for receiver methods (fungsi (h Hewan) sapa() {...}) so a
    // struct's class body can include methods declared anywhere in the file,
    // not just ones appearing above the struct — this generator otherwise
    // streams statements top-to-bottom in one pass.
    for (const stmt of node.body) {
      if (stmt.type === N.FN_DECL && stmt.receiver) {
        const list = this.structMethods.get(stmt.receiver.type) || [];
        list.push(stmt);
        this.structMethods.set(stmt.receiver.type, list);
      }
      if (stmt.type === N.STRUCT_DECL) {
        this.structDecls.set(stmt.name, stmt);
      }
    }

    const lines = [];

    if (usesTimeout(node)) lines.push(BATAS_PRELUDE);
    if (usesHasil(node)) lines.push(HASIL_PRELUDE);
    if (usesDecorators(node)) lines.push(DECORATE_PRELUDE);
    if (usesDataset(node)) {
      // The dataset prelude is a plain CJS require() (see DATASET_PRELUDE
      // above) — it only runs under 'gatra jalankan'/'uji' (vm.Script
      // sandbox, require injected) or 'node file.js' with no top-level
      // 'export'. A file with 'paket' declared, or compiled with
      // emitExports (gatra bangun/bundel/bangun-proyek), gets real
      // 'export' statements — which makes Node (or this CLI's own
      // js.includes("export ") check in cmdRun/cmdTest) treat it as an ES
      // module / spawn it via runEsm, where a bare require() throws. Not
      // supported in this MVP; fail at compile time instead of shipping a
      // build that crashes at run time.
      if (this.isPackage || this.emitExports) {
        throw new Error(
          "data<T> (Big Data primitive) belum didukung untuk 'gatra bangun'/'bundel'/'bangun-proyek' (output ES module) di MVP ini — jalankan lewat 'gatra jalankan' atau 'gatra uji'."
        );
      }
      lines.push(DATASET_PRELUDE);
    }

    // Emit all imports first (before functions/vars)
    for (const stmt of node.body) {
      if (stmt.type === N.PACKAGE_IMPORT) {
        lines.push(this.genPackageImport(stmt));
      }
    }

    const testDecls = node.body.filter(s => s.type === N.TEST_DECL);
    if (this.includeTests && testDecls.length > 0) {
      lines.push('const __gatra_uji_daftar = [];');
    }

    // Emit all other statements (skip PACKAGE_DECL and PACKAGE_IMPORT; skip
    // TEST_DECL entirely unless compiling for 'gatra uji')
    for (const stmt of node.body) {
      if (stmt.type === N.PACKAGE_DECL || stmt.type === N.PACKAGE_IMPORT) continue;
      if (stmt.type === N.TEST_DECL && !this.includeTests) continue;
      if (stmt.type === N.FN_DECL && stmt.receiver) continue; // emitted inline as part of its struct's class
      lines.push(this.genTopStmt(stmt));
    }

    if (this.includeTests && testDecls.length > 0) {
      lines.push(`(async () => {
  let __gatra_lulus = 0, __gatra_gagal = 0;
  for (const [label, fn] of __gatra_uji_daftar) {
    try {
      await fn();
      __gatra_lulus++;
      console.log('  \\u2713 ' + label);
    } catch (e) {
      __gatra_gagal++;
      console.log('  \\u2717 ' + label);
      console.log('    ' + e.message);
    }
  }
  console.log('\\nHasil: ' + __gatra_lulus + ' lulus, ' + __gatra_gagal + ' gagal');
  if (__gatra_gagal > 0) process.exit(1);
})();`);
    }

    return lines.join('\n');
  }

  genPackageImport(node) {
    if (node.names) {
      return `import { ${node.names.join(', ')} } from ${JSON.stringify(node.source)};`;
    }
    return `import * as ${node.localName} from ${JSON.stringify(node.source)};`;
  }

  genTopStmt(node) {
    const ind = this.ind();
    // Go-style visibility: a top-level fn/struct/var is only emitted with
    // 'export' when the file is a package ('paket' declared) AND its name
    // starts with an uppercase letter. No export/ekspor keyword needed.
    const exported = (this.isPackage || this.emitExports) && node.name && isPublicName(node.name);
    switch (node.type) {
      case N.STRUCT_DECL:
        // A class-decorated struct compiles to 'let X = class {...}; ...;
        // X = __decorate(...);' — 'export' prefixes just the first line
        // fine, since ESM export bindings are live: the later reassignment
        // is still visible to importers.
        return ind + (exported ? 'export ' : '') + this.generate(node);
      case N.FN_DECL:
        return ind + (exported ? 'export ' : '') + this.generate(node);
      case N.VAR_DECL:
        return ind + (exported ? 'export ' : '') + this.generate(node) + ';';
      case N.IF_STMT:
      case N.LOOP_STMT:
      case N.WHILE_STMT:
      case N.TRY_STMT:
      case N.MATCH_STMT:
      case N.MATCH_RESULT_STMT:
      case N.TEST_DECL:
      case N.MEASURE_STMT:
      case N.ASSERT_STMT:
      case N.JS_BLOCK_STMT:
        return ind + this.generate(node);
      default:
        return ind + this.generate(node) + ';';
    }
  }

  genBlockStmt(node) {
    const ind = this.ind();
    switch (node.type) {
      case N.FN_DECL:
      case N.STRUCT_DECL:
      case N.IF_STMT:
      case N.LOOP_STMT:
      case N.WHILE_STMT:
      case N.TRY_STMT:
      case N.MATCH_STMT:
      case N.MATCH_RESULT_STMT:
      case N.TEST_DECL:
      case N.MEASURE_STMT:
      case N.ASSERT_STMT:
      case N.JS_BLOCK_STMT:
        return ind + this.generate(node);
      default:
        return ind + this.generate(node) + ';';
    }
  }

  genVarDecl(node) {
    return `let ${node.name} = ${this.generate(node.value)}`;
  }

  genParams(params) {
    return params.map(p => {
      if (p.rest) return `...${p.name}`;
      return p.default ? `${p.name} = ${this.generate(p.default)}` : p.name;
    }).join(', ');
  }

  genFnDecl(node) {
    const async_ = node.isAsync ? 'async ' : '';
    const params = this.genParams(node.params);
    const body   = this.genBlockBody(node.body);
    return `${async_}function ${node.name}(${params}) {\n${body}\n${this.ind()}}`;
  }

  genAwaitExpr(node) {
    if (node.timeoutMs != null) {
      return `await Promise.race([${this.generate(node.expr)}, __gatra_batas(${node.timeoutMs})])`;
    }
    return `await ${this.generate(node.expr)}`;
  }

  genFuncExpr(node) {
    // A nested function/arrow has its own scope — don't rewrite its own
    // identifiers against an enclosing 'dengan'/'ubah' source.
    const savedWithStack = this.withStack;
    this.withStack = [];

    const params = this.genParams(node.params);
    let out;
    if (node.isArrow) {
      out = node.exprBody
        ? `(${params}) => (${this.generate(node.exprBody)})`
        : `(${params}) => {\n${this.genBlockBody(node.body)}\n${this.ind()}}`;
    } else {
      const async_ = node.isAsync ? 'async ' : '';
      out = `${async_}function(${params}) {\n${this.genBlockBody(node.body)}\n${this.ind()}}`;
    }

    this.withStack = savedWithStack;
    return out;
  }

  genObjectTransformExpr(node) {
    const sourceJs = this.generate(node.source); // resolved in the OUTER with-context
    const param = `__dengan${this.withCounter++}`;
    this.withStack.push(param);
    const props = node.fields.map(f => `${f.name}: ${this.generate(f.value)}`).join(', ');
    this.withStack.pop();
    const spread = node.spread ? `...${param}, ` : '';
    return `((${param}) => ({ ${spread}${props} }))(${sourceJs})`;
  }

  genTryStmt(node) {
    const tryBody = this.genBlockBody(node.tryBlock);
    let out = `try {\n${tryBody}\n${this.ind()}}`;

    if (node.catchBlock) {
      const catchBody = this.genBlockBody(node.catchBlock);
      out += ` catch (${node.catchParam}) {\n${catchBody}\n${this.ind()}}`;
    }

    if (node.finallyBlock) {
      const finallyBody = this.genBlockBody(node.finallyBlock);
      out += ` finally {\n${finallyBody}\n${this.ind()}}`;
    }

    return out;
  }

  genStructDecl(node) {
    const methods = this.structMethods.get(node.name) || [];
    // A class-level decorator (@Injectable/@Controller) switches the struct
    // to a positional, DI-callable constructor. That's independent of
    // whether any individual *method* also carries a decorator (@Get() etc.)
    // — a method/param can be decorated without the class itself being so.
    const classDecorated   = !!(node.decorators && node.decorators.length > 0);
    const methodsDecorated = methods.some(m =>
      (m.decorators && m.decorators.length > 0) ||
      m.params.some(p => p.decorators && p.decorators.length > 0)
    );

    // Pure data struct (no methods, no decorator anywhere) — type-only, emitted as a comment.
    if (!classDecorated && methods.length === 0) {
      const fields = node.fields.map(f => `${f.name}: ${f.type}`).join(', ');
      return `// struct ${node.name} { ${fields} }`;
    }

    // A struct with methods (or a class-level decorator, even with none)
    // needs a real runtime shape — compiles to a plain JS class. A
    // class-decorated struct's constructor takes its fields positionally
    // (what a DI container calls 'new X(dep1, dep2)' with); otherwise it
    // keeps the ergonomic single options-object constructor for struct-literal init.
    this.depth++;
    const ind = this.ind();
    const ctorLine = classDecorated ? this.genPositionalCtor(node) : `${ind}constructor(o) { Object.assign(this, o); }`;
    const methodLines = methods.map(m => this.genReceiverMethod(m)).join('\n\n');
    this.depth--;

    const classBody = methodLines ? `${ctorLine}\n\n${methodLines}` : ctorLine;
    const classSrc   = `class ${node.name} {\n${classBody}\n${this.ind()}}`;

    if (!classDecorated && !methodsDecorated) return classSrc;
    return this.genDecoratedStruct(node, classSrc, methods, classDecorated);
  }

  genPositionalCtor(node) {
    const ind = this.ind();
    const params = node.fields.map(f => f.name).join(', ');
    this.depth++;
    const assigns = node.fields.map(f => `${this.ind()}this.${f.name} = ${f.name};`).join('\n');
    this.depth--;
    return `${ind}constructor(${params}) {\n${assigns}\n${ind}}`;
  }

  // Emits the tsc --experimentalDecorators --emitDecoratorMetadata shape:
  // one __decorate(...) call per decorated method (folding in that method's
  // __param(...) wrappers for decorated params), and — only when the struct
  // itself carries a class-level decorator — a final __decorate(...) call
  // applying those decorators plus constructor design:paramtypes metadata
  // (what NestJS's DI container reads to auto-resolve providers by type).
  // Without a class-level decorator there's no reassignment, so the class
  // stays a plain 'class X {...}' declaration; with one, it becomes
  // 'let X = class {...}; ...; X = __decorate(...)' so the __decorate result
  // can replace the binding.
  genDecoratedStruct(node, classSrc, methods, classDecorated) {
    const ind = this.ind();
    const lines = [classDecorated ? `${ind}let ${node.name} = ${classSrc};` : `${ind}${classSrc}`];

    for (const m of methods) {
      const entries = (m.decorators || []).map(d => this.genDecoratorCall(d));
      m.params.forEach((p, i) => {
        for (const d of (p.decorators || [])) {
          entries.push(`__param(${i}, ${this.genDecoratorCall(d)})`);
        }
      });
      if (entries.length === 0) continue;
      const entriesSrc = entries.map(e => `${ind}  ${e}`).join(',\n');
      lines.push(`${ind}__decorate([\n${entriesSrc}\n${ind}], ${node.name}.prototype, ${JSON.stringify(m.name)}, null);`);
    }

    if (classDecorated) {
      const classEntries = node.decorators.map(d => this.genDecoratorCall(d));
      const paramTypes = node.fields.map(f => this.resolveDesignType(f.type)).join(', ');
      classEntries.push(`__metadata("design:paramtypes", [${paramTypes}])`);
      const classEntriesSrc = classEntries.map(e => `${ind}  ${e}`).join(',\n');
      lines.push(`${ind}${node.name} = __decorate([\n${classEntriesSrc}\n${ind}], ${node.name});`);
    }

    return lines.join('\n');
  }

  genDecoratorCall(d) {
    const args = d.args.map(a => this.generate(a)).join(', ');
    return `${d.name}(${args})`;
  }

  // Gatra type string → what tsc would emit for design:paramtypes: a
  // primitive wrapper, a reference to a local struct that's a real class
  // (methods or its own decorator), or Object as the fallback.
  resolveDesignType(t) {
    if (t.endsWith('?'))  t = t.slice(0, -1);
    if (t.endsWith('[]')) return 'Array';
    if (DESIGN_TYPE_PRIMS[t]) return DESIGN_TYPE_PRIMS[t];
    if (this.structIsClass(t)) return t;
    return 'Object';
  }

  structIsClass(name) {
    if (this.structMethods.get(name)?.length > 0) return true;
    const decl = this.structDecls.get(name);
    return !!(decl && decl.decorators && decl.decorators.length > 0);
  }

  genReceiverMethod(node) {
    const ind    = this.ind();
    const async_ = node.isAsync ? 'async ' : '';
    const params = this.genParams(node.params);

    this.depth++;
    const bindLine = `${this.ind()}const ${node.receiver.name} = this;`;
    const body     = [bindLine, ...node.body.body.map(stmt => this.genBlockStmt(stmt))].join('\n');
    this.depth--;

    return `${ind}${async_}${node.name}(${params}) {\n${body}\n${ind}}`;
  }

  genIfStmt(node) {
    const cond = this.generate(node.condition);
    const then = this.genBlockBody(node.consequent);
    let out = `if (${cond}) {\n${then}\n${this.ind()}}`;
    if (node.alternate) {
      if (node.alternate.type === N.IF_STMT) {
        out += ` else ${this.genIfStmt(node.alternate)}`;
      } else {
        const alt = this.genBlockBody(node.alternate);
        out += ` else {\n${alt}\n${this.ind()}}`;
      }
    }
    return out;
  }

  genLoopStmt(node) {
    const body = this.genBlockBody(node.body);
    if (node.loopType === 'range') {
      const start = this.generate(node.start);
      const end   = this.generate(node.end);
      return `for (let ${node.iter} = ${start}; ${node.iter} < ${end}; ${node.iter}++) {\n${body}\n${this.ind()}}`;
    }
    // for-of
    const src = this.generate(node.source);
    return `for (const ${node.iter} of ${src}) {\n${body}\n${this.ind()}}`;
  }

  genWhileStmt(node) {
    const cond = this.generate(node.condition);
    const body = this.genBlockBody(node.body);
    return `while (${cond}) {\n${body}\n${this.ind()}}`;
  }

  genReturnStmt(node) {
    if (node.value === null) return 'return';
    return `return ${this.generate(node.value)}`;
  }

  genBlock(node) {
    const body = this.genBlockBody(node);
    return `{\n${body}\n${this.ind()}}`;
  }

  genBlockBody(block) {
    this.depth++;
    const lines = block.body.map(stmt => this.genBlockStmt(stmt));
    this.depth--;
    return lines.join('\n');
  }

  genExprStmt(node) {
    return this.generate(node.expr);
  }

  // ── Expressions ─────────────────────────────────────────────────────────────

  genAssignExpr(node) {
    return `${this.generate(node.target)} = ${this.generate(node.value)}`;
  }

  genBinaryExpr(node) {
    const l = this.generate(node.left);
    const r = this.generate(node.right);
    return `(${l} ${node.op} ${r})`;
  }

  genUnaryExpr(node) {
    return `${node.op}${this.generate(node.operand)}`;
  }

  genCallExpr(node) {
    // data<T> methods (.saring/.pilih/.agregat/...) compile their arguments
    // specially (record-implicit lambdas, structural field names, aggregate
    // descriptors) — checked first, before the generic arg codegen below.
    if (typeof node.callee === 'object' && node.callee.type === N.MEMBER_EXPR) {
      const ds = this.genDatasetCall(node);
      if (ds !== undefined) return ds;
    }

    const args = node.args.map(a => this.generate(a)).join(', ');

    // Built-in hasil<T,E> constructors — checked on the raw callee (before
    // any 'dengan'/'ubah' identifier rewriting) so `berhasil(x)` always
    // means the constructor, never a with-source member.
    if (typeof node.callee === 'object' && node.callee.type === N.IDENTIFIER) {
      if (node.callee.name === 'berhasil') return `__gatra_berhasil(${args})`;
      if (node.callee.name === 'gagal')    return `__gatra_gagal(${args})`;
    }

    // Resolve callee
    let callee;
    if (typeof node.callee === 'string') {
      callee = node.callee;
    } else {
      callee = this.generate(node.callee);
    }

    // Built-in print
    if (callee === '__print__') {
      return `console.log(${args})`;
    }

    return `${callee}(${args})`;
  }

  genMemberExpr(node) {
    // Duration literal: 5.menit, 30.detik, ... (BIGDATA_TYPE.md §11.1 .jendela())
    if (node.object.type === N.NUMBER_LITERAL && DURATION_UNITS[node.member] !== undefined) {
      return String(node.object.value * DURATION_UNITS[node.member]);
    }
    const op = node.optional ? '?.' : '.';
    return `${this.generate(node.object)}${op}${node.member}`;
  }

  genFieldExpr(node) {
    if (this.dsStack.length === 0) return `undefined /* .${node.name} outside dataset context */`;
    return `${this.dsStack[this.dsStack.length - 1]}.${node.name}`;
  }

  // Dispatches data<T> method-call codegen. Mirrors the typechecker's
  // inferDatasetCall() detection (see typechecker.js) — undefined means
  // "not a dataset call", so the caller falls back to generic call codegen.
  genDatasetCall(node) {
    const callee = node.callee; // MEMBER_EXPR
    const member = callee.member;

    // data.baca<T>(path) / data.alir<T>(path)
    if (callee.object.type === N.IDENTIFIER && callee.object.name === 'data' &&
        (member === 'baca' || member === 'alir') && callee.typeArg) {
      const args = node.args.map(a => this.generate(a)).join(', ');
      return `__gatra_data__.${member}(${args})`;
    }

    // .gabung.dalam(...)/.kiri(...)/.kanan(...)/.penuh(...)
    if (DATASET_JOIN_VARIANTS.has(member) && callee.object.type === N.MEMBER_EXPR &&
        callee.object.member === 'gabung' && this.isDatasetTyped(callee.object.object)) {
      const dsJs = this.generate(callee.object.object);
      return `${dsJs}.gabung.${member}(${this.genGabungArgs(node.args)})`;
    }

    if (!DATASET_METHODS.has(member) || !this.isDatasetTyped(callee.object)) return undefined;
    const dsJs = this.generate(callee.object);

    switch (member) {
      case 'saring': {
        const lambdaJs = this.genRecordLambdaArg(node.args[0]);
        const nativeDesc = this.simpleComparisonDescriptor(node.args[0]);
        return `${dsJs}.saring(${lambdaJs}${nativeDesc ? `, ${nativeDesc}` : ''})`;
      }
      case 'ubah':
        return `${dsJs}.ubah(${this.genRecordLambdaArg(node.args[0])})`;

      case 'pilih':
      case 'kelompok':
        return `${dsJs}.${member}(${node.args.map(a => JSON.stringify(a.name)).join(', ')})`;

      case 'agregat':
        return `${dsJs}.agregat(${this.genAgregatSpec(node.args[0])})`;

      case 'gabung':
        return `${dsJs}.gabung(${this.genGabungArgs(node.args)})`;

      case 'urutkan': {
        const field = JSON.stringify(node.args[0].name);
        const dir = node.args[1] ? `, ${JSON.stringify(node.args[1].name)}` : '';
        return `${dsJs}.urutkan(${field}${dir})`;
      }

      case 'bagi': {
        const arg = node.args[0];
        const argJs = arg && arg.type === N.FIELD_EXPR ? JSON.stringify(arg.name) : (arg ? this.generate(arg) : '');
        return `${dsJs}.bagi(${argJs})`;
      }

      case 'jendela':
        return `${dsJs}.jendela(${this.genJendelaArg(node.args[0])})`;

      default: {
        const args = node.args.map(a => this.generate(a)).join(', ');
        return `${dsJs}.${member}(${args})`;
      }
    }
  }

  // True when the node's static type (set by the typechecker on node._type)
  // is a resolved data<T>. Codegen never re-derives dataset-ness itself —
  // typecheck() always runs before generate() in the compiler pipeline.
  isDatasetTyped(node) {
    return typeof node._type === 'string' && node._type.startsWith('data<');
  }

  // Best-effort structural descriptor for a single "record.field OP literal"
  // predicate (BIGDATA_TYPE.md canonical examples: .jumlah > 0, .umur >= 18),
  // handed to .saring() alongside its JS closure so the runtime can offload
  // this common case to the native Rust engine when available. Any other
  // predicate shape (&&, function calls, ...) stays JS-closure-only — see
  // native-engine/src/lib.rs and runtime/dataset.js.
  simpleComparisonDescriptor(arg) {
    const OPS = new Set(['>', '<', '>=', '<=', '==', '!=']);
    if (!arg || arg.type !== N.BINARY_EXPR || !OPS.has(arg.op)) return null;
    if (arg.left.type !== N.FIELD_EXPR) return null;
    const litTypes = new Set([N.NUMBER_LITERAL, N.STRING_LITERAL, N.BOOL_LITERAL]);
    if (!litTypes.has(arg.right.type)) return null;
    const value = arg.right.value;
    return `{ field: ${JSON.stringify(arg.left.name)}, op: ${JSON.stringify(arg.op)}, value: ${JSON.stringify(value)} }`;
  }

  // Wraps a single field-expression argument (predicate / transform) into an
  // implicit-record arrow function: .saring(.jumlah > 0) → (r) => (r.jumlah > 0)
  genRecordLambdaArg(arg) {
    const param = `__r${this.dsCounter++}`;
    this.dsStack.push(param);
    const body = this.generate(arg);
    this.dsStack.pop();
    return `(${param}) => (${body})`;
  }

  // .jendela(5.menit) or .jendela({ durasi: 5.menit, berdasarkan: .waktu })
  genJendelaArg(arg) {
    if (!arg) return '';
    const param = `__r${this.dsCounter++}`;
    this.dsStack.push(param);
    const body = this.generate(arg);
    this.dsStack.pop();
    return body;
  }

  // .agregat({ total: hitung(), pendapatan: jumlah(.jumlah) }) → a plain
  // descriptor object (hitung/jumlah/... are markers, never real calls) so
  // the runtime — and the native Rust engine when available — can execute
  // it structurally instead of needing to invoke arbitrary JS.
  genAgregatSpec(objLiteral) {
    const props = objLiteral.fields.map(f => {
      const call = f.value; // CALL_EXPR{ callee: Identifier(fnName), args: [FieldExpr?] }
      const fnName = call.callee.name;
      const fieldArg = call.args[0];
      const field = fieldArg && fieldArg.type === N.FIELD_EXPR ? JSON.stringify(fieldArg.name) : 'null';
      return `${f.name}: { fn: ${JSON.stringify(fnName)}, field: ${field} }`;
    }).join(', ');
    return `{ ${props} }`;
  }

  // .gabung(other, pada: .a == .b) — 'pada's condition sees a single merged
  // pseudo-record ({ ...left, ...right }); see BIGDATA_TYPE.md §9.3. Known
  // MVP limitation: a field name present on both sides collides (last one,
  // the right side, wins) since there's no static schema to disambiguate by.
  genGabungArgs(args) {
    const pada = args.find(a => a.type === N.NAMED_ARG && a.name === 'pada');
    const other = args.find(a => a !== pada);
    const otherJs = this.generate(other);
    if (!pada) return otherJs;

    const l = `__gl${this.dsCounter}`;
    const r = `__gr${this.dsCounter}`;
    const m = `__gm${this.dsCounter++}`;
    this.dsStack.push(m);
    const condJs = this.generate(pada.value);
    this.dsStack.pop();
    return `${otherJs}, { pada: (${l}, ${r}) => { const ${m} = Object.assign({}, ${l}, ${r}); return (${condJs}); } }`;
  }

  genIndexExpr(node) {
    return `${this.generate(node.object)}[${this.generate(node.index)}]`;
  }

  genStructInit(node) {
    const declNode = this.structDecls.get(node.name);
    // A decorated struct's constructor takes fields positionally (see
    // genPositionalCtor) — reorder the literal's values to match the
    // struct's declared field order regardless of what order they were
    // written in here.
    if (declNode && declNode.decorators && declNode.decorators.length > 0) {
      const byName = new Map(node.fields.map(f => [f.name, f.value]));
      const args = declNode.fields.map(f => this.generate(byName.get(f.name))).join(', ');
      return `new ${node.name}(${args})`;
    }

    const props = node.fields.map(f => `${f.name}: ${this.generate(f.value)}`).join(', ');
    // A struct with receiver methods (but no decorator) compiles to a real
    // class too (see genStructDecl) — its literal must go through 'new' to
    // get the prototype's methods; a plain data struct stays a bare object.
    if (this.structMethods.get(node.name)?.length > 0) {
      return `new ${node.name}({ ${props} })`;
    }
    return `{ ${props} }`;
  }

  genArrayLiteral(node) {
    const elems = node.elements.map(e => this.generate(e)).join(', ');
    return `[${elems}]`;
  }

  genObjectLiteral(node) {
    if (node.fields.length === 0) return '{}';
    const props = node.fields.map(f => {
      if (f.spread) return `...${this.generate(f.value)}`;
      return `${f.name}: ${this.generate(f.value)}`;
    }).join(', ');
    return `{ ${props} }`;
  }

  genTemplateExpr(node) {
    const body = node.parts.map(p => {
      if (p.kind === 'text') return p.value.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
      return '${' + this.generate(p.expr) + '}';
    }).join('');
    return '`' + body + '`';
  }

  genDestructureDecl(node) {
    if (node.kind === 'object') {
      const bindings = node.bindings.map(b => b.prop === b.name ? b.name : `${b.prop}: ${b.name}`).join(', ');
      return `let { ${bindings} } = ${this.generate(node.value)}`;
    }
    const bindings = node.bindings.map(b => b.name).join(', ');
    return `let [${bindings}] = ${this.generate(node.value)}`;
  }

  genSpreadElement(node) {
    return `...${this.generate(node.value)}`;
  }

  genTestDecl(node) {
    const body = this.genBlockBody(node.body);
    return `__gatra_uji_daftar.push([${JSON.stringify(node.label)}, async () => {\n${body}\n${this.ind()}}]);`;
  }

  genMeasureStmt(node) {
    const tmp = `__ukur${this.measureCounter++}`;
    this.depth++;
    const ind1     = this.ind();
    const startLine = `${ind1}const ${tmp} = performance.now();`;
    const tryBody   = this.genBlockBody(node.body);
    const finallyLine = `${ind1}  console.log(${JSON.stringify(node.label)} + ': ' + Math.round(performance.now() - ${tmp}) + 'ms');`;
    this.depth--;
    return `{\n${startLine}\n${ind1}try {\n${tryBody}\n${ind1}} finally {\n${finallyLine}\n${ind1}}\n${this.ind()}}`;
  }

  genAssertStmt(node) {
    const exprJs = this.generate(node.expr);
    const pesan  = exprJs.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    return `if (!(${exprJs})) { throw new Error('Pastikan gagal: ${pesan}'); }`;
  }

  genMatchStmt(node) {
    const tmp  = `__cocok${this.matchCounter++}`;
    const disc = this.generate(node.discriminant);
    let out = `const ${tmp} = ${disc};\n${this.ind()}`;

    node.cases.forEach((c, i) => {
      const test = this.generate(c.test);
      this.depth++;
      const bodyLine = this.genBlockStmt(c.body);
      this.depth--;
      out += `${i === 0 ? 'if' : 'else if'} (${tmp} === ${test}) {\n${bodyLine}\n${this.ind()}} `;
    });

    if (node.defaultCase) {
      this.depth++;
      const bodyLine = this.genBlockStmt(node.defaultCase);
      this.depth--;
      out += `else {\n${bodyLine}\n${this.ind()}}`;
    }

    return out.trimEnd();
  }

  genMatchResultStmt(node) {
    const tmp  = `__cocok${this.matchCounter++}`;
    const disc = this.generate(node.discriminant);
    let out = `const ${tmp} = ${disc};\n${this.ind()}`;

    const parts = [];
    if (node.okArm) {
      this.depth++;
      const bindLine = `${this.ind()}const ${node.okArm.binding} = ${tmp}.nilai;`;
      const bodyLine = this.genBlockStmt(node.okArm.body);
      this.depth--;
      parts.push(`if (${tmp}.__tag === 'berhasil') {\n${bindLine}\n${bodyLine}\n${this.ind()}}`);
    }
    if (node.errArm) {
      this.depth++;
      const bindLine = `${this.ind()}const ${node.errArm.binding} = ${tmp}.galat;`;
      const bodyLine = this.genBlockStmt(node.errArm.body);
      this.depth--;
      parts.push(`if (${tmp}.__tag === 'gagal') {\n${bindLine}\n${bodyLine}\n${this.ind()}}`);
    }

    return out + parts.join(' ');
  }

  genTernaryExpr(node) {
    return `(${this.generate(node.condition)} ? ${this.generate(node.consequent)} : ${this.generate(node.alternate)})`;
  }
}

function generate(ast, opts) {
  return new CodeGenerator(opts).generate(ast);
}

module.exports = { CodeGenerator, generate };
