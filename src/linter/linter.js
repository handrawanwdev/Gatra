'use strict';

const { NodeType: N } = require('../ast/nodes');

// Pemeriksa kode (gatra periksa) — analisis statis ringan, terpisah dari
// pemeriksa tipe/kepemilikan (yang sudah menjadi hard error saat kompilasi).
// Deteksi: variabel tidak digunakan, shadowing, dan kode mati sederhana.

class Scope {
  constructor(parent) {
    this.parent = parent;
    this.vars   = new Map(); // name → { line, col, used }
  }
}

class Linter {
  constructor() {
    this.findings  = [];
    this.scope     = new Scope(null);
    this.withDepth = 0; // >0 inside a 'dengan'/'ubah' field — bare identifiers there aren't real scope lookups
  }

  push() { this.scope = new Scope(this.scope); }

  pop() {
    for (const [name, info] of this.scope.vars) {
      if (!info.used) {
        this.findings.push({
          rule: 'variabel-tidak-digunakan',
          message: `Variabel '${name}' tidak pernah digunakan`,
          line: info.line, col: info.col,
        });
      }
    }
    this.scope = this.scope.parent;
  }

  // Defines a variable in the current scope, warning if it shadows an outer one.
  define(name, line, col) {
    let outer = this.scope.parent;
    while (outer) {
      if (outer.vars.has(name)) {
        this.findings.push({
          rule: 'shadowing',
          message: `'${name}' menutupi (shadow) variabel dengan nama sama di scope luar`,
          line, col,
        });
        break;
      }
      outer = outer.parent;
    }
    this.scope.vars.set(name, { line, col, used: false });
  }

  use(name) {
    let s = this.scope;
    while (s) {
      if (s.vars.has(name)) { s.vars.get(name).used = true; return; }
      s = s.parent;
    }
  }

  lint(ast) {
    this.checkBlockBody(ast.body);
    return this.findings;
  }

  // ── Dead code (statements after balik/berhenti/lanjut in the same block) ────

  checkBlockBody(stmts) {
    let seenTerminal = false;
    for (const s of stmts) {
      if (seenTerminal) {
        this.findings.push({
          rule: 'kode-mati',
          message: 'Kode setelah balik/berhenti/lanjut tidak pernah dijalankan',
          line: s.line, col: s.col,
        });
      }
      this.checkStmt(s);
      if (s.type === N.RETURN_STMT || s.type === N.BREAK_STMT || s.type === N.CONTINUE_STMT) {
        seenTerminal = true;
      }
    }
  }

  // ── Statements ────────────────────────────────────────────────────────────

  checkStmt(node) {
    switch (node.type) {
      case N.VAR_DECL:
        this.checkExpr(node.value);
        this.define(node.name, node.line, node.col);
        return;
      case N.DESTRUCTURE_DECL:
        this.checkExpr(node.value);
        for (const b of node.bindings) this.define(b.name, node.line, node.col);
        return;
      case N.FN_DECL:
        this.push();
        if (node.receiver) {
          this.scope.vars.set(node.receiver.name, { line: node.line, col: node.col, used: true });
        }
        for (const p of node.params) {
          if (p.default) this.checkExpr(p.default);
          this.scope.vars.set(p.name, { line: node.line, col: node.col, used: true }); // params: no unused warning
        }
        this.checkBlockBody(node.body.body);
        this.pop();
        return;
      case N.STRUCT_DECL:
        return;
      case N.IF_STMT:
        this.checkExpr(node.condition);
        this.push(); this.checkBlockBody(node.consequent.body); this.pop();
        if (node.alternate) {
          if (node.alternate.type === N.IF_STMT) this.checkStmt(node.alternate);
          else { this.push(); this.checkBlockBody(node.alternate.body); this.pop(); }
        }
        return;
      case N.LOOP_STMT:
        if (node.loopType === 'range') { this.checkExpr(node.start); this.checkExpr(node.end); }
        else this.checkExpr(node.source);
        this.push();
        this.scope.vars.set(node.iter, { line: node.line, col: node.col, used: true }); // loop var: no unused warning
        this.checkBlockBody(node.body.body);
        this.pop();
        return;
      case N.WHILE_STMT:
        this.checkExpr(node.condition);
        this.push(); this.checkBlockBody(node.body.body); this.pop();
        return;
      case N.TRY_STMT:
        this.push(); this.checkBlockBody(node.tryBlock.body); this.pop();
        if (node.catchBlock) {
          this.push();
          this.scope.vars.set(node.catchParam, { line: node.line, col: node.col, used: true });
          this.checkBlockBody(node.catchBlock.body);
          this.pop();
        }
        if (node.finallyBlock) { this.push(); this.checkBlockBody(node.finallyBlock.body); this.pop(); }
        return;
      case N.RETURN_STMT:
        if (node.value) this.checkExpr(node.value);
        return;
      case N.EXPR_STMT:
        this.checkExpr(node.expr);
        return;
      case N.MATCH_STMT:
        this.checkExpr(node.discriminant);
        for (const c of node.cases) { this.checkExpr(c.test); this.push(); this.checkStmt(c.body); this.pop(); }
        if (node.defaultCase) { this.push(); this.checkStmt(node.defaultCase); this.pop(); }
        return;
      case N.MATCH_RESULT_STMT:
        this.checkExpr(node.discriminant);
        if (node.okArm) {
          this.push();
          this.scope.vars.set(node.okArm.binding, { line: node.line, col: node.col, used: true });
          this.checkStmt(node.okArm.body);
          this.pop();
        }
        if (node.errArm) {
          this.push();
          this.scope.vars.set(node.errArm.binding, { line: node.line, col: node.col, used: true });
          this.checkStmt(node.errArm.body);
          this.pop();
        }
        return;
      case N.TEST_DECL:
      case N.MEASURE_STMT:
        this.push(); this.checkBlockBody(node.body.body); this.pop();
        return;
      case N.ASSERT_STMT:
        this.checkExpr(node.expr);
        return;
      case N.PACKAGE_DECL:
      case N.PACKAGE_IMPORT:
      case N.TYPE_ALIAS_DECL:
      case N.BREAK_STMT:
      case N.CONTINUE_STMT:
      case N.JS_BLOCK_STMT: // raw escape hatch — nothing to analyze
        return;
    }
  }

  // ── Expressions ───────────────────────────────────────────────────────────

  checkExpr(node) {
    if (!node) return;
    switch (node.type) {
      case N.IDENTIFIER:
        if (this.withDepth === 0) this.use(node.name);
        return;
      case N.CALL_EXPR:
        if (typeof node.callee === 'object') this.checkExpr(node.callee);
        for (const a of node.args) this.checkExpr(a);
        return;
      case N.MEMBER_EXPR: this.checkExpr(node.object); return;
      case N.INDEX_EXPR: this.checkExpr(node.object); this.checkExpr(node.index); return;
      case N.ASSIGN_EXPR: this.checkExpr(node.target); this.checkExpr(node.value); return;
      case N.BINARY_EXPR: this.checkExpr(node.left); this.checkExpr(node.right); return;
      case N.UNARY_EXPR: this.checkExpr(node.operand); return;
      case N.STRUCT_INIT: for (const f of node.fields) this.checkExpr(f.value); return;
      case N.ARRAY_LITERAL: for (const e of node.elements) this.checkExpr(e); return;
      case N.OBJECT_LITERAL: for (const f of node.fields) this.checkExpr(f.value); return;
      case N.OBJECT_TRANSFORM_EXPR:
        this.checkExpr(node.source);
        this.withDepth++;
        for (const f of node.fields) this.checkExpr(f.value);
        this.withDepth--;
        return;
      case N.TEMPLATE_EXPR:
        for (const p of node.parts) if (p.kind === 'expr') this.checkExpr(p.expr);
        return;
      case N.SPREAD_ELEMENT: this.checkExpr(node.value); return;
      case N.TERNARY_EXPR:
        this.checkExpr(node.condition); this.checkExpr(node.consequent); this.checkExpr(node.alternate);
        return;
      case N.AWAIT_EXPR: this.checkExpr(node.expr); return;
      case N.FUNC_EXPR: {
        const savedWithDepth = this.withDepth;
        this.withDepth = 0;
        this.push();
        for (const p of node.params) this.scope.vars.set(p.name, { line: node.line, col: node.col, used: true });
        if (node.isArrow && node.exprBody) this.checkExpr(node.exprBody);
        else this.checkBlockBody(node.body.body);
        this.pop();
        this.withDepth = savedWithDepth;
        return;
      }
      // Literals: nothing to check
    }
  }
}

function lint(ast) {
  return new Linter().lint(ast);
}

module.exports = { Linter, lint };
