#!/usr/bin/env node
// web-ctx.mjs — 在压缩 JS 中按字面量定位并输出上下文（避免正则回溯爆炸）
// 用法: node scripts/web-ctx.mjs <file> <before> <after> <pattern> [pattern...]
import { readFileSync } from 'node:fs';

const [file, beforeArg, afterArg, ...patterns] = process.argv.slice(2);
const before = Number(beforeArg ?? 150);
const after = Number(afterArg ?? 300);
const text = readFileSync(file, 'utf8');

for (const pat of patterns) {
  console.log(`\n===== ${pat}`);
  let from = 0;
  let hits = 0;
  while (hits < 3) {
    const i = text.indexOf(pat, from);
    if (i === -1) break;
    const start = Math.max(0, i - before);
    const end = Math.min(text.length, i + pat.length + after);
    console.log(`--- @${i}\n${text.slice(start, end)}`);
    from = i + pat.length;
    hits += 1;
  }
  if (hits === 0) console.log('(no hit)');
}
