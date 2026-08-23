'use strict';

const { NodeType: N } = require('../ast/nodes');

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

class CodeGenerator {
  constructor(opts = {}) {
    this.depth        = 0;
    this.isPackage     = false; // true when a PackageDeclaration is present
    this.matchCounter  = 0;
    this.measureCounter = 0;
    this.withCounter   = 0;
    this.withStack     = []; // active 'dengan'/'ubah' IIFE param names — innermost last
    this.includeTests  = !!opts.includeTests; // 'gatra uji' compiles with tests active
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

    const lines = [];

    if (usesTimeout(node)) lines.push(BATAS_PRELUDE);
    if (usesHasil(node)) lines.push(HASIL_PRELUDE);

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
    return `import * as ${node.localName} from ${JSON.stringify(node.source)};`;
  }

  genTopStmt(node) {
    const ind = this.ind();
    switch (node.type) {
      case N.FN_DECL:
        // Auto-export all top-level functions when file has a package declaration,
        // or when the function itself is explicitly marked 'ekspor'
        return ind + (this.isPackage || node.isExported ? 'export ' : '') + this.generate(node);
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
    // Structs are type-only in Phase 1 — emitted as a comment
    const fields = node.fields.map(f => `${f.name}: ${f.type}`).join(', ');
    return `// struct ${node.name} { ${fields} }`;
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
    const op = node.optional ? '?.' : '.';
    return `${this.generate(node.object)}${op}${node.member}`;
  }

  genIndexExpr(node) {
    return `${this.generate(node.object)}[${this.generate(node.index)}]`;
  }

  genStructInit(node) {
    // Compile struct { field: val } → plain JS object { field: val }
    const props = node.fields.map(f => `${f.name}: ${this.generate(f.value)}`).join(', ');
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
