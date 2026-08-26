'use strict';

const { NodeType: N } = require('../ast/nodes');
const { SymbolTable }  = require('./symbol-table');
const { makeErrors }   = require('./type-errors');
const { resolveLocalPath, getModuleExports } = require('../module/resolver');
const { isPublicName } = require('../module/visibility');
const { isBuiltinModule, getExternalMembers, classifyExternalAccess } = require('../module/external-interop');
const fs = require('fs');

// Tipe numerik: 'number' (angka, generik) mencakup 'int' (bilangan), 'float'
// (pecahan), dan 'byte'. 'numeric' pada pairs berarti "salah satu dari ini".
const NUMERIC_TYPES = new Set(['number', 'int', 'float', 'byte']);

// Hasil promosi dua operand numerik: generik ('number') menang paling luas,
// lalu 'float' > 'int' > 'byte'.
function promoteNumeric(a, b) {
  if (a === 'number' || b === 'number') return 'number';
  if (a === 'float'  || b === 'float')  return 'float';
  if (a === 'int'    || b === 'int')    return 'int';
  return 'byte';
}

// Which type pairs are valid for each binary operator, and what type they produce
const OPERATOR_RULES = {
  '+':  { pairs: [['numeric','numeric'],['string','string']], result: (l, r) => l === 'string' ? l : promoteNumeric(l, r) },
  '-':  { pairs: [['numeric','numeric']], result: promoteNumeric },
  '*':  { pairs: [['numeric','numeric']], result: promoteNumeric },
  '/':  { pairs: [['numeric','numeric']], result: promoteNumeric },
  '>':  { pairs: [['numeric','numeric']], result: () => 'bool' },
  '<':  { pairs: [['numeric','numeric']], result: () => 'bool' },
  '>=': { pairs: [['numeric','numeric']], result: () => 'bool' },
  '<=': { pairs: [['numeric','numeric']], result: () => 'bool' },
  '==': { pairs: 'same', result: () => 'bool' },
  '!=': { pairs: 'same', result: () => 'bool' },
  '&&': { pairs: [['bool','bool']], result: () => 'bool' },
  '||': { pairs: [['bool','bool']], result: () => 'bool' },
};

class TypeChecker {
  constructor(grammar, opts = {}) {
    this.grammar    = grammar || 'en';
    this.err        = makeErrors(this.grammar);
    this.symbols    = new SymbolTable();
    this.currentFn  = null; // { name, returnType } of the fn being checked
    this.typeAliases = {}; // name → canonical target type (from 'tipe' declarations)
    this.methods = {}; // struct name → Map(method name → { params, returnType }), from receiver funcs
    this.withStack   = []; // active 'dengan'/'ubah' source vars — bare identifiers inside their fields resolve as member access, not a normal lookup
    // True while type-checking inside a 'tanpa_periksa(...)' call's argument
    // expressions — suppresses unsafeClosureCapture the same way checkMoveSafety's
    // 'unsafe' flag suppresses usedAfterMove, so the escape hatch actually
    // escapes BOTH checks it's documented (and its own error message) to cover.
    this.suppressClosureCapture = false;
    // Absolute path of the file being checked — needed to resolve relative
    // 'impor' sources for cross-module Go-style visibility checks. Without
    // it (e.g. checking an in-memory snippet), local imports fall back to
    // the old lax/untyped behavior instead of hard-erroring.
    this.filePath = opts.filePath ? require('path').resolve(opts.filePath) : null;

    // Built-in functions registered in the global scope
    this.symbols.define('__print__', {
      kind: 'fn', name: '__print__',
      params: [], returnType: 'void', variadic: true,
    });
    // berhasil(v) / gagal(e) — konstruktor hasil<T,E>. 'builtin' supaya tetap
    // bisa di-shadow oleh deklarasi pengguna (konsisten dgn builtin lain).
    this.symbols.define('berhasil', {
      kind: 'fn', name: 'berhasil', params: [], returnType: 'unknown', variadic: true, builtin: true,
    });
    this.symbols.define('gagal', {
      kind: 'fn', name: 'gagal', params: [], returnType: 'unknown', variadic: true, builtin: true,
    });
    // tanpa_periksa(expr) — Concurrency Safety's explicit 'unsafe' escape
    // hatch (Automatic_Concurrency.md): a no-op identity wrapper at runtime
    // (codegen unwraps it back to just 'expr'), but checkMoveSafety() below
    // recognizes the call syntactically and skips move-tracking for
    // whatever it wraps — the one way around usedAfterMove/
    // unsafeClosureCapture when the programmer is certain a given use is
    // actually safe. Always visible in the source, per the doc's own
    // "concurrency yang berbahaya harus terlihat jelas oleh developer".
    this.symbols.define('tanpa_periksa', {
      kind: 'fn', name: 'tanpa_periksa', params: [], returnType: 'unknown', variadic: true, builtin: true,
    });

    // ke_teks/ke_angka/dst — konversi tipe eksplisit (satu argumen apapun,
    // tipe kembalian tetap sesuai namanya). 'builtin: true' supaya tetap bisa
    // di-shadow user, konsisten dgn builtin lain di atas.
    const KONVERSI_RETURN_TYPES = {
      ke_teks:    'string',
      ke_angka:   'number',
      ke_bilangan:'int',
      ke_pecahan: 'float',
      ke_byte:    'byte',
      ke_logika:  'bool',
    };
    for (const [name, returnType] of Object.entries(KONVERSI_RETURN_TYPES)) {
      this.symbols.define(name, {
        kind: 'fn', name, params: [{ type: 'unknown' }], returnType, builtin: true,
      });
    }

    // keTeks/keLarik/gabung — conversion & sequence operations. Tiga peran
    // yang sengaja tidak tumpang tindih:
    //   keTeks  : Value  -> Teks   (konversi nilai tunggal, sama seperti ke_teks)
    //   keLarik : Iterable -> Larik (materialization eksplisit — Array.from)
    //   gabung  : Iterable -> Teks (join langsung, TIDAK lewat Larik antara)
    // 'iterable'/'nilai' bertipe 'unknown' karena Gatra belum punya tipe
    // Iterable/Sequence sendiri — parameternya menerima larik, teks, Map,
    // Set, atau iterator/generator JS mentah apa pun (lihat KONVERSI_FNS di
    // codegen.js). keLarik mengembalikan 'unknown' (bukan 'T[]') karena tipe
    // elemennya tidak diketahui statis dari sebuah Iterable generik.
    this.symbols.define('keTeks', {
      kind: 'fn', name: 'keTeks', params: [{ type: 'unknown' }], returnType: 'string', builtin: true,
    });
    this.symbols.define('keLarik', {
      kind: 'fn', name: 'keLarik', params: [{ type: 'unknown' }], returnType: 'unknown', builtin: true,
    });
    this.symbols.define('gabung', {
      kind: 'fn', name: 'gabung', params: [{ type: 'unknown' }, { type: 'unknown' }], returnType: 'string', builtin: true,
    });
  }

  // ── Public entry point ──────────────────────────────────────────────────────

  check(ast) {
    // Rule P1: max one package declaration per file
    const pkgDecls = ast.body.filter(s => s.type === N.PACKAGE_DECL);
    if (pkgDecls.length > 1) {
      const { makePackageErrors } = require('../package/package-errors');
      throw makePackageErrors(this.grammar).multipleDeclarations(
        pkgDecls[1].line, pkgDecls[1].col
      );
    }
    for (const stmt of ast.body) this.checkStmt(stmt);

    // Concurrency Safety post-passes — run after the main pass so struct
    // method tables (this.methods) are fully populated regardless of
    // declaration order, and every symbol/type in the program is already
    // known-valid to build on.
    this.checkParallelWorkerTransfer(ast);
    this.checkMoveSafety(ast);
  }

  // Worker transfer validation: a 'fungsi paralel' param or return type that
  // resolves to a struct with methods or a class-level decorator compiles to
  // a real JS 'class' (see codegen.js's genStructDecl) — not safe to send
  // across the worker_threads structured-clone boundary (methods/prototypes
  // don't survive it), and its declaration would hit the same
  // worker-never-reaches-it TDZ problem unsafeClosureCapture guards against
  // for plain variables. Only plain-data structs (fields only, no methods,
  // no decorator — which compile to nothing but a type comment) are allowed.
  checkParallelWorkerTransfer(ast) {
    const structDecls = new Map();
    for (const s of ast.body) {
      if (s.type === N.STRUCT_DECL) structDecls.set(s.name, s);
    }

    const isPlainDataType = (t) => {
      if (!t) return true;
      let base = t;
      while (base.endsWith('[]')) base = base.slice(0, -2);
      if (base.endsWith('?')) base = base.slice(0, -1);
      const decl = structDecls.get(base);
      if (!decl) return true; // primitive, map<K,V>, or unknown — not this check's concern
      const hasDecorators = !!(decl.decorators && decl.decorators.length > 0);
      const hasMethods = !!(this.methods[base] && this.methods[base].size > 0);
      return !hasDecorators && !hasMethods;
    };

    for (const stmt of ast.body) {
      if (stmt.type !== N.FN_DECL || !stmt.isParallel) continue;
      for (const p of stmt.params) {
        if (!isPlainDataType(p.type)) {
          const what = this.grammar === 'id' ? `Parameter '${p.name}'` : `Parameter '${p.name}'`;
          throw this.err.paralelNeedsPlainData(what, stmt.name, p.type, stmt.line, stmt.col);
        }
      }
      if (stmt.returnType && !isPlainDataType(stmt.returnType)) {
        const what = this.grammar === 'id' ? 'Tipe kembalian' : 'Return type';
        throw this.err.paralelNeedsPlainData(what, stmt.name, stmt.returnType, stmt.line, stmt.col);
      }
    }
  }

  // Move checking + use-after-move: passing a variable straight into a
  // 'fungsi paralel' call transfers it to the worker/scheduler — ownership
  // rule from Automatic_Concurrency.md's original example:
  //   isi data = buatData()
  //   proses(data)
  //   cetak(data)   // GALAT: 'data' sudah dipindah
  // Scans each function body (and the top-level statement list) as one flat,
  // program-order sequence — a name entering any nested block (jika/selama/
  // dst.) still counts as moved for anything after that block, even on a
  // branch that didn't run; conservative on purpose (a false "already
  // moved" beats a missed real one), and 'tanpa_periksa(...)' is the
  // explicit way out when the programmer is certain that's fine here.
  // General points-to/interprocedural aliasing is undecidable to do exactly
  // — not attempted here. What IS tracked: direct one-hop aliases created by
  // 'isi b = a' (or 'b = a') — a bare-identifier copy with no computation in
  // between — resolved through 'resolveAlias' below so 'b' and 'a' share the
  // same moved-tracking identity from that point on. This closes the exact
  // gap the un-aliased version of this check left open: passing 'data' to a
  // paralel call, then reading it again through a same-named copy made just
  // before the call, used to slip past 'usedAfterMove' silently.
  checkMoveSafety(ast) {
    const parallelFns = new Set();
    for (const s of ast.body) {
      if (s.type === N.FN_DECL && s.isParallel) parallelFns.add(s.name);
    }
    if (parallelFns.size === 0) return;

    const resolveAlias = (aliases, name) => {
      const seen = new Set();
      while (aliases.has(name) && !seen.has(name)) {
        seen.add(name);
        name = aliases.get(name);
      }
      return name;
    };

    // 'unsafe' is true for anything nested inside a tanpa_periksa(...)
    // wrapper — suppresses the "already moved" read-check (that's the whole
    // point of the escape hatch) while still tracking any *new* moves found
    // within it normally, so e.g. tanpa_periksa(x) followed by a real
    // (non-wrapped) proses(x) two lines later still moves x for real.
    const scan = (node, moved, aliases, unsafe) => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) { for (const n of node) scan(n, moved, aliases, unsafe); return; }

      // Function bodies always get their own independent scan (see the loop
      // below) — never inherit whatever 'moved' set the caller is tracking.
      if (node.type === N.FN_DECL) return;

      if (node.type === N.CALL_EXPR && typeof node.callee === 'object' && node.callee.type === N.IDENTIFIER) {
        if (node.callee.name === 'tanpa_periksa') {
          for (const a of node.args) scan(a, moved, aliases, true);
          return;
        }
        if (parallelFns.has(node.callee.name)) {
          for (const arg of node.args) {
            if (arg.type === N.IDENTIFIER) {
              const real = resolveAlias(aliases, arg.name);
              if (!unsafe && moved.has(real)) throw this.err.usedAfterMove(arg.name, arg.line, arg.col);
              moved.set(real, { line: arg.line, col: arg.col });
            } else {
              scan(arg, moved, aliases, unsafe);
            }
          }
          return;
        }
      }

      if (node.type === N.IDENTIFIER) {
        if (!unsafe && moved.has(resolveAlias(aliases, node.name))) throw this.err.usedAfterMove(node.name, node.line, node.col);
        return;
      }

      if (node.type === N.ASSIGN_EXPR) {
        scan(node.value, moved, aliases, unsafe);
        if (node.target.type === N.IDENTIFIER) {
          moved.delete(node.target.name); // reassignment = fresh ownership
          if (node.value.type === N.IDENTIFIER) aliases.set(node.target.name, resolveAlias(aliases, node.value.name));
          else aliases.delete(node.target.name);
        } else {
          scan(node.target, moved, aliases, unsafe);
        }
        return;
      }

      if (node.type === N.VAR_DECL) {
        if (node.value) scan(node.value, moved, aliases, unsafe);
        moved.delete(node.name); // fresh binding, even if it shadows an outer moved name
        if (node.value && node.value.type === N.IDENTIFIER) aliases.set(node.name, resolveAlias(aliases, node.value.name));
        else aliases.delete(node.name);
        return;
      }

      for (const k of Object.keys(node)) {
        if (k === 'type') continue;
        scan(node[k], moved, aliases, unsafe);
      }
    };

    scan(ast.body, new Map(), new Map(), false); // top-level statements share one linear scope
    for (const s of ast.body) {
      if (s.type === N.FN_DECL && s.body) scan(s.body.body, new Map(), new Map(), false);
    }
  }

  // ── Statements ──────────────────────────────────────────────────────────────

  checkStmt(node) {
    switch (node.type) {
      case N.VAR_DECL:          return this.checkVarDecl(node);
      case N.DESTRUCTURE_DECL:  return this.checkDestructureDecl(node);
      case N.FN_DECL:           return this.checkFnDecl(node);
      case N.STRUCT_DECL:    return this.checkStructDecl(node);
      case N.IF_STMT:        return this.checkIfStmt(node);
      case N.LOOP_STMT:      return this.checkLoopStmt(node);
      case N.WHILE_STMT:     return this.checkWhileStmt(node);
      case N.TRY_STMT:       return this.checkTryStmt(node);
      case N.RETURN_STMT:    return this.checkReturnStmt(node);
      case N.EXPR_STMT:      return this.checkExprStmt(node);
      case N.PACKAGE_DECL:   return; // metadata only, no type checking needed
      case N.PACKAGE_IMPORT: return this.checkPackageImport(node);
      case N.BREAK_STMT:     return;
      case N.CONTINUE_STMT:  return;
      case N.TYPE_ALIAS_DECL: return this.checkTypeAliasDecl(node);
      case N.MATCH_STMT:     return this.checkMatchStmt(node);
      case N.MATCH_RESULT_STMT: return this.checkMatchResultStmt(node);
      case N.TEST_DECL:      return this.checkTestDecl(node);
      case N.ASSERT_STMT:    return this.checkAssertStmt(node);
      case N.MEASURE_STMT:   return this.checkMeasureStmt(node);
      case N.JS_BLOCK_STMT:  return; // raw escape hatch — not type-checked
      default:
        throw new Error(`TypeChecker: unhandled statement '${node.type}'`);
    }
  }

  checkTypeAliasDecl(node) {
    if (this.typeAliases[node.name] || this.symbols.existsInCurrent(node.name)) {
      throw this.err.duplicateVar(node.name, node.line, node.col);
    }
    this.typeAliases[node.name] = node.target;
  }

  checkTestDecl(node) {
    const prevFn = this.currentFn;
    // Test bodies are implicitly async so 'tunggu' works without 'asinkron'
    this.currentFn = { name: `<uji: ${node.label}>`, returnType: 'void', isAsync: true };
    this.symbols.push();
    for (const s of node.body.body) this.checkStmt(s);
    this.symbols.pop();
    this.currentFn = prevFn;
  }

  checkAssertStmt(node) {
    const t = this.inferExpr(node.expr);
    if (t !== 'bool' && t !== 'unknown') {
      throw this.err.typeMismatch('bool', t, node.expr.line, node.expr.col);
    }
  }

  checkMeasureStmt(node) {
    // Berjalan inline di konteks yang mengelilinginya — 'tunggu' di dalamnya
    // tetap butuh fungsi asinkron seperti biasa, tidak dipaksa async di sini.
    this.symbols.push();
    for (const s of node.body.body) this.checkStmt(s);
    this.symbols.pop();
  }

  checkMatchResultStmt(node) {
    this.inferExpr(node.discriminant);
    if (node.okArm) {
      this.symbols.push();
      this.symbols.define(node.okArm.binding, {
        kind: 'var', type: 'unknown', mutable: false, line: node.line, col: node.col,
      });
      this.checkStmt(node.okArm.body);
      this.symbols.pop();
    }
    if (node.errArm) {
      this.symbols.push();
      this.symbols.define(node.errArm.binding, {
        kind: 'var', type: 'unknown', mutable: false, line: node.line, col: node.col,
      });
      this.checkStmt(node.errArm.body);
      this.symbols.pop();
    }
  }

  checkMatchStmt(node) {
    const discType = this.inferExpr(node.discriminant);
    for (const c of node.cases) {
      const testType = this.inferExpr(c.test);
      if (!this.compatible(discType, testType)) {
        throw this.err.typeMismatch(discType, testType, c.test.line, c.test.col);
      }
      this.symbols.push();
      this.checkStmt(c.body);
      this.symbols.pop();
    }
    if (node.defaultCase) {
      this.symbols.push();
      this.checkStmt(node.defaultCase);
      this.symbols.pop();
    }
  }

  checkPackageImport(node) {
    const localPath = (node.source.startsWith('.') && this.filePath)
      ? resolveLocalPath(this.filePath, node.source)
      : null;

    if (node.names) {
      // impor { Nama1, Nama2 } dari "path" — named import, Go-style visibility enforced
      for (const name of node.names) {
        if (this.symbols.existsInCurrent(name)) {
          throw this.err.duplicateVar(name, node.line, node.col);
        }
      }

      if (localPath) {
        if (!fs.existsSync(localPath)) {
          const { makePackageErrors } = require('../package/package-errors');
          throw makePackageErrors(this.grammar).notFound(node.names.join(', '), node.source, node.line, node.col);
        }
        const exportsMap = getModuleExports(localPath);
        for (const name of node.names) {
          const entry = exportsMap.get(name);
          if (!entry) {
            const { makePackageErrors } = require('../package/package-errors');
            throw makePackageErrors(this.grammar).identifierNotFound(name, node.source, node.line, node.col);
          }
          if (!entry.public) {
            const { makePackageErrors } = require('../package/package-errors');
            throw makePackageErrors(this.grammar).accessDenied(name, node.line, node.col);
          }
          this.defineImportedName(name, entry, node);
        }
      } else {
        // External package (npm) or Node builtin — same PascalCase-public
        // convention as namespace-style access (external-interop.js): a
        // requested name matching a real lowercase/camelCase export used
        // directly is rejected; anything else (including a whole npm
        // package whose exports aren't statically knowable) stays lax at
        // compile time and is resolved for real at runtime by codegen's
        // __gatra_resolve_named__ — see genPackageImport().
        const members = getExternalMembers(node.source, this.filePath);
        for (const name of node.names) {
          const result = classifyExternalAccess(members, name);
          if (result.violation) {
            const { makePackageErrors } = require('../package/package-errors');
            throw makePackageErrors(this.grammar).externalMemberNotPublic(name, node.source, node.line, node.col);
          }
          this.symbols.define(name, { kind: 'var', type: 'unknown', mutable: true, line: node.line, col: node.col });
        }
      }
      return;
    }

    if (this.symbols.existsInCurrent(node.localName)) {
      throw this.err.duplicateVar(node.localName, node.line, node.col);
    }
    // Register namespace as 'package' kind — member access returns 'unknown',
    // except for a Go-style visibility check against internal (lowercase)
    // members: local .gatra modules via resolvedPath, any external module
    // (builtin or npm) via externalMembers/isBuiltin — see
    // external-interop.js and inferMemberExpr() below.
    this.symbols.define(node.localName, {
      kind: 'package',
      packageName: node.localName,
      source: node.source,
      resolvedPath: localPath && fs.existsSync(localPath) ? localPath : null,
      isExternal: !localPath,
      isBuiltin: !localPath && isBuiltinModule(node.source),
      externalMembers: localPath ? null : getExternalMembers(node.source, this.filePath),
      line: node.line,
      col:  node.col,
    });
  }

  // Copies a resolved cross-module declaration into the local scope so the
  // imported name typechecks like the real thing (struct field access,
  // fn call arity, class instantiation) rather than degrading to 'unknown'.
  defineImportedName(name, entry, node) {
    const d = entry.decl;
    switch (entry.kind) {
      case 'fn':
        this.symbols.define(name, {
          kind: 'fn', name, params: d.params, returnType: d.returnType || 'void',
          line: node.line, col: node.col,
        });
        return;
      case 'struct':
        this.symbols.define(name, {
          kind: 'struct', name, fields: d.fields,
          line: node.line, col: node.col,
        });
        // Receiver methods declared on this struct in its own module ride
        // along with the import (see getModuleExports() in resolver.js) —
        // without this, a method call on an imported struct instance would
        // wrongly fail as "no such field" (this.methods is otherwise only
        // ever populated by scanning the CURRENT file's own 'fungsi (r T)
        // ...' declarations).
        if (entry.methods && entry.methods.length > 0) {
          const table = this.methods[name] || (this.methods[name] = new Map());
          for (const m of entry.methods) {
            table.set(m.name, { params: m.params, returnType: m.returnType });
          }
        }
        return;
      case 'type':
        this.typeAliases[name] = d.target;
        this.symbols.define(name, { kind: 'var', type: 'unknown', mutable: false, line: node.line, col: node.col });
        return;
      default:
        this.symbols.define(name, { kind: 'var', type: 'unknown', mutable: true, line: node.line, col: node.col });
    }
  }

  checkVarDecl(node) {
    if (this.symbols.isUserDefinedInCurrent(node.name)) {
      throw this.err.duplicateVar(node.name, node.line, node.col);
    }

    const valueType = this.inferExpr(node.value);

    if (node.varType !== null) {
      if (!this.compatible(node.varType, valueType)) {
        throw this.err.typeMismatch(node.varType, valueType, node.value.line, node.value.col);
      }
      this.checkNumericLiteralFits(node.varType, node.value);
    }

    const resolvedType = node.varType || valueType;
    node._resolvedType = resolvedType;

    // Anonymous function stored in variable — register as callable fn
    if (node.value.type === N.FUNC_EXPR) {
      this.symbols.define(node.name, {
        kind: 'fn', name: node.name,
        params: node.value.params,
        returnType: node.value.returnType || 'void',
        isAsync: node.value.isAsync || false,
        line: node.line, col: node.col,
      });
      return;
    }

    this.symbols.define(node.name, {
      kind: 'var', type: resolvedType, mutable: node.mutable || false,
      line: node.line, col: node.col,
    });
  }

  checkDestructureDecl(node) {
    this.inferExpr(node.value);
    for (const b of node.bindings) {
      this.symbols.define(b.name, {
        kind: 'var', type: 'unknown', mutable: node.mutable || false,
        line: node.line, col: node.col,
      });
    }
  }

  checkFnDecl(node) {
    const returnType = node.returnType || 'void';

    if (node.isParallel && node.receiver) {
      throw this.err.paralelNeedsTopLevel(node.name, node.line, node.col);
    }

    if (node.receiver) {
      // Go-style receiver method: fungsi (h Hewan) sapa() { ... } — attached
      // to struct 'Hewan', not a global name, so it lives in its own
      // per-struct table instead of the symbol table (two structs may each
      // freely have a method with the same name, like Go).
      const structInfo = this.symbols.lookup(node.receiver.type);
      if (!structInfo || structInfo.kind !== 'struct') {
        throw this.err.unknownType(node.receiver.type, node.line, node.col);
      }

      const table = this.methods[node.receiver.type] || (this.methods[node.receiver.type] = new Map());
      if (table.has(node.name)) {
        throw this.err.duplicateVar(`${node.receiver.type}.${node.name}`, node.line, node.col);
      }
      table.set(node.name, { params: node.params, returnType });
      this.checkDecorators(node.decorators);

      const prevFn   = this.currentFn;
      this.currentFn = { name: `${node.receiver.type}.${node.name}`, returnType, isAsync: node.isAsync || false };

      this.symbols.push();
      this.symbols.define(node.receiver.name, {
        kind: 'var', type: node.receiver.type, mutable: false,
        line: node.line, col: node.col,
      });
      for (const p of node.params) {
        this.checkDecorators(p.decorators);
        if (p.default) {
          this.inferExpr(p.default);
          this.checkNumericLiteralFits(p.type, p.default);
        }
        this.symbols.define(p.name, {
          kind: 'var', type: p.type, mutable: p.mutable || false,
          line: node.line, col: node.col,
        });
      }
      for (const stmt of node.body.body) this.checkStmt(stmt);
      this.symbols.pop();

      this.currentFn = prevFn;
      return;
    }

    if (this.symbols.isUserDefinedInCurrent(node.name)) {
      throw this.err.duplicateVar(node.name, node.line, node.col);
    }

    // Plain (non-receiver) functions never become a class member, so a
    // decorator on one would have nothing to attach to at codegen time.
    if (node.decorators && node.decorators.length > 0) {
      throw this.err.decoratorNeedsReceiver(node.decorators[0].name, node.line, node.col);
    }

    // Register before entering body to allow recursion
    this.symbols.define(node.name, {
      kind: 'fn', name: node.name,
      params: node.params, returnType,
      line: node.line, col: node.col,
    });

    const prevFn    = this.currentFn;
    // A 'paralel' function is always called through the scheduler, which
    // always hands back a Promise (whether it actually ran on a worker or
    // inline) — so 'tunggu' is legal in its body exactly like an async fn,
    // without also requiring the 'asinkron' keyword.
    this.currentFn  = {
      name: node.name, returnType, isAsync: node.isAsync || node.isParallel || false,
      isParallel: !!node.isParallel,
      // Snapshot of the scope depth *before* pushing this fn's own param
      // scope — inferIdentifier() uses it to tell "this name resolved
      // inside my own body/params" from "this name resolved in an
      // enclosing (module) scope", the latter being an unsafe closure
      // capture for a 'paralel' fn (Automatic_Concurrency.md's Concurrency
      // Safety doc — worker re-runs this file from scratch, so it never
      // reaches whatever top-level statement created that outer binding).
      paralelBoundaryDepth: this.symbols.depth(),
    };

    this.symbols.push();
    for (const p of node.params) {
      if (p.decorators && p.decorators.length > 0) {
        throw this.err.decoratorNeedsReceiver(p.decorators[0].name, node.line, node.col);
      }
      if (p.default) {
        this.inferExpr(p.default);
        this.checkNumericLiteralFits(p.type, p.default);
      }
      this.symbols.define(p.name, {
        kind: 'var', type: p.type, mutable: p.mutable || false,
        line: node.line, col: node.col,
      });
    }
    for (const stmt of node.body.body) this.checkStmt(stmt);
    this.symbols.pop();

    this.currentFn = prevFn;
  }

  checkStructDecl(node) {
    if (this.symbols.existsInCurrent(node.name)) {
      throw this.err.duplicateVar(node.name, node.line, node.col);
    }
    this.symbols.define(node.name, {
      kind: 'struct', name: node.name, fields: node.fields,
      line: node.line, col: node.col,
    });
    this.checkDecorators(node.decorators);
  }

  // @Nama(args) before a struktur/receiver-method/param — decorator identifier
  // must resolve (usually via 'impor { Controller } dari "@nestjs/common"',
  // untyped like any other external import) and its args type-check like any
  // other call arguments. What it actually *does* is opaque to the checker,
  // same laxness as other framework-facing member calls elsewhere here.
  checkDecorators(decorators) {
    for (const d of decorators || []) {
      if (!this.symbols.lookup(d.name)) throw this.err.undefinedVar(d.name, d.line, d.col);
      for (const a of d.args) this.inferExpr(a);
    }
  }

  checkIfStmt(node) {
    const condType = this.inferExpr(node.condition);
    if (condType !== 'bool' && condType !== 'unknown') {
      throw this.err.ifNotBool(condType, node.condition.line, node.condition.col);
    }

    this.symbols.push();
    for (const s of node.consequent.body) this.checkStmt(s);
    this.symbols.pop();

    if (node.alternate) {
      if (node.alternate.type === N.IF_STMT) {
        this.checkIfStmt(node.alternate); // else-if chain
      } else {
        this.symbols.push();
        for (const s of node.alternate.body) this.checkStmt(s);
        this.symbols.pop();
      }
    }
  }

  checkLoopStmt(node) {
    this.symbols.push();

    if (node.loopType === 'range') {
      const startType = this.inferExpr(node.start);
      const endType   = this.inferExpr(node.end);
      if (!NUMERIC_TYPES.has(startType) && startType !== 'unknown') {
        throw this.err.typeMismatch('number', startType, node.start.line, node.start.col);
      }
      if (!NUMERIC_TYPES.has(endType) && endType !== 'unknown') {
        throw this.err.typeMismatch('number', endType, node.end.line, node.end.col);
      }
      this.symbols.define(node.iter, {
        kind: 'var', type: 'number', mutable: false, line: node.line, col: node.col,
      });
    } else {
      // for-of: iterator type = element type of source
      const srcType  = this.inferExpr(node.source);
      const elemType = srcType.endsWith('[]') ? srcType.slice(0, -2) : 'unknown';
      this.symbols.define(node.iter, {
        kind: 'var', type: elemType, mutable: false, line: node.line, col: node.col,
      });
    }

    for (const s of node.body.body) this.checkStmt(s);
    this.symbols.pop();
  }

  checkWhileStmt(node) {
    const condType = this.inferExpr(node.condition);
    if (condType !== 'bool' && condType !== 'unknown') {
      throw this.err.ifNotBool(condType, node.condition.line, node.condition.col);
    }
    this.symbols.push();
    for (const s of node.body.body) this.checkStmt(s);
    this.symbols.pop();
  }

  checkTryStmt(node) {
    this.symbols.push();
    for (const s of node.tryBlock.body) this.checkStmt(s);
    this.symbols.pop();

    if (node.catchBlock) {
      this.symbols.push();
      // catch parameter is an external JS error — type 'unknown'
      this.symbols.define(node.catchParam, {
        kind: 'var', type: 'unknown', mutable: false,
        line: node.line, col: node.col,
      });
      for (const s of node.catchBlock.body) this.checkStmt(s);
      this.symbols.pop();
    }

    if (node.finallyBlock) {
      this.symbols.push();
      for (const s of node.finallyBlock.body) this.checkStmt(s);
      this.symbols.pop();
    }
  }

  checkReturnStmt(node) {
    if (node.value === null) return; // void return
    const valueType = this.inferExpr(node.value);
    if (this.currentFn && this.currentFn.returnType !== 'void') {
      if (!this.compatible(this.currentFn.returnType, valueType)) {
        throw this.err.returnTypeMismatch(
          this.currentFn.name,
          this.currentFn.returnType,
          valueType,
          node.value.line, node.value.col,
        );
      }
      this.checkNumericLiteralFits(this.currentFn.returnType, node.value);
    }
  }

  checkExprStmt(node) {
    this.inferExpr(node.expr);
  }

  // ── Expression type inference ────────────────────────────────────────────────

  inferExpr(node) {
    const t = this._inferExpr(node);
    node._type = t;
    return t;
  }

  _inferExpr(node) {
    switch (node.type) {
      case N.NUMBER_LITERAL: return 'number';
      case N.STRING_LITERAL: return 'string';
      case N.BOOL_LITERAL:   return 'bool';
      case N.IDENTIFIER:     return this.inferIdentifier(node);
      case N.BINARY_EXPR:    return this.inferBinaryExpr(node);
      case N.UNARY_EXPR:     return this.inferUnaryExpr(node);
      case N.CALL_EXPR:      return this.inferCallExpr(node);
      case N.MEMBER_EXPR:    return this.inferMemberExpr(node);
      case N.INDEX_EXPR:     return this.inferIndexExpr(node);
      case N.STRUCT_INIT:    return this.inferStructInit(node);
      case N.ASSIGN_EXPR:    return this.inferAssignExpr(node);
      case N.ARRAY_LITERAL:  return this.inferArrayLiteral(node);
      case N.AWAIT_EXPR:     return this.inferAwaitExpr(node);
      case N.FUNC_EXPR:      return this.inferFuncExpr(node);
      case N.NULL_LITERAL:   return 'null';
      case N.REGEX_LITERAL:  return 'unknown'; // compiles to a real JS RegExp — no dedicated Gatra type, methods/props resolve loosely like other interop values
      case N.OBJECT_LITERAL: return this.inferObjectLiteral(node);
      case N.OBJECT_TRANSFORM_EXPR: return this.inferObjectTransformExpr(node);
      case N.TEMPLATE_EXPR:  return this.inferTemplateExpr(node);
      case N.SPREAD_ELEMENT: this.inferExpr(node.value); return 'unknown';
      case N.TERNARY_EXPR:   return this.inferTernaryExpr(node);
      case N.NAMED_ARG:      return this.inferExpr(node.value);
      default:
        return 'unknown';
    }
  }

  inferObjectLiteral(node) {
    for (const f of node.fields) this.inferExpr(f.value);
    return 'unknown';
  }

  inferTemplateExpr(node) {
    for (const p of node.parts) {
      if (p.kind === 'expr') this.inferExpr(p.expr);
    }
    return 'string';
  }

  inferTernaryExpr(node) {
    this.inferExpr(node.condition);
    const ct = this.inferExpr(node.consequent);
    const at = this.inferExpr(node.alternate);
    return ct === at ? ct : 'unknown';
  }

  inferIdentifier(node) {
    // Inside a 'dengan'/'ubah' field, a bare identifier always resolves as a
    // member of the with-source (codegen rewrites it to source.name) — it
    // never falls back to an outer variable, so we can't know its type here.
    if (this.withStack.length > 0) return 'unknown';

    const info = this.symbols.lookup(node.name);
    if (!info) throw this.err.undefinedVar(node.name, node.line, node.col);

    // Concurrency Safety — closure capture analysis: a 'paralel' fn's body
    // may reference its own params/locals and other top-level fn/struct
    // names (all re-declared identically when a worker re-runs this file —
    // see scheduler.js), but never a variable from an *enclosing* scope. A
    // worker skips straight past whatever top-level statement created that
    // outer binding (isMainThread guard + early return), so it would be a
    // ReferenceError there — caught here at compile time instead.
    if (this.currentFn && this.currentFn.isParallel && info.kind === 'var' && !this.suppressClosureCapture) {
      const depth = this.symbols.lookupDepth(node.name);
      if (depth >= 0 && depth < this.currentFn.paralelBoundaryDepth) {
        throw this.err.unsafeClosureCapture(node.name, this.currentFn.name, node.line, node.col);
      }
    }

    if (info.kind === 'var')     return info.type;
    if (info.kind === 'fn')      return 'fn';
    if (info.kind === 'package') return 'unknown'; // namespace — member types unresolved
    return 'unknown';
  }

  inferObjectTransformExpr(node) {
    this.inferExpr(node.source);
    this.withStack.push(true);
    for (const f of node.fields) this.inferExpr(f.value);
    this.withStack.pop();
    return 'unknown';
  }

  inferBinaryExpr(node) {
    const lt   = this.inferExpr(node.left);
    const rt   = this.inferExpr(node.right);

    // Nullish coalescing (a ?? b): hasil = tipe a tanpa '?' jika kompatibel
    // dengan b, jika tidak melebar ke 'apa_saja' — tidak dimodelkan lewat
    // OPERATOR_RULES karena hasilnya bergantung pada penghapusan sufiks '?'.
    if (node.op === '??') {
      if (lt.endsWith('?')) {
        const inner = lt.slice(0, -1);
        return this.compatible(inner, rt) ? inner : 'unknown';
      }
      return lt === 'unknown' ? rt : lt;
    }

    const rule = OPERATOR_RULES[node.op];

    if (!rule) return 'unknown';

    if (rule.pairs === 'same') {
      if (!this.compatible(lt, rt) && lt !== rt) {
        throw this.err.operatorMismatch(node.op, lt, rt, node.line, node.col);
      }
      return 'bool';
    }

    const matches = (want, got) => {
      if (got === 'unknown') return true;
      if (want === 'numeric') return NUMERIC_TYPES.has(got);
      return want === got;
    };
    const ok = rule.pairs.some(([l, r]) => matches(l, lt) && matches(r, rt));

    if (!ok && lt !== 'unknown' && rt !== 'unknown') {
      throw this.err.operatorMismatch(node.op, lt, rt, node.line, node.col);
    }

    return rule.result(lt, rt);
  }

  inferUnaryExpr(node) {
    const t = this.inferExpr(node.operand);
    if (node.op === '-') {
      if (!NUMERIC_TYPES.has(t) && t !== 'unknown') {
        throw this.err.typeMismatch('number', t, node.operand.line, node.operand.col);
      }
      // Negasi selalu melebar ke 'angka' generik — hasilnya bisa keluar dari
      // rentang 'byte'/'bilangan' asalnya (mis. -x saat x: byte).
      return t === 'unknown' ? 'unknown' : 'number';
    }
    if (node.op === '!') {
      if (t !== 'bool' && t !== 'unknown') {
        throw this.err.typeMismatch('bool', t, node.operand.line, node.operand.col);
      }
      return 'bool';
    }
    return 'unknown';
  }

  inferCallExpr(node) {
    // Built-in print (variadic, any types, returns void)
    if (node.callee === '__print__') {
      for (const a of node.args) this.inferExpr(a);
      return 'void';
    }

    // Callee is an AST expression
    if (typeof node.callee === 'object') {
      if (node.callee.type === N.IDENTIFIER) {
        return this.inferNamedCall(node.callee.name, node.args, node);
      }
      // Method calls on objects (Phase 4): skip type checking, but still
      // visit the callee (e.g. mat.internal(...)) so Go-style visibility on
      // namespace member access is enforced even in call position.
      if (node.callee.type === N.MEMBER_EXPR) this.inferExpr(node.callee);
      for (const a of node.args) this.inferExpr(a);
      return 'unknown';
    }

    return this.inferNamedCall(node.callee, node.args, node);
  }

  inferNamedCall(name, args, node) {
    // tanpa_periksa(expr) — the escape hatch also has to suppress
    // unsafeClosureCapture (inferIdentifier below), not just checkMoveSafety's
    // separate usedAfterMove pass — otherwise the error message's own advice
    // ("bungkus dengan 'tanpa_periksa(...)'") would be a lie.
    if (name === 'tanpa_periksa') {
      const prev = this.suppressClosureCapture;
      this.suppressClosureCapture = true;
      try {
        for (const a of args) this.inferExpr(a);
      } finally {
        this.suppressClosureCapture = prev;
      }
      return 'unknown';
    }

    const info = this.symbols.lookup(name);
    if (!info) throw this.err.undefinedVar(name, node.line, node.col);

    // Variable of unknown/fn type — callable (apapun or fn expression)
    if (info.kind === 'var' && (info.type === 'unknown' || info.type === 'fn')) {
      for (const a of args) this.inferExpr(a);
      return 'unknown';
    }

    // Package imported as namespace — may be callable (e.g. express(), fastify())
    if (info.kind === 'package') {
      for (const a of args) this.inferExpr(a);
      return 'unknown';
    }

    if (info.kind !== 'fn') throw this.err.notAFunction(name, node.line, node.col);

    if (info.variadic) {
      for (const a of args) this.inferExpr(a);
      return info.returnType;
    }

    // If any arg is spread, skip static arg count/type checking
    const hasSpread = args.some(a => a.type === N.SPREAD_ELEMENT);
    if (hasSpread) {
      for (const a of args) this.inferExpr(a);
      return info.returnType;
    }

    // Rest parameter (...nama): any number of trailing args is fine
    const restParam = info.params[info.params.length - 1];
    if (restParam && restParam.rest) {
      const required = info.params.slice(0, -1).filter(p => !p.default).length;
      if (args.length < required) {
        throw this.err.wrongArgCount(name, required, args.length, node.line, node.col);
      }
      for (const a of args) this.inferExpr(a);
      return info.returnType;
    }

    if (args.length !== info.params.length) {
      // Allow calling with fewer args when params have defaults
      const required = info.params.filter(p => !p.default).length;
      if (args.length < required || args.length > info.params.length) {
        throw this.err.wrongArgCount(name, info.params.length, args.length, node.line, node.col);
      }
    }

    for (let i = 0; i < args.length; i++) {
      const argType   = this.inferExpr(args[i]);
      const paramType = info.params[i].type;
      if (!this.compatible(paramType, argType)) {
        throw this.err.wrongArgType(name, i, paramType, argType, args[i].line, args[i].col);
      }
      this.checkNumericLiteralFits(paramType, args[i]);
    }

    return info.returnType;
  }

  inferMemberExpr(node) {
    const objType = this.inferExpr(node.object);
    if (objType === 'unknown') {
      // Go-style visibility check for namespace-style access (mat.internal) —
      // only enforced when the target is a resolved local .gatra module and
      // the member is a known-internal (lowercase) top-level declaration.
      if (node.object.type === N.IDENTIFIER) {
        const sym = this.symbols.lookup(node.object.name);
        if (sym && sym.kind === 'package' && sym.resolvedPath) {
          let exportsMap = null;
          try { exportsMap = getModuleExports(sym.resolvedPath); } catch (e) { /* best-effort */ }
          const entry = exportsMap && exportsMap.get(node.member);
          if (entry && !entry.public) {
            const { makePackageErrors } = require('../package/package-errors');
            throw makePackageErrors(this.grammar).accessDenied(node.member, node.line, node.col);
          }
        } else if (sym && sym.kind === 'package' && sym.isExternal) {
          // Any external module (builtin or npm), PascalCase-public
          // convention (external-interop.js). A real lowercase/camelCase
          // member used directly is always rejected here, regardless of
          // source — that part of the check is fully reliable even for npm
          // (classifyExternalAccess only throws off a *confirmed* real
          // member name).
          const result = classifyExternalAccess(sym.externalMembers, node.member);
          if (result.violation) {
            const { makePackageErrors } = require('../package/package-errors');
            throw makePackageErrors(this.grammar).externalMemberNotPublic(node.member, sym.packageName, node.line, node.col);
          }
          // A builtin's member list is exhaustive and 100% authoritative
          // (it's the real, actually-require()'d module) — safe to bake the
          // real name straight into the compiled call (genMemberExpr). An
          // npm package's list is only ever a best-effort *hint* (regex over
          // source text, may easily be incomplete) — never used to rewrite
          // the call; codegen instead wraps the whole npm namespace in a
          // runtime proxy (__gatra_pascal_proxy__) that resolves every
          // access for real, so correctness never depends on this hint.
          if (sym.isBuiltin && result.real) node._realMember = result.real;
        }
      }
      return 'unknown';
    }

    const structInfo = this.symbols.lookup(objType);
    if (!structInfo || structInfo.kind !== 'struct') {
      // Not a known struct — could be a Phase 4 runtime object, skip
      return 'unknown';
    }

    const field = structInfo.fields.find(f => f.name === node.member);
    if (field) return field.type;

    // Not a field — could be a receiver method (h.sapa()); arg/return types
    // aren't strictly checked at the call site (same laxness as other
    // dynamic-dispatch member calls elsewhere in this checker).
    if (this.methods[objType]?.has(node.member)) return 'unknown';

    throw this.err.unknownField(objType, node.member, node.line, node.col);
  }

  inferIndexExpr(node) {
    const objType = this.inferExpr(node.object);
    this.inferExpr(node.index);
    // Larik bertipe (T[]) memberi tipe elemen; selebihnya (objek/peta/apa_saja)
    // adalah computed property access dinamis — hasil tidak diketahui statis.
    if (objType.endsWith('[]')) return objType.slice(0, -2);
    return 'unknown';
  }

  inferFuncExpr(node) {
    const returnType = node.returnType || 'void';
    const prevFn     = this.currentFn;
    this.currentFn   = { name: '<anonim>', returnType, isAsync: node.isAsync || false };

    // A nested function/arrow has its own scope — its params/body must not
    // resolve bare identifiers against an enclosing 'dengan'/'ubah' source.
    const prevWithStack = this.withStack;
    this.withStack = [];

    this.symbols.push();
    for (const p of node.params) {
      this.symbols.define(p.name, {
        kind: 'var', type: p.type, mutable: p.mutable || false,
        line: node.line, col: node.col,
      });
    }
    if (node.isArrow && node.exprBody) {
      this.inferExpr(node.exprBody);
    } else {
      for (const s of node.body.body) this.checkStmt(s);
    }
    this.symbols.pop();

    this.withStack = prevWithStack;
    this.currentFn = prevFn;
    return 'fn';
  }

  inferAwaitExpr(node) {
    if (!this.currentFn) {
      throw this.err.awaitOutsideAsync(node.line, node.col);
    }
    if (!this.currentFn.isAsync) {
      throw this.err.awaitInNonAsync(this.currentFn.name, node.line, node.col);
    }
    // Resolved type = inner expression type (no generics — simplified model)
    return this.inferExpr(node.expr);
  }

  inferArrayLiteral(node) {
    if (node.elements.length === 0) return 'unknown[]';

    const first = this.inferExpr(node.elements[0]);
    // Strip one array level to get base element type for error messages
    const elemType = first.endsWith('[]') ? first : first;

    for (let i = 1; i < node.elements.length; i++) {
      const t = this.inferExpr(node.elements[i]);
      if (!this.compatible(elemType, t)) {
        throw this.err.arrayTypeMismatch(
          elemType, t, node.elements[i].line, node.elements[i].col
        );
      }
    }

    return elemType + '[]';
  }

  inferStructInit(node) {
    const info = this.symbols.lookup(node.name);
    if (!info || info.kind !== 'struct') {
      throw this.err.unknownType(node.name, node.line, node.col);
    }

    // Check unknown fields (field provided but not in struct definition)
    for (const initField of node.fields) {
      const def = info.fields.find(f => f.name === initField.name);
      if (!def) throw this.err.unknownField(node.name, initField.name, node.line, node.col);

      const valType = this.inferExpr(initField.value);
      if (!this.compatible(def.type, valType)) {
        throw this.err.typeMismatch(def.type, valType, initField.value.line, initField.value.col);
      }
      this.checkNumericLiteralFits(def.type, initField.value);
    }

    // Check missing required fields
    for (const defField of info.fields) {
      const provided = node.fields.find(f => f.name === defField.name);
      if (!provided) {
        throw this.err.missingField(node.name, defField.name, node.line, node.col);
      }
    }

    return node.name;
  }

  inferAssignExpr(node) {
    const valueType = this.inferExpr(node.value);

    if (node.target.type === N.IDENTIFIER) {
      const info = this.symbols.lookup(node.target.name);
      if (!info) throw this.err.undefinedVar(node.target.name, node.target.line, node.target.col);
      if (info.kind === 'var' && !info.mutable) {
        throw this.err.cannotReassignImmutable(node.target.name, node.target.line, node.target.col);
      }
      if (info.kind === 'var' && !this.compatible(info.type, valueType)) {
        throw this.err.typeMismatch(info.type, valueType, node.value.line, node.value.col);
      }
      if (info.kind === 'var') this.checkNumericLiteralFits(info.type, node.value);
    }

    return valueType;
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  // Follows 'tipe' aliases down to their underlying canonical type
  resolveType(t) {
    let hops = 0;
    while (this.typeAliases[t] && hops++ < 10) t = this.typeAliases[t];
    return t;
  }

  // Two types are compatible if they're equal, or if either is 'unknown'.
  // 'null' (kosong) is only compatible with an opsional target (T?).
  // A plain T is compatible with its own opsional wrapper T? (widening).
  compatible(a, b) {
    a = this.resolveType(a);
    b = this.resolveType(b);
    if (a === 'unknown' || b === 'unknown') return true;
    if (b === 'null') return a.endsWith('?');
    if (a === 'null') return b.endsWith('?');
    if (a === b) return true;
    if (a.endsWith('?') && a.slice(0, -1) === b) return true;
    if (b.endsWith('?') && b.slice(0, -1) === a) return true;
    if (NUMERIC_TYPES.has(a) && NUMERIC_TYPES.has(b)) return this.numericCompatible(a, b);
    return false;
  }

  // target=a menerima value=b? 'angka' generik menerima/diterima semua
  // refinement numerik (bilangan/pecahan/byte). 'pecahan' menerima
  // 'bilangan'/'byte' (melebar). 'bilangan' menerima 'byte' (melebar).
  // Penyempitan (mis. pecahan → bilangan, angka → byte) TIDAK boleh implisit
  // lewat variabel — hanya literal langsung yang divalidasi (lihat
  // checkNumericLiteralFits), supaya kesalahan seperti 'byte = 256' ketahuan.
  numericCompatible(target, value) {
    if (target === 'number' || value === 'number') return true;
    if (target === 'float') return true; // pecahan menerima int/byte/float
    if (target === 'int') return value === 'int' || value === 'byte';
    if (target === 'byte') return value === 'byte';
    return false;
  }

  // Validasi nilai literal angka langsung terhadap batas tipe target —
  // hanya bisa dilakukan saat nilainya diketahui statis (literal), bukan
  // ekspresi/variabel sembarang (itu di luar jangkauan type checker ringan ini).
  checkNumericLiteralFits(targetType, valueNode) {
    if (!valueNode) return;
    let literalNode = valueNode;
    let sign = 1;
    // Unwrap a leading unary minus so '-1' is checked as the literal -1, not +1
    if (literalNode.type === N.UNARY_EXPR && literalNode.op === '-' &&
        literalNode.operand.type === N.NUMBER_LITERAL) {
      literalNode = literalNode.operand;
      sign = -1;
    }
    if (literalNode.type !== N.NUMBER_LITERAL) return;
    const t = this.resolveType(targetType);
    const v = sign * literalNode.value;
    if (t === 'int' && !Number.isInteger(v)) {
      throw this.err.invalidNumericLiteral('bilangan', v, valueNode.line, valueNode.col);
    }
    if (t === 'byte' && (!Number.isInteger(v) || v < 0 || v > 255)) {
      throw this.err.invalidNumericLiteral('byte', v, valueNode.line, valueNode.col);
    }
  }
}

function typecheck(ast, grammar, opts) {
  new TypeChecker(grammar, opts).check(ast);
}

module.exports = { TypeChecker, typecheck };
