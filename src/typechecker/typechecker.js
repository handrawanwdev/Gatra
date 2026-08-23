'use strict';

const { NodeType: N } = require('../ast/nodes');
const { SymbolTable }  = require('./symbol-table');
const { makeErrors }   = require('./type-errors');

// Which type pairs are valid for each binary operator, and what type they produce
const OPERATOR_RULES = {
  '+':  { pairs: [['number','number'],['string','string']], result: (l) => l },
  '-':  { pairs: [['number','number']], result: () => 'number' },
  '*':  { pairs: [['number','number']], result: () => 'number' },
  '/':  { pairs: [['number','number']], result: () => 'number' },
  '>':  { pairs: [['number','number']], result: () => 'bool' },
  '<':  { pairs: [['number','number']], result: () => 'bool' },
  '>=': { pairs: [['number','number']], result: () => 'bool' },
  '<=': { pairs: [['number','number']], result: () => 'bool' },
  '==': { pairs: 'same', result: () => 'bool' },
  '!=': { pairs: 'same', result: () => 'bool' },
  '&&': { pairs: [['bool','bool']], result: () => 'bool' },
  '||': { pairs: [['bool','bool']], result: () => 'bool' },
};

class TypeChecker {
  constructor(grammar) {
    this.grammar    = grammar || 'en';
    this.err        = makeErrors(this.grammar);
    this.symbols    = new SymbolTable();
    this.currentFn  = null; // { name, returnType } of the fn being checked
    this.typeAliases = {}; // name → canonical target type (from 'tipe' declarations)

    // Built-in functions registered in the global scope
    this.symbols.define('__print__', {
      kind: 'fn', name: '__print__',
      params: [], returnType: 'void', variadic: true,
    });
    // kunci() / saluran() — concurrency primitives (pustaka/sinkronisasi runtime).
    // Marked 'builtin' so user code may shadow them: isi kunci = kunci()
    this.symbols.define('kunci', {
      kind: 'fn', name: 'kunci', params: [], returnType: 'unknown', variadic: true, builtin: true,
    });
    this.symbols.define('saluran', {
      kind: 'fn', name: 'saluran', params: [], returnType: 'unknown', variadic: true, builtin: true,
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
      case N.TEST_DECL:      return this.checkTestDecl(node);
      case N.ASSERT_STMT:    return this.checkAssertStmt(node);
      case N.TASK_STMT:      return this.checkTaskStmt(node);
      case N.STRUCTURED_SPAWN: return this.checkStructuredSpawn(node);
      case N.SELECT_STMT:    return this.checkSelectStmt(node);
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

  checkTaskStmt(node) {
    this.inferExpr(node.expr);
  }

  checkStructuredSpawn(node) {
    if (!this.currentFn) {
      throw this.err.awaitOutsideAsync(node.line, node.col);
    }
    if (!this.currentFn.isAsync) {
      throw this.err.awaitInNonAsync(this.currentFn.name, node.line, node.col);
    }
    this.symbols.push();
    for (const s of node.body.body) this.checkStmt(s);
    this.symbols.pop();
  }

  checkSelectStmt(node) {
    if (!this.currentFn) {
      throw this.err.awaitOutsideAsync(node.line, node.col);
    }
    if (!this.currentFn.isAsync) {
      throw this.err.awaitInNonAsync(this.currentFn.name, node.line, node.col);
    }
    for (const c of node.cases) {
      this.inferExpr(c.channel);
      this.symbols.push();
      this.checkStmt(c.body);
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
    if (this.symbols.existsInCurrent(node.localName)) {
      throw this.err.duplicateVar(node.localName, node.line, node.col);
    }
    // Register namespace as 'package' kind — member access returns 'unknown'
    this.symbols.define(node.localName, {
      kind: 'package',
      packageName: node.localName,
      source: node.source,
      line: node.line,
      col:  node.col,
    });
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
    if (this.symbols.isUserDefinedInCurrent(node.name)) {
      throw this.err.duplicateVar(node.name, node.line, node.col);
    }

    const returnType = node.returnType || 'void';

    // Register before entering body to allow recursion
    this.symbols.define(node.name, {
      kind: 'fn', name: node.name,
      params: node.params, returnType,
      isWorker: node.isWorker || false,
      line: node.line, col: node.col,
    });

    const prevFn    = this.currentFn;
    this.currentFn  = { name: node.name, returnType, isAsync: node.isAsync || false };

    this.symbols.push();
    for (const p of node.params) {
      if (p.default) this.inferExpr(p.default);
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
      if (startType !== 'number' && startType !== 'unknown') {
        throw this.err.typeMismatch('number', startType, node.start.line, node.start.col);
      }
      if (endType !== 'number' && endType !== 'unknown') {
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
    }
  }

  checkExprStmt(node) {
    this.inferExpr(node.expr);
  }

  // ── Expression type inference ────────────────────────────────────────────────

  inferExpr(node) {
    const t = this._inferExpr(node);
    node._type = t; // annotate for ownership checker
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
      case N.STRUCT_INIT:    return this.inferStructInit(node);
      case N.ASSIGN_EXPR:    return this.inferAssignExpr(node);
      case N.BORROW_EXPR:    return this.inferBorrowExpr(node);
      case N.DEREF_EXPR:     return this.inferDerefExpr(node);
      case N.ARRAY_LITERAL:  return this.inferArrayLiteral(node);
      case N.AWAIT_EXPR:     return this.inferAwaitExpr(node);
      case N.FUNC_EXPR:      return this.inferFuncExpr(node);
      case N.NULL_LITERAL:   return 'null';
      case N.OBJECT_LITERAL: return this.inferObjectLiteral(node);
      case N.TEMPLATE_EXPR:  return this.inferTemplateExpr(node);
      case N.SPREAD_ELEMENT: this.inferExpr(node.value); return 'unknown';
      case N.TERNARY_EXPR:   return this.inferTernaryExpr(node);
      case N.SPAWN_EXPR:     return this.inferSpawnExpr(node);
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

  inferBorrowExpr(node) {
    const info = this.symbols.lookup(node.target);
    if (!info) throw this.err.undefinedVar(node.target, node.line, node.col);
    const inner = info.kind === 'var' ? info.type : 'unknown';
    // type is '&T' or '&mut T'
    return node.mutable ? `&mut ${inner}` : `&${inner}`;
  }

  inferDerefExpr(node) {
    const info = this.symbols.lookup(node.ref);
    if (!info) throw this.err.undefinedVar(node.ref, node.line, node.col);
    const t = info.kind === 'var' ? info.type : 'unknown';
    // strip & or &mut  prefix
    if (t.startsWith('&mut ')) return t.slice(5);
    if (t.startsWith('&'))     return t.slice(1);
    // deref of a non-ref — type checker will catch this in ownership checker
    return t;
  }

  inferIdentifier(node) {
    const info = this.symbols.lookup(node.name);
    if (!info) throw this.err.undefinedVar(node.name, node.line, node.col);
    if (info.kind === 'var')     return info.type;
    if (info.kind === 'fn')      return 'fn';
    if (info.kind === 'package') return 'unknown'; // namespace — member types unresolved
    return 'unknown';
  }

  inferBinaryExpr(node) {
    const lt   = this.inferExpr(node.left);
    const rt   = this.inferExpr(node.right);
    const rule = OPERATOR_RULES[node.op];

    if (!rule) return 'unknown';

    if (rule.pairs === 'same') {
      if (!this.compatible(lt, rt) && lt !== rt) {
        throw this.err.operatorMismatch(node.op, lt, rt, node.line, node.col);
      }
      return 'bool';
    }

    const ok = rule.pairs.some(([l, r]) =>
      (l === lt || lt === 'unknown') && (r === rt || rt === 'unknown')
    );

    if (!ok && lt !== 'unknown' && rt !== 'unknown') {
      throw this.err.operatorMismatch(node.op, lt, rt, node.line, node.col);
    }

    return rule.result(lt, rt);
  }

  inferUnaryExpr(node) {
    const t = this.inferExpr(node.operand);
    if (node.op === '-') {
      if (t !== 'number' && t !== 'unknown') {
        throw this.err.typeMismatch('number', t, node.operand.line, node.operand.col);
      }
      return 'number';
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
      // Method calls on objects (Phase 4): skip type checking, resolve args
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
    }

    return info.returnType;
  }

  inferMemberExpr(node) {
    const objType = this.inferExpr(node.object);
    if (objType === 'unknown') return 'unknown';

    const structInfo = this.symbols.lookup(objType);
    if (!structInfo || structInfo.kind !== 'struct') {
      // Not a known struct — could be a Phase 4 runtime object, skip
      return 'unknown';
    }

    const field = structInfo.fields.find(f => f.name === node.member);
    if (!field) throw this.err.unknownField(objType, node.member, node.line, node.col);

    return field.type;
  }

  inferFuncExpr(node) {
    const returnType = node.returnType || 'void';
    const prevFn     = this.currentFn;
    this.currentFn   = { name: '<anonim>', returnType, isAsync: node.isAsync || false };

    this.symbols.push();
    for (const p of node.params) {
      this.symbols.define(p.name, {
        kind: 'var', type: p.type, mutable: false,
        line: node.line, col: node.col,
      });
    }
    for (const s of node.body.body) this.checkStmt(s);
    this.symbols.pop();

    this.currentFn = prevFn;
    return 'fn';
  }

  inferSpawnExpr(node) {
    const callee = node.call.callee;
    if (typeof callee === 'object' && callee.type === N.IDENTIFIER) {
      const info = this.symbols.lookup(callee.name);
      if (info && info.kind === 'fn' && !info.isWorker) {
        throw this.err.notAWorkerFn(callee.name, node.line, node.col);
      }
    }
    return this.inferExpr(node.call);
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
    }

    if (node.target.type === N.DEREF_EXPR) {
      const refInfo = this.symbols.lookup(node.target.ref);
      if (refInfo && refInfo.kind === 'var') {
        // Deref type should be &mut T — ownership checker enforces mutability
        const inner = this.inferDerefExpr(node.target);
        if (!this.compatible(inner, valueType)) {
          throw this.err.typeMismatch(inner, valueType, node.value.line, node.value.col);
        }
      }
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
    return false;
  }
}

function typecheck(ast, grammar) {
  new TypeChecker(grammar).check(ast);
}

module.exports = { TypeChecker, typecheck };
