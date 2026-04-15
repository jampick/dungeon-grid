import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import express from 'express';
import { cacheBustedImageUrl } from '../lib/logic.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');

test('cacheBustedImageUrl appends ?v=<sha> to /creatures/* URLs', () => {
  assert.strictEqual(
    cacheBustedImageUrl('/creatures/goblin.svg', 'abc123'),
    '/creatures/goblin.svg?v=abc123'
  );
});

test('cacheBustedImageUrl leaves /uploads/* untouched', () => {
  assert.strictEqual(
    cacheBustedImageUrl('/uploads/foo.png', 'abc123'),
    '/uploads/foo.png'
  );
});

test('cacheBustedImageUrl returns empty string unchanged', () => {
  assert.strictEqual(cacheBustedImageUrl('', 'abc123'), '');
});

test('cacheBustedImageUrl returns null unchanged', () => {
  assert.strictEqual(cacheBustedImageUrl(null, 'abc123'), null);
});

test('cacheBustedImageUrl appends with & when URL already has a query', () => {
  assert.strictEqual(
    cacheBustedImageUrl('/creatures/x.svg?foo=1', 'abc123'),
    '/creatures/x.svg?foo=1&v=abc123'
  );
});

test('cacheBustedImageUrl falls back to ?v=dev when shortSha is null', () => {
  assert.strictEqual(
    cacheBustedImageUrl('/creatures/x.svg', null),
    '/creatures/x.svg?v=dev'
  );
});

test('/creatures/* route serves Cache-Control: no-cache', async () => {
  const app = express();
  app.use('/creatures', express.static(path.join(REPO_ROOT, 'public', 'creatures'), {
    setHeaders(res) {
      res.set('Cache-Control', 'no-cache');
    },
  }));
  const srv = app.listen(0);
  try {
    await new Promise((resolve) => srv.once('listening', resolve));
    const port = srv.address().port;
    const res = await fetch(`http://localhost:${port}/creatures/goblin.svg`);
    assert.strictEqual(res.status, 200);
    const cc = res.headers.get('cache-control') || '';
    assert.match(cc, /no-cache/, `expected no-cache, got "${cc}"`);
    assert.doesNotMatch(cc, /immutable/, 'should not be immutable');
  } finally {
    await new Promise((resolve) => srv.close(resolve));
  }
});

test('server.js mounts /creatures with no-cache BEFORE the public mount', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'server.js'), 'utf8');
  assert.match(
    src,
    /app\.use\(\s*'\/creatures'[\s\S]*?setHeaders[\s\S]*?Cache-Control[\s\S]*?no-cache/,
    'expected /creatures express.static mount to set Cache-Control: no-cache'
  );
  // Ensure the /creatures mount appears before the generic public mount so
  // Express route precedence picks it first.
  const creaturesIdx = src.search(/app\.use\(\s*'\/creatures'/);
  const publicIdx = src.search(/app\.use\(\s*express\.static\(\s*path\.join\(__dirname,\s*'public'\s*\)/);
  assert.ok(creaturesIdx > -1, 'missing /creatures mount');
  assert.ok(publicIdx > -1, 'missing public static mount');
  assert.ok(creaturesIdx < publicIdx, '/creatures mount must precede public mount');
});
