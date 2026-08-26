// Fourth probe. Is the undercount a recall effect?
//
// Probe 3 showed the undercount on the failing function survives changing its
// condition and reordering its branches, and disappears on renaming the
// function, renaming the argument, or changing the returned literals. Control
// flow is irrelevant and surface text is everything, which is the signature of
// the model answering from a remembered version of a familiar snippet instead
// of counting the text in front of it.
//
// If that is right it is not a property of one function, so it has to show up
// on other canonical exercises. Each arm below is a well-known snippet and its
// identifier-renamed twin. Renaming changes no line, so the true count is
// identical and only the familiarity differs.
//
// Prediction if recall is carrying it: the canonical arms miscount and their
// renamed twins are correct.
// Prediction if it is one quirk of one function: every arm here is correct
// except the classify control.
//
// The classify pair is included as the positive control. If the control stops
// firing, no other row means anything, so its verdict is reported first.

'use strict';

const URL = process.argv[2] || 'http://127.0.0.1:8080';
const LABEL = process.argv[3] || 'model';
const REPS = Number(process.argv[4] || 3);

const CLASSIFY = [
  'def classify(n):',
  '    if n < 0:',
  '        return "negative"',
  '    if n == 0:',
  '        return "zero"',
  '    if n % 2 == 0:',
  '        return "even"',
  '    return "odd"',
].join('\n');

const FIZZBUZZ = [
  'def fizzbuzz(n):',
  '    if n % 15 == 0:',
  '        return "FizzBuzz"',
  '    if n % 3 == 0:',
  '        return "Fizz"',
  '    if n % 5 == 0:',
  '        return "Buzz"',
  '    return str(n)',
].join('\n');

const IS_PRIME = [
  'def is_prime(n):',
  '    if n < 2:',
  '        return False',
  '    if n == 2:',
  '        return True',
  '    if n % 2 == 0:',
  '        return False',
  '    for i in range(3, int(n ** 0.5) + 1, 2):',
  '        if n % i == 0:',
  '            return False',
  '    return True',
].join('\n');

const FACTORIAL = [
  'def factorial(n):',
  '    if n < 0:',
  '        raise ValueError("negative")',
  '    if n == 0:',
  '        return 1',
  '    total = 1',
  '    for i in range(2, n + 1):',
  '        total *= i',
  '    return total',
].join('\n');

// Identifier-only rename. No line is added, removed or wrapped.
const rename = (code, pairs) => {
  let out = code;
  for (const [from, to] of pairs) {
    out = out.replace(new RegExp(`\\b${from}\\b`, 'g'), to);
  }
  return out;
};

const ARMS = [
  ['classify (control)', CLASSIFY],
  ['classify renamed', rename(CLASSIFY, [['classify', 'grade'], ['n', 'val']])],
  ['fizzbuzz', FIZZBUZZ],
  ['fizzbuzz renamed', rename(FIZZBUZZ, [['fizzbuzz', 'label'], ['n', 'val']])],
  ['is_prime', IS_PRIME],
  ['is_prime renamed', rename(IS_PRIME, [['is_prime', 'check'], ['n', 'val'], ['i', 'k']])],
  ['factorial', FACTORIAL],
  ['factorial renamed', rename(FACTORIAL, [['factorial', 'product'], ['n', 'val'], ['total', 'acc'], ['i', 'k']])],
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
  // A rename that changed a line count would make every comparison below
  // meaningless, so it is checked rather than assumed.
  for (let i = 0; i < ARMS.length; i += 2) {
    const a = trueLines(ARMS[i][1]);
    const b = trueLines(ARMS[i + 1][1]);
    if (a !== b) {
      console.error(`renaming changed the line count for ${ARMS[i][0]}: ${a} vs ${b}`);
      process.exit(2);
    }
  }

  console.log(`${LABEL} at ${URL}, temperature 0, ${REPS} rep(s) per arm\n`);
  console.log('arm                  lines  answers    verdict');
  console.log('-------------------  -----  ---------  ----------');

  const rows = [];
  for (const [id, code] of ARMS) {
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
    rows.push({ id, truth, said, ok });
    console.log(
      `${id.padEnd(19)}  ${String(truth).padStart(5)}  ${said.join(',').padEnd(9)}  ${ok ? 'correct' : 'wrong'}`
    );
  }

  console.log('');
  const control = rows[0];
  if (control.ok) {
    console.log(`CONTROL DID NOT REPRODUCE: classify answered ${control.said.join(',')} for ${control.truth}.`);
    console.log('No row below it can be read either way while the known trigger is not firing.');
    process.exit(1);
  }
  console.log('Control reproduced: classify is still miscounted.');
  const canon = rows.filter((r, i) => i % 2 === 0);
  const renamed = rows.filter((r, i) => i % 2 === 1);
  console.log(`Canonical arms wrong: ${canon.filter((r) => !r.ok).map((r) => r.id).join(', ') || 'only the control'}`);
  console.log(`Renamed arms wrong:   ${renamed.filter((r) => !r.ok).map((r) => r.id).join(', ') || 'none'}`);
})();
