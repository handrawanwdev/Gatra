'use strict';

const { NodeType: N } = require('../ast/nodes');
const { SymbolTable }  = require('./symbol-table');
const { makeErrors }   = require('./type-errors');
const { resolveLocalPath, getModuleExports } = require('../module/resolver');
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
    this.datasetCtx  = 0;  // >0 while checking args of a data<T> method (saring/pilih/ubah/...) — gates .field validity
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
    // hitung()/jumlah(.f)/rata_rata(.f)/minimum(.f)/maksimum(.f) — aggregate
    // markers valid only inside .agregat({...}); codegen turns each call into
    // a plain descriptor, they're never invoked as real functions at runtime.
    for (const name of ['hitung', 'jumlah', 'rata_rata', 'minimum', 'maksimum']) {
      this.symbols.define(name, {
        kind: 'fn', name, params: [], returnType: 'number', variadic: true, builtin: true,
      });
    }
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
        // External package or no filePath context — untyped, same laxness as namespace imports
        for (const name of node.names) {
          this.symbols.define(name, { kind: 'var', type: 'unknown', mutable: true, line: node.line, col: node.col });
        }
      }
      return;
    }

    if (this.symbols.existsInCurrent(node.localName)) {
      throw this.err.duplicateVar(node.localName, node.line, node.col);
    }
    // Register namespace as 'package' kind — member access returns 'unknown',
    // except for a Go-style visibility check against internal (lowercase) members.
    this.symbols.define(node.localName, {
      kind: 'package',
      packageName: node.localName,
      source: node.source,
      resolvedPath: localPath && fs.existsSync(localPath) ? localPath : null,
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
          kind: 'var', type: p.type, mutable: false,
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
    this.currentFn  = { name: node.name, returnType, isAsync: node.isAsync || false };

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
        kind: 'var', type: p.type, mutable: false,
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
      case N.OBJECT_LITERAL: return this.inferObjectLiteral(node);
      case N.OBJECT_TRANSFORM_EXPR: return this.inferObjectTransformExpr(node);
      case N.TEMPLATE_EXPR:  return this.inferTemplateExpr(node);
      case N.SPREAD_ELEMENT: this.inferExpr(node.value); return 'unknown';
      case N.TERNARY_EXPR:   return this.inferTernaryExpr(node);
      case N.FIELD_EXPR:     return this.inferFieldExpr(node);
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
      if (node.callee.type === N.MEMBER_EXPR) {
        const ds = this.inferDatasetCall(node);
        if (ds !== undefined) return ds;
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

  // ── Big Data primitive: data<T> (BIGDATA_TYPE.md) ──────────────────────────

  inferFieldExpr(node) {
    if (this.datasetCtx === 0) throw this.err.fieldExprOutsideDataset(node.name, node.line, node.col);
    return 'unknown';
  }

  isDatasetType(t) { return typeof t === 'string' && t.startsWith('data<'); }

  // Field-reference-only argument, e.g. .pilih(.negara), .kelompok(.negara),
  // .urutkan(.umur) — structural, never generically type-inferred (a bare
  // .field is only meaningful as data, not as a value to evaluate here).
  requireFieldRefArg(arg, methodName) {
    if (!arg || arg.type !== N.FIELD_EXPR) throw this.err.expectedFieldReference(methodName, arg.line, arg.col);
    return arg.name;
  }

  // Dispatches data<T> method calls (.saring/.pilih/.ubah/.kelompok/.agregat/
  // .gabung/.urutkan/.bagi/.paralel/.terdistribusi/.jendela/.ambil/
  // .kumpulkan/.tulis/.statistik) and the data.baca<T>()/data.alir<T>()
  // sources. Returns undefined when node isn't a dataset call at all, so the
  // caller falls back to the generic dynamic-dispatch path.
  inferDatasetCall(node) {
    const callee = node.callee; // MEMBER_EXPR
    const member = callee.member;

    // data.baca<T>(path) / data.alir<T>(path) — dataset source
    if (callee.object.type === N.IDENTIFIER && callee.object.name === 'data' &&
        (member === 'baca' || member === 'alir') && callee.typeArg) {
      for (const a of node.args) this.inferExpr(a);
      return `data<${callee.typeArg}>`;
    }

    const JOIN_VARIANTS = new Set(['dalam', 'kiri', 'kanan', 'penuh']);
    // .gabung.dalam(...)/.kiri(...)/.kanan(...)/.penuh(...) — join type variant
    if (JOIN_VARIANTS.has(member) && callee.object.type === N.MEMBER_EXPR && callee.object.member === 'gabung') {
      const dsType = this.inferExpr(callee.object.object);
      if (!this.isDatasetType(dsType)) return undefined;
      this.checkGabungArgs(node.args);
      return 'data<unknown>';
    }

    const DATASET_METHODS = new Set([
      'saring', 'pilih', 'ubah', 'kelompok', 'agregat', 'gabung', 'urutkan',
      'bagi', 'paralel', 'terdistribusi', 'jendela', 'ambil', 'kumpulkan', 'tulis', 'statistik',
    ]);
    if (!DATASET_METHODS.has(member)) return undefined;

    const objType = this.inferExpr(callee.object);
    if (!this.isDatasetType(objType)) return undefined;
    const recordType = objType.slice(5, -1);

    switch (member) {
      case 'saring':
      case 'ubah':
        this.datasetCtx++;
        try { for (const a of node.args) this.inferExpr(a); }
        finally { this.datasetCtx--; }
        return member === 'saring' ? objType : 'data<unknown>';

      case 'pilih':
      case 'kelompok':
        for (const a of node.args) this.requireFieldRefArg(a, member);
        return member === 'pilih' ? 'data<unknown>' : objType;

      case 'agregat': {
        const AGG_FN_NAMES = new Set(['hitung', 'jumlah', 'rata_rata', 'minimum', 'maksimum']);
        const spec = node.args[0];
        if (!spec || spec.type !== N.OBJECT_LITERAL) throw this.err.invalidAggregateSpec(node.line, node.col);
        this.datasetCtx++;
        try {
          for (const f of spec.fields) {
            const v = f.value;
            const isAggCall = v.type === N.CALL_EXPR && typeof v.callee === 'object' &&
              v.callee.type === N.IDENTIFIER && AGG_FN_NAMES.has(v.callee.name);
            if (!isAggCall) throw this.err.invalidAggregateSpec(v.line, v.col);
            this.inferExpr(v);
          }
        } finally { this.datasetCtx--; }
        return 'data<unknown>';
      }

      case 'gabung':
        this.checkGabungArgs(node.args);
        return 'data<unknown>';

      case 'urutkan': {
        this.requireFieldRefArg(node.args[0], 'urutkan');
        const dirArg = node.args[1];
        if (dirArg) {
          if (dirArg.type !== N.IDENTIFIER || (dirArg.name !== 'menaik' && dirArg.name !== 'menurun')) {
            throw this.err.invalidSortDirection(dirArg.name ?? '?', dirArg.line, dirArg.col);
          }
        }
        return objType;
      }

      case 'bagi':
        if (node.args[0] && node.args[0].type === N.FIELD_EXPR) { /* field-based partition — structural */ }
        else for (const a of node.args) this.inferExpr(a);
        return objType;

      case 'jendela':
        this.datasetCtx++;
        try { for (const a of node.args) this.inferExpr(a); }
        finally { this.datasetCtx--; }
        return objType;

      case 'paralel':
      case 'terdistribusi':
      case 'ambil':
        for (const a of node.args) this.inferExpr(a);
        return objType;

      case 'kumpulkan':
        for (const a of node.args) this.inferExpr(a);
        return recordType + '[]';

      case 'tulis':
        for (const a of node.args) this.inferExpr(a);
        return 'void';

      case 'statistik':
        for (const a of node.args) this.inferExpr(a);
        return 'unknown';

      default:
        return 'unknown';
    }
  }

  // .gabung(other, pada: kondisi) — 'other' is a normal expression; 'pada's
  // value is a field-reference condition evaluated over both sides (see
  // codegen's genGabungArgs for how the two records are merged).
  checkGabungArgs(args) {
    const pada = args.find(a => a.type === N.NAMED_ARG && a.name === 'pada');
    if (!pada) throw this.err.gabungNeedsPada(args[0]?.line, args[0]?.col);
    for (const a of args) {
      if (a === pada) {
        this.datasetCtx++;
        try { this.inferExpr(a.value); }
        finally { this.datasetCtx--; }
      } else {
        this.inferExpr(a);
      }
    }
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
        kind: 'var', type: p.type, mutable: false,
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
