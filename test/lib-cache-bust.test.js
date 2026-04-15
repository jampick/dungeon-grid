import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { substituteVersion } from '../lib/logic.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_JS_PATH = path.join(__dirname, '..', 'public', 'app.js');

test('public/app.js imports /lib/logic.js with the {{LIB_VERSION}} cache-bust token', () => {
  const src = fs.readFileSync(APP_JS_PATH, 'utf8');
  // Catches anyone who reverts the token back to a plain import.
  assert.ok(
    src.includes("'/lib/logic.js?v={{LIB_VERSION}}'"),
    'expected app.js to import /lib/logic.js with ?v={{LIB_VERSION}} suffix'
  );
  // And there should be no untokenized imports of /lib/*.
  const bareLibImport = /from\s+['"]\/lib\/[^'"?]+['"]/;
  assert.ok(
    !bareLibImport.test(src),
    'expected no /lib/* imports without a ?v= cache-bust query string'
  );
});

test('substituteVersion replaces {{LIB_VERSION}} with the supplied version', () => {
  const out = substituteVersion(
    'import x from "/lib/logic.js?v={{LIB_VERSION}}"',
    'abc123'
  );
  assert.strictEqual(out, 'import x from "/lib/logic.js?v=abc123"');
});

test('substituteVersion replaces every occurrence', () => {
  const out = substituteVersion('{{LIB_VERSION}}-{{LIB_VERSION}}', 'v1');
  assert.strictEqual(out, 'v1-v1');
});

test('substituteVersion handles empty / missing / unknown versions without throwing', () => {
  assert.strictEqual(
    substituteVersion('a {{LIB_VERSION}} b', ''),
    'a  b'
  );
  assert.strictEqual(
    substituteVersion('a {{LIB_VERSION}} b', 'unknown'),
    'a unknown b'
  );
  assert.strictEqual(
    substituteVersion('a {{LIB_VERSION}} b', null),
    'a  b'
  );
  assert.strictEqual(
    substituteVersion('a {{LIB_VERSION}} b', undefined),
    'a  b'
  );
});
