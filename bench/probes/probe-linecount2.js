// Follow-up to probe-linecount.js.
//
// Probe 1 found that Qwen3-Coder-30B counts a 5-line and an 11-line function
// correctly and is one short on one particular 8-line function, whether or not
// it wrote that function itself. So it is neither a self-report failure nor a
// counting failure. Two candidate mechanisms remain:
//
//   H3  the trailing unpaired line is dropped. The failing function is
//       def + three if/return pairs + one bare return. The two functions it
//       counts correctly are def + N if/return pairs with nothing trailing.
//       If it is counting the repeating structure, an element that breaks the
//       pattern has nowhere to be counted.
//   H4  the number 8 is what it gets wrong, for no structural reason.
//
// These arms separate them. Each shape is generated rather than typed, so the
// declared structure and the actual text cannot disagree, and the true count
// is computed from the generated text.
//
//   paired-N     def + N if/return pairs, nothing trailing     -> 1 + 2N lines
//   trailing-N   def + N if/return pairs + one bare return     -> 2 + 2N lines
//
// H3 predicts every `trailing-N` arm is one short and every `paired-N` arm is
// correct. H4 predicts only the 8-line arms are wrong, which is trailing-3 and
// paired-4 (both 8 lines), and that trailing-2 and trailing-5 are correct.
// The two arms at 8 lines are the discriminating pair.

'use strict';

const URL = process.argv[2] || 'http://127.0.0.1:8080';
const LABEL = process.argv[3] || 'model';
const REPS = Number(process.argv[4] || 3);

const CONDS = [
  ['n < 0', '"negative"'],
  ['n == 0', '"zero"'],
  ['n < 10', '"small"'],
  ['n < 100', '"medium"'],
  ['n < 1000', '"large"'],
  ['n < 10000', '"huge"'],
];

function build(name, pairs, trailing) {
  const out = [`def ${name}(n):`];
  for (let i = 0; i < pairs; i++) {
    out.push(`    if ${CONDS[i][0]}:`);
    out.push(`        return ${CONDS[i][1]}`);
  }
  if (trailing) out.push('    return "other"');
  return out.join('\n');
}

const trueLines = (code) => code.split('\n').filter((l) => l.trim() !== '').length;

const ASK = [
  'How many lines does this function have, counting every line',
  'in the code block including the def line and ignoring blank lines?',
  '',
  'Reply with a JSON object and nothing else:',
  '{"lines": <integer>}',
].join('\n');

const arms = [];
for (const pairs of [2, 3, 4, 5]) {
  arms.push({ id: `paired-${pairs}`, code: build(`p${pairs}`, pairs, false) });
  arms.push({ id: `trailing-${pairs}`, code: build(`t${pairs}`, pairs, true) });
}

async function complete(prompt, seed) {
  const res = await fetch(`${URL}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'local',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 200,
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
  console.log(`${LABEL} at ${URL}, ${REPS} rep(s) per arm`);
  console.log('paired-N has no trailing line. trailing-N ends with one bare return.\n');
  console.log('arm           lines  answers        verdict');
  console.log('------------  -----  -------------  ----------------------');

  const byShape = { paired: [], trailing: [] };

  for (const arm of arms) {
    const truth = trueLines(arm.code);
    const said = [];
    for (let i = 0; i < REPS; i++) {
      const prompt = `${ASK}\n\n\`\`\`python\n${arm.code}\n\`\`\``;
      try {
        const out = await complete(prompt, 2000 + i);
        const j = lastJson(out);
        said.push(j && j.lines !== undefined ? Number(j.lines) : NaN);
      } catch (e) {
        said.push(NaN);
      }
    }
    const ok = said.every((n) => n === truth);
    const allShort = said.every((n) => n === truth - 1);
    const verdict = ok ? 'correct' : allShort ? 'one short, every time' : 'mixed or other';
    byShape[arm.id.startsWith('paired') ? 'paired' : 'trailing'].push({ truth, ok, allShort });
    console.log(
      `${arm.id.padEnd(12)}  ${String(truth).padStart(5)}  ${said.join(',').padEnd(13)}  ${verdict}`
    );
  }

  console.log('');
  const pairedOk = byShape.paired.every((r) => r.ok);
  const trailingShort = byShape.trailing.every((r) => r.allShort);
  const eightArms = [...byShape.paired, ...byShape.trailing].filter((r) => r.truth === 8);
  const eightAllWrong = eightArms.length > 0 && eightArms.every((r) => !r.ok);

  if (pairedOk && trailingShort) {
    console.log('H3 holds: the trailing unpaired line is dropped at every length,');
    console.log('and every function without one is counted correctly.');
  } else if (eightAllWrong && !trailingShort) {
    console.log('H4 holds: the arms at 8 lines are wrong and length predicts the');
    console.log('error better than the shape does.');
  } else {
    console.log('Neither H3 nor H4 as stated. Read the rows.');
  }
})();
