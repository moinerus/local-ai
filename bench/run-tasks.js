#!/usr/bin/env node
//
// A fixed task set run against a local OpenAI-compatible endpoint, at more
// than one context depth, so two models can be compared on something other
// than tokens per second.
//
// Why this exists. Public benchmarks rank models in general and that ranking
// is already published. Two things they do not measure turned out to decide
// which model belongs here:
//
//   1. Behaviour at working context depth. One model measured on this card
//      lost 11% of its generation speed out to 27.5k tokens and another lost
//      57%, which inverted their ranking somewhere no leaderboard looks.
//   2. Accuracy when reporting on its own output. The model in service writes
//      and edits well and has been wrong every time it described what it did.
//      No public benchmark scores that.
//
// Run it:
//   node bench/run-tasks.js --url http://127.0.0.1:8081 --label gpt-oss-20b
//
// It executes model-generated Python. See --no-exec and the README.

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const TASKS = require('./tasks.js');
const SANDBOX = require('./sandbox.js');

// A tool-use turn can go round more than once. The cap stops a model that
// keeps calling the same tool from running until the wall timeout, and a run
// that hits it is reported rather than scored quietly.
const MAX_TOOL_ROUNDS = 8;

// ---------------------------------------------------------------------------
// arguments
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const o = {
    url: 'http://127.0.0.1:8081',
    model: 'local',
    label: '',
    reps: 3,
    depths: [0, 25000],
    only: null,
    exec: true,
    python: 'python3',
    // How the depth padding is shaped. `turn` is what every result recorded
    // before 26 Aug 2026 used and stays the default so those stay comparable.
    // It primes a model away from calling tools. See buildPadding.
    padding: 'turn',
    // A reasoning model spends this budget before it starts answering, and
    // llama.cpp returns an empty `content` with finish_reason "length" when it
    // runs out mid-thought. 800 was enough for one-line functions and emptied
    // three code tasks, which scored as unparseable rather than as truncated.
    maxTokens: 2500,
    timeoutMs: 240000,
    out: null,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--url') o.url = next().replace(/\/$/, '');
    else if (a === '--model') o.model = next();
    else if (a === '--label') o.label = next();
    else if (a === '--reps') o.reps = Number(next());
    else if (a === '--depths') o.depths = next().split(',').map(Number);
    else if (a === '--only') o.only = next().split(',');
    else if (a === '--no-exec') o.exec = false;
    else if (a === '--python') o.python = next();
    else if (a === '--padding') o.padding = next();
    else if (a === '--max-tokens') o.maxTokens = Number(next());
    else if (a === '--out') o.out = next();
    else if (a === '--help' || a === '-h') { usage(); process.exit(0); }
    else { console.error(`unknown argument: ${a}`); usage(); process.exit(2); }
  }
  if (!o.label) o.label = o.model;
  if (!Number.isFinite(o.reps) || o.reps < 1) { console.error('--reps must be 1 or more'); process.exit(2); }
  if (o.depths.some((d) => !Number.isFinite(d) || d < 0)) { console.error('--depths must be non-negative integers'); process.exit(2); }
  // A typo here would silently fall through to the `turn` shape and the run
  // would be labelled with a padding it did not use.
  if (!['turn', 'system'].includes(o.padding)) { console.error(`--padding must be "turn" or "system", got "${o.padding}"`); process.exit(2); }
  return o;
}

function usage() {
  console.log(`
run-tasks.js [options]

  --url URL          endpoint base, default http://127.0.0.1:8081
  --model NAME       model field sent in the request, default "local"
  --label NAME       name used in the report, defaults to --model
  --reps N           repetitions per task per depth, default 3
  --depths A,B       context depths in tokens, default 0,25000
  --only id,id       run only these task ids
  --no-exec          skip tasks that execute generated Python
  --python BIN       python binary, default python3
  --padding SHAPE    depth padding: "turn" (default) or "system"
  --max-tokens N     per response, default 2500. Reasoning is billed here too
  --out FILE         write full results as JSON

Exit codes: 0 every task passed, 1 something failed, 2 the harness is broken.
`.trim());
}

// ---------------------------------------------------------------------------
// executing generated Python
// ---------------------------------------------------------------------------

let PY_OK = null;

function pythonAvailable(bin) {
  if (PY_OK !== null) return PY_OK;
  const r = spawnSync(bin, ['-c', 'print(1)'], { encoding: 'utf8', timeout: 10000 });
  PY_OK = r.status === 0 && String(r.stdout).trim() === '1';
  return PY_OK;
}

function runPython(bin, code, harness) {
  const file = path.join(os.tmpdir(), `bench-${process.pid}-${Math.random().toString(36).slice(2)}.py`);
  fs.writeFileSync(file, `${code}\n\n${harness}\n`);
  try {
    const r = spawnSync(bin, ['-I', file], { encoding: 'utf8', timeout: 15000 });
    if (r.error && r.error.code === 'ETIMEDOUT') return { status: 'fail', detail: 'timed out after 15s' };
    if (r.status !== 0) {
      const err = String(r.stderr || '').trim().split('\n').slice(-3).join(' / ');
      return { status: 'fail', detail: err || `python exited ${r.status}` };
    }
    return String(r.stdout).includes('OK')
      ? { status: 'pass', detail: 'assertions passed' }
      : { status: 'fail', detail: 'assertions did not reach the end' };
  } finally {
    try { fs.unlinkSync(file); } catch (_) { /* the temp file is not the result */ }
  }
}

function checkTask(task, output, ctx, opts) {
  if (task.exec) {
    if (!opts.exec) return { status: 'skip', detail: 'execution disabled with --no-exec' };
    if (!pythonAvailable(opts.python)) return { status: 'skip', detail: `${opts.python} not runnable` };
    const code = TASKS.helpers.extractCode(output);
    if (!code) return { status: 'format', detail: 'no code found in the response' };
    return runPython(opts.python, code, task.exec.harness);
  }
  return task.check(output, ctx);
}

// ---------------------------------------------------------------------------
// the self-test, which runs before anything is asked of a model
// ---------------------------------------------------------------------------
//
// Every checker is driven with a known-good and a known-bad answer. A checker
// that passes the bad answer proves nothing when it later passes a model, so
// the harness refuses to run rather than reporting a result nobody can trust.

function selfTest(tasks, opts) {
  const problems = [];
  let checked = 0;

  for (const t of tasks) {
    const ctx = (t.fixtures && t.fixtures.fixtureCtx) || { turnOutputs: [] };
    if (!t.fixtures || t.fixtures.good === undefined || t.fixtures.bad === undefined) {
      problems.push(`${t.id}: no good/bad fixture pair`);
      continue;
    }

    const g = checkTask(t, t.fixtures.good, ctx, opts);
    const b = checkTask(t, t.fixtures.bad, ctx, opts);

    if (g.status === 'skip' || b.status === 'skip') {
      console.log(`  ${t.id.padEnd(22)} skipped (${g.detail || b.detail})`);
      continue;
    }
    checked++;
    if (g.status !== 'pass') problems.push(`${t.id}: good fixture scored ${g.status} (${g.detail})`);
    if (b.status === 'pass') problems.push(`${t.id}: BAD fixture scored pass, this checker cannot fail`);
    if (g.status === 'pass' && b.status !== 'pass') {
      console.log(`  ${t.id.padEnd(22)} good=pass bad=${b.status}`);
    }
  }

  if (problems.length) {
    console.error('\nHARNESS BROKEN, nothing was asked of any model:');
    for (const p of problems) console.error(`  ${p}`);
    return { ok: false, checked };
  }
  if (checked === 0) {
    console.error('\nHARNESS BROKEN: no checker was exercised, so a clean run would mean nothing.');
    return { ok: false, checked };
  }
  return { ok: true, checked };
}

// ---------------------------------------------------------------------------
// depth padding
// ---------------------------------------------------------------------------
//
// Deterministic filler, and the achieved depth is read back from the server's
// own prompt token count rather than assumed from the character count.

const FILLER_UNIT = [
  'Note %d. The card reports its dedicated memory per process, and the desktop',
  'compositor is counted in that total alongside anything the browser is holding.',
  'A model loaded past the reported limit does not fail. The driver places the',
  'remainder in system memory and reports nothing, so throughput is the only',
  'signal that anything happened at all.',
].join(' ');

// Two shapes, because the shape turned out to change the result.
//
// `turn` is the original: a user message full of filler and an assistant
// reply of READY. It is what every result recorded before 26 Aug 2026 was
// measured with, so it stays the default and those numbers stay comparable.
//
// It also primes. Measured on Qwen3.5-9B with reasoning off, tool-read-
// attribute passes 3 of 3 with no padding and fails 2 of 2 at 2000 tokens,
// 6000 and 12000, every failure being the model answering from a guess
// without calling read_file at all. That is not a depth effect: 2000 tokens
// is not deep. A completed question-and-answer ahead of the task establishes
// a pattern of replying directly, and the model follows the pattern.
//
// `system` puts the same filler in a system message and leaves no prior
// exchange in the conversation, which separates the two.
function buildPadding(targetTokens, mode) {
  if (!targetTokens) return [];
  // Roughly four characters per token for English prose. Deliberately an
  // estimate: the achieved depth is measured, not trusted.
  const targetChars = targetTokens * 4;
  const parts = [];
  let n = 0;
  let chars = 0;
  while (chars < targetChars) {
    const s = FILLER_UNIT.replace('%d', String(++n));
    parts.push(s);
    chars += s.length + 1;
  }
  if (mode === 'system') {
    return [
      {
        role: 'system',
        content: `Background notes. They are not a task and need no reply.\n\n${parts.join('\n')}`,
      },
    ];
  }
  return [
    { role: 'user', content: `Read these notes and reply with the single word READY.\n\n${parts.join('\n')}` },
    { role: 'assistant', content: 'READY' },
  ];
}

// ---------------------------------------------------------------------------
// the endpoint
// ---------------------------------------------------------------------------

async function complete(opts, messages, seed, tools) {
  const body = {
    model: opts.model,
    messages,
    temperature: 0,
    top_p: 1,
    seed,
    max_tokens: opts.maxTokens,
    stream: false,
  };
  if (tools) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs);
  try {
    const res = await fetch(`${opts.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
    const j = await res.json();
    const choice = j.choices && j.choices[0];
    if (!choice) throw new Error('response had no choices');
    const msg = choice.message || {};
    return {
      text: msg.content || '',
      toolCalls: Array.isArray(msg.tool_calls) ? msg.tool_calls : [],
      // Reasoning is billed against max_tokens and is not the answer. Counted
      // so a model that spends its whole budget thinking is visible as that,
      // rather than as a model that cannot follow an output format.
      reasoningChars: (msg.reasoning_content || '').length,
      promptTokens: (j.usage && j.usage.prompt_tokens) || null,
      completionTokens: (j.usage && j.usage.completion_tokens) || null,
      finish: choice.finish_reason || null,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function runOnce(task, opts, depth, seed) {
  const messages = buildPadding(depth, opts.padding);
  const turns = task.turns || [{ prompt: task.prompt }];
  const turnOutputs = [];
  let lastUsage = null;

  // A tool-use task gets its own sandbox per run, so one repetition cannot
  // leave files behind for the next and turn a miss into a pass.
  const usesTools = task.sandbox !== undefined;
  const box = usesTools ? SANDBOX.createSandbox(task.sandbox) : null;
  let toolRoundsUsed = 0;
  let hitRoundCap = false;

  for (const turn of turns) {
    messages.push({ role: 'user', content: turn.prompt });
    // Tools are offered per turn. The reporting turn of a tool task withholds
    // them deliberately, so the answer comes from what the model believes
    // rather than from a fresh look at the filesystem.
    const tools = usesTools && !turn.noTools ? SANDBOX.TOOL_SPECS : null;

    let r = await complete(opts, messages, seed, tools);
    let rounds = 0;
    while (tools && r.toolCalls.length && rounds < MAX_TOOL_ROUNDS) {
      messages.push({
        role: 'assistant',
        content: r.text || null,
        tool_calls: r.toolCalls,
      });
      for (const tc of r.toolCalls) {
        const fn = tc.function || {};
        const result = box.dispatch(fn.name, fn.arguments);
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: JSON.stringify(result),
        });
      }
      rounds++;
      toolRoundsUsed += 1;
      r = await complete(opts, messages, seed, tools);
    }
    if (tools && r.toolCalls.length && rounds >= MAX_TOOL_ROUNDS) hitRoundCap = true;

    messages.push({ role: 'assistant', content: r.text });
    turnOutputs.push(r.text);
    lastUsage = r;
  }

  const final = turnOutputs[turnOutputs.length - 1];
  const ctx = { turnOutputs };
  if (usesTools) ctx.sandbox = box.snapshot();
  let verdict = checkTask(task, final, ctx, opts);

  // A run that ran out of tool rounds did not finish the task, and its answer
  // must not be scored as though it had. Reported as its own reason rather
  // than folded into a fail.
  if (verdict.status !== 'pass' && hitRoundCap) {
    verdict = {
      status: 'fail',
      detail: `hit the ${MAX_TOOL_ROUNDS} tool-round cap still calling tools; ${verdict.detail}`,
    };
  }

  // A run that hit the token ceiling and did not pass is truncated, not
  // unparseable. Both look like an empty answer and only one is about the
  // model's ability to do the task. Merging them blamed three code tasks on a
  // format weakness that was a budget.
  if (verdict.status !== 'pass' && lastUsage.finish === 'length') {
    verdict = {
      status: 'truncated',
      detail: `hit the ${opts.maxTokens} token ceiling; ${lastUsage.reasoningChars} chars of reasoning, ${final.length} chars of answer`,
    };
  }

  return {
    ...verdict,
    promptTokens: lastUsage.promptTokens,
    completionTokens: lastUsage.completionTokens,
    reasoningChars: lastUsage.reasoningChars,
    finish: lastUsage.finish,
    output: final,
    // The record the tool-use checkers scored against, kept in the JSON so a
    // verdict can be read back against what the model actually did rather
    // than against what it said.
    toolLog: usesTools ? ctx.sandbox.log : undefined,
    toolRounds: usesTools ? toolRoundsUsed : undefined,
  };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function tally(runs) {
  const t = { pass: 0, fail: 0, format: 0, truncated: 0, skip: 0, error: 0 };
  for (const r of runs) t[r.status] = (t[r.status] || 0) + 1;
  return t;
}

async function main() {
  const opts = parseArgs(process.argv);
  const tasks = opts.only ? TASKS.filter((t) => opts.only.includes(t.id)) : TASKS.slice();

  if (!tasks.length) {
    console.error(`no tasks matched --only. Known ids: ${TASKS.map((t) => t.id).join(', ')}`);
    process.exit(2);
  }

  console.log(`self-test, ${tasks.length} checker(s) against a good and a bad answer each:`);
  const st = selfTest(tasks, opts);
  if (!st.ok) process.exit(2);
  console.log(`self-test passed, ${st.checked} checker(s) proved able to fail\n`);

  console.log(`${opts.label} at ${opts.url}, ${opts.reps} rep(s), depths ${opts.depths.join(', ')}\n`);

  const results = [];
  for (const depth of opts.depths) {
    for (const task of tasks) {
      const runs = [];
      for (let rep = 0; rep < opts.reps; rep++) {
        // Seed varies per rep so repetitions are not identical calls, and is
        // fixed per (task, depth, rep) so a rerun repeats them.
        const seed = 1000 + rep;
        try {
          runs.push(await runOnce(task, opts, depth, seed));
        } catch (e) {
          runs.push({ status: 'error', detail: e.message, promptTokens: null });
        }
      }
      const t = tally(runs);
      const achieved = runs.map((r) => r.promptTokens).filter((n) => n)[0] || null;
      const worst = runs.find((r) => r.status !== 'pass');
      results.push({ task: task.id, klass: task.klass, depth, achievedPromptTokens: achieved, tally: t, runs });

      const score = `${t.pass}/${runs.length}`;
      const note = worst ? `  ${worst.status}: ${String(worst.detail).slice(0, 90)}` : '';
      console.log(
        `d${String(depth).padEnd(6)} ${task.id.padEnd(22)} ${score.padEnd(6)}` +
          `${achieved ? `prompt=${achieved}` : ''}${note}`
      );
    }
    console.log('');
  }

  // Summary by depth, which is the comparison this harness exists for.
  console.log('summary');
  console.log('| model | depth | achieved prompt tokens | passed | failed | format | truncated | skipped | errored |');
  console.log('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  const KINDS = ['pass', 'fail', 'format', 'truncated', 'skip', 'error'];
  for (const depth of opts.depths) {
    const rows = results.filter((r) => r.depth === depth);
    const sum = Object.fromEntries(
      KINDS.map((k) => [k, rows.reduce((a, r) => a + (r.tally[k] || 0), 0)])
    );
    const achieved = rows.map((r) => r.achievedPromptTokens).filter(Boolean);
    const mid = achieved.length ? Math.round(achieved.reduce((a, b) => a + b, 0) / achieved.length) : 'n/a';
    console.log(
      `| ${opts.label} | ${depth} | ${mid} | ${KINDS.map((k) => sum[k]).join(' | ')} |`
    );
  }

  if (opts.out) {
    fs.writeFileSync(
      opts.out,
      JSON.stringify({ label: opts.label, url: opts.url, opts: { ...opts }, at: new Date().toISOString(), results }, null, 2)
    );
    console.log(`\nfull results: ${opts.out}`);
  }

  const anyBad = results.some(
    (r) => r.tally.fail || r.tally.format || r.tally.truncated || r.tally.error
  );
  process.exit(anyBad ? 1 : 0);
}

main().catch((e) => {
  console.error(`harness error: ${e.stack || e.message}`);
  process.exit(2);
});
