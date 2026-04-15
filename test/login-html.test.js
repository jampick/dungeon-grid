import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'index.html'),
  'utf8',
);

test('login html: DM and Player buttons present', () => {
  assert.match(html, /id="btnDM"/);
  assert.match(html, /id="btnPlayer"/);
});

test('login html: name and DM password inputs present', () => {
  assert.match(html, /id="name"/);
  assert.match(html, /id="dmpass"/);
});

test('login html: login error span present', () => {
  assert.match(html, /id="loginErr"/);
});

test('login html: app.js loaded as an ES module script', () => {
  // Capture the <script ...app.js...> tag and make sure it declares type="module".
  // Reverting this to a plain script would silently break every import in app.js.
  const scriptMatch = html.match(/<script\b[^>]*\bsrc="[^"]*app\.js[^"]*"[^>]*>/i);
  assert.ok(scriptMatch, 'expected a <script src="...app.js..."> tag in index.html');
  assert.match(scriptMatch[0], /\btype="module"/, 'app.js <script> must have type="module"');
});
