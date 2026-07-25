#!/usr/bin/env node
'use strict';
/**
 * Show pipeline progress — what's done, what's next, how to resume.
 *
 *   npm run status
 */

const fs = require('fs');
const CONFIG = require('../config');

const txt = fs.readFileSync(CONFIG.brainFile, 'utf8');
const lines = txt.split('\n');

// Pair each "### Tn: Title" heading with the STATUS line that follows it.
const tasks = [];
for (let i = 0; i < lines.length; i++) {
  const h = lines[i].match(/^###\s+(.+?)\s*$/);
  if (!h) continue;
  for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
    const st = lines[j].match(/^\*\*STATUS:\s*(TODO|DONE)\*\*\s*$/i);
    if (st) {
      tasks.push({ title: h[1], done: st[1].toUpperCase() === 'DONE' });
      break;
    }
  }
}

if (!tasks.length) {
  console.log('No tasks found in', CONFIG.brainFile);
  process.exit(0);
}

const done = tasks.filter((t) => t.done).length;
const total = tasks.length;
const pct = Math.round((done / total) * 100);
const width = 28;
const filled = Math.round((done / total) * width);

console.log(`\n  AgentChain progress\n`);
console.log(`  [${'█'.repeat(filled)}${'░'.repeat(width - filled)}] ${done}/${total}  (${pct}%)\n`);

for (const t of tasks) {
  console.log(`   ${t.done ? '✅' : '⬜'}  ${t.title}`);
}

const next = tasks.find((t) => !t.done);
console.log('');
if (!next) {
  console.log('  🎉 All tasks complete.\n');
} else {
  console.log(`  ▸ Next up: ${next.title}`);
  console.log(`  ▸ Remaining: ${total - done}\n`);
  console.log('  Resume with:');
  console.log('    TASKS=3 node worker.js     # do the next 3, then stop');
  console.log('    node worker.js             # finish everything\n');
}
