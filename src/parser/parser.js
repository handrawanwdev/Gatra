'use strict';

const { TokenType: T } = require('../lexer/tokens');
const { NodeType: N }  = require('../ast/nodes');
const { ParseError }   = require('./errors');

class Parser {
  constructor(tokens) {
    this.tokens        = tokens;
    this.pos           = 0;
    this.allowStructInit = true; // disabled inside `if` conditions
    this.loopDepth      = 0;     // tracks nesting for berhenti/lanjut validation
  }

  // ── Primitives ─────────────────────────────────────────────────────────────

  peek()       { return this.tokens[this.pos]; }
  previous()   { return this.tokens[this.pos - 1]; }
  isAtEnd()    { return this.peek().type === T.EOF; }

  advance() {
    if (!this.isAtEnd()) this.pos++;
    return this.previous();
  }

  check(type, value) {
    const tok = this.peek();
    if (tok.type !== type) return false;
    if (value !== undefined && tok.value !== value) return false;
    return true;
  }

  matchToken(type, value) {
    if (this.check(type, value)) { this.advance(); return true; }
    return false;
  }

  consume(type, value, message) {
    if (this.check(type, value)) return this.advance();
    const tok = this.peek();
    const got = tok.value !== null ? `'${tok.value}'` : tok.type;
    throw new ParseError(
      message || `Expected ${value !== undefined ? `'${value}'` : type}, got ${got}`,
      tok.line, tok.col
    );
  }

  // Accept either a built-in TYPE token or an IDENTIFIER (user-defined struct type)
  // Supports array types: T[], T[][], larik<T>, peta<K, V>
  consumeType(message) {
    let base;
    if (this.check(T.TYPE))       base = this.advance().value;
    else if (this.check(T.IDENTIFIER)) base = this.advance().value;
    else {
      const tok = this.peek();
      throw new ParseError(
        message || `Expected type, got '${tok.value !== null ? tok.value : tok.type}'`,
        tok.line, tok.col
      );
    }

    // larik<T>  →  desugar ke representasi array yang sama dengan T[]
    if (base === 'array') {
      this.consume(T.LT, undefined, "Expected '<' after 'larik'");
      const inner = this.consumeType('Expected type argument for larik<T>');
      this.consume(T.GT, undefined, "Expected '>' after type argument of larik<T>");
      base = inner + '[]';
    }

    // peta<K, V>  →  peta bertipe (opsional, boleh juga 'peta' polos)
    if (base === 'map' && this.check(T.LT)) {
      this.advance(); // consume '<'
      const key = this.consumeType('Expected key type for peta<K, V>');
      this.consume(T.COMMA, undefined, "Expected ',' between key and value type in peta<K, V>");
      const val = this.consumeType('Expected value type for peta<K, V>');
      this.consume(T.GT, undefined, "Expected '>' after peta<K, V>");
      base = `map<${key}, ${val}>`;
    }

    // hasil<T, E>  →  tipe hasil<T,E> (dua varian: berhasil(T) / gagal(E))
    // 'hasil' bukan kata kunci tipe — dicek dari kata sumbernya langsung
    // supaya tetap bisa dipakai sebagai nama variabel biasa di posisi lain.
    if (base === 'hasil' && this.check(T.LT)) {
      this.advance(); // consume '<'
      const ok  = this.consumeType('Expected ok type for hasil<T, E>');
      this.consume(T.COMMA, undefined, "Expected ',' between types in hasil<T, E>");
      const err = this.consumeType('Expected error type for hasil<T, E>');
      this.consume(T.GT, undefined, "Expected '>' after hasil<T, E>");
      base = `result<${ok}, ${err}>`;
    }

    // data<T>  →  Big Data dataset primitive (bounded/unbounded, lihat BIGDATA_TYPE.md).
    // Sama seperti 'hasil', 'data' bukan kata kunci tipe — dicek dari kata
    // sumbernya supaya tetap bisa dipakai sebagai nama variabel biasa.
    if (base === 'data' && this.check(T.LT)) {
      this.advance(); // consume '<'
      const inner = this.consumeType('Expected type argument for data<T>');
      this.consume(T.GT, undefined, "Expected '>' after type argument of data<T>");
      base = `data<${inner}>`;
    }

    // Consume [] suffixes for array types
    while (this.check(T.LBRACKET)) {
      this.advance(); // consume [
      this.consume(T.RBRACKET, undefined, "Expected ']' after '['");
      base = base + '[]';
    }

    // Opsional: T?
    if (this.check(T.QUESTION)) {
      this.advance();
      base = base + '?';
    }

    return base;
  }

  // ── Top-level ───────────────────────────────────────────────────────────────

  parse() {
    const body = [];
    while (!this.isAtEnd()) {
      body.push(this.statement());
    }
    return { type: N.PROGRAM, body };
  }

  // ── Statements ──────────────────────────────────────────────────────────────

  // @Nama or @Nama(arg, ...), zero or more in a row — decorates the struct
  // or receiver method declaration that immediately follows.
  decoratorList() {
    const decorators = [];
    while (this.check(T.AT)) {
      const atTok = this.advance();
      const name  = this.consume(T.IDENTIFIER, undefined, "Expected decorator name after '@'").value;
      let args = [];
      if (this.check(T.LPAREN)) {
        this.advance();
        args = this.argList();
        this.consume(T.RPAREN, undefined, "Expected ')' after decorator arguments");
      }
      decorators.push({ name, args, line: atTok.line, col: atTok.col });
    }
    return decorators;
  }

  statement() {
    const tok = this.peek();

    if (tok.type === T.AT) {
      const decorators = this.decoratorList();
      const next = this.peek();
      if (next.type === T.KEYWORD && next.value === 'struct') return this.structDecl(decorators);
      if (next.type === T.KEYWORD && next.value === 'fn')     return this.fnDecl(decorators);
      throw new ParseError("'@' decorator must be followed by 'struktur' or 'fungsi'", next.line, next.col);
    }

    if (tok.type === T.JS_BLOCK) {
      this.advance();
      return { type: N.JS_BLOCK_STMT, code: tok.value, line: tok.line, col: tok.col };
    }

    if (tok.type === T.KEYWORD) {
      switch (tok.value) {
        case 'let':     return this.varDecl();
        case 'fn': {
          // Named fn declaration (plain or Go-style receiver method) vs
          // anonymous fn expression in statement position.
          let look = this.pos + 1;
          if (this.tokens[look]?.value === 'async') look++;
          if (this.tokens[look]?.type === T.IDENTIFIER) return this.fnDecl();
          // Receiver method: fungsi (h Hewan) sapa(...) — a bare 'IDENT IDENT'
          // pair inside the parens (no ':') is what tells it apart from an
          // anonymous fn expression's typed param list '(name: type, ...)'.
          if (this.tokens[look]?.type === T.LPAREN &&
              this.tokens[look + 1]?.type === T.IDENTIFIER &&
              this.tokens[look + 2]?.type === T.IDENTIFIER &&
              this.tokens[look + 3]?.type === T.RPAREN &&
              this.tokens[look + 4]?.type === T.IDENTIFIER &&
              this.tokens[look + 5]?.type === T.LPAREN) {
            return this.fnDecl();
          }
          break; // anonymous → falls through to exprStmt
        }
        case 'struct':  return this.structDecl();
        case 'if':      return this.ifStmt();
        case 'for':     return this.forStmt();
        case 'while':   return this.whileStmt();
        case 'try':     return this.tryStmt();
        case 'return':  return this.returnStmt();
        case 'print':   return this.printStmt();
        case 'package': return this.packageDecl();
        case 'import':  return this.packageImport();
        case 'type':    return this.typeAliasDecl();
        case 'break':   return this.breakStmt();
        case 'continue':return this.continueStmt();
        case 'test':    return this.testDecl();
        case 'measure': return this.measureStmt();
        case 'assert':  return this.assertStmt();
        case 'select':  return this.matchStmt();
        case 'match':   return this.matchResultStmt();
      }
    }

    return this.exprStmt();
  }

  varDecl() {
    const tok = this.consume(T.KEYWORD, 'let');

    let mutable = false;
    if (this.check(T.KEYWORD, 'mut')) { this.advance(); mutable = true; }

    // Object destructuring: isi { id, nama } = expr
    if (this.check(T.LBRACE)) return this.destructureDecl(tok, mutable, 'object');
    // Array destructuring: isi [first, second] = expr
    if (this.check(T.LBRACKET)) return this.destructureDecl(tok, mutable, 'array');

    const name = this.consume(T.IDENTIFIER, undefined, "Expected variable name after 'isi'").value;

    let varType = null;
    if (this.matchToken(T.COLON)) {
      varType = this.consumeType("Expected type after ':'");
    }

    this.consume(T.EQUALS, undefined, "Expected '=' in variable declaration");
    const value = this.expression();

    return { type: N.VAR_DECL, name, varType, value, mutable, line: tok.line, col: tok.col };
  }

  destructureDecl(tok, mutable, kind) {
    if (kind === 'object') {
      this.consume(T.LBRACE, undefined, "Expected '{'");
      const bindings = [];
      while (!this.check(T.RBRACE) && !this.isAtEnd()) {
        const propTok = this.consume(T.IDENTIFIER, undefined, 'Expected property name').value;
        let name = propTok, prop = propTok;
        if (this.matchToken(T.COLON)) {
          name = this.consume(T.IDENTIFIER, undefined, 'Expected binding name').value;
        }
        bindings.push({ prop, name });
        this.matchToken(T.COMMA);
      }
      this.consume(T.RBRACE, undefined, "Expected '}'");
      this.consume(T.EQUALS, undefined, "Expected '='");
      const value = this.expression();
      return { type: N.DESTRUCTURE_DECL, kind: 'object', bindings, value, mutable, line: tok.line, col: tok.col };
    }
    // array
    this.consume(T.LBRACKET, undefined, "Expected '['");
    const bindings = [];
    while (!this.check(T.RBRACKET) && !this.isAtEnd()) {
      const name = this.consume(T.IDENTIFIER, undefined, 'Expected binding name').value;
      bindings.push({ name });
      this.matchToken(T.COMMA);
    }
    this.consume(T.RBRACKET, undefined, "Expected ']'");
    this.consume(T.EQUALS, undefined, "Expected '='");
    const value = this.expression();
    return { type: N.DESTRUCTURE_DECL, kind: 'array', bindings, value, mutable, line: tok.line, col: tok.col };
  }

  fnDecl(decorators = []) {
    const tok = this.consume(T.KEYWORD, 'fn');

    // Optional async modifier: fungsi asinkron ...
    let isAsync = false;
    if (this.check(T.KEYWORD, 'async')) { this.advance(); isAsync = true; }

    // Go-style receiver method: fungsi (h Hewan) sapa(...): tiada { ... }
    // Attaches 'sapa' to struct 'Hewan'; 'h' is bound to the instance inside
    // the body — no 'ini'/'kelas', just a struct plus a func that takes it.
    let receiver = null;
    if (this.check(T.LPAREN)) {
      this.advance();
      const rName = this.consume(T.IDENTIFIER, undefined, 'Expected receiver name').value;
      const rType = this.consume(T.IDENTIFIER, undefined, 'Expected receiver struct type').value;
      this.consume(T.RPAREN, undefined, "Expected ')' after receiver");
      receiver = { name: rName, type: rType };
    }

    const name = this.consume(T.IDENTIFIER, undefined, "Expected function name after 'fungsi'").value;

    this.consume(T.LPAREN, undefined, "Expected '(' after function name");
    const params = this.paramList();
    this.consume(T.RPAREN, undefined, "Expected ')' after parameters");

    let returnType = null;
    if (this.matchToken(T.COLON)) {
      returnType = this.consumeType('Expected return type');
    }

    const body = this.block();
    return { type: N.FN_DECL, name, params, returnType, body, isAsync, receiver, decorators, line: tok.line, col: tok.col };
  }

  paramList() {
    const params = [];
    if (this.check(T.RPAREN)) return params;

    do {
      // Parameter decorator(s), e.g. '@Body() dto: CreateUserDto' — used by
      // framework controller methods (NestJS et al.) to pick a value apart
      // from the request instead of from a plain call argument.
      const paramDecorators = this.decoratorList();

      // Rest parameter: ...nama — harus jadi parameter terakhir
      if (this.check(T.ELLIPSIS)) {
        this.advance();
        const name = this.consume(T.IDENTIFIER, undefined, "Expected parameter name after '...'").value;
        params.push({ name, type: 'unknown[]', default: null, rest: true, decorators: paramDecorators });
        break;
      }
      const name = this.consume(T.IDENTIFIER, undefined, 'Expected parameter name').value;
      this.consume(T.COLON, undefined, "Expected ':' after parameter name");
      const paramType = this.consumeType('Expected parameter type');
      let defaultVal = null;
      if (this.matchToken(T.EQUALS)) {
        defaultVal = this.expression();
      }
      params.push({ name, type: paramType, default: defaultVal, decorators: paramDecorators });
    } while (this.matchToken(T.COMMA));

    return params;
  }

  // Parameter list for arrow functions — type annotation is optional
  // (defaults to 'apa_saja'/unknown) since arrows are mainly terse callbacks.
  paramListArrow() {
    const params = [];
    if (this.check(T.RPAREN)) return params;

    do {
      if (this.check(T.ELLIPSIS)) {
        this.advance();
        const name = this.consume(T.IDENTIFIER, undefined, "Expected parameter name after '...'").value;
        params.push({ name, type: 'unknown[]', default: null, rest: true });
        break;
      }
      const name = this.consume(T.IDENTIFIER, undefined, 'Expected parameter name').value;
      let paramType = 'unknown';
      if (this.matchToken(T.COLON)) {
        paramType = this.consumeType('Expected parameter type');
      }
      let defaultVal = null;
      if (this.matchToken(T.EQUALS)) {
        defaultVal = this.expression();
      }
      params.push({ name, type: paramType, default: defaultVal });
    } while (this.matchToken(T.COMMA));

    return params;
  }

  structDecl(decorators = []) {
    const tok  = this.consume(T.KEYWORD, 'struct');
    const name = this.consume(T.IDENTIFIER, undefined, 'Expected struct name').value;

    this.consume(T.LBRACE, undefined, "Expected '{' after struct name");

    const fields = [];
    while (!this.check(T.RBRACE) && !this.isAtEnd()) {
      const fieldName = this.consume(T.IDENTIFIER, undefined, 'Expected field name').value;
      this.consume(T.COLON, undefined, "Expected ':' after field name");
      const fieldType = this.consumeType('Expected field type');
      fields.push({ name: fieldName, type: fieldType });
      // Optional comma between fields
      this.matchToken(T.COMMA);
    }

    this.consume(T.RBRACE, undefined, "Expected '}' after struct fields");
    return { type: N.STRUCT_DECL, name, fields, decorators, line: tok.line, col: tok.col };
  }

  ifStmt() {
    const tok  = this.consume(T.KEYWORD, 'if');
    const prev = this.allowStructInit;
    this.allowStructInit = false;
    const condition = this.expression();
    this.allowStructInit = prev;
    const consequent = this.block();

    let alternate = null;
    if (this.check(T.KEYWORD, 'else')) {
      this.advance(); // consume 'else'
      if (this.check(T.KEYWORD, 'if')) {
        // lain jika → else-if: alternate is a nested IfStmt
        alternate = this.ifStmt();
      } else {
        alternate = this.block();
      }
    }

    return { type: N.IF_STMT, condition, consequent, alternate, line: tok.line, col: tok.col };
  }

  forStmt() {
    const tok      = this.consume(T.KEYWORD, 'for');
    const iterName = this.consume(T.IDENTIFIER, undefined, "Expected iterator name after 'untuk'").value;
    this.consume(T.KEYWORD, 'in', "Expected 'dalam' after iterator name");

    const prev = this.allowStructInit;
    this.allowStructInit = false;

    // Parse first expression; if followed by .. it's a range, otherwise for-of
    const first = this.addition();

    this.loopDepth++;
    if (this.check(T.DOTDOT)) {
      this.advance(); // consume ..
      const end = this.addition();
      this.allowStructInit = prev;
      const body = this.block();
      this.loopDepth--;
      return { type: N.LOOP_STMT, loopType: 'range', iter: iterName, start: first, end, body, line: tok.line, col: tok.col };
    }

    this.allowStructInit = prev;
    const body = this.block();
    this.loopDepth--;
    return { type: N.LOOP_STMT, loopType: 'of', iter: iterName, source: first, body, line: tok.line, col: tok.col };
  }

  whileStmt() {
    const tok       = this.consume(T.KEYWORD, 'while');
    const prev      = this.allowStructInit;
    this.allowStructInit = false;
    const condition = this.expression();
    this.allowStructInit = prev;
    this.loopDepth++;
    const body      = this.block();
    this.loopDepth--;
    return { type: N.WHILE_STMT, condition, body, line: tok.line, col: tok.col };
  }

  breakStmt() {
    const tok = this.consume(T.KEYWORD, 'break');
    if (this.loopDepth === 0) {
      throw new ParseError("'berhenti' hanya bisa digunakan di dalam 'untuk'/'selama'", tok.line, tok.col);
    }
    return { type: N.BREAK_STMT, line: tok.line, col: tok.col };
  }

  continueStmt() {
    const tok = this.consume(T.KEYWORD, 'continue');
    if (this.loopDepth === 0) {
      throw new ParseError("'lanjut' hanya bisa digunakan di dalam 'untuk'/'selama'", tok.line, tok.col);
    }
    return { type: N.CONTINUE_STMT, line: tok.line, col: tok.col };
  }

  typeAliasDecl() {
    const tok  = this.consume(T.KEYWORD, 'type');
    const name = this.consume(T.IDENTIFIER, undefined, "Expected type name after 'tipe'").value;
    this.consume(T.EQUALS, undefined, "Expected '=' after type name");
    const target = this.consumeType("Expected underlying type after '='");
    return { type: N.TYPE_ALIAS_DECL, name, target, line: tok.line, col: tok.col };
  }

  testDecl() {
    const tok   = this.consume(T.KEYWORD, 'test');
    const label = this.consume(T.STRING, undefined, "Expected string label after 'uji'").value;
    const body  = this.block();
    return { type: N.TEST_DECL, label, body, line: tok.line, col: tok.col };
  }

  measureStmt() {
    const tok   = this.consume(T.KEYWORD, 'measure');
    const label = this.consume(T.STRING, undefined, "Expected string label after 'ukur'").value;
    const body  = this.block();
    return { type: N.MEASURE_STMT, label, body, line: tok.line, col: tok.col };
  }

  assertStmt() {
    const tok  = this.consume(T.KEYWORD, 'assert');
    const expr = this.expression();
    return { type: N.ASSERT_STMT, expr, line: tok.line, col: tok.col };
  }

  matchStmt() {
    const tok  = this.consume(T.KEYWORD, 'select'); // 'pilih'
    const prev = this.allowStructInit;
    this.allowStructInit = false;
    const discriminant = this.expression();
    this.allowStructInit = prev;

    this.consume(T.LBRACE, undefined, "Expected '{' after 'pilih'");

    const cases = [];
    let defaultCase = null;

    while (!this.check(T.RBRACE) && !this.isAtEnd()) {
      if (this.check(T.KEYWORD, 'case')) {
        this.advance(); // consume 'kasus'
        const test = this.expression();
        this.consume(T.ARROW, undefined, "Expected '->' after 'kasus'");
        const body = this.statement();
        cases.push({ test, body });
      } else if (this.check(T.KEYWORD, 'else')) {
        this.advance(); // consume 'lain'
        this.consume(T.ARROW, undefined, "Expected '->' after 'lain'");
        defaultCase = this.statement();
      } else {
        const t = this.peek();
        throw new ParseError("Expected 'kasus' or 'lain' in 'pilih'", t.line, t.col);
      }
    }

    this.consume(T.RBRACE, undefined, "Expected '}' after 'pilih'");
    return { type: N.MATCH_STMT, discriminant, cases, defaultCase, line: tok.line, col: tok.col };
  }

  // cocok expr { berhasil(n) => stmt   gagal(e) => stmt }
  // Pattern match khusus untuk hasil<T,E> (berhasil(v) / gagal(e)).
  matchResultStmt() {
    const tok  = this.consume(T.KEYWORD, 'match'); // 'cocok'
    const prev = this.allowStructInit;
    this.allowStructInit = false;
    const discriminant = this.expression();
    this.allowStructInit = prev;

    this.consume(T.LBRACE, undefined, "Expected '{' after 'cocok'");

    let okArm = null;
    let errArm = null;

    while (!this.check(T.RBRACE) && !this.isAtEnd()) {
      const patTok = this.consume(T.IDENTIFIER, undefined, "Expected 'berhasil' or 'gagal' pattern in 'cocok'");
      if (patTok.value !== 'berhasil' && patTok.value !== 'gagal') {
        throw new ParseError("'cocok' hanya menerima pola 'berhasil(...)' atau 'gagal(...)'", patTok.line, patTok.col);
      }
      this.consume(T.LPAREN, undefined, `Expected '(' after '${patTok.value}'`);
      const bindingTok = this.consume(T.IDENTIFIER, undefined, 'Expected binding name');
      this.consume(T.RPAREN, undefined, "Expected ')'");
      this.consume(T.FAT_ARROW, undefined, "Expected '=>'");
      const body = this.statement();
      const arm = { binding: bindingTok.value, body };

      if (patTok.value === 'berhasil') {
        if (okArm) throw new ParseError("Pola 'berhasil' hanya boleh muncul sekali dalam 'cocok'", patTok.line, patTok.col);
        okArm = arm;
      } else {
        if (errArm) throw new ParseError("Pola 'gagal' hanya boleh muncul sekali dalam 'cocok'", patTok.line, patTok.col);
        errArm = arm;
      }
    }

    this.consume(T.RBRACE, undefined, "Expected '}' after 'cocok'");
    if (!okArm && !errArm) {
      throw new ParseError("'cocok' membutuhkan minimal satu pola 'berhasil'/'gagal'", tok.line, tok.col);
    }
    return { type: N.MATCH_RESULT_STMT, discriminant, okArm, errArm, line: tok.line, col: tok.col };
  }

  tryStmt() {
    const tok      = this.consume(T.KEYWORD, 'try');
    const tryBlock = this.block();

    let catchParam = null;
    let catchBlock = null;
    if (this.check(T.KEYWORD, 'catch')) {
      this.advance();
      this.consume(T.LPAREN, undefined, "Expected '(' after 'tangkap'");
      catchParam = this.consume(T.IDENTIFIER, undefined, 'Expected error parameter name').value;
      this.consume(T.RPAREN, undefined, "Expected ')'");
      catchBlock = this.block();
    }

    let finallyBlock = null;
    if (this.check(T.KEYWORD, 'finally')) {
      this.advance();
      finallyBlock = this.block();
    }

    if (!catchBlock && !finallyBlock) {
      throw new ParseError("'coba' harus diikuti 'tangkap' atau 'akhirnya'", tok.line, tok.col);
    }

    return { type: N.TRY_STMT, tryBlock, catchParam, catchBlock, finallyBlock, line: tok.line, col: tok.col };
  }

  funcExpr() {
    const tok = this.consume(T.KEYWORD, 'fn');
    let isAsync = false;
    if (this.check(T.KEYWORD, 'async')) { this.advance(); isAsync = true; }

    this.consume(T.LPAREN, undefined, "Expected '(' in function expression");
    const params = this.paramList();
    this.consume(T.RPAREN, undefined, "Expected ')' after parameters");

    let returnType = null;
    if (this.matchToken(T.COLON)) {
      returnType = this.consumeType('Expected return type');
    }

    const body = this.block();
    return { type: N.FUNC_EXPR, params, returnType, body, isAsync, line: tok.line, col: tok.col };
  }

  // dengan X { id / nama = expr ... }   (spread=false, pick/rename ke objek baru)
  // ubah X { nama = expr ... }          (spread=true,  { ...X, nama: expr, ... })
  objectTransformExpr(spread) {
    const tok = this.consume(T.KEYWORD, spread ? 'mut' : 'with');
    const prevAllow = this.allowStructInit;
    this.allowStructInit = false; // 'X {' di sini bukan inisialisasi struktur
    const source = this.unary();
    this.allowStructInit = prevAllow;

    this.consume(T.LBRACE, undefined, `Expected '{' after '${spread ? 'ubah' : 'dengan'}'`);

    const fields = [];
    while (!this.check(T.RBRACE) && !this.isAtEnd()) {
      const nameTok = this.consume(T.IDENTIFIER, undefined, 'Expected field name');
      let value;
      if (this.matchToken(T.EQUALS)) {
        value = this.expression();
      } else if (spread) {
        throw new ParseError("Field di 'ubah' harus diisi lewat 'nama = ekspresi'", nameTok.line, nameTok.col);
      } else {
        value = { type: N.IDENTIFIER, name: nameTok.value, line: nameTok.line, col: nameTok.col };
      }
      fields.push({ name: nameTok.value, value });
    }

    this.consume(T.RBRACE, undefined, `Expected '}' after '${spread ? 'ubah' : 'dengan'}' block`);
    return { type: N.OBJECT_TRANSFORM_EXPR, source, fields, spread, line: tok.line, col: tok.col };
  }

  returnStmt() {
    const tok = this.consume(T.KEYWORD, 'return');
    // void return: balik followed by } or EOF or next statement keyword
    if (this.check(T.RBRACE) || this.isAtEnd()) {
      return { type: N.RETURN_STMT, value: null, line: tok.line, col: tok.col };
    }
    const value = this.expression();
    return { type: N.RETURN_STMT, value, line: tok.line, col: tok.col };
  }

  printStmt() {
    const tok = this.consume(T.KEYWORD, 'print');
    this.consume(T.LPAREN, undefined, "Expected '(' after print");
    const args = this.argList();
    this.consume(T.RPAREN, undefined, "Expected ')'");
    const callExpr = { type: N.CALL_EXPR, callee: '__print__', args, line: tok.line, col: tok.col };
    return { type: N.EXPR_STMT, expr: callExpr, line: tok.line, col: tok.col };
  }

  packageDecl() {
    const tok  = this.consume(T.KEYWORD, 'package');
    const name = this.consume(T.IDENTIFIER, undefined, "Expected package name after 'paket'/'package'").value;
    return { type: N.PACKAGE_DECL, name, line: tok.line, col: tok.col };
  }

  packageImport() {
    const tok = this.consume(T.KEYWORD, 'import');

    // impor { Nama1, Nama2 } dari "path" — named import (Go-style visibility)
    if (this.check(T.LBRACE)) {
      this.advance();
      const names = [];
      do {
        names.push(this.consume(T.IDENTIFIER, undefined, "Expected identifier in import list").value);
      } while (this.matchToken(T.COMMA));
      this.consume(T.RBRACE, undefined, "Expected '}' after import list");
      this.consume(T.KEYWORD, 'from', "Expected 'dari' after import list");
      const source = this.consume(T.STRING, undefined, "Expected source string after 'dari'").value;
      return { type: N.PACKAGE_IMPORT, localName: null, names, source, line: tok.line, col: tok.col };
    }

    const localName = this.consume(T.IDENTIFIER, undefined, "Expected import name after 'impor'").value;
    this.consume(T.KEYWORD, 'from', "Expected 'dari' after import name");
    const source    = this.consume(T.STRING, undefined, "Expected source string after 'dari'").value;
    return { type: N.PACKAGE_IMPORT, localName, names: null, source, line: tok.line, col: tok.col };
  }

  exprStmt() {
    const expr = this.expression();
    return { type: N.EXPR_STMT, expr, line: expr.line, col: expr.col };
  }

  block() {
    this.consume(T.LBRACE, undefined, "Expected '{'");
    const body = [];
    while (!this.check(T.RBRACE) && !this.isAtEnd()) {
      body.push(this.statement());
    }
    this.consume(T.RBRACE, undefined, "Expected '}'");
    return { type: N.BLOCK, body };
  }

  // ── Expressions (precedence climbing) ──────────────────────────────────────

  expression() {
    return this.assignment();
  }

  assignment() {
    const left = this.ternary();

    if (this.check(T.EQUALS)) {
      const tok = this.advance();
      const validTargets = [N.IDENTIFIER, N.MEMBER_EXPR, N.INDEX_EXPR];
      if (!validTargets.includes(left.type)) {
        throw new ParseError('Invalid assignment target', tok.line, tok.col);
      }
      const right = this.expression();
      return { type: N.ASSIGN_EXPR, target: left, value: right, line: tok.line, col: tok.col };
    }

    return left;
  }

  // Python-style ternary: expr jika cond lain alt  →  cond ? expr : alt
  // Lookahead: only treat 'jika' as ternary if 'lain' appears before '{' (block)
  isTernaryJika() {
    if (!this.check(T.KEYWORD, 'if')) return false;
    let depth = 0;
    for (let i = this.pos + 1; i < this.tokens.length; i++) {
      const t = this.tokens[i];
      if (t.type === T.LPAREN || t.type === T.LBRACKET) { depth++; continue; }
      if (t.type === T.RPAREN || t.type === T.RBRACKET) { depth--; continue; }
      if (depth > 0) continue;
      if (t.type === T.LBRACE) return false; // hit a block → it's a statement
      if (t.type === T.KEYWORD && t.value === 'else') return true; // found 'lain'
      if (t.type === T.EOF) return false;
    }
    return false;
  }

  ternary() {
    const expr = this.nullishCoalescing();
    if (this.isTernaryJika()) {
      const tok  = this.advance(); // consume 'if' (jika)
      const cond = this.nullishCoalescing();
      if (!this.check(T.KEYWORD, 'else')) {
        const t = this.peek();
        throw new ParseError("Expected 'lain' after ternary condition", t.line, t.col);
      }
      this.advance(); // consume 'else' (lain)
      const alt = this.ternary(); // right-associative
      return { type: N.TERNARY_EXPR, condition: cond, consequent: expr, alternate: alt, line: tok.line, col: tok.col };
    }
    return expr;
  }

  // Nullish coalescing: a ?? b  →  pakai b hanya jika a null/undefined
  nullishCoalescing() {
    let left = this.logicalOr();
    while (this.check(T.QQ)) {
      const tok   = this.advance();
      const right = this.logicalOr();
      left = { type: N.BINARY_EXPR, op: '??', left, right, line: tok.line, col: tok.col };
    }
    return left;
  }

  logicalOr() {
    let left = this.logicalAnd();
    while (this.check(T.OR)) {
      const tok   = this.advance();
      const right = this.logicalAnd();
      left = { type: N.BINARY_EXPR, op: '||', left, right, line: tok.line, col: tok.col };
    }
    return left;
  }

  logicalAnd() {
    let left = this.comparison();
    while (this.check(T.AND)) {
      const tok   = this.advance();
      const right = this.comparison();
      left = { type: N.BINARY_EXPR, op: '&&', left, right, line: tok.line, col: tok.col };
    }
    return left;
  }

  comparison() {
    let left = this.addition();

    while (true) {
      let op = null;
      if      (this.check(T.GTE))  op = '>=';
      else if (this.check(T.LTE))  op = '<=';
      else if (this.check(T.GT))   op = '>';
      else if (this.check(T.LT))   op = '<';
      else if (this.check(T.EQEQ)) op = '==';
      else if (this.check(T.NEQ))  op = '!=';
      else break;

      const tok   = this.advance();
      const right = this.addition();
      left = { type: N.BINARY_EXPR, op, left, right, line: tok.line, col: tok.col };
    }

    return left;
  }

  addition() {
    let left = this.multiplication();

    while (this.check(T.PLUS) || this.check(T.MINUS)) {
      const op    = this.peek().value;
      const tok   = this.advance();
      const right = this.multiplication();
      left = { type: N.BINARY_EXPR, op, left, right, line: tok.line, col: tok.col };
    }

    return left;
  }

  multiplication() {
    let left = this.unary();

    while (this.check(T.STAR) || this.check(T.SLASH)) {
      const op    = this.peek().value;
      const tok   = this.advance();
      const right = this.unary();
      left = { type: N.BINARY_EXPR, op, left, right, line: tok.line, col: tok.col };
    }

    return left;
  }

  unary() {
    // Await expression: tunggu expr [batas N detik]
    if (this.check(T.KEYWORD, 'await')) {
      const tok  = this.advance();
      const expr = this.unary();

      let timeoutMs = null;
      if (this.check(T.KEYWORD, 'timeout')) {
        this.advance();
        const amount = this.consume(T.NUMBER, undefined, "Expected number after 'batas'");
        this.consume(T.KEYWORD, 'second', "Expected 'detik' after timeout value");
        timeoutMs = amount.value * 1000;
      }

      return { type: N.AWAIT_EXPR, expr, timeoutMs, line: tok.line, col: tok.col };
    }

    // Logical NOT: !expr
    if (this.check(T.BANG)) {
      const tok     = this.advance();
      const operand = this.unary();
      return { type: N.UNARY_EXPR, op: '!', operand, line: tok.line, col: tok.col };
    }

    // Negation
    if (this.check(T.MINUS)) {
      const tok     = this.advance();
      const operand = this.unary();
      return { type: N.UNARY_EXPR, op: '-', operand, line: tok.line, col: tok.col };
    }

    return this.callExpr();
  }

  // 'ubah' and 'pilih' are reserved words elsewhere (immutable object update /
  // pattern match), but they're also the Big Data transform/projection method
  // names (BIGDATA_TYPE.md §8.3/§8.2). Unambiguous in postfix ('.') position,
  // so accept their canonical KEYWORD form here and map back to the source
  // word — each canonical value only ever comes from that one source word
  // (see KEYWORD_MAP in lexer/keywords.js).
  consumeMemberName(message) {
    if (this.check(T.IDENTIFIER)) return this.advance().value;
    if (this.check(T.KEYWORD, 'mut'))    { this.advance(); return 'ubah'; }
    if (this.check(T.KEYWORD, 'select')) { this.advance(); return 'pilih'; }
    if (this.check(T.KEYWORD, 'from'))   { this.advance(); return 'dari'; }
    return this.consume(T.IDENTIFIER, undefined, message).value;
  }

  callExpr() {
    let expr = this.primary();

    while (true) {
      if (this.check(T.LPAREN)) {
        const tok  = this.advance();
        const args = this.argList();
        this.consume(T.RPAREN, undefined, "Expected ')'");
        expr = { type: N.CALL_EXPR, callee: expr, args, line: tok.line, col: tok.col };
      } else if (this.check(T.DOT)) {
        const tok    = this.advance();
        const member = this.consumeMemberName('Expected member name after .');
        expr = { type: N.MEMBER_EXPR, object: expr, member, optional: false, line: tok.line, col: tok.col };

        // data.baca<T>(...) / data.alir<T>(...) / data.dari<T>(...) — Big
        // Data dataset source, the one place a call carries an explicit
        // generic type argument. Narrowly scoped to this exact shape so '<'
        // elsewhere still always means less-than.
        if (expr.object.type === N.IDENTIFIER && expr.object.name === 'data' &&
            (member === 'baca' || member === 'alir' || member === 'dari') && this.check(T.LT)) {
          this.advance(); // consume '<'
          const typeArg = this.consumeType(`Expected type argument for data.${member}<T>`);
          this.consume(T.GT, undefined, "Expected '>' after type argument");
          expr.typeArg = typeArg;
        }
      } else if (this.check(T.QDOT)) {
        const tok    = this.advance();
        const member = this.consumeMemberName("Expected member name after '?.'");
        expr = { type: N.MEMBER_EXPR, object: expr, member, optional: true, line: tok.line, col: tok.col };
      } else if (this.check(T.LBRACKET)) {
        const tok   = this.advance();
        const index = this.expression();
        this.consume(T.RBRACKET, undefined, "Expected ']' after index expression");
        expr = { type: N.INDEX_EXPR, object: expr, index, line: tok.line, col: tok.col };
      } else {
        break;
      }
    }

    return expr;
  }

  // Lookahead from a '(' to see if the matching ')' is followed by '=>'
  // (arrow function) rather than being a plain parenthesized expression.
  isArrowFnAhead() {
    let depth = 0;
    for (let i = this.pos; i < this.tokens.length; i++) {
      const t = this.tokens[i];
      if (t.type === T.LPAREN) depth++;
      else if (t.type === T.RPAREN) {
        depth--;
        if (depth === 0) return this.tokens[i + 1]?.type === T.FAT_ARROW;
      } else if (t.type === T.EOF) return false;
    }
    return false;
  }

  // Arrow function: (params) => expr   or   (params) => { body }
  arrowFnExpr() {
    const tok = this.consume(T.LPAREN);
    const params = this.paramListArrow();
    this.consume(T.RPAREN, undefined, "Expected ')' after arrow function parameters");
    this.consume(T.FAT_ARROW, undefined, "Expected '=>'");

    if (this.check(T.LBRACE)) {
      const body = this.block();
      return { type: N.FUNC_EXPR, params, returnType: null, isAsync: false, isArrow: true, body, exprBody: null, line: tok.line, col: tok.col };
    }
    const exprBody = this.assignment();
    return { type: N.FUNC_EXPR, params, returnType: null, isAsync: false, isArrow: true, body: null, exprBody, line: tok.line, col: tok.col };
  }

  primary() {
    // Optional 'buat' prefix before struct init: buat Titik { x: 0, y: 0 }
    if (this.check(T.KEYWORD, 'new')) {
      this.advance();
      return this.primary();
    }

    const tok = this.peek();

    // .field — Big Data field reference (BIGDATA_TYPE.md §7). Only valid
    // inside a data<T> expression context; enforced by the typechecker, not
    // here, so parsing stays context-free.
    if (tok.type === T.DOT) {
      this.advance();
      const name = this.consumeMemberName('Expected field name after .');
      return { type: N.FIELD_EXPR, name, line: tok.line, col: tok.col };
    }

    // F-string: f"Hello {nama}"
    if (tok.type === T.FSTRING) {
      this.advance();
      const parts = this.parseFStringParts(tok.value);
      return { type: N.TEMPLATE_EXPR, parts, line: tok.line, col: tok.col };
    }

    // Array literal: [expr, expr, ...] with optional spread elements
    if (tok.type === T.LBRACKET) {
      this.advance(); // consume [
      const elements = [];
      if (!this.check(T.RBRACKET)) {
        do {
          if (this.check(T.ELLIPSIS)) {
            const eTok = this.advance();
            elements.push({ type: N.SPREAD_ELEMENT, value: this.expression(), line: eTok.line, col: eTok.col });
          } else {
            elements.push(this.expression());
          }
        } while (this.matchToken(T.COMMA));
      }
      this.consume(T.RBRACKET, undefined, "Expected ']' after array elements");
      return { type: N.ARRAY_LITERAL, elements, line: tok.line, col: tok.col };
    }

    if (tok.type === T.NUMBER) {
      this.advance();
      return { type: N.NUMBER_LITERAL, value: tok.value, line: tok.line, col: tok.col };
    }

    if (tok.type === T.STRING) {
      this.advance();
      return { type: N.STRING_LITERAL, value: tok.value, line: tok.line, col: tok.col };
    }

    if (tok.type === T.BOOL) {
      this.advance();
      return { type: N.BOOL_LITERAL, value: tok.value, line: tok.line, col: tok.col };
    }

    if (tok.type === T.IDENTIFIER) {
      this.advance();
      // IDENT followed by { = struct init, but only when not inside an `if` condition
      if (this.allowStructInit && this.check(T.LBRACE)) {
        return this.structInit(tok);
      }
      return { type: N.IDENTIFIER, name: tok.value, line: tok.line, col: tok.col };
    }

    // null literal: nihil
    if (tok.type === T.KEYWORD && tok.value === 'null') {
      this.advance();
      return { type: N.NULL_LITERAL, line: tok.line, col: tok.col };
    }

    // Anonymous function expression: fungsi(params) { body }
    if (tok.type === T.KEYWORD && tok.value === 'fn') {
      return this.funcExpr();
    }

    // dengan X { ... } — transformasi objek (tanpa spread, field baru saja)
    if (tok.type === T.KEYWORD && tok.value === 'with') {
      return this.objectTransformExpr(false);
    }

    // ubah X { field = expr ... } — pembaruan immutable ({ ...X, field: expr })
    if (tok.type === T.KEYWORD && tok.value === 'mut') {
      return this.objectTransformExpr(true);
    }

    // print / cetak appearing in expression context (e.g. inside another call)
    if (tok.type === T.KEYWORD && tok.value === 'print') {
      this.advance();
      return { type: N.IDENTIFIER, name: '__print__', line: tok.line, col: tok.col };
    }

    // Anonymous object literal: { key: expr, ...spread, ... }
    if (tok.type === T.LBRACE) {
      this.advance();
      const fields = [];
      while (!this.check(T.RBRACE) && !this.isAtEnd()) {
        if (this.check(T.ELLIPSIS)) {
          this.advance();
          fields.push({ spread: true, value: this.expression() });
        } else {
          const keyTok = this.consume(T.IDENTIFIER, undefined, 'Expected key name in object literal');
          this.consume(T.COLON, undefined, "Expected ':' in object literal");
          fields.push({ name: keyTok.value, value: this.expression() });
        }
        this.matchToken(T.COMMA);
      }
      this.consume(T.RBRACE, undefined, "Expected '}' in object literal");
      return { type: N.OBJECT_LITERAL, fields, line: tok.line, col: tok.col };
    }

    if (tok.type === T.LPAREN) {
      if (this.isArrowFnAhead()) return this.arrowFnExpr();
      this.advance();
      const expr = this.expression();
      this.consume(T.RPAREN, undefined, "Expected ')'");
      return expr;
    }

    throw new ParseError(
      `Unexpected token '${tok.value !== null ? tok.value : tok.type}'`,
      tok.line, tok.col
    );
  }

  structInit(nameTok) {
    this.consume(T.LBRACE, undefined, "Expected '{'");
    const fields = [];

    while (!this.check(T.RBRACE) && !this.isAtEnd()) {
      const fieldName  = this.consume(T.IDENTIFIER, undefined, 'Expected field name').value;
      this.consume(T.COLON, undefined, "Expected ':' in struct initializer");
      const fieldValue = this.expression();
      fields.push({ name: fieldName, value: fieldValue });
      this.matchToken(T.COMMA);
    }

    this.consume(T.RBRACE, undefined, "Expected '}' in struct initializer");
    return { type: N.STRUCT_INIT, name: nameTok.value, fields, line: nameTok.line, col: nameTok.col };
  }

  parseFStringParts(raw) {
    const { Lexer } = require('../lexer/lexer');
    const parts = [];
    let i = 0, textBuf = '';
    while (i < raw.length) {
      if (raw[i] === '{') {
        if (textBuf) { parts.push({ kind: 'text', value: textBuf }); textBuf = ''; }
        let depth = 1, j = i + 1;
        while (j < raw.length && depth > 0) {
          if (raw[j] === '{') depth++;
          else if (raw[j] === '}') depth--;
          j++;
        }
        const exprSrc = raw.slice(i + 1, j - 1);
        const subTokens = new Lexer(exprSrc).tokenize();
        const exprNode  = new Parser(subTokens).expression();
        parts.push({ kind: 'expr', expr: exprNode });
        i = j;
      } else {
        textBuf += raw[i++];
      }
    }
    if (textBuf) parts.push({ kind: 'text', value: textBuf });
    return parts;
  }

  argList() {
    const args = [];
    if (this.check(T.RPAREN)) return args;
    do {
      if (this.check(T.ELLIPSIS)) {
        const eTok = this.advance();
        args.push({ type: N.SPREAD_ELEMENT, value: this.expression(), line: eTok.line, col: eTok.col });
      } else if (this.check(T.IDENTIFIER) && this.tokens[this.pos + 1]?.type === T.COLON) {
        // nama: expr — named argument (e.g. .gabung(x, pada: .a == .b)).
        // Unambiguous: a plain expression never starts with 'ident :'.
        const nameTok = this.advance();
        this.advance(); // consume ':'
        const value = this.expression();
        args.push({ type: N.NAMED_ARG, name: nameTok.value, value, line: nameTok.line, col: nameTok.col });
      } else {
        args.push(this.expression());
      }
    } while (this.matchToken(T.COMMA));
    return args;
  }
}

function parse(tokens) {
  return new Parser(tokens).parse();
}

module.exports = { Parser, parse };
