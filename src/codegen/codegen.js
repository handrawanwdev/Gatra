'use strict';

const { NodeType: N } = require('../ast/nodes');

// Runtime primitives for pustaka/sinkronisasi (kunci/saluran).
// Both are async-task-level primitives (Promise-based) — they serialize
// concurrent 'fungsi asinkron' work on Node's single event loop; they are
// not OS threads (that is 'pekerja' / Worker Threads, a separate feature).
const KUNCI_PRELUDE = `function __gatra_kunci() {
  let __terkunci = false;
  const __antrean = [];
  return {
    kunci() {
      return new Promise((selesai) => {
        if (!__terkunci) { __terkunci = true; selesai(); }
        else __antrean.push(selesai);
      });
    },
    buka() {
      if (__antrean.length > 0) __antrean.shift()();
      else __terkunci = false;
    },
  };
}`;

const SALURAN_PRELUDE = `function __gatra_saluran() {
  const __bufer = [];
  const __penunggu = [];
  return {
    kirim(nilai) {
      if (__penunggu.length > 0) __penunggu.shift()(nilai);
      else __bufer.push(nilai);
    },
    terima() {
      if (__bufer.length > 0) return Promise.resolve(__bufer.shift());
      return new Promise((selesai) => __penunggu.push(selesai));
    },
  };
}`;

// Recursively scans an AST (or any plain object/array) for a zero-arg call
// to the given builtin name — e.g. isUsed(ast, 'kunci') for `kunci()`.
function usesBuiltinCall(node, name) {
  if (!node || typeof node !== 'object') return false;
  if (Array.isArray(node)) return node.some(n => usesBuiltinCall(n, name));
  if (node.type === N.CALL_EXPR && typeof node.callee === 'object' &&
      node.callee.type === N.IDENTIFIER && node.callee.name === name) {
    return true;
  }
  return Object.keys(node).some(k => k !== 'type' && usesBuiltinCall(node[k], name));
}

// Recursively scans an AST (or any plain object/array) for any node of the given type.
function usesNodeType(node, type) {
  if (!node || typeof node !== 'object') return false;
  if (Array.isArray(node)) return node.some(n => usesNodeType(n, type));
  if (node.type === type) return true;
  return Object.keys(node).some(k => k !== 'type' && usesNodeType(node[k], type));
}

// pekerja/jalankan — spawns a real OS thread (Node worker_threads) to run a
// self-contained (closure-free) function, serialized via .toString(). This
// is genuine parallelism, unlike kunci/saluran which are async-task-level.
const JALANKAN_PRELUDE = `function __gatra_jalankan(__gatra_fn, __gatra_args) {
  const { Worker } = require('worker_threads');
  return new Promise((selesai, tolak) => {
    const __gatra_kode =
      'const { parentPort } = require("worker_threads");' +
      'const __fn = (' + __gatra_fn.toString() + ');' +
      'Promise.resolve(__fn(...' + JSON.stringify(__gatra_args) + ')).then(' +
      '  (hasil) => parentPort.postMessage({ ok: true, hasil }),' +
      '  (galat) => parentPort.postMessage({ ok: false, galat: String(galat) })' +
      ');';
    const __gatra_w = new Worker(__gatra_kode, { eval: true });
    __gatra_w.on('message', (pesan) => {
      __gatra_w.terminate();
      if (pesan.ok) selesai(pesan.hasil); else tolak(new Error(pesan.galat));
    });
    __gatra_w.on('error', tolak);
  });
}`;

class CodeGenerator {
  constructor(opts = {}) {
    this.depth          = 0;
    this.isPackage       = false; // true when a PackageDeclaration is present
    this.borrowMap       = new Map(); // refName → originalVarName (for deref-assign)
    this.matchCounter    = 0;
    this.spawnCounter    = 0;
    this.taskCollectors  = []; // stack of array-var names for enclosing 'jalankan { } tunggu' blocks
    this.includeTests    = !!opts.includeTests; // 'gatra uji' compiles with tests active
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
      case N.STRUCT_INIT:    return this.genStructInit(node);
      case N.ARRAY_LITERAL:  return this.genArrayLiteral(node);
      case N.BORROW_EXPR:    return this.genBorrowExpr(node);
      case N.DEREF_EXPR:     return this.genDerefExpr(node);
      case N.AWAIT_EXPR:     return this.genAwaitExpr(node);
      case N.FUNC_EXPR:      return this.genFuncExpr(node);
      case N.NULL_LITERAL:      return 'null';
      case N.OBJECT_LITERAL:    return this.genObjectLiteral(node);
      case N.TEMPLATE_EXPR:     return this.genTemplateExpr(node);
      case N.DESTRUCTURE_DECL:  return this.genDestructureDecl(node);
      case N.SPREAD_ELEMENT:    return this.genSpreadElement(node);
      case N.TERNARY_EXPR:      return this.genTernaryExpr(node);
      case N.BREAK_STMT:        return 'break';
      case N.CONTINUE_STMT:     return 'continue';
      case N.TYPE_ALIAS_DECL:   return ''; // metadata — no JS output
      case N.MATCH_STMT:        return this.genMatchStmt(node);
      case N.TEST_DECL:         return this.genTestDecl(node);
      case N.ASSERT_STMT:       return this.genAssertStmt(node);
      case N.SPAWN_EXPR:        return this.genSpawnExpr(node);
      case N.TASK_STMT:         return this.genTaskStmt(node);
      case N.STRUCTURED_SPAWN:  return this.genStructuredSpawn(node);
      case N.SELECT_STMT:       return this.genSelectStmt(node);
      case N.IDENTIFIER:     return node.name;
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

    // Runtime prelude: only emitted when kunci()/saluran() are actually called
    const needsKunci    = usesBuiltinCall(node, 'kunci');
    const needsSaluran  = usesBuiltinCall(node, 'saluran');
    const needsJalankan = usesNodeType(node, N.SPAWN_EXPR);
    if (needsKunci)    lines.push(KUNCI_PRELUDE);
    if (needsSaluran)  lines.push(SALURAN_PRELUDE);
    if (needsJalankan) lines.push(JALANKAN_PRELUDE);

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
      case N.TEST_DECL:
      case N.ASSERT_STMT:
      case N.STRUCTURED_SPAWN:
      case N.SELECT_STMT:
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
      case N.TEST_DECL:
      case N.ASSERT_STMT:
      case N.STRUCTURED_SPAWN:
      case N.SELECT_STMT:
        return ind + this.generate(node);
      default:
        return ind + this.generate(node) + ';';
    }
  }

  genVarDecl(node) {
    // Track borrow targets so deref-assign can resolve original variable
    if (node._borrowTarget) {
      this.borrowMap.set(node.name, node._borrowTarget);
    }
    const keyword = node.mutable ? 'let' : 'let';
    return `${keyword} ${node.name} = ${this.generate(node.value)}`;
  }

  genFnDecl(node) {
    const async_ = node.isAsync ? 'async ' : '';
    const params = node.params.map(p => p.default ? `${p.name} = ${this.generate(p.default)}` : p.name).join(', ');
    const body   = this.genBlockBody(node.body);
    return `${async_}function ${node.name}(${params}) {\n${body}\n${this.ind()}}`;
  }

  genAwaitExpr(node) {
    return `await ${this.generate(node.expr)}`;
  }

  genFuncExpr(node) {
    const async_ = node.isAsync ? 'async ' : '';
    const params  = node.params.map(p => p.default ? `${p.name} = ${this.generate(p.default)}` : p.name).join(', ');
    const body    = this.genBlockBody(node.body);
    return `${async_}function(${params}) {\n${body}\n${this.ind()}}`;
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
    // *r = value  →  resolve original var via borrow map and assign to it
    if (node.target.type === N.DEREF_EXPR) {
      const refName  = node.target.ref;
      const original = this.borrowMap.get(refName) || refName;
      return `${original} = ${this.generate(node.value)}`;
    }
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

    // Built-in kunci()/saluran() factory calls — rewritten to a mangled
    // runtime name so they never collide with a user variable that shadows
    // the same surface name (e.g. `isi kunci = kunci()`).
    if (typeof node.callee === 'object' && node.callee.type === N.IDENTIFIER) {
      if (node.callee.name === 'kunci')   return `__gatra_kunci(${args})`;
      if (node.callee.name === 'saluran') return `__gatra_saluran(${args})`;
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
    return `${this.generate(node.object)}.${node.member}`;
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

  genSpawnExpr(node) {
    const callee = this.generate(node.call.callee);
    const args   = node.call.args.map(a => this.generate(a)).join(', ');
    return `__gatra_jalankan(${callee}, [${args}])`;
  }

  genTaskStmt(node) {
    const exprJs = this.generate(node.expr);
    if (this.taskCollectors.length > 0) {
      const arr = this.taskCollectors[this.taskCollectors.length - 1];
      return `${arr}.push(${exprJs})`;
    }
    return exprJs;
  }

  genStructuredSpawn(node) {
    const arr = `__gatra_tugas${this.spawnCounter++}`;
    this.taskCollectors.push(arr);
    this.depth++;
    const declLine = `${this.ind()}const ${arr} = [];`;
    const bodyLines = node.body.body.map(s => this.genBlockStmt(s)).join('\n');
    const waitLine = `${this.ind()}await Promise.all(${arr});`;
    this.depth--;
    this.taskCollectors.pop();
    return `{\n${declLine}\n${bodyLines}\n${waitLine}\n${this.ind()}}`;
  }

  genSelectStmt(node) {
    const arms = node.cases.map(c => {
      const chan = this.generate(c.channel);
      this.depth++;
      const bodyLine = this.genBlockStmt(c.body);
      this.depth--;
      return `${chan}.terima().then(() => {\n${bodyLine}\n${this.ind()}})`;
    });
    return `await Promise.race([${arms.join(', ')}]);`;
  }

  genTestDecl(node) {
    const body = this.genBlockBody(node.body);
    return `__gatra_uji_daftar.push([${JSON.stringify(node.label)}, async () => {\n${body}\n${this.ind()}}]);`;
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

  genTernaryExpr(node) {
    return `(${this.generate(node.condition)} ? ${this.generate(node.consequent)} : ${this.generate(node.alternate)})`;
  }

  // &x  →  x  (borrow is invisible in JS output — ownership is compile-time only)
  genBorrowExpr(node) {
    return node.target;
  }

  // *r  →  r  (dereference is invisible in JS for reads — JS refs handle it)
  genDerefExpr(node) {
    // For read access: just emit the ref variable name
    // Write access (*r = v) is handled in genAssignExpr via borrowMap
    return node.ref;
  }
}

function generate(ast, opts) {
  return new CodeGenerator(opts).generate(ast);
}

module.exports = { CodeGenerator, generate };
