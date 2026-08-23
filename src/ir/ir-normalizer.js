'use strict';

const { NodeType: N } = require('../ast/nodes');

const PRIMITIVE_TYPES = new Set(['number', 'string', 'bool', 'void', 'unknown']);

function isPrimitive(type) {
  if (!type) return true;
  if (type.startsWith('&')) return true;
  if (type === 'null') return true;
  const base = type.endsWith('?') ? type.slice(0, -1) : type;
  return PRIMITIVE_TYPES.has(base);
}

// Annotates each VarDecl with:
//   node._ownershipOp: 'copy' | 'move' | 'borrow' | 'mut_borrow' | 'none'
//   node._borrowTarget: string | null  (original var name if borrow)
// These annotations are consumed by the code generator.

class IRNormalizer {
  normalize(ast) {
    for (const stmt of ast.body) this.normStmt(stmt);
    return ast;
  }

  normStmt(node) {
    switch (node.type) {
      case N.VAR_DECL:          return this.normVarDecl(node);
      case N.DESTRUCTURE_DECL:  return this.normExpr(node.value);
      case N.FN_DECL:        return this.normFnDecl(node);
      case N.IF_STMT:        return this.normIfStmt(node);
      case N.LOOP_STMT:      return this.normLoopStmt(node);
      case N.WHILE_STMT:     return this.normWhileStmt(node);
      case N.TRY_STMT:       return this.normTryStmt(node);
      case N.RETURN_STMT:    return node.value ? this.normExpr(node.value) : undefined;
      case N.EXPR_STMT:      return this.normExpr(node.expr);
      case N.STRUCT_DECL:    break; // nothing to annotate
      case N.PACKAGE_DECL:   break; // metadata only
      case N.PACKAGE_IMPORT: break; // metadata only
      case N.BREAK_STMT:      break;
      case N.CONTINUE_STMT:   break;
      case N.TYPE_ALIAS_DECL: break; // metadata only
      case N.MATCH_STMT:      return this.normMatchStmt(node);
      case N.TEST_DECL:       return this.normTestDecl(node);
      case N.ASSERT_STMT:     return this.normExpr(node.expr);
      case N.TASK_STMT:       return this.normExpr(node.expr);
      case N.STRUCTURED_SPAWN: return this.normStructuredSpawn(node);
      case N.SELECT_STMT:     return this.normSelectStmt(node);
    }
  }

  normStructuredSpawn(node) {
    for (const s of node.body.body) this.normStmt(s);
  }

  normSelectStmt(node) {
    for (const c of node.cases) { this.normExpr(c.channel); this.normStmt(c.body); }
  }

  normTestDecl(node) {
    for (const s of node.body.body) this.normStmt(s);
  }

  normMatchStmt(node) {
    this.normExpr(node.discriminant);
    for (const c of node.cases) {
      this.normExpr(c.test);
      this.normStmt(c.body);
    }
    if (node.defaultCase) this.normStmt(node.defaultCase);
  }

  normVarDecl(node) {
    const val  = node.value;
    const type = node._resolvedType || 'unknown';

    if (val.type === N.BORROW_EXPR) {
      node._ownershipOp  = val.mutable ? 'mut_borrow' : 'borrow';
      node._borrowTarget = val.target;
    } else if (val.type === N.IDENTIFIER && !isPrimitive(val._type || 'unknown')) {
      node._ownershipOp  = 'move';
      node._borrowTarget = null;
    } else {
      node._ownershipOp  = isPrimitive(type) ? 'copy' : 'move';
      node._borrowTarget = null;
    }

    this.normExpr(val);
  }

  normFnDecl(node) {
    for (const stmt of node.body.body) this.normStmt(stmt);
  }

  normIfStmt(node) {
    this.normExpr(node.condition);
    for (const s of node.consequent.body) this.normStmt(s);
    if (node.alternate) {
      if (node.alternate.type === N.IF_STMT) {
        this.normIfStmt(node.alternate);
      } else {
        for (const s of node.alternate.body) this.normStmt(s);
      }
    }
  }

  normLoopStmt(node) {
    if (node.loopType === 'range') {
      this.normExpr(node.start);
      this.normExpr(node.end);
    } else {
      this.normExpr(node.source);
    }
    for (const s of node.body.body) this.normStmt(s);
  }

  normWhileStmt(node) {
    this.normExpr(node.condition);
    for (const s of node.body.body) this.normStmt(s);
  }

  normTryStmt(node) {
    for (const s of node.tryBlock.body) this.normStmt(s);
    if (node.catchBlock) for (const s of node.catchBlock.body) this.normStmt(s);
    if (node.finallyBlock) for (const s of node.finallyBlock.body) this.normStmt(s);
  }

  normExpr(node) {
    if (!node) return;
    switch (node.type) {
      case N.BINARY_EXPR:
        this.normExpr(node.left);
        this.normExpr(node.right);
        break;
      case N.UNARY_EXPR:
        this.normExpr(node.operand);
        break;
      case N.CALL_EXPR:
        if (typeof node.callee === 'object') this.normExpr(node.callee);
        for (const a of node.args) {
          // Annotate each arg with ownership op
          const t = a._type || 'unknown';
          a._ownershipOp = (a.type === N.IDENTIFIER && !isPrimitive(t)) ? 'move' : 'copy';
          this.normExpr(a);
        }
        break;
      case N.STRUCT_INIT:
        for (const f of node.fields) this.normExpr(f.value);
        break;
      case N.ARRAY_LITERAL:
        for (const el of node.elements) this.normExpr(el);
        break;
      case N.OBJECT_LITERAL:
        for (const f of node.fields) this.normExpr(f.value);
        break;
      case N.TEMPLATE_EXPR:
        for (const p of node.parts) { if (p.kind === 'expr') this.normExpr(p.expr); }
        break;
      case N.SPREAD_ELEMENT:
        this.normExpr(node.value);
        break;
      case N.TERNARY_EXPR:
        this.normExpr(node.condition);
        this.normExpr(node.consequent);
        this.normExpr(node.alternate);
        break;
      case N.MEMBER_EXPR:
        this.normExpr(node.object);
        break;
      case N.ASSIGN_EXPR:
        this.normExpr(node.value);
        break;
      case N.AWAIT_EXPR:
        this.normExpr(node.expr);
        break;
      case N.FUNC_EXPR:
        for (const s of node.body.body) this.normStmt(s);
        break;
      case N.SPAWN_EXPR:
        this.normExpr(node.call);
        break;
    }
  }
}

function irNormalize(ast) {
  return new IRNormalizer().normalize(ast);
}

module.exports = { IRNormalizer, irNormalize };
