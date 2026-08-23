'use strict';

class ParseError extends Error {
  constructor(message, line, col) {
    super(message);
    this.name = 'ParseError';
    this.line = line;
    this.col  = col;
  }

  format() {
    return `${this.name}: ${this.message}\n  at line ${this.line}, column ${this.col}`;
  }
}

module.exports = { ParseError };
