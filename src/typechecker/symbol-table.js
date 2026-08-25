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

  // Like lookup(), but returns the scope-stack index a name actually
  // resolved in (0 = outermost/module scope) instead of its info — lets a
  // caller tell "defined inside the scope I just pushed" from "defined in an
  // enclosing scope" without walking the stack itself. -1 if not found.
  lookupDepth(name) {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      if (this.scopes[i].has(name)) return i;
    }
    return -1;
  }

  // Index of the scope frame that would be pushed next (i.e. the current
  // scopes.length) — a caller pushes, then compares this snapshot against
  // lookupDepth() results to know which side of that push a name came from.
  depth() { return this.scopes.length; }

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
