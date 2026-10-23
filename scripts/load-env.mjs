#!/usr/bin/env node
// Prints `export KEY='value'` lines for each entry in the given .env files, in order.
// Robust against values that contain shell metacharacters (&, |, ;, $, spaces, ...),
// which `. ./.env` cannot handle safely. Later files override earlier ones.
// Usage: eval "$(node scripts/load-env.mjs .env .env.local)"
import { existsSync, readFileSync } from "node:fs";

const files = process.argv.slice(2);
if (files.length === 0) {
  process.stderr.write("load-env.mjs: no files given\n");
  process.exit(2);
}

const LINE_RX = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;

function shellSingleQuote(value) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

for (const file of files) {
  if (!existsSync(file)) continue;
  const text = readFileSync(file, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const m = rawLine.match(LINE_RX);
    if (!m) continue;
    const key = m[1];
    let value = m[2];
    const trimmed = value.trim();
    const quoted =
      (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2);
    if (quoted) {
      value = trimmed.slice(1, -1);
    } else {
      // Unquoted: strip inline comment (first #), then trim.
      // (Values with a literal '#' must be wrapped in quotes.)
      const hashIdx = value.indexOf("#");
      if (hashIdx >= 0) value = value.slice(0, hashIdx);
      value = value.trim();
    }
    process.stdout.write(`export ${key}=${shellSingleQuote(value)}\n`);
  }
}
