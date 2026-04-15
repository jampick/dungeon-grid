import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');
const INDEX_HTML_PATH = path.join(REPO_ROOT, 'public', 'index.html');

test('/lib/* route serves Cache-Control: no-cache (defense in depth)', async () => {
  const app = express();
  app.use('/lib', express.static(path.join(REPO_ROOT, 'lib'), {
    setHeaders(res) {
      res.set('Cache-Control', 'no-cache');
    },
  }));
  const srv = app.listen(0);
  try {
    await new Promise((resolve) => srv.once('listening', resolve));
    const port = srv.address().port;
    const res = await fetch(`http://localhost:${port}/lib/logic.js`);
    assert.strictEqual(res.status, 200);
    const cc = res.headers.get('cache-control') || '';
    assert.match(cc, /no-cache/, `expected no-cache, got "${cc}"`);
    assert.doesNotMatch(cc, /immutable/, 'should not be immutable');
  } finally {
    await new Promise((resolve) => srv.close(resolve));
  }
});

test('server.js mounts /lib with no-cache (and not immutable/maxAge)', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'server.js'), 'utf8');
  // The /lib mount must set Cache-Control: no-cache via setHeaders.
  assert.match(
    src,
    /app\.use\(\s*'\/lib'[\s\S]*?setHeaders[\s\S]*?Cache-Control[\s\S]*?no-cache/,
    'expected /lib express.static mount to set Cache-Control: no-cache'
  );
  // And it must NOT pin immutable / maxAge: '1y' on /lib.
  const libMountMatch = src.match(/app\.use\(\s*'\/lib'[^;]*\)\s*;/);
  assert.ok(libMountMatch, 'could not locate /lib mount');
  assert.doesNotMatch(libMountMatch[0], /immutable\s*:\s*true/);
  assert.doesNotMatch(libMountMatch[0], /maxAge\s*:\s*['"]1y['"]/);
});

test('public/index.html cache-busts style.css with ?v={{VERSION}}', () => {
  const html = fs.readFileSync(INDEX_HTML_PATH, 'utf8');
  assert.ok(
    html.includes('href="/style.css?v={{VERSION}}"'),
    'expected <link rel="stylesheet" href="/style.css?v={{VERSION}}">'
  );
});

test('public/index.html cache-busts app.js with ?v={{VERSION}}', () => {
  const html = fs.readFileSync(INDEX_HTML_PATH, 'utf8');
  assert.ok(
    html.includes('src="/app.js?v={{VERSION}}"'),
    'expected <script src="/app.js?v={{VERSION}}">'
  );
});
