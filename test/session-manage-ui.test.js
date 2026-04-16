import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INDEX_HTML_PATH = path.join(__dirname, '..', 'public', 'index.html');

describe('Session manage UI (static HTML)', () => {
  const html = fs.readFileSync(INDEX_HTML_PATH, 'utf8');

  test('index.html contains session rename input with id="sessionName"', () => {
    assert.ok(html.includes('id="sessionName"'),
      'expected an element with id="sessionName"');
  });

  test('index.html contains delete session button with id="deleteSession"', () => {
    assert.ok(html.includes('id="deleteSession"'),
      'expected a button with id="deleteSession"');
  });

  test('delete session button has the danger class', () => {
    assert.match(html, /id="deleteSession"[^>]*class="danger"/,
      'expected deleteSession button to have class="danger"');
  });
});
