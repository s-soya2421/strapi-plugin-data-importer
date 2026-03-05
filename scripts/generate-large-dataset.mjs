#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;

    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = true;
      continue;
    }

    out[key] = next;
    i += 1;
  }
  return out;
}

function toNumber(value, fallback, label) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid --${label}: ${value}`);
  }
  return parsed;
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (!/[,"\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function createRow(index, prefix) {
  const number = index + 1;
  return {
    title: `Perf ${prefix} ${number}`,
    slug: `${prefix}-${String(number).padStart(6, '0')}`,
    body: `Load-test body ${number}`,
    views: String(number * 10),
    active: number % 2 === 0 ? 'true' : 'false',
    publishedAt: '2026-01-01',
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(
      [
        'Usage: node scripts/generate-large-dataset.mjs [options]',
        '',
        'Options:',
        '  --rows <n>            Number of rows (default: 1000)',
        '  --start <n>           1-based start index (default: 1)',
        '  --prefix <text>       Slug/title prefix (default: perf-post)',
        '  --out <path>          Output path without extension (default: ./tmp/import-<rows>)',
        '  --format <csv|json|both>  Output format (default: both)',
        '  --invalid-row <n>     1-based row index to inject invalid integer value into views',
      ].join('\n')
    );
    return;
  }

  const rows = Math.max(1, Math.floor(toNumber(args.rows, 1000, 'rows')));
  const start = Math.max(1, Math.floor(toNumber(args.start, 1, 'start')));
  const prefix = typeof args.prefix === 'string' ? args.prefix : 'perf-post';
  const invalidRow = args['invalid-row']
    ? Math.floor(toNumber(args['invalid-row'], -1, 'invalid-row'))
    : -1;
  const format = typeof args.format === 'string' ? args.format : 'both';
  const outBase = path.resolve(
    typeof args.out === 'string' ? args.out : `./tmp/import-${rows}`
  );

  if (!['csv', 'json', 'both'].includes(format)) {
    throw new Error(`Invalid --format: ${format}`);
  }

  const data = [];
  for (let i = 0; i < rows; i += 1) {
    const current = start + i - 1;
    const row = createRow(current, prefix);
    if (invalidRow === i + 1) {
      row.views = 'not-a-number';
    }
    data.push(row);
  }

  await fs.mkdir(path.dirname(outBase), { recursive: true });

  if (format === 'csv' || format === 'both') {
    const headers = Object.keys(data[0]);
    const lines = [headers.join(',')];
    for (const row of data) {
      lines.push(headers.map((key) => csvEscape(row[key])).join(','));
    }
    await fs.writeFile(`${outBase}.csv`, `${lines.join('\n')}\n`, 'utf8');
  }

  if (format === 'json' || format === 'both') {
    await fs.writeFile(`${outBase}.json`, JSON.stringify(data, null, 2), 'utf8');
  }

  console.log(
    JSON.stringify(
      {
        rows,
        start,
        prefix,
        format,
        outBase,
        invalidRow: invalidRow > 0 ? invalidRow : null,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
