// A witness for a real Claude Code session.
//
// Why this exists. The bench tool-use class scores what a model does against a
// record the harness keeps itself, and all three models on this machine pass
// it. A live session on 26 Aug 2026 failed anyway: the model reported writing a
// file to a directory that has never existed, then presented an unrelated real
// note as the one it had just written. The class is three tools and one or two
// calls per task, so it cannot speak to that. Closing the gap needs the same
// kind of witness in front of a session that uses Claude Code's own tools,
// which the bench sandbox never sees.
//
// It works because the tool calls still cross the wire. Claude Code sends the
// conversation to the endpoint and the model answers with tool-use blocks;
// Claude Code runs the tool itself and sends the result back in the next
// request. So everything the model asked for, and everything it was told came
// back, passes through here in order. What the model says at the end can then
// be read against that record rather than believed.
//
// It is a recorder, not a filter. Requests and responses are forwarded
// unchanged, including streaming, and nothing here alters a byte of either.
//
//   ./bench/node22.sh serve/record-proxy.js --out runs/session.jsonl
//   LOCAL_LANE_PORT=8081 ./serve/claude-local.sh
//
// Loopback only, both sides, matching the rule that this lane is never bound
// to a routable address. There is no key on the upstream server, so a proxy
// reachable from the network would be an open LLM endpoint.

'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const HOST = '127.0.0.1';

function parseArgs(argv) {
  const o = { port: 8081, upstream: 'http://127.0.0.1:8080', out: null, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) {
        console.error(`${a} needs a value`);
        process.exit(2);
      }
      return v;
    };
    if (a === '--port') o.port = Number(next());
    else if (a === '--upstream') o.upstream = next();
    else if (a === '--out') o.out = next();
    else if (a === '--quiet') o.quiet = true;
    else {
      // A typo in an option must not fall through and run with a default,
      // because the run then looks fine and records to somewhere else.
      console.error(`unknown option: ${a}`);
      process.exit(2);
    }
  }
  if (!Number.isInteger(o.port) || o.port < 1 || o.port > 65535) {
    console.error(`--port must be a port number, got ${o.port}`);
    process.exit(2);
  }
  return o;
}

// ---------------------------------------------------------------------------
// reading tool calls out of a response
// ---------------------------------------------------------------------------
//
// llama-server answers on both the Anthropic and the OpenAI shapes and Claude
// Code uses the Anthropic one, so both are read here rather than guessing which
// arrived. A response whose shape is not recognised records zero calls and says
// so, which is different from recording that the model made none.

function toolCallsFromAnthropicBody(body) {
  const out = [];
  for (const block of (body && body.content) || []) {
    if (block && block.type === 'tool_use') {
      out.push({ id: block.id, name: block.name, input: block.input });
    }
  }
  return out;
}

// The model's own prose, which is the thing being scored against everything
// else here. Without it the log records what happened and not what was claimed,
// which is only half a witness.
function textFromAnthropicBody(body) {
  return ((body && body.content) || [])
    .filter((b) => b && b.type === 'text')
    .map((b) => b.text || '')
    .join('');
}

function textFromOpenAIBody(body) {
  return ((body && body.choices) || [])
    .map((c) => (c.message && c.message.content) || '')
    .join('');
}

function toolCallsFromOpenAIBody(body) {
  const out = [];
  for (const choice of (body && body.choices) || []) {
    for (const tc of (choice.message && choice.message.tool_calls) || []) {
      out.push({ id: tc.id, name: tc.function && tc.function.name, input: tc.function && tc.function.arguments });
    }
  }
  return out;
}

// Server-sent events carry the same information split across deltas. The tool
// name arrives in content_block_start and its arguments accumulate across
// input_json_delta events, so a parser that reads only one of them records a
// call with no arguments and looks like it worked.
function toolCallsFromStream(raw) {
  const blocks = new Map();
  const openai = new Map();
  let sawAnyEvent = false;
  let text = '';

  for (const line of String(raw).split('\n')) {
    const t = line.trim();
    if (!t.startsWith('data:')) continue;
    const payload = t.slice(5).trim();
    if (payload === '' || payload === '[DONE]') continue;
    let ev;
    try {
      ev = JSON.parse(payload);
    } catch (e) {
      continue;
    }
    sawAnyEvent = true;

    if (ev.type === 'content_block_start' && ev.content_block && ev.content_block.type === 'tool_use') {
      blocks.set(ev.index, { id: ev.content_block.id, name: ev.content_block.name, json: '' });
    } else if (ev.type === 'content_block_delta' && ev.delta && ev.delta.type === 'input_json_delta') {
      const b = blocks.get(ev.index);
      if (b) b.json += ev.delta.partial_json || '';
    } else if (ev.type === 'content_block_delta' && ev.delta && ev.delta.type === 'text_delta') {
      text += ev.delta.text || '';
    }

    for (const choice of ev.choices || []) {
      if (choice.delta && typeof choice.delta.content === 'string') text += choice.delta.content;
      for (const tc of (choice.delta && choice.delta.tool_calls) || []) {
        const key = tc.index !== undefined ? tc.index : tc.id;
        if (!openai.has(key)) openai.set(key, { id: tc.id, name: '', json: '' });
        const b = openai.get(key);
        if (tc.id) b.id = tc.id;
        if (tc.function && tc.function.name) b.name += tc.function.name;
        if (tc.function && tc.function.arguments) b.json += tc.function.arguments;
      }
    }
  }

  const finish = (b) => {
    let input = b.json;
    try {
      input = JSON.parse(b.json);
    } catch (e) {
      // Kept as the raw string. A call whose arguments did not parse is still
      // a call the model made, and dropping it would understate the record.
    }
    return { id: b.id, name: b.name, input };
  };

  return {
    calls: [...blocks.values(), ...openai.values()].map(finish),
    text,
    sawAnyEvent,
  };
}

// ---------------------------------------------------------------------------
// reading tool results out of a request
// ---------------------------------------------------------------------------
//
// This is the other half of the witness, and the more important one. It is
// what the tool actually returned, as opposed to what the model asked for.

function toolResultsFromRequest(body) {
  const out = [];
  for (const m of (body && body.messages) || []) {
    if (m.role === 'tool') {
      out.push({ id: m.tool_call_id, content: m.content });
      continue;
    }
    if (!Array.isArray(m.content)) continue;
    for (const block of m.content) {
      if (block && block.type === 'tool_result') {
        out.push({ id: block.tool_use_id, isError: block.is_error === true, content: block.content });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// the proxy
// ---------------------------------------------------------------------------

function createProxy(opts) {
  const upstream = new URL(opts.upstream);
  let seq = 0;
  const sink = opts.out ? fs.createWriteStream(opts.out, { flags: 'a' }) : null;

  const record = (entry) => {
    const line = JSON.stringify(entry);
    if (sink) sink.write(line + '\n');
    if (!opts.quiet) {
      const calls = (entry.toolCalls || []).map((c) => c.name).join(',');
      const results = (entry.toolResults || []).length;
      console.log(
        `#${entry.seq} ${entry.method} ${entry.path} -> ${entry.status}` +
        `${calls ? ` asked:${calls}` : ''}${results ? ` results-in:${results}` : ''}`
      );
    }
  };

  const server = http.createServer((req, res) => {
    const id = ++seq;
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const reqRaw = Buffer.concat(chunks);
      let reqBody = null;
      try {
        reqBody = JSON.parse(reqRaw.toString('utf8'));
      } catch (e) {
        reqBody = null;
      }

      const headers = { ...req.headers, host: upstream.host };
      const up = http.request(
        {
          hostname: upstream.hostname,
          port: upstream.port || 80,
          path: req.url,
          method: req.method,
          headers,
        },
        (upRes) => {
          res.writeHead(upRes.statusCode, upRes.headers);
          const outChunks = [];
          upRes.on('data', (c) => {
            outChunks.push(c);
            // Forwarded as it arrives. Buffering here would turn a streaming
            // session into a stalled one and change the thing being observed.
            res.write(c);
          });
          upRes.on('end', () => {
            res.end();
            const raw = Buffer.concat(outChunks).toString('utf8');
            let toolCalls = [];
            let finalText = '';
            let shape = 'unrecognised';
            let body = null;
            try {
              body = JSON.parse(raw);
            } catch (e) {
              body = null;
            }
            if (body) {
              const a = toolCallsFromAnthropicBody(body);
              const o = toolCallsFromOpenAIBody(body);
              toolCalls = a.length ? a : o;
              finalText = body.content ? textFromAnthropicBody(body) : textFromOpenAIBody(body);
              shape = body.content ? 'anthropic' : body.choices ? 'openai' : 'unrecognised';
            } else {
              const s = toolCallsFromStream(raw);
              toolCalls = s.calls;
              finalText = s.text;
              shape = s.sawAnyEvent ? 'stream' : 'unrecognised';
            }

            record({
              seq: id,
              at: new Date().toISOString(),
              method: req.method,
              path: req.url,
              status: upRes.statusCode,
              shape,
              requestBytes: reqRaw.length,
              responseBytes: raw.length,
              messages: reqBody && Array.isArray(reqBody.messages) ? reqBody.messages.length : null,
              toolResults: toolResultsFromRequest(reqBody),
              toolCalls,
              finalText,
            });
          });
        }
      );

      up.on('error', (e) => {
        // An upstream that is not there must not look like a model that
        // answered nothing.
        res.writeHead(502, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: `proxy could not reach upstream: ${e.message}` } }));
        record({
          seq: id,
          at: new Date().toISOString(),
          method: req.method,
          path: req.url,
          status: 502,
          shape: 'upstream-error',
          error: e.message,
          toolResults: toolResultsFromRequest(reqBody),
          toolCalls: [],
        });
      });

      up.end(reqRaw);
    });
  });

  return { server, close: () => new Promise((r) => server.close(r)) };
}

module.exports = {
  createProxy,
  toolCallsFromStream,
  toolCallsFromAnthropicBody,
  toolCallsFromOpenAIBody,
  textFromAnthropicBody,
  textFromOpenAIBody,
  toolResultsFromRequest,
  parseArgs,
};

if (require.main === module) {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.out) fs.mkdirSync(path.dirname(path.resolve(opts.out)), { recursive: true });
  const { server } = createProxy(opts);
  server.listen(opts.port, HOST, () => {
    console.log(`recording ${HOST}:${opts.port} -> ${opts.upstream}`);
    console.log(opts.out ? `log: ${opts.out}` : 'no --out given, nothing is being written to disk');
    console.log(`point the lane at it:  LOCAL_LANE_PORT=${opts.port} ./serve/claude-local.sh`);
  });
}
