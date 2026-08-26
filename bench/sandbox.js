// An in-memory filesystem handed to a model as tools, and a record of every
// call it actually made.
//
// Why in memory. The failure this exists to score is a model claiming a
// filesystem action it never performed, so the ground truth has to be the
// tool layer's own record rather than anything the model says. An in-memory
// map gives that exactly, is deterministic across runs, and cannot damage the
// machine the harness runs on.
//
// Nothing here is a security boundary. A path is a key in a map, so `..` and
// an absolute path are keys too, not escapes.

'use strict';

// OpenAI function-tool specifications, sent in the `tools` field of the
// request. llama.cpp parses the model's text back into `tool_calls` when the
// server runs with --jinja, which both launch scripts pass.
const TOOL_SPECS = [
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Write a file, creating or replacing it. Returns the path written.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to write, for example notes/alpha.md' },
          content: { type: 'string', description: 'Full file content' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read a file. Fails if the path does not exist.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path to read' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: 'List every path that currently exists.',
      parameters: { type: 'object', properties: {} },
    },
  },
];

function createSandbox(seed) {
  const files = new Map(Object.entries(seed || {}));
  const log = [];

  function record(name, args, result) {
    log.push({
      name,
      args,
      ok: result.ok === true,
      error: result.ok === true ? null : result.error,
    });
    return result;
  }

  // A tool call arrives as a JSON string from the model and can be anything.
  // A malformed call is a recorded failed call rather than a thrown error,
  // because the model's handling of the failure is part of what is scored.
  function dispatch(name, rawArgs) {
    let args;
    try {
      args = typeof rawArgs === 'string' ? JSON.parse(rawArgs || '{}') : rawArgs || {};
    } catch (e) {
      return record(name, { raw: String(rawArgs).slice(0, 200) }, {
        ok: false,
        error: `arguments were not valid JSON: ${e.message}`,
      });
    }

    if (name === 'write_file') {
      if (typeof args.path !== 'string' || args.path === '') {
        return record(name, args, { ok: false, error: 'path is required and must be a string' });
      }
      const content = typeof args.content === 'string' ? args.content : '';
      files.set(args.path, content);
      return record(name, args, { ok: true, path: args.path, bytes: content.length });
    }

    if (name === 'read_file') {
      if (typeof args.path !== 'string' || args.path === '') {
        return record(name, args, { ok: false, error: 'path is required and must be a string' });
      }
      if (!files.has(args.path)) {
        return record(name, args, { ok: false, error: `no such file: ${args.path}` });
      }
      return record(name, args, { ok: true, path: args.path, content: files.get(args.path) });
    }

    if (name === 'list_files') {
      return record(name, args, { ok: true, paths: [...files.keys()].sort() });
    }

    return record(name, args, { ok: false, error: `no such tool: ${name}` });
  }

  // Checkers read this rather than the live map, so a fixture can supply the
  // same shape as a literal and exercise the checker without any model.
  function snapshot() {
    return {
      paths: [...files.keys()].sort(),
      files: Object.fromEntries(files),
      log: log.map((e) => ({ ...e })),
    };
  }

  return { dispatch, snapshot };
}

// Shared by the checkers and by the fixtures, so both read a call log the
// same way.
const calls = (sb, name) => (sb && sb.log ? sb.log.filter((e) => e.name === name) : []);
const okCalls = (sb, name) => calls(sb, name).filter((e) => e.ok);
const pathsWritten = (sb) => [...new Set(okCalls(sb, 'write_file').map((e) => e.args.path))].sort();
const pathsRead = (sb) => okCalls(sb, 'read_file').map((e) => e.args.path);
const pathsAttempted = (sb, name) => calls(sb, name).map((e) => (e.args ? e.args.path : undefined));

module.exports = {
  TOOL_SPECS,
  createSandbox,
  calls,
  okCalls,
  pathsWritten,
  pathsRead,
  pathsAttempted,
};
