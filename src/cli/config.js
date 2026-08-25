'use strict';

// Minimal TOML reader/writer — just enough for gatra.toml's shape (flat
// [section] tables of string/number/bool key = value pairs, no arrays or
// nested tables). Not a general TOML implementation.

const fs   = require('fs');
const path = require('path');

function parseToml(text) {
  const result = {};
  let section = null;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;

    const sectionMatch = line.match(/^\[([\w.-]+)\]$/);
    if (sectionMatch) {
      section = result[sectionMatch[1]] = result[sectionMatch[1]] || {};
      continue;
    }

    const kv = line.match(/^([\w.-]+)\s*=\s*(.+)$/);
    if (!kv || !section) continue;

    let val = kv[2].trim();
    if (/^".*"$/.test(val)) val = val.slice(1, -1);
    else if (/^-?\d+$/.test(val)) val = parseInt(val, 10);
    else if (val === 'true') val = true;
    else if (val === 'false') val = false;

    section[kv[1]] = val;
  }

  return result;
}

function stringifyToml(obj) {
  let out = '';
  for (const [section, kv] of Object.entries(obj)) {
    out += `[${section}]\n`;
    for (const [k, v] of Object.entries(kv)) {
      out += `${k} = ${typeof v === 'string' ? JSON.stringify(v) : v}\n`;
    }
    out += '\n';
  }
  return out;
}

// Walks up from startDir looking for gatra.toml — same "nearest ancestor"
// lookup as package.json, so any subdirectory of a project still finds it.
function findConfigFile(startDir) {
  let dir = path.resolve(startDir);
  while (true) {
    const candidate = path.join(dir, 'gatra.toml');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

// Returns { file, dir, toml } or null if no gatra.toml found.
function loadConfig(startDir = process.cwd()) {
  const file = findConfigFile(startDir);
  if (!file) return null;
  let toml;
  try {
    toml = parseToml(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    return { file, dir: path.dirname(file), toml: null, error: err };
  }
  return { file, dir: path.dirname(file), toml };
}

module.exports = { parseToml, stringifyToml, findConfigFile, loadConfig };
