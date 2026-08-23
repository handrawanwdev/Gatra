'use strict';

class PackageRegistry {
  constructor() {
    this.packages = new Map(); // name → { name, source, exports: [], imports: [] }
  }

  register(name, meta) {
    this.packages.set(name, {
      name,
      source:  meta.source  || null,
      exports: meta.exports || [],
      imports: meta.imports || [],
    });
  }

  get(name)  { return this.packages.get(name) || null; }
  has(name)  { return this.packages.has(name); }
  all()      { return [...this.packages.values()]; }
}

module.exports = { PackageRegistry };
