'use strict';

const { NodeType: N }           = require('../ast/nodes');
const { makeOwnershipErrors }   = require('./ownership-errors');

const PRIMITIVE_TYPES = new Set(['number', 'string', 'bool', 'void', 'unknown']);

function isPrimitive(type) {
  if (!type) return true;
  // Borrow refs (&T, &mut T) are lightweight — treated as copy for ownership purposes
  if (type.startsWith('&')) return true;
  if (type === 'null') return true;
  const base = type.endsWith('?') ? type.slice(0, -1) : type;
  return PRIMITIVE_TYPES.has(base);
}

// ── Per-variable ownership state ─────────────────────────────────────────────

// state: 'owned' | 'moved' | 'borrowed' | 'mut_borrowed'
// borrowedBy: Set of ref-variable names currently borrowing this var
// borrowedFrom: name of the variable this ref borrows (if isRef)
// isRef / refMutable: whether this var IS a borrow ref

class OwnershipScope {
  constructor() { this.vars = new Map(); }

  define(name, info) { this.vars.set(name, info); }
  has(name)          { return this.vars.has(name); }
  get(name)          { return this.vars.get(name); }
}

class OwnershipChecker {
  constructor(grammar) {
    this.grammar = grammar || 'en';
    this.err     = makeOwnershipErrors(grammar);
    this.scopes  = [new OwnershipScope()];
  }

  // ── Scope management ────────────────────────────────────────────────────────

  push() { this.scopes.push(new OwnershipScope()); }

  pop() {
    const scope = this.scopes[this.scopes.length - 1];
    // Release all borrows held by variables in this scope
    for (const [, info] of scope.vars) {
      if (info.isRef && info.borrowedFrom) {
        const original = this.lookup(info.borrowedFrom);
        if (original) {
          original.borrowedBy.delete(info.varName);
          if (original.borrowedBy.size === 0) {
            original.state = 'owned';
          }
        }
      }
    }
    this.scopes.pop();
  }

  define(name, info) {
    this.scopes[this.scopes.length - 1].define(name, info);
  }

  lookup(name) {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      if (this.scopes[i].has(name)) return this.scopes[i].get(name);
    }
    return null;
  }

  // ── Entry point ─────────────────────────────────────────────────────────────

  check(ast) {
    for (const stmt of ast.body) this.checkStmt(stmt);
  }

  // ── Statements ──────────────────────────────────────────────────────────────

  checkStmt(node) {
    switch (node.type) {
      case N.VAR_DECL:          return this.checkVarDecl(node);
      case N.DESTRUCTURE_DECL:  return this.checkDestructureDecl(node);
      case N.FN_DECL:        return this.checkFnDecl(node);
      case N.STRUCT_DECL:    return this.checkStructDecl(node);
      case N.IF_STMT:        return this.checkIfStmt(node);
      case N.LOOP_STMT:      return this.checkLoopStmt(node);
      case N.WHILE_STMT:     return this.checkWhileStmt(node);
      case N.TRY_STMT:       return this.checkTryStmt(node);
      case N.RETURN_STMT:    return this.checkReturnStmt(node);
      case N.EXPR_STMT:      return this.checkExprStmt(node);
      case N.PACKAGE_DECL:   return; // no ownership semantics
      case N.PACKAGE_IMPORT: return; // imported namespaces are never moved/borrowed
      case N.BREAK_STMT:      return;
      case N.CONTINUE_STMT:   return;
      case N.TYPE_ALIAS_DECL: return; // metadata only
      case N.MATCH_STMT:      return this.checkMatchStmt(node);
      case N.TEST_DECL:       return this.checkTestDecl(node);
      case N.ASSERT_STMT:     return this.checkExpr(node.expr);
      case N.TASK_STMT:       return this.checkExpr(node.expr);
      case N.STRUCTURED_SPAWN: return this.checkStructuredSpawn(node);
      case N.SELECT_STMT:     return this.checkSelectStmt(node);
    }
  }

  checkStructuredSpawn(node) {
    this.push();
    for (const s of node.body.body) this.checkStmt(s);
    this.pop();
  }

  checkSelectStmt(node) {
    for (const c of node.cases) {
      this.checkExpr(c.channel);
      this.push();
      this.checkStmt(c.body);
      this.pop();
    }
  }

  checkTestDecl(node) {
    this.push();
    for (const s of node.body.body) this.checkStmt(s);
    this.pop();
  }

  checkMatchStmt(node) {
    this.checkExpr(node.discriminant);
    for (const c of node.cases) {
      this.checkExpr(c.test);
      this.push();
      this.checkStmt(c.body);
      this.pop();
    }
    if (node.defaultCase) {
      this.push();
      this.checkStmt(node.defaultCase);
      this.pop();
    }
  }

  checkVarDecl(node) {
    const type = node._resolvedType || node.varType || 'unknown';

    // Handle borrow expressions specially
    if (node.value.type === N.BORROW_EXPR) {
      this.applyBorrow(node.name, node.value, node.mutable || false);
      return;
    }

    // For non-borrow values: check the value expression for use-after-move
    this.checkExpr(node.value);

    // If the value is an identifier of a non-primitive type → move
    if (node.value.type === N.IDENTIFIER) {
      const sourceType = node.value._type || 'unknown';
      if (!isPrimitive(sourceType)) {
        this.applyMove(node.value.name, node.value.line, node.value.col);
      }
    }

    // Register the new variable as owned
    this.define(node.name, {
      varName: node.name,
      type,
      mutable: node.mutable || false,
      state: 'owned',
      borrowedBy: new Set(),
      isRef: false,
      borrowedFrom: null,
      refMutable: null,
      movedAt: null,
    });
  }

  checkDestructureDecl(node) {
    this.checkExpr(node.value);
    for (const b of node.bindings) {
      this.define(b.name, {
        varName: b.name, type: 'unknown', mutable: node.mutable || false, state: 'owned',
        borrowedBy: new Set(), isRef: false, borrowedFrom: null, refMutable: null, movedAt: null,
      });
    }
  }

  checkFnDecl(node) {
    // Register fn itself (non-ownable, just skip)
    this.push();

    for (const p of node.params) {
      this.define(p.name, {
        varName: p.name,
        type: p.type,
        mutable: false,
        state: 'owned',
        borrowedBy: new Set(),
        isRef: false, borrowedFrom: null, refMutable: null, movedAt: null,
      });
    }

    for (const stmt of node.body.body) this.checkStmt(stmt);
    this.pop();
  }

  checkStructDecl(_node) { /* structs have no ownership state themselves */ }

  checkIfStmt(node) {
    this.checkExpr(node.condition);

    this.push();
    for (const s of node.consequent.body) this.checkStmt(s);
    this.pop();

    if (node.alternate) {
      if (node.alternate.type === N.IF_STMT) {
        this.checkIfStmt(node.alternate); // else-if chain
      } else {
        this.push();
        for (const s of node.alternate.body) this.checkStmt(s);
        this.pop();
      }
    }
  }

  checkLoopStmt(node) {
    if (node.loopType === 'range') {
      this.checkExpr(node.start);
      this.checkExpr(node.end);
    } else {
      this.checkExpr(node.source);
    }
    this.push();
    // Iterator var is a primitive (number/element) — always owned, never moved
    this.define(node.iter, {
      varName: node.iter, type: 'number', mutable: false,
      state: 'owned', borrowedBy: new Set(),
      isRef: false, borrowedFrom: null, refMutable: null, movedAt: null,
    });
    for (const s of node.body.body) this.checkStmt(s);
    this.pop();
  }

  checkWhileStmt(node) {
    this.checkExpr(node.condition);
    this.push();
    for (const s of node.body.body) this.checkStmt(s);
    this.pop();
  }

  checkTryStmt(node) {
    this.push();
    for (const s of node.tryBlock.body) this.checkStmt(s);
    this.pop();

    if (node.catchBlock) {
      this.push();
      this.define(node.catchParam, {
        varName: node.catchParam, type: 'unknown', mutable: false, state: 'owned',
        borrowedBy: new Set(), isRef: false, borrowedFrom: null, refMutable: null, movedAt: null,
      });
      for (const s of node.catchBlock.body) this.checkStmt(s);
      this.pop();
    }

    if (node.finallyBlock) {
      this.push();
      for (const s of node.finallyBlock.body) this.checkStmt(s);
      this.pop();
    }
  }

  checkReturnStmt(node) {
    if (!node.value) return; // void return
    this.checkExpr(node.value);
    // If returning a non-primitive identifier, mark it moved
    if (node.value.type === N.IDENTIFIER) {
      const t = node.value._type || 'unknown';
      if (!isPrimitive(t)) {
        this.applyMove(node.value.name, node.value.line, node.value.col);
      }
    }
  }

  checkExprStmt(node) {
    this.checkExpr(node.expr);
  }

  // ── Expressions ─────────────────────────────────────────────────────────────

  checkExpr(node) {
    if (!node) return;
    switch (node.type) {
      case N.IDENTIFIER:  return this.checkIdentifierUse(node);
      case N.CALL_EXPR:   return this.checkCallExpr(node);
      case N.ASSIGN_EXPR: return this.checkAssignExpr(node);
      case N.BINARY_EXPR:
        this.checkExpr(node.left);
        this.checkExpr(node.right);
        break;
      case N.UNARY_EXPR:
        this.checkExpr(node.operand);
        break;
      case N.MEMBER_EXPR:
        this.checkExpr(node.object);
        break;
      case N.AWAIT_EXPR:
        this.checkExpr(node.expr);
        break;
      case N.FUNC_EXPR:
        // Anonymous function: check body in new scope (closures capture by ref in JS)
        this.push();
        for (const p of node.params) {
          this.define(p.name, {
            varName: p.name, type: p.type, mutable: false, state: 'owned',
            borrowedBy: new Set(), isRef: false, borrowedFrom: null, refMutable: null, movedAt: null,
          });
        }
        for (const s of node.body.body) this.checkStmt(s);
        this.pop();
        break;
      case N.DEREF_EXPR:
        this.checkDerefRead(node);
        break;
      case N.BORROW_EXPR:
        // Borrow in expression context (not in VarDecl) — validate target
        this.validateBorrowTarget(node);
        break;
      case N.STRUCT_INIT:
        for (const f of node.fields) this.checkExpr(f.value);
        break;
      case N.ARRAY_LITERAL:
        for (const el of node.elements) this.checkExpr(el);
        break;
      case N.OBJECT_LITERAL:
        for (const f of node.fields) this.checkExpr(f.value);
        break;
      case N.TEMPLATE_EXPR:
        for (const p of node.parts) { if (p.kind === 'expr') this.checkExpr(p.expr); }
        break;
      case N.SPREAD_ELEMENT:
        this.checkExpr(node.value);
        break;
      case N.TERNARY_EXPR:
        this.checkExpr(node.condition);
        this.checkExpr(node.consequent);
        this.checkExpr(node.alternate);
        break;
      case N.SPAWN_EXPR:
        this.checkExpr(node.call);
        break;
      // Literals have no ownership concerns
    }
  }

  checkIdentifierUse(node) {
    const info = this.lookup(node.name);
    if (!info) return; // type checker already caught undefined
    if (info.state === 'moved') {
      throw this.err.useAfterMove(
        node.name,
        info.movedAt.line, info.movedAt.col,
        node.line, node.col
      );
    }
  }

  checkCallExpr(node) {
    // cetak() only reads its arguments for display — it never takes ownership
    if (node.callee === '__print__') {
      for (const arg of node.args) this.checkExpr(arg);
      return;
    }

    // Check each argument — non-primitive args are moved into the function
    for (const arg of node.args) {
      this.checkExpr(arg);
      if (arg.type === N.IDENTIFIER) {
        const t = arg._type || 'unknown';
        if (!isPrimitive(t)) {
          this.applyMove(arg.name, arg.line, arg.col);
        }
      }
    }
    // Resolve callee (for method calls etc.)
    if (typeof node.callee === 'object') {
      this.checkExpr(node.callee);
    }
  }

  checkAssignExpr(node) {
    // Check value expression first
    this.checkExpr(node.value);

    // If value is non-primitive identifier → ownership transfers (move)
    if (node.value.type === N.IDENTIFIER) {
      const t = node.value._type || 'unknown';
      if (!isPrimitive(t)) {
        this.applyMove(node.value.name, node.value.line, node.value.col);
      }
    }

    if (node.target.type === N.IDENTIFIER) {
      const info = this.lookup(node.target.name);
      if (info) {
        if (!info.mutable) {
          throw this.err.assignNonMutable(node.target.name, node.target.line, node.target.col);
        }
        if (info.state === 'moved') {
          throw this.err.useAfterMove(
            node.target.name,
            info.movedAt.line, info.movedAt.col,
            node.target.line, node.target.col
          );
        }
      }
    }

    if (node.target.type === N.DEREF_EXPR) {
      this.checkDerefWrite(node.target);
    }
  }

  checkDerefRead(node) {
    const info = this.lookup(node.ref);
    if (!info) return;
    if (!info.isRef) {
      throw this.err.derefNonRef(node.ref, node.line, node.col);
    }
    // Check the borrowed-from variable is still valid
    if (info.borrowedFrom) {
      const original = this.lookup(info.borrowedFrom);
      if (original && original.state === 'moved') {
        throw this.err.useAfterMove(
          info.borrowedFrom,
          original.movedAt.line, original.movedAt.col,
          node.line, node.col
        );
      }
    }
  }

  checkDerefWrite(node) {
    const info = this.lookup(node.ref);
    if (!info) return;
    if (!info.isRef) {
      throw this.err.derefNonRef(node.ref, node.line, node.col);
    }
    if (!info.refMutable) {
      throw this.err.assignThroughImmutableRef(node.ref, node.line, node.col);
    }
  }

  validateBorrowTarget(node) {
    const info = this.lookup(node.target);
    if (!info) return;
    if (info.state === 'moved') {
      throw this.err.useAfterMove(
        node.target, info.movedAt.line, info.movedAt.col, node.line, node.col
      );
    }
  }

  // ── Ownership operations ─────────────────────────────────────────────────────

  applyMove(name, line, col) {
    const info = this.lookup(name);
    if (!info) return;
    if (info.state === 'moved') return; // already caught in checkIdentifierUse

    // Cannot move while borrowed
    if (info.state === 'borrowed' || info.state === 'mut_borrowed') {
      throw this.err.moveWhileBorrowed(name, line, col);
    }

    info.state   = 'moved';
    info.movedAt = { line, col };
  }

  applyBorrow(refName, borrowExpr, _declMutable) {
    const targetName = borrowExpr.target;
    const isMut      = borrowExpr.mutable;
    const original   = this.lookup(targetName);

    if (!original) return; // type checker caught undefined

    // Cannot borrow a moved variable
    if (original.state === 'moved') {
      throw this.err.useAfterMove(
        targetName, original.movedAt.line, original.movedAt.col,
        borrowExpr.line, borrowExpr.col
      );
    }

    if (isMut) {
      // Mutable borrow rules
      if (!original.mutable) {
        throw this.err.borrowNonMutable(targetName, borrowExpr.line, borrowExpr.col);
      }
      if (original.state === 'borrowed') {
        throw this.err.mutBorrowConflict(targetName, borrowExpr.line, borrowExpr.col);
      }
      if (original.state === 'mut_borrowed') {
        // Find existing mutable borrower for hint
        const existingRef = [...original.borrowedBy][0];
        const existingInfo = existingRef ? this.lookup(existingRef) : null;
        throw this.err.doubleMutBorrow(
          targetName,
          existingInfo ? existingInfo.definedAt.line : borrowExpr.line,
          existingInfo ? existingInfo.definedAt.col  : borrowExpr.col,
          borrowExpr.line, borrowExpr.col
        );
      }
      original.state = 'mut_borrowed';
    } else {
      // Immutable borrow rules
      if (original.state === 'mut_borrowed') {
        throw this.err.mutBorrowConflict(targetName, borrowExpr.line, borrowExpr.col);
      }
      original.state = 'borrowed';
    }

    original.borrowedBy.add(refName);

    // Register the ref variable itself
    this.define(refName, {
      varName: refName,
      type: isMut ? `&mut ${original.type}` : `&${original.type}`,
      mutable: false,
      state: 'owned',
      borrowedBy: new Set(),
      isRef: true,
      refMutable: isMut,
      borrowedFrom: targetName,
      movedAt: null,
      definedAt: { line: borrowExpr.line, col: borrowExpr.col },
    });
  }
}

function ownershipCheck(ast, grammar) {
  new OwnershipChecker(grammar).check(ast);
}

module.exports = { OwnershipChecker, ownershipCheck };
