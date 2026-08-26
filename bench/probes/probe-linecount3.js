// Third probe. Which part of the failing function triggers the undercount?
//
// Probe 1: the model answers 7 for the 8-line `classify` rewrite, every time,
// whether or not it wrote it. It counts a 5-line and an 11-line function
// correctly, and counts `classify` correctly when made to enumerate first.
//
// Probe 2: generated functions of the same length and the same shape are NOT
// reliably miscounted. Its arms at 7 and 8 lines were mixed (6,7,6 and 8,8,7),
// which also shows the answers are not deterministic in general. So neither
// length nor the trailing-return shape explains a result that is deterministic
// on one particular text.
//
// This probe changes one thing at a time against the exact failing text and
// reports which change removes the error. It also re-runs the untouched
// original as a positive control in the same session, because a probe whose
// control has stopped failing is measuring nothing, and reports the control's
// verdict first so a lost trigger cannot be read as a fixed one.
//
// Temperature is 0 here, unlike probes 1 and 2, so that "every time" means the
// text rather than the sampler. The original arm therefore also re-tests the
// probe-1 result under a setting that removes one explanation for it.

'use strict';

const URL = process.argv[2] || 'http://127.0.0.1:8080';
const LABEL = process.argv[3] || 'model';
const REPS = Number(process.argv[4] || 3);

const ORIGINAL = [
  'def classify(n):',
  '    if n < 0:',
  '        return "negative"',
  '    if n == 0:',
  '        return "zero"',
  '    if n % 2 == 0:',
  '        return "even"',
  '    return "odd"',
].join('\n');

// One change each, against ORIGINAL.
const VARIANTS = [
  ['original', ORIGINAL],
  ['renamed-function', ORIGINAL.replace('def classify(n):', 'def bucket(n):')],
  ['renamed-arg', ORIGINAL.replace(/\bn\b/g, 'value')],
  ['plain-strings', ORIGINAL
    .replace('"negative"', '"a"')
    .replace('"zero"', '"b"')
    .replace('"even"', '"c"')
    .replace('"odd"', '"d"')],
  ['no-modulo', ORIGINAL.replace('if n % 2 == 0:', 'if n < 100:')],
  ['ints-not-strings', ORIGINAL
    .replace('"negative"', '-1')
    .replace('"zero"', '0')
    .replace('"even"', '2')
    .replace('"odd"', '1')],
  ['reordered', [
    'def classify(n):',
    '    if n == 0:',
    '        return "zero"',
    '    if n < 0:',
    '        return "negative"',
    '    if n % 2 == 0:',
    '        return "even"',
    '    return "odd"',
  ].join('\n')],
];

const trueLines = (code) => code.split('\n').filter((l) => l.trim() !== '').length;

const ASK = [
  'How many lines does this function have, counting every line',
  'in the code block including the def line and ignoring blank lines?',
  '',
  'Reply with a JSON object and nothing else:',
  '{"lines": <integer>}',
].join('\n');

async function complete(prompt) {
  const res = await fetch(`${URL}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'local',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 200,
      temperature: 0,
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
  console.log(`${LABEL} at ${URL}, temperature 0, ${REPS} rep(s) per arm`);
  console.log('Every arm is 8 lines. One change each against the original.\n');
  console.log('arm                lines  answers    verdict');
  console.log('-----------------  -----  ---------  ----------------');

  const rows = [];
  for (const [id, code] of VARIANTS) {
    const truth = trueLines(code);
    const said = [];
    for (let i = 0; i < REPS; i++) {
      try {
        const out = await complete(`${ASK}\n\n\`\`\`python\n${code}\n\`\`\``);
        const j = lastJson(out);
        said.push(j && j.lines !== undefined ? Number(j.lines) : NaN);
      } catch (e) {
        said.push(NaN);
      }
    }
    const ok = said.every((n) => n === truth);
    const short = said.every((n) => n === truth - 1);
    rows.push({ id, truth, said, ok, short });
    console.log(
      `${id.padEnd(17)}  ${String(truth).padStart(5)}  ${said.join(',').padEnd(9)}  ` +
      `${ok ? 'correct' : short ? 'one short' : 'mixed'}`
    );
  }

  const control = rows.find((r) => r.id === 'original');
  console.log('');
  if (!control.short) {
    console.log(`CONTROL DID NOT REPRODUCE: the original answered ${control.said.join(',')} for ${control.truth}.`);
    console.log('Nothing below it can be read as a trigger, because the trigger is not firing.');
    process.exit(1);
  }
  console.log('Control reproduced: the original is one short at temperature 0.');
  const fixed = rows.filter((r) => r.id !== 'original' && r.ok).map((r) => r.id);
  const kept = rows.filter((r) => r.id !== 'original' && r.short).map((r) => r.id);
  console.log(`Changes that removed the undercount: ${fixed.length ? fixed.join(', ') : 'none'}`);
  console.log(`Changes that kept it: ${kept.length ? kept.join(', ') : 'none'}`);
})();
