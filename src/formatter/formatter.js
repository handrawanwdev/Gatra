'use strict';

const { tokenize }    = require('../lexer/lexer');
const { parse }       = require('../parser/parser');
const { NodeType: N } = require('../ast/nodes');

// gatra rapikan — satu format resmi, tanpa opsi konfigurasi.
// Mem-parse source lalu mencetak ulang AST sebagai kode Gatra yang rapi.

const INDENT = '  ';

// Reverse map dari tipe kanonik internal → kata permukaan Bahasa Indonesia
const TYPE_NAMES = {
  number: 'angka', string: 'teks', bool: 'logika', void: 'tiada',
  unknown: 'apa_saja', null: 'kosong',
};

function typeToSource(t) {
  if (t == null) return null;
  if (t.endsWith('?'))  return typeToSource(t.slice(0, -1)) + '?';
  if (t.endsWith('[]')) return typeToSource(t.slice(0, -2)) + '[]';
  const mapMatch = /^map<(.+), (.+)>$/.exec(t);
  if (mapMatch) return `peta<${typeToSource(mapMatch[1])}, ${typeToSource(mapMatch[2])}>`;
  const resultMatch = /^result<(.+), (.+)>$/.exec(t);
  if (resultMatch) return `hasil<${typeToSource(resultMatch[1])}, ${typeToSource(resultMatch[2])}>`;
  if (t.startsWith('&mut ')) return '&ubah ' + typeToSource(t.slice(5));
  if (t.startsWith('&'))     return '&' + typeToSource(t.slice(1));
  return TYPE_NAMES[t] || t;
}

class Formatter {
  constructor() { this.depth = 0; }

  ind() { return INDENT.repeat(this.depth); }

  fmt(ast) {
    const lines = ast.body.map(s => this.topStmt(s));
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
  }

  topStmt(node) {
    const deco = (node.decorators || []).map(d => this.ind() + this.decoratorSrc(d)).join('\n');
    return (deco ? deco + '\n' : '') + this.ind() + this.stmt(node);
  }

  decoratorSrc(d) {
    return `@${d.name}(${d.args.map(a => this.expr(a)).join(', ')})`;
  }

  // ── Statements ────────────────────────────────────────────────────────────

  stmt(node) {
    switch (node.type) {
      case N.VAR_DECL:          return this.varDecl(node);
      case N.DESTRUCTURE_DECL:  return this.destructureDecl(node);
      case N.FN_DECL:           return this.fnDecl(node);
      case N.STRUCT_DECL:       return this.structDecl(node);
      case N.IF_STMT:           return this.ifStmt(node);
      case N.LOOP_STMT:         return this.loopStmt(node);
      case N.WHILE_STMT:        return this.whileStmt(node);
      case N.TRY_STMT:          return this.tryStmt(node);
      case N.MATCH_STMT:        return this.matchStmt(node);
      case N.MATCH_RESULT_STMT: return this.matchResultStmt(node);
      case N.TEST_DECL:         return this.testDecl(node);
      case N.MEASURE_STMT:      return `ukur ${JSON.stringify(node.label)} ${this.block(node.body)}`;
      case N.ASSERT_STMT:       return 'pastikan ' + this.expr(node.expr);
      case N.RETURN_STMT:       return node.value === null ? 'balik' : 'balik ' + this.expr(node.value);
      case N.BREAK_STMT:        return 'berhenti';
      case N.CONTINUE_STMT:     return 'lanjut';
      case N.PACKAGE_DECL:      return `paket ${node.name}`;
      case N.PACKAGE_IMPORT:
        return node.names
          ? `impor { ${node.names.join(', ')} } dari ${JSON.stringify(node.source)}`
          : `impor ${node.localName} dari ${JSON.stringify(node.source)}`;
      case N.TYPE_ALIAS_DECL:   return `tipe ${node.name} = ${typeToSource(node.target)}`;
      case N.EXPR_STMT:         return this.expr(node.expr);
      case N.JS_BLOCK_STMT:     return `javascript {${node.code}}`;
      default:
        throw new Error(`Formatter: unknown statement '${node.type}'`);
    }
  }

  block(blockNode) {
    if (blockNode.body.length === 0) return '{}';
    this.depth++;
    const body = blockNode.body.map(s => this.ind() + this.stmt(s)).join('\n');
    this.depth--;
    return `{\n${body}\n${this.ind()}}`;
  }

  varDecl(node) {
    const kw   = node.mutable ? 'isi ubah' : 'isi';
    const type = node.varType ? `: ${typeToSource(node.varType)}` : '';
    return `${kw} ${node.name}${type} = ${this.expr(node.value)}`;
  }

  destructureDecl(node) {
    const kw = node.mutable ? 'isi ubah' : 'isi';
    if (node.kind === 'object') {
      const bindings = node.bindings.map(b => b.prop === b.name ? b.name : `${b.prop}: ${b.name}`).join(', ');
      return `${kw} { ${bindings} } = ${this.expr(node.value)}`;
    }
    const bindings = node.bindings.map(b => b.name).join(', ');
    return `${kw} [${bindings}] = ${this.expr(node.value)}`;
  }

  params(params, arrow = false) {
    return params.map(p => {
      const deco = (p.decorators || []).map(d => this.decoratorSrc(d) + ' ').join('');
      if (p.rest) return `${deco}...${p.name}`;
      const mut = p.mutable ? 'ubah ' : '';
      const def = p.default ? ` = ${this.expr(p.default)}` : '';
      if (arrow && p.type === 'unknown') return `${deco}${mut}${p.name}${def}`;
      return `${deco}${mut}${p.name}: ${typeToSource(p.type)}${def}`;
    }).join(', ');
  }

  fnDecl(node) {
    const async_    = node.isAsync ? 'asinkron ' : '';
    const parallel_ = node.isParallel ? 'paralel ' : '';
    const receiver  = node.receiver ? `(${node.receiver.name} ${node.receiver.type}) ` : '';
    const ret       = node.returnType ? `: ${typeToSource(node.returnType)}` : '';
    return `fungsi ${async_}${parallel_}${receiver}${node.name}(${this.params(node.params)})${ret} ${this.block(node.body)}`;
  }

  structDecl(node) {
    if (node.fields.length === 0) return `struktur ${node.name} {}`;
    this.depth++;
    const fields = node.fields.map(f => this.ind() + `${f.name}: ${typeToSource(f.type)}`).join('\n');
    this.depth--;
    return `struktur ${node.name} {\n${fields}\n${this.ind()}}`;
  }

  ifStmt(node) {
    let out = `jika ${this.expr(node.condition)} ${this.block(node.consequent)}`;
    if (node.alternate) {
      if (node.alternate.type === N.IF_STMT) {
        out += ` lain ${this.ifStmt(node.alternate)}`;
      } else {
        out += ` lain ${this.block(node.alternate)}`;
      }
    }
    return out;
  }

  loopStmt(node) {
    if (node.loopType === 'range') {
      return `untuk ${node.iter} dalam ${this.expr(node.start)}..${this.expr(node.end)} ${this.block(node.body)}`;
    }
    return `untuk ${node.iter} dalam ${this.expr(node.source)} ${this.block(node.body)}`;
  }

  whileStmt(node) {
    return `selama ${this.expr(node.condition)} ${this.block(node.body)}`;
  }

  tryStmt(node) {
    let out = `coba ${this.block(node.tryBlock)}`;
    if (node.catchBlock) out += ` tangkap (${node.catchParam}) ${this.block(node.catchBlock)}`;
    if (node.finallyBlock) out += ` akhirnya ${this.block(node.finallyBlock)}`;
    return out;
  }

  matchStmt(node) {
    this.depth++;
    const cases = node.cases.map(c => this.ind() + `kasus ${this.expr(c.test)} -> ${this.stmt(c.body)}`);
    if (node.defaultCase) cases.push(this.ind() + `lain -> ${this.stmt(node.defaultCase)}`);
    const body = cases.join('\n');
    this.depth--;
    return `pilih ${this.expr(node.discriminant)} {\n${body}\n${this.ind()}}`;
  }

  testDecl(node) {
    return `uji ${JSON.stringify(node.label)} ${this.block(node.body)}`;
  }

  matchResultStmt(node) {
    this.depth++;
    const arms = [];
    if (node.okArm)  arms.push(this.ind() + `berhasil(${node.okArm.binding}) => ${this.stmt(node.okArm.body)}`);
    if (node.errArm) arms.push(this.ind() + `gagal(${node.errArm.binding}) => ${this.stmt(node.errArm.body)}`);
    const body = arms.join('\n');
    this.depth--;
    return `cocok ${this.expr(node.discriminant)} {\n${body}\n${this.ind()}}`;
  }

  // ── Expressions ───────────────────────────────────────────────────────────

  expr(node) {
    switch (node.type) {
      case N.IDENTIFIER:     return node.name;
      case N.NUMBER_LITERAL: return String(node.value);
      case N.STRING_LITERAL: return JSON.stringify(node.value);
      case N.BOOL_LITERAL:   return node.value ? 'benar' : 'salah';
      case N.NULL_LITERAL:   return 'kosong';
      case N.REGEX_LITERAL:  return `/${node.pattern}/${node.flags}`;
      case N.BINARY_EXPR:    return `${this.expr(node.left)} ${node.op} ${this.expr(node.right)}`;
      case N.UNARY_EXPR:     return `${node.op}${this.expr(node.operand)}`;
      case N.ASSIGN_EXPR:    return `${this.expr(node.target)} = ${this.expr(node.value)}`;
      case N.CALL_EXPR: {
        const callee = typeof node.callee === 'string' ? 'cetak' : this.expr(node.callee);
        return `${callee}(${node.args.map(a => this.expr(a)).join(', ')})`;
      }
      case N.MEMBER_EXPR:
        return `${this.expr(node.object)}${node.optional ? '?.' : '.'}${node.member}`;
      case N.NAMED_ARG:  return `${node.name}: ${this.expr(node.value)}`;
      case N.INDEX_EXPR: return `${this.expr(node.object)}[${this.expr(node.index)}]`;
      case N.STRUCT_INIT: {
        const fields = node.fields.map(f => `${f.name}: ${this.expr(f.value)}`).join(', ');
        return `${node.name} { ${fields} }`;
      }
      case N.ARRAY_LITERAL: return `[${node.elements.map(e => this.expr(e)).join(', ')}]`;
      case N.OBJECT_LITERAL: {
        if (node.fields.length === 0) return '{}';
        const fields = node.fields.map(f => f.spread ? `...${this.expr(f.value)}` : `${f.name}: ${this.expr(f.value)}`).join(', ');
        return `{ ${fields} }`;
      }
      case N.OBJECT_TRANSFORM_EXPR: {
        const kw = node.spread ? 'ubah' : 'dengan';
        this.depth++;
        const fields = node.fields.map(f => {
          const shorthand = !node.spread && f.value.type === N.IDENTIFIER && f.value.name === f.name;
          return this.ind() + (shorthand ? f.name : `${f.name} = ${this.expr(f.value)}`);
        }).join('\n');
        this.depth--;
        return `${kw} ${this.expr(node.source)} {\n${fields}\n${this.ind()}}`;
      }
      case N.AWAIT_EXPR: {
        const base = `tunggu ${this.expr(node.expr)}`;
        return node.timeoutMs != null ? `${base} batas ${node.timeoutMs / 1000} detik` : base;
      }
      case N.SPREAD_ELEMENT: return `...${this.expr(node.value)}`;
      case N.TERNARY_EXPR: return `${this.expr(node.consequent)} jika ${this.expr(node.condition)} lain ${this.expr(node.alternate)}`;
      case N.TEMPLATE_EXPR: {
        const body = node.parts.map(p => p.kind === 'text' ? p.value : `{${this.expr(p.expr)}}`).join('');
        return `f"${body}"`;
      }
      case N.FUNC_EXPR: {
        if (node.isArrow) {
          const params = this.params(node.params, true);
          if (node.exprBody) return `(${params}) => ${this.expr(node.exprBody)}`;
          return `(${params}) => ${this.block(node.body)}`;
        }
        const async_ = node.isAsync ? 'asinkron ' : '';
        const ret    = node.returnType ? `: ${typeToSource(node.returnType)}` : '';
        return `fungsi ${async_}(${this.params(node.params)})${ret} ${this.block(node.body)}`;
      }
      default:
        throw new Error(`Formatter: unknown expression '${node.type}'`);
    }
  }
}

function format(source) {
  const ast = parse(tokenize(source));
  return new Formatter().fmt(ast);
}

module.exports = { Formatter, format };
