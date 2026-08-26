'use strict';

const { TokenType: T } = require('./tokens');
const { KEYWORD_MAP, TYPE_MAP } = require('./keywords');

class Token {
  constructor(type, value, line, col) {
    this.type  = type;
    this.value = value;
    this.line  = line;
    this.col   = col;
  }
}

class LexError extends Error {
  constructor(message, line, col) {
    super(message);
    this.name = 'LexError';
    this.line = line;
    this.col  = col;
  }
}

class Lexer {
  constructor(source) {
    this.source = source;
    this.pos    = 0;
    this.line   = 1;
    this.col    = 1;
    this.tokens = [];
  }

  peek(offset = 0) {
    return this.source[this.pos + offset] ?? '\0';
  }

  advance() {
    const ch = this.source[this.pos++];
    if (ch === '\n') { this.line++; this.col = 1; }
    else             { this.col++; }
    return ch;
  }

  match(expected) {
    if (this.source[this.pos] === expected) { this.advance(); return true; }
    return false;
  }

  emit(type, value, line, col) {
    this.tokens.push(new Token(type, value, line, col));
  }

  skipLineComment() {
    while (this.pos < this.source.length && this.peek() !== '\n') this.advance();
  }

  readString(line, col) {
    let value = '';
    while (this.pos < this.source.length && this.peek() !== '"') {
      if (this.peek() === '\\') {
        this.advance();
        const esc = this.advance();
        switch (esc) {
          case 'n':  value += '\n'; break;
          case 't':  value += '\t'; break;
          case '"':  value += '"';  break;
          case '\\': value += '\\'; break;
          default:   value += esc;
        }
      } else {
        value += this.advance();
      }
    }
    if (this.pos >= this.source.length) {
      throw new LexError('Unterminated string literal', line, col);
    }
    this.advance(); // closing "
    return value;
  }

  // Assumes the opening '/' is already consumed. A '/' inside '[...]'
  // doesn't need escaping in JS regex syntax either, so bracket depth is
  // tracked the same way — otherwise e.g. /[/]/ would stop at the wrong '/'.
  readRegex(line, col) {
    let pattern = '';
    let inClass = false;
    while (true) {
      if (this.pos >= this.source.length || this.peek() === '\n') {
        throw new LexError("Unterminated regex literal — missing closing '/'", line, col);
      }
      const c = this.peek();
      if (c === '\\') {
        pattern += this.advance();
        if (this.pos < this.source.length) pattern += this.advance();
        continue;
      }
      if (c === '[') { inClass = true; pattern += this.advance(); continue; }
      if (c === ']') { inClass = false; pattern += this.advance(); continue; }
      if (c === '/' && !inClass) { this.advance(); break; }
      pattern += this.advance();
    }
    let flags = '';
    while (/[a-zA-Z]/.test(this.peek())) flags += this.advance();
    return { pattern, flags };
  }

  // Classic regex-vs-division lexer ambiguity: '/' starts a regex literal
  // unless the previous token could itself end an expression (a value or a
  // ')'/']' closing one), in which case '/' has to be division instead —
  // same heuristic real JS lexers use.
  canPrecedeDivision() {
    const tok = this.tokens[this.tokens.length - 1];
    if (!tok) return false;
    if ([T.IDENTIFIER, T.NUMBER, T.STRING, T.FSTRING, T.BOOL, T.RPAREN, T.RBRACKET, T.TYPE].includes(tok.type)) return true;
    return tok.type === T.KEYWORD && tok.value === 'null';
  }

  readFString(line, col) {
    let raw = '';
    let depth = 0;
    while (this.pos < this.source.length) {
      const c = this.peek();
      if (c === '"' && depth === 0) { this.advance(); break; }
      if (c === '{') depth++;
      else if (c === '}') depth--;
      raw += this.advance();
    }
    if (this.pos > this.source.length && depth !== 0) {
      throw new LexError('Unterminated f-string literal', line, col);
    }
    return raw;
  }

  readNumber() {
    let raw = '';
    while (/[0-9]/.test(this.peek())) raw += this.advance();
    if (this.peek() === '.' && /[0-9]/.test(this.peek(1))) {
      raw += this.advance(); // consume '.'
      while (/[0-9]/.test(this.peek())) raw += this.advance();
    }
    return parseFloat(raw);
  }

  readWord() {
    let word = '';
    while (/[a-zA-Z0-9_]/.test(this.peek())) word += this.advance();
    return word;
  }

  // javascript { ...raw JavaScript, copied through verbatim... }
  // Braces inside string/template literals and line comments are skipped so
  // they don't throw off the depth count. Escape hatch — content is NOT
  // type-checked or reformatted; it is passed straight to the JS output.
  readRawJsBlock(line, col) {
    while (/\s/.test(this.peek())) this.advance();
    if (this.peek() !== '{') {
      throw new LexError("Expected '{' after 'javascript'", this.line, this.col);
    }
    this.advance(); // consume opening {

    let raw = '';
    let depth = 1;
    while (this.pos < this.source.length && depth > 0) {
      const c = this.peek();
      if (c === '"' || c === "'" || c === '`') {
        const quote = c;
        raw += this.advance();
        while (this.pos < this.source.length && this.peek() !== quote) {
          if (this.peek() === '\\') { raw += this.advance(); if (this.pos < this.source.length) raw += this.advance(); }
          else raw += this.advance();
        }
        if (this.pos < this.source.length) raw += this.advance();
        continue;
      }
      if (c === '/' && this.peek(1) === '/') {
        while (this.pos < this.source.length && this.peek() !== '\n') raw += this.advance();
        continue;
      }
      if (c === '{') { depth++; raw += this.advance(); continue; }
      if (c === '}') {
        depth--;
        if (depth === 0) { this.advance(); break; }
        raw += this.advance();
        continue;
      }
      raw += this.advance();
    }

    if (depth !== 0) {
      throw new LexError("Unterminated 'javascript' block — missing '}'", line, col);
    }
    return raw;
  }

  tokenize() {
    while (this.pos < this.source.length) {
      // Skip whitespace (including newlines — grammar is self-terminating)
      const ch = this.peek();
      if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
        this.advance();
        continue;
      }

      // Line comments
      if (ch === '/' && this.peek(1) === '/') {
        this.skipLineComment();
        continue;
      }

      const line = this.line;
      const col  = this.col;

      // Number literals
      if (/[0-9]/.test(ch)) {
        const value = this.readNumber();
        this.emit(T.NUMBER, value, line, col);
        continue;
      }

      // String literals
      if (ch === '"') {
        this.advance(); // opening "
        const value = this.readString(line, col);
        this.emit(T.STRING, value, line, col);
        continue;
      }

      // F-string: f"..." interpolated template
      if (ch === 'f' && this.peek(1) === '"') {
        this.advance(); // consume 'f'
        this.advance(); // consume opening "
        const raw = this.readFString(line, col);
        this.emit(T.FSTRING, raw, line, col);
        continue;
      }

      // Identifiers, keywords, types
      if (/[a-zA-Z_]/.test(ch)) {
        const word = this.readWord();

        if (word === 'javascript') {
          const raw = this.readRawJsBlock(line, col);
          this.emit(T.JS_BLOCK, raw, line, col);
          continue;
        }

        if (Object.hasOwn(KEYWORD_MAP, word)) {
          const canonical = KEYWORD_MAP[word];
          if (canonical === 'true' || canonical === 'false') {
            this.emit(T.BOOL, canonical === 'true', line, col);
          } else {
            this.emit(T.KEYWORD, canonical, line, col);
          }
        } else if (Object.hasOwn(TYPE_MAP, word)) {
          this.emit(T.TYPE, TYPE_MAP[word], line, col);
        } else {
          this.emit(T.IDENTIFIER, word, line, col);
        }
        continue;
      }

      // Punctuation and operators
      this.advance(); // consume the character
      switch (ch) {
        case ':': this.emit(T.COLON,  ':',  line, col); break;
        case ',': this.emit(T.COMMA,  ',',  line, col); break;
        case '.':
          if (this.peek() === '.' && this.peek(1) === '.') {
            this.advance(); this.advance();
            this.emit(T.ELLIPSIS, '...', line, col);
          } else if (this.peek() === '.') {
            this.advance();
            this.emit(T.DOTDOT, '..', line, col);
          } else {
            this.emit(T.DOT, '.', line, col);
          }
          break;
        case '(': this.emit(T.LPAREN, '(',  line, col); break;
        case ')': this.emit(T.RPAREN, ')',  line, col); break;
        case '{': this.emit(T.LBRACE,   '{', line, col); break;
        case '}': this.emit(T.RBRACE,   '}', line, col); break;
        case '[': this.emit(T.LBRACKET, '[', line, col); break;
        case ']': this.emit(T.RBRACKET, ']', line, col); break;
        case '*': this.emit(T.STAR,   '*',  line, col); break;
        case '@': this.emit(T.AT,     '@',  line, col); break;
        case '?':
          if (this.peek() === '?')      { this.advance(); this.emit(T.QQ,    '??', line, col); }
          else if (this.peek() === '.') { this.advance(); this.emit(T.QDOT,  '?.', line, col); }
          else                          { this.emit(T.QUESTION, '?', line, col); }
          break;
        case '+': this.emit(T.PLUS,   '+',  line, col); break;
        case '-':
          this.match('>')
            ? this.emit(T.ARROW, '->', line, col)
            : this.emit(T.MINUS, '-',  line, col);
          break;
        case '/':
          if (this.canPrecedeDivision()) {
            this.emit(T.SLASH, '/', line, col);
          } else {
            const { pattern, flags } = this.readRegex(line, col);
            this.emit(T.REGEX, { pattern, flags }, line, col);
          }
          break;
        case '=':
          if (this.match('='))      this.emit(T.EQEQ,      '==', line, col);
          else if (this.match('>')) this.emit(T.FAT_ARROW,  '=>', line, col);
          else                      this.emit(T.EQUALS,     '=',  line, col);
          break;
        case '!':
          this.match('=')
            ? this.emit(T.NEQ,  '!=', line, col)
            : this.emit(T.BANG, '!',  line, col);
          break;
        case '&':
          if (this.peek() === '&') { this.advance(); this.emit(T.AND, '&&', line, col); }
          else                     { this.emit(T.AMPERSAND, '&', line, col); }
          break;
        case '|':
          if (this.peek() === '|') { this.advance(); this.emit(T.OR, '||', line, col); }
          else { throw new LexError(`Unexpected character '|'`, line, col); }
          break;
        case '>':
          this.match('=')
            ? this.emit(T.GTE, '>=', line, col)
            : this.emit(T.GT,  '>',  line, col);
          break;
        case '<':
          this.match('=')
            ? this.emit(T.LTE, '<=', line, col)
            : this.emit(T.LT,  '<',  line, col);
          break;
        default:
          throw new LexError(`Unexpected character '${ch}'`, line, col);
      }
    }

    this.emit(T.EOF, null, this.line, this.col);
    return this.tokens;
  }
}

function tokenize(source) {
  return new Lexer(source).tokenize();
}

module.exports = { Lexer, Token, LexError, tokenize };
