// Why does a model miscount lines by one?
//
// The harness task `self-report-edit` asks a model to rewrite a function and
// then say how many lines its own rewrite has. Qwen3-Coder-30B writes the same
// 8-line rewrite every time and answers 7 every time, at both depths, across
// every repetition. Two mechanisms fit that equally well:
//
//   H1  it cannot report on its own prior output, which is the reading the
//       project has been carrying since the live failure
//   H2  it cannot count lines at all, in which case the task is measuring
//       arithmetic and the self-report framing is incidental
//
// H2 is testable without any self-report: hand it code it did not write and
// ask the same question. This probe does that at three lengths, so a constant
// answer of 7 and an answer of n-1 are told apart, and it asks the 8-line case
// twice more with the counting made explicit.
//
// The true count is computed here from the literal, not taken from a comment,
// so the expected value cannot drift from the text being sent.
//
// This is a probe, not a scored task. Its results do not belong in a bench
// table.

'use strict';

const URL = process.argv[2] || 'http://127.0.0.1:8080';
const LABEL = process.argv[3] || 'model';
const REPS = Number(process.argv[4] || 3);

// The exact rewrite Qwen3-Coder-30B produced, byte for byte, in all six runs
// of 2026-08-26-qwen3coder-30b-selfreport-turns.json.
const EIGHT = [
  'def classify(n):',
  '    if n < 0:',
  '        return "negative"',
  '    if n == 0:',
  '        return "zero"',
  '    if n % 2 == 0:',
  '        return "even"',
  '    return "odd"',
].join('\n');

const FIVE = [
  'def sign(n):',
  '    if n < 0:',
  '        return -1',
  '    if n > 0:',
  '        return 1',
].join('\n');

const ELEVEN = [
  'def bucket(n):',
  '    if n < 0:',
  '        return "negative"',
  '    if n == 0:',
  '        return "zero"',
  '    if n < 10:',
  '        return "small"',
  '    if n < 100:',
  '        return "medium"',
  '    if n < 1000:',
  '        return "large"',
].join('\n');

const trueLines = (code) => code.split('\n').filter((l) => l.trim() !== '').length;

// The wording is the harness task's wording, so the answer is comparable with
// the recorded self-report runs rather than to a question phrased differently.
const ASK = [
  'How many lines does this function have, counting every line',
  'in the code block including the def line and ignoring blank lines?',
  '',
  'Reply with a JSON object and nothing else:',
  '{"lines": <integer>}',
].join('\n');

const ASK_ENUMERATED = [
  'Number every line of this function, one per output line, in the form',
  '"1: <the line>". Ignore blank lines. Then, on a final line by itself,',
  'give the total as a JSON object: {"lines": <integer>}',
].join('\n');

const arms = [
  { id: 'given-8', code: EIGHT, ask: ASK },
  { id: 'given-5', code: FIVE, ask: ASK },
  { id: 'given-11', code: ELEVEN, ask: ASK },
  { id: 'given-8-enumerated', code: EIGHT, ask: ASK_ENUMERATED },
];

async function complete(prompt, seed) {
  const res = await fetch(`${URL}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'local',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 600,
      temperature: 0.7,
      seed,
    }),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  const j = await res.json();
  return (j.choices[0].message.content || '').trim();
}

const lastJson = (s) => {
  const m = String(s).match(/\{[^{}]*"lines"[^{}]*\}/g);
  if (!m) return null;
  try {
    return JSON.parse(m[m.length - 1]);
  } catch (e) {
    return null;
  }
};

(async () => {
  console.log(`${LABEL} at ${URL}, ${REPS} rep(s) per arm\n`);
  console.log('arm                  true  answers          verdict');
  console.log('-------------------  ----  ---------------  -------------------------');

  for (const arm of arms) {
    const truth = trueLines(arm.code);
    const said = [];
    for (let i = 0; i < REPS; i++) {
      const prompt = `${arm.ask}\n\n\`\`\`python\n${arm.code}\n\`\`\``;
      let out;
      try {
        out = await complete(prompt, 1000 + i);
      } catch (e) {
        said.push(`ERR:${e.message.slice(0, 40)}`);
        continue;
      }
      const j = lastJson(out);
      said.push(j && j.lines !== undefined ? String(j.lines) : `unparsed:${out.slice(0, 30)}`);
    }

    const nums = said.map(Number).filter((n) => Number.isFinite(n));
    let verdict = 'mixed';
    if (nums.length === said.length) {
      if (nums.every((n) => n === truth)) verdict = 'correct';
      else if (nums.every((n) => n === truth - 1)) verdict = 'one short, every time';
      else if (nums.every((n) => n === nums[0])) verdict = `constant ${nums[0]}`;
    }
    console.log(
      `${arm.id.padEnd(19)}  ${String(truth).padStart(4)}  ${said.join(',').padEnd(15)}  ${verdict}`
    );
  }

  console.log('\nReading it: "one short, every time" across all three lengths means the');
  console.log('model is dropping a line from any count, and the self-report framing of');
  console.log('the harness task is not what it fails at. "correct" on given code and');
  console.log('wrong on its own output means the opposite.');
})();
