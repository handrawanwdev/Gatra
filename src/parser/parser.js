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

  statement() {
    const tok = this.peek();

    if (tok.type === T.KEYWORD) {
      switch (tok.value) {
        case 'let':     return this.varDecl();
        case 'fn': {
          // Named fn declaration vs anonymous fn expression in statement position
          let look = this.pos + 1;
          if (this.tokens[look]?.value === 'async') look++;
          if (this.tokens[look]?.type === T.IDENTIFIER) return this.fnDecl();
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
        case 'export':  return this.exportDecl();
        case 'type':    return this.typeAliasDecl();
        case 'match':   return this.matchStmt();
        case 'break':   return this.breakStmt();
        case 'continue':return this.continueStmt();
        case 'test':    return this.testDecl();
        case 'assert':  return this.assertStmt();
        case 'worker':  return this.workerDecl();
        case 'task':    return this.taskStmt();
        case 'select':  return this.selectStmt();
        case 'spawn':
          // 'jalankan { ... } tunggu' (structured concurrency block) vs
          // 'jalankan pekerjaFn(args)' (worker-spawn expression) — disambiguate on '{'
          if (this.tokens[this.pos + 1]?.type === T.LBRACE) return this.structuredSpawnStmt();
          break; // falls through to exprStmt() → unary() handles SPAWN_EXPR
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

  fnDecl() {
    const tok = this.consume(T.KEYWORD, 'fn');

    // Optional async modifier: fungsi asinkron ...
    let isAsync = false;
    if (this.check(T.KEYWORD, 'async')) { this.advance(); isAsync = true; }

    const name = this.consume(T.IDENTIFIER, undefined, "Expected function name after 'fungsi'").value;

    this.consume(T.LPAREN, undefined, "Expected '(' after function name");
    const params = this.paramList();
    this.consume(T.RPAREN, undefined, "Expected ')' after parameters");

    let returnType = null;
    if (this.matchToken(T.COLON)) {
      returnType = this.consumeType('Expected return type');
    }

    const body = this.block();
    return { type: N.FN_DECL, name, params, returnType, body, isAsync, line: tok.line, col: tok.col };
  }

  paramList() {
    const params = [];
    if (this.check(T.RPAREN)) return params;

    do {
      const name = this.consume(T.IDENTIFIER, undefined, 'Expected parameter name').value;
      this.consume(T.COLON, undefined, "Expected ':' after parameter name");
      const paramType = this.consumeType('Expected parameter type');
      let defaultVal = null;
      if (this.matchToken(T.EQUALS)) {
        defaultVal = this.expression();
      }
      params.push({ name, type: paramType, default: defaultVal });
    } while (this.matchToken(T.COMMA));

    return params;
  }

  structDecl() {
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
    return { type: N.STRUCT_DECL, name, fields, line: tok.line, col: tok.col };
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

  exportDecl() {
    const tok = this.consume(T.KEYWORD, 'export');
    if (!this.check(T.KEYWORD, 'fn')) {
      const t = this.peek();
      throw new ParseError("'ekspor' hanya berlaku untuk 'fungsi'", t.line, t.col);
    }
    const fn = this.fnDecl();
    fn.isExported = true;
    return fn;
  }

  testDecl() {
    const tok   = this.consume(T.KEYWORD, 'test');
    const label = this.consume(T.STRING, undefined, "Expected string label after 'uji'").value;
    const body  = this.block();
    return { type: N.TEST_DECL, label, body, line: tok.line, col: tok.col };
  }

  assertStmt() {
    const tok  = this.consume(T.KEYWORD, 'assert');
    const expr = this.expression();
    return { type: N.ASSERT_STMT, expr, line: tok.line, col: tok.col };
  }

  workerDecl() {
    this.consume(T.KEYWORD, 'worker');
    if (!this.check(T.KEYWORD, 'fn')) {
      const t = this.peek();
      throw new ParseError("'pekerja' hanya berlaku untuk 'fungsi'", t.line, t.col);
    }
    const fn = this.fnDecl();
    fn.isWorker = true;
    return fn;
  }

  taskStmt() {
    const tok  = this.consume(T.KEYWORD, 'task');
    const expr = this.expression();
    if (expr.type !== N.CALL_EXPR) {
      throw new ParseError("'tugas' harus diikuti pemanggilan fungsi", tok.line, tok.col);
    }
    return { type: N.TASK_STMT, expr, line: tok.line, col: tok.col };
  }

  structuredSpawnStmt() {
    const tok  = this.consume(T.KEYWORD, 'spawn');
    const body = this.block();
    this.consume(T.KEYWORD, 'await', "Expected 'tunggu' after 'jalankan { ... }'");
    return { type: N.STRUCTURED_SPAWN, body, line: tok.line, col: tok.col };
  }

  selectStmt() {
    const tok = this.consume(T.KEYWORD, 'select');
    this.consume(T.LBRACE, undefined, "Expected '{' after 'pilih'");

    const cases = [];
    while (!this.check(T.RBRACE) && !this.isAtEnd()) {
      this.consume(T.KEYWORD, 'case', "Expected 'kasus' in 'pilih'");
      const channel = this.expression();
      this.consume(T.ARROW, undefined, "Expected '->' after channel in 'pilih'");
      const body = this.statement();
      cases.push({ channel, body });
    }

    this.consume(T.RBRACE, undefined, "Expected '}' after 'pilih'");
    if (cases.length === 0) {
      throw new ParseError("'pilih' membutuhkan minimal satu 'kasus'", tok.line, tok.col);
    }
    return { type: N.SELECT_STMT, cases, line: tok.line, col: tok.col };
  }

  matchStmt() {
    const tok  = this.consume(T.KEYWORD, 'match');
    const prev = this.allowStructInit;
    this.allowStructInit = false;
    const discriminant = this.expression();
    this.allowStructInit = prev;

    this.consume(T.LBRACE, undefined, "Expected '{' after 'cocok'");

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
        throw new ParseError("Expected 'kasus' or 'lain' in 'cocok'", t.line, t.col);
      }
    }

    this.consume(T.RBRACE, undefined, "Expected '}' after 'cocok'");
    return { type: N.MATCH_STMT, discriminant, cases, defaultCase, line: tok.line, col: tok.col };
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
    const tok       = this.consume(T.KEYWORD, 'import');
    const localName = this.consume(T.IDENTIFIER, undefined, "Expected import name after 'impor'").value;
    this.consume(T.KEYWORD, 'from', "Expected 'dari' after import name");
    const source    = this.consume(T.STRING, undefined, "Expected source string after 'dari'").value;
    return { type: N.PACKAGE_IMPORT, localName, source, line: tok.line, col: tok.col };
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
      const validTargets = [N.IDENTIFIER, N.MEMBER_EXPR, N.DEREF_EXPR];
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
    const expr = this.logicalOr();
    if (this.isTernaryJika()) {
      const tok  = this.advance(); // consume 'if' (jika)
      const cond = this.logicalOr();
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

    // BorrowExpr and StructInit are never valid multiplication operands.
    // Stop here so that `&mut x *r = 1` or `Box { v: 1 } *r = 2` do not
    // greedily consume `*r` as a binary multiply — `*r` must start the
    // next statement.
    if (left.type === N.BORROW_EXPR || left.type === N.STRUCT_INIT) return left;

    while (this.check(T.STAR) || this.check(T.SLASH)) {
      const op    = this.peek().value;
      const tok   = this.advance();
      const right = this.unary();
      left = { type: N.BINARY_EXPR, op, left, right, line: tok.line, col: tok.col };
    }

    return left;
  }

  unary() {
    // Await expression: tunggu expr
    if (this.check(T.KEYWORD, 'await')) {
      const tok  = this.advance();
      const expr = this.unary();
      return { type: N.AWAIT_EXPR, expr, line: tok.line, col: tok.col };
    }

    // Worker spawn expression: jalankan pekerjaFn(args)
    if (this.check(T.KEYWORD, 'spawn')) {
      const tok  = this.advance();
      const call = this.unary();
      if (call.type !== N.CALL_EXPR) {
        throw new ParseError("'jalankan' harus diikuti pemanggilan fungsi pekerja", tok.line, tok.col);
      }
      return { type: N.SPAWN_EXPR, call, line: tok.line, col: tok.col };
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

    // Dereference: *r
    if (this.check(T.STAR)) {
      const tok  = this.advance();
      // Must be followed by an identifier (the ref variable)
      const name = this.consume(T.IDENTIFIER, undefined, "Expected identifier after '*'").value;
      return { type: N.DEREF_EXPR, ref: name, line: tok.line, col: tok.col };
    }

    // Borrow: &x  or  &mut x
    if (this.check(T.AMPERSAND)) {
      const tok     = this.advance();
      let mutable   = false;
      if (this.check(T.KEYWORD, 'mut')) { this.advance(); mutable = true; }
      const target  = this.consume(T.IDENTIFIER, undefined, "Expected identifier after '&'").value;
      return { type: N.BORROW_EXPR, target, mutable, line: tok.line, col: tok.col };
    }

    return this.callExpr();
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
        const member = this.consume(T.IDENTIFIER, undefined, 'Expected member name after .').value;
        expr = { type: N.MEMBER_EXPR, object: expr, member, line: tok.line, col: tok.col };
      } else {
        break;
      }
    }

    return expr;
  }

  primary() {
    // Optional 'buat' prefix before struct init: buat Titik { x: 0, y: 0 }
    if (this.check(T.KEYWORD, 'new')) {
      this.advance();
      return this.primary();
    }

    const tok = this.peek();

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
