'use strict';

// LSP minimal untuk Gatra — hanya diagnostics (parse/tipe/kepemilikan + linter).
// Tanpa dependency eksternal: JSON-RPC di-frame manual (Content-Length header)
// di atas stdio, sesuai spesifikasi Language Server Protocol.
//
// Tidak termasuk (di luar scope MVP): completion, hover, go-to-definition,
// rename, formatting-on-save via LSP (pakai 'gatra rapikan' langsung).

const { tokenize }        = require('../lexer/lexer');
const { parse }           = require('../parser/parser');
const { typecheck }       = require('../typechecker/typechecker');
const { ownershipCheck }  = require('../ownership/ownership-checker');
const { lint }            = require('../linter/linter');

// ── JSON-RPC framing ──────────────────────────────────────────────────────────

class RpcConnection {
  constructor(input, output) {
    this.input   = input;
    this.output  = output;
    this.buffer  = Buffer.alloc(0);
    this.handlers = new Map();
    this.input.on('data', (chunk) => this.onData(chunk));
  }

  onMessage(method, fn) { this.handlers.set(method, fn); }

  onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (true) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) return;
      const header = this.buffer.slice(0, headerEnd).toString('utf8');
      const match  = /Content-Length: (\d+)/i.exec(header);
      if (!match) { this.buffer = this.buffer.slice(headerEnd + 4); continue; }
      const length = parseInt(match[1], 10);
      const bodyStart = headerEnd + 4;
      if (this.buffer.length < bodyStart + length) return; // wait for more data

      const body = this.buffer.slice(bodyStart, bodyStart + length).toString('utf8');
      this.buffer = this.buffer.slice(bodyStart + length);

      let msg;
      try { msg = JSON.parse(body); } catch { continue; }
      this.dispatch(msg);
    }
  }

  dispatch(msg) {
    const handler = this.handlers.get(msg.method);
    if (!handler) {
      if (msg.id !== undefined) this.respond(msg.id, null);
      return;
    }
    const result = handler(msg.params || {});
    if (msg.id !== undefined) this.respond(msg.id, result === undefined ? null : result);
  }

  send(obj) {
    const json = JSON.stringify(obj);
    const header = `Content-Length: ${Buffer.byteLength(json, 'utf8')}\r\n\r\n`;
    this.output.write(header + json);
  }

  respond(id, result) { this.send({ jsonrpc: '2.0', id, result }); }
  notify(method, params) { this.send({ jsonrpc: '2.0', method, params }); }
}

// ── Diagnostics ────────────────────────────────────────────────────────────────

const SEVERITY = { ERROR: 1, WARNING: 2, INFORMATION: 3, HINT: 4 };

function toRange(line, col) {
  const l = Math.max(0, (line || 1) - 1);
  const c = Math.max(0, (col || 1) - 1);
  return { start: { line: l, character: c }, end: { line: l, character: c + 1 } };
}

function computeDiagnostics(source) {
  const diagnostics = [];

  let ast;
  try {
    ast = parse(tokenize(source));
  } catch (err) {
    diagnostics.push({
      range: toRange(err.line, err.col),
      severity: SEVERITY.ERROR,
      source: 'gatra',
      message: err.message,
    });
    return diagnostics; // can't typecheck/lint on a broken parse
  }

  try {
    typecheck(ast, 'id');
    ownershipCheck(ast, 'id');
  } catch (err) {
    diagnostics.push({
      range: toRange(err.line, err.col),
      severity: SEVERITY.ERROR,
      source: 'gatra',
      message: err.message,
    });
  }

  try {
    for (const f of lint(ast)) {
      diagnostics.push({
        range: toRange(f.line, f.col),
        severity: SEVERITY.WARNING,
        source: `gatra(${f.rule})`,
        message: f.message,
      });
    }
  } catch {
    // linter is best-effort; never let it crash diagnostics publishing
  }

  return diagnostics;
}

// ── Server ───────────────────────────────────────────────────────────────────

function startServer(input = process.stdin, output = process.stdout) {
  const rpc = new RpcConnection(input, output);
  const docs = new Map(); // uri → source text

  function publish(uri) {
    const source = docs.get(uri);
    if (source === undefined) return;
    rpc.notify('textDocument/publishDiagnostics', {
      uri,
      diagnostics: computeDiagnostics(source),
    });
  }

  rpc.onMessage('initialize', () => ({
    capabilities: {
      textDocumentSync: 1, // full document sync
    },
    serverInfo: { name: 'gatra-lsp', version: '0.1.0' },
  }));

  rpc.onMessage('initialized', () => {});

  rpc.onMessage('textDocument/didOpen', (params) => {
    docs.set(params.textDocument.uri, params.textDocument.text);
    publish(params.textDocument.uri);
  });

  rpc.onMessage('textDocument/didChange', (params) => {
    const change = params.contentChanges[params.contentChanges.length - 1];
    docs.set(params.textDocument.uri, change.text);
    publish(params.textDocument.uri);
  });

  rpc.onMessage('textDocument/didClose', (params) => {
    docs.delete(params.textDocument.uri);
    rpc.notify('textDocument/publishDiagnostics', { uri: params.textDocument.uri, diagnostics: [] });
  });

  rpc.onMessage('shutdown', () => null);
  rpc.onMessage('exit', () => { process.exit(0); });

  return rpc;
}

module.exports = { startServer, computeDiagnostics, RpcConnection };
