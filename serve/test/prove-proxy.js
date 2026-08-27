// Proof that the recording proxy records, and that it can fail to.
//
// The proxy is a witness, and a witness nobody has tested is worse than none:
// it produces a log that reads as evidence whatever it contains. Every arm here
// drives a real proxy against a stub upstream, so nothing is asserted against a
// literal the test wrote itself, and no model or endpoint is contacted.
//
// The arm that matters is the streaming one. Claude Code streams, and a tool
// call in a stream arrives split: the name in content_block_start and the
// arguments accumulated across input_json_delta events. A parser reading only
// the first records a call with no arguments and looks like it worked.
//
//   ./bench/node22.sh serve/test/prove-proxy.js
//
// Exit 0 all arms passed. Exit 1 an arm failed. Exit 2 the harness could not
// run.

'use strict';

const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PROXY = require('../record-proxy.js');

let failures = 0;

// An arm that throws before its assertion runs has proved nothing about the
// defect it exists to catch, so a throw is reported as that arm failing rather
// than as the suite dying.
async function arm(name, fn) {
  try {
    const problem = await fn();
    if (problem) {
      console.log(`FAIL ${name}: ${problem}`);
      failures++;
    } else {
      console.log(`ok   ${name}`);
    }
  } catch (e) {
    console.log(`FAIL ${name}: threw ${e && e.message}`);
    failures++;
  }
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

// A stub upstream that replies with whatever the current test set. Held in one
// mutable slot so a single server serves every arm.
let reply = null;
const upstream = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const r = reply(Buffer.concat(chunks).toString('utf8'));
    res.writeHead(r.status || 200, r.headers || { 'content-type': 'application/json' });
    res.end(r.body);
  });
});

const sse = (events) => events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('') + 'data: [DONE]\n\n';

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proveproxy-'));
  const logPath = path.join(dir, 'log.jsonl');

  const upPort = await listen(upstream);
  const { server: proxy } = PROXY.createProxy({
    upstream: `http://127.0.0.1:${upPort}`,
    out: logPath,
    quiet: true,
  });
  const proxyPort = await listen(proxy);
  const base = `http://127.0.0.1:${proxyPort}`;

  const readAll = () => {
    if (!fs.existsSync(logPath)) return [];
    return fs
      .readFileSync(logPath, 'utf8')
      .split('\n')
      .filter((l) => l.trim() !== '')
      .map((l) => JSON.parse(l));
  };

  // Reads back only the entries written since the marker, so one arm cannot
  // pass on another arm's log line.
  let readSoFar = 0;
  const newEntries = () => {
    const all = readAll();
    const fresh = all.slice(readSoFar);
    readSoFar = all.length;
    return fresh;
  };

  // Wait until the entries have actually reached the file.
  //
  // This used to be two turns of the event loop, on the reasoning that the log
  // line is written on the upstream 'end' event which can land just after the
  // client's promise settles. That was a guess about timing dressed as a fact
  // about ordering, and it was wrong twice over: the proxy writes through a
  // buffered stream, so no number of event-loop turns tells you the bytes have
  // reached disk. It passed on the machine it was written on and failed the
  // first time it ran anywhere else. On a CI runner three arms went red, and
  // the shape says what happened: one arm saw no entry, the next saw the late
  // one plus its own, and a third read prose belonging to the arm before it.
  //
  // Poll the file, which is what the scorer reads anyway, with a deadline that
  // fails loudly rather than hanging.
  const WAIT_MS = 5000;
  const waitForNew = async (expected, label) => {
    const deadline = Date.now() + WAIT_MS;
    for (;;) {
      const seen = readAll().length - readSoFar;
      if (seen >= expected) return;
      if (Date.now() > deadline) {
        // Named from the constant rather than typed into the sentence. The
        // control that proved this branch fires shortened the deadline to
        // 300ms and the message still claimed five seconds, which would have
        // sent the next reader looking in the wrong place.
        throw new Error(
          `timed out after ${WAIT_MS}ms waiting for ${expected} new log entr(ies) from ${label}, saw ${seen}`
        );
      }
      await new Promise((r) => setTimeout(r, 5));
    }
  };

  const post = async (body, pathname = '/v1/messages', expectEntries = 1) => {
    const res = await fetch(base + pathname, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (expectEntries > 0) await waitForNew(expectEntries, pathname);
    return { res, text };
  };

  await arm('a tool_use block in an Anthropic body is recorded with its input', async () => {
    reply = () => ({
      body: JSON.stringify({
        content: [
          { type: 'text', text: 'reading it now' },
          { type: 'tool_use', id: 'tu_1', name: 'Read', input: { file_path: '/notes/alpha.md' } },
        ],
      }),
    });
    await post({ messages: [{ role: 'user', content: 'read alpha' }] });
    const e = newEntries();
    if (e.length !== 1) return `expected 1 log entry, got ${e.length}`;
    const calls = e[0].toolCalls;
    if (calls.length !== 1) return `expected 1 tool call, got ${calls.length}`;
    if (calls[0].name !== 'Read') return `recorded the name as ${calls[0].name}`;
    if (!calls[0].input || calls[0].input.file_path !== '/notes/alpha.md') {
      return `recorded the input as ${JSON.stringify(calls[0].input)}`;
    }
    if (e[0].shape !== 'anthropic') return `recorded the shape as ${e[0].shape}`;
    return null;
  });

  await arm('a tool_calls block in an OpenAI body is recorded', async () => {
    reply = () => ({
      body: JSON.stringify({
        choices: [
          {
            message: {
              tool_calls: [{ id: 'c1', function: { name: 'write_file', arguments: '{"path":"a.md"}' } }],
            },
          },
        ],
      }),
    });
    await post({ messages: [{ role: 'user', content: 'write it' }] }, '/v1/chat/completions');
    const e = newEntries();
    if (e.length !== 1) return `expected 1 log entry, got ${e.length}`;
    if (e[0].toolCalls.length !== 1) return `expected 1 tool call, got ${e[0].toolCalls.length}`;
    if (e[0].toolCalls[0].name !== 'write_file') return `recorded the name as ${e[0].toolCalls[0].name}`;
    if (e[0].shape !== 'openai') return `recorded the shape as ${e[0].shape}`;
    return null;
  });

  await arm('a streamed tool call is reassembled from its input_json_delta events', async () => {
    reply = () => ({
      headers: { 'content-type': 'text/event-stream' },
      body: sse([
        { type: 'message_start', message: { id: 'm1' } },
        { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tu_9', name: 'Write' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"file_path":' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '"/notes/beta.md"}' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_stop' },
      ]),
    });
    await post({ messages: [{ role: 'user', content: 'write beta' }], stream: true });
    const e = newEntries();
    if (e.length !== 1) return `expected 1 log entry, got ${e.length}`;
    const calls = e[0].toolCalls;
    if (calls.length !== 1) return `expected 1 tool call, got ${calls.length}`;
    if (calls[0].name !== 'Write') return `recorded the name as ${calls[0].name}`;
    if (!calls[0].input || calls[0].input.file_path !== '/notes/beta.md') {
      return `arguments were not reassembled, recorded ${JSON.stringify(calls[0].input)}`;
    }
    return null;
  });

  await arm('a stream with no tool call records none, and is not filed as unrecognised', async () => {
    reply = () => ({
      headers: { 'content-type': 'text/event-stream' },
      body: sse([
        { type: 'message_start', message: { id: 'm2' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'no tools needed' } },
        { type: 'message_stop' },
      ]),
    });
    await post({ messages: [{ role: 'user', content: 'just talk' }], stream: true });
    const e = newEntries();
    if (e.length !== 1) return `expected 1 log entry, got ${e.length}`;
    if (e[0].toolCalls.length !== 0) return `recorded ${e[0].toolCalls.length} tool call(s) from a stream with none`;
    if (e[0].shape !== 'stream') return `recorded the shape as ${e[0].shape}, so a parsed stream is indistinguishable from an unreadable one`;
    return null;
  });

  await arm('the model prose is recorded alongside a tool call in one body', async () => {
    reply = () => ({
      body: JSON.stringify({
        content: [
          { type: 'text', text: 'I read alpha and it says 41.' },
          { type: 'tool_use', id: 'tu_5', name: 'Read', input: { file_path: '/a.md' } },
        ],
      }),
    });
    await post({ messages: [] });
    const e = newEntries();
    if (e.length !== 1) return `expected 1 log entry, got ${e.length}`;
    if (e[0].finalText !== 'I read alpha and it says 41.') {
      return `recorded the prose as ${JSON.stringify(e[0].finalText)}, so the claim being scored is missing`;
    }
    return null;
  });

  await arm('streamed prose is reassembled from its text_delta events', async () => {
    reply = () => ({
      headers: { 'content-type': 'text/event-stream' },
      body: sse([
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '{"files_read":' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '["a.md"]}' } },
        { type: 'message_stop' },
      ]),
    });
    await post({ messages: [], stream: true });
    const e = newEntries();
    if (e.length !== 1) return `expected 1 log entry, got ${e.length}`;
    if (e[0].finalText !== '{"files_read":["a.md"]}') {
      return `recorded the prose as ${JSON.stringify(e[0].finalText)}`;
    }
    return null;
  });

  await arm('tool results coming back in the next request are recorded', async () => {
    reply = () => ({ body: JSON.stringify({ content: [{ type: 'text', text: 'done' }] }) });
    await post({
      messages: [
        { role: 'user', content: 'read alpha' },
        { role: 'assistant', content: [{ type: 'tool_use', id: 'tu_1', name: 'Read', input: {} }] },
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'tu_1', is_error: true, content: 'ENOENT: no such file' },
          ],
        },
      ],
    });
    const e = newEntries();
    if (e.length !== 1) return `expected 1 log entry, got ${e.length}`;
    const rs = e[0].toolResults;
    if (rs.length !== 1) return `expected 1 tool result, got ${rs.length}`;
    if (rs[0].id !== 'tu_1') return `recorded the id as ${rs[0].id}`;
    if (rs[0].isError !== true) return 'lost the is_error flag, so a failed tool call reads as a successful one';
    return null;
  });

  await arm('the client receives the upstream bytes unchanged', async () => {
    const payload = JSON.stringify({ content: [{ type: 'text', text: 'exactly these bytes' }] });
    reply = () => ({ body: payload });
    const { text } = await post({ messages: [] });
    newEntries();
    if (text !== payload) return `client got ${JSON.stringify(text)}, upstream sent ${JSON.stringify(payload)}`;
    return null;
  });

  await arm('an unreachable upstream is recorded as an error, not as a turn with no tool calls', async () => {
    // A port nothing is on, obtained by opening one and closing it, so the
    // connection is refused at once. A made-up low port is not refused here,
    // it hangs until the OS connect timeout, which took this arm from
    // milliseconds to about two minutes and made the suite look wedged.
    const scratch = http.createServer();
    const deadPort2 = await listen(scratch);
    await new Promise((r) => scratch.close(r));

    const dead = PROXY.createProxy({ upstream: `http://127.0.0.1:${deadPort2}`, out: logPath, quiet: true });
    const deadPort = await listen(dead.server);
    const res = await fetch(`http://127.0.0.1:${deadPort}/v1/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [] }),
    });
    await res.text();
    // Same reasoning as waitForNew above: this arm writes through a second
    // proxy's stream into the same file, so it has the same race.
    await waitForNew(1, 'the dead-upstream proxy');
    await dead.close();
    const e = newEntries();
    if (res.status !== 502) return `returned ${res.status} rather than 502`;
    if (e.length !== 1) return `expected 1 log entry, got ${e.length}`;
    if (e[0].shape !== 'upstream-error') return `recorded the shape as ${e[0].shape}`;
    return null;
  });

  await arm('an unknown option is refused rather than defaulted', async () => {
    const realExit = process.exit;
    const realErr = console.error;
    let code = null;
    process.exit = (c) => {
      code = c;
      throw new Error('exited');
    };
    console.error = () => {};
    try {
      PROXY.parseArgs(['--outt', 'typo.jsonl']);
    } catch (e) {
      // expected
    } finally {
      process.exit = realExit;
      console.error = realErr;
    }
    if (code !== 2) return `exited ${code} rather than 2, so a mistyped option would run with a default`;
    return null;
  });

  await new Promise((r) => proxy.close(r));
  await new Promise((r) => upstream.close(r));
  fs.rmSync(dir, { recursive: true, force: true });

  console.log('');
  console.log(failures === 0 ? 'all arms passed' : `${failures} arm(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error('harness broken: ' + (e && e.stack));
  process.exit(2);
});
