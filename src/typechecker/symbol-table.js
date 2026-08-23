'use strict';

class SymbolTable {
  constructor() {
    this.scopes = [new Map()]; // stack: scopes[last] = innermost
  }

  push() { this.scopes.push(new Map()); }
  pop()  { this.scopes.pop(); }

  // Define in the current (innermost) scope
  define(name, info) {
    this.scopes[this.scopes.length - 1].set(name, info);
  }

  // Look up from innermost to outermost scope
  lookup(name) {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      if (this.scopes[i].has(name)) return this.scopes[i].get(name);
    }
    return null;
  }

  // Check only the current scope (for duplicate detection)
  existsInCurrent(name) {
    return this.scopes[this.scopes.length - 1].has(name);
  }

  // Like existsInCurrent, but ignores builtin bindings (e.g. 'kunci', 'saluran')
  // so user code may shadow them with its own declaration — needed for
  // idioms like 'isi kunci = kunci()'.
  isUserDefinedInCurrent(name) {
    const scope = this.scopes[this.scopes.length - 1];
    if (!scope.has(name)) return false;
    return !scope.get(name).builtin;
  }
}

module.exports = { SymbolTable };
