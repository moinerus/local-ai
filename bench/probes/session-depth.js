// How deep did the session get, and did the conversation ever shrink?
// A drop in the message count from one request to the next is what compaction
// looks like from the wire: the harness replaces the history with a summary.
'use strict';
const fs = require('node:fs');
const entries = fs
  .readFileSync(process.argv[2], 'utf8')
  .split('\n')
  .filter((l) => l.trim() !== '')
  .map((l) => JSON.parse(l));

let prevMsgs = 0;
let drops = 0;
let maxBytes = 0;
let maxMsgs = 0;
for (const e of entries) {
  const msgs = typeof e.messages === 'number' ? e.messages : Array.isArray(e.messages) ? e.messages.length : null;
  const bytes = e.requestBytes || 0;
  if (bytes > maxBytes) maxBytes = bytes;
  if (msgs !== null) {
    if (msgs > maxMsgs) maxMsgs = msgs;
    if (prevMsgs && msgs < prevMsgs) {
      drops++;
      console.log(`  message count fell ${prevMsgs} -> ${msgs} at seq ${e.seq}`);
    }
    prevMsgs = msgs;
  }
}
console.log(`entries: ${entries.length}`);
console.log(`largest request: ${maxBytes} bytes, roughly ${Math.round(maxBytes / 4)} tokens`);
console.log(`most messages in one request: ${maxMsgs}`);
console.log(`times the history shrank: ${drops}`);
