import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'app.js'),
  'utf8',
);

// Strip // line comments and /* block comments */ from the head of the file,
// then find the first non-empty line.
function firstCodeLine(text) {
  let t = text.replace(/\/\*[\s\S]*?\*\//g, '');
  const lines = t.split(/\r?\n/).map((l) => l.replace(/\/\/.*$/, '').trim());
  return lines.find((l) => l.length > 0) || '';
}

test('public/app.js is still an ES module (first code line is an import)', () => {
  const line = firstCodeLine(src);
  assert.match(line, /^import\b/, `expected first code line to be an import, got: ${line}`);
});

test('public/app.js imports from /lib/logic.js (browser-accessible static path)', () => {
  // The path may include a ?v={{LIB_VERSION}} cache-bust query string that
  // server.js rewrites at startup. See test/lib-cache-bust.test.js.
  assert.match(src, /from\s+['"]\/lib\/logic\.js(\?[^'"]*)?['"]/);
});
